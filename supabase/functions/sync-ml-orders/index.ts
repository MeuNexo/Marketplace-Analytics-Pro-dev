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

// ── UF → region (mirror of src/lib/tax/regions.ts) ───────────────────────────
const UF_REGION: Record<string, "N" | "NE" | "CO" | "SE" | "S"> = {
  AC:"N",AP:"N",AM:"N",PA:"N",RO:"N",RR:"N",TO:"N",
  AL:"NE",BA:"NE",CE:"NE",MA:"NE",PB:"NE",PE:"NE",PI:"NE",RN:"NE",SE:"NE",
  DF:"CO",GO:"CO",MT:"CO",MS:"CO",
  ES:"SE",MG:"SE",RJ:"SE",SP:"SE",
  PR:"S",RS:"S",SC:"S",
};

function isReducedInterstateDest(uf: string | null): boolean {
  if (!uf) return false;
  if (uf === "ES") return true;
  const r = UF_REGION[uf];
  return r === "N" || r === "NE" || r === "CO";
}

function computeOrderTaxRate(cfg: any, ufDest: string | null): number {
  if (!cfg) return 0;
  const c = (v: any) => Number(v ?? 0);
  switch (cfg.regime) {
    case "simples_nacional":
      return Math.max(0, c(cfg.sn_aliquota_efetiva));
    case "lucro_presumido":
      return Math.max(0, c(cfg.lp_pis) + c(cfg.lp_cofins) + c(cfg.lp_irpj) + c(cfg.lp_csll));
    case "lucro_real": {
      const intra = cfg.lr_icms_aliquota_intra ?? cfg.lr_icms_debito ?? 0;
      const interSE = cfg.lr_icms_aliquota_inter_sul_sudeste ?? 12;
      const interNNE = cfg.lr_icms_aliquota_inter_norte_nordeste ?? 7;
      const orig = (cfg.uf_origem ?? "").toString().toUpperCase() || null;
      const dest = ufDest ? ufDest.toUpperCase() : null;
      let icms = Number(intra);
      if (orig && dest && orig !== dest) {
        icms = isReducedInterstateDest(dest) ? Number(interNNE) : Number(interSE);
      }
      const debits  = c(cfg.lr_pis_debito) + c(cfg.lr_cofins_debito) + icms;
      const credits = c(cfg.lr_pis_credito) + c(cfg.lr_cofins_credito) + c(cfg.lr_icms_credito);
      return Math.max(0, debits - credits);
    }
  }
  return 0;
}

