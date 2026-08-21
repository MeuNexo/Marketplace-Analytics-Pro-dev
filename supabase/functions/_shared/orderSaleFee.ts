/**
 * orderSaleFee.ts — o núcleo puro da ingestão de rebate por pedido (Fase
 * 223, plano 223-03).
 *
 * Módulo PURO: nenhum import remoto nem referência ao runtime do Deno, para
 * ser importável tanto pelas edge functions Deno (import relativo, extensão
 * `.ts` explícita) quanto pelo vitest (node) e pelo frontend Vite — mesmo
 * molde de `orderTaxRate.ts`. NÃO faz nenhuma chamada de rede/IO/banco.
 *
 * O DEFEITO QUE ESTE MÓDULO FECHA: o valor do rebate por pedido já passava
 * pela nossa ingestão e foi descartado por 19 meses porque os dois campos
 * óbvios (`discount_info.rebate`, `sales_info[].sale_fee.rebate`) vêm `null`
 * (223-CONTRATO-SALE-FEE.md, Q2). E o endpoint que entrega o campo certo —
 * `/group/ML/order/details` — é o CAMPEÃO de erro 429 no ML, e o bloqueio é
 * POR IP: se a ingestão reconsultar um pedido já capturado, ela derruba
 * `sync-ml-orders`, `sync-ml-billing` e a sincronização de ads junto (D-223-05,
 * ML-BILLING-API-DOC.txt linhas 194-211). Por isso a decisão de "o que gravar"
 * e "o que reconsultar" vive AQUI, num módulo puro e testável sem rede — não
 * espalhada dentro da edge function que faz o fetch.
 *
 * 🔴 A PREMISSA DE RATEIO FOI REFUTADA (223-01, medição em produção): o plano
 * original desta fase supunha que um pedido de carrinho teria N linhas em
 * `orders` para o mesmo `ml_order_id`, exigindo distribuir o rebate entre
 * elas. Medido: `orders` é 1:1 com o pedido do ML — julho/2026 tem 1.136
 * linhas para 1.136 pedidos distintos, zero multilinha, e a tabela não tem
 * coluna de pacote. NÃO existe rateio a fazer. O que existe no lugar é um
 * MULTIPLICADOR: a `quantidade` do pedido.
 *
 * 🔴 BLOCO DE UNIDADE — a armadilha desta fase, declarada em todo lugar que
 * mexe com valor monetário:
 *   · `sale_fee.{gross,net,rebate,discount}` — TOTAL do pedido (raiz do
 *     `results[]`, medido)
 *   · `detail_amount` de cada linha de `details[]` — também TOTAL do pedido
 *     (por linha de cobrança, não por unidade)
 *   · `orders.comissao` — POR UNIDADE (vem de `order_items[].sale_fee` do
 *     endpoint de pedidos, outro endpoint, outra granularidade)
 *   · `orders.receita_bruta` — TOTAL do pedido
 * Misturar as duas bases é exatamente o que produziu o defeito ativo
 * registrado em `223-CONTRATO-SALE-FEE.md`: comissão gravada subestimada em
 * todo pedido de quantidade > 1 (medido: Pé Vermeio R$ 713,41 em 62 pedidos).
 * Esse defeito NÃO se corrige aqui — é `sync-ml-orders`, outra fase. Este
 * módulo só o RESPEITA: toda função que compara `net` com `comissao` recebe a
 * `quantidade` como multiplicador explícito, nunca compara as duas cruas.
 *
 * AS DUAS IDENTIDADES MEDIDAS (7 de 7, ao centavo — 223-CONTRATO-SALE-FEE.md):
 *
 *   (I)  sale_fee.net == Σ detail_amount das linhas CHARGE de subtipo CVV*
 *   (II) sale_fee.net == orders.comissao × orders.quantidade
 *
 * (I) é interna à resposta do ML — prova que lemos as linhas certas, sem
 * tocar em `orders`. (II) é o GATE do critério 3 da fase: autoriza afirmar
 * rebate naquele pedido. Prova mais eloquente de (II): pedido
 * `2000017193192024`, `net` 63,06 contra `orders.comissao` 10,51 × 6 = 63,06
 * — omitir o multiplicador acusaria 62 pedidos bons como divergentes só na
 * Pé Vermeio (223-CONTRATO-SALE-FEE.md).
 *
 * CANCELAMENTO: `BONUS` ESTORNA, E O `sale_fee` NÃO ENXERGA (Q4) — pedido
 * cancelado ganha linhas extras `detail_type: "BONUS"` (`BVVML`/`BVVPRC`) que
 * estornam a cobrança original (mesmo `detail_amount`, `charge_bonified_id`
 * apontando o `detail_id` estornado). O `sale_fee` da raiz NÃO reflete o
 * cancelamento: no pedido `2000017822557678` (cancelado, medido) ele segue
 * dizendo `gross 43,07 · net 21,90 · rebate 21,17`, como se a venda valesse.
 * Este módulo devolve os dois fatos LADO A LADO — `saleFee.rebate` e
 * `temEstorno` — sem deixar um apagar o outro. Somar `BONUS` como comissão
 * zeraria a comissão do período; tratá-la como rebate inventaria promoção
 * onde houve devolução de dinheiro. O predicado que separa os dois vive em
 * `mlOrderSaleFeeContrato.ts` (`ehLinhaDeComissao`, 223-01) — este módulo o
 * usa em vez de reescrevê-lo.
 */

