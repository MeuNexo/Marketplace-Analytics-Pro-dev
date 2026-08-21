// ============================================================================
// snapshotRows.ts — helper PURO do congelamento diário de previsão de caixa
// (Fase 224 — ERR-02, plano 224-06).
//
// Transforma a saída de public.get_cashflow em linhas prontas para
// cashflow_forecast_snapshot. Sem importação remota, sem referência ao
// runtime de borda, sem cliente de banco — testável em Vitest sem rede,
// exatamente como o cabeçalho do plano exige.
//
// QUATRO FONTES GRAVADAS, na ordem em que a linha de get_cashflow as expõe:
//   mercado_pago       <- daily_income      (agenda do MP, já deflacionada)
//   faturamento_medio  <- daily_projection  (o que a média injeta, D+10+)
//   saida_prevista     <- daily_expense     (contas a pagar em aberto)
//   saldo_projetado    <- accumulated_balance (a linha CONFIRMADA acumulada,
//                          não a "_sma": derivar depois exigiria conhecer o
//                          saldo inicial de então, que o lojista edita à mão)
// meta_deflacionada fica reservada na restrição da tabela — nenhuma fonte
// grava nela hoje.
// ============================================================================

export const FONTES_DE_SNAPSHOT = [
  "mercado_pago",
  "faturamento_medio",
  "saida_prevista",
  "saldo_projetado",
] as const;

export type FonteSnapshot = (typeof FONTES_DE_SNAPSHOT)[number];

/** Linha crua devolvida por public.get_cashflow (RETURNS TABLE). */
export interface LinhaCashflowRpc {
  date: string;
  daily_income?: unknown;
  daily_expense?: unknown;
  daily_projection?: unknown;
  daily_balance?: unknown;
  accumulated_balance?: unknown;
  accumulated_balance_sma?: unknown;
}

export interface LinhaSnapshot {
  organization_id: string;
  snapshot_date: string;
  target_date: string;
  fonte: FonteSnapshot;
  valor_previsto: number;
  deflator: number | null;
}

export interface ResultadoSnapshot {
  linhas: LinhaSnapshot[];
  /** Contagem de valores ausentes/não numéricos na RPC, coagidos para zero. */
  valoresInvalidos: number;
}

const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const CAMPO_POR_FONTE: Record<FonteSnapshot, keyof LinhaCashflowRpc> = {
  mercado_pago: "daily_income",
  faturamento_medio: "daily_projection",
  saida_prevista: "daily_expense",
  saldo_projetado: "accumulated_balance",
};

function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/**
 * montarLinhasDeSnapshot — puro, sem efeitos colaterais. Ver <behavior> do
 * plano 224-06 para a especificação linha a linha.
 */
export function montarLinhasDeSnapshot(
  organizationId: string,
  snapshotDate: string,
  linhasRpc: LinhaCashflowRpc[] | null | undefined,
  deflator: number | null,
): ResultadoSnapshot {
  if (typeof snapshotDate !== "string" || !DATA_REGEX.test(snapshotDate)) {
    throw new Error(
      `montarLinhasDeSnapshot: snapshotDate fora do formato AAAA-MM-DD: "${snapshotDate}"`,
    );
  }

  const linhas: LinhaSnapshot[] = [];
  let valoresInvalidos = 0;

  if (!Array.isArray(linhasRpc)) {
    return { linhas, valoresInvalidos };
  }

  const deflatorFinal = deflator === null || deflator === undefined ? null : deflator;

  for (const row of linhasRpc) {
    const targetDate = row?.date;
    if (typeof targetDate !== "string" || !DATA_REGEX.test(targetDate)) continue;
    // Horizonte negativo violaria cfs_horizonte_nao_negativo — descarta antes.
    if (targetDate < snapshotDate) continue;

    for (const fonte of FONTES_DE_SNAPSHOT) {
      const campo = CAMPO_POR_FONTE[fonte];
      const bruto = row[campo];
      const numero = Number(bruto);
      const valido = bruto !== null && bruto !== undefined && Number.isFinite(numero);
      if (!valido) valoresInvalidos += 1;

      linhas.push({
        organization_id: organizationId,
        snapshot_date: snapshotDate,
        target_date: targetDate,
        fonte,
        valor_previsto: arredondar(valido ? numero : 0),
        deflator: deflatorFinal,
      });
    }
  }

  return { linhas, valoresInvalidos };
}
