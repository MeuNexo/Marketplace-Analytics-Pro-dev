/**
 * Módulo puro de reposição server-side — sem dependências React, Supabase ou DOM.
 *
 * Espelha exatamente a fórmula da RPC `get_replenishment` (Phase 62-01):
 * ponto de reposição com gatilho, MOQ/pack arredondado para cima, custo nulo
 * e sem-giro. Testável em isolamento via vitest.
 *
 * Implementa REPL-04/05/06/07/08/11.
 */

// ── Tipos exportados ──────────────────────────────────────────────────────────

export interface ReplenishmentParams {
  /** Dias de lead time do fornecedor (default 30) */
  leadTimeDias: number;
  /** Meta de cobertura em dias (default 60) */
  metaCoberturaDias: number;
  /** Dias de estoque de segurança (default 7) */
  safetyDays: number;
  /** Quantidade mínima de compra — Minimum Order Quantity (default 1) */
  moq: number;
  /** Múltiplo de embalagem — arredonda pra cima (default 1) */
  packMultiple: number;
}

export interface ReplenishmentResult {
  /** Unidades sugeridas de compra (0 se gatilho inativo ou sem giro) */
  compraSugerida: number;
  /** true se estoque ≤ ponto de reposição */
  gatilhoAtivo: boolean;
  /** true se vendaDia=0 e estoque>0 (item sem saída) */
  semGiro: boolean;
  /** Ponto de reposição = vendaDia × (leadTimeDias + safetyDays) */
  pontoReposicao: number;
  /** Alvo de estoque = vendaDia × (metaCoberturaDias + safetyDays) */
  alvo: number;
  /** Cobertura atual em dias (estoque/vendaDia); null se sem giro */
  coberturaAtual: number | null;
  /** true se custo unitário não disponível */
  custoAusente: boolean;
  /** compraSugerida × custo; null se custoAusente */
  valorEstimado: number | null;
  /** Origem dos parâmetros usados; 'fornecedor' adicionado Phase 66 */
  paramOrigem?: "sku" | "fornecedor" | "marca" | "global";
}

/**
 * Tipo de entrada para reposição por SKU/variação (Phase 63).
 * Estende os campos base com informações de variação ML.
 */
export interface ReplenishmentSkuInput {
  /** ID de variação ML (null para anúncios sem variação) */
  variationId: string | null;
  /** seller_custom_field da variação (ponte para ml_product_costs.seller_sku) */
  skuCode: string | null;
  /** Atributos da variação: Cor/Tamanho [{id, name, value}] */
  attributeCombinations: Array<{ id: string; name: string; value: string }> | null;
  /** Estoque disponível desta variação */
  estoque: number;
  /** Venda média diária por SKU (da tabela orders) */
  vendaDia: number;
  /** Custo unitário (null = custo ausente) */
  cost?: number | null;
}

// ── Defaults hardcoded (espelha COALESCE da RPC: marca > global > 30/60/7/1/1) ──

export const REPLENISHMENT_DEFAULTS: ReplenishmentParams = {
  leadTimeDias:      30,
  metaCoberturaDias: 60,
  safetyDays:        7,
  moq:               1,
  packMultiple:      1,
};

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Resolve parâmetros de reposição com precedência marca > global > defaults.
 * Espelha a CTE `params` da RPC `get_replenishment`.
 *
 * @param brand      - Marca do item (informativo; marcaRow já está resolvido)
 * @param globalRow  - Linha scope='global' da org, ou null se não existe
 * @param marcaRow   - Linha scope='marca' para a brand do item, ou null se não existe
 * @param defaults   - Fallback hardcoded (padrão: REPLENISHMENT_DEFAULTS = 30/60/7/1/1)
 * @returns          - Parâmetros resolvidos + origem ('marca' ou 'global')
 */
