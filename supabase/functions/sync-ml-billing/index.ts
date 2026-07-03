import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { aggregateMoves, type RawMove } from "./aggregate.ts";

// EdgeRuntime é global no runtime Supabase Edge — sem import necessário.
// Usado para o modo "daily" rodar em background (ver serve() abaixo) — evita o
// caller (pg_net do cron, Pattern B) segurar a conexão pela duração inteira do
// sync. Mesmo padrão de sync-mp-releases / sync-tiny-payables / sync-tiny-costs.
declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void };

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

// ── Paginação por cursor de /details (grupos ML + MP) ────────────────────────
// 2026-07-03 (fix rate-limit): trocado de offset (PAGE=200 + passada de
// reconciliação que dobrava as chamadas) para o cursor from_id/last_id
// recomendado pela doc oficial do ML ("Best Practices for Consuming Billing
// Reports APIs" — developers.mercadolibre.com.ar): offset é instável nesta
// API (perde/repete itens entre chamadas) e o ML recomenda from_id+limit=1000
// no lugar. Com limit=1000 uma fatura de 800+ movimentos cabe tipicamente em
// 1 página só, eliminando o cenário que estourava o rate-limit no offset 800.
// Dedup por detail_id continua como defesa (idempotente mesmo se a API
// devolver overlap entre páginas).
async function fetchGroupMoves(token: string, sellerId: string, key: string, group: string): Promise<RawMove[]> {
  const PAGE = 1000; // limite recomendado pela doc do ML para paginação por from_id
  const byId = new Map<number, RawMove>();
  const fetchPage = async (fromId: number) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(
        `${ML_API}/billing/integration/periods/key/${key}/group/${group}/details?document_type=BILL&limit=${PAGE}&from_id=${fromId}&sort_by=ID&order_by=ASC`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(25_000) },
      );
      // Backoff mais longo que o anterior (800ms×4) — defesa adicional caso a
      // API ainda rate-limite mesmo com muito menos chamadas por fatura.
      if (res.status === 429 || res.status >= 500) { await sleep(1_500 * (attempt + 1)); continue; }
      if (res.status === 404) return { results: [] as any[], lastId: null as number | null };
      if (!res.ok) throw new Error(`details ${group} ${res.status}`);
      const j = await res.json();
      const results = (j.results ?? []) as any[];
      // last_id pode vir no topo ou aninhado em paging; fallback: detail_id do
      // último item da página (defensivo — não depende só do shape exato da doc).
      const lastId = j.last_id != null
        ? Number(j.last_id)
        : j.paging?.last_id != null
        ? Number(j.paging.last_id)
        : results.length > 0
        ? Number(results[results.length - 1]?.charge_info?.detail_id) || null
        : null;
      return { results, lastId };
    }
    throw new Error(`details ${group} from_id ${fromId}: rate-limited after retries`);
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

  let fromId = 0;
  let guard = 0; // hard cap de páginas — nunca loopar infinitamente se a API repetir last_id
  while (true) {
    const page = await fetchPage(fromId);
    ingest(page.results);
    if (page.results.length === 0 || page.lastId == null || page.lastId === fromId) break;
    fromId = page.lastId;
    guard += 1;
    if (guard > 50) { // 50 × 1000 = 50k movimentos, bem acima de qualquer fatura real
      console.warn(`fetchGroupMoves ${group} key=${key}: guard de páginas atingido (50) — possível loop, abortando paginação`);
      break;
    }
    await sleep(250);
  }
  return [...byId.values()];
}

// Agrega uma fatura inteira (ML+MP) por (competência da venda, data de
// lançamento, tipo) — trilha de COMPETÊNCIA (Phase 84). competence_date =
// saleDate ?? charge_date; a exclusão `within` (janela de consumo da fatura)
// foi REMOVIDA nesta trilha — estornos de vendas fora da janela agora contam
// (sempre com sinal negativo). Núcleo puro de agregação vive em ./aggregate.ts
// (testável no vitest sem os imports Deno/URL deste arquivo). `inv.from`/`inv.to`
// não são mais usados aqui (mantidos na assinatura só por `inv.key`, usado por
// fetchGroupMoves) — a trilha `fetchBillingPeriod`/`ml_billing_monthly` (visão
// "igual à fatura ML") continua intacta e usa esses campos separadamente.
async function aggregateInvoice(
  token: string, sellerId: string, inv: { key: string; from: string; to: string },
): Promise<Array<{ competence_date: string; charge_date: string; charge_type: string; charge_label: string; amount: number }>> {
  const moves: RawMove[] = [
    ...(await fetchGroupMoves(token, sellerId, inv.key, "ML")),
    ...(await fetchGroupMoves(token, sellerId, inv.key, "MP")),
  ];
  return aggregateMoves(moves);
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

// ── Modo daily: agrega movimentos por dia de lançamento em ml_billing_daily ──
// Sincroniza as DUAS faturas que tocam o mês-calendário pedido: a fatura do
// próprio mês (key = period_month, cobre os dias 01–05) e a do mês seguinte
// (key = period_month+1, cobre 06–fim). Full-resync idempotente por fatura.
// Extraída para função própria (2026-07-03) para poder rodar tanto inline
// (mode debug=1, usado para verificação síncrona) quanto em background via
// EdgeRuntime.waitUntil (caminho padrão — ver serve()).
async function runDailySync(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  accessToken: string,
  mlNumericId: string,
  organizationId: string,
  ml_user_id: string,
  period_month: string,
): Promise<{ synced: string[]; totalRows: number }> {
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
      const payload = rows.map((r) => ({ organization_id: organizationId, ml_user_id, competence_date: r.competence_date, charge_date: r.charge_date, charge_type: r.charge_type, charge_label: r.charge_label, amount: r.amount, source_invoice_key: inv.key }));
      for (let i = 0; i < payload.length; i += 500) {
        const { error } = await supabaseAdmin.from("ml_billing_daily").insert(payload.slice(i, i + 500));
        if (error) throw new Error(`insert ml_billing_daily: ${error.message}`);
      }
    }
    totalRows += rows.length;
    synced.push(inv.key);
  }
  return { synced, totalRows };
}

