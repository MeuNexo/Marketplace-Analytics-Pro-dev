import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { OrderRecord } from "@/lib/analysis/types";

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface UseMLOrdersByItemResult {
  fetchOrders: (
    itemId: string,
    orgId: string,
    mlUserId: string,
    dateFrom: string,  // YYYY-MM-DD
    dateTo: string     // YYYY-MM-DD
  ) => Promise<OrderRecord[]>;
  loading: boolean;
}

// ── Internal helper ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): OrderRecord {
  return {
    id: row.id,
    price: row.preco_unit ?? 0,
    quantity: row.quantidade ?? 1,
    order_date: row.data_pedido ?? "",
    ml_user_id: row.ml_user_id,
    item_id: row.item_id,
    title: row.titulo ?? "",
    brand: null,  // coluna inexistente em orders
  };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useMLOrdersByItem(): UseMLOrdersByItemResult {
  const [loading, setLoading] = useState(false);

  const fetchOrders = useCallback(
    async (
      itemId: string,
      orgId: string,
      mlUserId: string,
      dateFrom: string,
      dateTo: string,
    ): Promise<OrderRecord[]> => {
      setLoading(true);
      try {
        const PAGE = 1000;
        let allRows: OrderRecord[] = [];
        let from = 0;

        while (true) {
          const { data, error } = await supabase
            .from("orders")
            .select("id, preco_unit, quantidade, data_pedido, ml_user_id, item_id, titulo, status")
            .eq("organization_id", orgId)
            .eq("ml_user_id", mlUserId)
            .eq("item_id", itemId)
            .gte("data_pedido", dateFrom)
            .lte("data_pedido", dateTo)
            .in("status", ["paid", "shipped", "delivered"])
            .not("preco_unit", "is", null)
            .gt("preco_unit", 0)
            .order("data_pedido", { ascending: true })
            .range(from, from + PAGE - 1);

          if (error) throw new Error(error.message);

          const page = (data ?? []).map(mapRow);
          allRows = allRows.concat(page);
          if (page.length < PAGE) break;
          from += PAGE;
        }

        return allRows;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { fetchOrders, loading };
}
