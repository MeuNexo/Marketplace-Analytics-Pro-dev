import { isReducedInterstateDest } from "./regions";
import type { TaxRegime } from "./index";

export interface OrderTaxConfig {
  regime: TaxRegime;
  uf_origem: string | null;
  // Simples Nacional
  sn_aliquota_efetiva: number | null;
  // Lucro Presumido
  lp_pis: number | null;
  lp_cofins: number | null;
  lp_irpj: number | null;
  lp_csll: number | null;
  // Lucro Real (federais)
  lr_pis_debito: number | null;
  lr_pis_credito: number | null;
  lr_cofins_debito: number | null;
  lr_cofins_credito: number | null;
  lr_icms_credito: number | null;
  // Lucro Real (ICMS por destino)
  lr_icms_aliquota_intra: number | null;
  lr_icms_aliquota_inter_sul_sudeste: number | null;
  lr_icms_aliquota_inter_norte_nordeste: number | null;
  /** Fallback caso lr_icms_aliquota_intra esteja vazio. */
  lr_icms_debito: number | null;
}

const c = (v: number | null | undefined): number => v ?? 0;

/**
 * Computes the effective tax rate (%) for a single order, taking the
 * destination UF into account when the regime is Lucro Real.
 *
 * Result is clamped to ≥ 0 (negative net = "crédito" displays as 0).
 */
export function computeOrderTaxRate(
  config: OrderTaxConfig,
  ufDestino: string | null | undefined,
): number {
  switch (config.regime) {
    case "simples_nacional":
      return Math.max(0, c(config.sn_aliquota_efetiva));

    case "lucro_presumido":
      return Math.max(
        0,
        c(config.lp_pis) + c(config.lp_cofins) + c(config.lp_irpj) + c(config.lp_csll),
      );

    case "lucro_real": {
      const intra = config.lr_icms_aliquota_intra ?? config.lr_icms_debito ?? 0;
      const interSulSE = config.lr_icms_aliquota_inter_sul_sudeste ?? 12;
      const interNNECO = config.lr_icms_aliquota_inter_norte_nordeste ?? 7;

      let icms = intra;
      const orig = config.uf_origem?.toUpperCase() ?? null;
      const dest = ufDestino?.toUpperCase() ?? null;

      if (orig && dest && orig !== dest) {
        icms = isReducedInterstateDest(dest) ? interNNECO : interSulSE;
      }

      const debits =
        c(config.lr_pis_debito) + c(config.lr_cofins_debito) + Number(icms);
      const credits =
        c(config.lr_pis_credito) + c(config.lr_cofins_credito) + c(config.lr_icms_credito);

      return Math.max(0, debits - credits);
    }
  }
}