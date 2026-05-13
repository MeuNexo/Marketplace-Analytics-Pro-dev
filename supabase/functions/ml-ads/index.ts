import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;
const ML_API       = "https://api.mercadolibre.com";
const METRICS      = "prints,clicks,ctr,cvr,acos,roas,cpc,cost,units_quantity,direct_amount,indirect_amount,total_amount";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

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

function subDaysStr(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().substring(0, 10);
}

function todayStr(): string { return new Date().toISOString().substring(0, 10); }
function round2(n: number)  { return Math.round(n * 100) / 100; }

function metricsArrayToObject(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value)) return null;

  const entries = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const key = String((entry as Record<string, unknown>).key ?? (entry as Record<string, unknown>).name ?? (entry as Record<string, unknown>).metric ?? "").trim();
      const rawValue = (entry as Record<string, unknown>).value
        ?? (entry as Record<string, unknown>).amount
        ?? (entry as Record<string, unknown>).metric_value
        ?? (entry as Record<string, unknown>).total;
      return key ? [key, rawValue] as const : null;
    })
    .filter((entry): entry is readonly [string, unknown] => Boolean(entry));

  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function normalizeMetrics(item: Record<string, unknown>) {
  return metricsArrayToObject(item.metrics_summary)
    ?? (item.metrics_summary && typeof item.metrics_summary === "object" && !Array.isArray(item.metrics_summary) ? item.metrics_summary as Record<string, unknown> : null)
    ?? metricsArrayToObject(item.metrics)
    ?? (item.metrics && typeof item.metrics === "object" && !Array.isArray(item.metrics) ? item.metrics as Record<string, unknown> : null)
    ?? item;
}

// ── ML token retrieval ────────────────────────────────────────────────────────

async function getAccessToken(admin: any, mlUserId: string): Promise<string> {
  const ML_APP_ID       = Deno.env.get("ML_APP_ID")!;
  const ML_CLIENT_SECRET = Deno.env.get("ML_CLIENT_SECRET")!;

  const { data: row } = await admin
    .from("ml_tokens")
    .select("access_token,refresh_token,expires_at")
    .eq("ml_user_id", mlUserId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) throw new Error("No ML token for ml_user_id=" + mlUserId);

  // Se o token ainda é válido (com 5min de margem), retorna direto
  const expiresTs = row.expires_at ? new Date(row.expires_at).getTime() / 1000 : 0;
  const now = Date.now() / 1000;
  if (row.access_token && expiresTs - now > 300) {
    return row.access_token;
  }

  if (!row.refresh_token) throw new Error("No refresh token available for ml_user_id=" + mlUserId);

  // Renova usando as credenciais do app (env vars)
  const resp = await fetch(ML_API + "/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type:    "refresh_token",
      client_id:     ML_APP_ID,
      client_secret: ML_CLIENT_SECRET,
      refresh_token: row.refresh_token,
    }),
  });
  if (!resp.ok) throw new Error("Token refresh failed: " + resp.status);

  const data = await resp.json();
  const newExpiresAt = new Date(Date.now() + (data.expires_in || 21600) * 1000).toISOString();

  await admin
    .from("ml_tokens")
    .update({
      access_token:  data.access_token,
      refresh_token: data.refresh_token ?? row.refresh_token,
      expires_at:    newExpiresAt,
    })
    .eq("ml_user_id", mlUserId);

  return data.access_token;
}

// ── ML API fetch with retry ───────────────────────────────────────────────────

async function mlGet(url: string, token: string): Promise<any> {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, {
      headers: { Authorization: "Bearer " + token, "api-version": "2" },
    });
    if (res.ok) return res.json();
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }
    if (i < 2 && [500, 502, 503, 504].includes(res.status)) {
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      continue;
    }
    throw new Error("ML " + res.status + " " + url.split("?")[0]);
  }
  throw new Error("ML API retries exhausted");
}

// ── Sync: fetch from ML Ads API and write to cache tables ─────────────────────

