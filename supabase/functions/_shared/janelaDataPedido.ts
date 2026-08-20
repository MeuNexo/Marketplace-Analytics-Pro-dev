/**
 * janelaDataPedido.ts — o recorte de janela sobre `orders.data_pedido`
 * (Quick 260820-jic, D-jic-01).
 *
 * Módulo PURO, no mesmo molde de `flexOrder.ts` e `orderTaxRate.ts`: NENHUM
 * import, nenhuma referência ao runtime das edge functions, zero IO —
 * importável tanto pelo Deno das edge functions quanto pelo vitest (node).
 *
 * ── POR QUE ESTE MÓDULO EXISTE ──────────────────────────────────────────────
 *
 * `recalc-order-costs` MENTIA com janela de um dia. Medido em produção em
 * 20/08: `date_from = date_to = '2026-02-10'` devolvia
 * `success: true, scanned: 0`; passando o dia seguinte como fim, a MESMA
 * chamada varria 59 pedidos. É a assinatura dos backfills silenciosos que já
 * custaram caro nesta casa (28% na 222-05-R, 32,9% na 96-07) — sucesso
 * declarado sobre trabalho que não foi feito. E já atingia o Wesley na tela: o
 * botão de recalcular do `/pedidos` e o `useAutoRecalc` passam `date_from` e
 * `date_to` do seletor, e um dia só selecionado recalculava zero pedidos.
 *
 * `orders.data_pedido` é TEXT neste banco (DEBT-04,
 * `feedback_garment_orders_date_perf`) e os valores trazem carimbo de hora:
 * `'2026-02-10 00:00:00+00'`. O limite INFERIOR funciona por acidente feliz da
 * comparação de string — prefixo igual, string mais longa é maior, então
 * `'2026-02-10 00:00:00+00' >= '2026-02-10'` é verdadeiro. O superior morria
 * pelo MESMO mecanismo: `'2026-02-10 00:00:00+00' <= '2026-02-10'` é FALSO.
 *
 * ── POR QUE A COMPARAÇÃO CONTINUA SENDO POR STRING ──────────────────────────
 *
 * Duas saídas mais óbvias foram rejeitadas, cada uma por um motivo próprio:
 *
 * 1. `left(data_pedido, 10)`. O PostgREST não filtra por expressão (exigiria
 *    coluna gerada + migration, e migration nesta fase é portão humano), e —
 *    mais caro — expressão no lado esquerdo CEGA qualquer índice sobre a
 *    coluna. Trocar um predicado de FAIXA (que um btree serve) por um
 *    predicado de FUNÇÃO é piorar a única coisa que ainda funciona numa coluna
 *    que já é dívida de performance conhecida.
 *
 * 2. Converter para `Date` e comparar objetos. `taxConfigVigente.ts` já
 *    documenta por que, palavra por palavra: converter para `Date` reintroduz
 *    o desvio de fuso que faz o pedido de 30/06 às 22h BRT cair em julho. Não
 *    se reintroduz na janela o erro que a resolução por competência existe
 *    para evitar.
 *
 * A saída adotada é o limite superior EXCLUSIVO no dia seguinte, ainda por
 * string: `'2026-02-10 00:00:00+00' < '2026-02-11'` é verdadeiro, e
 * `'2026-02-11'` exato é excluído — que é o correto. Continua sendo um
 * predicado de faixa sobre a coluna crua, com o índice intacto.
 *
 * E isso não é fé: nos dois formatos que o histórico tem
 * (`'2026-02-10 00:00:00+00'` e `'2026-02-10T00:00:00+00:00'`) a diferença
 * contra `'2026-02-11'` decide na posição 9 — o dígito do dia — ANTES de
 * qualquer separador. Vale em collation `C` e em `en_US.UTF-8`. O limite
 * inferior já depende exatamente desse mecanismo hoje, em produção, com
 * resultado medido.
 *
 * ── O QUE ESTE MÓDULO NÃO FAZ ───────────────────────────────────────────────
 *
 * Não muda a semântica de FUSO da janela. O recorte continua por prefixo UTC,
 * exatamente como o limite inferior sempre fez — um pedido de 30/06 22h BRT
 * (01/07 01h UTC) continua caindo em julho. Mudar isso moveria pedidos entre
 * janelas e alteraria quais linhas são recalculadas: é dívida declarada
 * (DEBT-04), não escopo deste quick.
 *
 * ── NOTA SOBRE A DUPLICAÇÃO DA NORMALIZAÇÃO ─────────────────────────────────
 *
 * `normalizarDia` abaixo tem o mesmo desenho de `normalizarData` em
 * `taxConfigVigente.ts`. Aquela função é PRIVADA ao módulo dela e não é
 * reexportada; importar um módulo fiscal inteiro só para reaproveitar três
 * linhas de normalização acoplaria a janela à régua de imposto. Duplicar é o
 * preço menor, e fica declarado aqui em vez de acontecer em silêncio.
 */

