/**
 * Helper puro de classificação de saúde do MCO% (semáforo).
 *
 * Cortes travados por Wesley (Phase 83):
 *   🔴 vermelho: MCO% <= 5
 *   🟡 amarelo:  MCO% > 5 e < 9
 *   🟢 verde:    MCO% >= 9
 *   ⚪ indefinido: custo ausente (pct null/undefined) — NUNCA zerar/inventar número.
 *
 * A cor nunca é sinal único: a UI (83-03) sempre renderiza o rótulo % ao lado da
 * bolinha. Este arquivo não conhece hex/CSS — só decide a faixa (McoHealth) e o
 * role semântico (McoColorRole), que a UI mapeia para tokens/paleta CVD-safe.
 */

/** Limiares centralizados do semáforo de MCO%. Fonte única dos cortes. */
export const MCO_SAUDAVEL_PCT = {
  /** MCO% <= este valor → 'vermelho' */
  red: 5,
  /** MCO% >= este valor → 'verde' */
  green: 9,
} as const;

/** Faixa de saúde do MCO% de um anúncio/grupo. */
export type McoHealth = "verde" | "amarelo" | "vermelho" | "indefinido";

/**
 * Classifica um MCO% (pós-ads) na faixa de saúde correspondente.
 *
 * - pct null/undefined (custo ausente) → 'indefinido'
 * - pct <= MCO_SAUDAVEL_PCT.red → 'vermelho'
 * - pct >= MCO_SAUDAVEL_PCT.green → 'verde'
 * - caso contrário → 'amarelo'
 */
export function classifyMcoHealth(pct: number | null | undefined): McoHealth {
  if (pct === null || pct === undefined) return "indefinido";
  if (pct <= MCO_SAUDAVEL_PCT.red) return "vermelho";
  if (pct >= MCO_SAUDAVEL_PCT.green) return "verde";
  return "amarelo";
}

/** Role de cor CVD-safe para a UI mapear em token/hex da paleta de status. */
export type McoColorRole = "critical" | "warning" | "good" | "neutral";

/** Mapeia a faixa de saúde para o role semântico de cor (CVD-safe). */
export function mcoHealthRole(health: McoHealth): McoColorRole {
  switch (health) {
    case "vermelho":
      return "critical";
    case "amarelo":
      return "warning";
    case "verde":
      return "good";
    case "indefinido":
      return "neutral";
  }
}
