/**
 * Util puro de bucketização por faixa de preço + veredito determinístico
 * para a Análise de Preços "em que preço eu vendo bem?".
 *
 * Consome os pontos DIÁRIOS já reconciliados de `computePrecoMcoSeries`
 * (custo/imposto/comissão/ads já calculados — este util só REAGRUPA por
 * faixa de preço, nunca recalcula MCO). Zero I/O, sem imports de UI/rede.
 */
import type { McoSeriesPoint } from "./precoMcoSeries";

export type FaixaMode = "unidades" | "lucro";

/** Snap de largura de bucket para a série "bonita" 1/2/5 × 10^n. Sempre > 0. */
export function niceStep(x: number): number {
  const v = Math.abs(x);
  if (!isFinite(v) || v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const frac = v / pow; // [1,10)
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return Math.max(1, nice * pow);
}

export interface FaixaPreco {
  min: number; // borda inferior (inclusive)
  max: number; // borda superior (exclusive); Infinity no bucket outlier
  label: string; // "R$55–60" ou "+R$75"
  unidades: number; // Σ qtd
  mcoRsTotal: number; // Σ mco (R$)
  receita: number; // Σ precoUnit*qtd
  precoMedio: number; // receita/unidades (0 se unidades=0)
  mcoPctMedio: number | null; // mcoRsTotal/receita (fração) | null se receita=0
  isOutlierBucket: boolean;
  isPrecoAtual: boolean; // contém o preço recente
  altura: number; // = unidades (mode "unidades") ou mcoRsTotal (mode "lucro")
}

export interface FaixasResult {
  faixas: FaixaPreco[];
  larguraBucket: number;
  faixaOtima: FaixaPreco | null; // maior altura conforme mode, entre faixas com unidades>0
  precoRecente: number | null; // precoUnit do ponto diário de data máxima
  margemRecentePct: number | null; // mcoPctMedio da faixa que contém precoRecente
  totalUnidades: number;
  totalMcoRs: number;
}

export interface ComputeFaixasOpts {
  mode: FaixaMode;
}

function brlEdge(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(".", ",");
}

/** Percentil ponderado por unidades sobre pares (preço, peso) já ordenados por preço. */
function weightedPercentile(sorted: { p: number; w: number }[], q: number): number {
  const total = sorted.reduce((s, x) => s + x.w, 0);
  if (total <= 0) return sorted.length ? sorted[0].p : 0;
  const target = total * q;
  let acc = 0;
  for (const x of sorted) {
    acc += x.w;
    if (acc >= target) return x.p;
  }
  return sorted[sorted.length - 1].p;
}

export function computePrecoFaixas(daily: McoSeriesPoint[], opts: ComputeFaixasOpts): FaixasResult {
  const pts = daily.filter((d) => d.qtd > 0 && d.precoUnit > 0);
  if (pts.length === 0) {
    return {
      faixas: [], larguraBucket: 0, faixaOtima: null, precoRecente: null,
      margemRecentePct: null, totalUnidades: 0, totalMcoRs: 0,
    };
  }

  // Preço recente = ponto de bucket (data) máximo.
  const recente = pts.reduce((a, b) => (b.bucket > a.bucket ? b : a));
  const precoRecente = recente.precoUnit;

  // Distribuição de preço ponderada por unidades → p05/p95 concentram ~90% das vendas.
  const sorted = pts.map((d) => ({ p: d.precoUnit, w: d.qtd })).sort((a, b) => a.p - b.p);
  const pLow = weightedPercentile(sorted, 0.05);
  const pHigh = weightedPercentile(sorted, 0.95);
  const spread = Math.max(pHigh - pLow, precoRecente * 0.02, 1);
  const w = niceStep(spread / 2);
  const firstEdge = Math.floor(pLow / w) * w;
  const topEdge = Math.ceil(pHigh / w) * w;

  // Buckets regulares [firstEdge, topEdge) + 1 bucket outlier (≥ topEdge).
  type Acc = { min: number; max: number; unidades: number; mcoRsTotal: number; receita: number; isOutlier: boolean };
  const buckets: Acc[] = [];
  for (let e = firstEdge; e < topEdge; e += w) {
    buckets.push({ min: e, max: e + w, unidades: 0, mcoRsTotal: 0, receita: 0, isOutlier: false });
  }
  const outlier: Acc = { min: topEdge, max: Infinity, unidades: 0, mcoRsTotal: 0, receita: 0, isOutlier: true };

  const idxFor = (price: number): Acc => {
    if (price >= topEdge) return outlier;
    const i = Math.floor((price - firstEdge) / w);
    return buckets[Math.min(Math.max(i, 0), buckets.length - 1)] ?? outlier;
  };

  for (const d of pts) {
    const b = idxFor(d.precoUnit);
    b.unidades += d.qtd;
    b.mcoRsTotal += d.mco;
    b.receita += d.precoUnit * d.qtd;
  }

  const all = [...buckets, outlier].filter((b) => (b.isOutlier ? b.unidades > 0 : true));
  const faixas: FaixaPreco[] = all.map((b) => {
    const contemAtual = precoRecente >= b.min && precoRecente < b.max;
    return {
      min: b.min, max: b.max,
      label: b.isOutlier ? `+R$${brlEdge(b.min)}` : `R$${brlEdge(b.min)}–${brlEdge(b.max)}`,
      unidades: b.unidades, mcoRsTotal: b.mcoRsTotal, receita: b.receita,
      precoMedio: b.unidades > 0 ? b.receita / b.unidades : 0,
      mcoPctMedio: b.receita > 0 ? b.mcoRsTotal / b.receita : null,
      isOutlierBucket: b.isOutlier, isPrecoAtual: contemAtual,
      altura: opts.mode === "lucro" ? b.mcoRsTotal : b.unidades,
    };
  });

  const comVenda = faixas.filter((f) => f.unidades > 0);
  const faixaOtima = comVenda.length
    ? comVenda.reduce((a, b) => (b.altura > a.altura ? b : a))
    : null;
  const faixaAtual = faixas.find((f) => f.isPrecoAtual) ?? null;

  return {
    faixas, larguraBucket: w, faixaOtima, precoRecente,
    margemRecentePct: faixaAtual?.mcoPctMedio ?? null,
    totalUnidades: pts.reduce((s, d) => s + d.qtd, 0),
    totalMcoRs: pts.reduce((s, d) => s + d.mco, 0),
  };
}