/** Só o formato ano-mês-dia; qualquer outra coisa é ausência, nunca chute. */
const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normaliza um valor para o dia `AAAA-MM-DD`, ou devolve `null`.
 *
 * Aceita carimbo de hora pelos 10 primeiros caracteres — os chamadores de hoje
 * já fatiam (`useAutoRecalc.ts`), mas isso é convenção do chamador, não
 * garantia da função. Um `'2026-02-10T00:00:00Z'` chegando como `date_from`
 * faria o `>=` excluir `'2026-02-10 00:00:00+00'` (o `T` ordena depois do
 * espaço) e a janela perderia o dia inteiro em silêncio.
 *
 * A validação vai além do formato: a data tem de existir no calendário. O
 * teste de ida e volta pelo `Date` derruba `'2026-02-31'`, que casa com o
 * formato e que o motor promoveria a 03/03 sem avisar.
 */
function normalizarDia(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim().substring(0, 10);
  if (!FORMATO_DATA.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10) === s ? s : null;
}

/**
 * Limite INFERIOR da janela, inclusivo: o próprio dia, normalizado.
 * `null` quando o valor é ilegível — e ilegível TEM de virar 400 na edge
 * function, nunca uma janela vazia com `success: true`.
 */
export function inicioInclusivoDataPedido(v: unknown): string | null {
  return normalizarDia(v);
}

/**
 * Limite SUPERIOR da janela, EXCLUSIVO: o dia seguinte.
 *
 * Aritmética UTC pura (`setUTCDate(getUTCDate() + 1)`), nunca `Date` local —
 * vira de mês, vira de ano e fevereiro saem de graça, sem tabela de dias e sem
 * o desvio de fuso. `null` quando o valor é ilegível.
 */
export function fimExclusivoDataPedido(v: unknown): string | null {
  const s = normalizarDia(v);
  if (s === null) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Espelho EXATO do que o filtro do banco faz: compara a string CRUA de
 * `data_pedido` contra o início inclusivo e o fim exclusivo.
 *
 * Existe para que a fronteira seja testável em unidade, sem banco — o defeito
 * de origem só era visível chamando a função em produção. Limite ilegível em
 * qualquer extremo devolve `false` (a janela não pode ser construída), e
 * janela invertida devolve `false` para tudo, sem lançar: quem decide o que
 * fazer com isso é a edge function.
 */
export function dentroDaJanelaDataPedido(
  dataPedido: unknown,
  dateFrom: unknown,
  dateTo: unknown,
): boolean {
  const inicio = inicioInclusivoDataPedido(dateFrom);
  const fim = fimExclusivoDataPedido(dateTo);
  if (inicio === null || fim === null) return false;
  if (dataPedido == null) return false;
  const s = String(dataPedido);
  if (s === "") return false;
  return s >= inicio && s < fim;
}
