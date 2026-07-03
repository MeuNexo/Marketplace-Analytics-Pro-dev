/**
 * Helper puro de classificação de saúde do MCO% (semáforo).
 *
 * Cortes travados por Wesley (Phase 83):
 *   🔴 vermelho: MCO% <= 5
 *   🟡 amarelo:  MCO% > 5 e < 9
 *   🟢 verde:    MCO% >= 9
 *   ⚪ indefinido: custo ausente (pct null/undefined) — NUNCA zerar/inventar número.
 *
 * STUB — RED phase (TDD). Implementação real vem no commit GREEN.
 */

export const MCO_SAUDAVEL_PCT = {
  red: 5,
  green: 9,
} as const;

export type McoHealth = "verde" | "amarelo" | "vermelho" | "indefinido";

export function classifyMcoHealth(_pct: number | null | undefined): McoHealth {
  throw new Error("not implemented");
}

export type McoColorRole = "critical" | "warning" | "good" | "neutral";

export function mcoHealthRole(_health: McoHealth): McoColorRole {
  throw new Error("not implemented");
}
