import { useQuery } from "@tanstack/react-query";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";

export type PendenciaTipo = "question" | "claim";

export interface PendenciaItem {
  key: string;
  tipo: PendenciaTipo;
  titulo: string;      // texto curto p/ exibir
  data: string | null; // ISO — p/ ordenar e "há X"
  href: string;        // rota de destino ao clicar
}

// Claims que ainda pedem ação (abertas / em análise).
const CLAIM_ABERTA = ["opened", "under_review"];

function claimLabel(tipo: string | null): string {
  if (tipo === "returns") return "Devolução";
  return "Reclamação";
}

/**
 * Pendências de atendimento da conta atual = perguntas não respondidas +
 * reclamações/devoluções abertas. Mesmo escopo das telas (org + multi-loja).
 * Refetch a cada 45s → o sino reflete o webhook em quase-tempo-real.
 */
export function useAtendimentoPendencias() {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;
  const enabled = !!orgId && resolvedMLUserIds.length > 0;

  const query = useQuery<PendenciaItem[]>({
    queryKey: ["atendimento-pendencias", orgId, resolvedMLUserIds],
    enabled,
    refetchInterval: 45_000,
    staleTime: 30_000,
    queryFn: async (): Promise<PendenciaItem[]> => {
      if (!orgId || resolvedMLUserIds.length === 0) return [];

      const [{ data: questions }, { data: claims }] = await Promise.all([
        supabase
          .from("ml_questions")
          .select("question_id,texto,data_pergunta")
          .eq("organization_id", orgId)
          .in("ml_user_id", resolvedMLUserIds)
          .eq("status", "UNANSWERED")
          .order("data_pergunta", { ascending: false })
          .limit(100),
        supabase
          .from("ml_claims")
          .select("claim_id,tipo,status,data_abertura")
          .eq("organization_id", orgId)
          .in("ml_user_id", resolvedMLUserIds)
          .in("status", CLAIM_ABERTA)
          .order("data_abertura", { ascending: false })
          .limit(100),
      ]);

      const qItems: PendenciaItem[] = (questions ?? []).map((q: any) => ({
        key: `q-${q.question_id}`,
        tipo: "question",
        titulo: (q.texto as string | null)?.trim() || "Nova pergunta",
        data: q.data_pergunta ?? null,
        href: "/perguntas",
      }));

      const cItems: PendenciaItem[] = (claims ?? []).map((c: any) => ({
        key: `c-${c.claim_id}`,
        tipo: "claim",
        titulo: `${claimLabel(c.tipo)} aberta`,
        data: c.data_abertura ?? null,
        href: "/devolucoes",
      }));

      return [...qItems, ...cItems].sort((a, b) => {
        const ta = a.data ? new Date(a.data).getTime() : 0;
        const tb = b.data ? new Date(b.data).getTime() : 0;
        return tb - ta;
      });
    },
  });

  const items = query.data ?? [];
  return { items, count: items.length, isLoading: query.isLoading };
}
