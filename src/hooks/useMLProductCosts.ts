import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProductCost {
  item_id: string;
  cost: number | null;
  tax_rate: number | null;
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
        .select("item_id, cost, tax_rate")
        .eq("user_id", user.id);
      if (error) { console.warn("useMLProductCosts fetch error", error); return; }
      const map = new Map<string, ProductCost>();
      for (const row of data ?? []) {
        map.set(row.item_id, {
          item_id: row.item_id,
          cost: row.cost != null ? Number(row.cost) : null,
          tax_rate: row.tax_rate != null ? Number(row.tax_rate) : null,
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
      // Optimistic update
      setCosts((prev) => {
        const next = new Map(prev);
        next.set(item_id, { item_id, cost, tax_rate });
        return next;
      });
      const { error } = await supabase.from("ml_product_costs").upsert(
        {
          user_id: user.id,
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

  return { costs, loading, upsert };
}
