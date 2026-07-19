import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";

// ─── Hook ─────────────────────────────────────────────────────────────────────
// Org-scoped fetch + optimistic upsert of ml_mco_targets (Phase 101).
// Mirrors useMLProductCosts.ts structure. sku is ALWAYS normalized to ""
// (never null/undefined) before read/write — DB sentinel for "anúncio inteiro".

export function useMcoTargets() {
  const { currentOrg } = useOrganization();
  const { user } = useAuth();
  const [targets, setTargets] = useState<Map<string, number>>(new Map());

  const keyOf = useCallback(
    (itemId: string, sku: string | null) => `${itemId}::${sku ?? ""}`,
    [],
  );

  const fetchAll = useCallback(async () => {
    if (!currentOrg) return;
    const { data, error } = await supabase
      .from("ml_mco_targets")
      .select("item_id, sku, target_mco_pct")
      .eq("organization_id", currentOrg.id)
      .limit(10000);
    if (error) {
      console.warn("useMcoTargets fetch error", error);
      return;
    }
    const map = new Map<string, number>();
    for (const row of data ?? []) {
      map.set(`${row.item_id}::${row.sku ?? ""}`, Number(row.target_mco_pct));
    }
    setTargets(map);
  }, [currentOrg]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  /**
   * Upsert a custom MCO% target for a single item_id + sku. Performs an
   * optimistic local update and persists to Supabase in the background.
   */
  const upsert = useCallback(
    async (itemId: string, sku: string | null, pct: number) => {
      if (!currentOrg?.id) {
        console.warn("useMcoTargets upsert ignorado — sem organização ativa");
        return;
      }
      const normalizedSku = sku ?? "";
      setTargets((prev) => new Map(prev).set(`${itemId}::${normalizedSku}`, pct));
      const { error } = await supabase.from("ml_mco_targets").upsert(
        {
          organization_id: currentOrg.id,
          item_id: itemId,
          sku: normalizedSku,
          target_mco_pct: pct,
          updated_by: user?.id ?? null,
        },
        { onConflict: "organization_id,item_id,sku" },
      );
      if (error) console.warn("useMcoTargets upsert error", error);
    },
    [currentOrg, user],
  );

  return { targets, keyOf, upsert, refetch: fetchAll };
}
