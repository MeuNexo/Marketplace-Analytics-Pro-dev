// aggregate.ts — core PURO de agregação de movimentos de billing por competência.
//
// Módulo sem I/O (sem fetch, sem imports Deno/URL): testável no vitest (Node)
// apesar de a EF (`index.ts`) rodar em Deno. Mesmo padrão de extração usado em
// `nexo-chat/prompt.ts` e `nexo-chat/tools.ts` — index.ts importa deste arquivo,
// e o teste importa DESTE arquivo (nunca de index.ts, que tem imports
// `https://deno.land/...` inválidos para o resolvedor de módulos do Node/Vite).
//
// Regime de competência (Phase 84): cada movimento é alocado pela COMPETÊNCIA
// DA VENDA (`competence_date = saleDate ?? charge_date`), não mais só pela data
// de lançamento na fatura. A exclusão `within` (janela da fatura) é REMOVIDA
// nesta trilha — estornos (BONUS) de vendas fora da janela agora contam,
// sempre com sinal negativo.

export interface RawMove {
  detailId: number;
  date: string; // charge_date (data de lançamento na fatura)
  type: string;
  label: string;
  amount: number;
  isBonus: boolean;
  saleDate: string | null; // competência da venda (sales_info[0].sale_date_time), quando existe
}

export interface AggregatedRow {
  competence_date: string;
  charge_date: string;
  charge_type: string;
  charge_label: string;
  amount: number;
}

/**
 * Agrega movimentos ML+MP por (competence_date, charge_date, charge_type).
 * - Não-bonus: sinal positivo (+amount).
 * - Bonus (estorno): sinal SEMPRE negativo (-amount) — sem exclusão por janela.
 * - competence_date = m.saleDate ?? m.date (fallback para charge_date quando
 *   não há venda associada, ex.: PADS/mensalidade).
 * - Movimento sem date ou sem type é ignorado (guard pré-existente).
 * - Arredondamento final: Math.round(amount*100)/100.
 */
export function aggregateMoves(moves: RawMove[]): AggregatedRow[] {
  const agg = new Map<string, AggregatedRow>();
  for (const m of moves) {
    if (!m.date || !m.type) continue;
    const competence = m.saleDate ?? m.date;
    const signed = m.isBonus ? -m.amount : m.amount;
    const k = `${competence}|${m.date}|${m.type}`;
    const cur = agg.get(k);
    if (cur) cur.amount += signed;
    else agg.set(k, { competence_date: competence, charge_date: m.date, charge_type: m.type, charge_label: m.label, amount: signed });
  }
  return [...agg.values()].map((r) => ({ ...r, amount: Math.round(r.amount * 100) / 100 }));
}
