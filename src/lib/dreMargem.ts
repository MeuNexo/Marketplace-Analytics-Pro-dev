// ============================================================================
// dreMargem — Phase 96 Plan 05, Task 1
//
// computeMargemContribuicao é a fonte ÚNICA da fórmula da margem de
// contribuição. Este módulo existe por dois motivos:
//
// (a) A fórmula estava DUPLICADA em `MercadoLivre.tsx` (alimentando
//     buildDreCascade) e em `MLCostCard.tsx` (alimentando o subtotal exibido).
//     Divergir as duas fazia o card se auto-contradizer em silêncio — uma
//     mudança em um lugar sem a outra produz dois números incoerentes na
//     mesma tela. Agora as duas leem daqui.
//
// (b) [C1] O cancelamento de venda (incluindo reembolso) tem que entrar na
//     FÓRMULA, não só na tela — senão a margem de maio/2026 infla em
//     R$14.450,29 (a ARMADILHA documentada em 96-CONTEXT.md §3). A base
//     bruta-menos-cancelamento é ALGEBRICAMENTE IDÊNTICA à base líquida de
//     hoje (`receitaMes` = `paid_revenue`) — o C1 muda o que se VÊ no card
//     (bruto + linha própria de cancelamento), NUNCA o resultado. Prova:
//     Test 2 de dreMargem.test.ts.
//
// Decisão do dono sobre o reembolso (Wesley, 2026-07-15, 96-CONTEXT.md §3):
//   "reembolso fica de fora da receita e é considerado como cancelamento"
// → `partially_refunded` entra na receita BRUTA e sai em `cancelamentosVendas`
//   (já composto assim por get_cancelled_revenue, Phase 96 Plan 04), mantendo
//   a receita líquida em 247.216,12 em maio — zero regressão no bottom line.
//
// Sem import de React nem de Supabase — módulo puro, no padrão de
// src/lib/dreCascade.ts e src/lib/dreRegime.ts.
// ============================================================================

export interface MargemContribuicaoInput {
  /** Receita bruta do mês: paid_revenue + cancelledRevenue. */
  receitaBruta: number;
  /** (−) Cancelamentos de vendas: cancelled + partially_refunded. */
  cancelamentosVendas: number;
  /** (−) Total de tarifas ML (já excluindo o parcelamento — 96-01). */
  totalTarifas: number;
  /** (−) CMV do mês. null = sem custo cadastrado, tratado como 0. */
  cmvMes: number | null;
  /** (−) Impostos próprios do mês. null = sem config fiscal, tratado como 0. */
  impostosMes: number | null;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Margem de contribuição = receita bruta − cancelamentos de vendas − total de
 * tarifas ML − CMV − impostos. Arredondada a 2 casas.
 */
export function computeMargemContribuicao(input: MargemContribuicaoInput): number {
  const { receitaBruta, cancelamentosVendas, totalTarifas, cmvMes, impostosMes } = input;
  return round2(
    receitaBruta - cancelamentosVendas - totalTarifas - (cmvMes ?? 0) - (impostosMes ?? 0),
  );
}
