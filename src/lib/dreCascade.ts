// ============================================================================
// dreCascade — Phase 88 Plan 01, Task 1
// Função pura que monta a cascata do DRE a partir das linhas cruas da RPC 87
// (get_dre_operational_by_competence). Continua a "DRE do Mês" (MLCostCard)
// da Margem de contribuição até o Resultado líquido.
//
// Fonte única do mapa categoria→bloco é o BACKEND (Phase 87). Aqui o campo
// `bloco` das linhas é consumido DIRETAMENTE — NUNCA re-derivado de `category`.
//
// Guardrail crítico (SC-3 / Pitfall 1 do research): os blocos `impostos_venda` e
// `excluido` são filtrados logo na entrada, ANTES de qualquer soma, para nunca
// contaminarem os subtotais (imposto sobre venda já é subtraído pelo card em
// `impostosMes`; incluí-lo aqui dupla-contaria).
//
// Sem React/Supabase — módulo puro, no padrão dos helpers de src/lib.
// Os tipos DreBloco/DreOperationalRow vivem aqui e são re-exportados pelo hook
// useDreOperational (Task 2) para evitar dependência circular.
// ============================================================================

/** União dos 8 blocos retornados pela RPC get_dre_operational_by_competence. */
export type DreBloco =
  | "impostos_venda"
  | "pessoal"
  | "estrutura"
  | "servicos"
  | "operacional"
  | "financeiro"
  | "excluido"
  | "nao_classificado";

/** Linha crua da RPC 87 (uma por categoria dentro de um bloco). */
export interface DreOperationalRow {
  bloco: DreBloco;
  category: string;
  total: number;
  n: number;
  double_count_risk: boolean;
}

/**
 * Blocos que somam para o Resultado operacional, na ordem fixa de exibição.
 * NÃO inclui impostos_venda/excluido (guardrail) nem financeiro (desce depois).
 */
export const OPERACIONAL_BLOCOS = [
  "pessoal",
  "estrutura",
  "servicos",
  "operacional",
  "nao_classificado",
] as const;

export type OperacionalBloco = (typeof OPERACIONAL_BLOCOS)[number];

/** Rótulos pt-BR por bloco (operacionais + financeiro). */
const BLOCO_LABELS: Record<OperacionalBloco | "financeiro", string> = {
  pessoal: "Pessoal",
  estrutura: "Estrutura",
  servicos: "Serviços",
  operacional: "Operacional",
  nao_classificado: "Não classificado",
  financeiro: "Financeiro (Empréstimo)",
};

/** Linha agregada de um bloco operacional (soma das categorias do bloco). */
export interface DreCascadeBlocoLine {
  bloco: OperacionalBloco;
  label: string;
  total: number;
  doubleCountRisk: boolean;
}

/** Linha agregada do bloco financeiro (Empréstimo). */
export interface DreFinanceiroLine {
  total: number;
  doubleCountRisk: boolean;
}

/** Resultado completo da cascata a partir da Margem de contribuição. */
export interface DreCascade {
  /** Linhas operacionais visíveis (só blocos com dados), em ordem fixa. */
  operacionalBlocos: DreCascadeBlocoLine[];
  /** Σ dos totais das linhas operacionais. */
  totalOperacionalDeducoes: number;
  /** Margem de contribuição − deduções operacionais. */
  resultadoOperacional: number;
  /** Linha financeira agregada, ou null se ausente. */
  financeiro: DreFinanceiroLine | null;
  /** Total do financeiro (0 se ausente). */
  totalFinanceiro: number;
  /** Resultado operacional − financeiro. */
  resultadoLiquido: number;
}

// Arredondamento a 2 casas — consistente com useMLCostWaterfall (Math.round(x*100)/100).
// Mantém precisão numérica no cálculo; o display do card usa inteiros via fmt().
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Monta a cascata do DRE.
 *
 * @param rows Linhas cruas da RPC 87 (bloco/category/total/n/double_count_risk).
 * @param margemContribuicao Margem já calculada pelo card
 *        (receita − tarifas ML − CMV − impostos).
 */
export function buildDreCascade(
  rows: DreOperationalRow[],
  margemContribuicao: number,
): DreCascade {
  // Guardrail SC-3: remove impostos_venda e excluido ANTES de qualquer soma.
  const safeRows = (rows ?? []).filter(
    (r) => r.bloco !== "impostos_venda" && r.bloco !== "excluido",
  );

  // Uma linha agregada por bloco operacional que tiver dados, na ordem fixa.
  const operacionalBlocos: DreCascadeBlocoLine[] = [];
  for (const bloco of OPERACIONAL_BLOCOS) {
    const blocoRows = safeRows.filter((r) => r.bloco === bloco);
    if (blocoRows.length === 0) continue;
    const total = round2(blocoRows.reduce((s, r) => s + r.total, 0));
    const doubleCountRisk = blocoRows.some((r) => r.double_count_risk);
    operacionalBlocos.push({ bloco, label: BLOCO_LABELS[bloco], total, doubleCountRisk });
  }

  const totalOperacionalDeducoes = round2(
    operacionalBlocos.reduce((s, b) => s + b.total, 0),
  );
  const resultadoOperacional = round2(margemContribuicao - totalOperacionalDeducoes);

  // Financeiro (Empréstimo) desce para o Resultado líquido.
  const financeiroRows = safeRows.filter((r) => r.bloco === "financeiro");
  const financeiro: DreFinanceiroLine | null =
    financeiroRows.length > 0
      ? {
          total: round2(financeiroRows.reduce((s, r) => s + r.total, 0)),
          doubleCountRisk: financeiroRows.some((r) => r.double_count_risk),
        }
      : null;
  const totalFinanceiro = financeiro?.total ?? 0;
  const resultadoLiquido = round2(resultadoOperacional - totalFinanceiro);

  return {
    operacionalBlocos,
    totalOperacionalDeducoes,
    resultadoOperacional,
    financeiro,
    totalFinanceiro,
    resultadoLiquido,
  };
}
