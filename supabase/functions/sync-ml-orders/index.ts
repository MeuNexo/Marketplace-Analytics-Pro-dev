import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ML_API = "https://api.mercadolibre.com";
const DAY_MS = 24 * 60 * 60 * 1000;

// Normalise ML listing_type_id → "classic" | "premium" | "free"
const LISTING_TYPE_MAP: Record<string, string> = {
  gold_special: "classic",
  gold_pro:     "premium",
  gold:         "classic",
  silver:       "free",
  bronze:       "free",
  free:         "free",
};

// ── ML fetch helper (same pattern as mercado-libre-integration) ───────────────

async function mlFetch(path: string, accessToken: string, timeoutMs = 15_000) {
  const res = await fetch(`${ML_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`ML API error [${path}]:`, data);
    throw new Error(data.message || `ML API error: ${res.status}`);
  }
  return data;
}

// ── Paginated order fetch with auto-split when total > 950 ────────────────────

async function fetchOrdersPage(
  mlNumericId: number,
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
    const url =
      `/orders/search?seller=${mlNumericId}` +
      `&order.date_created.from=${encodeURIComponent(dateFrom)}` +
      `&order.date_created.to=${encodeURIComponent(dateTo)}` +
      `&sort=date_desc&limit=${PAGE_SIZE}&offset=${offset}`;

    const data = await mlFetch(url, accessToken);
    const results: any[] = data.results || [];
    allOrders = allOrders.concat(results);
    apiTotal = data.paging?.total || 0;
    offset += results.length;
    if (results.length < PAGE_SIZE || offset >= apiTotal) break;
  }

  // If we hit the offset ceiling, split the window in two and recurse
  if (apiTotal > MAX_OFFSET - 50) {
    const fromMs = new Date(dateFrom).getTime();
    const toMs   = new Date(dateTo).getTime();
    const diffMs = toMs - fromMs;

    if (diffMs > 60 * 60 * 1000) {
      const midMs     = fromMs + Math.floor(diffMs / 2);
      const midIso    = new Date(midMs).toISOString();
      const midEndIso = new Date(midMs - 1).toISOString();

      console.log(
        `⚠️ Splitting: ${apiTotal} orders in ${dateFrom} → ${dateTo}`,
      );

      const [half1, half2] = await Promise.all([
        fetchOrdersPage(mlNumericId, dateFrom, midEndIso, accessToken),
        fetchOrdersPage(mlNumericId, midIso, dateTo, accessToken),
      ]);
      return [...half1, ...half2];
    }

    console.warn(
      `⚠️ TRUNCATION: ${apiTotal} orders in <1h window; some orders may be missing`,
    );
  }

  return allOrders;
}

// ── Expand one ML order object into one row per order_item ────────────────────

function safeStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function expandOrder(
  order:          any,
  mlUserId:       string,
  sellerId:       string | null,
  userId:         string,
  organizationId: string | null,
  syncAt:         string,
): Array<Record<string, unknown>> {
  const datePedido    = (order.date_created || "").substring(0, 10) || null;
  const dataPagamento = (order.date_approved || "").substring(0, 10) || null;

  // Shipping address → estado (UF) + cidade
  const addr     = order.shipping?.receiver_address ?? order.buyer?.address ?? {};
  const stateObj = addr.state ?? {};
  const estadoRaw =
    typeof stateObj === "string"
      ? stateObj
      : (stateObj?.id ?? stateObj?.name ?? null);

  let estado = safeStr(estadoRaw);
  // ML returns state ids like "BR-SP" → extract "SP"
  if (estado?.includes("-")) {
    estado = estado.split("-")[1]?.trim()?.toUpperCase()?.slice(0, 2) ?? estado;
  }

  const cidade =
    safeStr(
      typeof addr.city === "object"
        ? addr.city?.name
        : addr.city ?? addr.city_name ?? null,
    );

  const comprador = safeStr(
    order.buyer?.nickname ?? order.buyer?.first_name ?? null,
  );

  return (order.order_items || []).map((item: any) => {
    const prod           = item.item ?? {};
    const listingTypeRaw = prod.listing_type_id ?? prod.listing_type ?? "";
    const listing_type   = LISTING_TYPE_MAP[listingTypeRaw] ?? listingTypeRaw ?? null;

    return {
      ml_order_id:     String(order.id),
      ml_user_id:      mlUserId,
      seller_id:       sellerId,
      user_id:         userId,
      organization_id: organizationId,
      item_id:         String(prod.id || ""),
      variation_id:    prod.variation_id ? String(prod.variation_id) : "",
      sku:             prod.seller_custom_field ?? prod.seller_sku ?? null,
      titulo:          prod.title ?? null,
      listing_type,
      quantidade:      Number(item.quantity || 0),
      preco_unit:      item.unit_price  != null ? Number(item.unit_price)  : null,
      comissao:        item.sale_fee    != null ? Number(item.sale_fee)    : null,
      frete:
        order.shipping?.cost != null && Number(order.shipping.cost) > 0
          ? Number(order.shipping.cost)
          : null,
      status:          order.status ?? null,
      data_pedido:     datePedido,
      data_pagamento:  dataPagamento,
      estado,
      cidade,
      comprador,
      synced_at:       syncAt,
    };
  });
}

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const syncAt = new Date().toISOString();

  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authErr || !authData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = authData.user.id;

    // ── Body validation ───────────────────────────────────────────────────────
    const BodySchema = z.object({
      ml_user_id: z.string().min(1),
      date_from:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      date_to:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      seller_id:  z.string().nullable().optional(),
    });

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Invalid input", details: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { ml_user_id, date_from, date_to, seller_id } = parsed.data;

    // ── Token lookup (same as mercado-libre-integration) ──────────────────────
    const { data: tokenRow, error: tokenErr } = await supabaseAdmin
      .from("ml_tokens")
      .select("access_token, organization_id, seller_id")
      .eq("ml_user_id", ml_user_id)
      .not("access_token", "is", null)
      .limit(1)
      .maybeSingle();

    if (tokenErr || !tokenRow?.access_token) {
      return new Response(JSON.stringify({ error: "No ML token found for this store" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Org membership check ──────────────────────────────────────────────────
    if (tokenRow.organization_id) {
      const { data: isMember } = await supabaseAdmin.rpc("is_org_member", {
        _user_id: userId,
        _org_id:  tokenRow.organization_id,
      });
      if (!isMember) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const accessToken      = tokenRow.access_token    as string;
    const organizationId   = tokenRow.organization_id as string | null;
    const effectiveSellerId = seller_id ?? tokenRow.seller_id ?? null;

    // ── Resolve numeric ML seller id ──────────────────────────────────────────
    const mlUser       = await mlFetch("/users/me", accessToken);
    const mlNumericId  = mlUser.id as number;

    // ── Build ISO range (BRT midnight = UTC 03:00) ────────────────────────────
    const rangeStart = new Date(`${date_from}T03:00:00.000Z`);
    const rangeEndBase = new Date(`${date_to}T03:00:00.000Z`);
    rangeEndBase.setUTCDate(rangeEndBase.getUTCDate() + 1);
    const rangeEnd = new Date(rangeEndBase.getTime() - 1);

    console.log(
      `sync-ml-orders: ml_user_id=${ml_user_id} from=${date_from} to=${date_to}`,
    );

    // ── Fetch orders ──────────────────────────────────────────────────────────
    const rawOrders = await fetchOrdersPage(
      mlNumericId,
      rangeStart.toISOString(),
      rangeEnd.toISOString(),
      accessToken,
    );

    // Deduplicate by order id
    const seen    = new Set<number>();
    const orders  = rawOrders.filter((o) => {
      if (seen.has(o.id)) return false;
      seen.add(o.id);
      return true;
    });

    console.log(`sync-ml-orders: ${orders.length} unique orders`);

    // ── Expand + upsert ───────────────────────────────────────────────────────
    const records = orders.flatMap((o) =>
      expandOrder(o, ml_user_id, effectiveSellerId, userId, organizationId, syncAt),
    );

    let upserted = 0;
    if (records.length > 0) {
      const { error: upsertErr } = await supabaseAdmin
        .from("orders")
        .upsert(records, {
          onConflict: "ml_order_id,ml_user_id,item_id,variation_id",
        });
      if (upsertErr) throw new Error(`orders upsert: ${upsertErr.message}`);
      upserted = records.length;
    }

    // ── Log to ml_sync_log ────────────────────────────────────────────────────
    const daysCount = Math.round((rangeEnd.getTime() - rangeStart.getTime()) / DAY_MS) + 1;
    await supabaseAdmin
      .from("ml_sync_log")
      .upsert(
        {
          user_id:        userId,
          ml_user_id,
          seller_id:      effectiveSellerId,
          organization_id: organizationId,
          date_from,
          date_to,
          days_synced:    daysCount,
          orders_fetched: upserted,
          source:         "orders",
          synced_at:      syncAt,
        },
        { onConflict: "user_id,ml_user_id,date_from,date_to,source" },
      );

    return new Response(
      JSON.stringify({ success: true, orders_synced: upserted, date_from, date_to }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("sync-ml-orders error:", message);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
