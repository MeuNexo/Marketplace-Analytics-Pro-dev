// ─── Types ────────────────────────────────────────────────────────────────────
// Generator functions removed in Phase 42-zero-mock plan 03.
// Type exports retained for consumers (useMLReputation, MLReputacao).

export type ReputationLevel = "green" | "light_green" | "yellow" | "orange" | "red";

export interface ReputationSummary {
  level: ReputationLevel;
  levelLabel: string;
  transactions_completed: number;
  positive_rating: number;
  neutral_rating: number;
  negative_rating: number;
  claims_rate: number;
  delayed_handling_rate: number;
  cancellation_rate: number;
  is_power_seller: boolean;
  response_time_hours: number;
}

export interface FeedbackEntry {
  id: string;
  date: string;
  rating: "positive" | "neutral" | "negative";
  comment: string;
  item_title: string;
  fulfilled_by: "seller" | "mercadolivre";
}

export interface FeedbackDailyStat {
  date: string;
  positive: number;
  neutral: number;
  negative: number;
}
