import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";

export interface ReplenishmentRow {
  item_id: string;
  title: string | null;
  brand: string | null;
  logistic_type: string | null;
  estoque_atual: number;
  venda_dia: number;
  cobertura_atual: number | null;
  ponto_reposicao: number;
  alvo: number;
  compra_sugerida: number;
  valor_estimado: number | null;
  custo_ausente: boolean;
  sem_giro: boolean;
  gatilho_ativo: boolean;
  param_lead_time: number;
  param_cobertura: number;
  param_safety: number;
  param_moq: number;
  param_pack: number;
  param_origem: string;
}

export function useReplenishment(
  salesWindowDays = 30,
  demandMultiplier = 1.0,
) {
  const { currentOrg } = useOrganization();

  return useQuery({
    queryKey: ["get_replenishment", currentOrg?.id, salesWindowDays, demandMultiplier] as const,
    queryFn: async (): Promise<ReplenishmentRow[]> => {
      if (!currentOrg?.id) return [];

      const { data, error } = await supabase.rpc("get_replenishment", {
        p_org_id:             currentOrg.id,
        p_sales_window_days:  salesWindowDays,
        p_demand_multiplier:  demandMultiplier,
      });

      if (error) throw error;

      return (data ?? []).map((r: Record<string, unknown>) => ({
        item_id:         String(r.item_id),
        title:           r.title != null ? String(r.title) : null,
        brand:           r.brand != null ? String(r.brand) : null,
        logistic_type:   r.logistic_type != null ? String(r.logistic_type) : null,
        estoque_atual:   Number(r.estoque_atual),
        venda_dia:       Number(r.venda_dia),
        cobertura_atual: r.cobertura_atual != null ? Number(r.cobertura_atual) : null,
        ponto_reposicao: Number(r.ponto_reposicao),
        alvo:            Number(r.alvo),
        compra_sugerida: Number(r.compra_sugerida),
        valor_estimado:  r.valor_estimado != null ? Number(r.valor_estimado) : null,
        custo_ausente:   Boolean(r.custo_ausente),
        sem_giro:        Boolean(r.sem_giro),
        gatilho_ativo:   Boolean(r.gatilho_ativo),
        param_lead_time: Number(r.param_lead_time),
        param_cobertura: Number(r.param_cobertura),
        param_safety:    Number(r.param_safety),
        param_moq:       Number(r.param_moq),
        param_pack:      Number(r.param_pack),
        param_origem:    String(r.param_origem ?? "global"),
      }));
    },
    enabled: !!currentOrg?.id,
    staleTime: 5 * 60 * 1000,
  });
}
