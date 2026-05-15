/**
 * Motor de análise puro — sem dependências React ou Supabase.
 *
 * Implementa os cinco algoritmos do motor comercial:
 *   MOTOR-01: Curva Preço × Volume (buildPriceCurve)
 *   MOTOR-02: Preço GMV           (findPriceGmv)
 *   MOTOR-03: Preço Margem        (findPriceMargin)
 *   MOTOR-04: Preço Neutro        (findPriceNeutral)
 *   MOTOR-05: Elasticidade        (computeElasticity)
 */

import type {
  OrderRecord,
  PriceBucket,
  AnalysisResult,
  ElasticityClass,
} from "./types";

// ─── Guard clause para inputs inválidos ──────────────────────────────────────

/** Resultado zero usado como fallback para entradas inválidas (T-04-01). */
const ZERO_RESULT: AnalysisResult = {
  priceCurve: [],
  priceGmv: 0,
  priceMargin: 0,
  priceNeutral: 0,
  elasticityPct: 0,
  elasticityClass: "baixa",
};

// ─── MOTOR-01: buildPriceCurve ───────────────────────────────────────────────

/**
 * Agrupa pedidos por preço unitário e calcula as métricas de cada bucket.
 * dailyAvg usa periodDays total (não activeDays).
 */
function buildPriceCurve(
  orders: OrderRecord[],
  periodDays: number,
): PriceBucket[] {
  // Agrupar por price (chave string para precisão)
  const map = new Map<
    number,
    { units: number; gmv: number; dates: Set<string> }
  >();

  for (const order of orders) {
    const price = order.price;
    const existing = map.get(price);
    if (existing) {
      existing.units += order.quantity;
      existing.gmv += price * order.quantity;
      existing.dates.add(order.order_date);
    } else {
      map.set(price, {
        units: order.quantity,
        gmv: price * order.quantity,
        dates: new Set([order.order_date]),
      });
    }
  }

  // Calcular totais para shares
  let totalUnits = 0;
  let totalGmv = 0;
  for (const v of map.values()) {
    totalUnits += v.units;
    totalGmv += v.gmv;
  }

  // Montar buckets
  const buckets: PriceBucket[] = [];
  for (const [price, v] of map.entries()) {
    buckets.push({
      price,
      units: v.units,
      gmv: v.gmv,
      activeDays: v.dates.size,
      dailyAvg: v.units / periodDays,
      volShare: totalUnits > 0 ? v.units / totalUnits : 0,
      gmvShare: totalGmv > 0 ? v.gmv / totalGmv : 0,
    });
  }

  // Ordenar por price ASC
  return buckets.sort((a, b) => a.price - b.price);
}

// ─── MOTOR-02: findPriceGmv ──────────────────────────────────────────────────

/**
 * Retorna o preço com maior dailyAvg.
 * Desempate: maior GMV.
 */
function findPriceGmv(curve: PriceBucket[]): number {
  if (curve.length === 0) return 0;

  const best = [...curve].sort((a, b) => {
    if (b.dailyAvg !== a.dailyAvg) return b.dailyAvg - a.dailyAvg;
    return b.gmv - a.gmv;
  })[0];

  return best.price;
}

// ─── MOTOR-03: findPriceMargin ───────────────────────────────────────────────

/**
 * Arredonda um valor para o menor x.99 >= raw.
 * Exemplos: 66.00 → 66.99, 65.45 → 65.99, 65.99 → 65.99, 66.01 → 66.99
 */
function roundUpTo99(raw: number): number {
  // Math.ceil(raw - 0.99) + 0.99 → menor inteiro k tal que k + 0.99 >= raw
  return Math.ceil(raw - 0.99) + 0.99;
}

/**
 * Retorna o maior preço acima do priceGmv com volume qualificado.
 * Fallback: priceGmv × 1.10 arredondado para .99.
 */
function findPriceMargin(
  curve: PriceBucket[],
  priceGmv: number,
): number {
  const gmvBucket = curve.find((b) => b.price === priceGmv);
  if (!gmvBucket) return roundUpTo99(priceGmv * 1.1);

  const threshold = gmvBucket.units * 0.15;

  const candidates = curve.filter(
    (b) => b.price > priceGmv && b.units >= threshold,
  );

  if (candidates.length > 0) {
    // Maior preço qualificado
    return Math.max(...candidates.map((b) => b.price));
  }

  // Fallback
  return roundUpTo99(priceGmv * 1.1);
}

// ─── MOTOR-04: findPriceNeutral ──────────────────────────────────────────────

/**
 * Arredonda value para o menor x.ending >= value.
 * ending deve ser 0.99 ou 0.90.
 */
