import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;
const ML_API       = "https://api.mercadolibre.com";
const METRICS      = "prints,clicks,ctr,cvr,acos,roas,cpc,cost,units_quantity,direct_amount,indirect_amount,total_amount";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

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
  const ML_APP_ID        = Deno.env.get("ML_APP_ID")!;
  const ML_CLIENT_SECRET = Deno.env.get("ML_CLIENT_SECRET")!;

  const { data: row } = await admin
    .from("ml_tokens")
    .select("access_token,refresh_token,expires_at")
    .eq("ml_user_id", mlUserId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) throw new Error("No ML token for ml_user_id=" + mlUserId);

  const expiresTs = row.expires_at ? new Date(row.expires_at).getTime() / 1000 : 0;
  const now = Date.now() / 1000;
  if (row.access_token && expiresTs - now > 300) return row.access_token;

  if (!row.refresh_token) throw new Error("No refresh token available for ml_user_id=" + mlUserId);

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

type DayItemMetrics = {
  date: string;
  title: string;
  thumbnail: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  revenue: number;
  orders: number;
};

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

  const advData      = await mlGet(ML_API + "/advertising/advertisers?product_id=PADS", token);
  const advertiserId = advData?.advertisers?.[0]?.advertiser_id;
  if (!advertiserId) throw new Error("No advertiser_id — PADS may not be enabled for this account");

  const syncedAt = new Date().toISOString();
  const days     = daysBetween(dateFrom, dateTo);

  // dailyAgg: date → totais do dia
  const dailyAgg = new Map<string, { impressions: number; clicks: number; spend: number; revenue: number; orders: number }>();
  // itemDayAgg: "date|item_id" → métricas por produto por dia (para useMLProductMargins)
  const itemDayAgg = new Map<string, DayItemMetrics>();

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
        const m = normalizeMetrics(it);
        const p   = Number(m.prints        ?? m.impressions    ?? 0);
        const cl  = Number(m.clicks        ?? 0);
        const sp  = Number(m.cost          ?? m.spend          ?? 0);
        const rev = Number(m.total_amount  ?? m.direct_amount  ?? 0);
        const ord = Number(m.units_quantity ?? m.direct_units_quantity ?? 0);

        if (offset === 0 && day === days[0] && dailyAgg.size === 0) {
          console.log("ml-ads sample item keys:", Object.keys(it).join(","), "| metrics:", JSON.stringify(m).slice(0, 200));
        }

        const d = dailyAgg.get(day) ?? { impressions: 0, clicks: 0, spend: 0, revenue: 0, orders: 0 };
        d.impressions += p; d.clicks += cl; d.spend += sp; d.revenue += rev; d.orders += ord;
        dailyAgg.set(day, d);

        if (it.item_id) {
          // Chave por dia+item para gravar série histórica por produto
          const dayKey = `${day}|${String(it.item_id)}`;
          const x = itemDayAgg.get(dayKey) ?? {
            date: day, title: it.title ?? "", thumbnail: it.thumbnail ?? null,
            impressions: 0, clicks: 0, spend: 0, revenue: 0, orders: 0,
          };
          x.impressions += p; x.clicks += cl; x.spend += sp; x.revenue += rev; x.orders += ord;
          itemDayAgg.set(dayKey, x);
        }
      }

      offset += items.length;
      if (items.length === 0 || offset >= total) break;
    }
  }

  // Upsert ml_ads_daily_cache (uma linha por dia)
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

  // Upsert ml_ads_products_cache — uma linha por (produto, dia)
  // Isso permite que useMLProductMargins filtre por período e some spend corretamente
  const productRows = Array.from(itemDayAgg.entries()).map(([key, d]) => {
    const sepIdx = key.indexOf("|");
    const date   = key.slice(0, sepIdx);
    const itemId = key.slice(sepIdx + 1);
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
    const { error } = await admin
      .from("ml_ads_products_cache")
      .upsert(productRows, { onConflict: "organization_id,ml_user_id,item_id,date" });
    if (error) console.error("ml-ads products upsert:", error.message);
  }

  // Campaigns (paginado)
  const allCamps: any[] = [];
  let campOff = 0;
  while (true) {
    let camps: any[] = [], total = 0;
    try {
      const qs = new URLSearchParams({
        date_from: dateFrom, date_to: dateTo,
        metrics: METRICS, metrics_summary: "true",
        limit: "50", offset: String(campOff),
      });
      const data = await mlGet(
        ML_API + "/advertising/advertisers/" + advertiserId + "/product_ads/campaigns?" + qs,
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
    const campRows = allCamps.map((c: any, idx: number) => {
      const m = normalizeMetrics(c);
      const imp = Number(m.prints ?? m.impressions ?? 0);
      const cl  = Number(m.clicks ?? 0);
      const sp  = Number(m.cost ?? m.spend ?? 0);
      const rev = Number(m.total_amount ?? m.direct_amount ?? 0);
      const ord = Number(m.units_quantity ?? m.direct_units_quantity ?? 0);
      if (idx === 0) {
        console.log("ml-ads campaign sample:", Object.keys(c).join(","), "| metrics:", JSON.stringify(m).slice(0, 200));
      }
      return {
        user_id: userId, organization_id: orgId, ml_user_id: mlUserId, seller_id: sellerId,
        campaign_id:  String(c.id ?? c.campaign_id ?? ""),
        name:         c.name ?? "",
        status:       (c.status ?? "unknown").toLowerCase(),
        daily_budget: Number(c.budget_amount ?? c.daily_budget ?? c.budget ?? 0),
        impressions: imp, clicks: cl,
        spend: round2(sp), attributed_revenue: round2(rev), attributed_orders: ord,
        ctr:  imp > 0 ? round2(cl  / imp * 100) : 0,
        cpc:  cl  > 0 ? round2(sp  / cl)        : 0,
        roas: sp  > 0 ? round2(rev / sp)        : 0,
        synced_at: syncedAt,
      };
    });
    await admin.from("ml_ads_campaigns_cache").delete().eq("ml_user_id", mlUserId);
    await admin.from("ml_ads_campaigns_cache").insert(campRows);
  }

  console.log("ml-ads sync done: days=" + dailyRows.length + " products=" + productRows.length + " camps=" + allCamps.length);
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

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const url   = new URL(req.url);

    let body: Record<string, unknown> = {};
    if (req.method !== "GET") {
      try { body = await req.json(); } catch { /* ignore non-JSON */ }
    }
    const mlUserIdRaw = url.searchParams.get("ml_user_id") ?? (body.ml_user_id != null ? String(body.ml_user_id) : null);
    const mlUserId    = mlUserIdRaw || null;
    const dateFrom    = url.searchParams.get("date_from") ?? (body.date_from != null ? String(body.date_from) : subDaysStr(29));
    const dateTo      = url.searchParams.get("date_to")   ?? (body.date_to   != null ? String(body.date_to)   : todayStr());
    const force       = url.searchParams.get("force") === "true" || body.force === true;

    if (!mlUserId) return json({ error: "ml_user_id required" }, 400);

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

    // Verifica acesso: usuário deve ser membro da org
    if (orgId) {
      const { data: isMember } = await admin.rpc("is_org_member", { _user_id: user.id, _org_id: orgId });
      if (!isMember) return json({ error: "Forbidden" }, 403);
    } else if (user.id !== tokenUserId) {
      return json({ error: "Forbidden" }, 403);
    }

    // Verifica freshness do cache
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
        const maxFrom       = subDaysStr(90);
        const effectiveFrom = dateFrom < maxFrom ? maxFrom : dateFrom;
        await syncAds(admin, user.id, mlUserId, seller_id, orgId, effectiveFrom, dateTo);
      } catch (e: any) {
        console.error("ml-ads sync failed:", e.message);
        // Continua — retorna o que está no cache
      }
    }

    // Lê dados do cache com filtro de período
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

      // Lê todas as linhas do período e agrega por item_id no servidor
      admin
        .from("ml_ads_products_cache")
        .select("item_id,title,thumbnail,impressions,clicks,spend,attributed_revenue,attributed_orders")
        .eq("ml_user_id", mlUserId)
        .gte("date", dateFrom)
        .lte("date", dateTo),
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

    // Agrega produtos por item_id (múltiplas linhas/dia → um total por produto)
    const productAgg = new Map<string, any>();
    for (const r of productsRes.data ?? []) {
      const ex = productAgg.get(r.item_id);
      if (ex) {
        ex.impressions        += r.impressions        ?? 0;
        ex.clicks             += r.clicks             ?? 0;
        ex.spend              += r.spend              ?? 0;
        ex.attributed_revenue += r.attributed_revenue ?? 0;
        ex.attributed_orders  += r.attributed_orders  ?? 0;
      } else {
        productAgg.set(r.item_id, { ...r });
      }
    }
    const products = Array.from(productAgg.values())
      .map((p: any) => ({
        item_id: p.item_id, title: p.title, thumbnail: p.thumbnail,
        impressions: p.impressions, clicks: p.clicks,
        spend: round2(p.spend), attributed_revenue: round2(p.attributed_revenue), attributed_orders: p.attributed_orders,
        cpc:  p.clicks > 0      ? round2(p.spend / p.clicks)                  : 0,
        ctr:  p.impressions > 0 ? round2((p.clicks / p.impressions) * 100)    : 0,
        roas: p.spend > 0       ? round2(p.attributed_revenue / p.spend)      : 0,
      }))
      .sort((a: any, b: any) => b.spend - a.spend)
      .slice(0, 50);

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
