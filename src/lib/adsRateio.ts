// ============================================================================
// adsRateio — Fase 211, Plano 03, Task 1
//
// Régua deste módulo, em uma frase: **a fatura do Mercado Livre é a verdade do
// TOTAL de publicidade; o relatório de publicidade (`ml_ads_products_cache`) é
// apenas a CHAVE de distribuição desse total por anúncio.**
//
// Por que é assim (D-03): `ml_billing_daily` não tem `item_id` — a fatura chega
// agregada por tipo de cobrança e data. Quem tem gasto por MLB é o cache, que
// subestima o total (julho/2026, Pé Vermeio: R$ 9.456,06 na fatura contra
// R$ 1.195,88 no cache). Somar o cache daria o número errado; ignorar o cache
// deixaria o gasto sem distribuição. Usar o total da fatura com a proporção do
// cache entrega as duas coisas: o total certo e a distribuição por anúncio.
//
// A aproximação aceita (D-04): o ML NÃO informa qual venda veio de clique pago.
// Por isso o custo de ads por venda do anúncio é o ads rateado do anúncio no
// período dividido pelas unidades vendidas do anúncio no período — é o TACoS
// por anúncio, e o Wesley aceitou essa régua explicitamente.
//
// Este módulo é PURO: só tipos e aritmética. Nenhuma leitura de banco, nenhum
// componente de tela, nenhuma chamada de rede. Quem lê as três séries é o hook
// `useAdsRateioAnuncio`. A fórmula do MCO (`src/lib/mco.ts`) NÃO muda — muda
// apenas quem preenche o campo `ads`. A régua PADS/BPAD da fase 210
// (`ADS_BILLING_CHARGE_TYPES`, `aggregateAdsBillingSpend`) é reusada, nunca
// redigitada (D-05).
// ============================================================================

import type { AdsBillingSpend, AdsSpendDailyRow } from "./adsBillingSpend";

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Reais → centavos inteiros. Entrada já arredondada a 2 casas, então é exato. */
const emCentavos = (v: number) => Math.round(v * 100);

/**
 * Distribui `totalCentavos` entre `pesos` pelo método do maior resto, em
 * inteiros de centavo.
 *
 * **INVARIANTE — a razão de ser desta função:** a soma do resultado é SEMPRE
 * exatamente igual a `totalCentavos`. Nenhum centavo é criado nem destruído,
 * em nenhuma combinação de total e pesos. É isto que faz o critério "o rateio
 * fecha ao centavo" (ADS-06) ser verdade, e não aproximadamente verdade.
 *
 * Método: cada fatia recebe a parte inteira de `totalCentavos × peso ÷ Σpesos`;
 * os centavos que sobram vão, um a um, para as fatias de maior resto
 * fracionário, com empate resolvido pelo menor índice.
 *
 * Casos de borda:
 * - Σpesos igual a zero (ou lista vazia): devolve zeros do mesmo tamanho — o
 *   chamador trata isso como "dia sem chave de rateio", nunca como zero real.
 * - Total negativo (estorno maior que a cobrança): opera sobre o valor absoluto
 *   e reaplica o sinal no fim, de modo que a soma continue exata.
 * - Peso negativo ou não finito conta como zero (peso não tem sentido negativo).
 *
 * @param totalCentavos total a distribuir, em centavos inteiros
 * @param pesos pesos relativos (mesma ordem do resultado)
 */
export function distribuirCentavos(totalCentavos: number, pesos: number[]): number[] {
  const n = pesos.length;
  if (n === 0) return [];

  const limpos = pesos.map((p) => (Number.isFinite(p) && p > 0 ? p : 0));
  const somaPesos = limpos.reduce((a, b) => a + b, 0);
  const total = Number.isFinite(totalCentavos) ? Math.round(totalCentavos) : 0;

  if (somaPesos <= 0 || total === 0) return new Array<number>(n).fill(0);

  const sinal = total < 0 ? -1 : 1;
  const abs = Math.abs(total);

  const exatos = limpos.map((p) => (abs * p) / somaPesos);
  const fatias = exatos.map((v) => Math.floor(v));
  let resto = abs - fatias.reduce((a, b) => a + b, 0);

  // Ordem de prioridade: maior resto fracionário primeiro; empate → menor índice.
  const ordem = exatos
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  for (let k = 0; resto > 0 && k < ordem.length; k += 1, resto -= 1) {
    fatias[ordem[k].i] += 1;
  }

  return fatias.map((v) => v * sinal);
}

/** Entrada do rateio de publicidade de UM anúncio. */
export interface RateioAnuncioInput {
  /** Fatura do período, no formato que `aggregateAdsBillingSpend` devolve. */
  fatura: AdsBillingSpend | null;
  /** Gasto diário do cache de publicidade PARA O ANÚNCIO escolhido. */
  itemDaily: AdsSpendDailyRow[];
  /** Gasto diário do cache somado sobre TODOS os anúncios das mesmas lojas. */
  totalCacheDaily: AdsSpendDailyRow[];
}

