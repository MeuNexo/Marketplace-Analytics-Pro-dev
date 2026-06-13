// ─── Types ────────────────────────────────────────────────────────────────────
// Generator functions removed in Phase 42-zero-mock plan 03.
// Type exports retained for reference; main consumers now use useMLClaims hook.

export type ClaimStatus = "opened" | "under_review" | "closed_with_refund" | "closed_without_refund";
export type ClaimReason =
  | "not_received"
  | "item_damaged"
  | "item_different"
  | "does_not_work"
  | "incomplete_package"
  | "regret";

export interface DevolucoeSummary {
  total_claims: number;
  open_claims: number;
  resolved_claims: number;
  resolution_rate: number;
  avg_resolution_days: number;
  pending_returns: number;
  claims_rate_pct: number;
}

export interface ClaimEntry {
  id: string;
  date: string;
  status: ClaimStatus;
  reason: ClaimReason;
  reason_label: string;
  item_title: string;
  amount: number;
  resolution_days: number | null;
}

export interface DevolucoesDailyStat {
  date: string;
  opened: number;
  resolved: number;
}
