// ============================================================================
// dreOperational — pure aggregation + resultado-líquido math for the DRE
// operational blocks (Pessoal, Estrutura, Serviços, Outros, Financeiro).
//
// Source RPC: get_dre_operational_by_competence(p_org_id, p_month)
// Returns rows across 7 blocos: impostos_venda, pessoal, estrutura, servicos,
// financeiro, excluido, outros_operacionais. This module ALLOW-LISTS the five
// wanted blocos — impostos_venda (already inside the existing margin) and
// excluido (Fornecedores/ADS/Cartão de crédito, already counted elsewhere)
// must NEVER be summed here, or the −R$29k June/2026 reconciliation breaks.
//
// Phase: 88-dre-frontend-resultado-completo-vendas / Plan 01
// ============================================================================

export interface DreOperationalRow {
  bloco: string;
  category: string;
  total: number;
  n: number;
  financeiro_is_approximate: boolean;
}

export interface DreOperationalBlocks {
  pessoal: number;
  estrutura: number;
  servicos: number;
  outros_operacionais: number;
  financeiro: number;
  financeiro_is_approximate: boolean;
}

/** Allow-list of the blocos this frontend sums — impostos_venda and excluido are deliberately absent. */
export const OPERATIONAL_BLOCOS = [
  "pessoal",
  "estrutura",
  "servicos",
  "outros_operacionais",
  "financeiro",
] as const;

/**
 * Reduces raw RPC rows into the five operational blocks.
 * - Every key defaults to 0 even when no row exists for it.
 * - Only sums rows whose bloco is in OPERATIONAL_BLOCOS (allow-list, not deny-list).
 * - financeiro_is_approximate is derived per-bloco via .some(), not per-row/.find().
 */
export function aggregateOperationalBlocks(rows: DreOperationalRow[]): DreOperationalBlocks {
  const blocks: DreOperationalBlocks = {
    pessoal: 0,
    estrutura: 0,
    servicos: 0,
    outros_operacionais: 0,
    financeiro: 0,
    financeiro_is_approximate: false,
  };

  for (const row of rows) {
    if (!(OPERATIONAL_BLOCOS as readonly string[]).includes(row.bloco)) continue;
    const key = row.bloco as (typeof OPERATIONAL_BLOCOS)[number];
    blocks[key] += Number(row.total ?? 0);
  }

  blocks.financeiro_is_approximate = rows
    .filter((r) => r.bloco === "financeiro")
    .some((r) => r.financeiro_is_approximate);

  return blocks;
}

/**
 * resultadoOperacional = margem − pessoal − estrutura − servicos − outros_operacionais
 * resultadoLiquido = resultadoOperacional − financeiro
 */
export function computeResultadoLiquido(
  margem: number,
  blocks: DreOperationalBlocks,
): { resultadoOperacional: number; resultadoLiquido: number } {
  const resultadoOperacional =
    margem - blocks.pessoal - blocks.estrutura - blocks.servicos - blocks.outros_operacionais;
  const resultadoLiquido = resultadoOperacional - blocks.financeiro;
  return { resultadoOperacional, resultadoLiquido };
}

// ============================================================================
// evaluateGuiaReal + resolveTaxAndCmv — gatilho provisão→real (Phase 90,
// Plan 03). A guia de imposto (ICMS/PIS/COFINS) só é considerada "real
// apurada" quando há linha(s) status='paid' E TODA categoria paid presente
// tem valor acima do threshold de placeholder — junho/2026 lançou
// PIS/COFINS = R$0,01 antes da apuração real (90-DATA-FINDINGS.md), e esse
// placeholder NÃO pode disparar o gatilho de "mês fechado".
//
// Source RPC: get_imposto_guia_by_competence(p_org_id, p_competence) — Plan 90-01.
// Régua: para o mês de venda S, quem chama passa a competência S+1 (deslocamento
// confirmado por Wesley — guia de competência C cobre vendas de C−1).
// ============================================================================