// Sincroniza UMA fatura específica por key (Phase 84 — backfill resiliente).
// Motivo: quando a API do ML está lenta, `runDailySync` (2 faturas por chamada)
// estoura o teto de wall-clock da EF. Este caminho processa 1 fatura só,
// cabendo no limite mesmo com ML devagar. Full-resync idempotente por fatura
// (delete-by-source_invoice_key + insert). `from`/`to` não são usados na trilha
// de competência (aggregateInvoice ignora), então bastam a key.
async function syncSingleInvoice(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  accessToken: string,
  mlNumericId: string,
  organizationId: string,
  ml_user_id: string,
  invoiceKey: string,
): Promise<{ synced: string[]; totalRows: number }> {
  const inv = { key: invoiceKey, from: "", to: "" };
  const rows = await aggregateInvoice(accessToken, mlNumericId, inv);
  await supabaseAdmin.from("ml_billing_daily")
    .delete().eq("organization_id", organizationId).eq("ml_user_id", ml_user_id).eq("source_invoice_key", inv.key);
  if (rows.length > 0) {
    const payload = rows.map((r) => ({ organization_id: organizationId, ml_user_id, competence_date: r.competence_date, charge_date: r.charge_date, charge_type: r.charge_type, charge_label: r.charge_label, amount: r.amount, source_invoice_key: inv.key }));
    for (let i = 0; i < payload.length; i += 500) {
      const { error } = await supabaseAdmin.from("ml_billing_daily").insert(payload.slice(i, i + 500));
      if (error) throw new Error(`insert ml_billing_daily: ${error.message}`);
    }
  }
  return { synced: [inv.key], totalRows: rows.length };
}

/** Mês-calendário anterior ao corrente (YYYY-MM, UTC). Usado pelo cron (Layer 3):
 *  ciclo de fatura ML é 06→05, então por volta do dia 6+ do mês corrente a
 *  fatura do mês anterior já está disponível/fechada. */
