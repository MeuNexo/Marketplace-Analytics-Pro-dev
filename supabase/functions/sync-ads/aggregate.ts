// aggregate.ts — core PURO de agregação do sync-ads.
//
// Módulo sem I/O (sem fetch, sem imports Deno/URL): testável no vitest (Node)
// apesar de a EF (`index.ts`) rodar em Deno. Mesmo padrão de extração usado em
// `sync-ml-billing/aggregate.ts` — index.ts importa deste arquivo via
// `./aggregate.ts`, e o teste importa DESTE arquivo (nunca de index.ts, que
// tem imports `https://deno.land/...` inválidos para o resolvedor ESM do
// Node/Vite).
//
// Phase 219, Frente 1: o cache de ads estava inflado (~1,40-1,50x) porque
// `index.ts` somava linha a linha o retorno de `product_ads/ads/search`, mas
// a API repete a mesma linha (mesma campanha, mesmo item_id, valores
// idênticos) — medido 05/08: MLB4393816141 aparece 2x com custo 2,03|2,03. A
// própria resposta já traz `metrics_summary` com o total certo (bate ao
// centavo com o painel do ML) e o código antigo o ignorava.
//
// Phase 221 — a premissa original foi REFUTADA por medição, e o resultado é o
// oposto do que a fase supunha. Detalhe em `221-REFUTACAO.md` (nexo-os).
//
// A fase nasceu de uma divergência real: em 07/08/2026 às 13h14, para o dia
// 06/08, `campaigns/search` respondeu 220,65 e `ads/search` respondeu 172,95
// (-27,6%). O painel do ML mostrava 221, então parecia que `ads/search` estava
// subcontando. Às 13h50 do mesmo dia, `campaigns/search` respondeu 172,95 —
// idêntico ao de anúncios, dígito por dígito, inclusive prints subindo de
// 61.694 para 61.793.
//
// Ou seja: o agregado de CAMPANHA publica um valor PROVISÓRIO mais alto
// enquanto o dia consolida e depois assenta no valor do agregado de ANÚNCIO,
// que já era o final. Não existe endpoint certo e endpoint errado — existe
// número provisório e número assentado. `ads/search` sempre foi o assentado.
//
// Por isso `buildDailyTotals` dá precedência ao resumo de anúncios e usa o de
// campanhas só como rede de segurança (quando o primeiro falta). O aparato de
// paginação abaixo (`sumCampaignPages`) permanece porque é essa rede — e sua
// guarda de cobertura continua necessária, já que no endpoint de campanhas o
// `metrics_summary` resume só a PÁGINA.
//
// Este módulo resolve três pontas:
// - `parseMetricsSummary`: normaliza o bloco `metrics_summary` da resposta e
//   devolve o total diário correto — SEM somar itens.
// - `dedupeProductMetrics`: agrega o array de linhas por produto por
//   `item_id`, SOBRESCREVENDO em vez de somar (os duplicados observados são
//   idênticos; sobrescrever é mais simples de explicar que manter o
//   primeiro, e dá o mesmo resultado).
// - `sumCampaignPages`/`buildDailyTotals` (Phase 221): somam o total diário
//   sobre TODAS as páginas de campanhas, com guarda de cobertura contra
//   `paging.total` — no endpoint de campanhas, `metrics_summary` resume só a
//   PÁGINA (diferente do endpoint de anúncios, onde é global mesmo com
//   limit=1); com limit=1 a 1ª de 6 campanhas devolveu 18,67 em vez dos
//   220,65 reais. Um conjunto de páginas que não cobre `paging.total` nunca
//   vira total diário.

export interface ItemMetricRow {
  key: string; // `${date}|${itemId}`
  title: string;
  thumbnail: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  revenue: number;
  orders: number;
}

export interface ItemMetrics {
  title: string;
  thumbnail: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  revenue: number;
  orders: number;
}

export interface SummaryTotals {
  impressions: number;
  clicks: number;
  spend: number;
  revenue: number;
  orders: number;
}

// ── Normalize nested metrics (movida de index.ts, byte-idêntica na lógica) ───

export function metricsArrayToObject(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value)) return null;
  const entries = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const e = entry as Record<string, unknown>;
      const key = String(e.key ?? e.name ?? e.metric ?? "").trim();
      const val = e.value ?? e.amount ?? e.metric_value ?? e.total;
      return key ? [key, val] as const : null;
    })
    .filter((x): x is readonly [string, unknown] => Boolean(x));
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

