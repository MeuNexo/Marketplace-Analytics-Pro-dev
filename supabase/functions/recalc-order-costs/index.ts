import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeOrderTax, type TabelaDifal } from "../_shared/orderTaxRate.ts";
import { montarTabelaAliquotas } from "../_shared/tabelaUf.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

    // ── Tabela de alíquota interna + FCP por UF (Fase 222, TAX-01/02) ────────
    // UMA leitura por rodada — nunca uma por pedido dentro do laço abaixo.
    // date_to é "a data do lote", mesma referência de vigência do sync. Se a
    // chamada falhar, segue com tabela vazia — o DIFAL sai ausente (nunca
    // zero) e a view de saúde do 222-05 mostra; abortar o recálculo inteiro
    // por causa do DIFAL seria pior que a ausência.
    let tabelaUf: TabelaDifal = {};
    {
      const { data: linhasUf, error: erroUf } = await supabase.rpc(
        "aliquota_interna_vigente",
        { p_data: date_to },
      );
      if (erroUf) {
        console.warn(
          `recalc-order-costs: aliquota_interna_vigente falhou (${erroUf.message}) — seguindo com tabela de UF vazia`,
        );
      } else {
        tabelaUf = montarTabelaAliquotas(linhasUf ?? []);
      }
    }

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
      // Fase 96-07: custo_unit_cheio nunca é derivado de custo_unit (médio) —
      // vem só de ml_product_costs.cost_full (precoCusto do Tiny, lido separado).
      if (c.cost_full != null && c.seller_sku) costFullBySku.set(c.seller_sku, Number(c.cost_full));
    }

    // Pull orders in window
    let query = supabase
      .from("orders")
      .select("id, ml_order_id, ml_user_id, item_id, sku, quantidade, preco_unit, comissao, frete, receita_bruta, estado, custo_unit, custo_unit_cheio, tax_rate, tax_amount, uf_origem, tax_versao")
      .in("ml_user_id", ml_user_ids)
      .gte("data_pedido", date_from)
      .lte("data_pedido", date_to);
    if (only_missing) {
      // Fase 96-07 (Trava A): `custo_unit_cheio.is.null` faz parte do predicado.
      // Sem ele, um pedido com custo_unit (médio) JÁ preenchido e
      // custo_unit_cheio NULL nunca entrava no SELECT — a função sabia gravar o
      // cheio (costFullBySku/patch abaixo), mas nunca enxergava as linhas que
      // precisavam dele. Era este filtro, e não a falta do código de escrita,
      // que congelava a cobertura do cheio: pedido novo nasce com médio+imposto
      // via sync, então o predicado antigo já dava "nada faltando" e o cheio
      // ficava NULL para sempre. É a causa raiz dos 32,9% de cobertura em julho
      // (contra 94,9% do médio).
      //
      // Fase 222 (222-05): `tax_versao.is.null,tax_versao.lt.2` entra pelo
      // MESMO motivo, sobre o mesmo padrão — sem isto, um pedido já com
      // tax_amount preenchido pela régua ANTIGA (alíquota única, sem
      // créditos) nunca reentraria neste SELECT, e a cobertura da régua nova
      // congelaria exatamente como congelou a do custo cheio na Fase 96-07.
      query = query.or("custo_unit.is.null,custo_unit_cheio.is.null,tax_amount.is.null,tax_versao.is.null,tax_versao.lt.2");
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
        const cfg = taxByStore.get(o.ml_user_id) ?? null;
        // Prioridade: seller_sku (Tiny) → item_id ML direto (legado)
        const cost = (o.sku ? costBySku.get(o.sku) : undefined) ?? costByItem.get(o.item_id) ?? null;
        const costFull = o.sku ? costFullBySku.get(o.sku) ?? null : null;
        const preco = Number(o.preco_unit ?? 0);
        const qty = Number(o.quantidade ?? 0);

        // Fase 222 (TAX-01/02): a MESMA função compartilhada de
        // sync-ml-orders — a segunda porta de escrita do imposto recebe a
        // mesma troca, no mesmo commit. receita_bruta prioriza a coluna já
        // gravada (Fase 222-04); pedido antigo sem ela cai para preço × qtd.
        const receitaBruta = o.receita_bruta != null
          ? Number(o.receita_bruta)
          : (preco ? preco * qty : null);
        const comissao = o.comissao != null ? Number(o.comissao) : null;
        const frete = o.frete != null ? Number(o.frete) : null;
        const breakdown = computeOrderTax({
          config: cfg,
          ufDestino: o.estado,
          receitaBruta,
          comissao,
          frete,
          tabelaUf,
        });
        const taxRate = breakdown.taxRate;
        const taxAmount = breakdown.taxAmount;
        const ufOrigem = cfg?.uf_origem ?? null;

        if (cost == null) costMissing++;
        if (taxRate == null) taxMissing++;

        const patch: Record<string, unknown> = {};
        if (cost != null) patch.custo_unit = cost;
        if (costFull != null) patch.custo_unit_cheio = costFull;
        if (taxRate != null) patch.tax_rate = taxRate;
        // Componentes fiscais: mesmo padrão de "só grava campo não nulo" dos
        // demais campos deste patch. tax_versao anda SEMPRE junto de
        // tax_amount — nunca marcar a linha como régua nova (2) sem
        // efetivamente gravar o imposto desta rodada, senão a view de saúde
        // do 222-05 mentiria sobre quanto do passado já migrou.
        if (taxAmount != null) {
          patch.tax_amount = taxAmount;
          patch.tax_versao = 2;
        }
        if (breakdown.icmsDebito != null) patch.icms_debito = breakdown.icmsDebito;
        if (breakdown.pisCofinsDebito != null) patch.pis_cofins_debito = breakdown.pisCofinsDebito;
        if (breakdown.creditoPcComissao != null) patch.credito_pc_comissao = breakdown.creditoPcComissao;
        if (breakdown.creditoPcFrete != null) patch.credito_pc_frete = breakdown.creditoPcFrete;
        if (breakdown.creditoIcmsFrete != null) patch.credito_icms_frete = breakdown.creditoIcmsFrete;
        if (breakdown.pisCofinsDebitoComDifal != null) patch.pis_cofins_debito_com_difal = breakdown.pisCofinsDebitoComDifal;
        if (breakdown.difalBase != null) patch.difal_base = breakdown.difalBase;
        if (breakdown.difalAmount != null) patch.difal_amount = breakdown.difalAmount;
        if (breakdown.fcpAmount != null) patch.fcp_amount = breakdown.fcpAmount;
        if (breakdown.difalFonte != null) patch.difal_fonte = breakdown.difalFonte;
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