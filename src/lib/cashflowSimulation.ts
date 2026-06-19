// ============================================================================
// cashflowSimulation — núcleo puro do Simulador de Cenários ("E se...?")
// Sem React, sem Supabase. Toda a matemática do SIM-01 vive aqui.
// Spec: docs/superpowers/specs/2026-06-19-simulador-fluxo-caixa-design.md §5
// ============================================================================

import type { CashFlowDataPoint } from "@/hooks/useCashFlowData";

export type SimEventType = "entrada" | "saida";

export interface SimEvent {
  /** Valor do evento em R$ (sempre positivo; o tipo define o sinal) */
  valor: number;
  /** Data do evento no formato yyyy-MM-dd */
  data: string;
  tipo: SimEventType;
}

export interface SimParams {
  /** Recebimento extra médio por dia (R$/dia, pode ser negativo) */
  recebExtra: number;
  /** Gasto extra médio por dia (R$/dia, >= 0) */
  gastoExtra: number;
  /** Eventos pontuais (0 a 2) */
  eventos: SimEvent[];
  /** Margem de segurança (R$) — financial_settings.safety_margin */
  margem: number;
}

export interface SimPoint {
  fullDate: string;
  /** Saldo simulado acumulado do dia */
  cenario: number;
}

export interface SimVerdict {
  menorSaldo: number;
  valeIdx: number;
  diasAteVale: number;
  valeDate: string;
  status: "saudavel" | "risco";
  folgaGastoDia: number;
  necessidadeReceitaDia: number;
  ativa: boolean;
}

/** Entrada mínima exigida do baseline (campos usados do CashFlowDataPoint). */
export type SimBasePoint = Pick<
  CashFlowDataPoint,
  "fullDate" | "accumulated_balance_sma"
>;

/**
 * Calcula a série simulada ponto a ponto + o veredito a partir do baseline
 * projetado e dos parâmetros de simulação. Função pura e determinística.
 */
export function simulateCashflow(
  _base: SimBasePoint[],
  _params: SimParams
): { series: SimPoint[]; verdict: SimVerdict } {
  // Stub (RED): implementação real na Task 2.
  throw new Error("simulateCashflow not implemented yet");
}
