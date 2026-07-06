/**
 * Util puro para o gráfico "Composição de Custos por Mês" (fluxo de caixa).
 *
 * As categorias vêm do campo LIVRE `categoria.descricao` do Tiny (RPC
 * `get_cost_by_month`, fallback "Outros"), então o rótulo é imprevisível e há
 * dezenas de valores possíveis. Este util:
 *   1. soma o total de cada categoria no período,
 *   2. mantém as TOP-N categorias distintas (por total desc),
 *   3. dobra a cauda de baixo valor (+ qualquer "Outros" literal) num único
 *      balde "Outros",
 *   4. pivota long→wide para o BarChart empilhado do recharts.
 *
 * A cor NÃO é decidida aqui (concern de view/tema) — este util só define a
 * ORDEM das categorias, que é o que dá a atribuição de cor por índice estável.
 * Zero I/O, sem imports de UI/rede.
 */

export interface CostByMonthRow {
  month: string; // "2026-04" (YYYY-MM)
  category: string; // rótulo livre do Tiny
  total: number;
}

/** Balde catch-all — sempre pintado com o cinza neutro, nunca com uma hue. */
export const OTHER_LABEL = "Outros";

/** Quantas categorias distintas ganham cor própria antes de dobrar em "Outros". */
export const MAX_SERIES = 6;

export interface CostCompositionResult {
  /** Uma linha por mês, já pivotada: { month, _sort, <categoria>: total, ... }. */
  wideData: Array<Record<string, number | string>>;
  /**
   * Categorias na ordem de empilhamento (base→topo). As mantidas vêm por total
   * desc; "Outros" (quando existe) vem sempre por último (topo da pilha).
   */
  orderedCategories: string[];
}

/** "2026-04" → "Abr/26" (curto, capitalizado, sem pontos). */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  const raw = new Date(Number(y), Number(m) - 1).toLocaleString("pt-BR", {
    month: "short",
    year: "2-digit",
  });
  return raw
    .replace(/\.\s*de\s*/gi, "/")
    .replace(/\./g, "")
    .replace(/\s+/g, "/")
    .replace(/^(\w)/, (c) => c.toUpperCase());
}

export function buildCostComposition(
  rawData: CostByMonthRow[],
  maxSeries: number = MAX_SERIES
): CostCompositionResult {
  // 1. total por categoria no período inteiro
  const totals = new Map<string, number>();
  for (const row of rawData) {
    totals.set(row.category, (totals.get(row.category) ?? 0) + row.total);
  }

  // 2. rankear por total desc, tirando qualquer "Outros" literal do ranking
  //    (ele sempre pertence ao balde catch-all, não a uma slot de cor)
  const ranked = [...totals.entries()]
    .filter(([cat]) => cat !== OTHER_LABEL)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([cat]) => cat);

  const kept = ranked.slice(0, Math.max(0, maxSeries));
  const keptSet = new Set(kept);
  // há balde "Outros" se sobrou cauda OU se existe um "Outros" literal nos dados
  const hasOther = ranked.length > kept.length || totals.has(OTHER_LABEL);

  // 3. pivot long→wide, dobrando tudo que não é "kept" em OTHER_LABEL
  const monthMap = new Map<string, Record<string, number | string>>();
  for (const row of rawData) {
    let bucket = monthMap.get(row.month);
    if (!bucket) {
      bucket = { month: monthLabel(row.month), _sort: row.month };
      monthMap.set(row.month, bucket);
    }
    const key = keptSet.has(row.category) ? row.category : OTHER_LABEL;
    bucket[key] = Number(bucket[key] ?? 0) + row.total;
  }

  const wideData = [...monthMap.values()].sort((a, b) =>
    String(a._sort).localeCompare(String(b._sort))
  );

  const orderedCategories = hasOther ? [...kept, OTHER_LABEL] : kept;

  return { wideData, orderedCategories };
}
