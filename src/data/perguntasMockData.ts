// ─── Types ────────────────────────────────────────────────────────────────────
// Generator functions removed in Phase 42-zero-mock plan 03.
// Type exports retained for reference; main consumers now use useMLQuestions hook.

export interface PerguntasSummary {
  total_30d: number;
  pending: number;
  answered: number;
  answer_rate: number;
  avg_response_hours: number;
  unanswered_gt_24h: number;
}

export interface PerguntaEntry {
  id: string;
  date: string;
  item_title: string;
  item_id: string;
  question: string;
  answer: string | null;
  status: "answered" | "unanswered";
  hours_to_answer: number | null;
}

export interface PerguntasDailyStat {
  date: string;
  total: number;
  answered: number;
}
