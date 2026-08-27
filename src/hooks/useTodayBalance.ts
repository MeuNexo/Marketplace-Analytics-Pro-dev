// ============================================================================
// useTodayBalance — saldo do dia via RPC get_daily_balance
// CASH-05 · significado revisto na Fase 233-05
//
// 🔴 `saldo_inicial` MUDOU DE SIGNIFICADO na migration
// `20260827190000_saldo_ancorado_no_dia_declarado.sql`, e o nome do campo não
// mudou junto — por isso está escrito aqui.
//
//   ANTES: `financial_settings.initial_balance` CRU, que é o saldo na data da
//          ÂNCORA (`balance_anchor_date`). Na Pé Vermeio a âncora estava em
//          2026-07-13 e este campo devolvia R$ 37.430,00 enquanto o gráfico de
//          fluxo de caixa abria em R$ 29.301,42. Duas RPCs, a mesma pergunta,
//          R$ 8.128,58 de diferença — e as duas na mesma tela.
//
//   AGORA: a ABERTURA ROLADA em `p_target_date`, o mesmo número que
//          `get_rolled_opening_balance` devolve e pelo qual `get_cashflow` abre.
//
// ⚠️ `saldo_final_previsto` continua sendo outra coisa: a previsão de FECHAMENTO
// do dia (abertura + entradas − saídas). Chamar os dois de "saldo de hoje" foi o
// engano que a página carregava; quem consumir este hook precisa rotulá-los
// separadamente.
//
// 🔵 Este hook é um dos DOIS únicos consumidores de `get_daily_balance` (o outro
// é a tool `get_saldo_diario` do nexo-mcp). Nenhuma função do banco a chama —
// medido em `pg_proc.prosrc` em 27/08/2026.
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { brToday } from "@/lib/brDate";

export interface TodayBalanceData {
  saldo_inicial: number;
  entradas_hoje: number;
  saidas_hoje: number;
  saldo_final_previsto: number;
}

export function useTodayBalance() {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<TodayBalanceData | null>({
    queryKey: ["cashflow", "today_balance", orgId] as const,
    enabled: !!orgId,
    staleTime: 2 * 60 * 1000,
    queryFn: async (): Promise<TodayBalanceData | null> => {
      if (!orgId) return null;

      const today = brToday(); // dia BRT — NÃO usar toISOString (UTC adianta o dia à noite)

      const { data, error } = await supabase.rpc("get_daily_balance", {
        p_org_id:      orgId,
        p_target_date: today,
      });

      if (error) throw error;

      const r = data?.[0];
      if (!r) return null;

      return {
        saldo_inicial:        Number(r.saldo_inicial        ?? 0),
        entradas_hoje:        Number(r.entradas_hoje        ?? 0),
        saidas_hoje:          Number(r.saidas_hoje          ?? 0),
        saldo_final_previsto: Number(r.saldo_final_previsto ?? 0),
      };
    },
  });
}
