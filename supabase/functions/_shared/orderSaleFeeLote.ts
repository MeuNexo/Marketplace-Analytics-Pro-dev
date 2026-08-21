/**
 * orderSaleFeeLote.ts — resolução de UM LOTE com truncamento (Fase 223,
 * quick 260821-hap, Task 2).
 *
 * Módulo PURO: nenhum import remoto nem referência ao runtime do Deno,
 * mesmo molde de `orderSaleFee.ts` — importável tanto por Deno (import
 * relativo, extensão `.ts` explícita) quanto por vitest (node). NÃO faz
 * nenhuma chamada de rede/IO/banco: recebe `chamar` e `pausar` INJETADOS.
 *
 * O DEFEITO QUE ESTE MÓDULO FECHA (medido em produção, 21/08):
 * `/group/ML/order/details` pagina por LINHA DE COBRANÇA, teto fixo de 150
 * no envelope da resposta — não por pedido. 60 `order_ids` enviados →
 * `limit:150 · total:49 · results:49 · linhas:150`: 11 pedidos SUMIRAM da
 * resposta. Consequência gravada: 327 de 1.560 pedidos (21%) foram
 * concluídos `sem_linha` a partir dessa ausência — dois deles com rebate
 * real de R$ 11,85 e R$ 14,55, descartado como se não existisse.
 *
 * A PROVA PRECISA SER COMPORTAMENTAL, NÃO AUDITORIA DE TEXTO: o fonte da
 * edge function `sync-ml-order-sale-fee/index.ts` importa módulos remotos
 * (`https://deno.land/...`, `https://esm.sh/...`) que o vitest não resolve
 * — por isso a única prova que a 223-04 conseguiu foi ler o fonte como
 * texto. Auditoria de texto NÃO pega este defeito: o fonte "parecia certo"
 * (`classificarCaptura` documentado, testado, com CHECK no banco), a REGRA
 * é que estava errada. Este módulo, puro e testável com uma chamada falsa
 * injetada, é o que torna o truncamento provável por comportamento.
 *
 * O ALGORITMO (D-hap-03, sete passos):
 *   1. chama com o lote (até `TAMANHO_MAXIMO_LOTE`);
 *   2. 429 interrompe TUDO, sem insistir — nenhuma chamada solo acontece;
 *   3. 206 marca o lote inteiro `parcial`, `sale_fee` ausente, nunca zero;
 *   4. 404 do lote inteiro é NORMALIZADO para "200 com resposta vazia"
 *      ANTES de qualquer classificação — todos ficam ausentes e caem no
 *      passo 6, NUNCA viram `sem_linha` direto a partir do 404 do lote;
 *   5. quem voltou é classificado na hora (`classificarCaptura` do núcleo
 *      puro, `orderSaleFee.ts` — a decisão de captura não é reescrita aqui);
 *   6. cada ausente é reconsultado SOZINHO, um por vez, com a mesma pausa
 *      entre chamadas — nunca em paralelo;
 *   7. ausente que sobrar depois do orçamento de reconsultas (`maxSolo`)
 *      vira `erro` (reagenda), NUNCA `sem_linha`.
 *
 * RECURSÃO DE PROFUNDIDADE 1, NÃO LAÇO DE DIVIDIR AO MEIO: a reconsulta
 * solo é uma chamada recursiva desta MESMA função com um lote de UM id. A
 * recursão termina POR CONSTRUÇÃO, sem contador de profundidade: um lote de
 * um id nunca tem "ausente a reconsultar" no sentido de disparar outra
 * solo — se o único id do lote está ausente, ELE MESMO é a chamada solo que
 * acabou de rodar. Dividir o lote ao meio custaria menos chamadas no pior
 * caso, mas produziria sub-lotes de 2 a 12 ids que CONTINUAM sujeitos ao
 * mesmo truncamento e não confirmam ausência; só solo confirma.
 */

import {
  classificarCaptura,
  detectarTruncamento,
  idsPresentesNaResposta,
  lerPedidos,
  type CapturaDecidida,
  type PedidoSaleFee,
} from "./orderSaleFee.ts";

/** O que `chamar` devolve — mesma forma de `RespostaLote` da edge function. */
export interface ChamarResultado {
  httpStatus: number;
  results: unknown[];
}

