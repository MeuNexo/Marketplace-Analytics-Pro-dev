// ============================================================================
// useFinancialHealth — capacidade de compra client-side via RPCs
// CASH-05
//
// FÓRMULA (fixo — endereça warning do plan-checker):
//   capacidade = (saldo_atual + confirmed_income + sma_23d) − total_expenses − safety_margin
//
// FONTES (todas agregadas server-side — PROIBIDO select direto em cash_*):
//   - saldo_atual        = useProjectedBalance().data.current_balance
//   - confirmed_income   = useProjectedBalance().data.confirmed_income
//   - total_expenses     = useProjectedBalance().data.total_expenses
//   - sma_23d            = (realistic_balance − pessimistic_balance) de useProjectedBalance()
//   - safety_margin      = useFinancialSettings().data.safety_margin
//
// Status: SAFE se capacidade > 0, DANGER se <= 0
//
// PROIBIDO: select direto em cash_inflows / cash_outflows no cliente
//           (risco de truncamento PostgREST em 1000 linhas — feedback_postgrest_pagination)
// ============================================================================

import { useMemo } from "react";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useProjectedBalance } from "@/hooks/useProjectedBalance";
import { useFinancialSettings } from "@/hooks/useFinancialSettings";

export type FinancialStatus = "SAFE" | "DANGER";

export interface FinancialHealthComponentes {
  saldo_atual: number;
  confirmed_income: number;
  sma_23d: number;
  total_expenses: number;
  safety_margin: number;
}

export interface FinancialHealthData {
  /** Capacidade de compra líquida (pode ser negativa em DANGER) */
  capacidade: number;
  status: FinancialStatus;
  message: string;
  componentes: FinancialHealthComponentes;
  isLoading: boolean;
  isError: boolean;
}

export function useFinancialHealth(): FinancialHealthData {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  // Fontes dos componentes: AMBAS vêm de RPCs agregados server-side
  // PROIBIDO fazer select direto em cash_inflows/cash_outflows aqui
  const { data: projected, isLoading: projLoading, isError: projError } = useProjectedBalance();
  const { data: settings,  isLoading: settingsLoading, isError: settingsError } = useFinancialSettings();

  const isLoading = projLoading || settingsLoading || !orgId;
  const isError   = projError || settingsError;

  return useMemo((): FinancialHealthData => {
    if (isLoading || !projected || !settings) {
      return {
        capacidade: 0,
        status:     "SAFE",
        message:    "",
        isLoading,
        isError:    isError as boolean,
        componentes: {
          saldo_atual:     0,
          confirmed_income: 0,
          sma_23d:         0,
          total_expenses:  0,
          safety_margin:   0,
        },
      };
    }

    // Componentes da fórmula — todos vindos de RPCs agregados (sem select direto)
    const saldo_atual      = projected.current_balance;
    const confirmed_income = projected.confirmed_income;
    const total_expenses   = projected.total_expenses;
    const safety_margin    = settings.safety_margin;

    // SMA derivada: diferença entre projeção realista e pessimista do RPC
    // (dias 9-30 = ~23 dias de SMA implícita — mesmo cálculo do nexointeligence)
    const sma_23d = Math.max(0, projected.realistic_balance - projected.pessimistic_balance);

    // Fórmula da capacidade de compra (ponto 2 do objective do plano):
    // capacidade = (saldo_atual + confirmed_income + sma_23d) − total_expenses − safety_margin
    const capacidade = saldo_atual + confirmed_income + sma_23d - total_expenses - safety_margin;

    const status: FinancialStatus = capacidade > 0 ? "SAFE" : "DANGER";

    const fmtBRL = (v: number) =>
      v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

    const message =
      status === "SAFE"
        ? `Você pode investir até ${fmtBRL(capacidade)} em novos produtos nos próximos 30 dias.`
        : "Cuidado! Caixa projetado no limite. Evite novas compras até melhorar a projeção.";

    return {
      capacidade,
      status,
      message,
      isLoading: false,
      isError:   isError as boolean,
      componentes: {
        saldo_atual,
        confirmed_income,
        sma_23d,
        total_expenses,
        safety_margin,
      },
    };
  }, [projected, settings, isLoading, isError]);
}
