/**
 * Helper puro para cálculo do MCO (Margem de Contribuição Operacional).
 *
 * platformCost = frete + comissão ML (tarifas — SEM ads).
 * ads é subtraído exatamente uma vez — não incluído em platformCost.
 * Reconcilia com "Lucro do mês" do MLCostCard (que trata PADS dentro das tarifas).
 */

export interface McoInput {
  /** Receita bruta do período */
  grossRevenue: number;
  /** Custo do produto (CMV) */
  cmv: number;
  /** Custo de plataforma: frete + comissão ML — exclui ads */
  platformCost: number;
  /** Gasto de publicidade (ads) — somado exatamente uma vez */
  ads: number;
  /** Impostos do período */
  tax: number;
}

export interface McoResult {
  /** Margem de Contribuição Operacional em R$ */
  mco: number;
  /** MCO como % da receita bruta; null quando grossRevenue = 0 (evita divisão por zero) */
  pct: number | null;
}

/**
 * Computa o MCO do período.
 *
 * MCO = grossRevenue - cmv - platformCost - ads - tax
 * pct = grossRevenue > 0 ? (mco / grossRevenue) * 100 : null
 */
export function computeMco(input: McoInput): McoResult {
  const { grossRevenue, cmv, platformCost, ads, tax } = input;
  const mco = grossRevenue - cmv - platformCost - ads - tax;
  const pct = grossRevenue > 0 ? (mco / grossRevenue) * 100 : null;
  return { mco, pct };
}
