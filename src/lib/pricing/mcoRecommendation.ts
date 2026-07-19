/**
 * Alavancas de recomendação de margem (D-07) para o card de waterfall de MCO
 * da Análise de Preços — preço mínimo para uma meta de MCO% e ACOS-alvo.
 *
 * Zero I/O, zero reimplementação: reusa `reversePrice` (src/lib/pricing/calculator.ts,
 * em produção desde a Phase 50) para o preço mínimo — nunca reinventa a álgebra
 * de break-even (Pitfall 1). ACOS-alvo é álgebra de uma linha sobre
 * `mcBeforeAdsPct` (margem antes de ads, já calculada por computeWaterfallCard).
 */
import { reversePrice, type ExtraDeduction } from "@/lib/pricing/calculator";
import type { WaterfallCard } from "@/lib/precoMcoSeries";

const NO_EXTRA: ExtraDeduction = { enabled: false, mode: "percent", value: 0 };

export interface McoRecommendation {
  /** Preço mínimo (via reversePrice, mode "margin") para atingir targetMcoPct — null quando inatingível */
  precoMinimo: number | null;
  /** mcBeforeAdsPct − targetMcoPct — ACOS máximo sustentável antes de perder a meta; null quando mcBeforeAdsPct indisponível */
  acosMeta: number | null;
  /** true quando reversePrice não encontra um preço que atinja a meta com os custos atuais */
  metaImpraticavel: boolean;
  /** true quando acosMeta <= 0 (meta inatingível mesmo sem ads) */
  acosInatingivel: boolean;
}

/**
 * Computa as duas alavancas de recomendação a partir do WaterfallCard já
 * calculado (computeWaterfallCard) e de uma meta de MCO% (targetMcoPct).
 *
 * Nunca lança exceção e nunca retorna NaN/Infinity: quando card.precoUnit é 0
 * (sem custos/vendas no período), ambas as alavancas degradam para null em
 * vez de alimentar reversePrice com dados de custo zerados (o que produziria
 * um "preço mínimo" de R$0 enganoso).
 */
export function computeMcoRecommendation(
  card: WaterfallCard,
  targetMcoPct: number,
): McoRecommendation {
  if (card.precoUnit <= 0) {
    return { precoMinimo: null, acosMeta: null, metaImpraticavel: true, acosInatingivel: true };
  }

  const commissionPct = (card.comissaoUnit / card.precoUnit) * 100;
  const taxPct = (card.impostoUnit / card.precoUnit) * 100;

  const precoMinimo = reversePrice(
    {
      cost: card.cmvUnit,
      commissionPct,
      fixedFee: 0,
      shippingCost: card.freteUnit + card.adsUnit,
      taxPct,
      difalEnabled: false,
      difalPct: 0,
      rebate: NO_EXTRA,
      cupom: NO_EXTRA,
      afiliado: NO_EXTRA,
      promo: NO_EXTRA,
    },
    targetMcoPct,
    "margin",
  );

  const acosMeta = card.mcBeforeAdsPct != null ? card.mcBeforeAdsPct - targetMcoPct : null;

  return {
    precoMinimo,
    acosMeta,
    metaImpraticavel: precoMinimo === null,
    acosInatingivel: acosMeta !== null && acosMeta <= 0,
  };
}
