import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import type { AdsProductStat } from "./useMLAds";
import type { ProductMarginWithAds } from "./useMLMarginWithAds";

export interface EnrichedAdsProduct extends AdsProductStat {
  acos: number | null;
  cvr: number | null;
  /**
   * Gasto DESTE produto sobre a receita TOTAL da loja no período (Fase 213,
   * AV-10). Não é TACoS — TACoS é a métrica GLOBAL (gasto total da loja sobre
   * receita total da loja, no KPI "TACoS Global"). O corte de cor de 8% é a
   * régua do TACoS global e não faz sentido aplicado a um share por item; por
   * isso este campo é exibido sem semáforo.
   */
  spend_share_pct: number | null;
  /** Participação deste produto nos pedidos ATRIBUÍDOS a ads da loja no período. */
  share_ads_pct: number | null;
  /**
   * ACoS de equilíbrio (Fase 213, CR-02): a margem de CONTRIBUIÇÃO pré-ads do
   * anúncio no período — quanto de margem sobra antes da publicidade, depois
   * de CMV, comissão, frete e imposto. Indefinido (nunca 0, nunca um número
   * fictício) quando o anúncio não tem custo cadastrado ou não teve receita
   * no período.
   */
  acos_breakeven: number | null;
  /**
   * ACoS de equilíbrio no cenário SEM REBATE — tarifa cheia (Fase 223,
   * 223-07, fecha a D-218-03). Mesma régua do `acos_breakeven` acima, trocando
   * `lucro_pct` por `lucro_pct_sem_rebate` — a margem de contribuição
   * pré-ads que o anúncio teria se a campanha comercial do ML acabasse hoje.
   *
   * 🔴 Indefinido (nunca 0) em TRÊS situações, e as três precisam continuar
   * indistinguíveis de "não apurado ainda" na tela: sem custo cadastrado
   * (mesma disciplina do `has_cmv` acima — nunca um número inflado por custo
   * zero), sem receita no período, e sem rebate afirmável para nenhum pedido
   * do anúncio (coluna `lucro_pct_sem_rebate` vem `null` da RPC).
   */
  acos_breakeven_sem_rebate: number | null;
  /**
   * ROAS de equilíbrio no cenário REAL — o inverso do `acos_breakeven`
   * (100/ACoS, porque ACoS aqui é percentual 0-100). Indefinido quando
   * `acos_breakeven` é indefinido OU não positivo (ACoS de equilíbrio zero ou
   * negativo não tem ROAS equivalente com sentido de negócio).
   */
  roas_breakeven: number | null;
  /** O mesmo, no cenário SEM REBATE — inverso de `acos_breakeven_sem_rebate`. */
  roas_breakeven_sem_rebate: number | null;
  /**
   * Pedidos do anúncio ainda não consultados na fatura do Mercado Livre — a
   * tela usa esta contagem (e a próxima) para declarar QUAL motivo de
   * ausência mostrar quando `acos_breakeven_sem_rebate` é `null`
   * (`resolveLinhaRebate`, 223-02). `null` quando o anúncio não tem linha de
   * margem (não confundir com zero pedidos fora da conta).
   */
  pedidos_rebate_sem_captura: number | null;
  /** Pedidos do anúncio capturados mas cuja tarifa cobrada não bate com a comissão gravada — erro nosso, causa distinta da anterior. */
  pedidos_rebate_nao_conferido: number | null;
  seller_sku: string | null;
}

export interface AdsGlobalDerived {
  total_revenue: number;
  tacos_global: number | null;
}

/**
 * Métricas derivadas de publicidade, por produto e globais.
 *
 * `marginByItem` é o mapa de margem por `item_id` que a página já tem em mãos
 * via `useMLMarginWithAds` — é dele que sai o breakeven de ACoS (CR-02) e o
 * `seller_sku` (antes lidos de uma tabela de custos própria, agora uma fonte
 * a menos para divergir). Este hook não faz mais leitura própria de custo.
 */
