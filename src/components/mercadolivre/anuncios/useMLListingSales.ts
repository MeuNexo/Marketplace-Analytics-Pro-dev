/**
 * Hook lazy de consulta a `orders` por item_id para a aba Vendas do modal.
 *
 * Decisões travadas (73-CONTEXT.md):
 * - Query direta `supabase.from("orders")` com client autenticado (RLS org-scoped).
 * - Nunca service role, nunca filtro manual de organization_id.
 * - data_pedido é TEXT — passar start ISO "YYYY-MM-DD" como string no .gte().
 * - Paginação com .range() de 1000 (PostgREST trunca; MEMORY: sempre .range()).
 * - Teto de segurança MAX_ROWS para evitar DoS em janelas grandes.
 * - Guard lazy: só dispara quando item.id está presente.
 * - Cleanup com flag `cancelled` — padrão de useMLListingHealth.
 *
 * Phase: 73-aba-vendas / Plan 01
 */

import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ProductItem } from "@/contexts/MLInventoryContext";
import { aggregateListingSales } from "./listingSalesAgg";
import type { ListingSalesPoint } from "./listingSalesAgg";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type SalesStatus = "idle" | "loading" | "success" | "empty" | "error";

export interface UseMLListingSalesResult {
  status: SalesStatus;
  points: ListingSalesPoint[];
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const PAGE     = 1_000; // limite por página do PostgREST
const MAX_ROWS = 5_000; // teto de segurança: ~1 anúncio com 90d de vendas intensas

// ─── Utilitário interno ───────────────────────────────────────────────────────

/** Calcula a data de início da janela como string "YYYY-MM-DD" em UTC. */
function startIsoForWindow(windowDays: number): string {
  const now = new Date();
  const d   = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (windowDays - 1)),
  );
  return d.toISOString().slice(0, 10);
}

// ─── Hook principal ───────────────────────────────────────────────────────────

/**
 * Busca e agrega as vendas diárias de um anúncio específico.
 *
 * @param item        - ProductItem do modal aberto (ou null — retorna idle imediatamente).
 * @param windowDays  - Janela temporal: 30 ou 90 dias.
 * @returns { status, points } — estado da requisição + série diária agregada.
 */
export function useMLListingSales(
  item: ProductItem | null,
  windowDays: 30 | 90,
): UseMLListingSalesResult {
  const [status, setStatus] = useState<SalesStatus>("idle");
  const [points, setPoints] = useState<ListingSalesPoint[]>([]);

  useEffect(() => {
    // Guard (lazy): sem item.id não há fetch — modal fechado ou item ainda não carregado
    if (!item?.id) {
      setStatus("idle");
      setPoints([]);
      return;
    }

    let cancelled = false;
    setStatus("loading");
    setPoints([]);

    async function fetchSales() {
      const startIso = startIsoForWindow(windowDays);
      // item.id foi verificado no guard acima; TypeScript narrowing seguro
      const itemId   = item!.id;

      let allRows: { data_pedido: string | null; quantidade: number; receita_bruta: number }[] = [];
      let from = 0;

      // Paginação loop — PostgREST trunca em 1000; teto MAX_ROWS por segurança (T-73-03)
      while (true) {
        const { data, error } = await supabase
          .from("orders")
          .select("data_pedido, quantidade, receita_bruta")
          .eq("item_id", itemId)
          .eq("status", "paid")
          .gte("data_pedido", startIso)
          .order("data_pedido", { ascending: true })
          .range(from, from + PAGE - 1);

        if (cancelled) return;

        if (error) {
          setStatus("error");
          return;
        }

        const page = (data ?? []) as typeof allRows;
        allRows = allRows.concat(page);

        if (page.length < PAGE) break; // última página
        if (allRows.length >= MAX_ROWS) break; // teto de segurança

        from += PAGE;
      }

      if (cancelled) return;

      const aggregated = aggregateListingSales(allRows, windowDays);
      const totalUnidades = aggregated.reduce((acc, p) => acc + p.unidades, 0);
      const totalReceita  = aggregated.reduce((acc, p) => acc + p.receita, 0);

      // "empty" = nenhuma venda no período — pontos zerados exposto para o componente
      const nextStatus: SalesStatus =
        totalUnidades === 0 && totalReceita === 0 ? "empty" : "success";

      setPoints(aggregated);
      setStatus(nextStatus);
    }

    fetchSales();

    // Cleanup: cancela setState se o modal for desmontado antes do fetch completar
    return () => {
      cancelled = true;
    };
  }, [item?.id, windowDays]);

  return { status, points };
}
