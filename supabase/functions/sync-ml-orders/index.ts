import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { computeOrderTax, type TabelaAliquotasInternas } from "../_shared/orderTaxRate.ts";
import { montarTabelaAliquotas } from "../_shared/tabelaUf.ts";
import {
  extrairLogisticType,
  ehFlex,
  extrairBonusEnvio,
  ratearPorReceita,
  computeReceitaLiquida,
} from "../_shared/flexOrder.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ML_API = "https://api.mercadolibre.com";
const DAY_MS = 24 * 60 * 60 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

// 2026-08-06 (fix frete mudo): mesmo buraco corrigido em sync-ml-billing
// (fetchPage, commit 80ad218b) — AbortSignal.timeout lanca excecao, nao
// devolve status, entao escapava direto do `if (res.status === 429 ...)`
// que existia antes e nunca fazia uma segunda tentativa. Agora o fetch fica
// dentro de try/catch proprio, com ate 5 tentativas e backoff crescente
// (1_500 * (tentativa + 1)) tanto na excecao quanto em 429/5xx. Erro de
// cliente (4xx que nao seja 429, ou JSON invalido) lanca direto — nao se
// resolve tentando de novo.
async function mlFetch(path: string, accessToken: string, timeoutMs = 15_000) {
  let ultimoErro = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${ML_API}${path}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      ultimoErro = e instanceof Error ? e.message : String(e);
      console.warn(`mlFetch ${path}: ${ultimoErro} (tentativa ${attempt + 1}/5)`);
      await sleep(1_500 * (attempt + 1));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      ultimoErro = `status ${res.status}`;
      console.warn(`mlFetch ${path}: ${ultimoErro} (tentativa ${attempt + 1}/5)`);
      await sleep(1_500 * (attempt + 1));
      continue;
    }
    const data = await res.json();
    if (!res.ok) {
      console.error(`ML API error [${path}]:`, data);
      throw new Error(data.message || `ML API error: ${res.status}`);
    }
    return data;
  }
  throw new Error(`mlFetch ${path}: falhou apos 5 tentativas (ultimo erro: ${ultimoErro})`);
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

  // NOTA: esta busca janela por `order.date_created`. Cancelamentos que
  // acontecem depois da captura NÃO chegam por aqui — ver reconcileCancelled().

  // Se batemos no teto de offset, divide a janela em duas e recursa
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

// ── Reconciliação de cancelamentos tardios ───────────────────────────────────
// Pergunta ao ML quais pedidos da janela estão cancelados e corrige no banco os
// que ainda constam com outro status. Necessário porque fetchOrdersPage janela
// por `date_created`: um pedido cancelado depois da captura inicial nunca
// reaparece e o status congela.
//
// Busca com `order.status=cancelled` em vez de varrer por `last_updated` — o
// conjunto de cancelados é uma fração pequena do total, então isso custa poucas
// páginas em vez de reprocessar milhares de pedidos inalterados.
async function reconcileCancelled(
  mlNumericId: number,
  rangeStart: Date,
  rangeEnd: Date,
  accessToken: string,
  supabaseAdmin: any,
  organizationId: string | null,
): Promise<number> {
  if (!organizationId) return 0;

  const PAGE_SIZE = 50;
  const MAX_OFFSET = 1000;
  const ids: string[] = [];
  let offset = 0;

  try {
    while (offset < MAX_OFFSET) {
      const url =
        `/orders/search?seller=${mlNumericId}` +
        `&order.date_created.from=${encodeURIComponent(rangeStart.toISOString())}` +
        `&order.date_created.to=${encodeURIComponent(rangeEnd.toISOString())}` +
        `&order.status=cancelled&sort=date_desc&limit=${PAGE_SIZE}&offset=${offset}`;

      const data = await mlFetch(url, accessToken);
      const results: any[] = data.results || [];
      for (const o of results) ids.push(String(o.id));

      const apiTotal = data.paging?.total || 0;
      offset += results.length;
      if (results.length < PAGE_SIZE || offset >= apiTotal) break;
    }
  } catch (err) {
    // Reconciliação é complementar: se falhar, o sync principal já gravou os
    // pedidos. Registra e segue — não derruba o job inteiro por causa dela.
    console.error("reconcileCancelled: falha ao buscar cancelados no ML:", err);
    return 0;
  }

  if (ids.length === 0) return 0;

  // Corrige em lotes; só toca em quem está com status diferente, para que
  // `updated` reflita cancelamentos que o sync tinha perdido de verdade.
  let corrigidos = 0;
  const LOTE = 200;
  for (let i = 0; i < ids.length; i += LOTE) {
    const lote = ids.slice(i, i + LOTE);
    const { data, error } = await supabaseAdmin
      .from("orders")
      .update({ status: "cancelled" })
      .eq("organization_id", organizationId)
      .in("ml_order_id", lote)
      .neq("status", "cancelled")
      .select("ml_order_id");

    if (error) {
      console.error("reconcileCancelled: falha ao atualizar lote:", error.message);
      continue;
    }
    corrigidos += (data ?? []).length;
  }

  return corrigidos;
}