export function resolveParams(
  brand: string | null,
  globalRow: Partial<ReplenishmentParams> | null,
  marcaRow: Partial<ReplenishmentParams> | null,
  defaults: ReplenishmentParams = REPLENISHMENT_DEFAULTS,
): { params: ReplenishmentParams; origem: "marca" | "global" } {
  const origem: "marca" | "global" = marcaRow != null ? "marca" : "global";
  const source: Partial<ReplenishmentParams> = marcaRow ?? globalRow ?? {};

  const params: ReplenishmentParams = {
    leadTimeDias:      source.leadTimeDias      ?? defaults.leadTimeDias,
    metaCoberturaDias: source.metaCoberturaDias ?? defaults.metaCoberturaDias,
    safetyDays:        source.safetyDays        ?? defaults.safetyDays,
    moq:               source.moq               ?? defaults.moq,
    packMultiple:      source.packMultiple      ?? defaults.packMultiple,
  };

  return { params, origem };
}

/**
 * Resolve parâmetros de reposição com precedência SKU > fornecedor > marca > global > defaults.
 * Espelha a CTE `params` da RPC `get_replenishment_by_sku` (Phase 66-03, FORN-05).
 *
 * Precedência (D-08):
 *   skuRow presente        → origem 'sku'
 *   fornecedorRow presente → origem 'fornecedor' (entre sku e marca)
 *   marcaRow presente      → origem 'marca'
 *   globalRow presente     → origem 'global'
 *   nenhum → defaults hardcoded (30/60/7/1/1), origem 'global'
 *
 * @param skuRow        - Linha scope='sku' para o sku_code da variação, ou null
 * @param fornecedorRow - Linha scope='fornecedor' para o fornecedor predominante do SKU, ou null
 * @param marcaRow      - Linha scope='marca' para a brand do item, ou null
 * @param globalRow     - Linha scope='global' da org, ou null
 * @param defaults      - Fallback hardcoded (padrão: REPLENISHMENT_DEFAULTS = 30/60/7/1/1)
 * @returns             - Parâmetros resolvidos + origem ('sku', 'fornecedor', 'marca' ou 'global')
 */
export function resolveParamsBySku(
  skuRow: Partial<ReplenishmentParams> | null,
  fornecedorRow: Partial<ReplenishmentParams> | null,
  marcaRow: Partial<ReplenishmentParams> | null,
  globalRow: Partial<ReplenishmentParams> | null,
  defaults: ReplenishmentParams = REPLENISHMENT_DEFAULTS,
): { params: ReplenishmentParams; origem: "sku" | "fornecedor" | "marca" | "global" } {
  let origem: "sku" | "fornecedor" | "marca" | "global";
  let source: Partial<ReplenishmentParams>;

  if (skuRow != null) {
    origem = "sku";
    source = skuRow;
  } else if (fornecedorRow != null) {
    origem = "fornecedor";
    source = fornecedorRow;
  } else if (marcaRow != null) {
    origem = "marca";
    source = marcaRow;
  } else {
    origem = "global";
    source = globalRow ?? {};
  }

  const params: ReplenishmentParams = {
    leadTimeDias:      source.leadTimeDias      ?? defaults.leadTimeDias,
    metaCoberturaDias: source.metaCoberturaDias ?? defaults.metaCoberturaDias,
    safetyDays:        source.safetyDays        ?? defaults.safetyDays,
    moq:               source.moq               ?? defaults.moq,
    packMultiple:      source.packMultiple      ?? defaults.packMultiple,
  };

  return { params, origem };
}

// ── Phase 67 — Espelho puro da RPC esperta (SMART-01/02/03/04) ───────────────
// Funções puras que replicam as fórmulas da migration
// 20260667000100_get_replenishment_by_sku_smart.sql.
// Constantes idênticas: alpha=0.3/decay=0.7, clamp[0.5,2.5], 12 meses, K≥2, threshold=0.20.

/** Origem do cálculo de venda_dia (espelha coluna venda_dia_origem da RPC). */
export type VendaDiaOrigem = "ewma_sazonal" | "ewma" | "simples";

/** Origem do lead time (espelha coluna lead_time_origem da RPC). */
export type LeadTimeOrigem = "fornecedor_real" | "param";

