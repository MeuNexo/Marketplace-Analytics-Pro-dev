// ============================================================================
// brDate — datas no fuso de São Paulo (BRT, UTC−3), robustas ao fuso do browser.
// Motivo: `new Date().toISOString()` retorna UTC; à noite no Brasil o dia UTC já
// virou, fazendo o caixa "pular" para amanhã. Aqui o "hoje" é SEMPRE o dia BRT.
// ============================================================================

/** Data de hoje em America/Sao_Paulo, formato yyyy-MM-dd. */
export function brToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** brToday() + `days` dias, formato yyyy-MM-dd (meio-dia UTC evita virar o dia). */
export function brTodayPlus(days: number): string {
  const base = new Date(`${brToday()}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().substring(0, 10);
}

/** yyyy-MM-dd → Date local (meio-dia, sem deslocamento de dia por fuso). */
export function ymdToLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.substring(0, 10).split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}