// ── Batch-fetch shipment details from /shipments/{id} ────────────────────────
// Fetches ALL unique shipment IDs (not just frete grátis) to get:
//   • base_cost  → seller-absorbed shipping cost (frete grátis / Full)
//   • receiver_address → estado (UF) + cidade
// /orders/search does NOT return receiver_address; it is only in /shipments/{id}.

interface ShipmentDetail {
  cost:         number | null;
  estado:       string | null;
  cidade:       string | null;
  // Flex (Fase 222, FLEX-01/03): tipo logistico na raiz do MESMO payload
  // (zero requisicao nova) e bonus de envio, que exige 1 requisicao a mais
  // por envio self_service — nunca para os outros tipos (guarda ehFlex).
  logisticType: string | null;
  bonusEnvio:   number | null;
}

async function fetchShipmentDetails(
  orders: any[],
  accessToken: string,
  maxShipments = 500,
  // Pedidos que JA tem frete e endereco no banco. Sincronizacao incremental:
  // o cron do dia corrente roda de hora em hora, e sem isto cada rodada
  // rebuscava o detalhe de TODOS os pedidos do dia — as 22h, um dia com 100
  // pedidos custava 100 chamadas, sendo que 95 nao mudaram desde as 8h.
  //
  // Seguro porque frete e endereco de envio sao definidos na criacao do envio e
  // nao mudam depois. Se um dia mudarem, o pedido volta a ser buscado assim que
  // o backfill limpar o campo — a regra e "ja tenho o dado", nao "ja vi este id".
  jaCompletos: Set<string> = new Set(),
): Promise<{
  detailMap: Map<number, ShipmentDetail>;
  attempted: number;
  failed: number;
  // Flex (Fase 222): silencio foi o que deixou o imposto errado viver quatro
  // meses (Fase 220) — os tres contadores viajam ate a resposta do sync.
  flexSelfService:   number;
  flexBonusResolved: number;
  flexBonusFailed:   number;
}> {
  const detailMap = new Map<number, ShipmentDetail>();

  // Collect ALL unique shipment IDs
  const seen = new Set<number>();
  const ids: number[] = [];
  let pulados = 0;
  for (const order of orders) {
    if (jaCompletos.has(String(order.id))) { pulados++; continue; }
    const shipId = order.shipping?.id ? Number(order.shipping.id) : null;
    if (shipId && !seen.has(shipId)) {
      seen.add(shipId);
      ids.push(shipId);
      if (ids.length >= maxShipments) break;
    }
  }
  if (pulados > 0) {
    console.log(`fetchShipmentDetails: ${pulados} pedido(s) pulado(s) — frete e endereco ja no banco`);
  }

  if (!ids.length) {
    return { detailMap, attempted: 0, failed: 0, flexSelfService: 0, flexBonusResolved: 0, flexBonusFailed: 0 };
  }
  console.log(`Fetching ${ids.length} shipments for cost + address…`);

  // 2026-08-06 (fix frete mudo, T-219-09): rejeicao de `Promise.allSettled`
  // antes era descartada em silencio — nenhum log, nenhum contador. Agora
  // toda rejeicao vira console.warn com o id do envio, e a funcao devolve
  // quantos envios foram tentados e quantos falharam, para o chamador
  // repassar na resposta do sync (shipments_total/shipments_failed).
  let failed = 0;
  let flexSelfService = 0;
  let flexBonusResolved = 0;
  let flexBonusFailed = 0;
  const CONCURRENCY = 10;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (id) => {
        // NAO usar o cabecalho de formato novo aqui: com ele logistic_type/
        // mode/shipping_option voltam null (item 5 do Veredito,
        // 222-ML-API.md) — armadilha medida, nunca "otimizar" isto.
        const s = await mlFetch(`/shipments/${id}`, accessToken, 8_000);

        // Seller-absorbed shipping cost — usa list_cost (mesmo que nexo-mcp)
        const cost = s.shipping_option?.list_cost ?? s.base_cost ?? null;

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

        // Flex (FLEX-01/03): logistic_type ja veio no MESMO payload acima —
        // zero requisicao nova. O bonus exige 1 requisicao a mais, e SO
        // acontece atras da guarda ehFlex — 2,6% dos pedidos na Pe Vermeio,
        // 19,8% no Junior (222-ML-API.md). `frete IS NULL` NAO e sinonimo de
        // Flex: ler o bonus de um envio que nao e self_service inventaria
        // receita (achado medido, mesmo documento).
        const logisticType = extrairLogisticType(s);
        let bonusEnvio: number | null = null;
        let bonusStatus: "nao_flex" | "resolvido" | "falho" = "nao_flex";
        if (ehFlex(logisticType)) {
          try {
            const custos = await mlFetch(`/shipments/${id}/costs`, accessToken, 8_000);
            bonusEnvio = extrairBonusEnvio(custos);
            bonusStatus = "resolvido";
          } catch (err) {
            // Falha na chamada de custos NAO derruba o envio: tipo logistico,
            // custo e endereco continuam sendo gravados. bonusEnvio fica
            // null — nunca zero por falha de rede.
            const motivo = err instanceof Error ? err.message : String(err);
            console.warn(`fetchShipmentDetails: /shipments/${id}/costs falhou — ${motivo}`);
            bonusStatus = "falho";
          }
        }

        return {
          id,
          cost: cost != null ? Number(cost) : null,
          estado,
          cidade,
          logisticType,
          bonusEnvio,
          bonusStatus,
        };
      }),
    );
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled") {
        if (r.value.bonusStatus !== "nao_flex") flexSelfService++;
        if (r.value.bonusStatus === "resolvido") flexBonusResolved++;
        if (r.value.bonusStatus === "falho") flexBonusFailed++;

        detailMap.set(r.value.id, {
          // 2026-08-11: o `> 0` daqui transformava frete ZERO em null e era a
          // causa dos pedidos "sem frete". Envio self_service (Mercado Envios
          // Flex) devolve base_cost/list_cost = 0 — o vendedor nao paga frete
          // ao ML —, e zero e um valor CONHECIDO, nao ausencia. Virar null
          // apagava essa informacao: na conta Junior eram 13,2% dos pedidos
          // abaixo de R$ 79 (medido 11/08). Prova de que era determinístico e
          // nao falha de rede: reprocessar o dia nao recuperava nenhum, e o
          // banco inteiro — 3 contas, centenas de milhares de pedidos — nao
          // tinha UM unico frete = 0. A Pe Vermeio era imune por ser toda
          // fulfillment, onde o custo e sempre positivo.
          // `r.value.cost` ja e null quando o campo vem ausente da API.
          cost:         r.value.cost,
          estado:       r.value.estado,
          cidade:       r.value.cidade,
          logisticType: r.value.logisticType,
          bonusEnvio:   r.value.bonusEnvio,
        });
      } else if (r.status === "rejected") {
        failed++;
        const shipId = batch[j];
        const motivo = r.reason instanceof Error ? r.reason.message : String(r.reason);
        console.warn(`fetchShipmentDetails: envio ${shipId} rejeitado — ${motivo}`);
      }
    }
  }

  console.log(
    `Shipment details resolved: ${detailMap.size} / ${ids.length} (falhas: ${failed}); ` +
    `Flex self_service: ${flexSelfService} (bonus resolvido: ${flexBonusResolved}, falho: ${flexBonusFailed})`,
  );
  return { detailMap, attempted: ids.length, failed, flexSelfService, flexBonusResolved, flexBonusFailed };
}

