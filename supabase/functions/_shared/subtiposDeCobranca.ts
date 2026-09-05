// ============================================================================
// subtiposDeCobranca.ts — o dicionário dos subtipos de cobrança do Mercado
// Livre, em UM lugar só. Módulo puro, sem import.
//
// ── POR QUE ESTE ARQUIVO EXISTE (Fase 241, plano 241-02) ────────────────────
//
// `CFFI` não passou por descuido de digitação. Passou porque os subtipos eram
// LITERAIS REPETIDOS em lugares que não se falam, com listas diferentes:
//
//   · `conciliacao_frete_linhas` (SQL) filtrava CFFE, CXDE, CXDED
//   · `SUBTIPOS_COMISSAO` (TypeScript) lista CVVML, CVVPRC, CVVFNU, CVVFN
//   · a CTE `tar` de `conciliacao_base_linhas` não filtra nada
//
// Nada obrigava as três a concordarem. Resultado, medido em 05/09/2026: o card
// do pedido `2000017810721990` dizia "Não há linha de cobrança de frete para
// este pedido" tendo a linha `CHARGE/CFFI` de R$ 68,65 na própria base, e
// exibindo `esperado_nosso = R$ 68,65` duas linhas acima.
//
// É a mesma classe do defeito que a 240-05 pegou com `status === "ok"` cravado
// em quatro pontos: DECISÃO POR CATEGORIA ESCRITA EM LITERAL REPETIDO NÃO É
// AUDITÁVEL.
//
// ── PROCEDÊNCIA DOS NOMES ───────────────────────────────────────────────────
//
// 🔴 Nenhum significado abaixo foi DEDUZIDO da sigla. Todos vieram do campo
// `transaction_detail` do próprio Mercado Livre, lido em
// `GET /billing/integration/group/ML/order/details` em 05/09/2026, sobre
// pedidos reais da conta da Pé Vermeio.
//
// ⚠️ E o prefixo NÃO decide: `CFONPN` começa com `CF` e é taxa de
// parcelamento, não frete. Foi por olhar o nome, e não a sigla, que a família
// ficou certa.

/** A que grandeza a linha pertence. */
export type FamiliaDeCobranca =
  | "frete"
  | "comissao"
  | "pagamento"
  | "parcelamento"
  | "desconhecida";

export interface SubtipoConhecido {
  /** `CHARGE` cobra; `BONUS` cancela a cobrança que ele aponta. */
  natureza: "CHARGE" | "BONUS";
  familia: Exclude<FamiliaDeCobranca, "desconhecida">;
  /** O texto do ML, verbatim. É a procedência — não reescrever. */
  nomeDoML: string;
  /**
   * 🔴 244-01: a sigla é uma PARCELA do `sale_fee` do pedido?
   *
   * Não é opinião sobre o nome: é o que a soma prova. Uma sigla tem
   * `compoeSaleFee: true` se e só se incluí-la faz `sum(detail_amount)` das
   * linhas `CHARGE` bater com `sale_fee.net` da raiz do pedido.
   *
   * Prova ao centavo, pedido `2000017848004682` (05/09/2026):
   *   `CVVML` 45,76 + `CVVPRC` 0,32 = 46,08 = `sale_fee_net` = 12% publicado.
   *
   * ⚠️ Por isso `CVVPRC` compõe mesmo se chamando "custo por cobrar no Mercado
   * Pago": o Mercado Livre QUEBRA a mesma tarifa em parcelas com nomes
   * diferentes. Ler o nome e concluir a família foi o erro que fez esta
   * pergunta ficar uma semana esperando decisão.
   */
  compoeSaleFee: boolean;
  /**
   * 🔴 244-04: o Mercado Livre DESCONTA esta linha do que nos paga?
   *
   * Terceira pergunta, terceira coluna — e ela não se deduz das outras duas.
   * `familia` diz o que a cobrança é; `compoeSaleFee` diz se ela está dentro da
   * tarifa do pedido; esta diz se o dinheiro sai do nosso bolso.
   *
   * Medido em 05/09/2026 sobre 8.004 pedidos com repasse aprovado, conferindo
   * `(gross − net)` do Mercado Pago contra a soma das linhas:
   *
   * | grupo | n | fecha com `CFONPN` dentro | fecha com ele FORA |
   * |---|---:|---:|---:|
   * | com parcelamento | 2.762 | **0** | **2.655** |
   * | sem parcelamento | 5.242 | 4.853 | 4.853 |
   *
   * Zero de 2.762. E o próprio nome que o ML dá à linha explica: "Taxa de
   * parcelamento (equivalente ao acréscimo no preço pago pelo comprador)".
   * Conferido em 12 pedidos sorteados contra `total_paid_amount −
   * transaction_amount` do recurso de pedido: 10 batem ao centavo.
   *
   * ⚠️ Isso NÃO quer dizer que a linha seja irrelevante — são R$ 108.802 que o
   * comprador pagou a mais pelo nosso produto, e isso é informação de
   * precificação. Quer dizer que ela não é COBRANÇA NOSSA, e somá-la ao que o
   * ML nos cobrou inventa um vazamento que ninguém perdeu.
   */
  retidoDoRepasse: boolean;
}

