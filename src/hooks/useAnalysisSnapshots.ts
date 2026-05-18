import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { computeAnalysis } from "@/lib/analysis/engine";
import type { OrderRecord, PriceBucket, ElasticityClass } from "@/lib/analysis/types";

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface SnapshotInput {
  orders: OrderRecord[];
  periodDays: number;
  periodStart: string;      // YYYY-MM-DD
  periodEnd: string;        // YYYY-MM-DD
  mlUserId: string;
  organizationId: string;
  itemId: string;
  productTitle: string;
  brand?: string;
}

export interface AnalysisSnapshot {
  id: string;
  createdAt: string;
  mlUserId: string;
  organizationId: string;
  itemId: string;
  productTitle: string;
  brand: string | null;
  periodStart: string;
  periodEnd: string;
  priceCurve: PriceBucket[];
  priceGmv: number;
  priceNeutral: number;
  priceMargin: number;
  elasticityPct: number;
  elasticityClass: ElasticityClass;
  strategy: 'gmv' | 'neutral' | 'margin' | null;
}

export type UseAnalysisSnapshotsResult = {
  saveSnapshot: (input: SnapshotInput) => Promise<AnalysisSnapshot>;
  fetchSnapshots: (itemId: string, orgId: string) => Promise<AnalysisSnapshot[]>;
  updateStrategy: (snapshotId: string, strategy: 'gmv' | 'neutral' | 'margin') => Promise<void>;
  saving: boolean;
  loading: boolean;
};

// ── Internal helper ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): AnalysisSnapshot {
  return {
    id: row.id,
    createdAt: row.created_at,
    mlUserId: row.ml_user_id,
    organizationId: row.organization_id,
    itemId: row.item_id,
    productTitle: row.product_title,
    brand: row.brand ?? null,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    priceCurve: row.price_curve as PriceBucket[],
    priceGmv: row.price_gmv,
    priceNeutral: row.price_neutral,
    priceMargin: row.price_margin,
    elasticityPct: row.elasticity_pct,
    elasticityClass: row.elasticity_class as ElasticityClass,
    strategy: row.strategy as 'gmv' | 'neutral' | 'margin' | null,
  };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAnalysisSnapshots(): UseAnalysisSnapshotsResult {
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const saveSnapshot = useCallback(
    async (input: SnapshotInput): Promise<AnalysisSnapshot> => {
      setSaving(true);
      try {
        const result = computeAnalysis(input.orders, input.periodDays);

        const row = {
          ml_user_id: input.mlUserId,
          organization_id: input.organizationId,
          item_id: input.itemId,
          product_title: input.productTitle,
          brand: input.brand ?? null,
          period_start: input.periodStart,
          period_end: input.periodEnd,
          price_curve: result.priceCurve as unknown as Record<string, unknown>[],
          price_gmv: result.priceGmv,
          price_neutral: result.priceNeutral,
          price_margin: result.priceMargin,
          elasticity_pct: result.elasticityPct,
          elasticity_class: result.elasticityClass,
          strategy: null,
        };

        const { data, error } = await supabase
          .from('commercial_analysis_snapshots')
          .insert([row])
          .select()
          .single();

        if (error) throw new Error(error.message);

        return mapRow(data);
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const fetchSnapshots = useCallback(
    async (itemId: string, orgId: string): Promise<AnalysisSnapshot[]> => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('commercial_analysis_snapshots')
          .select('*')
          .eq('item_id', itemId)
          .eq('organization_id', orgId)
          .order('created_at', { ascending: false });

        if (error) throw new Error(error.message);

        return (data ?? []).map(mapRow);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const updateStrategy = useCallback(
    async (snapshotId: string, strategy: 'gmv' | 'neutral' | 'margin'): Promise<void> => {
      const { error } = await supabase
        .from('commercial_analysis_snapshots')
        .update({ strategy })
        .eq('id', snapshotId);

      if (error) throw new Error(error.message);
    },
    [],
  );

  return { saveSnapshot, fetchSnapshots, updateStrategy, saving, loading };
}
