// ============================================================================
// coberturaVendas.ts — Fase 213, Plano 01, Task 1 (CR-03, CR-04)
//
// Módulo puro: dedupe e soma de vendas diárias por item — a aritmética que
// decide a classe de cobertura (compra vs. liquidação) estava embutida dentro
// de `useMLCoverage`, um hook que lia `ml_product_daily_cache` sem paginar.
// Com centenas de SKUs × 30 dias, o PostgREST cortava em 1000 linhas e a
// venda média saía subestimada — cobertura inflada sem nenhum sinal de erro.
// Extraída para cá para ser provável isoladamente, sem montar um hook inteiro
// por teste.
//
// Nenhum import de React, de Supabase ou de rede: só tipos e aritmética.
// ============================================================================

/** Linha crua de `ml_product_daily_cache`, como o hook lê da tabela. */
export interface VendaDiariaRow {
  item_id: string;
  date: string;
  qty_sold: number | null;
  ml_user_id?: string | null;
}

/**
 * Remove linhas duplicadas por (loja, dia, item).
 *
 * A restrição de unicidade de `ml_product_daily_cache` já foi por usuário e
 * não por organização — dois membros da mesma org sincronizando a mesma loja
 * no mesmo dia produzem duas linhas idênticas. Contar as duas dobra a venda
 * média e derruba a cobertura pela metade. Chave idêntica à de
 * `rankingDeduped` em `MLAnuncios.tsx`: `ml_user_id` nulo entra na chave como
 * string vazia, uma chave estável — não colapsa itens ou dias diferentes só
 * porque a loja não veio preenchida.
 */
export function dedupeVendasDiarias(linhas: VendaDiariaRow[]): VendaDiariaRow[] {
  const seen = new Set<string>();
  return linhas.filter((row) => {
    const key = `${row.ml_user_id ?? ""}:${row.date}:${row.item_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Soma `qty_sold` por item entre as linhas recebidas (já deduplicadas),
 * restrito a `date >= corte`.
 *
 * Comparação de data é lexicográfica sobre a string `YYYY-MM-DD` — esse
 * formato ordena corretamente como texto e evita construir um `Date` por
 * linha. `qty_sold` não numérico (nulo, por exemplo) conta como zero, nunca
 * `NaN` contaminando a soma do item inteiro.
 */
export function somarVendasPorItem(linhas: VendaDiariaRow[], corte: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of linhas) {
    if (row.date < corte) continue;
    const qty = typeof row.qty_sold === "number" && Number.isFinite(row.qty_sold) ? row.qty_sold : 0;
    map.set(row.item_id, (map.get(row.item_id) ?? 0) + qty);
  }
  return map;
}
