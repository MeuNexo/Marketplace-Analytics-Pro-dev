import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ML_API = "https://api.mercadolibre.com";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getUserAndToken(
  req: Request,
  supabase: ReturnType<typeof createClient>,
  mlUserId: string,
) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsErr } = await supabase.auth.getUser(token);
  if (claimsErr || !claimsData?.user) return null;
  const { data: tokenRow, error: tokenErr } = await supabase
    .from("ml_tokens")
    .select("access_token, organization_id")
    .eq("ml_user_id", mlUserId)
    .not("access_token", "is", null)
    .limit(1)
    .maybeSingle();
  if (tokenErr || !tokenRow?.access_token) return null;
  if (tokenRow.organization_id) {
    const { data: isMember } = await supabase.rpc("is_org_member", {
      _user_id: claimsData.user.id,
      _org_id: tokenRow.organization_id,
    });
    if (!isMember) return null;
  }
  return tokenRow.access_token as string;
}

async function mlGet(path: string, mlToken: string) {
  const res = await fetch(`${ML_API}${path}`, {
    headers: { Authorization: `Bearer ${mlToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    console.error(`ML API error [${res.status}] ${path}:`, await res.text());
    return null;
  }
  return res.json();
}

// ── type=items: lista leve de anúncios ativos (para o seletor de produto) ───

async function fetchItemsBatched(itemIds: string[], attrs: string, mlToken: string) {
  // ML API limita /items?ids= a 20 elementos. Buscamos em chunks paralelos.
  const CHUNK = 20;
  const chunks: string[][] = [];
  for (let i = 0; i < itemIds.length; i += CHUNK) chunks.push(itemIds.slice(i, i + CHUNK));
  const results = await Promise.all(
    chunks.map((c) => mlGet(`/items?ids=${c.join(",")}&attributes=${attrs}`, mlToken)),
  );
  const items: any[] = [];
  for (const r of results) {
    if (Array.isArray(r)) {
      r.filter((x: any) => x.code === 200 && x.body?.id).forEach((x: any) => items.push(x.body));
    }
  }
  return items;
}

async function handleItemsList(mlUserId: string, mlToken: string) {
  // Paginar via search_type=scan para trazer todos os anúncios ativos
  // (ML limita /search regular a 1000 resultados; scan pagina via scroll_id).
  const MAX_ITEMS = 5000;
  const allIds: string[] = [];
  let scrollId: string | null = null;
  let total = 0;

  do {
    const url = scrollId
      ? `/users/${mlUserId}/items/search?search_type=scan&scroll_id=${encodeURIComponent(scrollId)}`
      : `/users/${mlUserId}/items/search?search_type=scan&status=active&limit=100`;
    const data = await mlGet(url, mlToken);
    if (!data?.results?.length) break;
    total = data.paging?.total ?? total;
    for (const id of data.results) {
      allIds.push(id);
      if (allIds.length >= MAX_ITEMS) break;
    }
    scrollId = data.scroll_id ?? null;
  } while (scrollId && allIds.length < MAX_ITEMS);

  if (!allIds.length) return jsonResponse({ items: [], total: 0 });

  const attrs = "id,title,thumbnail,price,listing_type_id,category_id";
  const rawItems = await fetchItemsBatched(allIds, attrs, mlToken);
  if (!rawItems.length) return jsonResponse({ items: [], total });

  const items = rawItems.map((item: any) => {
    const priceStandard: number = item.price ?? 0;
    return {
      item_id: item.id,
      title: item.title,
      thumbnail: item.thumbnail ?? "",
      price_standard: priceStandard,
      price_promo: null,
      price_sale: priceStandard,
      category_id: item.category_id ?? "",
      listing_type_id: item.listing_type_id ?? "",
      currency_id: "BRL",
      last_updated: null,
      has_promotion: false,
    };
  });

  return jsonResponse({ items, total: total || items.length });
}

// ── type=prices: preços dos anúncios ativos do vendedor ─────────────────────

async function handleItemPrices(mlUserId: string, mlToken: string) {
  const searchData = await mlGet(
    `/users/${mlUserId}/items/search?status=active&limit=50`,
    mlToken,
  );
  if (!searchData?.results?.length) return jsonResponse({ items: [], total: 0 });

  const itemIds: string[] = searchData.results.slice(0, 50);
  const attrs = "id,title,thumbnail,price,original_price,listing_type_id,category_id,status";
  const items = await fetchItemsBatched(itemIds, attrs, mlToken);
  if (!items.length) return jsonResponse({ items: [], total: searchData.paging?.total ?? 0 });

  const [priceResults, salePriceResults] = await Promise.all([
    Promise.allSettled(
      items.map((item: any) => mlGet(`/items/${item.id}/prices`, mlToken)),
    ),
    Promise.allSettled(
      items.map((item: any) =>
        mlGet(`/items/${item.id}/sale_price?context=channel_marketplace`, mlToken),
      ),
    ),
  ]);

  const enriched = items.map((item: any, i: number) => {
    const priceData =
      priceResults[i].status === "fulfilled" ? priceResults[i].value : null;
    const salePriceData =
      salePriceResults[i].status === "fulfilled" ? salePriceResults[i].value : null;
    const standardPrice = priceData?.prices?.find((p: any) => p.type === "standard");
    const promoPrice = priceData?.prices?.find((p: any) => p.type === "promotion");
    return {
      item_id: item.id,
      title: item.title,
      thumbnail: item.thumbnail ?? "",
      category_id: item.category_id ?? "",
      listing_type_id: item.listing_type_id ?? "",
      price_standard: standardPrice?.amount ?? item.price ?? 0,
      price_promo: promoPrice?.amount ?? null,
      price_sale: salePriceData?.amount ?? item.price ?? 0,
      currency_id: standardPrice?.currency_id ?? "BRL",
      last_updated: standardPrice?.last_updated ?? null,
      has_promotion: !!promoPrice,
    };
  });

  return jsonResponse({ items: enriched, total: searchData.paging?.total ?? enriched.length });
}

// ── type=costs: comissões por tipo de anúncio ───────────────────────────────

async function handleListingCosts(mlToken: string, params: URLSearchParams) {
  const price = params.get("price") ?? "100";
  const categoryId = params.get("category_id");
  const logisticType = params.get("logistic_type");
  const shippingMode = params.get("shipping_mode");

  let qs = `price=${price}&currency_id=BRL`;
  if (categoryId) qs += `&category_id=${categoryId}`;
  if (logisticType) qs += `&logistic_type=${logisticType}`;
  if (shippingMode) qs += `&shipping_mode=${shippingMode}`;

  const data = await mlGet(`/sites/MLB/listing_prices?${qs}`, mlToken);
  if (!data) return jsonResponse({ costs: [] });

  const RELEVANT = ["gold_pro", "gold_special", "free"];
  const costs = (Array.isArray(data) ? data : [data])
    .filter((c: any) => RELEVANT.includes(c.listing_type_id))
    .map((c: any) => ({
      listing_type_id: c.listing_type_id,
      listing_type_name: c.listing_type_name,
      listing_exposure: c.listing_exposure,
      sale_fee_amount: c.sale_fee_amount ?? 0,
      percentage_fee: c.sale_fee_details?.percentage_fee ?? 0,
      fixed_fee: c.sale_fee_details?.fixed_fee ?? 0,
      financing_add_on_fee: c.sale_fee_details?.financing_add_on_fee ?? 0,
      currency_id: c.currency_id ?? "BRL",
    }));

  return jsonResponse({ costs });
}

// ── type=sale_price: preço efetivo de venda (inclui promoções ativas) ────────
//   GET /items/{id}/sale_price?context=channel_marketplace
//   Retorna amount (preço que o comprador paga) e regular_amount (preço sem promoção)

async function handleSalePrice(mlToken: string, itemId: string) {
  const data = await mlGet(
    `/items/${itemId}/sale_price?context=channel_marketplace`,
    mlToken,
  );
  if (!data) return jsonResponse({ price_sale: null, price_regular: null });
  return jsonResponse({
    price_sale: data.amount ?? null,
    price_regular: data.regular_amount ?? null,
  });
}

// ── type=references: sugestão competitiva para um item específico ───────────
//   Com ?item_id=MLB123 → detalhe de um item
//   Sem item_id         → lista de itens que possuem sugestão (bulk)

async function handlePriceReferences(mlUserId: string, mlToken: string, itemId?: string) {
  // ── Modo item único ─────────────────────────────────────────────────────────
  if (itemId) {
    const detail = await mlGet(`/suggestions/items/${itemId}/details`, mlToken);
    if (!detail) return jsonResponse({ reference: null, no_suggestion: true });

    return jsonResponse({
      reference: {
        item_id: itemId,
        status: detail.status ?? "no_benchmark_ok",
        currency_id: detail.currency_id ?? "BRL",
        current_price: detail.current_price?.amount ?? 0,
        suggested_price: detail.suggested_price?.amount ?? null,
        lowest_price: detail.lowest_price?.amount ?? null,
        internal_price: detail.internal_price?.amount ?? null,
        percent_difference: detail.percent_difference ?? 0,
        applicable_suggestion: detail.applicable_suggestion ?? false,
        selling_fees: detail.costs?.selling_fees ?? 0,
        shipping_fees: detail.costs?.shipping_fees ?? 0,
        graph: detail.metadata?.graph ?? [],
        compared_values: detail.metadata?.compared_values ?? 0,
        last_updated: detail.last_updated ?? null,
      },
    });
  }

  // ── Modo bulk: lista de itens com sugestão ──────────────────────────────────
  const suggestionsData = await mlGet(`/suggestions/user/${mlUserId}/items`, mlToken);
  if (!suggestionsData?.items?.length) return jsonResponse({ references: [] });

  const itemIds: string[] = suggestionsData.items.slice(0, 20);

  const batchData = await mlGet(
    `/items?ids=${itemIds.join(",")}&attributes=id,title,thumbnail,listing_type_id`,
    mlToken,
  );
  const itemMap: Record<string, { title: string; thumbnail: string; listing_type_id: string }> = {};
  if (Array.isArray(batchData)) {
    batchData
      .filter((r: any) => r.code === 200 && r.body?.id)
      .forEach((r: any) => {
        itemMap[r.body.id] = {
          title: r.body.title,
          thumbnail: r.body.thumbnail ?? "",
          listing_type_id: r.body.listing_type_id ?? "",
        };
      });
  }

  const detailResults = await Promise.allSettled(
    itemIds.map((id) => mlGet(`/suggestions/items/${id}/details`, mlToken)),
  );

  const references = itemIds
    .map((id, i) => {
      const detail = detailResults[i].status === "fulfilled" ? detailResults[i].value : null;
      if (!detail) return null;
      const item = itemMap[id] ?? { title: id, thumbnail: "", listing_type_id: "" };
      return {
        item_id: id,
        title: item.title,
        thumbnail: item.thumbnail,
        listing_type_id: item.listing_type_id,
        status: detail.status ?? "no_benchmark_ok",
        currency_id: detail.currency_id ?? "BRL",
        current_price: detail.current_price?.amount ?? 0,
        suggested_price: detail.suggested_price?.amount ?? null,
        lowest_price: detail.lowest_price?.amount ?? null,
        percent_difference: detail.percent_difference ?? 0,
        applicable_suggestion: detail.applicable_suggestion ?? false,
        selling_fees: detail.costs?.selling_fees ?? 0,
        shipping_fees: detail.costs?.shipping_fees ?? 0,
        graph: detail.metadata?.graph ?? [],
        compared_values: detail.metadata?.compared_values ?? 0,
        last_updated: detail.last_updated ?? null,
      };
    })
    .filter(Boolean);

  return jsonResponse({ references });
}

// ── Main ────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const mlUserIdRaw = url.searchParams.get("ml_user_id");
    const type = url.searchParams.get("type") ?? "prices";

    const mlUserIdParsed = z.string().min(1).safeParse(mlUserIdRaw);
    if (!mlUserIdParsed.success) return jsonResponse({ error: "ml_user_id required" }, 400);
    const mlUserId = mlUserIdParsed.data;

    const mlToken = await getUserAndToken(req, supabase, mlUserId);
    if (!mlToken) return jsonResponse({ error: "Unauthorized or no ML token" }, 401);

    console.log(`ml-precos-custos: type=${type} store=${mlUserId}`);

    if (type === "items")       return handleItemsList(mlUserId, mlToken);
    if (type === "prices")      return handleItemPrices(mlUserId, mlToken);
    if (type === "costs")      return handleListingCosts(mlToken, url.searchParams);
    if (type === "references") {
      const itemId = url.searchParams.get("item_id") ?? undefined;
      return handlePriceReferences(mlUserId, mlToken, itemId);
    }
    if (type === "sale_price") {
      const itemId = url.searchParams.get("item_id");
      if (!itemId) return jsonResponse({ error: "item_id required" }, 400);
      return handleSalePrice(mlToken, itemId);
    }

    return jsonResponse({ error: "Unknown type" }, 400);
  } catch (err) {
    console.error("ml-precos-custos error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
