// ============================================================================
// dreRegime — Phase 94 Plan 02, Task 1
//
// Pure regime resolver: derives PREVISÃO vs APURAÇÃO from `dre_month_close`
// presence (a boolean the caller already resolved via useDreMonthClose) and
// picks ONE coherent base — this is the never-mix guardrail (SC3). Médio-CMV
// must never coexist with guia-real tax, and cheio-CMV must never coexist
// with estimated tax (mixing double-counts the ICMS/PIS/COFINS credit).
//
// The M+1 shift itself lives in useImpostoGuiaReal — the RPC
// `get_imposto_guia_by_competence` is called there with `p_competence = M+1`
// of the displayed sale month. This module only consumes the already-shifted
// `guiaReal` totals passed in; it does no date arithmetic for the shift.
//
// The 3-signal empurrãozinho nudge (`shouldNudgeClose`) is a SEPARATE pure
// function fed by a direct RLS `cash_outflows` read in `useImpostoGuiaNudge`
// (the aggregated RPCs return no outflow_date/amount, so they cannot power
// the vencimento≠21 / valor≠anterior signals). It is display-only — it never
// gates `resolveDreRegime` nor calls the close mutation.
//
// `get_dre_operational_by_competence` and `get_cost_waterfall` are NEVER
// modified by this phase (SC6 — zero regression on the other 7 blocos + DFC).
//
// No React/Supabase import — pure module, testable without a DB round-trip.
// ============================================================================

export type DreRegime = "previsao" | "apuracao";

/** The 3 real-tax categories that must all be present for a coherent apuração. */
export const IMPOSTO_VENDA_CATEGORIES = [
  "Imposto Venda - ICMS",
  "Imposto Venda - PIS",
  "Imposto Venda - COFINS",
] as const;

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Maps a "YYYY-MM-01" first-of-month string to the next month's "YYYY-MM-01".
 * Built from numeric year/month parts — NEVER string-concat (Pitfall 3: the
 * Postgres `date` cast / JS Date parsing footgun already documented in
 * useDreOperational.ts applies equally here).
 */
export function monthPlusOne(firstOfMonth: string): string {
  const [yearStr, monthStr] = firstOfMonth.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr); // 1-12
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
}

export interface GuiaRealCategoryTotal {
  category: string;
  total: number;
  status: string;
}

export interface ResolveDreRegimeInput {
  /** True when a dre_month_close row exists for this org+competence_month. */
  isClosed: boolean;
  /** get_cost_waterfall.cmv (médio). */
  cmvMedio: number;
  /** get_cost_waterfall.has_cmv. */
  hasCmv: boolean;
  /** get_cost_waterfall.cmv_cheio. */
  cmvCheio: number;
  /** get_cost_waterfall.has_cmv_cheio. */
  hasCmvCheio: boolean;
  /** get_cost_waterfall.total_tax (estimado). */
  totalTaxEstimado: number;
  /** get_cost_waterfall.has_tax_data. */
  hasTaxData: boolean;
  /**
   * The 3 Imposto Venda category totals from get_imposto_guia_by_competence,
   * ALREADY called at p_competence = M+1 by useImpostoGuiaReal — this module
   * does not shift the month itself. Null/empty when unavailable.
   */
  guiaReal: GuiaRealCategoryTotal[] | null;
}

export interface DreRegimeResult {
  regime: DreRegime;
  /** CMV used for the DRE of this sale-month, per the resolved regime. */
  cmvMes: number | null;
  /** Imposto used for the DRE of this sale-month, per the resolved regime. */
  impostosMes: number | null;
  /** Same as impostosMes when apuração; null when previsão (kept separate so
   *  callers can distinguish "the real guia sum" from "whatever base was used"
   *  without re-deriving regime). */
  apuracaoImpostoReal: number | null;
}

/**
 * Resolves PREVISÃO vs APURAÇÃO and picks ONE coherent (CMV, imposto) base.
 * The two branches share no base variable — médio+guia-real and cheio+estimado
 * are structurally unreachable from this function.
 */