export function useMLAdsDerivedMetrics(
  products: AdsProductStat[],
  totalSpend: number,
  dateFrom: string,
  dateTo: string,
  marginByItem: Map<string, ProductMarginWithAds>,
) {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();

  const { data: dailyCache } = useQuery({
    queryKey: ["ml_ads_daily_rev", currentOrg?.id, resolvedMLUserIds, dateFrom, dateTo] as const,
    queryFn: async () => {
      if (!currentOrg?.id) return { total_revenue: 0, total_orders: 0 };
      const { data } = await supabase
        .from("ml_daily_cache")
        .select("approved_revenue, qty_orders")
        .eq("organization_id", currentOrg.id)
        .in("ml_user_id", resolvedMLUserIds)
        .gte("date", dateFrom)
        .lte("date", dateTo);
      const total_revenue = (data ?? []).reduce((s, r) => s + ((r.approved_revenue as number) ?? 0), 0);
      const total_orders  = (data ?? []).reduce((s, r) => s + ((r.qty_orders as number) ?? 0), 0);
      return { total_revenue, total_orders };
    },
    enabled: !!currentOrg?.id && resolvedMLUserIds.length > 0,
    staleTime: 2 * 60 * 1000,
  });

  const total_revenue = dailyCache?.total_revenue ?? 0;
  const total_orders  = dailyCache?.total_orders ?? 0;

  const enriched: EnrichedAdsProduct[] = products.map((p) => {
    const acos = p.spend > 0 && p.attributed_revenue > 0
      ? Math.round((p.spend / p.attributed_revenue) * 10000) / 100
      : null;
    const cvr = p.clicks > 0
      ? Math.round((p.attributed_orders / p.clicks) * 10000) / 100
      : null;
    const spend_share_pct = p.spend > 0 && total_revenue > 0
      ? Math.round((p.spend / total_revenue) * 10000) / 100
      : null;
    const share_ads_pct = total_orders > 0
      ? Math.round((p.attributed_orders / total_orders) * 10000) / 100
      : null;

    // CR-02: breakeven = margem de contribuição pré-ads (`lucro_pct`), nunca
    // margem bruta. Sem CMV cadastrado o `lucro_pct` da RPC sai inflado
    // (custo entra como zero) — usá-lo trocaria um número errado por outro,
    // então o breakeven fica indefinido. `lucro_pct` já é null quando a
    // receita do período é zero (mesma disciplina do has_cmv).
    const margin = marginByItem.get(p.item_id);
    const seller_sku = margin?.sku ?? null;
    const acos_breakeven = margin?.has_cmv && margin.lucro_pct != null
      ? Math.round(margin.lucro_pct * 100) / 100
      : null;

    // [223-07/D-218-03] O SEGUNDO break-even — tarifa cheia (sem rebate).
    // MESMA régua do de cima, trocando só o termo: `lucro_pct_sem_rebate` em
    // vez de `lucro_pct`. Sem custo cadastrado os DOIS ficam indefinidos —
    // nunca um inflado e o outro não. Sem rebate apurado para o anúncio
    // (`lucro_pct_sem_rebate` null da RPC) só o primeiro existe.
    const acos_breakeven_sem_rebate =
      margin?.has_cmv && margin.lucro_pct_sem_rebate != null
        ? Math.round(margin.lucro_pct_sem_rebate * 100) / 100
        : null;

    // ROAS de equilíbrio = inverso do ACoS de equilíbrio (ACoS aqui é
    // percentual 0-100, então ROAS = 100/ACoS). Indefinido quando o ACoS de
    // equilíbrio correspondente é indefinido OU não positivo — um ACoS de
    // equilíbrio zero ou negativo não tem ROAS equivalente com sentido de
    // negócio (seria zero ou negativo).
    const roas_breakeven =
      acos_breakeven != null && acos_breakeven > 0
        ? Math.round((100 / acos_breakeven) * 100) / 100
        : null;
    const roas_breakeven_sem_rebate =
      acos_breakeven_sem_rebate != null && acos_breakeven_sem_rebate > 0
        ? Math.round((100 / acos_breakeven_sem_rebate) * 100) / 100
        : null;

    const pedidos_rebate_sem_captura = margin?.pedidos_sem_captura_rebate ?? null;
    const pedidos_rebate_nao_conferido = margin?.pedidos_rebate_nao_conferido ?? null;

    return {
      ...p,
      acos,
      cvr,
      spend_share_pct,
      share_ads_pct,
      acos_breakeven,
      acos_breakeven_sem_rebate,
      roas_breakeven,
      roas_breakeven_sem_rebate,
      pedidos_rebate_sem_captura,
      pedidos_rebate_nao_conferido,
      seller_sku,
    };
  });

  const tacos_global = total_revenue > 0 && totalSpend > 0
    ? Math.round((totalSpend / total_revenue) * 10000) / 100
    : null;

  // AV-11: `organic_revenue` (receita aprovada − receita atribuída, grampeada
  // em zero) misturava dois reconhecimentos de receita diferentes (cache de
  // publicidade × pedidos) e não tinha nenhum consumidor (confirmado por
  // grep). Removido do retorno global.
  const global: AdsGlobalDerived = { total_revenue, tacos_global };

  return { enriched, global };
}
