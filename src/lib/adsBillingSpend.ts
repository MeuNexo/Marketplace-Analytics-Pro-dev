// ============================================================================
// adsBillingSpend — Fase 210, Plano 01, Task 1 · invertido pela Fase 219,
// Plano 02, Task 1 (D-219-01)
//
// Régua ATUAL (D-219-01, Wesley, 06/08/2026): "o ads deve vir do painel, e não
// da fatura; a fatura serve para fechamento de DRE. Mas cálculo de publicidade
// investida no dia, o painel é o correto por estar coerente com o gasto." O
// gasto de publicidade que entra no MCO passa a ser o do cache diário
// (`ml_ads_daily_cache`, corrigido pela Fase 219 — ver ADS-08/ADS-09), e a
// fatura (`ml_billing_daily`) vira o FALLBACK quando o cache não tem dado no
// período — além de continuar sendo a fonte da DRE.
//
// Por que essa régua não é a mesma da Fase 210: lá o cache tinha OUTRO bug —
// somava linha a linha um retorno da API que repetia o mesmo item em várias
// linhas idênticas (duplicação), inflando o gasto em ~1,4-1,5x. A 210 saiu do
// cache para a fatura por causa dessa duplicação, não porque a fatura fosse
// conceitualmente melhor para "publicidade investida no dia". A Fase 219
// consertou a duplicação (total via `metrics_summary`, produto por produto
// deduplicado por `item_id`) e provou, ao vivo, que o cache corrigido bate ao
// centavo com o painel do ML (219-PROVA.md) — só então a prioridade foi
// invertida de volta.
//
// Medição de 2026-08-05 (Pé Vermeio, seller 1639558873, 219-PROVA.md):
//   cache ANTES do conserto (duplicado) ... R$ 277,01 (inflado 1,397×)
//   cache DEPOIS do conserto ............... R$ 198,27 (painel: R$ 198,27 — diff R$ 0,00)
//
// Este módulo é PURO: só tipos e aritmética. Nenhuma leitura de banco, nenhum
// componente de tela, nenhuma chamada de rede. Quem lê a tabela é o hook
// `useMLAdsBillingSpend`. A fórmula do MCO (`src/lib/mco.ts`) NÃO muda — muda
// apenas quem preenche o campo `ads`.
// ============================================================================

/**
 * Os dois códigos de cobrança de publicidade da fatura do ML:
 * `PADS` (cobrança da campanha) e `BPAD` (estorno de campanha).
 *
 * O estorno já chega da origem com `amount` NEGATIVO — por isso os dois somam
 * direto e o resultado é o líquido. Não existe inversão de sinal em lugar
 * nenhum deste módulo.
 */
export const ADS_BILLING_CHARGE_TYPES = ["PADS", "BPAD"] as const;

export type AdsBillingChargeType = (typeof ADS_BILLING_CHARGE_TYPES)[number];

/** Linha crua de cobrança lida da fatura. */
export interface AdsBillingChargeRow {
  /** Data do lançamento da cobrança, YYYY-MM-DD. É a régua que casa com o dia da venda. */
  charge_date: string;
  /** Código da cobrança. Só `PADS`/`BPAD` contam como publicidade. */
  charge_type: string;
  /** Valor da cobrança. Aceita string porque `numeric` do Postgres pode chegar assim. */
  amount: number | string;
}

/**
 * Ponto diário de gasto de publicidade.
 *
 * O shape é deliberadamente idêntico ao que `CustoOperacionalChart` e
 * `precoMcoSeries.AdsDailyRow` já consomem, para que a troca de fonte não
 * exija troca de contrato.
 */
export interface AdsSpendDailyRow {
  /** YYYY-MM-DD */
  date: string;
  spend: number;
}

/** Resultado da agregação da fatura. */
export interface AdsBillingSpend {
  daily: AdsSpendDailyRow[];
  total: number;
  /**
   * Número de linhas de publicidade CONSIDERADAS. É ele — e não `total` — que
   * decide se houve cobertura de fatura: uma fatura pode legitimamente somar
   * 0,00 quando o estorno é integral.
   */
  rowCount: number;
  /** Menor `charge_date` considerada; null quando não houve linha de publicidade. */
  coverageFrom: string | null;
  /** Maior `charge_date` considerada; null quando não houve linha de publicidade. */
  coverageTo: string | null;
}

/** De onde veio o número de ads exibido. */
export type AdsSpendSource = "billing" | "cache";

