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

const MS_POR_DIA = 24 * 60 * 60 * 1000;

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
export function okPrematuro(c: CapturaConhecida, p: PedidoDaFila): boolean {
  if (c.status !== "ok") return false;
  const fim = fimDaJanelaCffe(p.data_pedido);
  // Sem data de pedido não há como julgar: não reabre. Reabrir aqui colocaria
  // na fila, a cada rodada, todo pedido cuja data não sabemos ler — e essa
  // fila nunca encolheria.
  if (fim === null) return false;
  if (c.capturado_em === null) return true;
  const cap = Date.parse(c.capturado_em);
  if (!Number.isFinite(cap)) return true;
  return cap < fim.getTime();
}

/** Por que este pedido entrou na fila. `null` quando não entrou. */
export type MotivoNaFila = "nunca_capturado" | "retentativa_vencida" | "cffe_pode_ter_chegado";

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

  if (c.status === "ok") {
    return okPrematuro(c, p) ? "cffe_pode_ter_chegado" : null;
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
