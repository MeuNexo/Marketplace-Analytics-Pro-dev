/**
 * movimentoMp — a leitura de UMA linha do relatorio de liberacoes do Mercado Pago.
 *
 * 225-04. Existe separado da edge function por um motivo pratico e um de fundo:
 * a EF chama `serve()` no topo, entao importa-la num teste levantaria servidor;
 * e esta e a aritmetica que decide DINHEIRO — classe, sinal e o que entra na
 * soma. Aritmetica de dinheiro sem teste unitario e como o estorno virou
 * entrada na DRE (fase 237).
 *
 * Molde de `flexOrder.ts`: nenhum import, zero IO, roda no Deno e no vitest.
 */

// ─────────────────────────────────────────────────────────────────────────────
// D-225-10 aplicado as SAIDAS: a cascata e TOTAL.
//
// Toda linha termina com um nome, e o `else` e explicito. Desconhecido e
// resposta aceitavel SO quando e nomeado como desconhecido — mesma disciplina
// da cascata de entradas em `conciliacao_base_linhas`.
// ─────────────────────────────────────────────────────────────────────────────
export type ClasseSaida =
  | "saldo_de_abertura"
  | "reserva"
  | "atribuivel_a_venda"
  | "estrutural_da_conta"
  | "origem_desconhecida";

export function classificar(campos: Record<string, string>): ClasseSaida {
  const descricao = (campos.DESCRIPTION ?? "").trim();
  const fonte = (campos.SOURCE_ID ?? "").trim();
  const unidade = (campos.BUSINESS_UNIT ?? "").trim();

  // A primeira linha da janela nao e movimento: e o saldo inicial da conta.
  // Somar o arquivo cru inflaria o total pelo saldo de abertura.
  if (!fonte && !descricao) return "saldo_de_abertura";

  // 🔴 `reserve_*` e lancamento de reserva e sua contrapartida, nao movimento
  // economico novo. Medido no arquivo real: `reserve_for_payout` e `payout`
  // trazem R$ 38.089,95 CADA — e sao o MESMO saque.
  if (descricao.startsWith("reserve_")) return "reserva";

  // BUSINESS_UNIT e o discriminador pronto, sem heuristica: "Mercado Libre" em
  // 100% das linhas de disputa (29/29 com ml_order_id) e vazio em 100% dos
  // saques (0/3). Isso separa saida de VENDA de saida de CONTA.
  if (unidade === "Mercado Libre") return "atribuivel_a_venda";
  if (unidade === "") return "estrutural_da_conta";

  return "origem_desconhecida";
}

/**
 * 🔴 O que entra na soma.
 *
 * `reserva` e `saldo_de_abertura` NUNCA entram. Qualquer soma que ignore isto
 * FABRICA numero — e a mesma classe de erro do par CHARGE/BONUS que a fase 223
 * enfrentou no billing.
 */
export function contaNoTotal(classe: ClasseSaida): boolean {
  return classe !== "reserva" && classe !== "saldo_de_abertura";
}

function numero(bruto: string | undefined): number {
  const limpo = (bruto ?? "").trim();
  if (!limpo) return 0;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 🔴 O SINAL E DECIDIDO AQUI, EM UM LUGAR SO.
 *
 * Saida e negativa, entrada e positiva. Sinal decidido em dois lugares
 * diferentes e exatamente como o estorno virou entrada na DRE de caixa
 * (fase 237): o mesmo numero lido com duas convencoes opostas. Quem consumir
 * `mp_saidas.valor` NAO decide sinal de novo.
 */
export function valorComSinal(campos: Record<string, string>): number {
  const debito = numero(campos.NET_DEBIT_AMOUNT);
  if (debito > 0) return -debito;
  return numero(campos.NET_CREDIT_AMOUNT);
}

/** `2026-08-30T11:16:59.000-03:00` -> `2026-08-30`, sem reinterpretar fuso. */
export function dataDoMovimento(bruto: string | undefined): string | null {
  const limpo = (bruto ?? "").trim();
  if (limpo.length < 10) return null;
  const dia = limpo.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia : null;
}

/**
 * A soma das SAIDAS de um conjunto de linhas, ja com o par de reserva tratado.
 * Devolve numero negativo (ou zero). Use SEMPRE isto em vez de somar na mao.
 */
export function totalDeSaidas(linhas: Record<string, string>[]): number {
  return linhas.reduce((soma, campos) => {
    if (!contaNoTotal(classificar(campos))) return soma;
    const v = valorComSinal(campos);
    return v < 0 ? soma + v : soma;
  }, 0);
}
