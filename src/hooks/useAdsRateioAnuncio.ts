// ============================================================================
// useAdsRateioAnuncio — Fase 211, Plano 03, Task 2 (ADS-06 / D-03, D-07)
//
// Entrega o gasto de publicidade DE UM ANÚNCIO no período, já rateado: o total
// que o Mercado Livre cobrou na fatura (`ml_billing_daily`), distribuído por MLB
// pela proporção do relatório de publicidade (`ml_ads_products_cache`).
//
// Lê TRÊS séries e entrega ao helper puro `ratearAdsDoAnuncio`:
//   1. a fatura do período — via `fetchAdsBillingRows` + `aggregateAdsBillingSpend`,
//      as MESMAS funções da fase 210 (a régua PADS/BPAD não é redigitada aqui);
//   2. a chave de rateio — a RPC `ads_cache_daily_totals`, que devolve o gasto
//      diário do cache somado sobre TODOS os anúncios das lojas (o denominador);
//   3. o gasto diário do cache do anúncio escolhido (o numerador).
//
// Por que a chave vem de RPC: o denominador é a soma sobre todos os anúncios —
// baixar isso para o navegador seriam dezenas de milhares de linhas só para
// somar. A RPC é SECURITY INVOKER e não recebe organização do cliente: a RLS
// org-first de `ml_ads_products_cache` é a fronteira real (T-211-24).
//
// Por que `.range(0, 4999)` na leitura do cache do anúncio: sem range explícito
// o PostgREST trunca em 1000 linhas EM SILÊNCIO, e a proporção do anúncio sairia
// subestimada sem nenhum sinal de erro — a mesma classe de falha que originou
// esta fase (T-211-27).
//
// Hook estritamente de LEITURA: nenhuma escrita, nenhuma Edge Function, nenhuma
// credencial elevada.
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import { aggregateAdsBillingSpend, type AdsSpendDailyRow } from "@/lib/adsBillingSpend";
import { ratearAdsDoAnuncio, type RateioAnuncioResult } from "@/lib/adsRateio";
import { fetchAdsBillingRows } from "./useMLAdsBillingSpend";

/** Resposta crua da RPC da chave de rateio (uma linha por dia). */
interface LinhaChaveDeRateio {
  dia: string | null;
  total_spend: number | string | null;
}

/** A RPC ainda não consta dos tipos gerados — assinatura mínima, sem `any`. */
type ChamadaRpc = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

const mapDiario = (linhas: Array<{ date?: unknown; spend?: unknown }>): AdsSpendDailyRow[] =>
  linhas
    .filter((r) => r?.date != null)
    .map((r) => ({ date: String(r.date), spend: Number(r.spend ?? 0) || 0 }));

/**
 * Publicidade rateada do anúncio `itemId` no intervalo `[from, to]`.
 *
 * As lojas vêm por argumento (e não do contexto global) porque a Análise de
 * Preços é escopada pela loja escolhida na tela.
 *
 * Erro da RPC da chave ou da leitura do cache do anúncio NÃO derruba a tela:
 * registra em `console.warn` e segue com série vazia — é o comportamento que o
 * componente já tinha. Erro da leitura da fatura propaga; sem fatura o rateio
 * cai no ramo de cache por `rowCount` zero, que é o desenho correto (fase 210).
 */
export function useAdsRateioAnuncio(
  itemId: string | null,
  mlUserIds: string[],
  from: string | null,
  to: string | null,
) {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;
  const habilitado = !!orgId && !!itemId && mlUserIds.length > 0 && !!from && !!to;

  return useQuery<RateioAnuncioResult | null>({
    queryKey: ["ml", "ads-rateio-anuncio", orgId, mlUserIds, itemId, from, to],
    queryFn: async (): Promise<RateioAnuncioResult | null> => {
      if (!orgId || !itemId || mlUserIds.length === 0 || !from || !to) return null;

      const [faturaRows, chaveRes, itemRes] = await Promise.all([
        // 1. A fatura — mesma leitura da fase 210, compartilhada
        fetchAdsBillingRows(orgId, mlUserIds, from, to),
        // 2. A chave de rateio (denominador), uma linha por dia
        (supabase.rpc as unknown as ChamadaRpc)("ads_cache_daily_totals", {
          p_ml_user_ids: mlUserIds,
          p_from: from,
          p_to: to,
        }),
        // 3. O gasto do cache do anúncio escolhido (numerador)
        supabase
          .from("ml_ads_products_cache")
          .select("spend, date")
          .eq("item_id", itemId)
          .in("ml_user_id", mlUserIds)
          .gte("date", from)
          .lte("date", to)
          .range(0, 4999), // PostgREST trunca em 1000 sem range explícito
      ]);

      let totalCacheDaily: AdsSpendDailyRow[] = [];
      if (chaveRes.error) {
        console.warn("ads_cache_daily_totals:", chaveRes.error.message);
      } else {
        totalCacheDaily = ((chaveRes.data ?? []) as LinhaChaveDeRateio[])
          .filter((r) => r?.dia != null)
          .map((r) => ({ date: String(r.dia), spend: Number(r.total_spend ?? 0) || 0 }));
      }

      let itemDaily: AdsSpendDailyRow[] = [];
      if (itemRes.error) {
        console.warn("ml_ads_products_cache (anúncio):", itemRes.error.message);
      } else {
        itemDaily = mapDiario((itemRes.data ?? []) as Array<{ date?: unknown; spend?: unknown }>);
      }

      return ratearAdsDoAnuncio({
        fatura: aggregateAdsBillingSpend(faturaRows),
        itemDaily,
        totalCacheDaily,
      });
    },
    enabled: habilitado,
    staleTime: 30 * 60 * 1000,
  });
}