export interface ResolverLoteInput {
  /** Os `order_id` (como string) a resolver nesta chamada. */
  lote: readonly string[];
  /** Relógio injetado — nunca `new Date()` dentro do módulo (pureza). */
  agora: Date;
  /** Tentativas já registradas por `ml_order_id`, antes desta rodada. */
  tentativasAtuais: Readonly<Record<string, number>>;
  /**
   * A chamada de rede, INJETADA — recebe os ids e devolve `httpStatus` e
   * `results`. Este módulo nunca faz `fetch`; quem chama (a edge function)
   * é quem sabe falar HTTP.
   */
  chamar: (ids: readonly string[]) => Promise<ChamarResultado>;
  /** A pausa, INJETADA — recebe milissegundos. Nunca `setTimeout` direto aqui. */
  pausar: (ms: number) => Promise<void>;
  /** Pausa fixa entre chamadas — mesmo valor usado entre lotes na edge function. */
  pausaMs: number;
  /**
   * Orçamento de reconsultas SOLO disponível para esta chamada (e para toda
   * a árvore de recursão que ela dispara). Decrementado a cada solo
   * efetivamente chamada — ao esgotar, o restante vira `erro`, NUNCA
   * `sem_linha` (D-hap-03: "orçamento gasto sem declarar é como este
   * defeito começou").
   */
  maxSolo: number;
}

export interface ResolverLoteResultado {
  /** Uma decisão por `order_id` do `lote` de entrada — nunca menos. */
  decisoes: CapturaDecidida[];
  /**
   * `lerPedidos` acumulado: o que veio do lote principal E o que veio das
   * reconsultas solo — para a gravação das linhas ser única no fim.
   */
  pedidosLidos: Map<string, PedidoSaleFee>;
  /** Quantas chamadas de rede (`chamar`) esta resolução efetivamente fez. */
  chamadas: number;
  /** Quantas reconsultas solo esta resolução efetivamente disparou. */
  solosUsados: number;
  /** Verdadeiro quando o lote principal voltou com menos ids do que foi enviado. */
  truncamentoDetectado: boolean;
  /**
   * Ausentes que NÃO foram resolvidos nesta invocação (orçamento de solo
   * esgotado, ou 429 no meio das solos) — saíram `erro`, reagendados.
   */
  ausentesNaoResolvidos: number;
  /** Verdadeiro quando um 429 interrompeu esta resolução (lote principal ou alguma solo). */
  interrompidoPor429: boolean;
}

function vazio(): ResolverLoteResultado {
  return {
    decisoes: [],
    pedidosLidos: new Map(),
    chamadas: 0,
    solosUsados: 0,
    truncamentoDetectado: false,
    ausentesNaoResolvidos: 0,
    interrompidoPor429: false,
  };
}

