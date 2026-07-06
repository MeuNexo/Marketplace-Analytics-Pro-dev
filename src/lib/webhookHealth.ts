export type WebhookHealthState = "active" | "idle" | "waiting";
export interface WebhookHealth { state: WebhookHealthState; label: string; }

const IDLE_MS = 24 * 60 * 60 * 1000;

/**
 * Deriva o estado de saúde do webhook a partir do último evento recebido.
 * - waiting: nunca chegou evento (org recém-conectada / callback não registrado).
 * - active: último evento há < 24h → tempo real funcionando, com "há X".
 * - idle: último evento há ≥ 24h → sem alarme, só sinaliza silêncio.
 */
export function formatWebhookHealth(lastEventIso: string | null, nowMs: number): WebhookHealth {
  if (!lastEventIso) return { state: "waiting", label: "Aguardando eventos" };
  const diff = nowMs - new Date(lastEventIso).getTime();
  if (diff >= IDLE_MS) return { state: "idle", label: "Sem eventos recentes" };
  let ago: string;
  if (diff < 60_000)           ago = `há ${Math.max(1, Math.floor(diff / 1000))}s`;
  else if (diff < 60 * 60_000) ago = `há ${Math.floor(diff / 60_000)}min`;
  else                         ago = `há ${Math.floor(diff / (60 * 60_000))}h`;
  return { state: "active", label: `Tempo real ativo · ${ago}` };
}
