import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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
      // Formula: ICMS + (1 - ICMS%) × (PIS 1.65% + COFINS 7.60%)
      const baseFactor = 1 - icms / 100;
      return Math.max(0, icms + baseFactor * (1.65 + 7.60));
    }
  }
  return 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    // Service-role client (no user JWT — required to bypass RLS on UPDATE)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve caller user
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { ml_user_ids, date_from, date_to, organization_id, only_missing = true } = body;
    if (!Array.isArray(ml_user_ids) || !ml_user_ids.length || !date_from || !date_to) {
      return new Response(JSON.stringify({ success: false, error: "Missing params" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load tax configs for all stores
    const { data: taxConfigs } = await supabase
      .from("ml_tax_config")
      .select("*")
      .in("ml_user_id", ml_user_ids)
      .eq("organization_id", organization_id);
    const taxByStore = new Map<string, any>();
    for (const c of taxConfigs ?? []) taxByStore.set(c.ml_user_id, c);

    // Load product costs: indexa por seller_sku (formato Tiny) E por item_id (formato ML, legado)
    const { data: costs } = await supabase
      .from("ml_product_costs")
      .select("item_id, seller_sku, cost, cost_full")
      .or(`organization_id.eq.${organization_id},organization_id.is.null`);
    const costBySku = new Map<string, number>();  // seller_sku → cost
    const costByItem = new Map<string, number>(); // item_id ML → cost (legado)
    const costFullBySku = new Map<string, number>(); // seller_sku → cost_full (preço de custo cheio)
    for (const c of costs ?? []) {
      if (c.cost != null) {
        if (c.seller_sku) costBySku.set(c.seller_sku, Number(c.cost));
        // item_id com prefixo TINY_ → ignorar como item_id ML direto
        if (c.item_id && !c.item_id.startsWith("TINY_")) costByItem.set(c.item_id, Number(c.cost));
      }
      if (c.cost_full != null && c.seller_sku) costFullBySku.set(c.seller_sku, Number(c.cost_full));
    }

    // Pull orders in window
    let query = supabase
      .from("orders")
      .select("id, ml_order_id, ml_user_id, item_id, sku, quantidade, preco_unit, estado, custo_unit, custo_unit_cheio, tax_rate, tax_amount, uf_origem")
      .in("ml_user_id", ml_user_ids)
      .gte("data_pedido", date_from)
      .lte("data_pedido", date_to);
    if (only_missing) {
      query = query.or("custo_unit.is.null,tax_amount.is.null");
    }
    const { data: ordersData, error: oerr } = await query;
    if (oerr) throw oerr;

    let updated = 0;
    let costMissing = 0;
    let taxMissing = 0;

    // Batch updates serially in chunks
    const CHUNK = 100;
    const rows = ordersData ?? [];
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      await Promise.all(slice.map(async (o: any) => {
        const cfg = taxByStore.get(o.ml_user_id);
        // Prioridade: seller_sku (Tiny) → item_id ML direto (legado)
        const cost = (o.sku ? costBySku.get(o.sku) : undefined) ?? costByItem.get(o.item_id) ?? null;
        const costFull = o.sku ? costFullBySku.get(o.sku) ?? null : null;
        const taxRate = cfg ? computeOrderTaxRate(cfg, o.estado) : null;
        const preco = Number(o.preco_unit ?? 0);
        const qty = Number(o.quantidade ?? 0);
        const taxAmount = (taxRate != null && preco) ? (preco * qty * taxRate) / 100 : null;
        const ufOrigem = cfg?.uf_origem ?? null;

        if (cost == null) costMissing++;
        if (taxRate == null) taxMissing++;

        const patch: Record<string, unknown> = {};
        if (cost != null) patch.custo_unit = cost;
        if (costFull != null) patch.custo_unit_cheio = costFull;
        if (taxRate != null) patch.tax_rate = taxRate;
        if (taxAmount != null) patch.tax_amount = taxAmount;
        if (ufOrigem) patch.uf_origem = ufOrigem;
        if (Object.keys(patch).length === 0) return;

        const { error: uerr } = await supabase
          .from("orders")
          .update(patch)
          .eq("id", o.id);
        if (!uerr) updated++;
      }));
    }

    return new Response(
      JSON.stringify({
        success: true,
        scanned: rows.length,
        updated,
        cost_missing: costMissing,
        tax_missing: taxMissing,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("recalc-order-costs error:", err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});