/**
 * Utilitário puro de agregação de pedidos por marca/categoria.
 *
 * Zero dependências de React, Supabase ou rede — 100% testável isoladamente.
 *
 * Decisão travada (Phase 63/77): `data_pedido` é TEXT no Supabase.
 * Se precisar extrair a parte data, usar `slice(0,10)`, nunca `new Date()` cego.
 *
 * Phase: 77-pagina-analise-de-anuncios-produtos-vendidos-e-analise-de-pr / Plan 01
 */

// ─── Tipos públicos ───────────────────────────────────────────────────────────

/**
 * Linha de venda por anúncio (status='paid'). Desde o fix pós-preview (2026-07-01),
 * vem PRÉ-AGREGADA por item_id da RPC `orders_sold_products_agg` (quantidade e
 * receita_bruta já somadas no período; data_pedido/ml_user_id nulos). As funções
 * abaixo continuam corretas: soma de somas = mesma soma.
 */
export interface SoldProductRow {
  item_id: string;
  titulo: string | null;
  marca: string | null;
  quantidade: number;
  receita_bruta: number;
  data_pedido: string | null;
  ml_user_id: string;
}

/** Um grupo de vendas por marca ou categoria (painel esquerdo de Produtos Vendidos). */
export interface PvGroup {
  /** Valor da chave (marca ou category_id). String vazia = "sem grupo". */
  key: string;
  /** Rótulo legível para exibição ("Sem marca", "Sem categoria" quando key=""). */
  name: string;
  /** Total de unidades vendidas no grupo. */
  qty: number;
  /** Soma de receita bruta no grupo (R$). */
  revenue: number;
}

/** Um anúncio dentro do grupo selecionado (painel direito de Produtos Vendidos). */
export interface PvItem {
  item_id: string;
  /** Título preferindo itemsMap.title, fallback row.titulo, fallback item_id. */
  title: string;
  /** Total de unidades vendidas. */
  qty: number;
  /** Soma de receita bruta (R$). */
  revenue: number;
  /** Participação na receita do grupo: revenue / totalRevDo Grupo (0–1). 0 quando totalRev=0. */
  shareOfGroup: number;
}

// ─── Funções públicas ─────────────────────────────────────────────────────────

/**
 * Agrupa pedidos por marca ou category_id (cross-ref via itemsMap).
 * Retorna lista ordenada por revenue desc.
 *
 * @param rows      - Linhas brutas de `orders`
 * @param pvView    - "marca" | "categoria"
 * @param itemsMap  - Map<item_id, { category_id?, title?, thumbnail? }> (de useMLInventory)
 */
export function aggregatePvGroups(
  rows: SoldProductRow[],
  pvView: "marca" | "categoria",
  itemsMap: Map<string, { category_id?: string | null; title?: string; thumbnail?: string }>,
): PvGroup[] {
  const map = new Map<string, { qty: number; revenue: number }>();

  for (const row of rows) {
    const key =
      pvView === "marca"
        ? (row.marca ?? "")
        : (itemsMap.get(row.item_id)?.category_id ?? "");

    const prev = map.get(key) ?? { qty: 0, revenue: 0 };
    map.set(key, {
      qty:     prev.qty     + row.quantidade,
      revenue: prev.revenue + row.receita_bruta,
    });
  }

  return Array.from(map.entries())
    .map(([key, d]) => ({
      key,
      name: key || (pvView === "marca" ? "Sem marca" : "Sem categoria"),
      ...d,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

/**
 * Retorna os anúncios (itens) do grupo selecionado, com % de participação na receita.
 * Ordena por revenue desc.
 *
 * @param rows       - Todas as linhas brutas de `orders`
 * @param pvSelected - Chave do grupo selecionado (marca ou category_id; "" para "sem grupo")
 * @param pvView     - "marca" | "categoria"
 * @param itemsMap   - Map<item_id, { category_id?, title?, thumbnail? }> (de useMLInventory)
 */
export function aggregatePvItems(
  rows: SoldProductRow[],
  pvSelected: string,
  pvView: "marca" | "categoria",
  itemsMap: Map<string, { category_id?: string | null; title?: string; thumbnail?: string }>,
): PvItem[] {
  // Filtra somente os pedidos do grupo selecionado
  const filtered = rows.filter((r) =>
    pvView === "marca"
      ? (r.marca ?? "") === pvSelected
      : (itemsMap.get(r.item_id)?.category_id ?? "") === pvSelected,
  );

  // Agrega por item_id
  const byItem = new Map<string, { qty: number; revenue: number; title: string }>();

  for (const r of filtered) {
    // Preferência: itemsMap.title > row.titulo > item_id (fallback de último recurso)
    const title =
      itemsMap.get(r.item_id)?.title ??
      r.titulo ??
      r.item_id;

    const prev = byItem.get(r.item_id) ?? { qty: 0, revenue: 0, title };
    byItem.set(r.item_id, {
      ...prev,
      qty:     prev.qty     + r.quantidade,
      revenue: prev.revenue + r.receita_bruta,
    });
  }

  // Calcula total de receita do grupo para % de participação
  const totalRev = Array.from(byItem.values()).reduce((s, v) => s + v.revenue, 0);

  return Array.from(byItem.entries())
    .map(([item_id, v]) => ({
      item_id,
      title: v.title,
      qty:   v.qty,
      revenue: v.revenue,
      shareOfGroup: totalRev > 0 ? v.revenue / totalRev : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}
