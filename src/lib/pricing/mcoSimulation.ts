/**
 * Motor de cálculo do simulador manual de MCO (D-04) para o card de waterfall
 * da Análise de Preços — recompute puro, ao vivo, a partir dos valores
 * por-unidade editados pelo usuário.
 *
 * Zero I/O, zero reimplementação: reusa `computeMco` (src/lib/mco.ts) como
 * fonte única da fórmula de MCO — a subtração receita-menos-custos nunca é
 * reescrita localmente. Os valores por-unidade são alimentados a
 * `computeMco` como se fossem "totais do período de 1 unidade", o que é
 * válido porque a fórmula é linear/escala-invariante (a razão mco/revenue
 * não depende do que "1 unidade" significa).
 */
import { computeMco } from "@/lib/mco";

/** Inputs editados pelo usuário durante a simulação — por unidade, comissão/imposto como % do precoUnit. */
export interface SimulatedInputs {
  precoUnit: number;
  cmvUnit: number;
  /** % do precoUnit (0-100) — NÃO R$, espelha a derivação commissionPct de mcoRecommendation.ts */
  comissaoPct: number;
  freteUnit: number;
  /** % do precoUnit (0-100) — NÃO R$ */
  impostoPct: number;
  adsUnit: number;
}

/** Mesmos nomes/formato dos campos derivados do WaterfallCard, para o componente
 *  reusar exatamente o mesmo código de renderização de Row para real vs. simulado. */
export interface SimulatedWaterfall {
  precoUnit: number;
  cmvUnit: number;
  comissaoUnit: number;
  freteUnit: number;
  impostoUnit: number;
  adsUnit: number;
  /** Margem de contribuição por unidade ANTES de ads */
  mcUnit: number;
  mcoUnit: number;
  mcoPct: number | null;
}

/**
 * Computa o waterfall simulado a partir dos valores por-unidade editados pelo
 * usuário. Nunca lança exceção e nunca retorna NaN/Infinity: quando
 * precoUnit <= 0, comissaoUnit e impostoUnit degradam para 0 (guard contra
 * divisão por preço zero) e mcoPct degrada para null (via computeMco, que já
 * retorna pct=null quando grossRevenue <= 0).
 */
export function computeSimulatedWaterfall(input: SimulatedInputs): SimulatedWaterfall {
  const { precoUnit, cmvUnit, comissaoPct, freteUnit, impostoPct, adsUnit } = input;

  const comissaoUnit = precoUnit > 0 ? (precoUnit * comissaoPct) / 100 : 0;
  const impostoUnit = precoUnit > 0 ? (precoUnit * impostoPct) / 100 : 0;

  const { mco, pct } = computeMco({
    grossRevenue: precoUnit,
    cmv: cmvUnit,
    platformCost: comissaoUnit + freteUnit,
    ads: adsUnit,
    tax: impostoUnit,
  });

  return {
    precoUnit,
    cmvUnit,
    comissaoUnit,
    freteUnit,
    impostoUnit,
    adsUnit,
    mcUnit: precoUnit - cmvUnit - comissaoUnit - freteUnit - impostoUnit,
    mcoUnit: mco,
    mcoPct: pct,
  };
}
