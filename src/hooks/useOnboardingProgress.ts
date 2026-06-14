import { useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";

// ─── Types ────────────────────────────────────────────────────────────────────

// Passos do onboarding na ordem do wizard (D-08).
// `tiny` e opcional (pode ser pulado); `done` e o estado terminal.
export type OnboardingStep = "connect_ml" | "tiny" | "costs" | "fiscal" | "done";

// Ordem canonica dos passos "reais" (exclui `done`, que e terminal).
export const ONBOARDING_STEPS: OnboardingStep[] = ["connect_ml", "tiny", "costs", "fiscal"];

// Passos obrigatorios para considerar o onboarding completo (Tiny e opcional — D-08).
const REQUIRED_STEPS: OnboardingStep[] = ["connect_ml", "costs", "fiscal"];

interface OnboardingRow {
  organization_id: string;
  current_step: string;
  completed_steps: string[];
  completed_at: string | null;
  updated_at: string;
}

// Estado real detectado a partir das tabelas de dados da org.
interface DetectedState {
  connect_ml: boolean;
  tiny: boolean;
  costs: boolean;
  fiscal: boolean;
}

export interface OnboardingProgress {
  loading: boolean;
  /** Passo atual de retomada (persistido ou derivado do estado real). */
  currentStep: OnboardingStep;
  /** Uniao dos passos persistidos com os auto-detectados pelo estado real. */
  completedSteps: OnboardingStep[];
  /** true quando todos os passos obrigatorios estao concluidos. */
  isComplete: boolean;
  /** Estado real detectado por passo (para o wizard refletir o que ja foi feito). */
  detected: DetectedState;
  /** Persiste a conclusao de um passo + avanca current_step. */
  completeStep: (step: OnboardingStep) => Promise<void>;
  /** Forca refetch do estado persistido + auto-deteccao. */
  refetch: () => void;
}

// ─── Auto-deteccao do estado real ───────────────────────────────────────────────
// connect_ml: existe ml_tokens com access_token para a org.
// tiny:       ml_tokens da org tem credenciais Tiny (tiny_token / tiny_*).
// costs:      existe >=1 ml_product_costs com cost > 0 na org.
// fiscal:     existe >=1 linha em ml_tax_config para a org.
async function detectRealState(orgId: string): Promise<DetectedState> {
  const [tokensRes, costsRes, taxRes] = await Promise.all([
    supabase
      .from("ml_tokens")
      .select("access_token, tiny_access_token")
      .eq("organization_id", orgId)
      .not("access_token", "is", null)
      .limit(50),
    supabase
      .from("ml_product_costs")
      .select("item_id")
      .eq("organization_id", orgId)
      .gt("cost", 0)
      .limit(1),
    supabase
      .from("ml_tax_config")
      .select("id")
      .eq("organization_id", orgId)
      .limit(1),
  ]);

  const tokenRows = (tokensRes.data ?? []) as Array<{ access_token: string | null; tiny_access_token: string | null }>;
  const connect_ml = tokenRows.length > 0;
  const tiny = tokenRows.some((t) => !!t.tiny_access_token);
  const costs = (costsRes.data ?? []).length > 0;
  const fiscal = (taxRes.data ?? []).length > 0;

  return { connect_ml, tiny, costs, fiscal };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOnboardingProgress(): OnboardingProgress {
  const { currentOrg } = useOrganization();
  const queryClient = useQueryClient();
  const orgId = currentOrg?.id ?? null;

  // Estado persistido em onboarding_progress.
  const progressQuery = useQuery({
    queryKey: ["onboarding-progress", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<OnboardingRow | null> => {
      if (!orgId) return null;
      const { data, error } = await supabase
        .from("onboarding_progress")
        .select("organization_id, current_step, completed_steps, completed_at, updated_at")
        .eq("organization_id", orgId)
        .maybeSingle();
      if (error) {
        console.warn("useOnboardingProgress fetch error", error);
        return null;
      }
      return (data as OnboardingRow | null) ?? null;
    },
  });

  // Estado real auto-detectado.
  const detectedQuery = useQuery({
    queryKey: ["onboarding-detected", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<DetectedState> => {
      if (!orgId) return { connect_ml: false, tiny: false, costs: false, fiscal: false };
      return detectRealState(orgId);
    },
  });

  const detected: DetectedState = detectedQuery.data ?? {
    connect_ml: false,
    tiny: false,
    costs: false,
    fiscal: false,
  };

  // Merge: passos persistidos UNIAO passos auto-detectados pelo estado real.
  const completedSteps = useMemo<OnboardingStep[]>(() => {
    const set = new Set<OnboardingStep>();
    for (const s of progressQuery.data?.completed_steps ?? []) {
      if ((ONBOARDING_STEPS as string[]).includes(s)) set.add(s as OnboardingStep);
    }
    if (detected.connect_ml) set.add("connect_ml");
    if (detected.tiny) set.add("tiny");
    if (detected.costs) set.add("costs");
    if (detected.fiscal) set.add("fiscal");
    return ONBOARDING_STEPS.filter((s) => set.has(s));
  }, [progressQuery.data, detected]);

  const isComplete = useMemo(
    () => REQUIRED_STEPS.every((s) => completedSteps.includes(s)),
    [completedSteps],
  );

  // Passo atual de retomada: primeiro passo obrigatorio ainda nao concluido,
  // senao o persistido, senao 'done'.
  const currentStep = useMemo<OnboardingStep>(() => {
    if (isComplete) return "done";
    const nextPending = ONBOARDING_STEPS.find((s) => !completedSteps.includes(s));
    if (nextPending) return nextPending;
    const persisted = progressQuery.data?.current_step;
    if (persisted && (["connect_ml", "tiny", "costs", "fiscal", "done"] as string[]).includes(persisted)) {
      return persisted as OnboardingStep;
    }
    return "connect_ml";
  }, [isComplete, completedSteps, progressQuery.data]);

  // Persiste conclusao de um passo: upsert em onboarding_progress.
  const completeMutation = useMutation({
    mutationFn: async (step: OnboardingStep) => {
      if (!orgId) return;
      const prevCompleted = new Set<string>(progressQuery.data?.completed_steps ?? []);
      prevCompleted.add(step);
      // Proximo current_step = primeiro passo ainda nao concluido (apos este), senao 'done'.
      const remaining = ONBOARDING_STEPS.filter((s) => !prevCompleted.has(s));
      const allRequiredDone = REQUIRED_STEPS.every((s) => prevCompleted.has(s));
      const nextStep: OnboardingStep = allRequiredDone ? "done" : remaining[0] ?? "done";

      const { error } = await supabase
        .from("onboarding_progress")
        .upsert(
          {
            organization_id: orgId,
            current_step: nextStep,
            completed_steps: Array.from(prevCompleted),
            completed_at: nextStep === "done" ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "organization_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding-progress", orgId] });
      queryClient.invalidateQueries({ queryKey: ["onboarding-detected", orgId] });
    },
  });

  const completeStep = useCallback(
    async (step: OnboardingStep) => {
      await completeMutation.mutateAsync(step);
    },
    [completeMutation],
  );

  const refetch = useCallback(() => {
    progressQuery.refetch();
    detectedQuery.refetch();
  }, [progressQuery, detectedQuery]);

  return {
    loading: progressQuery.isLoading || detectedQuery.isLoading,
    currentStep,
    completedSteps,
    isComplete,
    detected,
    completeStep,
    refetch,
  };
}
