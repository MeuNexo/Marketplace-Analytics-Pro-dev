/**
 * sync-ads — scheduled edge function
 * Runs via queue (process-sync-job) to sync ML Ads (PADS) data for all active sellers.
 * Writes to: ml_ads_daily_cache, ml_ads_products_cache (por dia), ml_ads_campaigns_cache
 *
 * Schema deste projeto: ml_tokens com access_token/refresh_token diretos.
 * Credenciais ML: env vars ML_APP_ID + ML_CLIENT_SECRET.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL      = (Deno.env.get("SUPABASE_URL") ?? "").trim();
const SERVICE_KEY       = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
const ML_APP_ID         = Deno.env.get("ML_APP_ID") ?? "";
const ML_CLIENT_SECRET  = Deno.env.get("ML_CLIENT_SECRET") ?? "";
const ML_API            = "https://api.mercadolibre.com";
const METRICS           = "prints,clicks,ctr,cvr,acos,roas,cpc,cost,units_quantity,direct_amount,indirect_amount,total_amount";

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

function todayStr(): string { return new Date().toISOString().substring(0, 10); }
function round2(n: number)  { return Math.round(n * 100) / 100; }

function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  const cur = new Date(from + "T00:00:00Z");
  const end = new Date(to   + "T00:00:00Z");
  while (cur <= end) {
    days.push(cur.toISOString().substring(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

// ── Auth guard: only service role may invoke ──────────────────────────────────

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

// ── Token helpers (same pattern as ml-ads) ────────────────────────────────────

async function getAccessToken(sb: any, mlUserId: string): Promise<string> {
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

// ── Normalize nested metrics (same as ml-ads) ────────────────────────────────

function metricsArrayToObject(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value)) return null;
  const entries = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const e = entry as Record<string, unknown>;
      const key = String(e.key ?? e.name ?? e.metric ?? "").trim();
      const val = e.value ?? e.amount ?? e.metric_value ?? e.total;
      return key ? [key, val] as const : null;
    })
    .filter((x): x is readonly [string, unknown] => Boolean(x));
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function normalizeMetrics(item: Record<string, unknown>): Record<string, unknown> {
  return metricsArrayToObject(item.metrics_summary)
    ?? (item.metrics_summary && typeof item.metrics_summary === "object" && !Array.isArray(item.metrics_summary) ? item.metrics_summary as Record<string, unknown> : null)
    ?? metricsArrayToObject(item.metrics)
    ?? (item.metrics && typeof item.metrics === "object" && !Array.isArray(item.metrics) ? item.metrics as Record<string, unknown> : null)
    ?? item;
}

// ── ML API fetch with retry ───────────────────────────────────────────────────

async function mlGet(url: string, token: string): Promise<any> {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, {
      headers: { Authorization: "Bearer " + token, "api-version": "2" },
    });
    if (res.ok) return res.json();
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? "2");
      await new Promise(r => setTimeout(r, (wait || 2) * 1000));
      continue;
    }
    if (i < 2 && [500, 502, 503, 504].includes(res.status)) {
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      continue;
    }
    throw new Error("ML " + res.status + " " + url.split("?")[0]);
  }
  throw new Error("ML retries exhausted");
}

// ── Per-user sync ─────────────────────────────────────────────────────────────

async function syncUser(
  sb: any,
  row: { ml_user_id: string; user_id: string; organization_id: string; seller_id: string | null },
  dateFrom: string,
  dateTo:   string,
): Promise<{ days: number; items: number; camps: number }> {
  const { ml_user_id: mlUserId, user_id: userId, organization_id: orgId, seller_id: sellerId } = row;

  const token       = await getAccessToken(sb, mlUserId);
  const advData     = await mlGet(ML_API + "/advertising/advertisers?product_id=PADS", token);
  const advertiserId = advData?.advertisers?.[0]?.advertiser_id;
  if (!advertiserId) throw new Error("No advertiser_id for ml_user_id=" + mlUserId);

  const syncedAt = new Date().toISOString();

  // Limpa dados existentes do período para evitar stale spend de syncs anteriores
  await sb.from("ml_ads_products_cache").delete().eq("ml_user_id", mlUserId).gte("date", dateFrom).lte("date", dateTo);
  await sb.from("ml_ads_daily_cache").delete().eq("ml_user_id", mlUserId).gte("date", dateFrom).lte("date", dateTo);

  // dailyAgg: date → totals (derivado dos itens por produto)
  const dailyAgg = new Map<string, { impressions: number; clicks: number; spend: number; revenue: number; orders: number }>();
  // itemDayAgg: "date|item_id" → per-product totals para dateFrom (dia do job)
  type ItemMetrics = { title: string; thumbnail: string | null; impressions: number; clicks: number; spend: number; revenue: number; orders: number };
  const itemDayAgg = new Map<string, ItemMetrics>();

  // Endpoint antigo: retorna métricas acumuladas do dia corrente por produto (sem filtro de data nas métricas).
  // Gravar tudo com date = dateFrom (o dia do job). Não iterar por dia — uma única chamada sem date params.
  const today = dateFrom;
  let offset = 0;
  let loggedFirstResult = false;
  while (true) {
    let items: any[] = [], total = 0;
    try {
      const data = await mlGet(
        ML_API + "/advertising/advertisers/" + advertiserId + "/product_ads/items?limit=50&offset=" + offset,
        token,
      );
      if (!loggedFirstResult) {
        console.log("sync-ads first response sample:", JSON.stringify(data).slice(0, 400));
        loggedFirstResult = true;
      }
      items = data?.results ?? data?.ads ?? data?.items ?? [];
      total = data?.paging?.total ?? items.length;
    } catch (e) {
      console.warn("sync-ads ml_user_id=" + mlUserId, String(e).slice(0, 120));
      break;
    }

    for (const it of items) {
      const m = normalizeMetrics(it as Record<string, unknown>);
      const p   = Number(m.prints        ?? m.impressions    ?? 0);
      const cl  = Number(m.clicks        ?? 0);
      const sp  = Number(m.cost          ?? m.spend          ?? 0);
      const rev = Number(m.total_amount  ?? m.direct_amount  ?? m.attributed_revenue ?? 0);
      const ord = Number(m.units_quantity ?? m.direct_units_quantity ?? m.orders ?? 0);
      const itemId = (it as any).item_id ?? (it as any).ad_id ?? (it as any).id;

      const d = dailyAgg.get(today) ?? { impressions: 0, clicks: 0, spend: 0, revenue: 0, orders: 0 };
      d.impressions += p; d.clicks += cl; d.spend += sp; d.revenue += rev; d.orders += ord;
      dailyAgg.set(today, d);

      if (itemId) {
        const key = today + "|" + String(itemId);
        const x   = itemDayAgg.get(key) ?? { title: it.title ?? "", thumbnail: it.thumbnail ?? null, impressions: 0, clicks: 0, spend: 0, revenue: 0, orders: 0 };
        x.impressions += p; x.clicks += cl; x.spend += sp; x.revenue += rev; x.orders += ord;
        itemDayAgg.set(key, x);
      }
    }
    offset += items.length;
    if (items.length === 0 || offset >= total) break;
  }

  // Upsert daily totals
  const dailyRows = Array.from(dailyAgg.entries()).map(([date, d]) => ({
    user_id: userId, organization_id: orgId, ml_user_id: mlUserId, seller_id: sellerId, date,
    impressions: d.impressions, clicks: d.clicks,
    spend: round2(d.spend), attributed_revenue: round2(d.revenue), attributed_orders: d.orders,
    ctr:  d.impressions > 0 ? round2(d.clicks  / d.impressions * 100) : 0,
    cpc:  d.clicks      > 0 ? round2(d.spend   / d.clicks)            : 0,
    roas: d.spend       > 0 ? round2(d.revenue / d.spend)             : 0,
    synced_at: syncedAt,
  }));
  if (dailyRows.length > 0) {
    const { error } = await sb
      .from("ml_ads_daily_cache")
      .upsert(dailyRows, { onConflict: "user_id,ml_user_id,date" });
    if (error) console.error("sync-ads daily upsert:", error.message);
  }

  // Upsert per-product per-day rows (série histórica com coluna date)
  const productRows = Array.from(itemDayAgg.entries()).map(([key, d]) => {
    const [date, itemId] = key.split("|");
    return {
      user_id: userId, organization_id: orgId, ml_user_id: mlUserId, seller_id: sellerId,
      item_id: itemId, date, title: d.title, thumbnail: d.thumbnail,
      impressions: d.impressions, clicks: d.clicks,
      spend: round2(d.spend), attributed_revenue: round2(d.revenue), attributed_orders: d.orders,
      ctr:  d.impressions > 0 ? round2(d.clicks  / d.impressions * 100) : 0,
      cpc:  d.clicks      > 0 ? round2(d.spend   / d.clicks)            : 0,
      roas: d.spend       > 0 ? round2(d.revenue / d.spend)             : 0,
      synced_at: syncedAt,
    };
  });
  if (productRows.length > 0) {
    const { error } = await sb
      .from("ml_ads_products_cache")
      .upsert(productRows, { onConflict: "organization_id,ml_user_id,item_id,date" });
    if (error) console.error("sync-ads products upsert:", error.message);
  }

  // Campaigns
  const allCamps: any[] = [];
  let campOff = 0;
  while (true) {
    let camps: any[] = [], total = 0;
    try {
      const data = await mlGet(
        ML_API + "/advertising/advertisers/" + advertiserId + "/product_ads/campaigns?limit=50&offset=" + campOff,
        token,
      );
      camps = data?.campaigns ?? data?.results ?? [];
      total = data?.paging?.total ?? camps.length;
    } catch { break; }
    allCamps.push(...camps);
    campOff += camps.length;
    if (camps.length === 0 || campOff >= total) break;
  }
  if (allCamps.length > 0) {
    const campRows = allCamps.map((c: any) => ({
      user_id: userId, organization_id: orgId, ml_user_id: mlUserId, seller_id: sellerId,
      campaign_id:  String(c.id ?? c.campaign_id ?? ""),
      name:         c.name ?? "",
      status:       (c.status ?? "unknown").toLowerCase(),
      daily_budget: Number(c.budget_amount ?? c.daily_budget ?? 0),
      impressions: 0, clicks: 0, spend: 0, attributed_revenue: 0, attributed_orders: 0,
      ctr: 0, cpc: 0, roas: 0,
      synced_at: syncedAt,
    }));
    await sb.from("ml_ads_campaigns_cache").delete().eq("ml_user_id", mlUserId);
    await sb.from("ml_ads_campaigns_cache").insert(campRows);
  }

  console.log("sync-ads done ml_user_id=" + mlUserId + ": days=" + dailyRows.length + " items=" + productRows.length + " camps=" + allCamps.length);
  return { days: dailyRows.length, items: productRows.length, camps: allCamps.length };
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const guard = requireServiceRole(req);
  if (guard) return guard;

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    let body: any = {};
    try { body = await req.json(); } catch { /* no body */ }
    const dateFrom = body.date_from ?? todayStr();
    const dateTo   = body.date_to   ?? todayStr();

    // Busca todos os ml_user_ids com refresh_token (usuários ativos)
    const { data: tokenRows, error: tokErr } = await sb
      .from("ml_tokens")
      .select("ml_user_id,user_id,organization_id,seller_id")
      .not("refresh_token", "is", null);

    if (tokErr) return json({ ok: false, error: tokErr.message }, 500);
    if (!tokenRows || tokenRows.length === 0) return json({ ok: true, msg: "no active users" });

    const results: any[] = [];
    for (const row of tokenRows) {
      try {
        const counts = await syncUser(sb, row, dateFrom, dateTo);
        results.push({ ml_user_id: row.ml_user_id, ...counts });
      } catch (e: any) {
        console.error("sync-ads ml_user_id=" + row.ml_user_id + " error:", e.message);
        results.push({ ml_user_id: row.ml_user_id, error: e.message });
      }
    }

    return json({ ok: true, date_from: dateFrom, date_to: dateTo, results });

  } catch (err: any) {
    console.error("sync-ads error:", err);
    return json({ ok: false, error: err.message }, 500);
  }
});
