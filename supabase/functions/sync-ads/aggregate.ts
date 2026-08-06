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
// Este módulo resolve as duas pontas:
// - `parseMetricsSummary`: normaliza o bloco `metrics_summary` da resposta e
//   devolve o total diário correto — SEM somar itens.
// - `dedupeProductMetrics`: agrega o array de linhas por produto por
//   `item_id`, SOBRESCREVENDO em vez de somar (os duplicados observados são
//   idênticos; sobrescrever é mais simples de explicar que manter o
//   primeiro, e dá o mesmo resultado).

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
