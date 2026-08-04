import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";

/**
 * Frescor da varredura de estoque do Tiny (Fase 214).
 *
 * A pergunta que este hook faz NAO e "tem dado?", e "o dado e recente?".
 * O smoke e o gate de paridade da Fase 208 passavam com dado velho justamente
 * porque perguntavam a primeira. A tela de Compras decide dinheiro: sugerir
 * compra sobre um estoque de tres dias atras e pior do que nao sugerir nada.
 */
export interface TinyStockHealth {
  /** null enquanto a primeira volta nao fechou. */
  volta_completa: string | null;
  /** true quando a ultima volta fechou ha mais de 48h — ou nunca fechou. */
  desatualizado: boolean;
  indice: number;
  total_fila: number;
  pct_volta: number;
  erros: number;
  ultimo_erro: string | null;
  skus_com_estoque: number;
  estoque_mais_recente: string | null;
}

export function useTinyStockHealth() {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery({
    queryKey: ["tiny-stock-health", orgId],
    enabled: !!orgId,
    staleTime: 60_000,
    queryFn: async (): Promise<TinyStockHealth | null> => {
      // A view `tiny_stock_health` nasceu na Fase 214 e ainda nao esta em
      // src/integrations/supabase/types.ts (arquivo gerado). O cast e restrito
      // a esta chamada; o formato do retorno e validado logo abaixo, campo a
      // campo, em vez de confiar no tipo.
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (col: string, v: unknown) => {
              maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
            };
          };
        };
      })
        .from("tiny_stock_health")
        .select(
          "volta_completa, desatualizado, indice, total_fila, pct_volta, erros, ultimo_erro, skus_com_estoque, estoque_mais_recente",
        )
        .eq("organization_id", orgId)
        .maybeSingle();

      // Org sem varredura configurada nao e erro — e ausencia, e a tela
      // precisa distinguir as duas coisas.
      if (error || !data) return null;

      const r = data as Record<string, unknown>;
      return {
        volta_completa:       r.volta_completa != null ? String(r.volta_completa) : null,
        desatualizado:        Boolean(r.desatualizado),
        indice:               Number(r.indice ?? 0),
        total_fila:           Number(r.total_fila ?? 0),
        pct_volta:            Number(r.pct_volta ?? 0),
        erros:                Number(r.erros ?? 0),
        ultimo_erro:          r.ultimo_erro != null ? String(r.ultimo_erro) : null,
        skus_com_estoque:     Number(r.skus_com_estoque ?? 0),
        estoque_mais_recente: r.estoque_mais_recente != null ? String(r.estoque_mais_recente) : null,
      };
    },
  });
}
