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
  /** Origem dos parâmetros usados; 'sku' adicionado Phase 63 */
  paramOrigem?: "sku" | "marca" | "global";
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
 * Resolve parâmetros de reposição com precedência SKU > marca > global > defaults.
 * Espelha a CTE `params` da RPC `get_replenishment_by_sku` (Phase 63-02, CMP-05).
 *
 * Precedência (D-08):
 *   skuRow presente  → origem 'sku'
 *   marcaRow presente → origem 'marca'
 *   globalRow presente → origem 'global'
 *   nenhum → defaults hardcoded (30/60/7/1/1), origem 'global'
 *
 * @param skuRow   - Linha scope='sku' para o sku_code da variação, ou null
 * @param marcaRow - Linha scope='marca' para a brand do item, ou null
 * @param globalRow - Linha scope='global' da org, ou null
 * @param defaults  - Fallback hardcoded (padrão: REPLENISHMENT_DEFAULTS = 30/60/7/1/1)
 * @returns         - Parâmetros resolvidos + origem ('sku', 'marca' ou 'global')
 */
export function resolveParamsBySku(
  skuRow: Partial<ReplenishmentParams> | null,
  marcaRow: Partial<ReplenishmentParams> | null,
  globalRow: Partial<ReplenishmentParams> | null,
  defaults: ReplenishmentParams = REPLENISHMENT_DEFAULTS,
): { params: ReplenishmentParams; origem: "sku" | "marca" | "global" } {
  let origem: "sku" | "marca" | "global";
  let source: Partial<ReplenishmentParams>;

  if (skuRow != null) {
    origem = "sku";
    source = skuRow;
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