/**
 * O dicionário. Toda sigla que apareceu na base da Pé Vermeio até 05/09/2026.
 *
 * 🔴 Sigla nova do ML cai em `"desconhecida"` e o portão de
 * `subtiposDeCobrancaAudit.test.ts` reprova — de propósito. Ignorar em
 * silêncio é como `CFFI` sobreviveu.
 */
export const SUBTIPOS: Readonly<Record<string, SubtipoConhecido>> = {
  // ── Frete ────────────────────────────────────────────────────────────────
  CFFE: { natureza: "CHARGE", familia: "frete", nomeDoML: "Tarifa de envio extra ou intermunicipal", compoeSaleFee: false, retidoDoRepasse: true },
  CFFI: { natureza: "CHARGE", familia: "frete", nomeDoML: "Tarifa por envio interno ao município", compoeSaleFee: false, retidoDoRepasse: true },
  CXDE: { natureza: "CHARGE", familia: "frete", nomeDoML: "Tarifa de envio extra ou intermunicipal", compoeSaleFee: false, retidoDoRepasse: true },
  CXDED: { natureza: "CHARGE", familia: "frete", nomeDoML: "Tarifa de devolução por envio externo ou intermunicipal", compoeSaleFee: false, retidoDoRepasse: true },
  BFFE: { natureza: "BONUS", familia: "frete", nomeDoML: "Cancelamento da tarifa de envio extra ou intermunicipal", compoeSaleFee: false, retidoDoRepasse: true },
  BXDE: { natureza: "BONUS", familia: "frete", nomeDoML: "Cancelamento da tarifa de envio extra ou intermunicipal", compoeSaleFee: false, retidoDoRepasse: true },
  BXDED: { natureza: "BONUS", familia: "frete", nomeDoML: "Cancelamento da tarifa de devolução por envio externo ou intermunicipal", compoeSaleFee: false, retidoDoRepasse: true },

  // ── Comissão de venda ────────────────────────────────────────────────────
  CVVML: { natureza: "CHARGE", familia: "comissao", nomeDoML: "Custo por vender no Mercado Livre", compoeSaleFee: true, retidoDoRepasse: true },
  CVML: { natureza: "CHARGE", familia: "comissao", nomeDoML: "Custo por vender no Mercado Livre", compoeSaleFee: true, retidoDoRepasse: true },
  CV: { natureza: "CHARGE", familia: "comissao", nomeDoML: "Tarifa de venda", compoeSaleFee: true, retidoDoRepasse: true },
  CVAF: { natureza: "CHARGE", familia: "comissao", nomeDoML: "Cargo por venta con afiliados", compoeSaleFee: false, retidoDoRepasse: true },
  BVVML: { natureza: "BONUS", familia: "comissao", nomeDoML: "Cancelamento do Custo por vender no Mercado Livre", compoeSaleFee: true, retidoDoRepasse: true },

  // ── Pagamento (cobrar / receber) ─────────────────────────────────────────
  CVVPRC: { natureza: "CHARGE", familia: "pagamento", nomeDoML: "Custo por cobrar no Mercado Pago", compoeSaleFee: true, retidoDoRepasse: true },
  CVMP: { natureza: "CHARGE", familia: "pagamento", nomeDoML: "Custo por cobrar no Mercado Pago", compoeSaleFee: true, retidoDoRepasse: true },
  CVVFNU: { natureza: "CHARGE", familia: "pagamento", nomeDoML: "Taxa de recebimento", compoeSaleFee: true, retidoDoRepasse: true },
  BVVPRC: { natureza: "BONUS", familia: "pagamento", nomeDoML: "Cancelamento do Custo por cobrar no Mercado Pago", compoeSaleFee: true, retidoDoRepasse: true },
  BVVFNU: { natureza: "BONUS", familia: "pagamento", nomeDoML: "Cancelamento da taxa de recebimento", compoeSaleFee: true, retidoDoRepasse: true },

  // ── Parcelamento ─────────────────────────────────────────────────────────
  // ⚠️ `CFONPN` começa com `CF` e NÃO é frete. A armadilha do prefixo.
  CFONPN: { natureza: "CHARGE", familia: "parcelamento", nomeDoML: "Taxa de parcelamento (equivalente ao acréscimo no preço pago pelo comprador)", compoeSaleFee: false, retidoDoRepasse: false },
  CVVFN: { natureza: "CHARGE", familia: "parcelamento", nomeDoML: "Taxa de parcelamento", compoeSaleFee: true, retidoDoRepasse: true },
  BFONPN: { natureza: "BONUS", familia: "parcelamento", nomeDoML: "Cancelamento da Taxa de parcelamento (equivalente ao acréscimo no preço pago pelo comprador)", compoeSaleFee: false, retidoDoRepasse: false },
};