// ── Batch-fetch brand names from /items?ids=... ───────────────────────────────
// ML API allows up to 20 IDs per request.
// Returns Map<item_id, marca_name | null>

async function fetchItemBrands(
  itemIds: string[],
  accessToken: string,
): Promise<Map<string, string | null>> {
  const brandMap = new Map<string, string | null>();
  if (itemIds.length === 0) return brandMap;

  const BATCH_SIZE = 20;
  for (let i = 0; i < itemIds.length; i += BATCH_SIZE) {
    const batch = itemIds.slice(i, i + BATCH_SIZE);
    try {
      const items = await mlFetch(
        `/items?ids=${batch.join(",")}`,
        accessToken,
        15_000,
      );
      const results: any[] = Array.isArray(items) ? items : [];
      for (const entry of results) {
        const item = entry.body ?? entry;
        if (!item?.id) continue;
        const itemId = String(item.id);
        const brandAttr = (item.attributes ?? []).find(
          (a: any) => a.id === "BRAND",
        );
        brandMap.set(itemId, brandAttr?.value_name ?? null);
      }
    } catch (err) {
      console.warn(`fetchItemBrands batch ${i}-${i + BATCH_SIZE} failed:`, err);
      for (const id of batch) {
        if (!brandMap.has(id)) brandMap.set(id, null);
      }
    }
  }

  return brandMap;
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
  brandMap:       Map<string, string | null>,
  skuCostMap:     Map<string, number>,
  skuCostFullMap: Map<string, number>,
  // Régua fiscal decomposta (Fase 222, TAX-01/02): tabela de alíquota
  // interna + FCP por UF, carregada UMA vez por rodada pelo chamador —
  // nunca uma chamada por pedido dentro deste laço.
  tabelaUf:       TabelaAliquotasInternas,
): Array<Record<string, unknown>> {
  // Converter para BRT (UTC-3) antes de extrair a data: o range de sync usa meia-noite BRT,
  // e o cliente filtra por data BRT — armazenar em UTC causava desvio de um dia nas bordas.
  const toBRT = (iso: string | null | undefined): string | null => {
    if (!iso) return null;
    const brtMs = new Date(iso).getTime() - 3 * 60 * 60 * 1000;
    return new Date(brtMs).toISOString().substring(0, 10);
  };
  const datePedido    = toBRT(order.date_created);
  const dataPagamento = toBRT(order.date_approved);

  const comprador = safeStr(
    order.buyer?.nickname ?? order.buyer?.first_name ?? null,
  );

  // Address comes from the shipment detail (receiver_address).
  // /orders/search does NOT include receiver_address; it is only in /shipments/{id}.
  const shipId  = order.shipping?.id ? Number(order.shipping.id) : null;
  const detail  = shipId ? shipmentMap.get(shipId) : undefined;
  const estado  = detail?.estado ?? null;
  const cidade  = detail?.cidade ?? null;

  // Flex (Fase 222, FLEX-01/03): logistic_type e bonus_envio sao grandezas
  // do ENVIO (uma resposta por pedido), nao do item. custo_entrega e
  // parametro por LOJA (ml_tax_config.flex_custo_entrega), so aplicavel
  // quando o envio e Flex — se a loja ainda nao informou o valor, fica null
  // e o Flex segue com margem declaradamente inflada (nomeado, nao
  // inventado — 222-CONTEXT.md, Deferred Ideas).
  const logisticType   = detail?.logisticType ?? null;
  const bonusEnvioPedido = detail?.bonusEnvio ?? null;
  const custoEntregaPedido =
    ehFlex(logisticType) && taxConfig?.flex_custo_entrega != null
      ? Number(taxConfig.flex_custo_entrega)
      : null;

  const items = order.order_items || [];

  // orders tem uma linha por ITEM; bonus e custo de entrega sao do ENVIO
  // inteiro — ratearPorReceita divide entre as linhas na proporcao da
  // receita bruta de cada uma, fechando ao centavo. (Dívida conhecida e
  // anterior a esta fase: `frete`, alguns paragrafos abaixo, continua
  // replicado por linha, sem rateio — os campos novos nao a herdam.)
  const receitasPorItem = items.map((item: any) => {
    const precoUnit  = item.unit_price != null ? Number(item.unit_price) : null;
    const quantidade = Number(item.quantity || 0);
    return precoUnit != null ? precoUnit * quantidade : 0;
  });
  const bonusRateado        = ratearPorReceita(bonusEnvioPedido, receitasPorItem);
  const custoEntregaRateado = ratearPorReceita(custoEntregaPedido, receitasPorItem);

  return items.map((item: any, idx: number) => {
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
    const itemSku     = prod.seller_custom_field ?? prod.seller_sku ?? null;
    const quantidade  = Number(item.quantity || 0);
    const precoUnit   = item.unit_price != null ? Number(item.unit_price) : null;
    const custoUnit   = (itemSku ? skuCostMap.get(itemSku) : null) ?? costMap.get(itemId) ?? null;
    // Fase 96-07 (Trava C): o cheio é lido da MESMA fonte do médio
    // (ml_product_costs), num campo separado (cost_full ← precoCusto do Tiny).
    // NUNCA derivado de custoUnit — derivar o cheio do médio reintroduziria o C6
    // disfarçado. Sem cost_full cadastrado → null (o pedido entra sem cheio e o
    // gate do C6 o lista para o Wesley cadastrar no Tiny).
    const custoUnitCheio = (itemSku ? skuCostFullMap.get(itemSku) : null) ?? null;

    // Comissão e receita bruta precisam estar resolvidas ANTES da chamada de
    // imposto: os créditos de D-01 (222) usam comissão e frete como base, e
    // constante usada antes da inicialização aqui é erro de execução, não
    // de tipo (222-05, ponto de atenção de ordem).
    const comissao    = item.sale_fee != null ? Number(item.sale_fee) : null;
    const receitaBruta = precoUnit != null ? precoUnit * quantidade : null;

    // Fase 222 (TAX-01/02): imposto decomposto por componentes (ICMS
    // débito, PIS/COFINS débito, créditos de PIS/COFINS sobre comissão e
    // frete, DIFAL por base dupla, FCP) em vez de uma alíquota única —
    // computeOrderTax é a ÚNICA função que faz esta conta, chamada aqui e
    // em recalc-order-costs (a segunda porta de escrita), nunca copiada.
    const breakdown   = computeOrderTax({
      config:       taxConfig,
      ufDestino:    estado,
      receitaBruta,
      comissao,
      frete,
      tabelaUf,
    });
    const taxRate     = breakdown.taxRate;
    const taxAmount   = breakdown.taxAmount;
    const ufOrigem    = taxConfig?.uf_origem ?? null;
    // receita_liquida precisa da mesma proteção que tax_rate/tax_amount: ela é
    // recalculada como número real a cada rodada (preço×qtd−comissão−frete−
    // imposto), e já tem COALESCE no upsert desde 12/06 — mas COALESCE não
    // protege contra número errado, só contra ausência. Se o imposto virar
    // null e receita_liquida continuasse sendo calculada com imposto valendo
    // zero, ela seria gravada INFLADA pelo valor inteiro do imposto — um bug
    // pior que o original. Quando NÃO existe config fiscal nenhuma (motivo
    // "sem_config"), receita_liquida continua calculada como hoje: orgs sem
    // regime cadastrado não podem regredir por causa desta fase.
    const impostoDesconhecido = breakdown.motivo === "destino_desconhecido";

    // Flex: bônus e custo de entrega já rateados por linha de item (fora
    // deste map). computeReceitaLiquida soma o bônus como receita própria e
    // subtrai o custo de entrega como custo próprio — nunca o bônus como
    // frete de sinal invertido (D-05).
    const bonusEnvioItem   = bonusRateado[idx] ?? null;
    const custoEntregaItem = custoEntregaRateado[idx] ?? null;
    const { receitaLiquida } = computeReceitaLiquida({
      receitaBruta,
      comissao,
      frete,
      bonusEnvio: bonusEnvioItem,
      custoEntrega: custoEntregaItem,
      taxAmount,
      impostoDesconhecido,
    });

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
      comissao,
      frete,
      status:          order.status ?? null,
      data_pedido:     datePedido,
      data_pagamento:  dataPagamento,
      estado,
      cidade,
      comprador,
      synced_at:       syncAt,
      custo_unit:      custoUnit,
      custo_unit_cheio: custoUnitCheio,
      tax_rate:        taxRate,
      tax_amount:      taxAmount,
      uf_origem:       ufOrigem,
      receita_bruta:   receitaBruta,
      receita_liquida: receitaLiquida,
      marca:           brandMap.get(itemId) ?? null,
      logistic_type:   logisticType,
      bonus_envio:     bonusEnvioItem,
      custo_entrega:   custoEntregaItem,
      // Fase 222 (TAX-01/02): componentes do breakdown decomposto. tax_versao
      // é gravada SEMPRE (não condicionada a nenhum componente não ser
      // null) — é o marcador de que esta linha passou pela régua nova nesta
      // rodada, mesmo quando o resultado é ausência com motivo nomeado
      // (destino desconhecido, UF não confirmada etc.). A view de saúde do
      // 222-05 lê esta coluna para separar régua antiga de régua nova.
      icms_debito:         breakdown.icmsDebito,
      pis_cofins_debito:   breakdown.pisCofinsDebito,
      credito_pc_comissao: breakdown.creditoPcComissao,
      credito_pc_frete:    breakdown.creditoPcFrete,
      difal_base:          breakdown.difalBase,
      difal_amount:        breakdown.difalAmount,
      fcp_amount:          breakdown.fcpAmount,
      difal_fonte:         breakdown.difalFonte,
      tax_versao:          2,
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

    // ── Token lookup (ME-04: ORDER BY determinístico + filtro por org quando conhecida) ──
    // Sem ORDER BY, o lookup é não-determinístico em multi-tenant (dois orgs com mesmo ml_user_id).
    // process-sync-job não envia organization_id no body; filtro por org é feito pós-lookup via
    // is_org_member (skip para service role). ORDER BY updated_at DESC garante token mais recente.
    const { data: tokenRow, error: tokenErr } = await supabaseAdmin
      .from("ml_tokens")
      .select("access_token, organization_id, seller_id, updated_at")
      .eq("ml_user_id", ml_user_id)
      .not("access_token", "is", null)
      .order("updated_at", { ascending: false })
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
    // Sync incremental: descobre quais pedidos do lote JA tem frete e endereco
    // gravados. So os que faltam vao para a API do ML.
    //
    // Backfill do Flex (Fase 222, FLEX-01): `orders` nao tinha `logistic_type`
    // ate o 222-04 -- todo pedido historico Flex ficaria pulado por este
    // mesmo otimizacao PARA SEMPRE, sem o predicado abaixo enxergar o campo
    // novo. BACKFILL_LOGISTIC_TYPE, DESLIGADO por padrao (ausencia da
    // variavel e falso, nunca verdadeiro): ligado, o predicado tambem exige
    // logistic_type preenchido, entao todo pedido do lote que ainda nao tem
    // tipo logistico volta a ser buscado no ML -- ha 193 pedidos com frete
    // nulo na Pe Vermeio e 630 no Junior (222-CONTEXT.md), cada um custando
    // uma chamada a /shipments/{id} que ja seria feita de qualquer forma
    // (zero chamada NOVA so por causa deste campo). Manter o predicado
    // alargado depois do backfill terminar faria toda rodada horaria pagar
    // por um dado que ja esta la -- por isso o interruptor e desligado ao
    // fim do backfill (222-PROVA.md, Passo 8), nao deixado ligado.
    const backfillLogisticType =
      (Deno.env.get("BACKFILL_LOGISTIC_TYPE") ?? "").trim().toLowerCase() === "true";
    const jaCompletos = new Set<string>();
    if (organizationId && orders.length) {
      const idsLote = orders.map((o: any) => String(o.id));
      let lookupCompletos = supabaseAdmin
        .from("orders")
        .select("ml_order_id")
        .eq("organization_id", organizationId)
        .in("ml_order_id", idsLote)
        .not("frete", "is", null)
        .not("estado", "is", null);
      if (backfillLogisticType) {
        lookupCompletos = lookupCompletos.not("logistic_type", "is", null);
      }
      const { data: jaNoBanco, error: erroLookup } = await lookupCompletos;
      if (erroLookup) {
        // Falha aqui NAO pode virar dado faltando: sem a lista, busca tudo,
        // que e o comportamento antigo. Degrada para lento, nunca para errado.
        console.warn("lookup de pedidos completos falhou; buscando todos:", erroLookup.message);
      } else {
        for (const r of (jaNoBanco ?? []) as any[]) jaCompletos.add(String(r.ml_order_id));
      }
    }
    const {
      detailMap: shipmentMap,
      attempted: shipmentsAttempted,
      failed:    shipmentsFailed,
      flexSelfService,
      flexBonusResolved,
      flexBonusFailed,
    } = await fetchShipmentDetails(orders, accessToken, 500, jaCompletos);

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

    // ── Tabela de alíquota interna + FCP por UF (Fase 222, TAX-01/02) ────────
    // UMA leitura por rodada — nunca uma por pedido dentro do laço de
    // expandOrder. `date_to` é "a data do lote": fim da janela sincronizada,
    // usada como referência de vigência. Se a chamada falhar, segue com
    // tabela vazia — o DIFAL sai null e a view de saúde do 222-05 mostra;
    // abortar o sync inteiro por causa do DIFAL seria pior que a ausência.
    let tabelaUf: TabelaAliquotasInternas = {};
    {
      const { data: linhasUf, error: erroUf } = await supabaseAdmin.rpc(
        "aliquota_interna_vigente",
        { p_data: date_to },
      );
      if (erroUf) {
        console.warn(
          `sync-ml-orders: aliquota_interna_vigente falhou (${erroUf.message}) — seguindo com tabela de UF vazia (DIFAL sai ausente, nunca zero)`,
        );
      } else {
        tabelaUf = montarTabelaAliquotas(linhasUf ?? []);
      }
    }

    const itemIds = Array.from(new Set(
      orders.flatMap((o) => (o.order_items ?? []).map((i: any) => String(i.item?.id ?? ""))).filter(Boolean),
    ));
    const costMap = new Map<string, number>();
    const skuCostMap = new Map<string, number>(); // fallback: custo por seller_sku (Tiny sync)
    // Fase 96-07 (Trava C): custo CHEIO por seller_sku. Este é o caminho de
    // ingestão de TODO pedido novo — é ele que mantém custo_unit (médio) em
    // ~95% de cobertura. O cheio não tinha caminho de ingestão nenhum: por isso
    // congelou em 32,9% em julho enquanto o médio seguia em 94,9%. Só por
    // seller_sku (sem fallback por item_id): cost_full vem do Tiny, que casa por
    // SKU — mesmo critério do costFullBySku de recalc-order-costs.
    const skuCostFullMap = new Map<string, number>();
    {
      // Busca por item_id E por seller_sku (sem filtrar item_id para pegar custos do Tiny)
      // Quando service role (cron, userId=null): busca por org_id OU org_id IS NULL (custos salvos sem contexto de org)
      // Quando user JWT: busca por user_id (cobre todos os custos que o usuário salvou)
      const costOr = userId
        ? `user_id.eq.${userId}${organizationId ? `,organization_id.eq.${organizationId}` : ""}`
        : `${organizationId ? `organization_id.eq.${organizationId},` : ""}organization_id.is.null`;
      const { data: costRows } = await supabaseAdmin
        .from("ml_product_costs")
        .select("item_id, seller_sku, cost, cost_full, organization_id, user_id")
        .or(costOr)
        .limit(50000);
      for (const r of (costRows ?? []) as any[]) {
        // `cost == null` não pode mais abortar a linha: um produto pode ter
        // cost_full sem cost. O early-continue anterior descartaria o cheio.
        if (r.cost != null) {
          if (r.item_id) costMap.set(r.item_id, Number(r.cost));
          if (r.seller_sku) skuCostMap.set(r.seller_sku, Number(r.cost));
        }
        if (r.cost_full != null && r.seller_sku) skuCostFullMap.set(r.seller_sku, Number(r.cost_full));
      }
    }

    // ── Fetch brand names for all unique item IDs ─────────────────────────────
    console.log(`Fetching brands for ${itemIds.length} unique items…`);
    const brandMap = await fetchItemBrands(itemIds, accessToken);
    console.log(`Brand map populated: ${brandMap.size} entries`);

    // ── Expand + upsert ───────────────────────────────────────────────────────
    const records = orders.flatMap((o) =>
      expandOrder(o, ml_user_id, effectiveSellerId, userId, organizationId, syncAt, shipmentMap, costMap, taxConfig, brandMap, skuCostMap, skuCostFullMap, tabelaUf),
    );
    // Visibilidade (Fase 220, TAX-01): silêncio foi o que deixou o bug do
    // imposto viver quatro meses. Conta quantos itens ficaram com o imposto
    // preservado (não recalculado) por destino desconhecido nesta rodada.
    const impostoPreservado = records.filter((r) => r.tax_rate == null).length;
    if (impostoPreservado > 0) {
      console.log(`sync-ml-orders: ${impostoPreservado} itens com imposto preservado por destino desconhecido`);
    }

    let upserted = 0;
    if (records.length > 0) {
      // Batch upsert via RPC — 1 round-trip para todos os pedidos do lote.
      // Passa o array direto (NÃO JSON.stringify): o param é jsonb; uma string
      // viraria escalar e jsonb_array_elements falha ("cannot extract elements
      // from a scalar").
      const { data: batchCount, error: batchErr } = await supabaseAdmin.rpc(
        "batch_upsert_orders",
        { p_records: records },
      );

      if (batchErr) {
        // NÃO engolir o erro: lançar para o job refletir failure (antes retornava
        // 200 orders_synced=0 e mascarava o RPC quebrado — congelou orders em 05-27).
        console.error("batch_upsert_orders failed:", batchErr.message);
        throw new Error(`batch_upsert_orders failed: ${batchErr.message}`);
      }
      upserted = (batchCount as number) ?? records.length;
      console.log(`Batch upserted ${upserted}/${records.length} orders (cost preserved, 1 RPC)`);
    }

    // ── Reconciliação de cancelamentos tardios ────────────────────────────────
    // A busca acima janela por `order.date_created`. Um pedido capturado como
    // `paid` e cancelado DEPOIS nunca reaparece numa janela posterior — ele já
    // não pertence a ela — e o status congela para sempre no que era na captura.
    //
    // Em 2026-07-31 isso somava 203 pedidos cancelados contados como pagos
    // (R$ 63.243,96 de receita fantasma), confirmados um a um contra a API do ML.
    //
    // A correção pergunta ao ML especificamente pelos cancelados do período —
    // conjunto pequeno (855 em sete meses) — em vez de reprocessar tudo por
    // `last_updated`, que traria milhares de pedidos sem mudança de status.
    const reconciliados = await reconcileCancelled(
      mlNumericId,
      rangeStart,
      rangeEnd,
      accessToken,
      supabaseAdmin,
      organizationId,
    );
    if (reconciliados > 0) {
      console.log(`sync-ml-orders: ${reconciliados} cancelamentos tardios reconciliados`);
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
      JSON.stringify({
        success: true,
        orders_synced: upserted,
        date_from,
        date_to,
        shipments_failed: shipmentsFailed,
        shipments_total:  shipmentsAttempted,
        tax_preserved:    impostoPreservado,
        // Flex (Fase 222): silêncio aqui é o que deixou o imposto errado
        // viver quatro meses (Fase 220) — nunca omitir estes três.
        flex_self_service:  flexSelfService,
        flex_bonus_resolved: flexBonusResolved,
        flex_bonus_failed:   flexBonusFailed,
      }),
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