import {
  type LinhaOrderDetail,
  type ResultadoPedidoSaleFee,
  type SaleFee,
  SUBTIPOS_COMISSAO,
} from "./mlOrderSaleFeeContrato.ts";

// ── O teto do lote (D-223-05) ──────────────────────────────────────────────

/**
 * O teto real MEDIDO (260821-hap, D-hap-01) não é o de `order_ids` por
 * chamada (ML-BILLING-API-DOC.txt, linha 199, "no máximo 60") — é o do
 * ENVELOPE da resposta: `limit` fixo de 150 LINHAS DE COBRANÇA, e a
 * paginação é por linha, não por pedido. `limit`/`offset` na query string
 * são IGNORADOS (medido: `limit=1000` volta 150; `offset=150` volta 0) — o
 * único controle que temos é quantos `order_ids` mandamos.
 *
 * Medido, mesma janela de abril/2026 da Pé Vermeio:
 *   · 60 order_ids -> `limit:150 · total:49 · results:49 · linhas:150` —
 *     11 pedidos SUMIRAM da resposta.
 *   · 30 order_ids -> todos os 30 voltaram, 109 linhas.
 *
 * 25, não 30: a amostra de 30 devolveu no máximo 4 linhas por pedido
 * (109/30). O pior caso plausível é 5 linhas (comissão × 3 subtipos + frete
 * + parcelamento): 25 × 5 = 125, com 25 de folga sob o teto de 150. Com 30 o
 * pior caso é 150 — sem folga nenhuma. O custo de errar para baixo é uma
 * chamada a mais; o custo de errar para cima é rebate real descartado como
 * inexistente (foi o que aconteceu: 327 de 1.560 pedidos gravados
 * `sem_linha` estando a API respondendo por eles normalmente).
 *
 * ⚠️ 25 é uma aposta de forma, não um limite garantido — por isso NÃO é a
 * defesa contra truncamento. A defesa é `classificarCaptura` nunca concluir
 * `sem_linha` a partir de um lote com mais de um id (D-hap-02); o teto menor
 * só torna o caso raro. O teto de 60 `order_ids`/chamada da documentação
 * segue valendo — nunca mandar mais que isso, independente deste número.
 */
export const TAMANHO_MAXIMO_LOTE = 25;

/**
 * Quantas vezes reconsultar um pedido que voltou "sem linha de faturamento"
 * antes de desistir. Sem teto, um pedido que o ML nunca vai faturar (ex.:
 * cancelado antes de gerar cobrança) seria reconsultado para sempre — o
 * mesmo risco de bloqueio por IP que a marca de processado existe para
 * evitar.
 */
