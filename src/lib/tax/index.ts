export type TaxRegime = "simples_nacional" | "lucro_presumido" | "lucro_real";

export interface TaxInput {
  regime: TaxRegime;
  sn_aliquota_efetiva?: number | null;
  lp_pis?: number | null;
  lp_cofins?: number | null;
  lp_irpj?: number | null;
  lp_csll?: number | null;
  lr_pis_debito?: number | null;
  lr_pis_credito?: number | null;
  lr_cofins_debito?: number | null;
  lr_cofins_credito?: number | null;
  lr_icms_debito?: number | null;
  lr_icms_credito?: number | null;
}

const c = (v: number | null | undefined): number => v ?? 0;

/**
 * Mirrors the DB trigger `calculate_effective_rate()`.
 * Result may be negative for lucro_real when credits exceed debits.
 * Use `clampEffectiveRate()` before display.
 */
export function calculateEffectiveRate(input: TaxInput): number {
  switch (input.regime) {
    case "simples_nacional":
      return c(input.sn_aliquota_efetiva);

    case "lucro_presumido":
      return c(input.lp_pis) + c(input.lp_cofins) + c(input.lp_irpj) + c(input.lp_csll);

    case "lucro_real":
      return (
        c(input.lr_pis_debito) +
        c(input.lr_cofins_debito) +
        c(input.lr_icms_debito) -
        (c(input.lr_pis_credito) +
          c(input.lr_cofins_credito) +
          c(input.lr_icms_credito))
      );
  }
}

/**
 * Clamps a negative effective rate to 0 for display purposes.
 * Lucro Real with credits > debits produces a negative rate that
 * the UI shows as 0% with a "Crédito" badge.
 */
export function clampEffectiveRate(rate: number): number {
  return Math.max(0, rate);
}

/**
 * Computes the tax monetary amount from a product price and an effective rate (in percent).
 * e.g. computeTaxAmount(100, 15) → 15
 */
export function computeTaxAmount(price: number, effectiveRatePct: number): number {
  return price * (effectiveRatePct / 100);
}
