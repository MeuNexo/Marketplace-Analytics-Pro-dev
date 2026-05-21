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
  // Lucro Real — ICMS por destino
  lr_icms_aliquota_intra: number | null;
  lr_icms_aliquota_inter_sul_sudeste: number | null;
  lr_icms_aliquota_inter_norte_nordeste: number | null;
  /** Fallback caso lr_icms_aliquota_intra esteja vazio. */
  lr_icms_debito: number | null;
}

const c = (v: number | null | undefined): number => v ?? 0;

/**
 * Computes the effective tax rate (%) for a single order using Wesley's formula:
 *
 *   Débito ICMS     = Receita × aliq_ICMS_UF
 *   Base PIS/COFINS = Receita × (1 − aliq_ICMS_UF)
 *   Débito PIS      = Base × 1,65%
 *   Débito COFINS   = Base × 7,60%
 *   Total           = ICMS + PIS + COFINS
 *
 * For ICMS = 12%: rate = 12 + 88% × 9.25% = 20.14%
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
      const intra      = Number(config.lr_icms_aliquota_intra ?? config.lr_icms_debito ?? 0);
      const interSulSE = Number(config.lr_icms_aliquota_inter_sul_sudeste ?? 12);
      const interNNECO = Number(config.lr_icms_aliquota_inter_norte_nordeste ?? 7);

      const orig = config.uf_origem?.toUpperCase() ?? null;
      const dest = ufDestino?.toUpperCase() ?? null;

      let icmsAliq: number;
      if (orig === null) {
        // Sem UF origem configurada: aplica interestadual pela tabela ICMS por destino.
        // Não é possível determinar intra vs inter sem origem → usa alíquota mais comum.
        icmsAliq = (dest && isReducedInterstateDest(dest)) ? interNNECO : interSulSE;
      } else if (dest === null || orig === dest) {
        // Intraestadual (mesma UF ou destino desconhecido)
        icmsAliq = intra;
      } else {
        // Interestadual: tabela ICMS por destino
        icmsAliq = isReducedInterstateDest(dest) ? interNNECO : interSulSE;
      }

      // Fórmula Wesley: ICMS + PIS×(1-ICMS%) + COFINS×(1-ICMS%)
      const baseFactor = 1 - icmsAliq / 100;
      return Math.max(0, icmsAliq + baseFactor * (1.65 + 7.60));
    }
  }
}