const TENTATIVAS_MAXIMAS_SEM_LINHA = 3;

/** Intervalo padrão até a próxima tentativa, para os estados que reagendam. */
const INTERVALO_RETENTATIVA_MS = 60 * 60 * 1000; // 1h

// ── A linha de cobrança persistida (details[]) — todas, sem descarte ───────

/**
 * Um item de `details[]` no formato que vai para `ml_order_sale_fee`
 * (223-03, Task 2). TODAS as linhas são persistidas — inclusive frete
 * (`CFFE`), parcelamento (`CFONPN`) e estorno (`BVVML`/`BVVPRC`). Descartar
 * campo do payload foi o defeito de origem desta fase (223-CONTRATO-SALE-FEE.md).
 *
 * `detail_amount` é TOTAL do pedido (por linha de cobrança), nunca por
 * unidade — ver o bloco de unidade no cabeçalho deste arquivo.
 */
export interface LinhaCobrancaPersistivel {
  /** Chave estável da linha — medido presente e único em 25/25 (Q2). */
  detail_id: number;
  /** `item_id` de `items_info[0]`, quando presente. */
  item_id: string | null;
  /** `"CHARGE"` ou `"BONUS"` — nunca outro valor medido. */
  detail_type: string;
  /** Subtipo do lançamento (`CVVML`, `CVVPRC`, `CFFE`, `CFONPN`, `BVVML`, `BVVPRC`, ...). */
  detail_sub_type: string;
  /** TOTAL do pedido, não por unidade. */
  detail_amount: number;
  /** Aponta o `detail_id` da cobrança estornada, só em linhas `BONUS`. */
  charge_bonified_id: number | null;
  charge_status: string | null;
  charge_status_description: string | null;
}

// ── O registro do pedido — sale_fee da raiz + as linhas ────────────────────

/**
 * O registro de UM pedido (`order_id`), agregando o `sale_fee` da RAIZ
 * (Q1: um `results[]` por pedido, `sale_fee` nunca por linha) e as linhas de
 * `details[]` já persistíveis, deduplicadas por `detail_id`.
 */
export interface PedidoSaleFee {
  ml_order_id: string;
  /** `sale_fee` da raiz — os cinco campos, unidade TOTAL do pedido. */
  saleFee: SaleFee;
  /** Todas as linhas do pedido, deduplicadas por `detail_id`. */
  linhas: LinhaCobrancaPersistivel[];
  /**
   * Identidade (I): soma de `detail_amount` das linhas de comissão. TOTAL do
   * pedido. `null` quando o pedido NÃO tem nenhuma linha de comissão — "não
   * confere" (260821-hap, D-hap-04). `0` seria "conferiu e deu zero", um
   * valor medido; `null` nunca é inventado como zero. Mesma distinção que a
   * fase já usa para `sale_fee_rebate` (NULL é "não sei", zero é "não houve
   * campanha").
   */
  comissaoLinhas: number | null;
  /**
   * Verdadeiro quando o pedido tem ao menos uma linha `detail_type: "BONUS"`
   * — estorno por cancelamento (Q4). NUNCA confundir com `saleFee.rebate`:
   * os dois convivem no mesmo pedido, e um não apaga o outro.
   */
  temEstorno: boolean;
}

