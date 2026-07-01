/**
 * Hook de query paginada de orders para a página Produtos Vendidos.
 *
 * Decisões travadas (77-CONTEXT.md / Phase 63/73):
 * - Query direta `supabase.from("orders")` com client autenticado (RLS org-scoped).
 * - Nunca service role, nunca filtro manual de organization_id.
 * - data_pedido é TEXT — passar strings "YYYY-MM-DD" nos filtros .gte/.lte.
 * - Paginação loop com .range() de 1000 (PostgREST trunca em 1000 sem aviso — T-77-02).
 * - Teto de segurança MAX_ROWS = 50.000 para cobrir todos os anúncios de um período longo.
 * - Guard: sem datas ou sem resolvedMLUserIds não dispara fetch (T-77-03 / evita `.in("ml_user_id", [])`).
 * - Cleanup anti-stale com flag `cancelled`.
 *
 * Reutiliza o tipo SoldProductRow de soldProductsAgg (forma da linha de orders).
 *
 * Phase: 77-pagina-analise-de-anuncios-produtos-vendidos-e-analise-de-pr / Plan 01
 */

import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SoldProductRow } from "@/components/mercadolivre/anuncios/soldProductsAgg";

// ─── Constantes ───────────────────────────────────────────────────────────────

const PAGE     = 1_000;  // limite por página do PostgREST
const MAX_ROWS = 50_000; // teto de segurança: cobre períodos longos com múltiplos anúncios

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface UseMLSoldProductsParams {
  /** Data de início no formato "YYYY-MM-DD" (TEXT — não Date). Null = não buscar. */
  fromDate: string | null;
  /** Data de fim no formato "YYYY-MM-DD" (TEXT — não Date). Null = não buscar. */
  toDate: string | null;
  /** IDs das lojas ML da organização (de useMLStore().resolvedMLUserIds). */
  resolvedMLUserIds: string[];
}

export interface UseMLSoldProductsResult {
  /** Todas as linhas acumuladas de orders (status='paid') no período. */
  allRows: SoldProductRow[];
  /** true enquanto carrega (incluindo páginas subsequentes da paginação). */
  isLoading: boolean;
  /** Mensagem de erro ou null se nenhum erro. */
  error: string | null;
}

// ─── Hook principal ───────────────────────────────────────────────────────────

/**
 * Busca todos os pedidos pagos no período, paginando automaticamente.
 *
 * Não agrega — retorna linhas brutas para que o componente agregue via
 * `aggregatePvGroups` / `aggregatePvItems` de soldProductsAgg.ts.
 */
export function useMLSoldProducts({
  fromDate,
  toDate,
  resolvedMLUserIds,
}: UseMLSoldProductsParams): UseMLSoldProductsResult {
  const [allRows, setAllRows]     = useState<SoldProductRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  useEffect(() => {
    // Guard (T-77-03): sem datas ou sem lojas, não buscar
    if (!fromDate || !toDate || !resolvedMLUserIds.length) {
      setAllRows([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setAllRows([]);
    setError(null);

    async function fetchAll() {
      let accumulated: SoldProductRow[] = [];
      let offset = 0;

      // Loop de paginação — PostgREST trunca em 1000 linhas sem aviso (T-77-02)
      while (!cancelled && accumulated.length < MAX_ROWS) {
        const { data, error: qErr } = await supabase
          .from("orders")
          .select("item_id, titulo, marca, quantidade, receita_bruta, data_pedido, ml_user_id")
          .eq("status", "paid")
          .gte("data_pedido", fromDate!)   // data_pedido é TEXT — string "YYYY-MM-DD" funciona
          .lte("data_pedido", toDate!)
          .in("ml_user_id", resolvedMLUserIds)  // guard acima garante .length > 0
          .range(offset, offset + PAGE - 1);

        if (cancelled) return;

        if (qErr) {
          setError(qErr.message);
          setIsLoading(false);
          return;
        }

        const page = (data ?? []) as SoldProductRow[];
        accumulated = accumulated.concat(page);

        if (page.length < PAGE) break; // última página — encerra o loop
        offset += PAGE;
      }

      if (!cancelled) {
        setAllRows(accumulated);
        setIsLoading(false);
      }
    }

    fetchAll();

    // Cleanup: cancela setState se o componente for desmontado antes do fetch completar
    return () => {
      cancelled = true;
    };
  }, [fromDate, toDate, resolvedMLUserIds]); // resolvedMLUserIds é array — se não for estável, o chamador deve memorizá-lo

  return { allRows, isLoading, error };
}
