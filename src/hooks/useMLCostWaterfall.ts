import { useQuery } from "@tanstack/react-query";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";

export interface CostWaterfallData {
  /** Receita bruta de pedidos pagos (paid/shipped/delivered) */
  paid_revenue: number;
  /** Receita de pedidos cancelados/devolvidos no período */
  cancelled_revenue: number;
  /** SUM(comissao) dos pedidos pagos */
  total_comissao: number;
  /** SUM(frete) dos pedidos pagos */
  total_frete: number;
  /** SUM(custo_unit * quantidade) dos pedidos pagos com custo_unit != null */
  cmv: number;
  /** true se ao menos 1 pedido pago tem custo_unit preenchido */
  has_cmv: boolean;
  /** SUM(tax_amount) dos pedidos pagos */
  total_tax: number;
  /** true se ao menos 1 pedido pago tem tax_amount > 0 */
  has_tax_data: boolean;
  /** CMV cheio da nota (SUM(custo_unit_cheio * quantidade)) — base do regime APURAÇÃO (Phase 94) */
  cmv_cheio: number;
  /** true se ao menos 1 pedido pago tem custo_unit_cheio preenchido */
  has_cmv_cheio: boolean;
  /** Receita bruta por ml_user_id (para calcular impostos no caller) */
  revenue_per_store: Map<string, number>;
}

export function useMLCostWaterfall(from: string, to: string) {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<CostWaterfallData | null>({
    queryKey: ["ml", "cost-waterfall", orgId, resolvedMLUserIds, from, to],
    queryFn: async (): Promise<CostWaterfallData | null> => {
      if (!orgId || resolvedMLUserIds.length === 0) return null;

      const { data, error } = await supabase.rpc("get_cost_waterfall", {
        p_org_id:   orgId,
        p_user_ids: resolvedMLUserIds,
        p_from:     from.substring(0, 10),
        p_to:       to.substring(0, 10),
      });

      if (error) throw error;
      const r = data?.[0];
      if (!r) return null;

      const paid_revenue   = Number(r.paid_revenue);
      const cmv            = Number(r.cmv);
      const total_comissao = Number(r.total_comissao);
      const total_frete    = Number(r.total_frete);
      const total_tax      = Number(r.total_tax);
      const cmv_cheio      = Number(r.cmv_cheio ?? 0);

      // paid_revenue=0 significa sem pedidos pagos no período (receita_bruta nula ou tabela vazia).
      // Retornar null força o caller a usar ml_daily_cache + estimativas hardcoded de forma consistente,
      // evitando mistura de fontes que inflava o Lucro Bruto.
      if (paid_revenue === 0) return null;

      return {
        paid_revenue,
        cancelled_revenue: 0,          // RPC agrega paid; cancelados não são incluídos
        total_comissao,
        total_frete,
        cmv: Math.round(cmv * 100) / 100,
        has_cmv: cmv > 0,
        total_tax: Math.round(total_tax * 100) / 100,
        has_tax_data: total_tax > 0,
        cmv_cheio: Math.round(cmv_cheio * 100) / 100,
        has_cmv_cheio: cmv_cheio > 0,
        revenue_per_store: new Map(),  // não disponível em agregação server-side
      };
    },
    enabled: !!orgId && resolvedMLUserIds.length > 0 && !!from && !!to,
    staleTime: 5 * 60 * 1000,
  });
}