/**
 * Calcula EWMA diária a partir de vendas semanais com offsets reais.
 *
 * Espelha a CTE `ewma_sales` da RPC v7 (SMART-01).
 * Usa decaimento exponencial POWER(decay, week_offset) onde decay = 1 − alpha.
 * week_offset=0 é a semana mais recente; offset real preserva espaçamento temporal
 * (buracos de semanas sem vendas mantidos — não rank).
 *
 * @param weeklyObs - Array de {weekOffset, qty} com quantidades vendidas por semana.
 *                    Deve conter apenas semanas COM vendas (JOIN das orders).
 * @param alpha     - Fator de suavização (default=0.3 → decay=0.7, half-life≈2 semanas).
 * @returns EWMA diária (total / 7 dias/semana) ou null se menos de 2 semanas observadas
 *          (limiar SMART-03/D-09: < 2 semanas → fallback para avg_daily plana).
 */
export function calcEwmaDaily(
  weeklyObs: Array<{ weekOffset: number; qty: number }>,
  alpha: number = 0.3,
): number | null {
  if (weeklyObs.length < 2) return null;
  const decay = 1 - alpha;
  let numerator = 0;
  let denominator = 0;
  for (const { weekOffset, qty } of weeklyObs) {
    const w = Math.pow(decay, weekOffset);
    numerator += qty * w;
    denominator += w;
  }
  return denominator > 0 ? numerator / denominator / 7 : null;
}

/**
 * Calcula fator sazonal para um mês dado usando ratio-to-average por marca.
 *
 * Espelha a CTE `seasonal_index` da RPC v7 (SMART-01).
 * Limiar: monthlyAvgs.size < 12 → fallback {factor:1.0, active:false}.
 * Clamp: [clampMin, clampMax] = [0.5, 2.5] por padrão (D-09).
 *
 * @param monthlyAvgs - Map<mesNumber(1-12), avgQtyMonth> para o bucket da marca.
 *                      avgQtyMonth = total do mês ÷ nº de anos distintos com dados.
 * @param targetMonth - Mês alvo 1-12 (mês corrente para "comprar agora").
 * @param clampMin    - Limite inferior do fator (default 0.5).
 * @param clampMax    - Limite superior do fator (default 2.5).
 * @returns {factor, active} — active=true somente com >=12 meses distintos e mês presente.
 */
export function calcSeasonalFactor(
  monthlyAvgs: Map<number, number>,
  targetMonth: number,
  clampMin: number = 0.5,
  clampMax: number = 2.5,
): { factor: number; active: boolean } {
  if (monthlyAvgs.size < 12) return { factor: 1.0, active: false };
  const targetAvg = monthlyAvgs.get(targetMonth);
  if (targetAvg == null) return { factor: 1.0, active: false };
  const globalAvg =
    Array.from(monthlyAvgs.values()).reduce((s, v) => s + v, 0) / monthlyAvgs.size;
  if (globalAvg === 0) return { factor: 1.0, active: false };
  const raw = targetAvg / globalAvg;
  return {
    factor: Math.max(clampMin, Math.min(clampMax, raw)),
    active: true,
  };
}

/**
 * Determina tendência de venda comparando EWMA recente vs EWMA antiga.
 *
 * Espelha o CASE de `tendencia` no SELECT final da RPC v7 (SMART-01/D-01).
 * Recente = últimas 4 semanas (offset 0-3); Antiga = semanas 5-12 (offset 4-11).
 * Threshold 20%: >20% crescimento → '↑'; >20% queda → '↓'; entre ou indeterminado → '~'.
 *
 * @param ewmaRecentDaily - EWMA diária das 4 semanas mais recentes (null se ausente).
 * @param ewmaOlderDaily  - EWMA diária das semanas 5-12 (null ou zero se ausente).
 * @param threshold       - Limiar relativo (default=0.20 = 20%, D-09).
 * @returns '↑' | '↓' | '~'
 */
export function calcTrend(
  ewmaRecentDaily: number | null,
  ewmaOlderDaily: number | null,
  threshold: number = 0.20,
): "↑" | "↓" | "~" {
  if (ewmaRecentDaily == null || ewmaOlderDaily == null || ewmaOlderDaily === 0)
    return "~";
  const ratio = ewmaRecentDaily / ewmaOlderDaily;
  if (ratio > 1 + threshold) return "↑";
  if (ratio < 1 - threshold) return "↓";
  return "~";
}

