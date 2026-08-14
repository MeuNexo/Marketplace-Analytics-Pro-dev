import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeOrderTax, type TabelaDifal } from "../_shared/orderTaxRate.ts";
import { montarTabelaAliquotas } from "../_shared/tabelaUf.ts";
import {
  resolverConfigVigente,
  type LinhaTaxConfigVigencia,
} from "../_shared/taxConfigVigente.ts";

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
    const {
      ml_user_ids,
      date_from,
      date_to,
      organization_id,
      only_missing = true,
      // [222-05-R] Orçamento de páginas de leitura. Ver o laço de paginação
      // abaixo: 5 páginas × 1000 = 5.000 pedidos por invocação, folgado para
      // um mês de qualquer uma das duas lojas. O chamador aumenta quando
      // quiser, e sabe se sobrou trabalho pela marca `truncado` da resposta.
      max_paginas = 5,
    } = body;
    if (!Array.isArray(ml_user_ids) || !ml_user_ids.length || !date_from || !date_to) {
      return new Response(JSON.stringify({ success: false, error: "Missing params" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load tax configs for all stores
    //
    // [222-05-R] Mapa de LISTAS, não mais de um valor por loja: com mais de
    // uma vigência, o `set` antigo sobrescrevia e ficava com a ÚLTIMA linha do
    // array — uma escolha calada, exatamente o tipo de coisa que o resto desta
    // fase combate. A escolha específica passou para dentro do laço, por
    // pedido, com a data do pedido em mãos.
    const { data: taxConfigs } = await supabase
      .from("ml_tax_config")
      .select("*")
      .in("ml_user_id", ml_user_ids)
      .eq("organization_id", organization_id);
    const taxByStore = new Map<string, LinhaTaxConfigVigencia[]>();
    for (const c of (taxConfigs ?? []) as LinhaTaxConfigVigencia[]) {
      const lista = taxByStore.get(String(c.ml_user_id)) ?? [];
      lista.push(c);
      taxByStore.set(String(c.ml_user_id), lista);
    }

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
    //
    // [222-05-R] `data_pedido` entrou na projeção. A coluna era usada só no
    // filtro de janela e NÃO vinha selecionada — sem ela o pedido não carrega
    // a própria data para dentro do laço, e a resolução por competência seria
    // impossível nesta função (sobraria usar o fim do lote como aproximação, o
    // mesmo erro que o desenho de `tabelaUf` evita de propósito). A coluna é
    // TEXT e linhas antigas podem trazer carimbo de hora — a normalização já
    // está em `resolverConfigVigente`, não é replicada aqui.
    const montarQuery = () => {
      let q = supabase
        .from("orders")
        .select("id, ml_order_id, ml_user_id, item_id, sku, quantidade, preco_unit, comissao, frete, receita_bruta, estado, custo_unit, custo_unit_cheio, tax_rate, tax_amount, uf_origem, tax_versao, data_pedido")
        .in("ml_user_id", ml_user_ids)
        .gte("data_pedido", date_from)
        .lte("data_pedido", date_to)
        // Ordem estável: sem ela, páginas consecutivas podem repetir e pular
        // linhas, e a cobertura provada da resposta viraria ficção.
        .order("id", { ascending: true });
      if (only_missing) {
        // Fase 96-07 (Trava A): `custo_unit_cheio.is.null` faz parte do
        // predicado. Sem ele, um pedido com custo_unit (médio) JÁ preenchido e
        // custo_unit_cheio NULL nunca entrava no SELECT — a função sabia gravar
        // o cheio (costFullBySku/patch abaixo), mas nunca enxergava as linhas
        // que precisavam dele. Era este filtro, e não a falta do código de
        // escrita, que congelava a cobertura do cheio: pedido novo nasce com
        // médio+imposto via sync, então o predicado antigo já dava "nada
        // faltando" e o cheio ficava NULL para sempre. É a causa raiz dos
        // 32,9% de cobertura em julho (contra 94,9% do médio).
        //
        // Fase 222 (222-05): `tax_versao.is.null,tax_versao.lt.2` entra pelo
        // MESMO motivo, sobre o mesmo padrão — sem isto, um pedido já com
        // tax_amount preenchido pela régua ANTIGA (alíquota única, sem
        // créditos) nunca reentraria neste SELECT, e a cobertura da régua nova
        // congelaria exatamente como congelou a do custo cheio na Fase 96-07.
        q = q.or("custo_unit.is.null,custo_unit_cheio.is.null,tax_amount.is.null,tax_versao.is.null,tax_versao.lt.2");
      }
      return q;
    };

    // ── Leitura PAGINADA (Fase 222, 222-05-R) ────────────────────────────────
    // O teto de linhas por requisição do PostgREST neste projeto é 1000
    // (feedback_postgrest_pagination). Sem recorte de faixa, a janela mai→ago
    // da Pé Vermeio (3.516 pedidos) era lida pela metade: a função processava
    // 1000, devolvia `scanned: 1000` e `success: true`, e ninguém via os 72%
    // que ficaram. É a mesma assinatura dos 32,9% de cobertura da Fase 96-07 —
    // sucesso declarado sobre trabalho incompleto.
    //
    // Quando o orçamento de páginas acaba com a última página CHEIA, a
    // resposta diz `truncado: true`: sobrou trabalho, e o chamador tem de
    // invocar de novo. Silêncio aqui é o defeito, não a paginação.
    //
    // ⚠️ Reinvocar só avança de verdade com `only_missing: true` — aí o
    // predicado exclui o que já foi gravado e a próxima chamada pega o resto.
    // Com `only_missing: false`, reinvocar relê a MESMA primeira página: quem
    // quiser reprocessar tudo à força tem de aumentar `max_paginas` em vez de
    // repetir a chamada.
    const TAMANHO_PAGINA = 1000;
    const orcamentoPaginas = Math.max(1, Number(max_paginas) || 1);
    const rows: any[] = [];
    let paginasLidas = 0;
    let truncado = false;
    for (let pagina = 0; pagina < orcamentoPaginas; pagina++) {
      const inicio = pagina * TAMANHO_PAGINA;
      const { data: pageData, error: oerr } = await montarQuery()
        .range(inicio, inicio + TAMANHO_PAGINA - 1);
      if (oerr) throw oerr;
      const lidas = pageData ?? [];
      paginasLidas++;
      rows.push(...lidas);
      if (lidas.length < TAMANHO_PAGINA) break;            // acabou de verdade
      if (pagina === orcamentoPaginas - 1) truncado = true; // orçamento acabou antes
    }

    let updated = 0;
    let costMissing = 0;
    let taxMissing = 0;
    // [222-05-R] Pedidos de loja COM config cadastrada, mas sem nenhuma
    // vigência cobrindo a data deles. Esta função não escreve
    // `receita_liquida`, então aqui a consequência é só de medição — mas é a
    // contagem que permite ao orquestrador saber se o backfill terminou.
    let semVigencia = 0;

    // Batch updates serially in chunks
    const CHUNK = 100;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      await Promise.all(slice.map(async (o: any) => {
        // [222-05-R] A config é resolvida POR PEDIDO, pela data DELE — a
        // janela de um recálculo cruza meses, e usar o fim do lote como
        // referência é o que regravou 352 pedidos do Junior com a alíquota
        // errada. `config: null` quando nenhuma vigência cobre: nenhum motivo
        // novo entra no tipo da fórmula, a ausência que `computeOrderTax` já
        // sabe produzir basta, e a distinção é contada aqui.
        const vigencias = taxByStore.get(String(o.ml_user_id)) ?? [];
        const cfg = resolverConfigVigente(vigencias, o.data_pedido);
        if (vigencias.length > 0 && cfg === null) semVigencia++;
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
        // [222-05-R] Cobertura declarada, não presumida. `truncado: true`
        // significa que o orçamento de páginas acabou com a última página
        // cheia — SOBROU TRABALHO, invocar de novo. Sem isto, a resposta
        // dizia sucesso sobre 28% da janela.
        truncado,
        paginas_lidas: paginasLidas,
        // Pedidos de loja com config cadastrada e nenhuma vigência cobrindo a
        // data — distinto de `tax_missing`, que também conta loja sem config.
        tax_sem_vigencia: semVigencia,
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