// Normalise ML listing_type_id → "classic" | "premium" | "free"
// Current Brazil tiers (2024):
//   gold_special  → Clássico  ~11%
//   gold_pro      → Premium   ~16%
//   gold_premium  → Premium   ~16%  (legacy name)
//   gold          → Clássico  (legacy tier)
//   gold_extra_full → Premium (some categories)
//   silver / bronze / free → Grátis ~0%
const LISTING_TYPE_MAP: Record<string, string> = {
  gold_special:      "classic",
  gold_pro:          "premium",
  gold_premium:      "premium",
  gold_extra_full:   "premium",
  gold:              "classic",
  silver:            "free",
  bronze:            "free",
  free:              "free",
  gold_extra:        "classic",
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

// ── Batch-fetch shipment details from /shipments/{id} ────────────────────────
// Fetches ALL unique shipment IDs (not just frete grátis) to get:
//   • base_cost  → seller-absorbed shipping cost (frete grátis / Full)
//   • receiver_address → estado (UF) + cidade
// /orders/search does NOT return receiver_address; it is only in /shipments/{id}.

interface ShipmentDetail {
  cost:   number | null;
  estado: string | null;
  cidade: string | null;
}

async function fetchShipmentDetails(
  orders: any[],
  accessToken: string,
  maxShipments = 500,
): Promise<Map<number, ShipmentDetail>> {
  const detailMap = new Map<number, ShipmentDetail>();

  // Collect ALL unique shipment IDs
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const order of orders) {
    const shipId = order.shipping?.id ? Number(order.shipping.id) : null;
    if (shipId && !seen.has(shipId)) {
      seen.add(shipId);
      ids.push(shipId);
      if (ids.length >= maxShipments) break;
    }
  }

  if (!ids.length) return detailMap;
  console.log(`Fetching ${ids.length} shipments for cost + address…`);

  const CONCURRENCY = 10;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (id) => {
        const s = await mlFetch(`/shipments/${id}`, accessToken, 8_000);

        // Seller-absorbed shipping cost
        const cost = s.base_cost ?? s.cost?.gross ?? null;

        // Receiver address → UF + cidade
        const addr     = s.receiver_address ?? {};
        const stateObj = addr.state ?? {};
        const estadoRaw =
          typeof stateObj === "string"
            ? stateObj
            : (stateObj?.id ?? stateObj?.name ?? null);
        let estado = estadoRaw ? String(estadoRaw).trim() || null : null;
        if (estado?.includes("-")) {
          estado = estado.split("-")[1]?.trim()?.toUpperCase()?.slice(0, 2) ?? estado;
        }
        const cityObj = addr.city ?? addr.city_name ?? null;
        const cidade  = cityObj
          ? (typeof cityObj === "object" ? (cityObj?.name ?? null) : String(cityObj).trim() || null)
          : null;

        return { id, cost: cost != null ? Number(cost) : null, estado, cidade };
      }),
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        detailMap.set(r.value.id, {
          cost:   r.value.cost != null && r.value.cost > 0 ? r.value.cost : null,
          estado: r.value.estado,
          cidade: r.value.cidade,
        });
      }
    }
  }

  console.log(`Shipment details resolved: ${detailMap.size} / ${ids.length}`);
  return detailMap;
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
  shipmentMap:    Map<number, ShipmentDetail>,
  costMap:        Map<string, number>,
  taxConfig:      any | null,
): Array<Record<string, unknown>> {
  const datePedido    = (order.date_created || "").substring(0, 10) || null;
  const dataPagamento = (order.date_approved || "").substring(0, 10) || null;

  const comprador = safeStr(
    order.buyer?.nickname ?? order.buyer?.first_name ?? null,
  );

  // Address comes from the shipment detail (receiver_address).
  // /orders/search does NOT include receiver_address; it is only in /shipments/{id}.
  const shipId  = order.shipping?.id ? Number(order.shipping.id) : null;
  const detail  = shipId ? shipmentMap.get(shipId) : undefined;
  const estado  = detail?.estado ?? null;
  const cidade  = detail?.cidade ?? null;

  return (order.order_items || []).map((item: any) => {
    const prod           = item.item ?? {};
    // listing_type_id lives at the order_item level, NOT inside item.item
    const listingTypeRaw = item.listing_type_id ?? prod.listing_type_id ?? prod.listing_type ?? "";
    const listing_type   = LISTING_TYPE_MAP[listingTypeRaw] ?? listingTypeRaw ?? null;

    // Shipping cost resolution:
    //  1. order.shipping.cost → buyer-paid (non-zero for paid shipping)
    //  2. detail.cost         → seller-absorbed base_cost from /shipments/{id}
    //     (covers frete grátis / Mercado Envios Full orders)
    const buyerCost = order.shipping?.cost != null ? Number(order.shipping.cost) : null;
    const frete     = (buyerCost != null && buyerCost > 0)
      ? buyerCost
      : (detail?.cost ?? null);

    const itemId      = String(prod.id || "");
    const quantidade  = Number(item.quantity || 0);
    const precoUnit   = item.unit_price != null ? Number(item.unit_price) : null;
    const custoUnit   = costMap.get(itemId) ?? null;
    const taxRate     = taxConfig ? computeOrderTaxRate(taxConfig, estado) : null;
    const taxAmount   = (taxRate != null && precoUnit != null)
      ? (precoUnit * quantidade * taxRate) / 100
      : null;
    const ufOrigem    = taxConfig?.uf_origem ?? null;

    return {
      ml_order_id:     String(order.id),
      ml_user_id:      mlUserId,
      seller_id:       sellerId,
      user_id:         userId,
      organization_id: organizationId,
      item_id:         itemId,
      variation_id:    prod.variation_id ? String(prod.variation_id) : "",
      sku:             prod.seller_custom_field ?? prod.seller_sku ?? null,
      titulo:          prod.title ?? null,
      listing_type,
      quantidade,
      preco_unit:      precoUnit,
      comissao:        item.sale_fee    != null ? Number(item.sale_fee)    : null,
      frete,
      status:          order.status ?? null,
      data_pedido:     datePedido,
      data_pagamento:  dataPagamento,
      estado,
      cidade,
      comprador,
      synced_at:       syncAt,
      custo_unit:      custoUnit,
      tax_rate:        taxRate,
      tax_amount:      taxAmount,
      uf_origem:       ufOrigem,
      receita_bruta:   precoUnit != null ? precoUnit * quantidade : null,
      receita_liquida: precoUnit != null
        ? precoUnit * quantidade
          - (item.sale_fee != null ? Number(item.sale_fee) : 0)
          - (frete ?? 0)
          - (taxAmount ?? 0)
        : null,
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

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceKey,
    );

    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token === serviceKey;

    let userId: string | null = null;
    if (!isServiceRole) {
      const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(token);
      if (authErr || !authData?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = authData.user.id;
    }

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

    // ── Org membership check (skip for service role — called from process-sync-job) ──
    if (!isServiceRole && tokenRow.organization_id) {
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

    // ── Fetch shipment details (cost + address) for all orders ───────────────
    const shipmentMap = await fetchShipmentDetails(orders, accessToken);

    // ── Load tax config + product costs for this store ──────────────────────
    let taxConfig: any = null;
    if (organizationId) {
      const { data: cfg } = await supabaseAdmin
        .from("ml_tax_config")
        .select("*")
        .eq("ml_user_id", ml_user_id)
        .eq("organization_id", organizationId)
        .maybeSingle();
      taxConfig = cfg ?? null;
    }

    const itemIds = Array.from(new Set(
      orders.flatMap((o) => (o.order_items ?? []).map((i: any) => String(i.item?.id ?? ""))).filter(Boolean),
    ));
    const costMap = new Map<string, number>();
    if (itemIds.length > 0) {
      const { data: costRows } = await supabaseAdmin
        .from("ml_product_costs")
        .select("item_id, cost, organization_id, user_id")
        .in("item_id", itemIds);
      for (const r of (costRows ?? []) as any[]) {
        if (r.cost == null) continue;
        const matchesOrg = organizationId && r.organization_id === organizationId;
        const matchesUser = r.user_id === userId;
        if (matchesOrg || matchesUser) costMap.set(r.item_id, Number(r.cost));
      }
    }

    // ── Expand + upsert ───────────────────────────────────────────────────────
    const records = orders.flatMap((o) =>
      expandOrder(o, ml_user_id, effectiveSellerId, userId, organizationId, syncAt, shipmentMap, costMap, taxConfig),
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
