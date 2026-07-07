/**
 * Funções puras do sino de atendimento (Phase 91-01) — React-free, testáveis.
 *
 * O badge do sino conta NOVIDADES ainda não vistas (não o total de pendências).
 * A comparação é SEMPRE por `key` estável (`q-{id}` / `c-{id}`), nunca por
 * timestamp — a granularidade de dia de `data_abertura` daria falso-positivo.
 *
 * Nenhum import de React/Supabase/rede: apenas lógica de conjuntos.
 */

/** Shape mínimo de um item de pendência (desacoplado de `PendenciaItem`). */
type KeyedItem = { key: string };

/**
 * Nº de `items` cuja `key` NÃO está em `seenKeys` (= novidades não vistas).
 * Tolera entradas duplicadas em `seenKeys` (usa Set).
 */
export function computeUnread(items: KeyedItem[], seenKeys: readonly string[]): number {
  const seen = new Set(seenKeys);
  return items.filter((i) => !seen.has(i.key)).length;
}

/**
 * Novo conjunto visto ao abrir o sino = merge das keys atuais + prune das keys
 * que não estão mais entre `items`.
 *
 * Invariante: como (a) toda key viva passa a ser vista (merge) e (b) toda key
 * ausente de `items` é removida (prune), o resultado líquido é EXATAMENTE o
 * conjunto de keys vivas dedupadas. Se uma key resolvida reabrir depois (mesma
 * key), como saiu do set, volta a contar como novidade (decisão LOCKED
 * 91-CONTEXT) — nunca "ressuscita" como já-vista.
 */
export function mergeAndPruneSeen(
  _seenKeys: readonly string[],
  items: KeyedItem[],
): string[] {
  return [...new Set(items.map((i) => i.key))];
}

/**
 * Decisão pura de "posso semear agora?": só semeia depois que a query de
 * pendências ficou pronta (`isReady`), evitando semear contra `items=[]` na
 * janela fria em que a query ainda está desabilitada (senão o badge explodiria
 * quando os dados reais chegassem).
 */
export function shouldSeed(
  seen: readonly string[] | null,
  orgId: string | null,
  isReady: boolean,
): boolean {
  return seen === null && !!orgId && isReady;
}
