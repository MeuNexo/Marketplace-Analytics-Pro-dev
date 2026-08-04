// ============================================================================
// adsBillingSpend — Fase 210, Plano 01, Task 1
//
// Régua deste módulo: o gasto de publicidade que entra no MCO é o que o Mercado
// Livre DE FATO cobrou, lido da fatura (`ml_billing_daily`), e não o que a API
// de Ads reporta no cache diário (`ml_ads_daily_cache`).
//
// Medição de 2026-08-04 (org Wesley, seller 2359559427), mesmo período:
//   cache de ads .............. R$   189,10
//   fatura PADS+BPAD .......... R$ 1.987,47
// Efeito no MCO: R$ 20.390,34 (13,31%) -> R$ 18.591,97 (12,14%).
// O cache não é só menor — ele erra o formato (abril: 0,00 no cache contra
// 532,94 cobrados). Por isso a fonte do MCO muda; as telas de Publicidade
// continuam no cache, porque precisam de métrica por campanha/anúncio.
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
 * Escolhe a origem do gasto de publicidade — fatura OU cache, nunca as duas.
 *
 * Regra única e exclusiva: havendo pelo menos uma linha de publicidade na
 * fatura do período (`rowCount > 0`), vale a fatura; caso contrário vale o
 * cache.
 *
 * POR QUE nunca somar: as duas origens descrevem O MESMO gasto por réguas
 * diferentes (a fatura é o que o ML cobrou; o cache é o que a API de Ads
 * reporta). Combiná-las aritmeticamente contaria publicidade duas vezes dentro
 * do MCO — no caso medido daria R$ 2.176,57 em vez dos R$ 1.987,47 reais. Não
 * existe caminho de código aqui em que valores das duas origens se combinem.
 *
 * POR QUE manter o ramo de cache: quando a fatura do período ainda não
 * sincronizou, zerar ads inflaria o MCO em silêncio — o que é pior do que
 * exibir o número antigo. O cache é o piso; `source` denuncia qual régua está
 * valendo, para que a troca nunca aconteça escondida.
 */
export function resolveAdsSpend(
  billing: AdsBillingSpend | null | undefined,
  cache: { daily: AdsSpendDailyRow[]; total: number },
): ResolvedAdsSpend {
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
    daily: cache.daily,
    total: cache.total,
    source: "cache",
    coverageFrom: null,
    coverageTo: null,
  };
}