/**
 * Resolve o lead time com fallback transparente: real via fornecedor ou param.
 *
 * Espelha o COALESCE de lead_time_dias na CTE `params` da RPC v7 (SMART-02/SMART-03).
 * Limiar K≥2 OCs: com < 2 OCs não há distribuição real para calcular mediana.
 *
 * @param leadTimeData  - Dados de lead time real: {medianLeadDays, ocCount}.
 *                        medianLeadDays=null indica que nenhuma OC com datas válidas existe.
 * @param paramLeadTime - Lead time do param (precedência Phase 66 intocada).
 * @param smart         - Se false, sempre retorna param (modo simples).
 * @returns {leadTime, origem} — origem='fornecedor_real' quando usa mediana real.
 */
export function resolveSmartLeadTime(
  leadTimeData: { medianLeadDays: number | null; ocCount: number },
  paramLeadTime: number,
  smart: boolean,
): { leadTime: number; origem: LeadTimeOrigem } {
  if (
    smart &&
    leadTimeData.ocCount >= 2 &&
    leadTimeData.medianLeadDays != null &&
    leadTimeData.medianLeadDays > 0
  ) {
    return { leadTime: leadTimeData.medianLeadDays, origem: "fornecedor_real" };
  }
  return { leadTime: paramLeadTime, origem: "param" };
}

/**
 * Resolve a origem do cálculo de venda_dia para exibição de badges.
 *
 * Espelha o CASE de `venda_dia_origem` na CTE `sales_smart` da RPC v7 (SMART-03/D-11).
 *
 * @param weeksWithSales - Número de semanas com vendas (weeks_with_sales da EWMA).
 * @param sazonalAtiva   - Se o índice sazonal está ativo para este SKU/marca.
 * @param smart          - Se o modo esperto está ativado (p_smart=true).
 * @returns 'ewma_sazonal' | 'ewma' | 'simples'
 */
export function resolveVendaDiaOrigem(
  weeksWithSales: number,
  sazonalAtiva: boolean,
  smart: boolean,
): VendaDiaOrigem {
  if (smart && weeksWithSales >= 2 && sazonalAtiva) return "ewma_sazonal";
  if (smart && weeksWithSales >= 2) return "ewma";
  return "simples";
}

// ── Phase 68 — Motor "simples=espinha; inteligente só em ALTA CONFIANÇA" ───────
// Espelha o CASE `aplica_inteligente` + `venda_base` da RPC v8
// (migration 20260668000200_get_replenishment_by_sku_engine_max_confidence.sql).

/**
 * Aplica o fator sazonal em modo BOOST-ONLY: só pode SOMAR, nunca cortar.
 *
 * Espelha `GREATEST(1.0, COALESCE(si.fator_sazonal, 1.0))` da RPC v8. O fator
 * atual é estimado sobre ~1 ano de histórico — não-confiável para reduzir a
 * demanda; por isso clamp inferior em 1,0 (ver project_garment_compras_v2_roadmap).
 *
 * @param fatorSazonal - Fator sazonal bruto (null → tratado como 1.0).
 * @returns fator clamp ≥ 1,0 (nunca corta).
 */
export function seasonalBoostOnly(fatorSazonal: number | null): number {
  return Math.max(1.0, fatorSazonal ?? 1.0);
}

/**
 * Decide a venda diária final: a SIMPLES (média da janela) é a espinha que
 * decide a compra por padrão; a INTELIGENTE (EWMA × sazonal-boost) só ASSUME
 * (puxa pra cima) quando TODAS as condições de alta confiança são verdadeiras.
 *
 * Espelha o CASE `aplica_inteligente` + `venda_base` da RPC v8.
 *
 * Condições para a inteligente assumir (Phase 68):
 *   (1) inteligente != null
 *   (2) inteligente > simples (upside — só puxa pra cima)
 *   (3) trendUp = tendência de alta (ewma_recent > ewma_older × 1,20)
 *   (4) weeksWithSales >= 3
 *   (5) leadTime <= 60 (lead curto/médio recebe a mercadoria "quente"; lead longo
 *       — ex.: Pralana 70/72 — não persegue o pico, usa a taxa estrutural simples)
 *
 * @returns {vendaDia, aplicaInteligente} — vendaDia = inteligente quando assume, senão simples.
 */