export interface ImpostoGuiaRow {
  category: string;
  total: number;
  status: string;
}

export interface GuiaRealResult {
  hasGuiaReal: boolean;
  totalReal: number;
}

/** Guias com total <= R$1 são tratadas como placeholder (ex.: 0,01 de junho/2026). */
const PLACEHOLDER_THRESHOLD = 1;

/**
 * Decide se a guia de imposto da competência consultada é "real apurada".
 * - Sem linhas paid → não é real (previsão/pending não conta).
 * - Toda linha paid deve ter total > PLACEHOLDER_THRESHOLD; uma única linha
 *   paid placeholder (ex.: COFINS 0,01) já reprova o mês inteiro.
 * - totalReal soma SÓ as linhas paid (linhas pending são ignoradas mesmo
 *   quando misturadas na mesma competência).
 */
export function evaluateGuiaReal(rows: ImpostoGuiaRow[]): GuiaRealResult {
  const paid = rows.filter((r) => r.status === "paid");
  const hasGuiaReal = paid.length > 0 && paid.every((r) => Number(r.total) > PLACEHOLDER_THRESHOLD);
  const totalReal = hasGuiaReal ? paid.reduce((sum, r) => sum + Number(r.total), 0) : 0;
  return { hasGuiaReal, totalReal };
}

export type ImpostoFonte = "real" | "provisao";
export type CmvFonte = "cheio" | "medio" | "medio_fallback";

export interface ResolveTaxAndCmvInput {
  /** Estimativa atual de imposto (total_tax do waterfall) — usada no mês aberto. */
  estimatedTax: number | null;
  hasTaxData: boolean;
  /** CMV custo-médio (cmv do waterfall) — usado no mês aberto e como fallback no fechado. */
  custoMedio: number | null;
  hasCmv: boolean;
  /** CMV cheio (cmv_cheio do waterfall) — só existe/é usado no mês fechado. */
  cmvCheio: number | null;
  hasCmvCheio: boolean;
  /** Resultado de evaluateGuiaReal para a competência S+1 do mês exibido. */
  guia: GuiaRealResult;
}

export interface ResolveTaxAndCmvResult {
  impostosMes: number | null;
  cmvMes: number | null;
  impostoFonte: ImpostoFonte;
  cmvFonte: CmvFonte;
}

/**
 * Decide, por mês exibido, o par (impostosMes, cmvMes) + os selos de fonte.
 *
 * Mês ABERTO (!guia.hasGuiaReal): reproduz BYTE A BYTE as expressões legadas
 * de MercadoLivre.tsx (linhas 258-260) — zero regressão (SC1):
 *   impostosMes = has_tax_data ? total_tax : null
 *   cmvMes      = has_cmv ? cmv : null
 *
 * Mês FECHADO (guia.hasGuiaReal): imposto = totalReal da guia (fonte "real");
 * CMV = cheio quando disponível (fonte "cheio"), senão cai pro custo médio
 * (fonte "medio_fallback" — inclusive quando nem o custo médio existe, cmvMes
 * fica null mas a fonte permanece "medio_fallback" pois foi essa a tentativa).
 */
export function resolveTaxAndCmv(input: ResolveTaxAndCmvInput): ResolveTaxAndCmvResult {
  const { estimatedTax, hasTaxData, custoMedio, hasCmv, cmvCheio, hasCmvCheio, guia } = input;

  if (!guia.hasGuiaReal) {
    return {
      impostosMes: hasTaxData ? estimatedTax : null,
      cmvMes: hasCmv ? custoMedio : null,
      impostoFonte: "provisao",
      cmvFonte: "medio",
    };
  }

  return {
    impostosMes: guia.totalReal,
    cmvMes: hasCmvCheio ? cmvCheio : hasCmv ? custoMedio : null,
    impostoFonte: "real",
    cmvFonte: hasCmvCheio ? "cheio" : "medio_fallback",
  };
}
