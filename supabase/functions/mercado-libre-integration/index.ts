import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ML_API = "https://api.mercadolibre.com";
const BRT_OFFSET_MS = -3 * 60 * 60 * 1000; // UTC-3
const DAY_MS = 24 * 60 * 60 * 1000;

/** Convert an ISO date string to { date: "YYYY-MM-DD", hour: number } in BRT */
function toBRT(isoStr: string): { date: string; hour: number } {
  const utc = new Date(isoStr);
  const brt = new Date(utc.getTime() + BRT_OFFSET_MS);
  return {
    date: brt.toISOString().substring(0, 10),
    hour: brt.getUTCHours(),
  };
}

async function mlFetch(path: string, accessToken: string, timeoutMs = 15_000) {
  const res = await fetch(`${ML_API}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`ML API error [${path}]:`, data);
    throw new Error(data.message || `ML API error: ${res.status}`);
  }
  return data;
}

/**
 * Fetch shipment receiver state for a list of shipment ids.
 * Each call is capped at 6 s; the entire block is capped at 20 s total.
 * Returns whatever was collected within the budget (non-fatal).
 */
async function fetchShipmentStates(
  shipmentIds: string[],
  accessToken: string,
): Promise<Map<string, { uf: string; state_name: string }>> {
  const map = new Map<string, { uf: string; state_name: string }>();
  if (shipmentIds.length === 0) return map;

  // Hard cap: only process the first 150 shipments to avoid excessive API calls
  const ids = shipmentIds.slice(0, 150);

  const CONCURRENCY = 5;
  let cursor = 0;
  const abortController = new AbortController();

  // Total budget: 20 s — after that, abort remaining calls and return partial results
  const budgetTimer = setTimeout(() => {
    console.warn(`fetchShipmentStates: 20 s budget reached, returning ${map.size}/${ids.length} results`);
    abortController.abort();
  }, 20_000);

  const workers = Array.from({ length: Math.min(CONCURRENCY, ids.length) }, async () => {
    while (!abortController.signal.aborted) {
      const idx = cursor++;
      if (idx >= ids.length) return;
      const sid = ids[idx];
      try {
        const res = await fetch(`${ML_API}/shipments/${sid}`, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
          signal: AbortSignal.any([AbortSignal.timeout(6_000), abortController.signal]),
        });
        if (!res.ok) continue;
        const data = await res.json();
        const stateObj = data?.receiver_address?.state;
        const rawId: string | undefined = typeof stateObj === "string" ? stateObj : stateObj?.id;
        const stateName: string =
          (typeof stateObj === "object" && stateObj?.name) ||
          data?.receiver_address?.state_name ||
          "";
        let uf: string | null = null;
        if (rawId && typeof rawId === "string") {
          uf = rawId.includes("-") ? rawId.split("-")[1] : rawId;
          if (uf) uf = uf.trim().toUpperCase().slice(0, 2);
        }
        if (uf && uf.length === 2) {
          map.set(sid, { uf, state_name: stateName });
        }
      } catch (_e) {
        // tolerate per-shipment failures (timeout, PII permissions, deleted, etc.)
      }
    }
  });

  try {
    await Promise.all(workers);
  } finally {
    clearTimeout(budgetTimer);
  }

  console.log(`fetchShipmentStates: resolved ${map.size}/${ids.length} shipments`);
  return map;
}

/**
 * Paginate orders for a given ISO date range.
 * ML API caps offset at 1000; if total > 950 we recursively split the
 * time window in half so every sub-window stays under the limit.
 */
async function fetchOrdersPage(
  sellerId: number,
  dateFrom: string,
  dateTo: string,
  accessToken: string,
): Promise<any[]> {
  const PAGE_SIZE = 50;
  const MAX_OFFSET = 1000;
  let allOrders: any[] = [];
  let offset = 0;
  let apiTotal = 0;

  while (offset < MAX_OFFSET) {
    const url = `/orders/search?seller=${sellerId}&order.date_created.from=${dateFrom}&order.date_created.to=${dateTo}&sort=date_desc&limit=${PAGE_SIZE}&offset=${offset}`;
    const data = await mlFetch(url, accessToken);
    const results = data.results || [];
    allOrders = allOrders.concat(results);
    apiTotal = data.paging?.total || 0;
    offset += PAGE_SIZE;
    if (results.length < PAGE_SIZE || offset >= apiTotal) break;
  }

  // If we hit the offset ceiling and there are more orders, split into two halves
  if (apiTotal > MAX_OFFSET - 50) {
    const fromMs = new Date(dateFrom).getTime();
    const toMs = new Date(dateTo).getTime();
    const diffMs = toMs - fromMs;

    // Don't split if the window is already < 1 hour — accept truncation
    if (diffMs > 60 * 60 * 1000) {
      const midMs = fromMs + Math.floor(diffMs / 2);
      const midIso = new Date(midMs).toISOString();
      // midEnd = 1ms before mid to avoid overlap
      const midEndIso = new Date(midMs - 1).toISOString();

      console.log(
        `⚠️ Splitting range: ${apiTotal} orders in ${dateFrom} → ${dateTo}. ` +
        `Half 1: → ${midEndIso}, Half 2: ${midIso} →`,
      );

      const [half1, half2] = await Promise.all([
        fetchOrdersPage(sellerId, dateFrom, midEndIso, accessToken),
        fetchOrdersPage(sellerId, midIso, dateTo, accessToken),
      ]);
      return [...half1, ...half2];
    } else {
      console.warn(
        `⚠️ TRUNCATION: ${apiTotal} orders in <1h window ${dateFrom} → ${dateTo}. ` +
        `Cannot split further; some orders may be missing.`,
      );
    }
  }

  return allOrders;
}

async function fetchOrdersChunk(
  sellerId: number,
  dateFrom: string,
  dateTo: string,
  accessToken: string,
  _maxOrders = 15000,
): Promise<any[]> {
  return fetchOrdersPage(sellerId, dateFrom, dateTo, accessToken);
}

async function fetchActiveListings(sellerId: number, accessToken: string): Promise<number> {
  try {
    const data = await mlFetch(`/users/${sellerId}/items/search?status=active&limit=0`, accessToken);
    return data.paging?.total || 0;
  } catch {
    return 0;
  }
}

async function fetchVisits(
  sellerId: number,
  dateFrom: string,
  dateTo: string,
  accessToken: string,
): Promise<Record<string, number>> {
  const visitsMap: Record<string, number> = {};
  try {
    const from = new Date(`${dateFrom}T00:00:00.000Z`);
    const to = new Date(`${dateTo}T00:00:00.000Z`);
    const diffMs = to.getTime() - from.getTime();
    // Always fetch at least 2 days — today's visits may not be available yet
    const last = Math.max(2, Math.ceil(diffMs / DAY_MS) + 1);

    // ML API expects ending date in YYYY-MM-DD format
    const endingDate = dateTo || to.toISOString().substring(0, 10);
    if (!endingDate) {
      console.warn("fetchVisits: empty ending date, skipping");
      return visitsMap;
    }

    console.log(`fetchVisits: last=${last} ending=${endingDate}`);

    const data = await mlFetch(
      `/users/${sellerId}/items_visits/time_window?last=${last}&unit=day&ending=${endingDate}`,
      accessToken,
    );

    if (data.results && Array.isArray(data.results)) {
      for (const entry of data.results) {
        if (entry.date && typeof entry.total === "number") {
          visitsMap[entry.date.substring(0, 10)] = entry.total;
        }
      }
    } else {
      console.log("Visits API returned no daily results");
    }
  } catch (err) {
    console.error("Visits API error (non-critical):", err);
  }
  return visitsMap;
}

function countUniqueBuyers(orders: any[]): Record<string, number> {
  const dailyBuyers: Record<string, Set<number>> = {};
  for (const order of orders) {
    const dateCreated = order.date_created || null;
    const date = dateCreated ? toBRT(dateCreated).date : null;
    const buyerId = order.buyer?.id;
    if (date && buyerId) {
      if (!dailyBuyers[date]) dailyBuyers[date] = new Set();
      dailyBuyers[date].add(buyerId);
    }
  }
  const result: Record<string, number> = {};
  for (const [date, buyers] of Object.entries(dailyBuyers)) {
    result[date] = buyers.size;
  }
  return result;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate JWT — access_token is now fetched server-side
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !authData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user_id = authData.user.id;

    const BodySchema = z.object({
      ml_user_id: z.string().min(1, "ml_user_id is required"),
      days: z.number().optional().default(1),
      date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format").optional(),
      date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format").optional(),
      seller_id: z.string().nullable().optional(),
    });

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid input", details: parsed.error.flatten().fieldErrors }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { ml_user_id: reqMLUserId, days, date_from, date_to, seller_id } = parsed.data;

    // Look up ML access_token from DB (by ml_user_id, validate org membership)
    const { data: tokenRow, error: tokenErr } = await supabaseAdmin
      .from("ml_tokens")
      .select("access_token, organization_id, seller_id")
      .eq("ml_user_id", reqMLUserId)
      .not("access_token", "is", null)
      .limit(1)
      .maybeSingle();

    if (tokenErr || !tokenRow?.access_token) {
      return new Response(JSON.stringify({ error: "No ML token found for this store" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (tokenRow.organization_id) {
      const { data: isMember } = await supabaseAdmin.rpc("is_org_member", {
        _user_id: user_id,
        _org_id: tokenRow.organization_id,
      });
      if (!isMember) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    const access_token = tokenRow.access_token as string;
    const organization_id = tokenRow.organization_id as string | null;
    const tokenSellerId = tokenRow.seller_id as string | null;
    const effectiveSellerId = seller_id || tokenSellerId;

    const user = await mlFetch("/users/me", access_token);
    const sellerId = user.id;

    let rangeStart: Date;
    let rangeEnd: Date;
    let periodDays: number;

    if (date_from && date_to) {
      // Interpret dates as BRT (UTC-3): BRT midnight = UTC 03:00
      rangeStart = new Date(`${date_from}T03:00:00.000Z`);
      const endDateNext = new Date(`${date_to}T03:00:00.000Z`);
      endDateNext.setUTCDate(endDateNext.getUTCDate() + 1);
      rangeEnd = new Date(endDateNext.getTime() - 1);
      periodDays = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / DAY_MS);
    } else {
      periodDays = Math.min(Math.max(Number(days) || 30, 1), 90);
      rangeEnd = new Date();
      rangeEnd.setHours(23, 59, 59, 999);
      rangeStart = new Date();
      rangeStart.setDate(rangeStart.getDate() - periodDays + 1);
      rangeStart.setHours(0, 0, 0, 0);
    }

    const rangeFromStr = rangeStart.toISOString().substring(0, 10);
    const rangeToStr = rangeEnd.toISOString().substring(0, 10);

    // BRT date boundaries for strict filtering (prevent spillover)
    const brtDateFrom = date_from || toBRT(rangeStart.toISOString()).date;
    const brtDateTo = date_to || toBRT(rangeEnd.toISOString()).date;

    console.log(
      `Fetching orders from ${rangeStart.toISOString()} to ${rangeEnd.toISOString()}`,
    );

    // Uma única query paginada para o range completo + visitas + anúncios em paralelo
    const [allOrders, dailyVisits, activeListings] = await Promise.all([
      fetchOrdersChunk(sellerId, rangeStart.toISOString(), rangeEnd.toISOString(), access_token),
      fetchVisits(sellerId, rangeFromStr, rangeToStr, access_token),
      fetchActiveListings(sellerId, access_token),
    ]);

    const seen = new Set<number>();
    const orders = allOrders.filter((o) => {
      if (seen.has(o.id)) return false;
      seen.add(o.id);
      return true;
    });

    console.log(`Fetched ${orders.length} unique orders (period: ${periodDays} days)`);

    let totalRevenue = 0;
    const totalOrders = orders.length;
    let totalUnitsSold = 0;
    let approvedRevenue = 0;
    let cancelledOrders = 0;
    let shippedOrders = 0;
    const dailySales: Record<
      string,
      {
        total: number;
        approved: number;
        qty: number;
        units_sold: number;
        cancelled: number;
        shipped: number;
        unique_visits: number;
        unique_buyers: number;
      }
    > = {};
    const hourlySales: Record<
      string,
      { date: string; hour: number; total: number; approved: number; qty: number; units_sold: number }
    > = {};
    const productSales: Record<
      string,
      { item_id: string; date: string; title: string; thumbnail: string | null; qty_sold: number; revenue: number; marca: string | null }
    > = {};
    const stateSales: Record<
      string,
      { date: string; uf: string; state_name: string; qty_orders: number; revenue: number; approved_revenue: number }
    > = {};

    // Pre-fetch shipment receiver states (orders/search does not include them).
    const shipmentIdsToFetch: string[] = [];
    const seenShipmentIds = new Set<string>();
    for (const order of orders) {
      const dateCreated = order.date_created || null;
      const date = dateCreated ? toBRT(dateCreated).date : null;
      if (!date || date < brtDateFrom || date > brtDateTo) continue;
      const sid = order.shipping?.id;
      if (sid && !seenShipmentIds.has(String(sid))) {
        seenShipmentIds.add(String(sid));
        shipmentIdsToFetch.push(String(sid));
      }
    }
    const shipmentStates = await fetchShipmentStates(shipmentIdsToFetch, access_token);
    console.log(`Shipments: fetched state for ${shipmentStates.size}/${shipmentIdsToFetch.length}`);

    for (const order of orders) {
      const amount = Number(order.total_amount || 0);
      const dateCreated = order.date_created || null;
      const brt = dateCreated ? toBRT(dateCreated) : null;
      const date = brt?.date ?? null;
      const hour = brt?.hour ?? null;
      const status = order.status;

      // Count units sold: sum of item quantities (e.g., 3 units of same product = 3)
      const orderUnits = (order.order_items || []).reduce(
        (sum: number, item: any) => sum + (Number(item.quantity) || 1), 0
      ) || 1;

      totalRevenue += amount;
      totalUnitsSold += orderUnits;

      if (status === "paid" || status === "confirmed") {
        approvedRevenue += amount;
      }
      if (status === "cancelled") {
        cancelledOrders++;
      }
      if (order.shipping?.status === "shipped" || order.shipping?.status === "delivered") {
        shippedOrders++;
      }

      // Strict: only process dates within the requested BRT range
      if (date && date >= brtDateFrom && date <= brtDateTo) {
        if (!dailySales[date]) {
          dailySales[date] = {
            total: 0,
            approved: 0,
            qty: 0,
            units_sold: 0,
            cancelled: 0,
            shipped: 0,
            unique_visits: 0,
            unique_buyers: 0,
          };
        }
        dailySales[date].total += amount;
        dailySales[date].qty += 1;
        dailySales[date].units_sold += orderUnits;
        if (status === "paid" || status === "confirmed") {
          dailySales[date].approved += amount;
        }
        if (status === "cancelled") {
          dailySales[date].cancelled += 1;
        }
        if (order.shipping?.status === "shipped" || order.shipping?.status === "delivered") {
          dailySales[date].shipped += 1;
        }
      }

      if (date && date >= brtDateFrom && date <= brtDateTo && hour !== null && Number.isFinite(hour)) {
        const hourlyKey = `${date}-${String(hour).padStart(2, "0")}`;
        if (!hourlySales[hourlyKey]) {
          hourlySales[hourlyKey] = { date, hour, total: 0, approved: 0, qty: 0, units_sold: 0 };
        }
        hourlySales[hourlyKey].total += amount;
        hourlySales[hourlyKey].qty += 1;
        hourlySales[hourlyKey].units_sold += orderUnits;
        if (status === "paid" || status === "confirmed") {
          hourlySales[hourlyKey].approved += amount;
        }
      }

      // Aggregate product-level sales per day
      if (date && date >= brtDateFrom && date <= brtDateTo && order.order_items) {
        for (const item of order.order_items) {
          const itemId = item.item?.id;
          if (!itemId) continue;
          const prodKey = `${date}::${itemId}`;
          const itemQty = Number(item.quantity) || 1;
          const itemRevenue = Number(item.unit_price || 0) * itemQty;
          if (!productSales[prodKey]) {
            productSales[prodKey] = {
              item_id: itemId,
              date,
              title: item.item?.title || "",
              thumbnail: null,
              qty_sold: 0,
              revenue: 0,
              marca: null,
            };
          }
          productSales[prodKey].qty_sold += itemQty;
          productSales[prodKey].revenue += itemRevenue;
        }
      }

      // Aggregate state-level sales per day (from shipping address)
      if (date && date >= brtDateFrom && date <= brtDateTo) {
        // Primary source: shipment lookup (since orders/search omits receiver_address)
        const sid = order.shipping?.id ? String(order.shipping.id) : null;
        const fromShipment = sid ? shipmentStates.get(sid) : undefined;
        let uf: string | null = fromShipment?.uf ?? null;
        let stateName: string = fromShipment?.state_name ?? "";
        // Fallback: inline receiver_address (rarely present)
        if (!uf) {
          const stateObj = order.shipping?.receiver_address?.state;
          const rawId: string | undefined = stateObj?.id;
          stateName = stateName || stateObj?.name || "";
          if (rawId && typeof rawId === "string") {
            uf = rawId.includes("-") ? rawId.split("-")[1] : rawId;
            if (uf) uf = uf.trim().toUpperCase().slice(0, 2);
          }
        }
        if (uf && uf.length === 2) {
          const stateKey = `${date}::${uf}`;
          if (!stateSales[stateKey]) {
            stateSales[stateKey] = {
              date,
              uf,
              state_name: stateName,
              qty_orders: 0,
              revenue: 0,
              approved_revenue: 0,
            };
          }
          stateSales[stateKey].qty_orders += 1;
          stateSales[stateKey].revenue += amount;
          if (status === "paid" || status === "confirmed") {
            stateSales[stateKey].approved_revenue += amount;
          }
          if (stateName && !stateSales[stateKey].state_name) {
            stateSales[stateKey].state_name = stateName;
          }
        }
      }
    }

    // Enrich product thumbnails via multi-get — todos os batches em paralelo
    try {
      const uniqueItemIds = [...new Set(Object.values(productSales).map((p) => p.item_id))];
      const thumbnailBatches: string[][] = [];
      for (let i = 0; i < uniqueItemIds.length; i += 20) {
        thumbnailBatches.push(uniqueItemIds.slice(i, i + 20));
      }
      await Promise.all(
        thumbnailBatches.map(async (batch) => {
          const multiGet = await mlFetch(`/items?ids=${batch.join(",")}&attributes=id,thumbnail,attributes`, access_token);
          for (const entry of multiGet) {
            if (entry.code === 200 && entry.body) {
              const body = entry.body;
              const brandAttr = (body.attributes ?? []).find((a: any) => a.id === "BRAND");
              const marca = brandAttr?.value_name ?? null;
              for (const ps of Object.values(productSales)) {
                if (ps.item_id === String(body.id)) {
                  if (body.thumbnail) ps.thumbnail = body.thumbnail;
                  if (marca) ps.marca = marca;
                }
              }
            }
          }
        }),
      );
      console.log(`Enriched thumbnails+brand for ${uniqueItemIds.length} unique items`);
    } catch (thumbErr) {
      console.error("Thumbnail enrichment error (non-critical):", thumbErr);
    }

    const dailyBuyers = countUniqueBuyers(orders);
    for (const [date, count] of Object.entries(dailyBuyers)) {
      if (!dailySales[date]) {
        dailySales[date] = {
          total: 0,
          approved: 0,
          qty: 0,
          units_sold: 0,
          cancelled: 0,
          shipped: 0,
          unique_visits: 0,
          unique_buyers: 0,
        };
      }
      dailySales[date].unique_buyers = count;
    }
    const totalUniqueBuyers = new Set(orders.map((o) => o.buyer?.id).filter(Boolean)).size;

    // dailyVisits e activeListings já foram buscados em paralelo com os pedidos
    // STRICT: only include visits within the requested BRT date range to prevent spillover
    let totalVisits = 0;
    for (const [date, visits] of Object.entries(dailyVisits)) {
      if (date < brtDateFrom || date > brtDateTo) {
        console.log(`Skipping visits for out-of-range date: ${date} (range: ${brtDateFrom} to ${brtDateTo})`);
        continue;
      }
      totalVisits += visits;
      if (!dailySales[date]) {
        dailySales[date] = {
          total: 0,
          approved: 0,
          qty: 0,
          units_sold: 0,
          cancelled: 0,
          shipped: 0,
          unique_visits: 0,
          unique_buyers: 0,
        };
      }
      dailySales[date].unique_visits = visits;
    }

    console.log(
      `Unique buyers: ${totalUniqueBuyers}, daily visit rows: ${Object.keys(dailyVisits).length}, total visits: ${totalVisits}`,
    );

    if (user_id) {
      try {
        const syncedAt = new Date().toISOString();
        const mlUserIdStr = String(sellerId);
        const dailyRows = Object.entries(dailySales).map(([date, data]) => ({
          user_id,
          ml_user_id: mlUserIdStr,
          date,
          total_revenue: data.total,
          approved_revenue: data.approved,
          qty_orders: data.qty,
          units_sold: data.units_sold,
          cancelled_orders: data.cancelled,
          shipped_orders: data.shipped,
          unique_visits: data.unique_visits,
          unique_buyers: data.unique_buyers,
          synced_at: syncedAt,
          ...(effectiveSellerId ? { seller_id: effectiveSellerId } : {}),
          ...(organization_id ? { organization_id } : {}),
        }));

        const hourlyRows = Object.values(hourlySales).map((data) => ({
          user_id,
          ml_user_id: mlUserIdStr,
          date: data.date,
          hour: data.hour,
          total_revenue: data.total,
          approved_revenue: data.approved,
          qty_orders: data.qty,
          units_sold: data.units_sold,
          synced_at: syncedAt,
          ...(effectiveSellerId ? { seller_id: effectiveSellerId } : {}),
          ...(organization_id ? { organization_id } : {}),
        }));

        // Paraleliza upserts de daily + hourly + user simultaneamente
        const upsertPromises: PromiseLike<any>[] = [];

        if (dailyRows.length > 0) {
          upsertPromises.push(
            supabaseAdmin
              .from("ml_daily_cache")
              .upsert(dailyRows, { onConflict: "user_id,ml_user_id,date" })
              .then(({ error }) => { if (error) console.error("Cache upsert error:", error); }),
          );
        }

        if (hourlyRows.length > 0) {
          upsertPromises.push(
            supabaseAdmin
              .from("ml_hourly_cache")
              .upsert(hourlyRows, { onConflict: "user_id,ml_user_id,date,hour" })
              .then(({ error }) => { if (error) console.error("Hourly cache upsert error:", error); }),
          );
        }

        // Upsert product daily cache
        const productRows = Object.values(productSales).map((p) => ({
          user_id,
          ml_user_id: mlUserIdStr,
          date: p.date,
          item_id: p.item_id,
          title: p.title,
          thumbnail: p.thumbnail,
          qty_sold: p.qty_sold,
          revenue: p.revenue,
          marca: p.marca ?? null,
          synced_at: syncedAt,
          ...(effectiveSellerId ? { seller_id: effectiveSellerId } : {}),
          ...(organization_id ? { organization_id } : {}),
        }));

        // Products: fire-and-forget (paralelo internamente)
        if (productRows.length > 0) {
          (async () => {
            try {
              const productBatches: typeof productRows[] = [];
              for (let i = 0; i < productRows.length; i += 200) {
                productBatches.push(productRows.slice(i, i + 200));
              }
              await Promise.all(
                productBatches.map((batch) =>
                  supabaseAdmin
                    .from("ml_product_daily_cache")
                    .upsert(batch, { onConflict: "organization_id,ml_user_id,date,item_id" })
                    .then(({ error }) => { if (error) console.error("Product cache upsert error:", error); }),
                ),
              );
              console.log(`Product cache: ${productRows.length} rows saved`);
            } catch (e) {
              console.error("Product cache async error:", e);
            }
          })();
        }

        // Upsert state daily cache (fire-and-forget, batches of 200)
        const stateRows = Object.values(stateSales).map((s) => ({
          user_id,
          ml_user_id: mlUserIdStr,
          date: s.date,
          uf: s.uf,
          state_name: s.state_name,
          qty_orders: s.qty_orders,
          revenue: s.revenue,
          approved_revenue: s.approved_revenue,
          synced_at: syncedAt,
          ...(effectiveSellerId ? { seller_id: effectiveSellerId } : {}),
          ...(organization_id ? { organization_id } : {}),
        }));

        if (stateRows.length > 0) {
          (async () => {
            try {
              const stateBatches: typeof stateRows[] = [];
              for (let i = 0; i < stateRows.length; i += 200) {
                stateBatches.push(stateRows.slice(i, i + 200));
              }
              await Promise.all(
                stateBatches.map((batch) =>
                  supabaseAdmin
                    .from("ml_state_daily_cache")
                    .upsert(batch, { onConflict: "user_id,ml_user_id,date,uf" })
                    .then(({ error }) => { if (error) console.error("State cache upsert error:", error); }),
                ),
              );
              console.log(`State cache: ${stateRows.length} rows saved`);
            } catch (e) {
              console.error("State cache async error:", e);
            }
          })();
        }

        // User cache junto com daily/hourly em paralelo
        upsertPromises.push(
          supabaseAdmin
            .from("ml_user_cache")
            .upsert(
              {
                user_id,
                ml_user_id: user.id,
                nickname: user.nickname,
                country: user.country_id,
                permalink: user.permalink,
                active_listings: activeListings,
                synced_at: syncedAt,
                ...(effectiveSellerId ? { seller_id: effectiveSellerId } : {}),
                ...(organization_id ? { organization_id } : {}),
              },
              { onConflict: "user_id,ml_user_id" },
            )
            .then(({ error }) => { if (error) console.error("User cache upsert error:", error); }),
        );

        await Promise.all(upsertPromises);

        // Log sync to ml_sync_log
        const daysCount = Object.keys(dailySales).length;
        await supabaseAdmin.from("ml_sync_log").upsert(
          {
            user_id,
            ml_user_id: mlUserIdStr,
            date_from: date_from || rangeFromStr,
            date_to: date_to || rangeToStr,
            days_synced: daysCount,
            orders_fetched: orders.length,
            source: "auto",
            synced_at: syncedAt,
            ...(effectiveSellerId ? { seller_id: effectiveSellerId } : {}),
            ...(organization_id ? { organization_id } : {}),
          },
          { onConflict: "user_id,ml_user_id,date_from,date_to,source" },
        ).then(({ error }) => { if (error) console.error("Sync log error:", error); });

        console.log(
          `Cache updated: ${dailyRows.length} daily rows, ${hourlyRows.length} hourly rows, ${productRows.length} product rows, user cache saved`,
        );
      } catch (cacheError) {
        console.error("Cache save error:", cacheError);
      }
    }

    const dailyBreakdown = Object.entries(dailySales)
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => b.date.localeCompare(a.date));

    const hourlyBreakdown = Object.values(hourlySales).sort((a, b) => {
      const dateCompare = b.date.localeCompare(a.date);
      if (dateCompare !== 0) return dateCompare;
      return b.hour - a.hour;
    });

    const conversionRate = totalVisits > 0 ? (totalUniqueBuyers / totalVisits) * 100 : 0;

    const response = {
      success: true,
      user: {
        id: user.id,
        nickname: user.nickname,
        country: user.country_id,
        permalink: user.permalink,
      },
      seller_reputation: user.seller_reputation || null,
      metrics: {
        total_revenue: totalRevenue,
        approved_revenue: approvedRevenue,
        total_orders: totalOrders,
        units_sold: totalUnitsSold,
        cancelled_orders: cancelledOrders,
        shipped_orders: shippedOrders,
        active_listings: activeListings,
        avg_ticket: totalOrders > 0 ? totalRevenue / totalOrders : 0,
        unique_visits: totalVisits,
        unique_buyers: totalUniqueBuyers,
        conversion_rate: conversionRate,
        period: `last_${periodDays}_days`,
      },
      daily_breakdown: dailyBreakdown,
      hourly_breakdown: hourlyBreakdown,
      paging: { total: totalOrders, fetched: totalOrders },
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("ML Integration error:", error);
    return new Response(JSON.stringify({ success: false, error: error.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
