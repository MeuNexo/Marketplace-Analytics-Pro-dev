/**
 * mlOrderSaleFeeContrato.ts — o contrato medido de
 * `GET /billing/integration/group/ML/order/details` (Fase 223, 223-01).
 *
 * Módulo PURO: nenhum import remoto nem referência ao runtime do Deno, para
 * ser importável tanto pelas edge functions Deno (import relativo, extensão
 * `.ts` explícita) quanto pelo vitest (node) e pelo frontend Vite. NÃO faz
 * nenhuma chamada de rede/IO — só tipos e o predicado `ehLinhaDeComissao`.
 * A aritmética de negócio (rateio, upsert) é do 223-03.
 *
 * O DEFEITO QUE ESTE MÓDULO FECHA: os dois candidatos óbvios para o rebate
 * no payload do ML — `discount_info.rebate` e um `sale_fee` dentro de
 * `sales_info[]` — vêm `null`/ausentes em 25 de 25 linhas medidas,
 * INCLUSIVE nos dois pedidos que de fato têm rebate. O campo que vale é
 * `sale_fee` na RAIZ de cada item de `results[]`, ao lado de `order_id` —
 * nunca dentro de `sales_info`, nunca dentro de uma linha de `details[]`.
 * Quem procura pelo nome mais óbvio (`discount_info.rebate`) sempre acha
 * `null` e conclui, errado, que o pedido não teve rebate.
 *
 * O GRÃO MEDIDO (223-CONTRATO-SALE-FEE.md, Q1): a API devolve UM item de
 * `results[]` por `order_id` — não um por linha de cobrança. Dentro dele,
 * `details[]` tem uma entrada por LINHA DE COBRANÇA (uma por
 * `charge_info.detail_id`, presente e único em 25/25 linhas medidas — Q2),
 * e é aí — não em `sale_fee` — que mora o subtipo que diz se a linha é
 * comissão, frete, parcelamento ou estorno.
 *
 * A ARMADILHA DO CANCELAMENTO (Q4): pedido cancelado ganha DUAS linhas
 * extras em `details[]`, `detail_type: "BONUS"` (`BVVML`/`BVVPRC`), com
 * `charge_bonified_id` apontando o `detail_id` da cobrança original e
 * `detail_amount` IDÊNTICO ao dela — é o ESTORNO por cancelamento, não o
 * rebate promocional (mesmo par de campos, Pitfall 3 da pesquisa da Fase
 * 223). E o `sale_fee` da raiz NÃO reflete o cancelamento: no pedido
 * `2000017822557678` (cancelado, medido) ele segue dizendo
 * `gross 43,07 · net 21,90 · rebate 21,17`, como se a venda valesse —
 * `sale_fee` é a tarifa da venda, não o saldo do pedido.
 *
 * `net` NÃO é `orders.comissao` (Q3): é `orders.comissao × orders.quantidade`
 * — `orders` é 1:1 com o pedido do ML (zero pedidos multilinha medidos em
 * julho/2026), então NÃO há rateio a fazer entre linhas de `orders`, ao
 * contrário do que a Fase 223 supôs antes de medir. Ver
 * `223-CONTRATO-SALE-FEE.md`, Q3, para o defeito ativo (comissão
 * subestimada em todo pedido de quantidade > 1) que essa identidade
 * revelou — fora do escopo desta fase.
 */

// ── sale_fee (raiz de cada item de results[]) — Q1, Q3, Q4 ────────────────

/**
 * `sale_fee` como medido na raiz de cada item de `results[]`. Os quatro
 * campos numéricos vieram sempre presentes na amostra (nunca `null`, 7/7
 * pedidos); o tipo aceita `null` porque a doc do ML não garante isso para
 * todo seller. `discount`/`discount_reason` AQUI são do pedido inteiro —
 * não confundir com `discount_info.discount_reason`, que existe por LINHA
 * dentro de `details[]` e às vezes traz texto ("Desconto geral" nas linhas
 * de frete) mesmo quando o pedido não tem rebate.
 */
export interface SaleFee {
  gross: number | null;
  net: number | null;
  rebate: number | null;
  discount: number | null;
  discount_reason: string | null;
}

// ── A linha de cobrança (um item de details[]) — Q1, Q2 ───────────────────

interface ChargeInfo {
  status: string | null;
  detail_id: number;
  detail_type: string;
  detail_amount: number;
  detail_sub_type: string;
  charge_bonified_id: number | null;
  creation_date_time: string;
  status_description: string | null;
  transaction_detail: string;
  legal_document_number: string | null;
  legal_document_status: string;
  debited_from_operation: string;
  legal_document_status_description: string;
  debited_from_operation_description: string;
}

interface DiscountInfo {
  /**
   * Sempre `null` nas 25 linhas medidas — INCLUSIVE nas 4 linhas dos 2
   * pedidos com rebate de verdade (Q2). NÃO é a fonte do rebate; ver o
   * cabeçalho deste arquivo.
   */
  rebate: number | null;
  discount_amount: number | null;
  discount_reason: string | null;
  charge_amount_without_discount: number | null;
}

interface DocumentInfo {
  document_id: number;
}

interface ShippingInfo {
  pack_id: string | null;
  shipping_id: string;
  receiver_shipping_cost: number | null;
}

interface CurrencyInfo {
  currency_id: string;
}

interface MarketplaceInfo {
  marketplace: string;
}

interface SalesInfoItem {
  order_id: number;
  state_name: string | null;
  operation_id: number;
  financing_fee: number | null;
  sales_channel: string;
  sale_date_time: string;
  /** Ausente (a chave nem existe) nas linhas BONUS medidas — nunca vem `null`, só falta. */
  wholesale_price?: string;
  transaction_amount: number;
  financing_transfer_total: number | null;
}

