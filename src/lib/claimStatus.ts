// Rótulos e cores de status de reclamação/devolução, robustos ao dado real do ML
// (que usa 'opened' | 'closed' | 'under_review', não os granulares _with_refund).

export interface ClaimStatusConfig {
  label: string;
  tone: string;   // classes de cor (badge)
  isOpen: boolean;
}

const MAP: Record<string, ClaimStatusConfig> = {
  opened:                { label: "Aberta",      tone: "text-red-600 bg-red-500/15 border-red-500/30",         isOpen: true  },
  under_review:          { label: "Em análise",  tone: "text-amber-600 bg-amber-500/15 border-amber-500/30",   isOpen: true  },
  closed:                { label: "Resolvida",   tone: "text-emerald-600 bg-emerald-500/15 border-emerald-500/30", isOpen: false },
  closed_with_refund:    { label: "Resolvida c/ reembolso", tone: "text-emerald-600 bg-emerald-500/15 border-emerald-500/30", isOpen: false },
  closed_without_refund: { label: "Encerrada",   tone: "text-gray-500 bg-gray-500/15 border-gray-500/30",      isOpen: false },
};

const FALLBACK: ClaimStatusConfig = {
  label: "Desconhecido", tone: "text-gray-500 bg-gray-500/15 border-gray-500/30", isOpen: false,
};

export function claimStatusConfig(status: string | null): ClaimStatusConfig {
  if (!status) return FALLBACK;
  return MAP[status] ?? FALLBACK;
}

/** Uma claim está "aberta" (pede ação) se opened/under_review. */
export function isClaimOpen(status: string | null): boolean {
  return claimStatusConfig(status).isOpen;
}

export function claimTipoLabel(tipo: string | null): string {
  if (tipo === "mediations") return "Reclamação";
  if (tipo === "returns") return "Devolução";
  return tipo ?? "—";
}

// ─── Triagem "de quem é a vez" (Phase 90-03) ─────────────────────────────────

export type ClaimBucket = "pende" | "aguardando" | "resolvida";

/**
 * Classifica a claim em um dos 3 buckets de triagem:
 * - "pende": aberta e seller_action_required === true (o vendedor precisa agir).
 * - "aguardando": aberta e seller_action_required !== true (bola com comprador/ML).
 * - "resolvida": status não está aberto (inclui status ausente/desconhecido).
 */
export function claimBucket(row: { status: string | null; seller_action_required?: boolean | null }): ClaimBucket {
  if (!isClaimOpen(row.status)) return "resolvida";
  return row.seller_action_required === true ? "pende" : "aguardando";
}

const PENDING_ACTION_LABELS: Record<string, string> = {
  reply: "Responder",
  return: "Decidir devolução",
  refund: "Decidir reembolso",
  dispute: "Falar com o ML",
};

/** Selo do tipo de pendência (null quando não há pending_action_type reconhecido). */
export function pendingActionLabel(pendingActionType: string | null): string | null {
  if (!pendingActionType) return null;
  return PENDING_ACTION_LABELS[pendingActionType] ?? null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Rótulo de prazo a partir de action_due_date, relativo a `now` (default: agora).
 * null → sem prazo; hoje → "vence hoje"; passado → "atrasada"; futuro → "vence em N dias".
 */
export function dueDateLabel(actionDueDate: string | null, now: Date = new Date()): string | null {
  if (!actionDueDate) return null;
  const due = new Date(actionDueDate);
  if (Number.isNaN(due.getTime())) return null;

  const dueDay = startOfDay(due);
  const nowDay = startOfDay(now);
  const diffDays = Math.round((dueDay.getTime() - nowDay.getTime()) / MS_PER_DAY);

  if (diffDays === 0) return "vence hoje";
  if (diffDays < 0) return "atrasada";
  return `vence em ${diffDays} dias`;
}
