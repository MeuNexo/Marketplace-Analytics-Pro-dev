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
  /** Primeiro dia (fullDate) em que o saldo cruza ABAIXO da margem; null se nunca. */
  criticalDate: string | null;
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
  base: SimBasePoint[],
  params: SimParams
): { series: SimPoint[]; verdict: SimVerdict } {
  const { recebExtra, gastoExtra, eventos, margem } = params;
  const ativa = recebExtra !== 0 || gastoExtra !== 0 || eventos.length > 0;

  // Edge §7: baseline vazio → série vazia + veredito neutro (não lança).
  if (base.length === 0) {
    return {
      series: [],
      verdict: {
        menorSaldo: 0,
        valeIdx: 0,
        diasAteVale: 1,
        valeDate: "",
        criticalDate: null,
        status: 0 >= margem ? "saudavel" : "risco",
        folgaGastoDia: 0,
        necessidadeReceitaDia: 0,
        ativa,
      },
    };
  }

  // Série simulada ponto a ponto (spec §5).
  const series: SimPoint[] = base.map((ponto, i) => {
    const diasDecorridos = i + 1;
    const deltaMediaAcum = (recebExtra - gastoExtra) * diasDecorridos;
    // Datas yyyy-MM-dd: comparação lexicográfica == cronológica.
    const eventosAcum = eventos.reduce((acc, ev) => {
      if (ev.data <= ponto.fullDate) {
        return acc + (ev.tipo === "entrada" ? ev.valor : -ev.valor);
      }
      return acc;
    }, 0);
    return {
      fullDate: ponto.fullDate,
      cenario: ponto.accumulated_balance_sma + deltaMediaAcum + eventosAcum,
    };
  });

  // Veredito: menor saldo (argmin = ponto mais fundo) + primeiro cruzamento da
  // margem (criticalDate = quando o caixa FICA abaixo da margem pela 1ª vez).
  // São coisas diferentes: o vale pode ser muito depois do 1º cruzamento.
  let valeIdx = 0;
  let menorSaldo = series[0].cenario;
  let criticalDate: string | null = null;
  for (let i = 0; i < series.length; i++) {
    if (series[i].cenario < menorSaldo || i === 0) {
      menorSaldo = series[i].cenario;
      valeIdx = i;
    }
    if (criticalDate === null && series[i].cenario < margem) {
      criticalDate = series[i].fullDate;
    }
  }

  const diasAteVale = valeIdx + 1; // sempre >= 1 → sem divisão por zero (edge §7)
  const valeDate = base[valeIdx].fullDate;
  const status: "saudavel" | "risco" = menorSaldo >= margem ? "saudavel" : "risco";
  const folgaGastoDia = Math.max(0, (menorSaldo - margem) / diasAteVale);
  const necessidadeReceitaDia = Math.max(0, (margem - menorSaldo) / diasAteVale);

  return {
    series,
    verdict: {
      menorSaldo,
      valeIdx,
      diasAteVale,
      valeDate,
      criticalDate,
      status,
      folgaGastoDia,
      necessidadeReceitaDia,
      ativa,
    },
  };
}
