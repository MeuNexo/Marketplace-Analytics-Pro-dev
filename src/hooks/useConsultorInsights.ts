import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, useEffect, useMemo } from "react";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

// ─── Row types from generated types (Plan 45-01) ─────────────────────────────

export type InsightRow = Database["public"]["Tables"]["insights"]["Row"];
type SnapshotRow = Database["public"]["Tables"]["consultor_health_snapshots"]["Row"];

// ─── Derived types ────────────────────────────────────────────────────────────

export type ScoreBand = "healthy" | "attention" | "critical";

export interface HealthScore {
  score: number;
  scoreBand: ScoreBand;
  scoreDelta: number | null; // positive = improving, negative = declining
  pillars: {
    margin: number;
    ads: number;
    estoque: number;
    reputacao: number;
    completude: number;
  } | null;
}

// ─── EF consultor-llm response shapes (Plan 53) ──────────────────────────────

interface LLMSummaryResponse {
  summary?: string;
  cached?: boolean;
  stale?: boolean;
  fallback?: boolean;
  disabled?: boolean;
}

interface LLMExplainResponse {
  explanation?: string;
  cached?: boolean;
  fallback?: boolean;
  disabled?: boolean;
}

// ─── Severity ordering (D-17: critical=0, high=1, medium=2) ──────────────────

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
};

function severityRank(s: string): number {
  return SEVERITY_RANK[s] ?? 99;
}

// ─── Score band (D-10: ≥75 healthy, ≥50 attention, else critical) ────────────

