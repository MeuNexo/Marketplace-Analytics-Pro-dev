// ============================================================================
// useCmvCheioGate — Phase 96 Plan 03, Task 3 (C6-backend)
//
// Consome a RPC de gaps de custo cheio (migration 20260715130000), que lista,
// por SKU, os pedidos pagos do período sem `custo_unit_cheio`. É a lista que
// o gate de "marcar mês como apurado" (dre_month_close, Phase 94) usa para
// bloquear o fechamento E dizer ao Wesley exatamente o que corrigir no Tiny.
//
// POR QUE ISTO É UMA RPC E NÃO UM CÁLCULO NO CLIENTE:
// derivar a lista client-side exigiria puxar todos os pedidos pagos do mês —
// maio/2026 tem 1.118 — e o PostgREST trunca em 1000 linhas, então a lista
// sairia silenciosamente incompleta e o gate liberaria um mês furado. A
// agregação por SKU acontece no banco, no MESMO predicado do
// get_cost_waterfall (org + lojas + status paid/shipped/delivered + range de
// data_pedido), para que o gate e o CMV enxerguem sempre o mesmo conjunto de
// pedidos. Predicados divergentes = gate e CMV discordando = número que não
// fecha.
//
// 🚨 ESTE HOOK NUNCA ALIMENTA resolveDreRegime (dreRegime.ts) — Pitfall 7 do
// 96-RESEARCH. O resolver decide PREVISÃO vs APURAÇÃO; o branch de previsão
// (`!isClosed`) jamais lê cmvCheio, e é essa propriedade estrutural que
// garante o SC5 (previsão byte-a-byte igual à do legado). Este hook serve só
// ao CAMINHO DE FECHAR o mês (resolveCloseGate em dreCloseGate.ts). Ligar o
// gate ao resolver mudaria a previsão e quebraria o SC5.
//
// Padrão de escopo (lojas + range) clonado de useMLCostWaterfall.ts — o mesmo
// eixo de mês do waterfall, resolvido pelo caller (96-06), igual lá.
// Este hook NÃO é consumido ainda — a fiação é do plano 96-06.
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import type { CmvCheioGap } from "@/lib/dreCloseGate";

// O tipo mora no módulo puro (dreCloseGate.ts, plano 96-02) e é re-exportado
// aqui por conveniência dos consumidores — mesmo padrão de useDreOperational
// re-exportando DreOperationalRow de dreCascade.ts.
export type { CmvCheioGap } from "@/lib/dreCloseGate";

/**
 * SKUs vendidos no período sem custo cheio (`custo_unit_cheio IS NULL`),
 * ordenados por receita desc. Alvo de maio/2026 (Pé Vermeio): 39 SKUs / 226
 * linhas / R$23.828,31, dos quais 4 sem custo nenhum.
 *
 * @param from Data inicial "YYYY-MM-DD" (ou ISO — só os 10 primeiros chars são usados).
 * @param to   Data final "YYYY-MM-DD" (idem).
 *
 * Lista vazia é um estado VÁLIDO e informativo: significa "nenhum gap", ou
 * seja, mês liberado para fechar. Por isso este hook devolve sempre um array
 * e NUNCA null — deliberadamente sem o guard de receita-zero que
 * useMLCostWaterfall.ts aplica (lá, receita paga zerada anula o waterfall
 * inteiro para forçar o caller a outra fonte; aqui, "nenhum gap" e "sem dado"
 * precisam ser distinguíveis, e quem distingue é o estado do próprio
 * useQuery). O fail-closed de "ainda carregando" é responsabilidade do
 * resolveCloseGate, que trata `gaps === null` como bloqueado.
 */
export function useCmvCheioGate(from: string, to: string) {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<CmvCheioGap[]>({
    queryKey: ["ml", "cmv-cheio-gaps", orgId, resolvedMLUserIds, from, to] as const,
    enabled: !!orgId && resolvedMLUserIds.length > 0 && !!from && !!to,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CmvCheioGap[]> => {
      if (!orgId || resolvedMLUserIds.length === 0) return [];

      const { data, error } = await supabase.rpc("get_cmv_cheio_gaps", {
        p_org_id: orgId,
        p_user_ids: resolvedMLUserIds,
        p_from: from.substring(0, 10),
        p_to: to.substring(0, 10),
      });

      if (error) throw error;

      // Ausência de linhas = nenhum gap → array vazio (mês liberado).
      return ((data as any[]) ?? []).map((r: any) => ({
        sku: String(r.sku),
        marca: r.marca ?? null,
        linhas: Number(r.linhas ?? 0),
        unidades: Number(r.unidades ?? 0),
        receita: Math.round(Number(r.receita ?? 0) * 100) / 100,
        temCustoMedio: Boolean(r.tem_custo_medio),
      }));
    },
  });
}