function previousCalendarMonth(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ── Fan-out multi-conta (cron/Layer 3): varre ml_tokens e roda runDailySync
// para cada conta ativa. Só usado pelo caminho service-role sem ml_user_id no
// body (ver serve()) — nunca exposto a chamadas de usuário comum.
async function runAllAccountsDailySync(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  periodMonthOverride?: string,
): Promise<{ period_month: string; accounts: number; results: Array<{ ml_user_id: string; ok: boolean; rows?: number; error?: string }> }> {
  const periodMonth = periodMonthOverride ?? previousCalendarMonth();
  const { data: tokenRows, error } = await supabaseAdmin
    .from("ml_tokens")
    .select("ml_user_id, organization_id, access_token, updated_at")
    .not("access_token", "is", null)
    .not("organization_id", "is", null)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`ml_tokens fetch: ${error.message}`);

  const seen = new Set<string>();
  const results: Array<{ ml_user_id: string; ok: boolean; rows?: number; error?: string }> = [];
  // deno-lint-ignore no-explicit-any
  for (const row of (tokenRows ?? []) as any[]) {
    const mlUserId = String(row.ml_user_id);
    if (seen.has(mlUserId)) continue; // dedup — linhas mais recentes (updated_at desc) vêm primeiro
    seen.add(mlUserId);
    try {
      const mlUser = await mlFetch("/users/me", row.access_token);
      const mlNumericId = String(mlUser.id);
      const { synced, totalRows } = await runDailySync(supabaseAdmin, row.access_token, mlNumericId, row.organization_id, mlUserId, periodMonth);
      results.push({ ml_user_id: mlUserId, ok: true, rows: totalRows });
      console.log(`sync-ml-billing cron: ml_user_id=${mlUserId} period=${periodMonth} invoices=${synced.join(",")} rows=${totalRows}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ ml_user_id: mlUserId, ok: false, error: msg });
      console.error(`sync-ml-billing cron: ml_user_id=${mlUserId} period=${periodMonth} failed:`, msg);
    }
  }
  return { period_month: periodMonth, accounts: results.length, results };
}

// ── Body schema ────────────────────────────────────────────────────────────────
// ml_user_id e period_month são opcionais SÓ para o fan-out do cron (mode=daily,
// service-role, sem ml_user_id => varre todas as contas, ver serve()). Todo
// outro caminho (frontend, monthly) continua exigindo ambos — validado
// manualmente logo após o parse (zod não expressa bem esse "obrigatório
// condicional" sem refinar a árvore toda).

const BodySchema = z.object({
  ml_user_id: z.string().min(1).optional(),
  period_month: z.string().regex(/^\d{4}-\d{2}$/, "period_month must be YYYY-MM").optional(),
  mode: z.enum(["monthly", "daily"]).optional().default("monthly"),
  // Phase 84 — backfill resiliente: sincroniza SÓ esta fatura (1 por chamada,
  // evita o timeout do par de 2 faturas quando o ML está lento). Só honrado no
  // modo daily; exige ml_user_id + organização resolvida.
  invoice_key: z.string().min(1).optional(),
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
    const { ml_user_id, period_month, mode, invoice_key } = parsed.data;

    // ── Fan-out multi-conta (Layer 3 — cron): mode=daily sem ml_user_id varre
    // TODAS as contas ativas (ml_tokens). Só service-role pode disparar — nunca
    // exposto a usuário comum (evitaria forçar sync de orgs alheias, mesmo sem
    // vazar dados). period_month opcional: default = mês-calendário anterior.
    if (mode === "daily" && !ml_user_id) {
      if (!isServiceRole) {
        return new Response(JSON.stringify({ error: "ml_user_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const bg = runAllAccountsDailySync(supabaseAdmin, period_month)
        .then((r) => console.log(`sync-ml-billing cron done: period=${r.period_month} accounts=${r.accounts}`))
        .catch((e: unknown) => console.error("sync-ml-billing cron failed:", e instanceof Error ? e.message : String(e)));
      EdgeRuntime.waitUntil(bg);
      return new Response(JSON.stringify({ success: true, mode: "daily", scope: "all-accounts", status: "enqueued" }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!ml_user_id) {
      return new Response(JSON.stringify({ error: "ml_user_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!period_month) {
      return new Response(JSON.stringify({ error: "period_month required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ME-04: ORDER BY updated_at DESC — determinístico em multi-tenant (token mais recente)
    const { data: tokenRow, error: tokenErr } = await supabaseAdmin
      .from("ml_tokens").select("access_token, organization_id, seller_id, updated_at")
      .eq("ml_user_id", ml_user_id).not("access_token", "is", null)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
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

    // ── Modo daily ─────────────────────────────────────────────────────────────
    // 2026-07-03: por padrão roda em BACKGROUND (EdgeRuntime.waitUntil) — a fatura
    // ML+MP × 2 meses pode envolver várias chamadas sequenciais à API do ML
    // (paginação + backoff em caso de 429); rodar em background evita que o
    // caller (pg_net do cron, Pattern B — ver Layer 3) segure a conexão HTTP
    // pela duração inteira do sync. Mesmo padrão de sync-mp-releases/sync-tiny-*.
    // ?debug=1 roda inline (síncrono) e devolve o resultado completo — usado
    // para verificação manual (via net.http_post) sem precisar fazer polling.
    if (mode === "daily") {
      if (!organizationId) {
        return new Response(JSON.stringify({ success: true, daily: null, warning: "organization_id missing" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // Phase 84 — backfill resiliente: se invoice_key vier no body, sincroniza
      // SÓ aquela fatura (1 chamada ML, cabe no tempo mesmo com o ML lento).
      const dailyRunner = () => invoice_key
        ? syncSingleInvoice(supabaseAdmin, accessToken, mlNumericId, organizationId, ml_user_id, invoice_key)
        : runDailySync(supabaseAdmin, accessToken, mlNumericId, organizationId, ml_user_id, period_month);
      const isDebug = new URL(req.url).searchParams.get("debug") === "1";
      if (isDebug) {
        const { synced, totalRows } = await dailyRunner();
        return new Response(JSON.stringify({ success: true, mode: "daily", period_month, invoices_synced: synced, rows: totalRows }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const bg = dailyRunner()
        .then(({ synced, totalRows }) => {
          console.log(`sync-ml-billing daily done: ml_user_id=${ml_user_id} period=${period_month} invoices=${synced.join(",")} rows=${totalRows}`);
        })
        .catch((e: unknown) => {
          // Pitfall: sem try/catch a exceção do background morre silenciosamente
          // (sem log) quando chamada via EdgeRuntime.waitUntil.
          console.error(`sync-ml-billing daily bg failed: ml_user_id=${ml_user_id} period=${period_month}:`, e instanceof Error ? e.message : String(e));
        });
      EdgeRuntime.waitUntil(bg);
      return new Response(JSON.stringify({ success: true, mode: "daily", period_month, status: "enqueued" }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