/** De onde veio o número de publicidade do anúncio. */
export type RateioAnuncioSource = "billing-rateio" | "cache";

/** Resultado do rateio de publicidade de UM anúncio. */
export interface RateioAnuncioResult {
  /** Série diária já rateada, ordenada por data e sem os dias de fatia zero. */
  daily: AdsSpendDailyRow[];
  /** Soma dos pontos de `daily` (já arredondados) — o KPI não diverge do gráfico. */
  total: number;
  /** Total de publicidade da fatura no período (0 no ramo de cache). */
  totalFatura: number;
  /** Parte da fatura que nenhum anúncio pôde receber — dia sem chave de rateio. */
  naoRateado: number;
  /** Dias da fatura em que o cache não tinha gasto nenhum (chave ausente). */
  diasSemChave: string[];
  source: RateioAnuncioSource;
}

const somaPorDia = (linhas: AdsSpendDailyRow[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const l of linhas) {
    if (!l || !l.date) continue;
    const v = Number(l.spend);
    m.set(l.date, (m.get(l.date) ?? 0) + (Number.isFinite(v) ? v : 0));
  }
  return m;
};

/**
 * Rateia o gasto de publicidade da fatura para UM anúncio.
 *
 * Regra, dia a dia sobre `fatura.daily`:
 * - **cache do dia > 0** → a fatia do anúncio é o valor da fatura do dia
 *   multiplicado pela razão entre o gasto do anúncio e o gasto total do cache
 *   naquele dia, resolvida em centavos inteiros por `distribuirCentavos` sobre
 *   as duas fatias (o anúncio e os demais anúncios);
 * - **cache do dia zero ou ausente** → o valor da fatura daquele dia não tem
 *   como ser atribuído: entra em `naoRateado`, o dia entra em `diasSemChave`, e
 *   o anúncio não recebe nada por ele. **Nunca descartado em silêncio** — é a
 *   mesma disciplina da fase 210: o número não muda de régua escondido.
 *
 * Fechamento ao centavo (ADS-06): a distribuição em cada dia é feita em
 * centavos inteiros por `distribuirCentavos`, cuja invariante é a soma exata.
 * Somar o rateado de todos os anúncios de um dia mais o não rateado devolve o
 * valor da fatura daquele dia.
 *
 * Ramo de cache: quando `fatura` é nula ou tem `rowCount` igual a zero, devolve
 * a própria série do cache do anúncio com `source: "cache"`. Isto reproduz
 * deliberadamente a decisão da fase 210 — com a fatura ainda não sincronizada,
 * zerar publicidade infla o MCO em silêncio, o que é pior do que exibir o
 * número antigo com a origem rotulada na tela.
 */
export function ratearAdsDoAnuncio(input: RateioAnuncioInput): RateioAnuncioResult {
  const { fatura, itemDaily, totalCacheDaily } = input;

  // ── Ramo de cache: sem fatura no período, o piso é o relatório de publicidade
  if (fatura == null || fatura.rowCount === 0) {
    const daily = [...(itemDaily ?? [])]
      .filter((d) => d && d.date)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return {
      daily,
      total: round2(daily.reduce((acc, d) => acc + (Number(d.spend) || 0), 0)),
      totalFatura: 0,
      naoRateado: 0,
      diasSemChave: [],
      source: "cache",
    };
  }

  // ── Ramo de rateio: a fatura manda no total, o cache manda na distribuição
  const cacheDoItem = somaPorDia(itemDaily ?? []);
  const cacheTotal = somaPorDia(totalCacheDaily ?? []);

  const daily: AdsSpendDailyRow[] = [];
  const diasSemChave: string[] = [];
  let naoRateadoCentavos = 0;

  const diasDaFatura = [...fatura.daily]
    .filter((d) => d && d.date)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  for (const dia of diasDaFatura) {
    const valorCentavos = emCentavos(Number(dia.spend) || 0);
    const totalDoDia = cacheTotal.get(dia.date) ?? 0;

    if (!(totalDoDia > 0)) {
      // Dia sem chave de rateio — o valor não some, fica declarado
      naoRateadoCentavos += valorCentavos;
      diasSemChave.push(dia.date);
      continue;
    }

    const doItem = Math.max(cacheDoItem.get(dia.date) ?? 0, 0);
    const dosDemais = Math.max(totalDoDia - doItem, 0);
    const [fatiaDoItem] = distribuirCentavos(valorCentavos, [doItem, dosDemais]);

    if (fatiaDoItem !== 0) daily.push({ date: dia.date, spend: fatiaDoItem / 100 });
  }

  return {
    daily,
    total: round2(daily.reduce((acc, d) => acc + d.spend, 0)),
    totalFatura: fatura.total,
    naoRateado: round2(naoRateadoCentavos / 100),
    diasSemChave,
    source: "billing-rateio",
  };
}
