/**
 * Módulo puro de cálculo de compra recomendada — sem dependências React, Supabase ou DOM.
 *
 * Implementa COMP-03 (compra recomendada) e COMP-04 (sugestão FULL) a partir de
 * um AnalysisSnapshot, inputs de estoque do usuário e multiplicador de demanda.
 */

import type { AnalysisSnapshot } from "@/hooks/useAnalysisSnapshots";

// ── Tipos exportados ──────────────────────────────────────────────────────────

export interface StockInputs {
  diasCobertura: number;
  estoqueTotal: number;
  estoqueFull: number;
  estoqueCasa: number;
}

export type Multiplicador = 1.0 | 1.2 | 1.5 | 2.0;

export interface CompraResult {
  vendaDiariaEstrategia: number;
  coberturaAlvo: number;
  compraRecomendada: number;
  sugestaoFull: number;
  pctFull: number;
  estrategiaUsada: 'gmv' | 'neutral' | 'margin';
  fallbackUsed: boolean;
}

// ── Helpers internos ──────────────────────────────────────────────────────────

/**
 * Compara dois preços usando equivalência em centavos inteiros para evitar
 * problemas de precisão de ponto flutuante (float equality pitfall).
 */
function pricesMatch(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Determina a venda diária a ser usada com base na estratégia do snapshot.
 *
 * - Se strategy é 'gmv' | 'neutral' | 'margin', seleciona o preço correspondente
 *   e busca o bucket no priceCurve via comparação em centavos inteiros.
 * - Se strategy === null, usa priceGmv como alvo com fallback: true.
 * - Se nenhum bucket for encontrado (defensivo), retorna dailyAvg: 0 com fallback: true.
 */
export function getVendaDiaria(
  snapshot: AnalysisSnapshot,
): { dailyAvg: number; estrategia: 'gmv' | 'neutral' | 'margin'; fallback: boolean } {
  let target: number;
  let estrategia: 'gmv' | 'neutral' | 'margin';
  let fallback: boolean;

  if (snapshot.strategy === null) {
    target = snapshot.priceGmv;
    estrategia = 'gmv';
    fallback = true;
  } else {
    estrategia = snapshot.strategy;
    fallback = false;
    if (estrategia === 'gmv') {
      target = snapshot.priceGmv;
    } else if (estrategia === 'neutral') {
      target = snapshot.priceNeutral;
    } else {
      target = snapshot.priceMargin;
    }
  }

  const bucket = snapshot.priceCurve.find((b) => pricesMatch(b.price, target));

  if (!bucket) {
    // Fallback defensivo: nenhum bucket encontrado
    return { dailyAvg: 0, estrategia: 'gmv', fallback: true };
  }

  return { dailyAvg: bucket.dailyAvg, estrategia, fallback };
}

/**
 * Retorna o percentual de estoque FULL alvo de acordo com a estratégia.
 *
 * GMV → 0.80, neutral → 0.60, margin → 0.50
 */
export function getPctFull(estrategia: 'gmv' | 'neutral' | 'margin'): number {
  switch (estrategia) {
    case 'gmv':
      return 0.80;
    case 'neutral':
      return 0.60;
    case 'margin':
      return 0.50;
  }
}

/**
 * Calcula a compra recomendada e a sugestão de envio FULL.
 *
 * COMP-03: compraRecomendada = Math.max(0, Math.ceil(coberturaAlvo) - estoqueTotal)
 * COMP-04: sugestaoFull = Math.min(Math.ceil(coberturaAlvo × pctFull), estoqueTotal)
 *
 * @param snapshot     - Snapshot de análise com estratégia e curva de preços.
 * @param inputs       - Inputs de estoque fornecidos pelo usuário.
 * @param multiplicador - Fator de multiplicação de demanda (1.0 | 1.2 | 1.5 | 2.0).
 */
export function calcularCompra(
  snapshot: AnalysisSnapshot,
  inputs: StockInputs,
  multiplicador: Multiplicador,
): CompraResult {
  const { dailyAvg, estrategia, fallback } = getVendaDiaria(snapshot);
  const pctFull = getPctFull(estrategia);

  const vendaDiariaEstrategia = dailyAvg;
  const coberturaAlvo = vendaDiariaEstrategia * multiplicador * inputs.diasCobertura;

  // COMP-03: garantir compra >= 0 (T-06-01)
  const compraRecomendada = Math.max(0, Math.ceil(coberturaAlvo) - inputs.estoqueTotal);

  // COMP-04: sugestao FULL nunca excede estoqueTotal (T-06-01)
  const sugestaoFull = Math.min(Math.ceil(coberturaAlvo * pctFull), inputs.estoqueTotal);

  return {
    vendaDiariaEstrategia,
    coberturaAlvo,
    compraRecomendada,
    sugestaoFull,
    pctFull,
    estrategiaUsada: estrategia,
    fallbackUsed: fallback,
  };
}