/** Número finito, ou `null` — nunca propaga `NaN`/`Infinity` (mesma régua de `orderTaxRate.ts`). */
function numeroFinito(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * `sale_fee` como medido na raiz de cada item de `results[]` (Q1). Aceita
 * forma inesperada sem lançar — o payload vem de `JSON.parse` de rede, sem
 * garantia de forma.
 */
function lerSaleFee(raw: unknown): SaleFee {
  if (typeof raw !== "object" || raw === null) {
    return { gross: null, net: null, rebate: null, discount: null, discount_reason: null };
  }
  const r = raw as Record<string, unknown>;
  return {
    gross: numeroFinito(r.gross),
    net: numeroFinito(r.net),
    rebate: numeroFinito(r.rebate),
    discount: numeroFinito(r.discount),
    discount_reason: typeof r.discount_reason === "string" ? r.discount_reason : null,
  };
}

/**
 * Uma linha de `details[]` → `LinhaCobrancaPersistivel`, ou `null` quando a
 * linha não tem o mínimo exigível (`charge_info.detail_id`/`detail_type`/
 * `detail_sub_type`/`detail_amount`). Não filtra por tipo — isso é
 * responsabilidade de quem consome (`somaComissaoDasLinhas`), porque TODA
 * linha é persistida.
 */
function lerLinha(linhaRaw: unknown): LinhaCobrancaPersistivel | null {
  if (typeof linhaRaw !== "object" || linhaRaw === null) return null;

  const chargeInfo = (linhaRaw as { charge_info?: unknown }).charge_info;
  if (typeof chargeInfo !== "object" || chargeInfo === null) return null;

  const ci = chargeInfo as {
    detail_id?: unknown;
    detail_type?: unknown;
    detail_sub_type?: unknown;
    detail_amount?: unknown;
    charge_bonified_id?: unknown;
    status?: unknown;
    status_description?: unknown;
  };

  if (typeof ci.detail_id !== "number") return null;
  if (typeof ci.detail_type !== "string") return null;
  if (typeof ci.detail_sub_type !== "string") return null;
  const detailAmount = numeroFinito(ci.detail_amount);
  if (detailAmount === null) return null;

  const itemsInfo = (linhaRaw as { items_info?: unknown }).items_info;
  let itemId: string | null = null;
  if (Array.isArray(itemsInfo) && itemsInfo.length > 0) {
    const primeiro = itemsInfo[0] as { item_id?: unknown } | undefined;
    if (primeiro && typeof primeiro.item_id === "string") {
      itemId = primeiro.item_id;
    }
  }

  return {
    detail_id: ci.detail_id,
    item_id: itemId,
    detail_type: ci.detail_type,
    detail_sub_type: ci.detail_sub_type,
    detail_amount: detailAmount,
    charge_bonified_id: typeof ci.charge_bonified_id === "number" ? ci.charge_bonified_id : null,
    charge_status: typeof ci.status === "string" ? ci.status : null,
    charge_status_description:
      typeof ci.status_description === "string" ? ci.status_description : null,
  };
}

/**
 * Identidade (I): soma `detail_amount` das linhas de COBRANÇA (`detail_type
 * === "CHARGE"`) cujo subtipo está em `SUBTIPOS_COMISSAO`. Frete (`CFFE`),
 * parcelamento (`CFONPN`) e estorno (`BVVML`/`BVVPRC`, `detail_type ===
 * "BONUS"`) ficam de fora — somar o estorno zeraria a comissão do período
 * (Q4), e frete/parcelamento não são comissão (Q2).
 */
export function somaComissaoDasLinhas(linhas: readonly LinhaCobrancaPersistivel[]): number {
  return linhas
    .filter(
      (l) =>
        l.detail_type === "CHARGE" &&
        (SUBTIPOS_COMISSAO as readonly string[]).includes(l.detail_sub_type),
    )
    .reduce((acc, l) => acc + l.detail_amount, 0);
}

/**
 * Um `results[]` → um registro por `order_id` (Q1: medido um `results[]`
 * por pedido, nunca um por linha de cobrança). `sale_fee` lido da RAIZ,
 * nunca de dentro de `details`/`sales_info`. Deduplica linhas por
 * `detail_id` — linha repetida no payload é contada uma vez só.
 *
 * 🔴 CRITÉRIO DE ENTRADA NO MAPA (260821-hap, D-hap-04 — corrige defeito
 * medido: 2 de 371 pedidos vinham com `sale_fee` completo e ZERO linhas de
 * cobrança, e eram descartados como se não tivessem rebate nenhum): entra
 * quem tem AO MENOS UMA linha de comissão OU cujo `sale_fee` tem os TRÊS
 * campos que autorizam gravar `ok` preenchidos (`gross`, `net`, `rebate` —
 * a mesma exigência da CHECK `ml_order_sale_fee_captura_ok_tem_sale_fee`).
 * A comissão e o rebate vêm do `sale_fee` da RAIZ; a soma das linhas
 * (`comissaoLinhas`) é a Identidade (I), uma CONFERÊNCIA — nunca um gate
 * duro que descarta o pedido.
 *
 * Pedido sem NENHUM dos dois critérios (sem `sale_fee` completo e sem linha
 * de comissão) não autoriza afirmar rebate nenhum, e por isso NÃO entra no
 * mapa devolvido — é o insumo de "sem linha de faturamento" que
 * `classificarCaptura` consome via `idsPresentesNaResposta` (D-hap-02/03):
 * um `order_id` que voltou na resposta mas não está neste mapa é, para quem
 * chama, um pedido sem dado suficiente para afirmar rebate.
 */
export function lerPedidos(results: readonly unknown[]): Map<string, PedidoSaleFee> {
  const mapa = new Map<string, PedidoSaleFee>();

  for (const item of results) {
    if (typeof item !== "object" || item === null) continue;

    const { order_id, sale_fee, details } = item as {
      order_id?: unknown;
      sale_fee?: unknown;
      details?: unknown;
    };
    if (order_id === undefined || order_id === null) continue;

    const mlOrderId = String(order_id);
    const saleFee = lerSaleFee(sale_fee);

    const linhasRaw = Array.isArray(details) ? details : [];
    const vistos = new Set<number>();
    const linhas: LinhaCobrancaPersistivel[] = [];
    let temEstorno = false;

    for (const linhaRaw of linhasRaw) {
      const linha = lerLinha(linhaRaw);
      if (!linha) continue;
      if (vistos.has(linha.detail_id)) continue; // dedup por detail_id
      vistos.add(linha.detail_id);
      linhas.push(linha);
      if (linha.detail_type === "BONUS") temEstorno = true;
    }

    const temLinhaDeComissao = linhas.some(
      (l) =>
        l.detail_type === "CHARGE" &&
        (SUBTIPOS_COMISSAO as readonly string[]).includes(l.detail_sub_type),
    );
    const saleFeeCompleto =
      saleFee.gross !== null && saleFee.net !== null && saleFee.rebate !== null;

    if (!temLinhaDeComissao && !saleFeeCompleto) {
      // Nem linha de comissão nem sale_fee completo — não autoriza afirmar
      // rebate nenhum. Fica de fora do mapa de propósito (ver cabeçalho).
      continue;
    }

    // comissaoLinhas SÓ é somado quando existe linha de comissão — senão
    // fica `null` ("não confere"), nunca `0` inventado (D-hap-04).
    const comissaoLinhas = temLinhaDeComissao ? somaComissaoDasLinhas(linhas) : null;

    mapa.set(mlOrderId, { ml_order_id: mlOrderId, saleFee, linhas, comissaoLinhas, temEstorno });
  }

  return mapa;
}

/** Alias do nome usado no `must_haves.artifacts` do plano — mesma função que `lerPedidos`. */
export const agregarPorPedido = lerPedidos;

// ── Identidade (II) — o gate que autoriza afirmar rebate ───────────────────

export interface ConferenciaComissaoInput {
  /** `sale_fee.net` — TOTAL do pedido. */
  net: number | null;
  /** `orders.comissao` — POR UNIDADE. */
  comissao: number | null;
  /** `orders.quantidade` — o multiplicador que substitui o rateio (223-01). */
  quantidade: number | null;
}

export interface ConferenciaComissaoResultado {
  /** `true` quando `net` bate com `comissao × quantidade` dentro de um centavo. */
  fecha: boolean;
  /** `net − (comissao × quantidade)`, ou `null` quando algum insumo está ausente. */
  diferenca: number | null;
}

const TOLERANCIA_CENTAVO = 0.01;

/**
 * Identidade (II), o GATE do critério 3 da fase: `net` contra `comissao ×
 * quantidade`, NUNCA contra `comissao` sozinha. Omitir o multiplicador
 * acusaria 62 pedidos bons como divergentes só na Pé Vermeio
 * (223-CONTRATO-SALE-FEE.md) — `net` é TOTAL do pedido, `comissao` é POR
 * UNIDADE, e a conta só fecha multiplicando pela quantidade vendida.
 *
 * Ausência de qualquer insumo devolve `fecha: false` com `diferenca: null` —
 * "não sei" nunca é "fecha", e "não sei" nunca é "diferença zero".
 */
export function conferenciaComissao({
  net,
  comissao,
  quantidade,
}: ConferenciaComissaoInput): ConferenciaComissaoResultado {
  if (net === null || comissao === null || quantidade === null) {
    return { fecha: false, diferenca: null };
  }
  const diferenca = net - comissao * quantidade;
  return { fecha: Math.abs(diferenca) <= TOLERANCIA_CENTAVO, diferenca };
}

// ── O lote (D-223-05: nunca mais que 60, nunca repetido) ───────────────────

/**
 * Corta `pendentes` no teto de `TAMANHO_MAXIMO_LOTE` e remove repetição.
 * Devolve lote vazio para entrada vazia.
 */
export function selecionarLote(
  pendentes: readonly string[],
  tamanho: number = TAMANHO_MAXIMO_LOTE,
): string[] {
  const vistos = new Set<string>();
  const lote: string[] = [];
  for (const id of pendentes) {
    if (vistos.has(id)) continue;
    vistos.add(id);
    lote.push(id);
    if (lote.length >= tamanho) break;
  }
  return lote;
}

// ── Truncamento: o que voltou contra o que foi enviado (260821-hap, D-hap-03) ─

/**
 * Todo `order_id` CRU de `results[]`, convertido para string, SEM NENHUM
 * FILTRO de conteúdo — nem de linha de comissão, nem de `sale_fee` completo.
 *
 * Por que existe separada de `lerPedidos`: `lerPedidos` mistura dois fatos
 * diferentes — "o pedido NÃO VOLTOU na resposta" (truncamento; o ML nem
 * chegou a falar dele) e "o pedido VOLTOU mas sem dado suficiente" (não
 * autoriza afirmar rebate, mas o ML RESPONDEU). Misturar os dois foi o
 * defeito de origem: `classificarCaptura` usava só `lidos` para decidir
 * ausência, e um lote truncado (60 ids enviados, resposta cheia em 150
 * linhas devolvendo só 49 pedidos) fazia os 11 que sumiram da resposta
 * parecerem idênticos a "o ML não fatura este pedido" — 327 de 1.560
 * pedidos gravados `sem_linha` sendo que a API os devolve normalmente. Com
 * `idsPresentesNaResposta`, "não voltou" (reconsultar) e "voltou sem dado"
 * (não autoriza, mas confirmado) nunca mais se confundem.
 */
export function idsPresentesNaResposta(results: readonly unknown[]): Set<string> {
  const presentes = new Set<string>();
  for (const item of results) {
    if (typeof item !== "object" || item === null) continue;
    const { order_id } = item as { order_id?: unknown };
    if (order_id === undefined || order_id === null) continue;
    presentes.add(String(order_id));
  }
  return presentes;
}

export interface DetectarTruncamentoInput {
  /** Os `order_id` (como string) enviados nesta chamada. */
  enviados: readonly string[];
  /** Saída de `idsPresentesNaResposta` para a MESMA resposta desta chamada. */
  presentes: ReadonlySet<string>;
}

export interface DetectarTruncamentoResultado {
  /** Verdadeiro quando algum `order_id` enviado não voltou na resposta. */
  truncado: boolean;
  /** Os ausentes, na MESMA ordem em que foram enviados, sem repetição. */
  ausentes: string[];
}

/**
 * Truncamento é `enviados − presentes`, nunca `enviados − chaves de lidos`
 * (D-hap-03) — comparar contra `lidos` confundiria "não voltou" com "voltou
 * sem dado suficiente" (ver `idsPresentesNaResposta`).
 */
export function detectarTruncamento({
  enviados,
  presentes,
}: DetectarTruncamentoInput): DetectarTruncamentoResultado {
  const vistos = new Set<string>();
  const ausentes: string[] = [];
  for (const id of enviados) {
    if (vistos.has(id)) continue;
    vistos.add(id);
    if (!presentes.has(id)) ausentes.push(id);
  }
  return { truncado: ausentes.length > 0, ausentes };
}

// ── A decisão de captura (D-223-05: 206 nunca vira zero) ───────────────────
// ── + D-hap-02 (260821-hap): ausência só conclui a partir de chamada solo ──

/** O que este pedido, dentro deste lote, ficou autorizado a afirmar. */
export type StatusCaptura = "ok" | "parcial" | "sem_linha" | "erro";

export interface ClassificarCapturaInput {
  /** Os `order_id` (como string) que foram enviados nesta chamada. */
  pedidosDoLote: readonly string[];
  /** Saída de `lerPedidos` para a MESMA resposta desta chamada. */
  lidos: ReadonlyMap<string, PedidoSaleFee>;
  /**
   * Saída de `idsPresentesNaResposta` para a MESMA resposta desta chamada —
   * quem voltou, sem filtro de conteúdo (D-hap-02/03). Obrigatório: é o que
   * separa "não voltou" (reconsultar) de "voltou sem dado" (confirmado).
   */
  presentesNaResposta: ReadonlySet<string>;
  /** Código HTTP da resposta do lote inteiro. */
  httpStatus: number;
  /** Relógio injetado — nunca `new Date()` dentro do módulo (pureza). */
  agora: Date;
  /** Tentativas já registradas por `ml_order_id`, antes desta rodada. */
  tentativasAtuais: Readonly<Record<string, number>>;
}

export interface CapturaDecidida {
  ml_order_id: string;
  status: StatusCaptura;
  httpStatus: number;
  /** Tentativas totais, já incluindo esta rodada. */
  tentativas: number;
  /** `null` quando não há por que reconsultar — capturado, ou tentativas esgotadas. */
  proximaTentativa: Date | null;
  /** Só preenchido quando `status === "ok"`. */
  saleFee: SaleFee | null;
  comissaoLinhas: number | null;
  linhas: number;
  temEstorno: boolean;
}

function proximaTentativaPadrao(agora: Date): Date {
  return new Date(agora.getTime() + INTERVALO_RETENTATIVA_MS);
}

/**
 * Decide, para cada pedido do lote, se ele foi CAPTURADO, ficou PARCIAL, não
 * teve linha de faturamento, ou fica pendente de reconsulta — e quando. As
 * regras são o coração de D-223-05 + D-hap-02 (260821-hap):
 *
 *   · 206 (Partial Content) → TODOS os pedidos do lote saem "parcial", com
 *     `saleFee: null` — NUNCA zero. Gravar zero a partir de resposta
 *     incompleta é exatamente o que esta função proíbe.
 *   · Qualquer outro status que não seja 200 (429, 5xx, ...) → lote inteiro
 *     "erro", reagenda, sem gravar valor nenhum.
 *   · 200 e o `id` está em `presentesNaResposta` E em `lidos` → "ok",
 *     capturado, NUNCA reconsultado (`proximaTentativa: null`).
 *   · 200 e o `id` está em `presentesNaResposta` mas NÃO em `lidos` — o ML
 *     RESPONDEU sobre ele, mas sem linha de comissão nem `sale_fee`
 *     completo (D-hap-04) → "sem_linha"; reagenda até
 *     `TENTATIVAS_MAXIMAS_SEM_LINHA`, depois desiste.
 *   · 200 e o `id` NÃO está em `presentesNaResposta` (não voltou na
 *     resposta) — 🔴 O CORAÇÃO DE D-hap-02, o defeito medido: 327 de 1.560
 *     pedidos foram gravados `sem_linha` a partir de um lote truncado (60
 *     ids enviados, resposta cheia em 150 linhas de cobrança, só 49
 *     pedidos voltaram — 11 SUMIRAM, dois com rebate real de R$ 11,85 e
 *     R$ 14,55). Ausência num lote truncado é o SINTOMA do teto de linhas
 *     do envelope, não "o ML não fatura este pedido". Por isso:
 *       - `pedidosDoLote.length === 1` (chamada SOLO, "sozinho" é DERIVADO
 *         do tamanho do lote, nunca informado por quem chama — um parâmetro
 *         booleano separado seria uma segunda fonte de verdade que
 *         poderia mentir) → "sem_linha", ausência CONFIRMADA sozinha.
 *       - `pedidosDoLote.length > 1` → "erro", REAGENDA, NUNCA "sem_linha".
 *         A reconsulta solo que resolve isso vive em `orderSaleFeeLote.ts`
 *         (D-hap-03) — este módulo só recusa concluir a partir de lote.
 */
export function classificarCaptura({
  pedidosDoLote,
  lidos,
  presentesNaResposta,
  httpStatus,
  agora,
  tentativasAtuais,
}: ClassificarCapturaInput): CapturaDecidida[] {
  const tentativasDe = (id: string): number => (tentativasAtuais[id] ?? 0) + 1;

  const semLinha = (id: string): CapturaDecidida => {
    const tentativas = tentativasDe(id);
    const esgotou = tentativas >= TENTATIVAS_MAXIMAS_SEM_LINHA;
    return {
      ml_order_id: id,
      status: "sem_linha",
      httpStatus,
      tentativas,
      proximaTentativa: esgotou ? null : proximaTentativaPadrao(agora),
      saleFee: null,
      comissaoLinhas: null,
      linhas: 0,
      temEstorno: false,
    };
  };

  const erro = (id: string): CapturaDecidida => ({
    ml_order_id: id,
    status: "erro",
    httpStatus,
    tentativas: tentativasDe(id),
    proximaTentativa: proximaTentativaPadrao(agora),
    saleFee: null,
    comissaoLinhas: null,
    linhas: 0,
    temEstorno: false,
  });

  if (httpStatus === 206) {
    return pedidosDoLote.map((id) => ({
      ml_order_id: id,
      status: "parcial",
      httpStatus,
      tentativas: tentativasDe(id),
      proximaTentativa: proximaTentativaPadrao(agora),
      saleFee: null,
      comissaoLinhas: null,
      linhas: 0,
      temEstorno: false,
    }));
  }

  if (httpStatus !== 200) {
    return pedidosDoLote.map((id) => erro(id));
  }

  const chamadaSolo = pedidosDoLote.length === 1;

  return pedidosDoLote.map((id): CapturaDecidida => {
    if (!presentesNaResposta.has(id)) {
      // Ausente da resposta — a decisão depende SÓ do tamanho do lote
      // (D-hap-02), nunca de um sinalizador informado à parte.
      return chamadaSolo ? semLinha(id) : erro(id);
    }

    const pedido = lidos.get(id);
    if (!pedido) {
      // Voltou na resposta (o ML respondeu sobre ele), mas sem linha de
      // comissão nem sale_fee completo — confirmado, não autoriza afirmar
      // rebate (D-hap-04). Diferente do ramo acima: aqui não há truncamento
      // a suspeitar, o ML já falou.
      return semLinha(id);
    }

    return {
      ml_order_id: id,
      status: "ok",
      httpStatus,
      tentativas: tentativasDe(id),
      // Capturado: nunca mais reconsultado (D-223-05).
      proximaTentativa: null,
      saleFee: pedido.saleFee,
      comissaoLinhas: pedido.comissaoLinhas,
      linhas: pedido.linhas.length,
      temEstorno: pedido.temEstorno,
    };
  });
}

export type { LinhaOrderDetail, ResultadoPedidoSaleFee, SaleFee };