export function normalizeMetrics(item: Record<string, unknown>): Record<string, unknown> {
  return metricsArrayToObject(item.metrics_summary)
    ?? (item.metrics_summary && typeof item.metrics_summary === "object" && !Array.isArray(item.metrics_summary) ? item.metrics_summary as Record<string, unknown> : null)
    ?? metricsArrayToObject(item.metrics)
    ?? (item.metrics && typeof item.metrics === "object" && !Array.isArray(item.metrics) ? item.metrics as Record<string, unknown> : null)
    ?? item;
}

/**
 * Normaliza o bloco `metrics_summary` da resposta de `product_ads/ads/search`
 * (total diário oficial, já calculado pelo ML — bate ao centavo com o
 * painel) e devolve `{impressions, clicks, spend, revenue, orders}`, lendo os
 * MESMOS aliases já usados no laço por item (`prints ?? impressions`,
 * `clicks ?? 0`, `cost ?? spend`, `total_amount ?? direct_amount ??
 * attributed_revenue`, `units_quantity ?? direct_units_quantity ?? orders`)
 * — para não introduzir uma segunda régua de alias.
 *
 * Devolve `null` para entrada ausente, `undefined`, ou objeto vazio — zero é
 * resultado legítimo só quando a API o devolve explicitamente, nunca um
 * default acidental.
 */
export function parseMetricsSummary(raw: unknown): SummaryTotals | null {
  if (raw === null || raw === undefined) return null;

  const m = metricsArrayToObject(raw)
    ?? (typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null);

  if (!m || Object.keys(m).length === 0) return null;

  const impressions = Number(m.prints ?? m.impressions ?? 0);
  const clicks = Number(m.clicks ?? 0);
  const spend = Number(m.cost ?? m.spend ?? 0);
  const revenue = Number(m.total_amount ?? m.direct_amount ?? m.attributed_revenue ?? 0);
  const orders = Number(m.units_quantity ?? m.direct_units_quantity ?? m.orders ?? 0);

  return { impressions, clicks, spend, revenue, orders };
}

/**
 * Agrega linhas por produto por `key` (`${date}|${itemId}`), SOBRESCREVENDO
 * em vez de somar. Os duplicados observados na API (mesma campanha, mesmo
 * item_id, valores idênticos) fazem sobrescrever e somar darem o mesmo
 * resultado — sobrescrever é a leitura mais simples de explicar e é a que
 * corrige o bug de soma sem introduzir uma hipótese não provada (que os
 * duplicados sejam sempre idênticos em produção).
 */
export function dedupeProductMetrics(rows: ItemMetricRow[]): Map<string, ItemMetrics> {
  const map = new Map<string, ItemMetrics>();
  for (const row of rows) {
    map.set(row.key, {
      title: row.title,
      thumbnail: row.thumbnail,
      impressions: row.impressions,
      clicks: row.clicks,
      spend: row.spend,
      revenue: row.revenue,
      orders: row.orders,
    });
  }
  return map;
}

// ── Phase 221: total diário do endpoint de campanhas ──────────────────────────

/**
 * Métricas parciais por métrica: `null` significa "a API não devolveu esta
 * chave" (ausência), nunca 0. Diferente de `SummaryTotals`, que assume que
 * toda métrica sempre resolve — aqui o objetivo é justamente permitir que
 * cada métrica falhe de forma independente, para nunca disfarçar ausência de
 * zero (a mesma confusão que apagou o frete na Fase 219, em
 * `batch_upsert_orders`).
 */
export interface PartialTotals {
  impressions: number | null;
  clicks: number | null;
  spend: number | null;
  revenue: number | null;
  orders: number | null;
}

/**
 * Uma página da resposta de `product_ads/campaigns/search`: o bloco de
 * `metrics_summary` daquela página (resume SÓ a página, diferente do
 * endpoint de anúncios) e quantas campanhas vieram nela.
 */
export interface CampaignPage {
  metricsSummary: unknown;
  campaigns: number;
}

/**
 * Normaliza um bloco de métricas parcial, lendo os MESMOS aliases já usados
 * por `parseMetricsSummary` (mesma normalização via `metricsArrayToObject`,
 * para não criar uma segunda régua). Cada métrica ausente ou não-finita vira
 * `null` em vez de 0 — ausência é "não sabemos", zero é "não gastou".
 */
