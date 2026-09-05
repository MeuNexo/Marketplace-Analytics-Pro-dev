// ============================================================================
// filaCaptura.ts — quem entra na fila da captura de cobrança, em módulo PURO.
//
// Sem entrada e saída, sem import remoto: roda no vitest do Node apesar de a
// edge function rodar em Deno. Mesmo padrão de `aceite.ts` (225-13) e
// `orderSaleFeeLote.ts` (223-04) — `index.ts` importa daqui por caminho
// relativo, e o teste importa DESTE arquivo, nunca de `index.ts`.
//
// ── POR QUE ESTE MÓDULO EXISTE (Fase 240, plano 240-02) ─────────────────────
//
// `D-223-05` diz: pedido capturado (`status = "ok"`) nunca é reconsultado. A
// regra está certa para a COMISSÃO, que nasce junto com a venda — reconsultar
// gastaria chamada para reler o mesmo número.
//
// 🔴 Ela está errada para o FRETE. O Mercado Livre emite a tarifa de envio
// (`CFFE`) até 18 dias DEPOIS da venda. Quem captura no dia seguinte pega a
// comissão, grava `ok`, e fecha a porta antes de a tarifa existir.
//
// O tamanho, medido em 04/09/2026 na conta da Pé Vermeio contra a API ao vivo
// (amostra de 160, lote 8, pausa 2 s, HTTP conferido e 429 refeito): 910
// pedidos estão `ok` com comissão e sem CFFE; 164 responderam e **109 (66,5%)
// têm CFFE no ML que a nossa base não tem** — R$ 3.757,72 na amostra,
// estimativa de ~R$ 20.850 no total.
//
// ── A RÉGUA, E POR QUE ELA NÃO VIRA LAÇO ETERNO ─────────────────────────────
//
// O pedido volta à fila enquanto a captura for anterior ao fim da janela do
// CFFE: `capturado_em < data_pedido + JANELA_CFFE_DIAS`.
//
// Toda gravação `ok` carimba `capturado_em = agora` (`index.ts`). Uma
// reconsulta feita depois do fim da janela avança o carimbo, e o pedido SAI DA
// FILA SOZINHO — inclusive quem legitimamente nunca terá frete cobrado, que é
// reconsultado no máximo UMA vez após a janela. A fila encolhe
// monotonicamente; não precisa de coluna nova nem de contador.
//
// ⚠️ A condição NÃO é "não tem CFFE", e isso é deliberado. Perguntar "falta
// CFFE?" reconsultaria para sempre todo pedido que nunca vai ter frete cobrado
// (14% da base medida). Perguntar "capturei cedo demais?" tem fim.

/** O estado da captura que a régua lê. */
export interface CapturaConhecida {
  status: string;
  /** ISO da última tentativa — a trava diária de `freteAindaAusente`. */
  ultima_tentativa?: string | null;
  /** ISO, ou `null` quando ainda não houve captura bem-sucedida. */
  capturado_em: string | null;
  /** ISO, ou `null` quando não há por que reconsultar (capturado, ou desistiu). */
  proxima_tentativa: string | null;
}

/** O pedido, com a data que a janela do CFFE usa como âncora. */
export interface PedidoDaFila {
  ml_order_id: string;
  /** `orders.data_pedido` — TEXT com carimbo de hora nesta base. */
  data_pedido: string | null;
  /**
   * 🔴 242-01: já existe linha de cobrança de FRETE gravada para este pedido?
   *
   * É o fato que faltava para a fila decidir. Sem ele, a régua só tinha o
   * relógio — e o relógio disse "espere 21 dias" sobre dado que o ML já tinha.
   */
  temFrete?: boolean;
}

/**
 * A janela em que a tarifa de envio ainda pode chegar, em dias corridos.
 *
 * 🔴 18 é `dias_defasagem_cffe`, hoje literal dentro de
 * `conciliacao_base_linhas` (239-04) — a RPC da tela usa o mesmo número para
 * decidir que uma venda recente sem cobrança é espera do ML, não lacuna nossa.
 * Os 3 de folga existem porque o carimbo do ML é o da EMISSÃO e o nosso é o da
 * CAPTURA: sem eles, um pedido emitido no dia 18 e capturado no 18 escaparia.
 *
 * ⚠️ SE UM MUDAR, O OUTRO MUDA JUNTO. Duas réguas para a mesma defasagem é
 * como o saldo quebrou na fase 233.
 */
