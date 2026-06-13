import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ML_API = "https://api.mercadolibre.com";

// ── ML fetch helper ───────────────────────────────────────────────────────────

async function mlFetch(path: string, accessToken: string, timeoutMs = 15_000) {
  const res = await fetch(`${ML_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`ML API error [${path}]:`, res.status, data?.message ?? "(no message)");
    throw new Error(data?.message || `ML API error: ${res.status}`);
  }
  return data;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Resolve a invoice key + janela de consumo a partir de /periods ───────────
// Regra de domínio: fatura nomeada pelo mês de FECHAMENTO (consumo N → fatura N+1).
// O ciclo de cobrança da conta NÃO é mês-calendário (ex.: 06→05); a janela real
// vem de period.date_from/date_to. Para período OPEN o date_from vem anômalo
// (placeholder antigo) → deriva de date_to − 1 mês + 1 dia.
async function resolveInvoice(
  token: string, sellerId: string, periodMonth: string,
): Promise<{ key: string; from: string; to: string } | null> {
  const resp = await fetch(
    `${ML_API}/billing/integration/monthly/periods?seller_id=${sellerId}&group=ML&document_type=BILL`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) },
  );
  if (!resp.ok) {
    if (resp.status === 404) return null;
    throw new Error(`billing/periods failed: ${resp.status}`);
  }
  const list: any[] = (await resp.json()).results ?? [];
  // chave da fatura = consumo + 1 mês
  const [py, pm] = periodMonth.split("-").map(Number);
  const invDate = new Date(Date.UTC(py, pm, 1));
  const month = `${invDate.getUTCFullYear()}-${String(invDate.getUTCMonth() + 1).padStart(2, "0")}`;
  const compact = month.replace("-", "");
  const period = list.find((p: any) => {
    const k = String(p.key ?? "");
    return k.startsWith(month) || k.substring(0, 7) === month || k.startsWith(compact);
  });
  if (!period?.key) return null;

  const rawFrom = String(period.period?.date_from ?? "");
  const rawTo = String(period.period?.date_to ?? "");
  let from = rawFrom || "";
  const to = rawTo || "";
  if (rawFrom && rawTo) {
    const fromMs = Date.parse(rawFrom), toMs = Date.parse(rawTo);
    if (Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs - fromMs > 60 * 86_400_000) {
      const d = new Date(toMs);
      d.setUTCMonth(d.getUTCMonth() - 1);
      d.setUTCDate(d.getUTCDate() + 1);
      from = d.toISOString().slice(0, 10);
    }
  }
  return { key: String(period.key), from, to };
}

// ── Paginação sequencial de /details (grupos ML + MP) ────────────────────────
// Sequencial (com pequeno delay) para evitar a instabilidade de paginação por
// offset sob concorrência. Valida a contagem coletada contra o `total` da API e
// faz uma passada de reconciliação por offset deslocado quando há lacuna.
interface RawMove {
  detailId: number; date: string; type: string; label: string; amount: number; isBonus: boolean; saleDate: string | null;
}

async function fetchGroupMoves(token: string, sellerId: string, key: string, group: string): Promise<RawMove[]> {
  const PAGE = 200;
  const byId = new Map<number, RawMove>();
  const fetchPage = async (offset: number) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(
        `${ML_API}/billing/integration/periods/key/${key}/group/${group}/details?document_type=BILL&limit=${PAGE}&offset=${offset}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(25_000) },
      );
      if (res.status === 429 || res.status >= 500) { await sleep(800 * (attempt + 1)); continue; }
      if (res.status === 404) return { total: 0, results: [] as any[] };
      if (!res.ok) throw new Error(`details ${group} ${res.status}`);
      const j = await res.json();
      return { total: Number(j.total ?? 0), results: (j.results ?? []) as any[] };
    }
    throw new Error(`details ${group} offset ${offset}: rate-limited after retries`);
  };

  const ingest = (results: any[]) => {
    for (const m of results) {
      const ci = m.charge_info ?? {};
      const id = Number(ci.detail_id);
      if (!id || byId.has(id)) continue;
      byId.set(id, {
        detailId: id,
        date: String(ci.creation_date_time ?? "").slice(0, 10),
        type: String(ci.detail_sub_type ?? ""),
        label: String(ci.transaction_detail ?? ""),
        amount: Number(ci.detail_amount ?? 0),
        isBonus: String(ci.detail_type ?? "") === "BONUS",
        saleDate: m.sales_info?.[0]?.sale_date_time ? String(m.sales_info[0].sale_date_time).slice(0, 10) : null,
      });
    }
  };

  const first = await fetchPage(0);
  const total = first.total;
  ingest(first.results);
  for (let off = PAGE; off < total; off += PAGE) {
    const p = await fetchPage(off);
    ingest(p.results);
    await sleep(150);
  }
  // Reconciliação: se a paginação por offset perdeu itens (páginas parciais),
  // refaz com offset deslocado +100 cobrindo a faixa. Dedup por detail_id.
  if (total > 0 && byId.size < total * 0.999) {
    for (let off = 100; off < total + 100; off += PAGE) {
      const p = await fetchPage(off);
      ingest(p.results);
      await sleep(150);
    }
  }
  return [...byId.values()];
}

