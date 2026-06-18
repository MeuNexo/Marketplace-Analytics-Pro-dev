/**
 * Date-range helpers for timestamptz boundary math.
 *
 * PostgREST `.lte("data_pedido", "yyyy-MM-dd")` compares a timestamp against
 * midnight UTC — so all records from that day (which have hours > 00:00) are
 * excluded. Use `.lt("data_pedido", nextDayUTC(to))` to include the full `to`
 * day (equivalent to `data_pedido::date <= to`).
 */

/**
 * Returns the day after `dateStr` (format `yyyy-MM-dd`) in UTC.
 *
 * Example: nextDayUTC("2026-06-17") → "2026-06-18"
 *
 * Same UTC-arithmetic pattern used in MLPedidos.tsx (lines 716-720).
 */
export function nextDayUTC(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
