// aceite.ts — a régua de entrada do dinheiro do Mercado Pago, em módulo PURO.
//
// Módulo sem entrada e saída (sem fetch, sem import por URL): roda no vitest do
// Node apesar de a EF (`index.ts`) rodar em Deno. Mesmo padrão de extração de
// `sync-ads/aggregate.ts`, `sync-ml-billing/aggregate.ts` e
// `snapshot-cashflow-forecast/snapshotRows.ts` — `index.ts` importa daqui por
// caminho relativo, e o teste importa DESTE arquivo, nunca de `index.ts`.
//
// ── POR QUE ESTA RÉGUA EXISTE (Fase 225, plano 225-13) ───────────────────────
//
// A ingestão decidia pelo RÓTULO do pagamento, e o rótulo mente nos DOIS
// sentidos. `charged_back` com `status_detail = reimbursed` não é "o comprador
// levou o dinheiro de volta": é contestação encerrada A NOSSO FAVOR — o dinheiro
// foi liberado e está no bolso. Quem decide é `money_release_status` e
// `transaction_amount_refunded`, nunca o `status`.
//
// O tamanho, medido em 04/09/2026 na conta da Pé Vermeio: 14 pagamentos,
// R$ 3.330,88 em 2026, todos `released` com `transaction_amount_refunded = 0`.
// Seis (R$ 1.280,40) nunca entraram em `cash_inflows`. Os outros oito entraram
// quando o pagamento ainda estava `approved` e CONGELARAM com a chave de pedido
// nula: a recusa por status acontecia ANTES de qualquer escrita, então toda
// passagem seguinte os descartava sem nunca reparar a chave que o payload trazia.
//
// 🔴 E a régua NÃO é "aceite `charged_back`". Contestação de fato PERDIDA existe,
// e nela o dinheiro sai mesmo. Aceitar por rótulo trocaria um defeito por outro
// de sinal oposto — e o segundo é pior, porque gravaria como receita dinheiro que
// voltou para o comprador. A pergunta certa é sobre o DINHEIRO: ele foi liberado
// e não voltou?
//
// 🔴 AUSÊNCIA DE CAMPO É RECUSA, NUNCA ZERO. Um campo de estorno que não veio
// lido como zero faria a régua aceitar por não ter perguntado. A régua exige os
// DOIS campos PRESENTES — é a mesma lição do par recebedor × pagador que salvou
// R$ 2.449,52 de venda real no 225-09.
//
// 🔴 A régua NÃO olha o valor e NÃO decide sinal. A negação de `net_amount`
// continua disparada pelo status de estorno, e só por ele, em `index.ts`.
// Pagamento aceito pelo caminho do dinheiro entra POSITIVO, porque o dinheiro
// foi liberado.

/** O recorte do pagamento que a régua lê. Tudo `unknown`: o contrato é da API. */
export interface PagamentoDoMercadoPago {
  status?: unknown;
  money_release_status?: unknown;
  transaction_amount_refunded?: unknown;
}

/**
 * O que o caminho do dinheiro respondeu. Estados SEPARADOS de propósito: um
 * contador que somasse "não veio o campo" com "veio e é estorno" não distinguiria
 * uma quebra de contrato da API de uma contestação perdida de verdade.
 */
export type DesfechoDoDinheiro =
  | "liberado_sem_estorno"
  | "estornado"
  | "nao_liberado"
  | "campo_ausente";

/** Por onde o pagamento entrou. `null` quando não entrou. */
export type ViaDeAceite = "lista" | "dinheiro" | null;

export interface Veredito {
  aceita: boolean;
  via: ViaDeAceite;
  desfecho: DesfechoDoDinheiro;
}

/** O valor de liberação que o Mercado Pago usa para "o dinheiro é seu". */
const LIBERADO = "released";

/**
 * Texto normalizado, ou `null` quando o campo NÃO VEIO. Nulo, indefinido e vazio
 * são ausência — e ausência não é um valor, é a falta dele.
 */
function textoOuNulo(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  return t.length > 0 ? t : null;
}

/**
 * Número finito, ou `null` quando o campo não veio ou não é número.
 *
 * 🔴 Sem coalescência para zero. É exatamente aqui que "não perguntei" viraria
 * "não teve estorno", e o dinheiro do comprador entraria como receita da empresa.
 * Texto no lugar de número também é ausência: "não entendi" não vira "não teve".
 */
function numeroOuNulo(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * O dinheiro foi liberado e não voltou? Lê os DOIS campos e exige os dois
 * PRESENTES. A ordem é: primeiro a ausência (que é dúvida), depois a liberação,
 * depois o estorno — assim o desfecho nomeia a razão real da recusa.
 */
export function caminhoDoDinheiro(p: PagamentoDoMercadoPago | null | undefined): DesfechoDoDinheiro {
  const liberacao = textoOuNulo(p?.money_release_status);
  const estorno = numeroOuNulo(p?.transaction_amount_refunded);

  if (liberacao === null || estorno === null) return "campo_ausente";
  if (liberacao !== LIBERADO) return "nao_liberado";
  if (estorno > 0) return "estornado";
  return "liberado_sem_estorno";
}

/**
 * O veredito completo: se entra, por onde entrou e o que o dinheiro respondeu.
 *
 * A régua é uma DISJUNÇÃO, e a ordem importa para quem a ler daqui a um ano:
 * **ou** o status está na lista de cinco — o caminho de hoje, intocado —, **ou**
 * o dinheiro foi liberado e não voltou.
 *
 * A lista de status NÃO mora aqui: ela continua declarada em `index.ts`, onde o
 * portão de forma a trava contra edição, e chega como argumento. A régua nova é
 * ADITIVA e mora FORA dela.
 */
export function julgaPagamento(
  p: PagamentoDoMercadoPago | null | undefined,
  statusAceitos: readonly string[],
): Veredito {
  const desfecho = caminhoDoDinheiro(p);
  const status = textoOuNulo(p?.status);

  if (status !== null && statusAceitos.includes(status)) {
    return { aceita: true, via: "lista", desfecho };
  }

  if (desfecho === "liberado_sem_estorno") {
    return { aceita: true, via: "dinheiro", desfecho };
  }

  return { aceita: false, via: null, desfecho };
}

/** O veredito em booleano, para quem só precisa da porta. */
export function aceitaPagamento(
  p: PagamentoDoMercadoPago | null | undefined,
  statusAceitos: readonly string[],
): boolean {
  return julgaPagamento(p, statusAceitos).aceita;
}
