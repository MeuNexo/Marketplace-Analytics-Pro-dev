/**
 * Hook de dados para as páginas Produtos Vendidos e Análise de Preços.
 *
 * Busca agregados por anúncio via RPC `orders_sold_products_agg` (SECURITY INVOKER,
 * RLS org-scoped) em vez de paginar `orders` client-side.
 *
 * POR QUE RPC e não paginação (fix pós-preview 2026-07-01 — bugs validados pelo Wesley):
 * - Só os últimos 30 dias já têm ~55k pedidos pagos; o teto antigo de 50k linhas
 *   truncava silenciosamente QUALQUER período (quantidades ~10% menores).
 * - `data_pedido` é TEXT com formatos MISTOS ("YYYY-MM-DD" e "YYYY-MM-DD HH:MI:SS+00");
 *   o filtro string `.lte("YYYY-MM-DD")` excluía o último dia no formato longo.
 *   A RPC normaliza com cast `::date`.
 * - Payload: ~centenas de linhas (1 por anúncio) em vez de dezenas de milhares.
 *
 * Decisões travadas mantidas (77-CONTEXT.md / Phases 63/69):
 * - Client autenticado (RLS org-scoped); nunca service role, nunca organization_id manual.
 * - RPC SECURITY INVOKER sem parâmetro org, set-based (sem subquery correlacionada).
 * - Guard: sem datas ou sem resolvedMLUserIds não dispara fetch.
 * - Cleanup anti-stale com flag `cancelled`.
 *
 * A forma de linha continua SoldProductRow — agora cada linha é o AGREGADO de um
 * anúncio no período (quantidade/receita_bruta somadas), o que preserva o contrato
 * de aggregatePvGroups/aggregatePvItems (soma de somas = mesma soma).
 *
 * Phase: 77-pagina-analise-de-anuncios-produtos-vendidos-e-analise-de-pr / Plan 01 (fix)
 */

import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SoldProductRow } from "@/components/mercadolivre/anuncios/soldProductsAgg";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface UseMLSoldProductsParams {
  /** Data de início no formato "YYYY-MM-DD". Null = não buscar. */
  fromDate: string | null;
  /** Data de fim no formato "YYYY-MM-DD". Null = não buscar. */
  toDate: string | null;
  /** IDs das lojas ML da organização (de useMLStore().resolvedMLUserIds). */
  resolvedMLUserIds: string[];
}

export interface UseMLSoldProductsResult {
  /** Uma linha por anúncio: agregado (status='paid') no período. */
  allRows: SoldProductRow[];
  /** true enquanto carrega. */
  isLoading: boolean;
  /** Mensagem de erro ou null se nenhum erro. */
  error: string | null;
}

/** Linha crua retornada pela RPC orders_sold_products_agg. */
interface RpcAggRow {
  item_id: string;
  titulo: string | null;
  marca: string | null;
  quantidade: number | string;
  receita_bruta: number | string;
  pedidos: number | string;
}

// ─── Hook principal ───────────────────────────────────────────────────────────

/**
 * Busca os agregados por anúncio dos pedidos pagos no período.
 *
 * Retorna linhas no shape SoldProductRow para que o componente agregue por
 * marca/categoria via `aggregatePvGroups` / `aggregatePvItems` de soldProductsAgg.ts.
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

    async function fetchAgg() {
      const { data, error: qErr } = await (supabase.rpc as any)(
        "orders_sold_products_agg",
        {
          _ml_user_ids: resolvedMLUserIds,
          _from: fromDate,
          _to: toDate,
        },
      );

      if (cancelled) return;

      if (qErr) {
        setError(qErr.message);
        setIsLoading(false);
        return;
      }

      const rows: SoldProductRow[] = ((data ?? []) as RpcAggRow[]).map((r) => ({
        item_id: r.item_id,
        titulo: r.titulo,
        marca: r.marca,
        quantidade: Number(r.quantidade) || 0,
        receita_bruta: Number(r.receita_bruta) || 0,
        // Campos de linha de order não se aplicam ao agregado por anúncio:
        data_pedido: null,
        ml_user_id: "",
      }));

      setAllRows(rows);
      setIsLoading(false);
    }

    fetchAgg();

    // Cleanup: cancela setState se o componente for desmontado antes do fetch completar
    return () => {
      cancelled = true;
    };
  }, [fromDate, toDate, resolvedMLUserIds]); // resolvedMLUserIds é array — o chamador deve memorizá-lo

  return { allRows, isLoading, error };
}
