import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";

/**
 * Frescor dos pedidos — "até que horas este número vale".
 *
 * POR QUE EXISTE: em 04/08/2026 a operação vendeu R$ 19.040,25 e a tela
 * mostrava R$ 13-14 mil. O cálculo estava certo; o que faltava era metade dos
 * pedidos, porque o sync do dia corrente não existia — o cron só buscava o dia
 * anterior, uma vez por dia.
 *
 * Dado incompleto apresentado como final é pior que dado ausente: parece certo.
 * Este hook alimenta o aviso que impede a tela de mentir por omissão.
 */
export interface OrdersFreshness {
  ultimoSync: string | null;
  pedidoMaisRecente: string | null;
  /** true quando o último sync tem mais de 2 horas. */
  syncAtrasado: boolean;
  pedidosHoje: number;
}

export function useOrdersFreshness() {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery({
    queryKey: ["orders-freshness", orgId],
    enabled: !!orgId,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<OrdersFreshness | null> => {
      // A view `orders_sync_health` é da migration 20260805011500 e ainda não
      // está no types.ts gerado. O cast é local; o retorno é validado campo a
      // campo abaixo.
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (col: string, v: unknown) => {
              maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
            };
          };
        };
      })
        .from("orders_sync_health")
        .select("ultimo_sync, pedido_mais_recente, sync_atrasado, pedidos_hoje")
        .eq("organization_id", orgId)
        .maybeSingle();

      if (error || !data) return null;

      const r = data as Record<string, unknown>;
      return {
        ultimoSync:        r.ultimo_sync != null ? String(r.ultimo_sync) : null,
        pedidoMaisRecente: r.pedido_mais_recente != null ? String(r.pedido_mais_recente) : null,
        syncAtrasado:      Boolean(r.sync_atrasado),
        pedidosHoje:       Number(r.pedidos_hoje ?? 0),
      };
    },
  });
}