/** A família da sigla, ou `"desconhecida"` — nunca um silêncio. */
export function familiaDe(subtipo: string | null | undefined): FamiliaDeCobranca {
  const s = (subtipo ?? "").trim().toUpperCase();
  return SUBTIPOS[s]?.familia ?? "desconhecida";
}

/** Todas as siglas de uma família, opcionalmente filtradas por natureza. */
export function siglasDa(
  familia: Exclude<FamiliaDeCobranca, "desconhecida">,
  natureza?: "CHARGE" | "BONUS",
): string[] {
  return Object.entries(SUBTIPOS)
    .filter(([, v]) => v.familia === familia && (natureza === undefined || v.natureza === natureza))
    .map(([k]) => k)
    .sort();
}

/**
 * As quatro cobranças de frete — a lista que a RPC `conciliacao_frete_linhas`
 * aplica em `n_frete`, e que estava sem `CFFI` até a 241-01.
 */
export const FRETE_COBRANCA = siglasDa("frete", "CHARGE");
/** Os três cancelamentos de frete — o netting, que só tinha `BFFE`. */
export const FRETE_BONUS = siglasDa("frete", "BONUS");

/**
 * 🔴 244-01 — AS PARCELAS DO `sale_fee`, e só elas.
 *
 * `SUBTIPOS_COMISSAO` (em `mlOrderSaleFeeContrato.ts`) deriva DESTA lista. Ela
 * responde uma pergunta de DINHEIRO — "somar esta sigla faz a conta fechar
 * contra `sale_fee.net`?" — e não uma de nome.
 *
 * Medido em 05/09/2026 sobre os 8.136 pedidos com captura, contando só linhas
 * `CHARGE` (é assim que `somaComissaoDasLinhas` soma):
 *
 * | lista | identidades que fecham | erro acumulado |
 * |---|---:|---:|
 * | a de agosto (CVVML, CVVPRC, CVVFNU, CVVFN) | 8.103 | R$ 371,96 |
 * | **esta** (+ CVML, CVMP, CV)                | **8.108** | **R$ 137,59** |
 * | esta + `CVAF`                              | 8.079 | — |
 *
 * ⚠️ `CVAF` ("cargo por venta con afiliados") NÃO entra: 29 de 29 pedidos com
 * ela fecham SEM ela e nenhum fecha COM. É cobrança adicional do programa de
 * afiliados, fora do `sale_fee`. Somá-la inflaria a comissão em R$ 277,06 e
 * quebraria 29 identidades que hoje fecham.
 *
 * ⚠️ `CFONPN` (parcelamento, R$ 108.912) também não entra — e `CVVFN`, que o
 * ML também chama de "taxa de parcelamento", ENTRA. É por isso que este campo
 * existe separado de `familia`: a família diz o que a cobrança é, e
 * `compoeSaleFee` diz se ela está DENTRO da tarifa do pedido. Provado em
 * 21/08 no pedido `2000014566978158`: 41,18 + `CVVFN` 27,08 = 68,26 = `net`.
 */
export const SIGLAS_QUE_COMPOEM_SALE_FEE = Object.entries(SUBTIPOS)
  .filter(([, v]) => v.compoeSaleFee)
  .map(([k]) => k)
  .sort();

/** As parcelas de COBRANÇA do `sale_fee` — as que `somaComissaoDasLinhas` soma. */
export const COMPOEM_SALE_FEE_CHARGE = Object.entries(SUBTIPOS)
  .filter(([, v]) => v.compoeSaleFee && v.natureza === "CHARGE")
  .map(([k]) => k)
  .sort();

/**
 * 🔴 244-04 — AS SIGLAS QUE O MERCADO LIVRE NÃO DESCONTA DO REPASSE.
 *
 * Duas, e as duas são parcelamento. A régua de repasse (`conciliacao_base_linhas`)
 * compara `(gross − net)` do Mercado Pago contra a soma das linhas de cobrança;
 * incluir estas duas fazia a conta não fechar em **0 de 2.762** pedidos
 * parcelados e exibia na tela um vazamento de R$ 43.960,50 que ninguém perdeu.
 *
 * ⚠️ A lista existe como EXCEÇÃO NOMEADA, e não como filtro de família: um dia
 * o ML pode emitir uma cobrança de parcelamento que ele de fato retenha, e aí a
 * pergunta certa continua sendo "sai do nosso bolso?", não "é parcelamento?".
 */
export const NAO_RETIDOS_DO_REPASSE = Object.entries(SUBTIPOS)
  .filter(([, v]) => !v.retidoDoRepasse)
  .map(([k]) => k)
  .sort();
