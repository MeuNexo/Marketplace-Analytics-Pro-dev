/**
 * Util puro da série de MCO por bucket para a Análise de Preços.
 *
 * Transforma as linhas da RPC `orders_price_timeseries` (componentes firmes por
 * bucket: cmv, comissão, frete, impostos = SUM(tax_amount)) + o spend diário de ads
 * (`ml_ads_products_cache`) em pontos prontos para o gráfico preço × break-even.
 *
 * Fórmula (reconciliada com computeMco de ./mco — REUSADA, não duplicada):
 *   mco = total − cmv − (comissao + frete) − ads − impostos
 *   mcoPct = total > 0 ? mco/total×100 : null
 *   precoUnit = total/qtd ; breakevenUnit = (cmv+comissao+frete+ads+impostos)/qtd
 *
 * Bandas do colchão (técnica de Areas empilhadas, mutuamente exclusivas):
 *   base = min(precoUnit, breakevenUnit)
 *   gainBand = preço ≥ break-even ? diferença : 0  (verde)
 *   lossBand = preço < break-even ? diferença : 0  (vermelho)
 *
 * Ads: a série diária é bucketizada pela MESMA truncagem da RPC via bucketKeyForDate
 * (dia = a própria data; semana = segunda-feira, igual date_trunc('week') do Postgres;
 * mês = dia 1). Com incluirAds=false, ads=0 em todos os buckets e o break-even perde
 * a parcela de publicidade.
 *
 * Zero I/O: sem imports de UI/rede — apenas date-fns e computeMco.
 */
import {
  differenceInCalendarDays,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
  subDays,
} from "date-fns";
import { computeMco } from "./mco";

export type SeriesGranularity = "day" | "week" | "month";

/** Linha da RPC orders_price_timeseries (campos usados no cálculo). */
export interface PrecoSeriesRow {
  /** YYYY-MM-DD — já truncado pela RPC conforme a granularidade */
  bucket: string;
  qtd: number;
  /** Receita bruta do bucket */
  total: number;
  cmv: number;
  comissao: number;
  frete: number;
  qtd_sem_custo: number;
  /** SUM(tax_amount) do bucket — imposto firme por pedido (UF real) */
  impostos: number;
  qtd_sem_imposto: number;
  /**
   * [222-15-R2] Efeito líquido do DIFAL do intervalo — o INSUMO do segundo
   * cenário, nunca o segundo cenário pronto. `null`/ausente = a RPC ainda não
   * devolve a coluna (janela de publicação) e o segundo cenário não existe.
   */
  difal_efeito?: number | null;
  /** Pedidos do intervalo com destino interestadual e sem DIFAL calculado. */
  pedidos_difal_indefinido?: number | null;
}

/** Linha diária de spend de ads (ml_ads_products_cache). */
export interface AdsDailyRow {
  /** YYYY-MM-DD */
  date: string;
  spend: number;
}

/** Ponto da série de MCO pronto para o gráfico. */
export interface McoSeriesPoint {
  bucket: string;
  /** Unidades vendidas no bucket (r.qtd) */
  qtd: number;
  precoUnit: number;
  breakevenUnit: number;
  cmvUnit: number;
  comissaoUnit: number;
  freteUnit: number;
  adsUnit: number;
  impostoUnit: number;
  /** Spend de ads do bucket em R$ (0 quando incluirAds=false ou sem cobertura) */
  ads: number;
  mco: number;
  mcoPct: number | null;
  /** min(precoUnit, breakevenUnit) — série invisível de apoio das bandas */
  base: number;
  /** > 0 apenas quando preço ≥ break-even (mutuamente exclusiva com lossBand) */
  gainBand: number;
  /** > 0 apenas quando preço < break-even (mutuamente exclusiva com gainBand) */
  lossBand: number;
  custoAusente: boolean;
  impostoAusente: boolean;
  // ── Segundo cenário: com DIFAL (222-15-R2) ────────────────────────────────
  //
  // 🔴 COMPOSTO CHAMANDO `computeMco` UMA SEGUNDA VEZ, com o imposto acrescido
  // do efeito líquido do DIFAL — NUNCA somando DIFAL sobre o MCO já pronto.
  // O segundo atalho é o que custou R$ 3,85 por pedido no 222-06-R/07-R.
  /** Efeito líquido do DIFAL do bucket (R$); null quando não apurado. */
  difalEfeito: number | null;
  /** MCO do bucket COM DIFAL (R$); null quando não apurado. */
  mcoComDifal: number | null;
  /** MCO% do bucket COM DIFAL; null quando não apurado ou sem receita. */
  mcoPctComDifal: number | null;
  /** Break-even por unidade COM DIFAL; null quando não apurado. */
  breakevenUnitComDifal: number | null;
  /** Imposto por unidade COM DIFAL; null quando não apurado. */
  impostoUnitComDifal: number | null;
  /** Pedidos do bucket fora da conta por UF não confirmada. */
  pedidosDifalIndefinido: number;
}

