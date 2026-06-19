/**
 * sync-mp-releases — scheduled edge function (CASH-01)
 * Ingere liberações reais do Mercado Pago para todas as orgs ativas.
 *
 * DOIS MODOS de janela temporal:
 *   (a) Histórica  (days_back=30):  saldo real passado (releases realizados/agendados)
 *   (b) Futura     (days_ahead=45): projeção de entradas (só quando days_ahead > 0)
 *
 * PERF (corrigido 2026-06-18): o endpoint /v1/payments/search JÁ retorna
 * transaction_details.net_received_amount, money_release_date, status e
 * transaction_amount em cada result — NÃO é preciso buscar /v1/payments/{id}
 * individualmente. Processa e faz UPSERT incremental POR PÁGINA (100), evitando
 * estourar o tempo-limite da edge function e tornando o progresso durável.
 *
 * Token: mesmo access_token de ml_tokens (OAuth ML serve para ML + MP na mesma conta —
 * validado em produção: /v1/payments/search retornou 200 com o token ML da Pé Vermeio).
 * Upsert idempotente por (organization_id, payment_id).
 * Disparada por pg_cron (Pattern B) diariamente às 07:00 UTC.
 *
 * Supabase project: ckcdevcxgvueywivefgx (NÃO usar gionpsuunfkkzzjdubfy).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").trim();
const SERVICE_KEY  = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
const ML_API       = "https://api.mercadolibre.com";
const MP_API       = "https://api.mercadopago.com";
const ML_APP_ID    = Deno.env.get("ML_APP_ID") ?? "";
const ML_CLIENT_SECRET = Deno.env.get("ML_CLIENT_SECRET") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const VALID_STATUSES = ["approved", "authorized", "in_process", "in_mediation", "refunded"];

function requireServiceRole(req: Request): Response | null {
  if (!SERVICE_KEY) return null;
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== "Bearer " + SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  return null;
}

async function getAccessToken(sb: ReturnType<typeof createClient>, mlUserId: string): Promise<string> {
  const { data: row } = await sb
    .from("ml_tokens")
    .select("access_token,refresh_token,expires_at")
    .eq("ml_user_id", mlUserId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) throw new Error("No ML token for ml_user_id=" + mlUserId);

  const expiresTs = row.expires_at ? new Date(row.expires_at).getTime() / 1000 : 0;
  const now       = Date.now() / 1000;
  if (row.access_token && expiresTs - now > 300) return row.access_token;

  if (!row.refresh_token) throw new Error("No refresh token for ml_user_id=" + mlUserId);
  if (!ML_APP_ID || !ML_CLIENT_SECRET) throw new Error("ML_APP_ID/ML_CLIENT_SECRET not set");

  const resp = await fetch(ML_API + "/oauth/token", {
    method:  "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type:    "refresh_token",
      client_id:     ML_APP_ID,
      client_secret: ML_CLIENT_SECRET,
      refresh_token: row.refresh_token,
    }),
  });
  if (!resp.ok) throw new Error("Token refresh " + resp.status + " for ml_user_id=" + mlUserId);

  const data         = await resp.json();
  const newExpiresAt = new Date(Date.now() + (data.expires_in || 21600) * 1000).toISOString();

  await sb
    .from("ml_tokens")
    .update({
      access_token:  data.access_token,
      refresh_token: data.refresh_token ?? row.refresh_token,
      expires_at:    newExpiresAt,
    })
    .eq("ml_user_id", mlUserId);

  return data.access_token;
}

async function mpGet(
  url: string,
  token: string,
  sb: ReturnType<typeof createClient>,
  mlUserId: string,
  retried = false,
): Promise<any> {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (res.ok) return res.json();

    if (res.status === 401 && !retried) {
      console.warn("sync-mp-releases: 401 para ml_user_id=" + mlUserId + " — tentando refresh");
      const newToken = await getAccessToken(sb, mlUserId);
      return mpGet(url, newToken, sb, mlUserId, true);
    }

    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? "2");
      await new Promise(r => setTimeout(r, (wait || 2) * 1000));
      continue;
    }

    if (i < 2 && [500, 502, 503, 504].includes(res.status)) {
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      continue;
    }

    throw new Error("MP " + res.status + " " + url.split("?")[0]);
  }
  throw new Error("MP retries exhausted: " + url.split("?")[0]);
}

function toBrtIso(dateStr: string, time: "start" | "end"): string {
  const t = time === "start" ? "T00:00:00.000-03:00" : "T23:59:59.000-03:00";
  return dateStr + t;
}

function todayStr(): string {
  return new Date().toISOString().substring(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().substring(0, 10);
}

interface PaymentWindow {
  beginDate: string;
  endDate:   string;
  mode:      "historical" | "future";
}

// Pagina o /search e faz UPSERT incremental por página (sem fetch de detalhe individual).
async function processWindow(
  sb: ReturnType<typeof createClient>,
  mlUserId: string,
  orgId: string,
  token: string,
  win: PaymentWindow,
): Promise<number> {
  let offset = 0;
  let upserted = 0;

  while (true) {
    const qs = new URLSearchParams({
      sort:       "money_release_date",
      criteria:   "asc",
      range:      "money_release_date",
      begin_date: win.beginDate,
      end_date:   win.endDate,
      limit:      "100",
      offset:     String(offset),
    });

    const data = await mpGet(MP_API + "/v1/payments/search?" + qs.toString(), token, sb, mlUserId);
    const pageResults: any[] = data?.results ?? [];
    const total: number      = data?.paging?.total ?? 0;

    if (offset === 0) {
      console.log(
        "sync-mp-releases: 1a chamada MP ml_user_id=" + mlUserId +
        " mode=" + win.mode + " total=" + total +
        " begin=" + win.beginDate.substring(0, 10) + " end=" + win.endDate.substring(0, 10),
      );
    }

    const syncedAt = new Date().toISOString();
    const rows: any[] = [];

    for (const p of pageResults) {
      // Só VENDAS reais do Mercado Livre (decisão Wesley 2026-06-18): a venda tem
      // order.type === 'mercadolibre' (mesmo paga via pix/bank_transfer/account_money).
      // Exclui aportes/transferências (cofrinho/rendimento do MP, PSP_TRANSFER) que
      // vêm como regular_payment mas sem order de marketplace — NÃO são receita.
      if (String(p?.order?.type ?? "") !== "mercadolibre") continue;

      const status = String(p?.status ?? "").toLowerCase();
      if (!VALID_STATUSES.includes(status)) continue;

      const releaseDate = String(p?.money_release_date ?? "").substring(0, 10);
      if (!releaseDate) continue;

      let net = Number(p?.transaction_details?.net_received_amount ?? 0);
      if (status === "refunded") net = -Math.abs(net);

      rows.push({
        organization_id: orgId,
        ml_user_id:      Number(mlUserId),
        payment_id:      String(p.id),
        release_date:    releaseDate,
        net_amount:      net,
        gross_amount:    p?.transaction_amount ?? null,
        status_mp:       p?.status ?? null,
        payment_method:  p?.payment_method_id ?? null,
        description:     p?.description ?? null,
        synced_at:       syncedAt,
      });
    }

    if (rows.length > 0) {
      const { error } = await sb
        .from("cash_inflows")
        .upsert(rows, { onConflict: "organization_id,payment_id" });
      if (error) throw new Error("cash_inflows upsert org=" + orgId + ": " + error.message);
      upserted += rows.length;
    }

    offset += pageResults.length;
    if (pageResults.length < 100 || offset >= total) break;
    await new Promise(r => setTimeout(r, 150)); // rate limit gentil entre páginas
  }

  return upserted;
}

async function syncOrg(
  sb: ReturnType<typeof createClient>,
  row: { ml_user_id: string; organization_id: string; seller_id: string | null },
  daysBack:   number,
  daysAhead:  number,
): Promise<{ org_id: string; upserted: number }> {
  const { ml_user_id: mlUserId, organization_id: orgId } = row;

  let token: string;
  try {
    token = await getAccessToken(sb, mlUserId);
  } catch (e: any) {
    throw new Error("Token error ml_user_id=" + mlUserId + ": " + e.message);
  }

  const today = todayStr();
  let upserted = 0;

  // (a) Histórica: hoje-N até hoje
  try {
    upserted += await processWindow(sb, mlUserId, orgId, token, {
      beginDate: toBrtIso(addDays(today, -daysBack), "start"),
      endDate:   toBrtIso(today, "end"),
      mode:      "historical",
    });
  } catch (e: any) {
    console.warn("sync-mp-releases: erro janela histórica ml_user_id=" + mlUserId + ": " + e.message);
  }

  // (b) Futura: amanhã até hoje+daysAhead (só quando daysAhead > 0)
  if (daysAhead > 0) {
    try {
      upserted += await processWindow(sb, mlUserId, orgId, token, {
        beginDate: toBrtIso(addDays(today, 1), "start"),
        endDate:   toBrtIso(addDays(today, daysAhead), "end"),
        mode:      "future",
      });
    } catch (e: any) {
      console.warn("sync-mp-releases: erro janela futura ml_user_id=" + mlUserId + ": " + e.message);
    }
  }

  console.log("sync-mp-releases: org=" + orgId + " ml_user_id=" + mlUserId + " upserted=" + upserted);
  return { org_id: orgId, upserted };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const guard = requireServiceRole(req);
  if (guard) return guard;

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    let body: any = {};
    try { body = await req.json(); } catch { /* sem body */ }

    const daysBack  = Number(body.days_back  ?? 30);
    const daysAhead = Number(body.days_ahead ?? 45);

    const { data: tokenRows, error: tokErr } = await sb
      .from("ml_tokens")
      .select("ml_user_id,organization_id,seller_id")
      .not("refresh_token", "is", null);

    if (tokErr) return json({ ok: false, error: tokErr.message }, 500);
    if (!tokenRows || tokenRows.length === 0) {
      return json({ ok: true, msg: "no active users" });
    }

    const results: any[] = [];
    for (const row of tokenRows) {
      try {
        const result = await syncOrg(sb, row, daysBack, daysAhead);
        results.push({ ml_user_id: row.ml_user_id, ...result });
      } catch (e: any) {
        console.error("sync-mp-releases ml_user_id=" + row.ml_user_id + " error:", e.message);
        results.push({ ml_user_id: row.ml_user_id, error: e.message });
      }
    }

    return json({ ok: true, days_back: daysBack, days_ahead: daysAhead, results });

  } catch (err: any) {
    console.error("sync-mp-releases error:", err);
    return json({ ok: false, error: err.message }, 500);
  }
});
