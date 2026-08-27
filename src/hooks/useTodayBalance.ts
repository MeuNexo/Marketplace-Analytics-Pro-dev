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
//
// ============================================================================
// 🔴 233-06 — O SALDO DE AGORA VEM DO BANCO, E É DE PROPÓSITO
//
// `saldo_agora` = abertura + o que JÁ LIQUIDOU hoje (`approved` + `refunded`
// nas entradas, `paid` nas saídas). É o número que o Wesley lê no extrato e o
// que ele declara (D-10) — e ele é calculado no BANCO, não aqui.
//
// O motivo é o 233-03: somar no front cria uma SEGUNDA implementação da
// classificação por estado, e a classificação é usada nas DUAS direções — para
// decompor o declarado até a abertura e para recompor a abertura até o saldo de
// agora. Duas implementações da mesma regra divergem, e a divergência aparece
// como número errado na tela, não como erro. Há um portão varrendo por isso
// (`src/pages/mercadolivre/__tests__/saldoAncorado.test.ts`).
//
// ⚠️ TRÊS NÚMEROS, TRÊS PERGUNTAS, e chamar dois deles de "saldo de hoje" foi o
// engano que a página carregava:
//   `saldo_inicial`        — a ABERTURA. É por ela que o GRÁFICO começa.
//   `saldo_agora`          — o saldo NESTE INSTANTE. É o número grande do card.
//   `saldo_final_previsto` — o FECHAMENTO previsto do dia.
//
// 🔴 `saidas_hoje` EXCLUI as canceladas desde o 233-06 (D-12): cancelada não é
// "adiada", é "não vai sair nunca". O valor excluído vem em `saidas_canceladas`.
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
  /** 🔵 Vem do banco. Nunca composto aqui — ver o cabeçalho. */
  saldo_agora: number;
  entradas_liquidadas: number;
  saidas_pagas: number;
  /** O que o dia ainda pode receber e ainda não recebeu (`in_mediation`). */
  entradas_pendentes: number;
  /** Fora da previsão de fechamento desde o 233-06 (D-12), mas visível. */
  saidas_canceladas: number;
  /**
   * 🔴 Estado que não bate nenhum da allowlist. Existe para APARECER: um estado
   * novo do Mercado Pago não pode ser absorvido em silêncio por um agregado.
   */
  entradas_estado_desconhecido: number;
  saidas_estado_desconhecido: number;
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

        // 233-06 — as parcelas de liquidação, lidas por NOME (coluna nova não
        // quebra consumidor que lê por nome; foi por isso que a assinatura pôde
        // crescer no fim em vez de mudar de posição).
        saldo_agora:                  Number(r.saldo_agora                  ?? 0),
        entradas_liquidadas:          Number(r.entradas_liquidadas          ?? 0),
        saidas_pagas:                 Number(r.saidas_pagas                 ?? 0),
        entradas_pendentes:           Number(r.entradas_pendentes           ?? 0),
        saidas_canceladas:            Number(r.saidas_canceladas            ?? 0),
        entradas_estado_desconhecido: Number(r.entradas_estado_desconhecido ?? 0),
        saidas_estado_desconhecido:   Number(r.saidas_estado_desconhecido   ?? 0),
      };
    },
  });
}
