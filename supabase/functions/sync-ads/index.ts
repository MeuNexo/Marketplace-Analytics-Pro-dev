/**
 * sync-ads — scheduled edge function
 * Runs daily to sync ML Ads (PADS) data for all active sellers.
 * Writes to: ml_ads_daily_cache, ml_ads_products_cache, ml_ads_campaigns_cache
 *
 * Called by Supabase cron or pg_cron. Uses service role key.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ML_API       = "https://api.mercadolibre.com";
const METRICS      = "prints,clicks,ctr,cvr,acos,roas,cpc,cost,units_quantity,direct_amount,indirect_amount,total_amount";

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
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!svcKey) return null; // no key configured — skip guard in local dev
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== "Bearer " + svcKey) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  return null;
}

// ── Token helpers ─────────────────────────────────────────────────────────────

async function getMlToken(sb: any, sellerId: string): Promise<string> {
  const { data: tok, error } = await sb.rpc("get_seller_token", { p_seller_id: sellerId });
  if (error || !tok) throw new Error("get_seller_token: " + (error?.message ?? "no data"));

  const now = Date.now() / 1000;
  if (tok.ml_access_token && tok.ml_expires_at && (tok.ml_expires_at - now) > 300) {
    return tok.ml_access_token;
  }
  if (!tok.ml_refresh_token) throw new Error("No refresh token for seller " + sellerId);

  const { data: creds } = await sb.rpc("get_seller_api_credentials", { p_seller_id: sellerId });
  if (!creds?.ml_client_id || !creds?.ml_client_secret) throw new Error("No ML credentials for seller " + sellerId);

  const resp = await fetch(ML_API + "/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      client_id:     creds.ml_client_id,
      client_secret: creds.ml_client_secret,
      refresh_token: tok.ml_refresh_token,
    }),
  });
  if (!resp.ok) throw new Error("Token refresh " + resp.status + " for seller " + sellerId);

  const data = await resp.json();
  await sb.rpc("set_seller_ml_tokens", {
    p_seller_id: sellerId,
    p_access:    data.access_token,
    p_refresh:   data.refresh_token ?? tok.ml_refresh_token,
    p_expires:   now + (data.expires_in || 21600),
  });
  return data.access_token;
}

// ── ML API helpers ────────────────────────────────────────────────────────────

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

// ── Per-seller sync ───────────────────────────────────────────────────────────

async function syncSeller(
  sb: any,
  sellerId: string,
  dateFrom: string,
  dateTo: string,
): Promise<{ days: number; items: number; camps: number }> {
  const token = await getMlToken(sb, sellerId);

  // Resolve ml_user_id and org from ml_tokens
  const { data: tokenRow } = await sb
    .from("ml_tokens")
    .select("ml_user_id,user_id,organization_id")
    .eq("seller_id", sellerId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!tokenRow?.ml_user_id) throw new Error("No ml_tokens row for seller " + sellerId);

  const mlUserId = String(tokenRow.ml_user_id);
  const userId   = tokenRow.user_id   as string;
  const orgId    = tokenRow.organization_id as string;

  // Get advertiser_id
  const advData      = await mlGet(ML_API + "/advertising/advertisers?product_id=PADS", token);
  const advertiserId = advData?.advertisers?.[0]?.advertiser_id;
  if (!advertiserId) throw new Error("No advertiser_id for seller " + sellerId);

  const syncedAt = new Date().toISOString();
  const days     = daysBetween(dateFrom, dateTo);

  // dailyAgg: date → totals
  const dailyAgg = new Map<string, { impressions: number; clicks: number; spend: number; revenue: number; orders: number }>();
  // itemDayAgg: "date|item_id" → per-product per-day totals
  type ItemMetrics = { title: string; thumbnail: string | null; impressions: number; clicks: number; spend: number; revenue: number; orders: number };
  const itemDayAgg = new Map<string, ItemMetrics>();

  for (const day of days) {
    let offset = 0;
    while (true) {
      const qs = new URLSearchParams({
        date_from: day, date_to: day,
        metrics: METRICS, metrics_summary: "true",
        limit: "50", offset: String(offset),
      });
      let items: any[] = [], total = 0;
      try {
        const data = await mlGet(
          ML_API + "/advertising/advertisers/" + advertiserId + "/product_ads/items?" + qs,
          token,
        );
        items = data?.results ?? data?.items ?? [];
        total = data?.paging?.total ?? items.length;
      } catch (e) {
        console.warn("sync-ads seller=" + sellerId + " day=" + day, String(e).slice(0, 80));
        break;
      }

      for (const it of items) {
        const p   = Number(it.prints        ?? 0);
        const cl  = Number(it.clicks        ?? 0);
        const sp  = Number(it.cost          ?? 0);
        const rev = Number(it.total_amount  ?? 0);
        const ord = Number(it.units_quantity ?? 0);

        // Daily totals
        const d = dailyAgg.get(day) ?? { impressions: 0, clicks: 0, spend: 0, revenue: 0, orders: 0 };
        d.impressions += p; d.clicks += cl; d.spend += sp; d.revenue += rev; d.orders += ord;
        dailyAgg.set(day, d);

        // Per-product per-day (keyed by "date|item_id")
        if (it.item_id) {
          const key = day + "|" + String(it.item_id);
          const x = itemDayAgg.get(key) ?? { title: it.title ?? "", thumbnail: it.thumbnail ?? null, impressions: 0, clicks: 0, spend: 0, revenue: 0, orders: 0 };
          x.impressions += p; x.clicks += cl; x.spend += sp; x.revenue += rev; x.orders += ord;
          itemDayAgg.set(key, x);
        }
      }
      offset += items.length;
      if (items.length === 0 || offset >= total) break;
    }
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

  // Upsert per-product per-day rows (série histórica)
  const productRows = Array.from(itemDayAgg.entries())
    .map(([key, d]) => {
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

  return { days: dailyRows.length, items: productRows.length, camps: allCamps.length };
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const guard = requireServiceRole(req);
  if (guard) return guard;

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    // Body may override date range (default: today only)
    let body: any = {};
    try { body = await req.json(); } catch { /* no body */ }
    const dateFrom = body.date_from ?? todayStr();
    const dateTo   = body.date_to   ?? todayStr();

    // Get all active sellers
    const { data: sellersRaw } = await sb.rpc("get_active_sellers");
    const sellers: string[] = (sellersRaw ?? []).map((s: any) =>
      typeof s === "string" ? s : s.get_active_sellers,
    );

    if (!sellers.length) {
      return json({ ok: true, msg: "no active sellers" });
    }

    const results: any[] = [];
    for (const sellerId of sellers) {
      try {
        const counts = await syncSeller(sb, sellerId, dateFrom, dateTo);
        results.push({ seller_id: sellerId, ...counts });
      } catch (e: any) {
        console.error("sync-ads seller=" + sellerId + " error:", e.message);
        results.push({ seller_id: sellerId, error: e.message });
      }
    }

    return json({ ok: true, date_from: dateFrom, date_to: dateTo, results });

  } catch (err: any) {
    console.error("sync-ads error:", err);
    return json({ ok: false, error: err.message }, 500);
  }
});