function roundUpToEnding(value: number, ending: number): number {
  const floor = Math.floor(value);
  const candidate = floor + ending;
  return candidate >= value ? candidate : floor + 1 + ending;
}

/**
 * Retorna o preço real mais próximo da média ponderada no range [priceGmv, priceMargin].
 * Fallback (sem candidatos): mid arredondado para .99 ou .90.
 */
function findPriceNeutral(
  curve: PriceBucket[],
  priceGmv: number,
  priceMargin: number,
): number {
  // Média ponderada por unidades sobre todos os buckets
  const totalUnits = curve.reduce((sum, b) => sum + b.units, 0);
  const weightedAvg =
    totalUnits > 0
      ? curve.reduce((sum, b) => sum + b.price * b.units, 0) / totalUnits
      : priceGmv;

  // Candidatos reais no range [priceGmv, priceMargin]
  const candidates = curve.filter(
    (b) => b.price >= priceGmv && b.price <= priceMargin,
  );

  if (candidates.length > 0) {
    // Mais próximo da média ponderada; empate → menor preço
    return candidates.reduce((best, b) => {
      const distB = Math.abs(b.price - weightedAvg);
      const distBest = Math.abs(best.price - weightedAvg);
      if (distB < distBest) return b;
      if (distB === distBest) return b.price < best.price ? b : best;
      return best;
    }).price;
  }

  // Fallback: mid arredondado para .99 ou .90
  const mid = (priceGmv + priceMargin) / 2;
  const opt99 = roundUpToEnding(mid, 0.99);
  const opt90 = roundUpToEnding(mid, 0.9);
  const dist99 = Math.abs(opt99 - mid);
  const dist90 = Math.abs(opt90 - mid);
  return dist90 < dist99 ? opt90 : opt99;
}

// ─── MOTOR-05: computeElasticity ─────────────────────────────────────────────

function classifyElasticity(pct: number): ElasticityClass {
  if (pct <= 0.7) return "baixa";
  if (pct <= 1.3) return "media";
  if (pct <= 2.0) return "alta";
  return "extrema";
}

/**
 * Calcula a elasticidade por R$1,00 acima do priceGmv.
 * Edge case: se priceMargin == priceGmv, retorna 0 / 'baixa'.
 */
function computeElasticity(
  curve: PriceBucket[],
  priceGmv: number,
  priceMargin: number,
): { elasticityPct: number; elasticityClass: ElasticityClass } {
  if (priceMargin === priceGmv) {
    return { elasticityPct: 0, elasticityClass: "baixa" };
  }

  const gmvBucket = curve.find((b) => b.price === priceGmv);
  const marginBucket = curve.find((b) => b.price === priceMargin);

  const dailyAvgGmv = gmvBucket ? gmvBucket.dailyAvg : 0;
  const dailyAvgMargin = marginBucket ? marginBucket.dailyAvg : 0;

  if (dailyAvgGmv === 0) {
    return { elasticityPct: 0, elasticityClass: "baixa" };
  }

  const deltaPrice = priceMargin - priceGmv;
  const deltaVol = dailyAvgGmv - dailyAvgMargin;
  const lossPerReal = deltaVol / deltaPrice;
  const elasticityPct = (lossPerReal / dailyAvgGmv) * 100;

  return {
    elasticityPct,
    elasticityClass: classifyElasticity(elasticityPct),
  };
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Motor de análise comercial: transforma um array de pedidos em recomendações
 * de preço e métricas de elasticidade.
 *
 * @param orders   - Registros de pedidos da tabela `orders` do Supabase.
 * @param periodDays - Tamanho do período analisado em dias (deve ser > 0).
 * @returns AnalysisResult com priceCurve, priceGmv, priceMargin, priceNeutral,
 *          elasticityPct e elasticityClass.
 */
export function computeAnalysis(
  orders: OrderRecord[],
  periodDays: number,
): AnalysisResult {
  // Guard clause T-04-01: entradas degeneradas retornam zeros
  if (!orders || orders.length === 0 || periodDays <= 0) {
    return ZERO_RESULT;
  }

  const priceCurve = buildPriceCurve(orders, periodDays);
  const priceGmv = findPriceGmv(priceCurve);
  const priceMargin = findPriceMargin(priceCurve, priceGmv);
  const priceNeutral = findPriceNeutral(priceCurve, priceGmv, priceMargin);
  const { elasticityPct, elasticityClass } = computeElasticity(
    priceCurve,
    priceGmv,
    priceMargin,
  );

  return {
    priceCurve,
    priceGmv,
    priceMargin,
    priceNeutral,
    elasticityPct,
    elasticityClass,
  };
}