interface ItemsInfoItem {
  item_id: string;
  order_id: number;
  item_type: string;
  item_price: number;
  item_amount: number;
  /** Único valor observado nas 25 linhas medidas; tipo real não conhecido. */
  item_kit_id: null;
  /** Único valor observado nas 25 linhas medidas; tipo real não conhecido. */
  inventory_id: null;
}

/**
 * Um item de `details[]` — uma LINHA DE COBRANÇA, chaveada por
 * `charge_info.detail_id`. É aqui, não em `sale_fee`, que mora o subtipo
 * que separa comissão de frete, parcelamento e estorno por cancelamento —
 * ver `ehLinhaDeComissao`.
 */
export interface LinhaOrderDetail {
  items_info: ItemsInfoItem[];
  sales_info: SalesInfoItem[];
  charge_info: ChargeInfo;
  currency_info: CurrencyInfo;
  discount_info: DiscountInfo;
  document_info: DocumentInfo;
  shipping_info: ShippingInfo;
  marketplace_info: MarketplaceInfo;
}

/**
 * Um item de `results[]` — UM POR PEDIDO (Q1: medido 1 result por
 * `order_id`, nunca um por linha de cobrança). `sale_fee` mora na raiz, ao
 * lado de `details[]` — nunca dentro de `sales_info`.
 */
export interface ResultadoPedidoSaleFee {
  order_id: number;
  sale_fee: SaleFee;
  details: LinhaOrderDetail[];
}

// ── Subtipos de comissão e o predicado que separa comissão de estorno ─────

/**
 * Subtipos de `charge_info.detail_sub_type` que são comissão. Medidos nos
 * 371 pedidos de 21/08 (quick 260821-hap): `CVVFNU` em 95 linhas, `CVVFN` em
 * 5 — os DOIS existem, `CVVFN` NÃO é erro de digitação de `CVVFNU`. Prova ao
 * centavo, pedido `2000014566978158`: `CVVPRC` 9,09 + `CVVML` 32,09 = 41,18
 * contra `sale_fee.net` 68,26; com `CVVFN` 27,08 a conta fecha exata
 * (41,18 + 27,08 = 68,26). Fechar essa identidade corrigiu 5 das 7
 * divergências da identidade interna medidas nos 371 pedidos.
 *
 * `CVVML` ("custo por vender no Mercado Livre") e `CVVPRC` ("custo por
 * cobrar no Mercado Pago") foram observados em 7/7 pedidos da amostra
 * original (223-01). O código genérico `CV`, sozinho, da doc oficial, nunca
 * aparece neste seller e devolveria zero linhas se usado como filtro.
 *
 * ⚠️ `CFFI` (1 linha, R$ 44,45, nos 371 medidos) NÃO entra — é frete, irmã
 * de `CFFE` ("tarifa de envio extra ou intermunicipal"). Somá-la inflaria a
 * comissão em R$ 44,45 num pedido só. Provado por teste negativo em
 * `mlOrderSaleFeeContrato.test.ts` — não "completar a lista" com `CFFI` no
 * futuro sem medir de novo.
 */
export const SUBTIPOS_COMISSAO = ["CVVML", "CVVPRC", "CVVFNU", "CVVFN"] as const;

/**
 * Verdadeiro só para uma linha de COBRANÇA (`charge_info.detail_type ===
 * "CHARGE"`, nunca `"BONUS"`) cujo `detail_sub_type` está em
 * `SUBTIPOS_COMISSAO` e cujo `charge_info.detail_amount` é um número
 * finito. `linha` é `unknown` de propósito: o payload vem de
 * `JSON.parse` de uma resposta de rede, sem garantia de forma.
 *
 * POR QUE NÃO OLHA `sale_fee`: o `<behavior>` original desta task foi
 * escrito antes da medição, supondo que cada linha traria seu próprio
 * `sale_fee.gross`/`net`. Q1 mediu o contrário — `sale_fee` só existe UMA
 * VEZ, na raiz do pedido (`ResultadoPedidoSaleFee`), nunca por linha de
 * `details[]`. O valor monetário desta granularidade é
 * `charge_info.detail_amount`, e é ele que este predicado confere.
 *
 * Este predicado é o que separa rebate promocional de estorno por
 * cancelamento (Q4, Pitfall 3 da pesquisa): pedido cancelado ganha linhas
 * `detail_type: "BONUS"` (`BVVML`/`BVVPRC`) com o MESMO `detail_amount` da
 * cobrança original que estornam. Somá-las como comissão dobra a conta;
 * tratá-las como rebate inventa promoção onde houve devolução de dinheiro.
 */
export function ehLinhaDeComissao(linha: unknown): boolean {
  if (typeof linha !== "object" || linha === null) return false;

  const chargeInfo = (linha as { charge_info?: unknown }).charge_info;
  if (typeof chargeInfo !== "object" || chargeInfo === null) return false;

  const { detail_type, detail_sub_type, detail_amount } = chargeInfo as {
    detail_type?: unknown;
    detail_sub_type?: unknown;
    detail_amount?: unknown;
  };

  if (detail_type !== "CHARGE") return false;
  if (typeof detail_sub_type !== "string") return false;
  if (!(SUBTIPOS_COMISSAO as readonly string[]).includes(detail_sub_type)) {
    return false;
  }
  if (typeof detail_amount !== "number" || !Number.isFinite(detail_amount)) {
    return false;
  }

  return true;
}