// Agrega uma fatura inteira (ML+MP) por (data de lançamento, tipo), aplicando a
// regra de sinal e a janela de consumo (estornos de vendas fora da janela são
// excluídos — o ML também não os inclui no total_amount da fatura).
async function aggregateInvoice(
  token: string, sellerId: string, inv: { key: string; from: string; to: string },
): Promise<Array<{ charge_date: string; charge_type: string; charge_label: string; amount: number }>> {
  const moves = [
    ...(await fetchGroupMoves(token, sellerId, inv.key, "ML")),
    ...(await fetchGroupMoves(token, sellerId, inv.key, "MP")),
  ];
  const within = (d: string | null) => d === null || (d >= inv.from && d <= inv.to);
  const agg = new Map<string, { charge_date: string; charge_type: string; charge_label: string; amount: number }>();
  for (const m of moves) {
    if (!m.date || !m.type) continue;
    let signed: number | null;
    if (!m.isBonus) signed = m.amount;
    else if (within(m.saleDate)) signed = -m.amount;
    else signed = null; // estorno de venda fora da janela: ignorado
    if (signed === null) continue;
    const k = `${m.date}|${m.type}`;
    const cur = agg.get(k);
    if (cur) cur.amount += signed;
    else agg.set(k, { charge_date: m.date, charge_type: m.type, charge_label: m.label, amount: signed });
  }
  return [...agg.values()].map((r) => ({ ...r, amount: Math.round(r.amount * 100) / 100 }));
}

// ── Billing period fetch (modo monthly — summary agregado, comportamento legado) ─

async function fetchBillingPeriod(
  token: string,
  sellerId: string,
  periodMonth: string,
): Promise<{
  cffe: number; cfonpn: number;
  charges: Array<{ type: string; label: string; amount: number }>;
  invoiceFrom: string | null; invoiceTo: string | null;
} | null> {
  const inv = await resolveInvoice(token, sellerId, periodMonth);
  if (!inv) return null;

  const detailResp = await fetch(
    `${ML_API}/billing/integration/periods/key/${inv.key}/summary/details?seller_id=${sellerId}&document_type=BILL`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) },
  );
  if (!detailResp.ok) {
    if (detailResp.status === 404) return null;
    throw new Error(`billing/summary/details failed: ${detailResp.status}`);
  }
  const data = await detailResp.json();
  const billIncludes = data.bill_includes ?? {};
  const charges: any[] = [...(billIncludes.charges ?? []), ...(billIncludes.bonuses ?? [])];
  const cffe = charges.filter((c: any) => String(c.type ?? "").includes("CFFE")).reduce((s, c) => s + Number(c.amount ?? 0), 0);
  const cfonpn = charges.filter((c: any) => String(c.type ?? "").includes("CFONPN")).reduce((s, c) => s + Number(c.amount ?? 0), 0);
  return {
    cffe, cfonpn,
    charges: charges.map((c: any) => ({ type: String(c.type ?? ""), label: String(c.label ?? ""), amount: Number(c.amount ?? 0) })),
    invoiceFrom: inv.from || null, invoiceTo: inv.to || null,
  };
}

// ── Body schema ────────────────────────────────────────────────────────────────

const BodySchema = z.object({
  ml_user_id: z.string().min(1),
  period_month: z.string().regex(/^\d{4}-\d{2}$/, "period_month must be YYYY-MM"),
  mode: z.enum(["monthly", "daily"]).optional().default("monthly"),
});

