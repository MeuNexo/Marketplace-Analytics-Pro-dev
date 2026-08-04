// ============================================================================
// useMLAdsBillingSpend — Fase 210, Plano 01, Task 2
//
// Lê `ml_billing_daily` — a fatura que o Mercado Livre efetivamente cobrou —
// e devolve o gasto de publicidade do período, agregado pelo helper puro
// `aggregateAdsBillingSpend`.
//
// O que conta como publicidade: os dois códigos de `ADS_BILLING_CHARGE_TYPES`
// (`PADS`, cobrança da campanha, e `BPAD`, estorno — já negativo na origem).
// Os códigos NUNCA são redigitados aqui: a constante importada de
// `@/lib/adsBillingSpend` é a fonte única.
//
// Régua de data: filtra por `charge_date`, a data do LANÇAMENTO da cobrança —
// é ela que casa com o dia da venda. O hook irmão `useMLBillingDaily` filtra
// por outra coluna porque serve à DRE por regime de competência; este hook
// deliberadamente NÃO copia aquele filtro.
//
// Por que paginar: o PostgREST trunca a resposta em 1000 linhas em silêncio.
// Sem o laço de `.range()`, o gasto de ads sairia SUBESTIMADO sem nenhum sinal
// de erro — exatamente a classe de defeito que esta fase existe para consertar.
//
// Leitura pura sob a RLS da sessão do usuário: nenhuma escrita, nenhuma Edge
// Function, nenhuma credencial elevada. Os filtros por organização e por loja
// são defesa em profundidade; a RLS da tabela é a fronteira real.
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import {
  ADS_BILLING_CHARGE_TYPES,
  aggregateAdsBillingSpend,
  type AdsBillingChargeRow,
  type AdsBillingSpend,
} from "@/lib/adsBillingSpend";

/**
 * Lê as linhas cruas de publicidade da fatura no intervalo `[from, to]`.
 *
 * Extraída do hook abaixo na fase 211 por UMA razão: o hook do rateio por
 * anúncio (`useAdsRateioAnuncio`) precisa EXATAMENTE desta leitura, e duplicá-la
 * abriria caminho para as duas divergirem — o filtro, a régua de data e a
 * paginação têm de ser os mesmos nos dois lugares. Comportamento inalterado em
 * relação à fase 210.
 */
export async function fetchAdsBillingRows(
  orgId: string,
  mlUserIds: string[],
  from: string,
  to: string,
): Promise<AdsBillingChargeRow[]> {
  interface Row {
    charge_date: string;
    charge_type: string;
    amount: number | string;
  }

  const rows: Row[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("ml_billing_daily")
      .select("charge_date, charge_type, amount")
      .eq("organization_id", orgId)
      .in("ml_user_id", mlUserIds)
      .in("charge_type", [...ADS_BILLING_CHARGE_TYPES])
      .gte("charge_date", from.slice(0, 10))
      .lte("charge_date", to.slice(0, 10))
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as unknown as Row[]));
    if (data.length < PAGE) break;
  }

  return rows as unknown as AdsBillingChargeRow[];
}

/**
 * Gasto de publicidade da fatura no intervalo `[from, to]` (datas YYYY-MM-DD).
 *
 * Devolve SEMPRE um `AdsBillingSpend` quando a query roda — inclusive sem
 * nenhuma linha, e nesse caso com `rowCount: 0`. Não devolver `null` por
 * ausência de linhas é deliberado: `rowCount === 0` é justamente a informação
 * que `resolveAdsSpend` usa para cair no cache em vez de zerar ads.
 * `null` só quando a query nem chega a rodar (sem organização / sem loja).
 */
export function useMLAdsBillingSpend(from: string, to: string) {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<AdsBillingSpend | null>({
    queryKey: ["ml", "ads-billing-spend", orgId, resolvedMLUserIds, from, to],
    queryFn: async (): Promise<AdsBillingSpend | null> => {
      if (!orgId || resolvedMLUserIds.length === 0 || !from || !to) return null;

      const rows = await fetchAdsBillingRows(orgId, resolvedMLUserIds, from, to);

      return aggregateAdsBillingSpend(rows);
    },
    enabled: !!orgId && resolvedMLUserIds.length > 0 && !!from && !!to,
    staleTime: 30 * 60 * 1000,
  });
}
