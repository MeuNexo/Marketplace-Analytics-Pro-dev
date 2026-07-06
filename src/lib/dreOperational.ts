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