/**
 * Chave de bucket alinhada à truncagem do Postgres (date_trunc):
 * dia = a própria data; semana = segunda-feira (weekStartsOn: 1);
 * mês = dia 1. Garante que o ads diário caia no mesmo bucket da RPC.
 */
export function bucketKeyForDate(iso: string, g: SeriesGranularity): string {
  if (g === "day") return iso;
  const d = parseISO(iso);
  const truncated = g === "week" ? startOfWeek(d, { weekStartsOn: 1 }) : startOfMonth(d);
  return format(truncated, "yyyy-MM-dd");
}

export interface ComputePrecoMcoSeriesOpts {
  adsDaily: AdsDailyRow[];
  incluirAds: boolean;
  granularity: SeriesGranularity;
}

/**
 * Computa a série de MCO por bucket a partir das linhas da RPC + ads diário.
 * Função pura e defensiva: qtd=0 nunca produz NaN/Infinity (unidades viram 0).
 */
export function computePrecoMcoSeries(
  rows: PrecoSeriesRow[],
  opts: ComputePrecoMcoSeriesOpts,
): McoSeriesPoint[] {
  // Passo 1: pré-agrega o spend diário no bucket da granularidade.
  const adsByBucket = new Map<string, number>();
  if (opts.incluirAds) {
    for (const a of opts.adsDaily) {
      const key = bucketKeyForDate(a.date, opts.granularity);
      adsByBucket.set(key, (adsByBucket.get(key) ?? 0) + (a.spend ?? 0));
    }
  }

  // Passo 2: monta o ponto de cada bucket reusando computeMco.
  return rows.map((r) => {
    const qtd = r.qtd;
    const ads = opts.incluirAds ? adsByBucket.get(r.bucket) ?? 0 : 0;

    const { mco, pct } = computeMco({
      grossRevenue: r.total,
      cmv: r.cmv,
      platformCost: r.comissao + r.frete,
      ads,
      tax: r.impostos,
    });

    const precoUnit = qtd > 0 ? r.total / qtd : 0;
    const breakevenUnit =
      qtd > 0 ? (r.cmv + r.comissao + r.frete + ads + r.impostos) / qtd : 0;

    const base = Math.min(precoUnit, breakevenUnit);
    const gainBand = precoUnit >= breakevenUnit ? precoUnit - breakevenUnit : 0;
    const lossBand = precoUnit < breakevenUnit ? breakevenUnit - precoUnit : 0;

    // [222-15-R2] O SEGUNDO CENÁRIO. `computeMco` é chamado uma segunda vez —
    // a mesma função, a mesma entrada, com o termo de imposto trocado por
    // `impostos + efeito líquido do DIFAL`. Somar o DIFAL sobre `mco` já
    // calculado daria um número diferente deste, e errado.
    const difalEfeito = r.difal_efeito ?? null;
    const impostosComDifal = difalEfeito != null ? r.impostos + difalEfeito : null;
    const comDifal =
      impostosComDifal != null
        ? computeMco({
            grossRevenue: r.total,
            cmv: r.cmv,
            platformCost: r.comissao + r.frete,
            ads,
            tax: impostosComDifal,
          })
        : null;

    return {
      bucket: r.bucket,
      qtd: r.qtd,
      precoUnit,
      breakevenUnit,
      cmvUnit: qtd > 0 ? r.cmv / qtd : 0,
      comissaoUnit: qtd > 0 ? r.comissao / qtd : 0,
      freteUnit: qtd > 0 ? r.frete / qtd : 0,
      adsUnit: qtd > 0 ? ads / qtd : 0,
      impostoUnit: qtd > 0 ? r.impostos / qtd : 0,
      ads,
      mco,
      mcoPct: pct,
      base,
      gainBand,
      lossBand,
      custoAusente: r.qtd_sem_custo > 0,
      impostoAusente: r.qtd_sem_imposto > 0,
      difalEfeito,
      mcoComDifal: comDifal ? comDifal.mco : null,
      mcoPctComDifal: comDifal ? comDifal.pct : null,
      breakevenUnitComDifal:
        impostosComDifal != null && qtd > 0
          ? (r.cmv + r.comissao + r.frete + ads + impostosComDifal) / qtd
          : null,
      impostoUnitComDifal:
        impostosComDifal != null && qtd > 0 ? impostosComDifal / qtd : null,
      pedidosDifalIndefinido: r.pedidos_difal_indefinido ?? 0,
    };
  });
}