export function resolveDreRegime(input: ResolveDreRegimeInput): DreRegimeResult {
  const {
    isClosed,
    cmvMedio,
    hasCmv,
    cmvCheio,
    hasCmvCheio,
    totalTaxEstimado,
    hasTaxData,
    guiaReal,
  } = input;

  if (!isClosed) {
    // PREVISÃO — reproduces the legacy MercadoLivre.tsx (lines 262-264)
    // expression EXACTLY. Never reads cmvCheio/guiaReal in this branch.
    const cmvMes = (hasCmv ? cmvMedio : null) ?? null;
    const impostosMes = (hasTaxData ? totalTaxEstimado : null) ?? null;
    return { regime: "previsao", cmvMes, impostosMes, apuracaoImpostoReal: null };
  }

  // APURAÇÃO — cmv_cheio + soma das 3 guias reais. Never reads
  // cmvMedio/totalTaxEstimado in this branch.
  // Só linhas 'paid' somam: 'cancelled' é crédito sem guia (dono cancelou a
  // conta no Tiny — não é pagamento) e 'pending' nunca chega aqui com o gate
  // fechado. Mês 100% crédito (todas canceladas) → imposto real = 0, não null.
  const cmvMes = (hasCmvCheio ? cmvCheio : null) ?? null;
  const apuracaoImpostoReal =
    guiaReal && guiaReal.length > 0
      ? round2(
          guiaReal
            .filter((g) => g.status === "paid")
            .reduce((sum, g) => sum + g.total, 0),
        )
      : null;

  return {
    regime: "apuracao",
    cmvMes,
    impostosMes: apuracaoImpostoReal,
    apuracaoImpostoReal,
  };
}

// ── Empurrãozinho (3-signal nudge, LOCKED, display-only) ───────────────────

export interface NudgeRow {
  category: string;
  amount: number;
  status: string;
  /** ISO date string (cash_outflows.outflow_date). */
  outflowDate: string;
  /** First-of-month "YYYY-MM-01" of the row's competence_date. */
  competenceMonth: string;
}

export interface ShouldNudgeCloseInput {
  /** Raw cash_outflows rows across [M, M+2) — see useImpostoGuiaNudge. */
  rows: NudgeRow[];
  /** M+1 first-of-month — the competence the nudge evaluates. */
  targetCompetence: string;
}

/**
 * Display-only hint: "the 3 guias parecem lançadas — fechar mês?"
 *
 * Fires when ALL 3 Imposto Venda categories are present in targetCompetence
 * (M+1) AND at least one of the 3 LOCKED signals holds:
 *   1. vencimento≠21   — a target row whose outflow_date day-of-month !== 21
 *      (the EARLY apuração signal — Wesley moves the vencimento to the real
 *      day AND updates the value BEFORE payment, so status stays 'pending'
 *      until ~day 21; dropping this signal makes the nudge fire too late).
 *   2. status='paid'   — any target row already paid.
 *   3. valor≠anterior  — a target row whose amount differs from the SAME
 *      category's amount in the previous competence (M, the recurring
 *      placeholder row).
 *
 * Pure — no fetch. NEVER gates resolveDreRegime nor calls the close mutation.
 */
export function shouldNudgeClose(input: ShouldNudgeCloseInput): boolean {
  const { rows, targetCompetence } = input;

  const targetRows = rows.filter((r) => r.competenceMonth === targetCompetence);
  // prevRows = rows whose competence, shifted +1 month, equals targetCompetence
  // (i.e. the M competence, the recurring placeholder month).
  const prevRows = rows.filter((r) => monthPlusOne(r.competenceMonth) === targetCompetence);

  const targetCategories = new Set(targetRows.map((r) => r.category));
  const allCategoriesPresent = IMPOSTO_VENDA_CATEGORIES.every((c) =>
    targetCategories.has(c),
  );
  if (!allCategoriesPresent) return false;

  // Signal 1: vencimento ≠ dia 21.
  const hasNonDay21 = targetRows.some((r) => {
    const d = new Date(r.outflowDate);
    return !Number.isNaN(d.getTime()) && d.getUTCDate() !== 21;
  });
  if (hasNonDay21) return true;

  // Signal 2: status='paid'.
  const hasPaid = targetRows.some((r) => r.status === "paid");
  if (hasPaid) return true;

  // Signal 3: valor ≠ mesma categoria no mês anterior (placeholder recorrente).
  const prevAmountByCategory = new Map(prevRows.map((r) => [r.category, r.amount]));
  const hasAmountChanged = targetRows.some((r) => {
    const prevAmount = prevAmountByCategory.get(r.category);
    return prevAmount !== undefined && prevAmount !== r.amount;
  });
  if (hasAmountChanged) return true;

  return false;
}