export function decideVendaDia(input: {
  simples: number;
  inteligente: number | null;
  trendUp: boolean;
  weeksWithSales: number;
  leadTime: number;
}): { vendaDia: number; aplicaInteligente: boolean } {
  const { simples, inteligente, trendUp, weeksWithSales, leadTime } = input;

  const aplicaInteligente =
    inteligente != null &&
    inteligente > simples &&
    trendUp &&
    weeksWithSales >= 3 &&
    leadTime <= 60;

  return {
    vendaDia: aplicaInteligente ? (inteligente as number) : simples,
    aplicaInteligente,
  };
}

/**
 * Calcula a sugestão de compra com o modelo de ponto de reposição.
 * Espelha exatamente a fórmula SQL da RPC `get_replenishment` (Phase 62-01).
 *
 * Fórmula (travada — CONTEXT.md Phase 62):
 *   ponto   = vendaDia × (leadTimeDias + safetyDays)
 *   GATILHO: só sugere se estoque ≤ ponto
 *   alvo    = vendaDia × (metaCoberturaDias + safetyDays)
 *   nec.    = max(0, alvo − estoque)
 *   compra  = GREATEST( CEIL(nec / pack) × pack, moq )
 *   valor   = compra × custo   (ou null se custo ausente)
 *
 * Guardrails:
 *   - packMultiple < 1 → tratado como 1 (espelha NULLIF(pack,0) da RPC; T-62-06)
 *   - vendaDia = 0 com estoque > 0 → semGiro=true, compra=0
 *
 * @param estoque   - Estoque atual (soma cross-store ml_inventory_cache)
 * @param vendaDia  - Venda média diária (SUM(qty_sold)/window, ml_product_daily_cache)
 * @param params    - Parâmetros resolvidos (usar resolveParams ou REPLENISHMENT_DEFAULTS)
 * @param cost      - Custo unitário em R$ (ml_product_costs); omitir ou null = ausente
 */
export function calcReplenishment(
  estoque: number,
  vendaDia: number,
  params: ReplenishmentParams,
  cost?: number | null,
): ReplenishmentResult {
  // T-62-06: guardrail packMultiple<1 → evita divisão por zero
  const pack = Math.max(1, params.packMultiple);

  // REPL-08: sem giro — item com estoque mas zero saídas na janela
  const semGiro = vendaDia === 0 && estoque > 0;

  // Sem venda → não sugere compra (cobertura atual = null)
  if (vendaDia === 0) {
    return {
      compraSugerida: 0,
      gatilhoAtivo:   false,
      semGiro,
      pontoReposicao: 0,
      alvo:           0,
      coberturaAtual: null,
      custoAusente:   cost == null,
      valorEstimado:  null,
    };
  }

  // REPL-04: ponto de reposição e gatilho
  const pontoReposicao = vendaDia * (params.leadTimeDias + params.safetyDays);
  const gatilhoAtivo   = estoque <= pontoReposicao;
  const coberturaAtual = estoque / vendaDia;

  const alvo = vendaDia * (params.metaCoberturaDias + params.safetyDays);

  // Estoque acima do ponto → não sugere (resolve "sugerir o que já tem")
  if (!gatilhoAtivo) {
    return {
      compraSugerida: 0,
      gatilhoAtivo:   false,
      semGiro:        false,
      pontoReposicao,
      alvo,
      coberturaAtual,
      custoAusente:   cost == null,
      valorEstimado:  null,
    };
  }

  // REPL-06: necessidade com arredondamento pra cima por pack + MOQ
  const necessidade    = Math.max(0, alvo - estoque);
  const rounded        = Math.ceil(necessidade / pack) * pack;
  const compraSugerida = Math.max(rounded, params.moq);

  // REPL-07: custo nulo → marca ausente, não calcula R$
  const custoAusente  = cost == null;
  const valorEstimado = custoAusente ? null : compraSugerida * (cost as number);

  return {
    compraSugerida,
    gatilhoAtivo: true,
    semGiro:      false,
    pontoReposicao,
    alvo,
    coberturaAtual,
    custoAusente,
    valorEstimado,
  };
}