/** Waterfall por unidade, média do período (D-02) — reusa computeMco, sem reinventar a fórmula. */
export interface WaterfallCard {
  precoUnit: number;
  cmvUnit: number;
  comissaoUnit: number;
  freteUnit: number;
  adsUnit: number;
  impostoUnit: number;
  /** Margem de contribuição por unidade ANTES de ads */
  mcUnit: number;
  /** MCO por unidade (após ads) — mco (via computeMco sobre os totais do período) / Σqtd */
  mcoUnit: number;
  /** MCO% do período (não é a média dos mcoPct dos buckets) */
  mcoPct: number | null;
  /** mcUnit/precoUnit×100 — margem antes de ads como % do preço */
  mcBeforeAdsPct: number | null;
  custoAusente: boolean;
  impostoAusente: boolean;
  // ── Segundo cenário: com DIFAL (222-15-R2) ────────────────────────────────
  /** Efeito líquido do DIFAL do período (R$); null quando não apurado. */
  difalEfeito: number | null;
  /** Imposto por unidade COM DIFAL; null quando não apurado. */
  impostoUnitComDifal: number | null;
  /** MCO por unidade COM DIFAL; null quando não apurado. */
  mcoUnitComDifal: number | null;
  /** MCO em R$ do período COM DIFAL; null quando não apurado. */
  mcoComDifal: number | null;
  /** MCO% do período COM DIFAL; null quando não apurado ou sem receita. */
  mcoPctComDifal: number | null;
  /** Pedidos do período fora da conta por UF não confirmada. */
  pedidosDifalIndefinido: number;
}

/**
 * Computa o card de waterfall por unidade (média do período) a partir das
 * mesmas rows/adsDaily que computePrecoMcoSeries já usa. Reusa computeMco
 * para a fórmula do MCO (nunca recalculada aqui) — fonte única com
 * computePrecoMcoSeries/computePriceKpis.
 */
export function computeWaterfallCard(
  rows: PrecoSeriesRow[],
  opts: ComputePrecoMcoSeriesOpts,
): WaterfallCard {
  const serie = computePrecoMcoSeries(rows, opts);
  const adsTotal = serie.reduce((s, p) => s + p.ads, 0);

  const qtd = rows.reduce((s, r) => s + r.qtd, 0);
  const receita = rows.reduce((s, r) => s + r.total, 0);
  const cmv = rows.reduce((s, r) => s + r.cmv, 0);
  const comissao = rows.reduce((s, r) => s + r.comissao, 0);
  const frete = rows.reduce((s, r) => s + r.frete, 0);
  const impostos = rows.reduce((s, r) => s + r.impostos, 0);

  const { mco, pct } = computeMco({
    grossRevenue: receita,
    cmv,
    platformCost: comissao + frete,
    ads: adsTotal,
    tax: impostos,
  });

  // [222-15-R2] Segundo cenário do card: mesma `computeMco`, mesma entrada,
  // termo de imposto trocado. Um único intervalo sem o efeito apurado derruba
  // o período inteiro para AUSÊNCIA — somar só os apurados produziria um
  // numerador que não corresponde à receita do denominador.
  const algumSemDifal = rows.some((r) => r.difal_efeito == null);
  const difalEfeito = algumSemDifal
    ? null
    : rows.reduce((sfx, r) => sfx + (r.difal_efeito ?? 0), 0);
  const impostosComDifal = difalEfeito != null ? impostos + difalEfeito : null;
  const comDifal =
    impostosComDifal != null
      ? computeMco({
          grossRevenue: receita,
          cmv,
          platformCost: comissao + frete,
          ads: adsTotal,
          tax: impostosComDifal,
        })
      : null;

  const precoUnit = qtd > 0 ? receita / qtd : 0;
  const mcBeforeAdsUnit = qtd > 0 ? (receita - cmv - comissao - frete - impostos) / qtd : 0;

  return {
    precoUnit,
    cmvUnit: qtd > 0 ? cmv / qtd : 0,
    comissaoUnit: qtd > 0 ? comissao / qtd : 0,
    freteUnit: qtd > 0 ? frete / qtd : 0,
    adsUnit: qtd > 0 ? adsTotal / qtd : 0,
    impostoUnit: qtd > 0 ? impostos / qtd : 0,
    mcUnit: mcBeforeAdsUnit,
    mcoUnit: qtd > 0 ? mco / qtd : 0,
    mcoPct: pct,
    mcBeforeAdsPct: precoUnit > 0 ? (mcBeforeAdsUnit / precoUnit) * 100 : null,
    custoAusente: rows.some((r) => r.qtd_sem_custo > 0),
    impostoAusente: rows.some((r) => r.qtd_sem_imposto > 0),
    difalEfeito,
    impostoUnitComDifal:
      impostosComDifal != null && qtd > 0 ? impostosComDifal / qtd : null,
    mcoUnitComDifal: comDifal && qtd > 0 ? comDifal.mco / qtd : null,
    mcoComDifal: comDifal ? comDifal.mco : null,
    mcoPctComDifal: comDifal ? comDifal.pct : null,
    pedidosDifalIndefinido: rows.reduce(
      (sfx, r) => sfx + (r.pedidos_difal_indefinido ?? 0),
      0,
    ),
  };
}