function getScoreBand(score: number): ScoreBand {
  if (score >= 75) return "healthy";
  if (score >= 50) return "attention";
  return "critical";
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Reads insights + health snapshots for the current org.
 *
 * - `insights` — active insights sorted by severity (D-17) then impact_brl desc.
 * - `score` + `scoreDelta` + `scoreBand` + `pillars` — from consultor_health_snapshots.
 * - On-demand invoke: when no active insights found and not already tried, calls the
 *   `consultor-insights` EF (D-20). Exposes `syncing` for UI feedback.
 * - `dismiss(id)` — sets status='dismissed', dismissed_at=now() and invalidates. (D-18)
 */
export function useConsultorInsights() {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;
  const queryClient = useQueryClient();

  // ── 1. Insights query ─────────────────────────────────────────────────────

  const insightsQuery = useQuery<InsightRow[]>({
    queryKey: ["consultor_insights", orgId],
    enabled: !!orgId,
    staleTime: 4 * 60 * 60 * 1000, // 4h — cron runs daily
    queryFn: async (): Promise<InsightRow[]> => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("insights")
        .select("*")
        .eq("organization_id", orgId)
        .in("status", ["active"]);
      if (error) throw error;
      return (data ?? []) as InsightRow[];
    },
  });

  // ── 2. Sorted insights (D-17: severity rank first, then impact_brl desc) ──

  const insights = useMemo<InsightRow[]>(() => {
    if (!insightsQuery.data) return [];
    return [...insightsQuery.data].sort((a, b) => {
      const rankDiff = severityRank(a.severity) - severityRank(b.severity);
      if (rankDiff !== 0) return rankDiff;
      // impact_brl desc, nulls last
      const aVal = a.impact_brl ?? -Infinity;
      const bVal = b.impact_brl ?? -Infinity;
      return bVal - aVal;
    });
  }, [insightsQuery.data]);

  // ── 3. Snapshot query (2 most recent months for delta) ───────────────────

  const snapshotQuery = useQuery<SnapshotRow[]>({
    queryKey: ["consultor_score", orgId],
    enabled: !!orgId,
    staleTime: 4 * 60 * 60 * 1000,
    queryFn: async (): Promise<SnapshotRow[]> => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("consultor_health_snapshots")
        .select("*")
        .eq("organization_id", orgId)
        .order("snapshot_month", { ascending: false })
        .limit(2);
      if (error) throw error;
      return (data ?? []) as SnapshotRow[];
    },
  });

  // ── 4. Derived score values ───────────────────────────────────────────────

  const healthScore = useMemo<HealthScore | null>(() => {
    const snapshots = snapshotQuery.data;
    if (!snapshots || snapshots.length === 0) return null;

    const latest = snapshots[0];
    const previous = snapshots[1] ?? null;
    const score = latest.score;
    const scoreDelta = previous != null ? score - previous.score : null;
    const scoreBand = getScoreBand(score);

    const pillars = {
      margin: latest.score_margin,
      ads: latest.score_ads,
      estoque: latest.score_estoque,
      reputacao: latest.score_reputacao,
      completude: latest.score_completude,
    };

    return { score, scoreBand, scoreDelta, pillars };
  }, [snapshotQuery.data]);

  // ── 5. On-demand invoke when empty (D-20) ────────────────────────────────

  const [syncing, setSyncing] = useState(false);
  const attemptedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const { isLoading, data } = insightsQuery;
    if (isLoading || !orgId) return;
    if (data && data.length > 0) return; // already have insights
    if (attemptedRef.current.has(orgId)) return;
    attemptedRef.current.add(orgId);

    let cancelled = false;
    setSyncing(true);
    supabase.functions
      .invoke("consultor-insights", { body: { mode: "org_only" } })
      .then(({ error }) => {
        // On network/5xx error, release the guard so the next visit can retry
        if (error) attemptedRef.current.delete(orgId);
        if (!cancelled) return insightsQuery.refetch();
      })
      .finally(() => {
        if (!cancelled) setSyncing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [insightsQuery.isLoading, insightsQuery.data, orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 6. Dismiss mutation (D-18) ────────────────────────────────────────────

  const dismissMutation = useMutation({
    mutationFn: async (insightId: string) => {
      if (!orgId) throw new Error("No org");
      const { error } = await supabase
        .from("insights")
        .update({
          status: "dismissed",
          dismissed_at: new Date().toISOString(),
        })
        .eq("id", insightId)
        .eq("organization_id", orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consultor_insights", orgId] });
    },
  });

  const dismiss = (insightId: string) => dismissMutation.mutate(insightId);

  // ── 7. Resumo COO (camada LLM, Plan 53) ───────────────────────────────────
  //
  // Invoca a EF `consultor-llm` (mode='summary'). JWT do usuário é anexado
  // automaticamente pelo supabase-js. A EF faz cache-check server-side, então
  // reabrir o painel não re-gera nem re-cobra. staleTime alto (mesmo dia).
  // Retornos possíveis: {summary,cached,stale,fallback} | {disabled:true}.

  const summaryQuery = useQuery<LLMSummaryResponse>({
    queryKey: ["consultor_summary", orgId],
    enabled: !!orgId,
    staleTime: 12 * 60 * 60 * 1000, // 12h — resumo é do dia
    retry: false,
    queryFn: async (): Promise<LLMSummaryResponse> => {
      if (!orgId) return {};
      const { data, error } = await supabase.functions.invoke("consultor-llm", {
        body: { org_id: orgId, mode: "summary" },
      });
      if (error) throw error;
      return (data ?? {}) as LLMSummaryResponse;
    },
  });

  const summaryResp = summaryQuery.data;

  // ── 8. Atualizar análise (LLM-04, força regeneração respeitando cap server) ─

  const refreshSummaryMutation = useMutation({
    mutationFn: async (): Promise<LLMSummaryResponse> => {
      if (!orgId) throw new Error("No org");
      const { data, error } = await supabase.functions.invoke("consultor-llm", {
        body: { org_id: orgId, mode: "summary", force_refresh: true },
      });
      if (error) throw error;
      return (data ?? {}) as LLMSummaryResponse;
    },
    onSuccess: (data) => {
      // grava o resultado fresco diretamente no cache da query (sem 2ª chamada)
      queryClient.setQueryData(["consultor_summary", orgId], data);
    },
  });

  const refreshSummary = () => refreshSummaryMutation.mutateAsync();

  // ── 9. Explicar (LLM-02, explicação sob demanda por insight) ──────────────
  //
  // Cache por insight/dia é responsabilidade da EF (prompt_version='explain:'+id).
  // Retorna o texto da explicação; em fallback/disabled retorna string vazia
  // (o consumidor decide o que mostrar).

  const explain = async (insightId: string): Promise<string> => {
    if (!orgId) return "";
    const { data, error } = await supabase.functions.invoke("consultor-llm", {
      body: { org_id: orgId, mode: "explain", insight_id: insightId },
    });
    if (error) throw error;
    const resp = (data ?? {}) as LLMExplainResponse;
    if (resp.disabled) return "";
    return resp.explanation ?? "";
  };

  // ── Return ────────────────────────────────────────────────────────────────

  return {
    insights,
    score: healthScore?.score ?? null,
    scoreDelta: healthScore?.scoreDelta ?? null,
    scoreBand: healthScore?.scoreBand ?? null,
    pillars: healthScore?.pillars ?? null,
    loading: insightsQuery.isLoading || snapshotQuery.isLoading,
    syncing,
    dismiss,
    // camada LLM (Plan 53)
    summaryText: summaryResp?.summary ?? null,
    summaryDisabled: summaryResp?.disabled === true,
    summaryFallback: summaryResp?.fallback === true,
    summaryStale: summaryResp?.stale === true,
    summaryLoading: summaryQuery.isLoading,
    summaryRefreshing: refreshSummaryMutation.isPending,
    refreshSummary,
    explain,
  };
}