// ── Handler ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
    const isServiceRole = token === serviceKey;

    let userId: string | null = null;
    if (!isServiceRole) {
      const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(token);
      if (authErr || !authData?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      userId = authData.user.id;
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid input", details: parsed.error.flatten().fieldErrors }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { ml_user_id, period_month, mode } = parsed.data;

    const { data: tokenRow, error: tokenErr } = await supabaseAdmin
      .from("ml_tokens").select("access_token, organization_id, seller_id")
      .eq("ml_user_id", ml_user_id).not("access_token", "is", null).limit(1).maybeSingle();
    if (tokenErr || !tokenRow?.access_token) {
      return new Response(JSON.stringify({ error: "No ML token found for this store" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const accessToken: string = tokenRow.access_token;
    const organizationId: string | null = tokenRow.organization_id ?? null;

    if (!isServiceRole) {
      if (!organizationId) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: isMember } = await supabaseAdmin.rpc("is_org_member", { _user_id: userId, _org_id: organizationId });
      if (!isMember) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const mlUser = await mlFetch("/users/me", accessToken);
    const mlNumericId = String(mlUser.id);

    // ── Modo daily: agrega movimentos por dia de lançamento em ml_billing_daily ──
    // Sincroniza as DUAS faturas que tocam o mês-calendário pedido: a fatura do
    // próprio mês (key = period_month, cobre os dias 01–05) e a do mês seguinte
    // (key = period_month+1, cobre 06–fim). Full-resync idempotente por fatura.
    if (mode === "daily") {
      if (!organizationId) {
        return new Response(JSON.stringify({ success: true, daily: null, warning: "organization_id missing" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const [y, m] = period_month.split("-").map(Number);
      const nextMonth = `${new Date(Date.UTC(y, m, 1)).getUTCFullYear()}-${String(new Date(Date.UTC(y, m, 1)).getUTCMonth() + 1).padStart(2, "0")}`;
      const targets = [period_month, nextMonth]; // faturas que cobrem dias 01–05 e 06–fim do mês-calendário

      let totalRows = 0;
      const synced: string[] = [];
      for (const pm of targets) {
        const inv = await resolveInvoice(accessToken, mlNumericId, pm);
        if (!inv) continue; // fatura ainda não existe (ex.: mês muito à frente)
        const rows = await aggregateInvoice(accessToken, mlNumericId, inv);
        // full-resync idempotente desta fatura
        await supabaseAdmin.from("ml_billing_daily")
          .delete().eq("organization_id", organizationId).eq("ml_user_id", ml_user_id).eq("source_invoice_key", inv.key);
        if (rows.length > 0) {
          const payload = rows.map((r) => ({ organization_id: organizationId, ml_user_id, charge_date: r.charge_date, charge_type: r.charge_type, charge_label: r.charge_label, amount: r.amount, source_invoice_key: inv.key }));
          for (let i = 0; i < payload.length; i += 500) {
            const { error } = await supabaseAdmin.from("ml_billing_daily").insert(payload.slice(i, i + 500));
            if (error) throw new Error(`insert ml_billing_daily: ${error.message}`);
          }
        }
        totalRows += rows.length;
        synced.push(inv.key);
      }
      return new Response(JSON.stringify({ success: true, mode: "daily", period_month, invoices_synced: synced, rows: totalRows }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Modo monthly (legado): summary agregado em ml_billing_monthly ────────────
    const billing = await fetchBillingPeriod(accessToken, mlNumericId, period_month);
    if (!billing) {
      return new Response(JSON.stringify({ success: true, billing: null, message: "No billing data available for this period" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!organizationId) {
      return new Response(JSON.stringify({ success: true, billing: { cffe: billing.cffe, cfonpn: billing.cfonpn }, warning: "organization_id missing, upsert skipped" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { error: upsertErr } = await supabaseAdmin.from("ml_billing_monthly").upsert({
      organization_id: organizationId, ml_user_id, period_month, charges: billing.charges,
      resumo: {
        cffe: billing.cffe, cfonpn: billing.cfonpn,
        total_charges: billing.charges.reduce((s, c) => s + c.amount, 0),
        invoice_from: billing.invoiceFrom, invoice_to: billing.invoiceTo,
        synced_at: new Date().toISOString(),
      },
      synced_at: new Date().toISOString(),
    }, { onConflict: "organization_id,ml_user_id,period_month" });
    if (upsertErr) throw new Error(upsertErr.message);

    return new Response(JSON.stringify({ success: true, billing: { cffe: billing.cffe, cfonpn: billing.cfonpn, charges_count: billing.charges.length } }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("sync-ml-billing error:", message);
    return new Response(JSON.stringify({ success: false, error: message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