async function syncAds(
  admin: any,
  userId: string,
  mlUserId: string,
  sellerId: string | null,
  orgId: string,
  dateFrom: string,
  dateTo: string,
): Promise<void> {
  const token = await getAccessToken(admin, mlUserId);

  // 1. Get advertiser_id for Product Ads (PADS)
  const advData      = await mlGet(ML_API + "/advertising/advertisers?product_id=PADS", token);
  const advertiserId = advData?.advertisers?.[0]?.advertiser_id;
  if (!advertiserId) throw new Error("No advertiser_id — PADS may not be enabled for this account");

  const syncedAt = new Date().toISOString();
  const days     = daysBetween(dateFrom, dateTo);

  const dailyAgg = new Map<string, { impressions: number; clicks: number; spend: number; revenue: number; orders: number }>();
  const itemAgg  = new Map<string, { title: string; thumbnail: string | null; impressions: number; clicks: number; spend: number; revenue: number; orders: number }>();

  // 2. Per-day item metrics (paginated)
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
        console.warn("ml-ads day=" + day + " skip:", String(e).slice(0, 80));
        break;
      }

      for (const it of items) {
        // ML Ads v2 API may return metrics flat on item, nested as an object,
        // or as an array of { key, value } entries. Support all shapes.
        const m = normalizeMetrics(it);
        const p   = Number(m.prints        ?? m.impressions    ?? 0);
        const cl  = Number(m.clicks        ?? 0);
        const sp  = Number(m.cost          ?? m.spend          ?? 0);
        const rev = Number(m.total_amount  ?? m.direct_amount  ?? 0);
        const ord = Number(m.units_quantity ?? m.direct_units_quantity ?? 0);

        if (offset === 0 && day === days[0] && itemAgg.size === 0) {
          console.log("ml-ads sample item keys:", Object.keys(it).join(","), "| metrics:", JSON.stringify(m).slice(0, 300));
        }

        const d = dailyAgg.get(day) ?? { impressions: 0, clicks: 0, spend: 0, revenue: 0, orders: 0 };
        d.impressions += p; d.clicks += cl; d.spend += sp; d.revenue += rev; d.orders += ord;
        dailyAgg.set(day, d);

        if (it.item_id) {
          const k = String(it.item_id);
          const x = itemAgg.get(k) ?? { title: it.title ?? "", thumbnail: it.thumbnail ?? null, impressions: 0, clicks: 0, spend: 0, revenue: 0, orders: 0 };
          x.impressions += p; x.clicks += cl; x.spend += sp; x.revenue += rev; x.orders += ord;
          itemAgg.set(k, x);
        }
      }

      offset += items.length;
      if (items.length === 0 || offset >= total) break;
    }
  }

  // 3. Upsert ml_ads_daily_cache
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
    const { error } = await admin
      .from("ml_ads_daily_cache")
      .upsert(dailyRows, { onConflict: "user_id,ml_user_id,date" });
    if (error) console.error("ml-ads daily upsert:", error.message);
  }

  // 4. Replace ml_ads_products_cache (delete + insert for this store)
  const productRows = Array.from(itemAgg.entries())
    .sort((a, b) => b[1].spend - a[1].spend)
    .slice(0, 100)
    .map(([itemId, d]) => ({
      user_id: userId, organization_id: orgId, ml_user_id: mlUserId, seller_id: sellerId,
      item_id: itemId, title: d.title, thumbnail: d.thumbnail,
      impressions: d.impressions, clicks: d.clicks,
      spend: round2(d.spend), attributed_revenue: round2(d.revenue), attributed_orders: d.orders,
      ctr:  d.impressions > 0 ? round2(d.clicks  / d.impressions * 100) : 0,
      cpc:  d.clicks      > 0 ? round2(d.spend   / d.clicks)            : 0,
      roas: d.spend       > 0 ? round2(d.revenue / d.spend)             : 0,
      synced_at: syncedAt,
    }));
  if (productRows.length > 0) {
    await admin.from("ml_ads_products_cache").delete().eq("ml_user_id", mlUserId);
    await admin.from("ml_ads_products_cache").insert(productRows);
  }

  // 5. Campaigns (paginated)
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
    await admin.from("ml_ads_campaigns_cache").delete().eq("ml_user_id", mlUserId);
    await admin.from("ml_ads_campaigns_cache").insert(campRows);
  }

  console.log("ml-ads sync done: days=" + dailyRows.length + " items=" + productRows.length + " camps=" + allCamps.length);
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const admin    = createClient(SUPABASE_URL, SERVICE_KEY);
    const url      = new URL(req.url);
    const mlUserId = url.searchParams.get("ml_user_id");
    const dateFrom = url.searchParams.get("date_from") ?? subDaysStr(29);
    const dateTo   = url.searchParams.get("date_to")   ?? todayStr();
    const force    = url.searchParams.get("force") === "true";

    if (!mlUserId) return json({ error: "ml_user_id required" }, 400);

    // Lookup token row (service role reads org + seller info)
    const { data: tokenRow } = await admin
      .from("ml_tokens")
      .select("seller_id,organization_id,user_id")
      .eq("ml_user_id", mlUserId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!tokenRow) {
      return json({ adsAvailable: false, daily: [], campaigns: [], products: [] });
    }

    const { seller_id, organization_id: orgId, user_id: tokenUserId } = tokenRow;

    // Access check: caller must be org member (or token owner for legacy)
    if (orgId) {
      const { data: isMember } = await admin.rpc("is_org_member", { _user_id: user.id, _org_id: orgId });
      if (!isMember) return json({ error: "Forbidden" }, 403);
    } else if (user.id !== tokenUserId) {
      return json({ error: "Forbidden" }, 403);
    }

    // Check cache freshness
    const { data: latestDaily } = await admin
      .from("ml_ads_daily_cache")
      .select("synced_at")
      .eq("ml_user_id", mlUserId)
      .order("synced_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const cacheAgeMs = latestDaily
      ? Date.now() - new Date(latestDaily.synced_at).getTime()
      : Infinity;

    if (force || cacheAgeMs > CACHE_TTL_MS) {
      try {
        const maxFrom       = subDaysStr(29);
        const effectiveFrom = dateFrom < maxFrom ? maxFrom : dateFrom;
        await syncAds(admin, user.id, mlUserId, seller_id, orgId, effectiveFrom, dateTo);
      } catch (e: any) {
        console.error("ml-ads sync failed:", e.message);
        // Continue — return whatever is already in cache
      }
    }

    // Read from cache tables
    const [dailyRes, campaignsRes, productsRes] = await Promise.all([
      admin
        .from("ml_ads_daily_cache")
        .select("date,impressions,clicks,spend,attributed_revenue,attributed_orders,cpc,ctr,roas")
        .eq("ml_user_id", mlUserId)
        .gte("date", dateFrom)
        .lte("date", dateTo)
        .order("date", { ascending: true }),

      admin
        .from("ml_ads_campaigns_cache")
        .select("campaign_id,name,status,daily_budget,impressions,clicks,spend,attributed_revenue,attributed_orders,cpc,ctr,roas")
        .eq("ml_user_id", mlUserId)
        .order("spend", { ascending: false }),

      admin
        .from("ml_ads_products_cache")
        .select("item_id,title,thumbnail,impressions,clicks,spend,attributed_revenue,attributed_orders,cpc,ctr,roas")
        .eq("ml_user_id", mlUserId)
        .order("spend", { ascending: false })
        .limit(50),
    ]);

    const daily = (dailyRes.data ?? []).map((r: any) => ({
      date: r.date, impressions: r.impressions, clicks: r.clicks,
      spend: r.spend, attributed_revenue: r.attributed_revenue, attributed_orders: r.attributed_orders,
      cpc: r.cpc, ctr: r.ctr, roas: r.roas,
    }));

    const campaigns = (campaignsRes.data ?? []).map((r: any) => ({
      id: r.campaign_id, name: r.name, status: r.status, daily_budget: r.daily_budget,
      impressions: r.impressions, clicks: r.clicks, spend: r.spend,
      attributed_revenue: r.attributed_revenue, attributed_orders: r.attributed_orders,
      cpc: r.cpc, ctr: r.ctr, roas: r.roas,
    }));

    const products = (productsRes.data ?? []).map((r: any) => ({
      item_id: r.item_id, title: r.title, thumbnail: r.thumbnail,
      impressions: r.impressions, clicks: r.clicks, spend: r.spend,
      attributed_revenue: r.attributed_revenue, attributed_orders: r.attributed_orders,
      cpc: r.cpc, ctr: r.ctr, roas: r.roas,
    }));

    return json({
      adsAvailable: daily.length > 0 || campaigns.length > 0,
      daily,
      campaigns,
      products,
    });

  } catch (err: any) {
    console.error("ml-ads error:", err);
    return json({ error: err.message }, 500);
  }
});