/**
 * Janela anterior de MESMA duração, imediatamente antes de [from, to] (inclusivos).
 * Usada para o comparativo dos KPIs vs período anterior.
 *
 * Ex.: from="2026-06-08", to="2026-06-14" (7 dias) → { from: "2026-06-01", to: "2026-06-07" }.
 * from===to (1 dia) → o dia imediatamente anterior. from ou to ausente → null.
 */
export function computePreviousWindow(
  from: string | null,
  to: string | null,
): { from: string; to: string } | null {
  if (!from || !to) return null;
  const start = parseISO(from);
  const end = parseISO(to);
  const durationDays = differenceInCalendarDays(end, start) + 1;
  if (durationDays <= 0) return null;
  const prevEnd = subDays(start, 1);
  const prevFrom = subDays(prevEnd, durationDays - 1);
  return { from: format(prevFrom, "yyyy-MM-dd"), to: format(prevEnd, "yyyy-MM-dd") };
}

/** KPIs agregados de um período (reconciliados com computePrecoMcoSeries/computeMco). */
export interface PriceKpis {
  qtd: number;
  receita: number;
  precoMedio: number;
  breakevenMedio: number;
  mco: number;
  mcoPct: number | null;
}

/**
 * Agrega os KPIs de preço/break-even/MCO de um conjunto de rows, reconciliando
 * o spend de ads com a série do gráfico (mesma truncagem/bucketização de
 * computePrecoMcoSeries). Replica a agregação hoje inline no componente,
 * exceto os avisos qtdSemCusto/temImpostoAusente (ficam no componente).
 */
export function computePriceKpis(
  rows: PrecoSeriesRow[],
  opts: ComputePrecoMcoSeriesOpts,
): PriceKpis {
  const serie = computePrecoMcoSeries(rows, opts);
  const adsBucket = serie.reduce((s, p) => s + p.ads, 0);

  const qtd = rows.reduce((s, r) => s + r.qtd, 0);
  const receita = rows.reduce((s, r) => s + r.total, 0);
  const cmv = rows.reduce((s, r) => s + r.cmv, 0);
  const comissao = rows.reduce((s, r) => s + r.comissao, 0);
  const frete = rows.reduce((s, r) => s + r.frete, 0);
  const impostos = rows.reduce((s, r) => s + r.impostos, 0);

  const precoMedio = qtd > 0 ? receita / qtd : 0;
  const breakevenMedio =
    qtd > 0 ? (cmv + comissao + frete + adsBucket + impostos) / qtd : 0;

  const { mco, pct } = computeMco({
    grossRevenue: receita,
    cmv,
    platformCost: comissao + frete,
    ads: adsBucket,
    tax: impostos,
  });

  return { qtd, receita, precoMedio, breakevenMedio, mco, mcoPct: pct };
}

/**
 * Variação percentual de `current` vs `previous`. previous=0 → null (evita
 * divisão por zero / Infinity). Denominador com Math.abs mantém o sinal
 * correto quando o valor anterior é negativo (ex.: MCO R$ negativo).
 */
export function percentDelta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * Diferença absoluta (pontos percentuais) entre `current` e `previous`.
 * Qualquer argumento null → null (usado no delta de MCO % em p.p.).
 */
export function pointDelta(
  current: number | null,
  previous: number | null,
): number | null {
  if (current == null || previous == null) return null;
  return current - previous;
}