export function parsePartialMetrics(raw: unknown): PartialTotals | null {
  if (raw === null || raw === undefined) return null;

  const m = metricsArrayToObject(raw)
    ?? (typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null);

  if (!m || Object.keys(m).length === 0) return null;

  const toNumberOrNull = (value: unknown): number | null => {
    if (value === undefined || value === null) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  return {
    impressions: toNumberOrNull(m.prints ?? m.impressions),
    clicks: toNumberOrNull(m.clicks),
    spend: toNumberOrNull(m.cost ?? m.spend),
    revenue: toNumberOrNull(m.total_amount ?? m.direct_amount ?? m.attributed_revenue),
    orders: toNumberOrNull(m.units_quantity ?? m.direct_units_quantity ?? m.orders),
  };
}

/**
 * Soma o total diário sobre TODAS as páginas de campanhas, com guarda de
 * cobertura sobre `pagingTotal`. Regras, nesta ordem:
 * (a) lista vazia → `null`;
 * (b) alguma página sem bloco reconhecível → `null`;
 * (c) soma de `page.campaigns` MENOR que `pagingTotal` → `null` (cobertura
 *     incompleta produziria um subtotal disfarçado de total — foi assim que
 *     `limit=1` devolveu 18,67 contra os 220,65 reais);
 * (d) `pagingTotal` <= 0 → `null`;
 * (e) soma métrica a métrica; uma métrica `null` em QUALQUER página deixa o
 *     resultado `null` naquela métrica — não dá para somar o que não se
 *     conhece.
 */
export function sumCampaignPages(pages: CampaignPage[], pagingTotal: number): PartialTotals | null {
  if (pages.length === 0) return null;
  if (pagingTotal <= 0) return null;

  const parsed: PartialTotals[] = [];
  let campaignsCovered = 0;
  for (const page of pages) {
    const p = parsePartialMetrics(page.metricsSummary);
    if (p === null) return null;
    parsed.push(p);
    campaignsCovered += page.campaigns;
  }

  if (campaignsCovered < pagingTotal) return null;

  const sumField = (field: keyof PartialTotals): number | null => {
    let total = 0;
    for (const p of parsed) {
      const v = p[field];
      if (v === null) return null;
      total += v;
    }
    return total;
  };

  return {
    impressions: sumField("impressions"),
    clicks: sumField("clicks"),
    spend: sumField("spend"),
    revenue: sumField("revenue"),
    orders: sumField("orders"),
  };
}

/**
 * Compõe o total diário. O resumo de **anúncios** (`product_ads/ads/search`) é
 * a fonte de verdade; o de **campanhas** é apenas rede de segurança.
 *
 * ⚠️ Isto INVERTE a premissa original da Fase 221, que foi refutada por medição
 * em 07/08/2026 e está registrada em `221-REFUTACAO.md`. O que se mediu:
 *
 *   13h14 — campanhas 220,65 / 701 cliques / 61.694 prints
 *           anúncios  172,95 / 549 cliques / 61.793 prints
 *   13h50 — campanhas 172,95 / 549 cliques / 61.793 prints  ← virou o de anúncios
 *           anúncios  172,95 / 549 cliques / 61.793 prints
 *
 * O agregado de campanha não oscilou: foi SUBSTITUÍDO pelo de anúncio, dígito
 * por dígito, inclusive prints subindo. Ou seja, campanha publica um valor
 * PROVISÓRIO mais alto enquanto o dia consolida e depois assenta no valor de
 * anúncio — que já era o final. Ler campanha no dia recente grava número
 * instável e deixa o MCO pessimista até o ML assentar.
 *
 * Por isso: `anuncios` presente vence sempre. `campanhas` só entra quando o
 * resumo de anúncios não veio, para o dia não se perder — e nesse caso o
 * `source` sai como "campaigns" justamente para o valor provisório ser
 * rastreável.
 */
export function buildDailyTotals(
  campanhas: PartialTotals | null,
  anuncios: SummaryTotals | null,
): { totals: SummaryTotals; source: "ads" | "campaigns" } | null {
  if (anuncios !== null) {
    return { totals: anuncios, source: "ads" };
  }

  if (campanhas === null) return null;

  const { spend, clicks, impressions, revenue, orders } = campanhas;
  if (
    spend === null || clicks === null || impressions === null ||
    revenue === null || orders === null
  ) {
    return null;
  }

  return {
    totals: { spend, clicks, impressions, revenue, orders },
    source: "campaigns",
  };
}