export async function resolverLoteComTruncamento({
  lote,
  agora,
  tentativasAtuais,
  chamar,
  pausar,
  pausaMs,
  maxSolo,
}: ResolverLoteInput): Promise<ResolverLoteResultado> {
  if (lote.length === 0) return vazio();

  // Passo 1: chama com o lote inteiro — UMA chamada, nunca em paralelo com
  // outra (é o próprio `chamar` injetado que fala com a rede).
  const respostaBruta = await chamar(lote);

  // Passo 4: 404 do lote inteiro é normalizado para "200 com resposta
  // vazia" ANTES de qualquer classificação — nunca conclui ausência por
  // conta própria a partir do 404 de um lote.
  const resposta: ChamarResultado =
    respostaBruta.httpStatus === 404 ? { httpStatus: 200, results: [] } : respostaBruta;

  // Passo 2: 429 interrompe TUDO — nenhuma chamada solo acontece.
  if (resposta.httpStatus === 429) {
    const decisoes = classificarCaptura({
      pedidosDoLote: lote,
      lidos: new Map(),
      presentesNaResposta: new Set(),
      httpStatus: 429,
      agora,
      tentativasAtuais,
    });
    return {
      decisoes,
      pedidosLidos: new Map(),
      chamadas: 1,
      solosUsados: 0,
      truncamentoDetectado: false,
      ausentesNaoResolvidos: 0,
      interrompidoPor429: true,
    };
  }

  // Passo 3 (206) e qualquer outro status que não seja 200: classificarCaptura
  // já sabe decidir — 206 vira "parcial" (saleFee nulo, nunca zero), outro
  // vira "erro" reagendado. Nenhuma solo é disparada nestes casos.
  if (resposta.httpStatus !== 200) {
    const decisoes = classificarCaptura({
      pedidosDoLote: lote,
      lidos: new Map(),
      presentesNaResposta: new Set(),
      httpStatus: resposta.httpStatus,
      agora,
      tentativasAtuais,
    });
    return {
      decisoes,
      pedidosLidos: new Map(),
      chamadas: 1,
      solosUsados: 0,
      truncamentoDetectado: false,
      ausentesNaoResolvidos: 0,
      interrompidoPor429: false,
    };
  }

  // httpStatus === 200 (cru, ou 404 normalizado).
  const presentes = idsPresentesNaResposta(resposta.results);
  const lidos = lerPedidos(resposta.results);
  const { truncado, ausentes } = detectarTruncamento({ enviados: lote, presentes });

  // Lote de UM id só: a recursão termina AQUI, por construção — não há como
  // reconsultar "mais sozinho" do que sozinho. classificarCaptura já sabe
  // (pedidosDoLote.length === 1) que ausência aqui é CONFIRMADA, não
  // truncamento — resolve como sem_linha/ok sem entrar no laço de solos.
  if (lote.length === 1) {
    const decisoes = classificarCaptura({
      pedidosDoLote: lote,
      lidos,
      presentesNaResposta: presentes,
      httpStatus: 200,
      agora,
      tentativasAtuais,
    });
    return {
      decisoes,
      pedidosLidos: lidos,
      chamadas: 1,
      solosUsados: 0,
      truncamentoDetectado: truncado,
      ausentesNaoResolvidos: 0,
      interrompidoPor429: false,
    };
  }

  // Passo 5: quem voltou é classificado na hora.
  const presentesArr = lote.filter((id) => presentes.has(id));
  const decisoesPresentes =
    presentesArr.length > 0
      ? classificarCaptura({
          pedidosDoLote: presentesArr,
          lidos,
          presentesNaResposta: presentes,
          httpStatus: 200,
          agora,
          tentativasAtuais,
        })
      : [];

  // Passo 6/7: cada ausente é reconsultado sozinho, um por vez, ESTRITAMENTE
  // sequencial (await dentro do laço — nenhuma agregação de promessas em
  // paralelo em ponto nenhum deste arquivo), com `pausar` entre chamadas.
  const decisoesAusentes: CapturaDecidida[] = [];
  const pedidosLidos = new Map(lidos);
  let chamadas = 1;
  let solosUsados = 0;
  let interrompidoPor429 = false;

  for (const idAusente of ausentes) {
    if (interrompidoPor429) {
      // Depois de um bloqueio por limite de taxa, NENHUMA chamada nova —
      // insistir é o que transforma bloqueio preventivo em bloqueio longo.
      // O que sobrou vira erro, reagendado.
      decisoesAusentes.push(
        ...classificarCaptura({
          pedidosDoLote: [idAusente],
          lidos: new Map(),
          presentesNaResposta: new Set(),
          httpStatus: 429,
          agora,
          tentativasAtuais,
        }),
      );
      continue;
    }

    if (solosUsados >= maxSolo) {
      // Orçamento de solos esgotado nesta invocação — o restante vira
      // "erro", reagendado, NUNCA "sem_linha" (D-hap-02/03: "não sei" nunca
      // vira "não existe" por falta de orçamento).
      decisoesAusentes.push(
        ...classificarCaptura({
          pedidosDoLote: [idAusente],
          lidos: new Map(),
          presentesNaResposta: new Set(),
          httpStatus: 598, // qualquer status != 200/206/429 vira "erro" no núcleo puro
          agora,
          tentativasAtuais,
        }),
      );
      continue;
    }

    // Mesma pausa entre chamadas usada pelo lote principal — nunca disparar
    // a próxima chamada sem aguardar a pausa fixa.
    await pausar(pausaMs);

    const soloResultado = await resolverLoteComTruncamento({
      lote: [idAusente],
      agora,
      tentativasAtuais,
      chamar,
      pausar,
      pausaMs,
      // O orçamento restante — irrelevante na prática, porque um lote de
      // um id nunca dispara outra solo (recursão termina por construção),
      // mas propagado corretamente mesmo assim.
      maxSolo: maxSolo - solosUsados,
    });

    solosUsados += 1;
    chamadas += soloResultado.chamadas;
    decisoesAusentes.push(...soloResultado.decisoes);
    for (const [id, pedido] of soloResultado.pedidosLidos) {
      pedidosLidos.set(id, pedido);
    }
    if (soloResultado.interrompidoPor429) {
      interrompidoPor429 = true;
    }
  }

  const ausentesNaoResolvidos = decisoesAusentes.filter((d) => d.status === "erro").length;

  return {
    decisoes: [...decisoesPresentes, ...decisoesAusentes],
    pedidosLidos,
    chamadas,
    solosUsados,
    truncamentoDetectado: truncado,
    ausentesNaoResolvidos,
    interrompidoPor429,
  };
}