/** Gasto de publicidade já resolvido para UMA origem, com o rótulo da origem. */
export interface ResolvedAdsSpend {
  daily: AdsSpendDailyRow[];
  total: number;
  source: AdsSpendSource;
  coverageFrom: string | null;
  coverageTo: string | null;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

const isAdsChargeType = (t: string): t is AdsBillingChargeType =>
  (ADS_BILLING_CHARGE_TYPES as readonly string[]).includes(t);

/**
 * Soma as cobranças de publicidade da fatura por `charge_date`.
 *
 * Regras:
 * - descarta linha cujo `charge_type` não é `PADS`/`BPAD`;
 * - descarta linha sem `charge_date`;
 * - `amount` não numérico conta como 0 (nunca NaN contaminando o total);
 * - cada ponto diário é arredondado a 2 casas e `total` é a soma dos pontos JÁ
 *   arredondados, arredondada de novo — assim `total` é sempre exatamente
 *   `Σ daily.spend` e o KPI não diverge do gráfico por centavo;
 * - `daily` sai ordenado por data ascendente.
 */
export function aggregateAdsBillingSpend(rows: AdsBillingChargeRow[]): AdsBillingSpend {
  const porDia = new Map<string, number>();
  let rowCount = 0;
  let coverageFrom: string | null = null;
  let coverageTo: string | null = null;

  for (const row of rows) {
    if (!row) continue;
    if (!isAdsChargeType(row.charge_type)) continue;
    const date = row.charge_date;
    if (!date) continue;

    const parsed = Number(row.amount);
    const valor = Number.isFinite(parsed) ? parsed : 0;

    porDia.set(date, (porDia.get(date) ?? 0) + valor);
    rowCount += 1;
    if (coverageFrom === null || date < coverageFrom) coverageFrom = date;
    if (coverageTo === null || date > coverageTo) coverageTo = date;
  }

  const daily: AdsSpendDailyRow[] = [...porDia.entries()]
    .map(([date, spend]) => ({ date, spend: round2(spend) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const total = round2(daily.reduce((acc, d) => acc + d.spend, 0));

  return { daily, total, rowCount, coverageFrom, coverageTo };
}

/**
 * Escolhe a origem do gasto de publicidade — cache OU fatura, nunca as duas
 * (D-219-01: prioridade invertida da Fase 210).
 *
 * Regra única e exclusiva: havendo pelo menos um dia de publicidade no cache
 * do período (`cache.daily.length > 0`), vale o CACHE (o painel do ML,
 * consertado pela Fase 219 — ADS-08/ADS-09); caso contrário, se a fatura do
 * período tiver ao menos uma linha de publicidade (`rowCount > 0`), vale a
 * FATURA como fallback; sem nenhuma das duas, o neutro.
 *
 * POR QUE nunca somar: as duas origens descrevem O MESMO gasto por réguas
 * diferentes (o cache é o que o painel do ML reporta; a fatura é o que o ML
 * de fato cobrou). Combiná-las aritmeticamente contaria publicidade duas vezes
 * dentro do MCO. Não existe caminho de código aqui em que valores das duas
 * origens se combinem (Test 12, anti-soma-dupla).
 *
 * POR QUE manter o ramo de fatura: quando o cache do período ainda não
 * sincronizou, zerar ads inflaria o MCO em silêncio — o que é pior do que
 * cair para a fatura, que é a fonte de fechamento da DRE. `source` denuncia
 * qual régua está valendo, para que a troca nunca aconteça escondida.
 */
export function resolveAdsSpend(
  billing: AdsBillingSpend | null | undefined,
  cache: { daily: AdsSpendDailyRow[]; total: number },
): ResolvedAdsSpend {
  if (cache.daily.length > 0) {
    const datas = cache.daily.map((d) => d.date);
    return {
      daily: cache.daily,
      total: cache.total,
      source: "cache",
      coverageFrom: datas.reduce((min, d) => (d < min ? d : min)),
      coverageTo: datas.reduce((max, d) => (d > max ? d : max)),
    };
  }

  if (billing != null && billing.rowCount > 0) {
    return {
      daily: billing.daily,
      total: billing.total,
      source: "billing",
      coverageFrom: billing.coverageFrom,
      coverageTo: billing.coverageTo,
    };
  }

  return {
    daily: [],
    total: 0,
    source: "cache",
    coverageFrom: null,
    coverageTo: null,
  };
}
