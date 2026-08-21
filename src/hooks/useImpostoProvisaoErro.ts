// ============================================================================
// useImpostoProvisaoErro — Fase 224 Plano 04, Task 2 (ERR-05)
// Hook TanStack Query que consome a RPC get_imposto_provisao_erro (migration
// 20260817120000), escopado por org (currentOrg.id do OrganizationContext).
//
// Padrão clonado de useDreCashForecast.ts (RPC + useOrganization + useQuery).
// Anti-IDOR é garantido server-side (RPC SECURITY INVOKER + RLS de orders e
// cash_outflows) — o frontend só passa a org do contexto, não re-filtra.
//
// A RPC devolve no máximo `pMeses` linhas (default 12, chamado com 12 aqui
// também) — muito abaixo do teto de 1000 do PostgREST. NÃO é preciso laço
// de paginação neste hook; não copiar esse padrão para uma consulta grande.
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import type { ImpostoProvisaoErroRow } from "@/lib/impostoProvisaoErro";

/**
 * Busca as linhas cruas (por mês de venda) do erro da provisão de imposto.
 *
 * @param pMeses Quantidade de meses retroativos a medir (default 12, mesmo
 *        default da RPC).
 */
export function useImpostoProvisaoErro(pMeses = 12) {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<ImpostoProvisaoErroRow[]>({
    queryKey: ["dre", "imposto-provisao-erro", orgId, pMeses] as const,
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ImpostoProvisaoErroRow[]> => {
      if (!orgId) return [];

      const { data, error } = await supabase.rpc("get_imposto_provisao_erro", {
        p_org_id: orgId,
        p_meses: pMeses,
      });

      if (error) throw error;

      // numeric do Postgres pode chegar como string em alguns drivers —
      // normalizar campo a campo, preservando null (lacuna declarada).
      return (data ?? []).map((r: any) => ({
        mesVenda: String(r.mes_venda),
        faturamento: Number(r.faturamento ?? 0),
        taxaMediaPrevista: r.taxa_media_prevista == null ? null : Number(r.taxa_media_prevista),
        nMesesBase: Number(r.n_meses_base ?? 0),
        provisaoPrevista: r.provisao_prevista == null ? null : Number(r.provisao_prevista),
        guiaCaixaNoMes: r.guia_caixa_no_mes == null ? null : Number(r.guia_caixa_no_mes),
        nGuiasCaixa: Number(r.n_guias_caixa ?? 0),
        competenciaApuracao: String(r.competencia_apuracao),
        guiaApuracaoMMaisUm: r.guia_apuracao_m_mais_1 == null ? null : Number(r.guia_apuracao_m_mais_1),
        nLinhasApuracao: Number(r.n_linhas_apuracao ?? 0),
      }));
    },
  });
}
