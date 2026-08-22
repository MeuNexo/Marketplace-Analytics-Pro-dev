// ============================================================================
// useCashCycle — Fase 230, Plano 03, Task 2 (CX-02)
//
// Leitura da RPC `get_cash_cycle`: os insumos crus do ciclo de conversão de
// caixa. Este hook NÃO faz aritmética — a composição do ciclo e toda leitura de
// ausência moram em `src/lib/cicloCaixa.ts`, que é puro e testado.
//
// 🔴 Nada de `?? 0` nos números. Coalescer ausência para zero é exatamente o
// defeito que esta fase inteira combate: um CMV diário ausente virando zero
// faria o DIO explodir, e um DPO ausente virando zero encolheria o ciclo sem
// avisar. Ausência chega aqui como null e sai daqui como null.
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import type { InsumosCicloCaixa } from "@/lib/cicloCaixa";

/** Janela de medição, em dias corridos. Mesma janela das RPCs de caixa da casa. */
export const JANELA_CICLO_DIAS = 90;

/** numeric do Postgres pode chegar como string em alguns drivers — normalizar preservando null. */
const numeroOuNulo = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function useCashCycle(janelaDias: number = JANELA_CICLO_DIAS) {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<InsumosCicloCaixa | null>({
    queryKey: ["cashflow", "cash_cycle", orgId, janelaDias] as const,
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<InsumosCicloCaixa | null> => {
      if (!orgId) return null;

      const { data, error } = await (supabase.rpc as any)("get_cash_cycle", {
        p_org_id: orgId,
        p_janela_dias: janelaDias,
      });

      if (error) throw error;

      const r = (data as any)?.[0];
      if (!r) return null;

      return {
        valorEstoque: numeroOuNulo(r.valor_estoque),
        unidadesEstoque: numeroOuNulo(r.unidades_estoque),
        unidadesSemCusto: numeroOuNulo(r.unidades_sem_custo),
        skusSemCusto: numeroOuNulo(r.skus_sem_custo),
        cmvDiario: numeroOuNulo(r.cmv_diario),
        cmvPedidos: numeroOuNulo(r.cmv_pedidos),
        dsoDias: numeroOuNulo(r.dso_dias),
        dsoN: numeroOuNulo(r.dso_n),
        // Booleano: ausência é tratada como "não sabemos se é livre" — na
        // dúvida a tela declara o limite, nunca esconde.
        dsoNoLimite: r.dso_no_limite !== false,
        dpoDias: numeroOuNulo(r.dpo_dias),
        dpoN: numeroOuNulo(r.dpo_n),
        janelaDias: numeroOuNulo(r.janela_dias),
      };
    },
  });
}
