/**
 * claimActions.ts — derivação compartilhada da triagem "de quem é a vez"
 * (Phase 90 Plan 01, T-90-01).
 *
 * Módulo PURO: nenhum import `https://` nem referência a `Deno.*`, para ser
 * importável tanto pelas edge functions Deno (import relativo) quanto pelo
 * vitest (node). NÃO faz nenhuma chamada de rede/IO.
 *
 * Regra LOCKED "Pende você" (docs/superpowers/specs/2026-07-07-atendimento-reclamacoes-design.md):
 * - seller_action_required = existe ao menos uma ação do respondent que seja:
 *     (a) qualquer send_message_to_* com mandatory=true, OU
 *     (b) qualquer ação de decisão: refund | allow_return | open_dispute | allow_partial_refund.
 *   Um send_message_to_* OPCIONAL (mandatory=false), sozinho, NÃO marca como
 *   pendente — cai em "Aguardando" (comprador/ML).
 * - pending_action_type, por prioridade quando várias se aplicam:
 *     'reply' (mensagem mandatory) > 'return' (allow_return)
 *     > 'refund' (refund | allow_partial_refund) > 'dispute' (open_dispute).
 * - action_due_date = due_date da ação que definiu pending_action_type.
 */

export type PendingActionType = "reply" | "return" | "refund" | "dispute" | null;

export interface DeriveSellerActionResult {
  seller_action_required: boolean;
  pending_action_type: PendingActionType;
  action_due_date: string | null;
  available_actions: unknown[];
}

interface RespondentActionItem {
  action?: unknown;
  mandatory?: unknown;
  due_date?: unknown;
}

// Prefixo das ações de envio de mensagem — send_message_to_complainant,
// send_message_to_mediator, send_message_to_respondent, etc.
const SEND_MESSAGE_PREFIX = "send_message_to_";

// Ações de decisão do vendedor e o pending_action_type que cada uma contribui.
// A ordem aqui NÃO define prioridade — a prioridade final é aplicada
// explicitamente em `resolvePendingType` (reply > return > refund > dispute).
const DECISION_ACTION_TYPE: Record<string, Exclude<PendingActionType, "reply" | null>> = {
  allow_return: "return",
  refund: "refund",
  allow_partial_refund: "refund",
  open_dispute: "dispute",
};

function isMandatorySendMessage(item: RespondentActionItem): boolean {
  return (
    typeof item.action === "string" &&
    item.action.startsWith(SEND_MESSAGE_PREFIX) &&
    item.mandatory === true
  );
}

function isDecisionAction(item: RespondentActionItem): boolean {
  return typeof item.action === "string" && item.action in DECISION_ACTION_TYPE;
}

function dueDateOf(item: RespondentActionItem): string | null {
  return typeof item.due_date === "string" ? item.due_date : null;
}

/**
 * Encontra o player 'respondent' de forma defensiva (guards de array/shape)
 * e retorna seus available_actions como array bruto (itens não tipados).
 */
function findRespondentActions(players: unknown): RespondentActionItem[] {
  if (!Array.isArray(players)) return [];
  const respondent = players.find(
    (p): p is { role: string; available_actions?: unknown } =>
      !!p && typeof p === "object" && (p as Record<string, unknown>).role === "respondent",
  );
  if (!respondent) return [];
  const actions = (respondent as { available_actions?: unknown }).available_actions;
  return Array.isArray(actions) ? (actions as RespondentActionItem[]) : [];
}

/**
 * Deriva seller_action_required / pending_action_type / action_due_date /
 * available_actions a partir do array `players` de um claim detail do ML.
 *
 * @param players - `detail.players` bruto (não tipado — validado defensivamente).
 */
export function deriveSellerAction(players: unknown): DeriveSellerActionResult {
  const respondentActions = findRespondentActions(players);

  if (respondentActions.length === 0) {
    return {
      seller_action_required: false,
      pending_action_type: null,
      action_due_date: null,
      available_actions: [],
    };
  }

  const mandatoryMessage = respondentActions.find(isMandatorySendMessage);
  const allowReturn = respondentActions.find((i) => i.action === "allow_return");
  const refundAction = respondentActions.find(
    (i) => i.action === "refund" || i.action === "allow_partial_refund",
  );
  const openDispute = respondentActions.find((i) => i.action === "open_dispute");

  // Prioridade LOCKED: reply > return > refund > dispute.
  let pendingActionType: PendingActionType = null;
  let dueDateSource: RespondentActionItem | undefined;

  if (mandatoryMessage) {
    pendingActionType = "reply";
    dueDateSource = mandatoryMessage;
  } else if (allowReturn) {
    pendingActionType = "return";
    dueDateSource = allowReturn;
  } else if (refundAction) {
    pendingActionType = "refund";
    dueDateSource = refundAction;
  } else if (openDispute) {
    pendingActionType = "dispute";
    dueDateSource = openDispute;
  }

  const sellerActionRequired =
    !!mandatoryMessage || respondentActions.some(isDecisionAction);

  return {
    seller_action_required: sellerActionRequired,
    pending_action_type: sellerActionRequired ? pendingActionType : null,
    action_due_date: sellerActionRequired && dueDateSource ? dueDateOf(dueDateSource) : null,
    available_actions: respondentActions,
  };
}
