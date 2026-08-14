/**
 * taxConfigVigente.ts — escolhe QUAL linha de `ml_tax_config` valia na data de
 * um pedido (Fase 222, plano 222-05-R).
 *
 * Módulo PURO, no mesmo molde de `tabelaUf.ts` e `orderTaxRate.ts`: nenhum
 * import remoto, nenhuma referência ao runtime das edge functions, zero IO.
 * Quem lê o banco é a edge function, UMA vez por rodada; este módulo só
 * escolhe, em memória, uma linha da lista já carregada.
 *
 * POR QUE ISTO EXISTE: `ml_tax_config` guardava UMA linha por loja, sem
 * vigência. O que ficava em `orders.tax_rate` era a alíquota que estava na
 * config no dia em que o recálculo passou por aquele pedido — não a que valia
 * na competência dele. Não é hipótese: a config do Junior (loja 2359559427)
 * mudou de 6% para 4% em 11/08/2026 e 352 pedidos de 01 a 10/08 foram
 * REGRAVADOS retroativamente com 4%. `orders.tax_amount` tem de ser
 * reprodutível: recalcular o mesmo pedido daqui a seis meses tem de dar o
 * mesmo número.
 *
 * POR QUE É UM MÓDULO PRÓPRIO, E NÃO CÓDIGO DENTRO DA EDGE FUNCTION: a mesma
 * resolução acontece nas DUAS portas de escrita do imposto (`sync-ml-orders` e
 * `recalc-order-costs`). Copiar a lógica para as duas seria reabrir a lição da
 * Fase 220 — três cópias divergentes da mesma regra fiscal.
 *
 * DIFERENÇA EM RELAÇÃO A `tabelaUf.ts`: lá o SQL (`aliquota_interna_vigente`)
 * já filtra a vigência ANTES de o array chegar, porque a referência de data é
 * a do lote. Aqui a lista chega inteira e a escolha é feita POR PEDIDO — a
 * janela de um recálculo cruza meses, e usar o fim do lote como referência
 * reintroduziria exatamente o bug acima.
 *
 * O QUE ESTE MÓDULO NÃO FAZ: não coage número nenhum e não interpreta campo
 * nenhum da config. `computeOrderTax` já coage os campos numéricos
 * internamente, e repetir a coerção aqui seria uma segunda cópia da mesma
 * regra. Este módulo decide QUAL linha, nunca o que os números dela
 * significam — por isso devolve a própria linha recebida, por referência.
 */

import type { OrderTaxConfig } from "./orderTaxRate";

/**
 * Linha crua de `public.ml_tax_config` como o PostgREST a devolve: a config
 * fiscal que `computeOrderTax` já consome (`OrderTaxConfig`) mais as duas
 * colunas de vigência da migration `20260814201000` e o identificador da loja,
 * usado só para nomear a loja na mensagem de erro de sobreposição.
 *
 * Os três campos são opcionais de propósito: enquanto a migration de vigência
 * não estiver aplicada, a linha chega sem eles, e este módulo tem de preservar
 * byte a byte o comportamento de hoje (uma vigência aberta desde sempre).
 */
export interface LinhaTaxConfigVigencia extends OrderTaxConfig {
  ml_user_id?: unknown;
  /** `date` do Postgres → string `AAAA-MM-DD`. Ausente = aberta desde sempre. */
  vigencia_inicio?: unknown;
  /** `date` do Postgres → string `AAAA-MM-DD`. Ausente/nulo = vigência corrente. */
  vigencia_fim?: unknown;
}

/** Só o formato ano-mês-dia; qualquer outra coisa é ausência, nunca chute. */
const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normaliza um valor de data para a string `AAAA-MM-DD`, ou devolve `null`.
 *
 * Aceita carimbo de hora pelos 10 primeiros caracteres (`orders.data_pedido` é
 * TEXT neste banco e parte do histórico traz hora junto — DEBT-04).
 *
 * Comparação por STRING ISO, nunca por objeto de data: converter para `Date`
 * reintroduz o desvio de fuso que faz um pedido de 30/06 às 22h BRT cair em
 * julho — a fronteira exata que este módulo existe para respeitar.
 */
function normalizarData(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim().substring(0, 10);
  return FORMATO_DATA.test(s) ? s : null;
}

/** `true` quando o valor não foi informado (ausência), distinto de ilegível. */
function ausente(v: unknown): boolean {
  return v == null || String(v).trim() === "";
}

/**
 * Devolve a config que valia em `dataPedido`, ou `null` quando nenhuma linha
 * cobre essa data.
 *
 * - `[]`, `null` ou `undefined` devolvem `null` — a loja não tem config
 *   nenhuma. É o caso que `computeOrderTax` já trata como `sem_config`.
 * - Data ausente ou fora do formato ano-mês-dia devolve `null`: sem saber a
 *   competência, não há vigência a escolher, e escolher a aberta por omissão
 *   é o bug de origem deste plano.
 * - Limites INCLUSIVOS nos dois lados: o pedido do dia 30/06 pertence à
 *   vigência que termina em 30/06, e o do dia 01/07 à que começa em 01/07.
 * - Início ausente é menos-infinito e fim ausente é mais-infinito. Início ou
 *   fim ILEGÍVEL (presente mas fora do formato) descarta A LINHA INTEIRA —
 *   promover lixo a "aberta desde sempre" faria a linha casar com tudo.
 * - Data anterior a toda vigência devolve `null`, JAMAIS a mais antiga por
 *   aproximação: a ausência é nomeada pela edge function, que conta e loga.
 * - Duas ou mais linhas cobrindo a mesma data LANÇAM ERRO. A unicidade é do
 *   banco (restrição de não-sobreposição, migration `20260814203000`); se
 *   chegou sobreposto, algo quebrou antes deste módulo — nunca escolher uma
 *   das duas em silêncio, mesmo espírito da duplicata de `tabelaUf.ts`.
 */
export function resolverConfigVigente(
  configs: LinhaTaxConfigVigencia[] | null | undefined,
  dataPedido: unknown,
): OrderTaxConfig | null {
  if (!configs || configs.length === 0) return null;

  const data = normalizarData(dataPedido);
  if (data === null) return null;

  const cobrem: LinhaTaxConfigVigencia[] = [];
  for (const linha of configs) {
    if (!linha) continue;

    const inicioAusente = ausente(linha.vigencia_inicio);
    const inicio = inicioAusente ? null : normalizarData(linha.vigencia_inicio);
    if (!inicioAusente && inicio === null) continue; // limite ilegível → linha descartada

    const fimAusente = ausente(linha.vigencia_fim);
    const fim = fimAusente ? null : normalizarData(linha.vigencia_fim);
    if (!fimAusente && fim === null) continue; // limite ilegível → linha descartada

    if (inicio !== null && data < inicio) continue;
    if (fim !== null && data > fim) continue;

    cobrem.push(linha);
  }

  if (cobrem.length === 0) return null;
  if (cobrem.length > 1) {
    const loja = String(cobrem[0].ml_user_id ?? "desconhecida");
    throw new Error(
      `resolverConfigVigente: ${cobrem.length} vigências de ml_tax_config cobrem a mesma data na loja ${loja} (data do pedido: ${data}) — a não-sobreposição deveria ser garantida pelo banco`,
    );
  }

  return cobrem[0];
}
