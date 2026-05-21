export type TaxRegime = "simples_nacional" | "lucro_presumido" | "lucro_real";

export interface TaxInput {
  regime: TaxRegime;
  sn_aliquota_efetiva?: number | null;
  lp_pis?: number | null;
  lp_cofins?: number | null;
  lp_irpj?: number | null;
  lp_csll?: number | null;
  // Lucro Real — ICMS (sem campos de crédito; nova fórmula não usa créditos)
  lr_icms_aliquota_intra?: number | null;
  lr_icms_aliquota_inter_sul_sudeste?: number | null;
  lr_icms_aliquota_inter_norte_nordeste?: number | null;
  /** Legado — fallback se lr_icms_aliquota_intra não estiver preenchido */
  lr_icms_debito?: number | null;
}

const c = (v: number | null | undefined): number => v ?? 0;

/**
 * Computes effective tax rate (%) for preview/display.
 * Mirrors the per-order formula but uses the intrastate ICMS rate as base
 * (since destination UF is not available at config level).
 *
 * For Lucro Real with ICMS intra = 12%:
 *   rate = 12 + (1 - 0.12) × 9.25 = 20.14%
 */
export function calculateEffectiveRate(input: TaxInput): number {
  switch (input.regime) {
    case "simples_nacional":
      return c(input.sn_aliquota_efetiva);

    case "lucro_presumido":
      return c(input.lp_pis) + c(input.lp_cofins) + c(input.lp_irpj) + c(input.lp_csll);

    case "lucro_real": {
      const icmsAliq = Number(
        input.lr_icms_aliquota_intra ?? input.lr_icms_debito ?? 0
      );
      const baseFactor = 1 - icmsAliq / 100;
      return Math.max(0, icmsAliq + baseFactor * (1.65 + 7.60));
    }
  }
}

export function clampEffectiveRate(rate: number): number {
  return Math.max(0, rate);
}

export function computeTaxAmount(price: number, effectiveRatePct: number): number {
  return price * (effectiveRatePct / 100);
}
