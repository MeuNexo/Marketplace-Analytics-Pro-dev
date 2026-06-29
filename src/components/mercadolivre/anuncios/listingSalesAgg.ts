/**
 * Utilitário puro de agregação de vendas por dia para o modal de anúncio.
 *
 * Zero dependências de React, Supabase ou rede — 100% testável isoladamente.
 *
 * Decisão travada (Phase 63): `data_pedido` é TEXT no Supabase.
 * A chave do dia é extraída via `slice(0,10)` (porção YYYY-MM-DD),
 * nunca via `new Date(...)` diretamente.
 *
 * Phase: 73-aba-vendas / Plan 01
 */

// ─── Tipos públicos ───────────────────────────────────────────────────────────

/** Linha crua vinda de `orders`, já filtrada por item_id + status='paid'. */
export interface SalesRow {
  data_pedido: string | null;
  quantidade: number;
  receita_bruta: number;
}

/** Um ponto de série temporal diária para o gráfico. */
export interface ListingSalesPoint {
  /** Data do dia em ISO (YYYY-MM-DD). */
  date: string;
  /** Rótulo do eixo X: DD/MM. */
  label: string;
  /** Total de unidades vendidas no dia. */
  unidades: number;
  /** Soma de receita bruta no dia (R$). */
  receita: number;
}

// ─── Constante interna ────────────────────────────────────────────────────────

const DAY_MS = 86_400_000; // 1 dia em milissegundos

// ─── Função principal ─────────────────────────────────────────────────────────

/**
 * Agrega linhas brutas de `orders` em séries diárias para um gráfico.
 *
 * @param rows       - Linhas brutas de `orders` (data_pedido TEXT + quantidade + receita_bruta).
 * @param windowDays - Janela temporal: 30 ou 90 dias.
 * @param today      - Âncora opcional (injetável para testes determinísticos; default = `new Date()`).
 * @returns Array de `windowDays` pontos do dia mais antigo ao mais recente.
 *          Dias sem venda têm unidades=0 e receita=0 (a série não "pula" datas).
 */
export function aggregateListingSales(
  rows: SalesRow[],
  windowDays: 30 | 90,
  today?: Date,
): ListingSalesPoint[] {
  // ── 1. Âncora UTC ─────────────────────────────────────────────────────────
  // Obtemos a string YYYY-MM-DD da âncora em UTC para evitar drift de fuso.
  const anchor = today ?? new Date();
  const anchorStr = anchor.toISOString().slice(0, 10); // "YYYY-MM-DD"
  const [aY, aM, aD] = anchorStr.split("-").map(Number);
  const anchorMs = Date.UTC(aY, aM - 1, aD);

  // ── 2. Acumular somas por chave de dia ────────────────────────────────────
  // Chave = porção YYYY-MM-DD do campo TEXT (Phase 63: nunca new Date() cego).
  const sums = new Map<string, { unidades: number; receita: number }>();

  for (const row of rows) {
    if (!row.data_pedido) continue;
    const key = row.data_pedido.slice(0, 10);
    if (key.length < 10) continue; // guard para strings malformadas

    const acc = sums.get(key);
    if (acc) {
      acc.unidades += row.quantidade;
      acc.receita  += row.receita_bruta;
    } else {
      sums.set(key, { unidades: row.quantidade, receita: row.receita_bruta });
    }
  }

  // ── 3. Gerar janela (do mais antigo ao mais recente) ──────────────────────
  // i = windowDays-1 → dia mais antigo (today - windowDays+1 dias)
  // i = 0            → hoje (anchor)
  const result: ListingSalesPoint[] = [];

  for (let i = windowDays - 1; i >= 0; i--) {
    const dayMs = anchorMs - i * DAY_MS;
    const d     = new Date(dayMs);
    const yyyy  = d.getUTCFullYear();
    const mm    = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd    = String(d.getUTCDate()).padStart(2, "0");
    const date  = `${yyyy}-${mm}-${dd}`;
    const label = `${dd}/${mm}`;
    const sum   = sums.get(date);

    result.push({
      date,
      label,
      unidades: sum?.unidades ?? 0,
      receita:  sum?.receita  ?? 0,
    });
  }

  return result;
}
