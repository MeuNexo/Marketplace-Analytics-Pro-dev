import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ProductItem } from "@/contexts/MLInventoryContext";

// ─── Tipos exportados (casam com o contrato da EF ml-listing-health) ──────────

export interface Issue {
  id: string;
  category: string;
  title: string;
  action_label: string;
  progress: number;
  progress_max: number;
}

export interface HealthResult {
  item_id: string;
  score: number | null;
  level: string | null;
  level_wording: string | null;
  issues: Issue[];
  source: "performance_api" | "health_api" | "unavailable";
}

export type HealthStatus = "idle" | "loading" | "success" | "error" | "unavailable";

/**
 * Hook on-demand que invoca a EF `ml-listing-health` quando o item está disponível.
 *
 * Guard (Landmine 1): se `item._ml_user_id` for undefined → status='idle' (sem erro visível).
 * Cleanup (Landmine 3): flag `cancelled` evita setState após desmontar o modal.
 *
 * @param item - ProductItem atual do modal (ou null se o modal ainda não tem item)
 * @returns { status, data } — status tipado + HealthResult quando success
 */
export function useMLListingHealth(item: ProductItem | null): {
  status: HealthStatus;
  data: HealthResult | null;
} {
  const [status, setStatus] = useState<HealthStatus>("idle");
  const [data, setData] = useState<HealthResult | null>(null);

  useEffect(() => {
    // Guard: _ml_user_id é opcional em ProductItem; sem ele não invocamos a EF
    if (!item?.id || !item?._ml_user_id) {
      setStatus("idle");
      setData(null);
      return;
    }

    let cancelled = false;
    setStatus("loading");

    supabase.functions
      .invoke("ml-listing-health", {
        body: { item_id: item.id, ml_user_id: item._ml_user_id },
      })
      .then(({ data: d, error: e }) => {
        if (cancelled) return;

        if (e) {
          setStatus("error");
          return;
        }

        // source='unavailable' = EF chamou a API ML mas ela estava indisponível (HTTP 200)
        if ((d as HealthResult | null)?.source === "unavailable") {
          setStatus("unavailable");
          return;
        }

        setData(d as HealthResult);
        setStatus("success");
      });

    // Cleanup: cancela setState se o modal for desmontado antes do fetch completar
    return () => {
      cancelled = true;
    };
  }, [item?.id, item?._ml_user_id]);

  return { status, data };
}
