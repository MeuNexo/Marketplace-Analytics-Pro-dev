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
  CFFE: { natureza: "CHARGE", familia: "frete", nomeDoML: "Tarifa de envio extra ou intermunicipal" },
  CFFI: { natureza: "CHARGE", familia: "frete", nomeDoML: "Tarifa por envio interno ao município" },
  CXDE: { natureza: "CHARGE", familia: "frete", nomeDoML: "Tarifa de envio extra ou intermunicipal" },
  CXDED: { natureza: "CHARGE", familia: "frete", nomeDoML: "Tarifa de devolução por envio externo ou intermunicipal" },
  BFFE: { natureza: "BONUS", familia: "frete", nomeDoML: "Cancelamento da tarifa de envio extra ou intermunicipal" },
  BXDE: { natureza: "BONUS", familia: "frete", nomeDoML: "Cancelamento da tarifa de envio extra ou intermunicipal" },
  BXDED: { natureza: "BONUS", familia: "frete", nomeDoML: "Cancelamento da tarifa de devolução por envio externo ou intermunicipal" },

  // ── Comissão de venda ────────────────────────────────────────────────────
  CVVML: { natureza: "CHARGE", familia: "comissao", nomeDoML: "Custo por vender no Mercado Livre" },
  CVML: { natureza: "CHARGE", familia: "comissao", nomeDoML: "Custo por vender no Mercado Livre" },
  CV: { natureza: "CHARGE", familia: "comissao", nomeDoML: "Tarifa de venda" },
  CVAF: { natureza: "CHARGE", familia: "comissao", nomeDoML: "Cargo por venta con afiliados" },
  BVVML: { natureza: "BONUS", familia: "comissao", nomeDoML: "Cancelamento do Custo por vender no Mercado Livre" },

  // ── Pagamento (cobrar / receber) ─────────────────────────────────────────
  CVVPRC: { natureza: "CHARGE", familia: "pagamento", nomeDoML: "Custo por cobrar no Mercado Pago" },
  CVMP: { natureza: "CHARGE", familia: "pagamento", nomeDoML: "Custo por cobrar no Mercado Pago" },
  CVVFNU: { natureza: "CHARGE", familia: "pagamento", nomeDoML: "Taxa de recebimento" },
  BVVPRC: { natureza: "BONUS", familia: "pagamento", nomeDoML: "Cancelamento do Custo por cobrar no Mercado Pago" },
  BVVFNU: { natureza: "BONUS", familia: "pagamento", nomeDoML: "Cancelamento da taxa de recebimento" },

  // ── Parcelamento ─────────────────────────────────────────────────────────
  // ⚠️ `CFONPN` começa com `CF` e NÃO é frete. A armadilha do prefixo.
  CFONPN: { natureza: "CHARGE", familia: "parcelamento", nomeDoML: "Taxa de parcelamento (equivalente ao acréscimo no preço pago pelo comprador)" },
  CVVFN: { natureza: "CHARGE", familia: "parcelamento", nomeDoML: "Taxa de parcelamento" },
  BFONPN: { natureza: "BONUS", familia: "parcelamento", nomeDoML: "Cancelamento da Taxa de parcelamento (equivalente ao acréscimo no preço pago pelo comprador)" },
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