export const DIAS_DEFASAGEM_CFFE = 18;
export const JANELA_CFFE_DIAS = DIAS_DEFASAGEM_CFFE + 3;

/**
 * O instante em que a proteção contra truncamento do envelope passou a valer
 * (D-hap-02/03, "260821-hap" — a reconsulta solo de `orderSaleFeeLote.ts`).
 *
 * 🔴 A SEGUNDA CAUSA, e a maior delas — medida em 05/09/2026, por dia de
 * captura:
 *
 *   20/08: 1.233 pedidos gravados `ok`, **37,1% com CFFE**, média 2,92 linhas
 *   21/08: 6.376 pedidos gravados `ok`, **97,4% com CFFE**, média 3,62 linhas
 *
 * O backfill inicial rodou em 20/08, ANTES de a proteção existir. O envelope
 * do ML pagina por LINHA DE COBRANÇA (teto de 150), não por pedido: os lotes
 * voltavam truncados, o pedido era gravado `ok` com as linhas que couberam — a
 * comissão vinha, o frete ficava de fora — e `D-223-05` fechava a porta para
 * sempre.
 *
 * Por mês de venda o rastro é o mesmo: janeiro 54,4% e fevereiro 42,9% de
 * cobertura de CFFE, contra 96,7% a 99,2% de março a julho.
 *
 * ⚠️ Isto NÃO é a mesma coisa que captura prematura. Um pedido de janeiro
 * capturado em agosto foi capturado MUITO depois de a janela do CFFE fechar —
 * a régua de `okPrematuro` não o alcança, e por isso esta existe ao lado dela,
 * com nome próprio. Duas causas, dois nomes: é o contrato da fase 239.
 */
export const CORTE_TRUNCAMENTO_CORRIGIDO_MS = Date.parse("2026-08-21T00:00:00Z");

/**
 * Este `ok` foi carimbado antes de a proteção contra truncamento existir —
 * logo pode ter sido gravado a partir de uma resposta cortada pelo meio.
 *
 * Auto-limitante pelo mesmo mecanismo de `okPrematuro`: a reconsulta grava
 * `capturado_em = agora`, que é depois do corte, e o pedido sai da fila.
 */
export function capturaTruncadaAntesDaCorrecao(c: CapturaConhecida): boolean {
  if (!ehCapturaFechada(c.status)) return false;
  if (c.capturado_em === null) return true;
  const cap = Date.parse(c.capturado_em);
  if (!Number.isFinite(cap)) return true;
  return cap < CORTE_TRUNCAMENTO_CORRIGIDO_MS;
}

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Os status em que o ML JÁ FALOU e a captura está fechada quanto ao sale fee.
 *
 * 🔴 `so_cobranca` (240-03) entra aqui junto com `ok`: o ML respondeu com
 * cobrança, só não com `sale_fee` completo. Deixá-lo de fora faria a fila
 * reconsiderá-lo por `proxima_tentativa` — que é nula — e ele sumiria da
 * varredura das duas réguas abaixo, que é exatamente onde ele precisa estar.
 */
export function ehCapturaFechada(status: string): boolean {
  return status === "ok" || status === "so_cobranca";
}

/**
 * O valor de `capturado_em` a gravar — `null` só para quem NÃO fechou.
 *
 * 🔴 ESTA FUNÇÃO EXISTE POR CAUSA DE UM LAÇO REAL, medido em 05/09/2026. O
 * upsert carimbava `capturado_em` apenas quando `status === "ok"`. Quando
 * `so_cobranca` nasceu (240-03), os 19 pedidos que caíram nele foram gravados
 * com carimbo NULO — e `okPrematuro` lê nulo como "prematuro", de propósito
 * (ausência não é "já capturei"). Resultado: os 19 voltavam à fila em TODA
 * rodada, para sempre, gastando chamada para reler o mesmo número.
 *
 * As duas regras estavam certas isoladamente e erradas juntas. O carimbo é a
 * ÚNICA saída de ambas as réguas de reabertura, então quem fecha a captura tem
 * de carimbar — e agora é uma função só, testável, em vez de uma condição
 * solta dentro de um `index.ts` que o vitest não alcança.
 */
