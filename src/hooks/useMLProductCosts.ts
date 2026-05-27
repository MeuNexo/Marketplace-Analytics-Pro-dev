import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProductCost {
  item_id: string;
  cost: number | null;
  tax_rate: number | null;
  seller_sku: string | null;
}

export interface BatchCostRow {
  item_id: string;
  cost: number;
  seller_sku?: string | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMLProductCosts() {
  const { user } = useAuth();
  const { currentOrg } = useOrganization();
  const [costs, setCosts] = useState<Map<string, ProductCost>>(new Map());
  const [loading, setLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("ml_product_costs")
        .select("item_id, cost, tax_rate, seller_sku")
        .eq("user_id", user.id)
        .limit(10000);
      if (error) { console.warn("useMLProductCosts fetch error", error); return; }
      const map = new Map<string, ProductCost>();
      for (const row of data ?? []) {
        map.set(row.item_id, {
          item_id:    row.item_id,
          cost:       row.cost     != null ? Number(row.cost)     : null,
          tax_rate:   row.tax_rate != null ? Number(row.tax_rate) : null,
          seller_sku: row.seller_sku ?? null,
        });
      }
      setCosts(map);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  /**
   * Upsert cost/tax for a single item. Performs an optimistic local update
   * and persists to Supabase in the background.
   */
  const upsert = useCallback(
    async (item_id: string, cost: number | null, tax_rate: number | null) => {
      if (!user) return;
      setCosts((prev) => {
        const next = new Map(prev);
        next.set(item_id, {
          item_id,
          cost,
          tax_rate,
          seller_sku: prev.get(item_id)?.seller_sku ?? null,
        });
        return next;
      });
      const { error } = await supabase.from("ml_product_costs").upsert(
        {
          user_id:         user.id,
          organization_id: currentOrg?.id ?? null,
          item_id,
          cost,
          tax_rate,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,item_id" },
      );
      if (error) console.warn("useMLProductCosts upsert error", error);
    },
    [user, currentOrg],
  );

  /**
   * Bulk upsert from spreadsheet import.
   * Only updates `cost` (and optionally `seller_sku`); leaves tax_rate untouched.
   * Returns the number of rows successfully saved.
   */
  const upsertBatch = useCallback(
    async (rows: BatchCostRow[]): Promise<number> => {
      if (!user || rows.length === 0) return 0;

      const now = new Date().toISOString();
      const payload = rows.map((r) => ({
        user_id:         user.id,
        organization_id: currentOrg?.id ?? null,
        item_id:         r.item_id,
        cost:            r.cost,
        ...(r.seller_sku != null ? { seller_sku: r.seller_sku } : {}),
        updated_at:      now,
      }));

      const { error } = await supabase
        .from("ml_product_costs")
        .upsert(payload, { onConflict: "user_id,item_id" });

      if (error) {
        console.warn("useMLProductCosts upsertBatch error", error);
        throw new Error(error.message);
      }

      // Optimistic local update
      setCosts((prev) => {
        const next = new Map(prev);
        for (const r of rows) {
          const existing = next.get(r.item_id);
          next.set(r.item_id, {
            item_id:    r.item_id,
            cost:       r.cost,
            tax_rate:   existing?.tax_rate ?? null,
            seller_sku: r.seller_sku ?? existing?.seller_sku ?? null,
          });
        }
        return next;
      });

      return rows.length;
    },
    [user, currentOrg],
  );

  return { costs, loading, upsert, upsertBatch, refetch: fetchAll };
}
