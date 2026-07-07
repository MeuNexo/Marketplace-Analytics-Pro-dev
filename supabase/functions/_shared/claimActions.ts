/**
 * claimActions.ts — derivação compartilhada da triagem "de quem é a vez"
 * (Phase 90 Plan 01, T-90-01).
 *
 * Módulo PURO: nenhum import `https://` nem referência a `Deno.*`, para ser
 * importável tanto pelas edge functions Deno (import relativo) quanto pelo
 * vitest (node). NÃO faz nenhuma chamada de rede/IO.
 *
 * Regra "Pende você" (alinhada ao ML — "Próximas a serem atendidas"):
 * - seller_action_required = existe ao menos uma ação do respondent com
 *   `mandatory=true`, ou seja, uma ação que o ML está COBRANDO do vendedor
 *   (tipicamente com prazo, "resolver até X").
 *   Ações OPCIONAIS (mandatory=false) — refund, open_dispute, allow_return,
 *   allow_partial_refund, ou send_message não-obrigatório — ficam quase sempre
 *   disponíveis como opção do vendedor, mas NÃO significam que a bola está com
 *   ele (o ML as trata como "aguardando comprador"). Por isso NÃO marcam como
 *   pendente — caem em "Aguardando".
 * - pending_action_type: derivado das ações MANDATORY, por prioridade quando
 *   várias se aplicam: 'reply' (mensagem) > 'return' (allow_return)
 *   > 'refund' (refund | allow_partial_refund) > 'dispute' (open_dispute).
 * - action_due_date = due_date da ação mandatory que definiu pending_action_type.
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

function isMandatory(item: RespondentActionItem): boolean {
  return item.mandatory === true;
}

function actionOf(item: RespondentActionItem): string {
  return typeof item.action === "string" ? item.action : "";
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
 * Classifica uma ação (mandatory) no pending_action_type correspondente.
 * Retorna null para ações que não se encaixam nos 4 tipos conhecidos.
 */
function typeOfAction(item: RespondentActionItem): PendingActionType {
  const a = actionOf(item);
  if (a.startsWith(SEND_MESSAGE_PREFIX)) return "reply";
  if (a === "allow_return") return "return";
  if (a === "refund" || a === "allow_partial_refund") return "refund";
  if (a === "open_dispute") return "dispute";
  return null;
}

// Prioridade LOCKED do pending_action_type (menor índice = maior prioridade).
const TYPE_PRIORITY: Record<Exclude<PendingActionType, null>, number> = {
  reply: 0,
  return: 1,
  refund: 2,
  dispute: 3,
};

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

  // "Pende você" = o ML está COBRANDO uma ação do vendedor = há ação mandatory.
  const mandatoryActions = respondentActions.filter(isMandatory);
  const sellerActionRequired = mandatoryActions.length > 0;

  if (!sellerActionRequired) {
    return {
      seller_action_required: false,
      pending_action_type: null,
      action_due_date: null,
      available_actions: respondentActions,
    };
  }

  // Escolhe, entre as ações mandatory, a de maior prioridade (reply > return
  // > refund > dispute). Ações mandatory de tipo desconhecido não definem um
  // tipo, mas ainda marcam seller_action_required=true (fallback due_date da 1ª).
  let chosen: RespondentActionItem | undefined;
  let chosenType: PendingActionType = null;
  for (const item of mandatoryActions) {
    const t = typeOfAction(item);
    if (t === null) continue;
    if (chosenType === null || TYPE_PRIORITY[t] < TYPE_PRIORITY[chosenType]) {
      chosenType = t;
      chosen = item;
    }
  }
  if (!chosen) chosen = mandatoryActions[0]; // só mandatory(s) de tipo desconhecido

  return {
    seller_action_required: true,
    pending_action_type: chosenType,
    action_due_date: chosen ? dueDateOf(chosen) : null,
    available_actions: respondentActions,
  };
}