export function carimboDeCaptura(status: string, agoraISO: string): string | null {
  return ehCapturaFechada(status) ? agoraISO : null;
}

/**
 * O instante em que a janela do CFFE se fecha para este pedido, ou `null`
 * quando não dá para saber (sem data de pedido legível).
 */
export function fimDaJanelaCffe(dataPedido: string | null): Date | null {
  if (typeof dataPedido !== "string" || dataPedido.trim() === "") return null;
  // `data_pedido` é TEXT `AAAA-MM-DD...` nesta base; ler só o dia evita que o
  // fuso do carimbo mova a fronteira em algumas horas.
  const dia = dataPedido.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  const t = Date.parse(`${dia}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return new Date(t + JANELA_CFFE_DIAS * MS_POR_DIA);
}

/**
 * Este `ok` foi carimbado ANTES de a janela do CFFE fechar — logo pode estar
 * sem a tarifa de envio, e volta à fila.
 *
 * 🔴 `capturado_em` NULO com status `ok` conta como PREMATURO. Não deveria
 * existir (o upsert carimba sempre que grava `ok`), mas se existir é ausência
 * de informação — e ausência não vira "já capturei". É a mesma régua de
 * `aceite.ts`: campo que não veio não é zero.
 */
export function okPrematuro(c: CapturaConhecida, p: PedidoDaFila, agoraMs: number): boolean {
  if (!ehCapturaFechada(c.status)) return false;
  const fim = fimDaJanelaCffe(p.data_pedido);
  // Sem data de pedido não há como julgar: não reabre. Reabrir aqui colocaria
  // na fila, a cada rodada, todo pedido cuja data não sabemos ler — e essa
  // fila nunca encolheria.
  if (fim === null) return false;

  // 🔴 SÓ DEPOIS QUE A JANELA FECHA. Sem esta guarda, um pedido vendido e
  // capturado hoje satisfaz `capturado_em < venda + 21` e volta à fila TODO
  // DIA durante três semanas — a tarifa nem foi emitida ainda, e a reconsulta
  // relê o mesmo número. Medido antes de corrigir: o contador deu 1.372 em vez
  // dos ~910 do passivo real, e a diferença era exatamente a janela viva.
  //
  // Com a guarda, cada pedido é reconsultado UMA vez, no dia em que a janela
  // fecha — que é o primeiro dia em que a resposta pode ter mudado.
  if (agoraMs < fim.getTime()) return false;

  if (c.capturado_em === null) return true;
  const cap = Date.parse(c.capturado_em);
  if (!Number.isFinite(cap)) return true;
  return cap < fim.getTime();
}

/**
 * Falta a linha de frete e a janela ainda está aberta — logo o Mercado Livre
 * pode já ter emitido, e a única forma de saber é PERGUNTAR.
 *
 * 🔴 ESTA FUNÇÃO DERRUBA D-240-08, e a premissa dela. A fase 240 decidiu não
 * reabrir durante a janela viva porque "reconsultar releria o mesmo número".
 * Medido em 05/09/2026, amostra de 40 pedidos dentro da janela consultados na
 * API ao vivo: **39 JÁ TINHAM o frete no ML e a nossa base não** — R$ 1.577,43
 * só na amostra. O dado muda, e muda cedo.
 *
 * O achado é do Wesley, com o app do ML ao lado da tela, no pedido
 * `2000017989526906`: extrato mostra "Envios −R$ 30,75" e o card dizia "não há
 * linha de cobrança de frete para este pedido".
 *
 * ⚠️ POR QUE ISTO NÃO GIRA, apesar de olhar o conteúdo: a saída é TER o frete.
 * Assim que a linha chega, o pedido para de voltar. Quem nunca terá frete sai
 * pelo fim da janela — no máximo 21 reconsultas, **uma por dia**, nunca
 * infinitas. Foi por não separar esses dois casos que a 240 escolheu o relógio
 * sozinho, e escolheu errado.
 *
 * A trava diária é `ultima_tentativa`, não um contador novo: sem ela, oito
 * invocações no mesmo dia consumiriam oito vagas do mesmo pedido.
 */
export function freteAindaAusente(
  c: CapturaConhecida,
  p: PedidoDaFila,
  agoraMs: number,
): boolean {
  if (!ehCapturaFechada(c.status)) return false;
  // O fato não veio: não inventa. Sem saber se falta frete, esta régua se cala
  // e o pedido segue para as outras.
  if (p.temFrete !== false) return false;
  const fim = fimDaJanelaCffe(p.data_pedido);
  if (fim === null) return false;
  // Fora da janela é assunto de `okPrematuro`, não desta.
  if (agoraMs >= fim.getTime()) return false;
  return !tentadoNoMesmoDia(c.ultima_tentativa ?? c.capturado_em, agoraMs);
}

/** O dia (UTC) de um instante ISO, ou `null` quando não dá para ler. */
function diaDe(iso: string | null | undefined): string | null {
  if (typeof iso !== "string" || iso.trim() === "") return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

/** Já foi tentado hoje? Ausência de carimbo conta como NÃO tentado. */
function tentadoNoMesmoDia(iso: string | null | undefined, agoraMs: number): boolean {
  const d = diaDe(iso);
  if (d === null) return false;
  return d === new Date(agoraMs).toISOString().slice(0, 10);
}

/** Por que este pedido entrou na fila. `null` quando não entrou. */
export type MotivoNaFila =
  | "nunca_capturado"
  | "retentativa_vencida"
  | "cffe_pode_ter_chegado"
  | "captura_truncada"
  | "frete_ainda_ausente";

/**
 * A decisão de fila para UM pedido. A ordem dos ramos é conteúdo, não estilo:
 * quem nunca foi visto vem antes de tudo; a retentativa agendada — que é o
 * caminho de hoje, intocado — vem antes da régua nova; e a régua nova é
 * ADITIVA, mora depois e só alcança o que já estava sendo pulado.
 */
export function motivoNaFila(
  p: PedidoDaFila,
  c: CapturaConhecida | undefined,
  agoraMs: number,
): MotivoNaFila | null {
  if (!c) return "nunca_capturado";

  if (ehCapturaFechada(c.status)) {
    // A ordem nomeia a causa DOMINANTE quando mais de uma vale. O truncamento
    // vem primeiro por ser o defeito maior (1.233 pedidos contra 19).
    if (capturaTruncadaAntesDaCorrecao(c)) return "captura_truncada";
    // 🔴 242-01: falta frete E ainda dá tempo de ele chegar. Vem ANTES da
    // régua do relógio porque é mais específica: ela sabe O QUE falta, não só
    // QUANDO a captura aconteceu.
    if (freteAindaAusente(c, p, agoraMs)) return "frete_ainda_ausente";
    return okPrematuro(c, p, agoraMs) ? "cffe_pode_ter_chegado" : null;
  }

  // Desistiu (ex.: `sem_linha` com tentativas esgotadas): não volta.
  if (c.proxima_tentativa === null) return null;
  const proxima = Date.parse(c.proxima_tentativa);
  if (Number.isFinite(proxima) && proxima > agoraMs) return null;
  return "retentativa_vencida";
}

export interface FilaMontada {
  /** Os `ml_order_id` a consultar, na ordem em que chegaram. */
  pendentes: string[];
  /** Quantos entraram por cada motivo — o diagnóstico que a EF reporta. */
  contagem: Record<MotivoNaFila, number>;
}

/**
 * Monta a fila inteira. Devolve os contadores separados de propósito: uma
 * rodada que reabre 150 pedidos pelo CFFE precisa ser distinguível de uma que
 * não reabriu nenhum, e um total só não distingue.
 */
export function montarFila(
  pedidos: readonly PedidoDaFila[],
  capturas: ReadonlyMap<string, CapturaConhecida>,
  agoraMs: number,
): FilaMontada {
  const pendentes: string[] = [];
  const contagem: Record<MotivoNaFila, number> = {
    nunca_capturado: 0,
    retentativa_vencida: 0,
    cffe_pode_ter_chegado: 0,
    captura_truncada: 0,
    frete_ainda_ausente: 0,
  };
  const vistos = new Set<string>();
  for (const p of pedidos) {
    if (vistos.has(p.ml_order_id)) continue;
    vistos.add(p.ml_order_id);
    const motivo = motivoNaFila(p, capturas.get(p.ml_order_id), agoraMs);
    if (motivo === null) continue;
    pendentes.push(p.ml_order_id);
    contagem[motivo] += 1;
  }
  return { pendentes, contagem };
}
