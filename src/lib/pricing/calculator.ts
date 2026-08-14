/**
 * Pricing simulator core — pure, deterministic, fully testable.
 *
 * Inputs use percent values (e.g. 16 means 16%) and currency in BRL.
 * Reactive UI calls `computePricing(input)` on every keystroke; expensive
 * data fetches (commission/listing fees from the ML API) live outside.
 */

export type ListingType = "gold_pro" | "gold_special";
export type DeductionMode = "percent" | "amount";
export type ObjectiveMode = "margin" | "markup";

export interface ExtraDeduction {
  enabled: boolean;
  mode: DeductionMode;
  value: number;
}

export interface PricingInput {
  cost: number;
  salePrice: number;
  commissionPct: number;
  fixedFee: number;
  shippingCost: number;
  taxPct: number;
  difalEnabled: boolean;
  difalPct: number;
  rebate: ExtraDeduction;
  cupom: ExtraDeduction;
  afiliado: ExtraDeduction;
  promo: ExtraDeduction;
}

export interface PricingResult {
  receitaBruta: number;
  /** Comissão cheia, antes do rebate do ML (price * commissionPct / 100). Uso: exibição. */
  comissaoBruta: number;
  /** Comissão efetivamente retida (comissaoBruta − rebateValor). É o que entra em totalDeducoes. */
  comissaoValor: number;
  taxaFixa: number;
  frete: number;
  imposto: number;
  difal: number;
  rebateValor: number;
  /**
   * true quando o valor digitado em "Rebate Mercado Livre" pediu mais do que
   * a comissão bruta cobre — o ML nunca abate mais do que a própria
   * comissão (decisão do Wesley, 14/08, debug simulador-rebate-deducao).
   * `rebateValor` acima já vem travado no teto; este campo é só o AVISO
   * para a tela não precisar recalcular para descobrir que houve corte.
   */
  rebateExcedeComissao: boolean;
  cupomValor: number;
  afiliadoValor: number;
  promoValor: number;
  deducoesExtras: number;
  totalDeducoes: number;
  receitaLiquida: number;
  custo: number;
  lucro: number;
  margemPct: number;
  markupPct: number;
  markupMultiplier: number;
  roiPct: number;
  breakEven: number;
  /** Percentual total de deduções proporcionais ao preço (comissão + imposto + difal + extras em %). */
  proportionalPct: number;
  /** Total de deduções fixas (taxa fixa + frete + extras em R$). */
  fixedDeductions: number;
}

function resolveExtra(price: number, d: ExtraDeduction): number {
  if (!d.enabled || d.value <= 0) return 0;
  if (d.mode === "percent") return (price * d.value) / 100;
  return d.value;
}

function extraAsPct(d: ExtraDeduction): number {
  if (!d.enabled || d.value <= 0 || d.mode !== "percent") return 0;
  return d.value;
}

function extraAsAmount(d: ExtraDeduction): number {
  if (!d.enabled || d.value <= 0 || d.mode !== "amount") return 0;
  return d.value;
}

export function computePricing(input: PricingInput): PricingResult {
  const price = Math.max(0, input.salePrice);

  const comissaoBruta = (price * input.commissionPct) / 100;
  const imposto = (price * input.taxPct) / 100;
  const difal = input.difalEnabled ? (price * input.difalPct) / 100 : 0;

  // O rebate do Mercado Livre é o ML abatendo a PRÓPRIA comissão (confirmado
  // contra a API de promoções e pedidos reais em 14/08 — Fase 222/debug
  // simulador-rebate-deducao): nunca é dinheiro que sai do preço de venda,
  // como um cupom ou desconto promocional que o vendedor concede. Por isso
  // reduz `comissaoValor` diretamente, e NÃO entra em `deducoesExtras`.
  //
  // Teto (decisão do Wesley, 14/08): o ML nunca abate mais do que a própria
  // comissão bruta — um rebate maior que a comissão não existe no mundo
  // real. Se o usuário digitar um valor maior (típico: digitou o desconto
  // promocional TOTAL em vez de só a parte que o ML banca), o rebate
  // efetivo trava no teto da comissão bruta em vez de deixar `comissaoValor`
  // ficar negativo. `rebateExcedeComissao` avisa a tela quando isso ocorre.
  const rebateSolicitado = resolveExtra(price, input.rebate);
  const rebateValor = Math.min(rebateSolicitado, comissaoBruta);
  const rebateExcedeComissao =
    input.rebate.enabled && input.rebate.value > 0 && rebateSolicitado > comissaoBruta;
  const comissaoValor = comissaoBruta - rebateValor;

  // proportionalPct/fixedDeductions precisam refletir o MESMO rebateValor
  // travado acima — não o valor bruto digitado — senão breakEven e o preço
  // sugerido (reversePrice) divergem do resultado exibido aqui: a mesma
  // classe de bug que este debug corrigiu para o preço.
  const rebatePctEfetivo =
    input.rebate.mode === "percent" && price > 0 ? (rebateValor / price) * 100 : 0;
  const rebateAmtEfetivo = input.rebate.mode === "amount" ? rebateValor : 0;

  const cupomValor = resolveExtra(price, input.cupom);
  const afiliadoValor = resolveExtra(price, input.afiliado);
  const promoValor = resolveExtra(price, input.promo);

  const deducoesExtras = cupomValor + afiliadoValor + promoValor;

  const totalDeducoes =
    comissaoValor + input.fixedFee + input.shippingCost + imposto + difal + deducoesExtras;

  const receitaLiquida = price - totalDeducoes;
  const lucro = receitaLiquida - input.cost;
  const margemPct = price > 0 ? (lucro / price) * 100 : 0;
  const markupPct = input.cost > 0 ? (lucro / input.cost) * 100 : 0;
  const markupMultiplier = input.cost > 0 ? price / input.cost : 0;
  const roiPct = markupPct;

  const proportionalPct =
    input.commissionPct -
    rebatePctEfetivo +
    input.taxPct +
    (input.difalEnabled ? input.difalPct : 0) +
    extraAsPct(input.cupom) +
    extraAsPct(input.afiliado) +
    extraAsPct(input.promo);

  const fixedDeductions =
    input.fixedFee +
    input.shippingCost -
    rebateAmtEfetivo +
    extraAsAmount(input.cupom) +
    extraAsAmount(input.afiliado) +
    extraAsAmount(input.promo);

  const breakEvenDenom = 1 - proportionalPct / 100;
  const breakEven =
    breakEvenDenom > 0 ? (input.cost + fixedDeductions) / breakEvenDenom : 0;

  return {
    receitaBruta: price,
    comissaoBruta,
    comissaoValor,
    taxaFixa: input.fixedFee,
    frete: input.shippingCost,
    imposto,
    difal,
    rebateValor,
    rebateExcedeComissao,
    cupomValor,
    afiliadoValor,
    promoValor,
    deducoesExtras,
    totalDeducoes,
    receitaLiquida,
    custo: input.cost,
    lucro,
    margemPct,
    markupPct,
    markupMultiplier,
    roiPct,
    breakEven,
    proportionalPct,
    fixedDeductions,
  };
}

/**
 * Reverse calculator: minimum sale price needed to hit a target objective.
 * Returns null if target is unreachable (denominator ≤ 0).
 *
 * - mode "margin": target as % of price (lucro / price)
 * - mode "markup": target as % of cost (lucro / cost)
 */
export function reversePrice(
  input: Omit<PricingInput, "salePrice">,
  target: number,
  mode: ObjectiveMode,
): number | null {
  if (target <= 0) return null;

  const solve = (proportional: number, fixed: number): number | null => {
    if (mode === "margin") {
      const denom = 1 - (proportional + target) / 100;
      if (denom <= 0) return null;
      return (input.cost + fixed) / denom;
    }
    // Markup: lucro = cost * target/100  →  price - deductions - cost = cost * target/100
    // price * (1 - proportional/100) = cost * (1 + target/100) + fixed
    const denom = 1 - proportional / 100;
    if (denom <= 0) return null;
    return (input.cost * (1 + target / 100) + fixed) / denom;
  };

  // Compute proportional and fixed parts from the input directly because
  // deductions can be in R$ (which only counts toward `fixed`).
  // O rebate do ML abate a comissão (ver computePricing acima), por isso entra
  // com sinal invertido aqui — reduz o percentual/valor proporcional retido,
  // em vez de somar a ele como cupom/afiliado/promo.
  //
  // Teto em modo %: independente do preço (comissão e rebate escalam igual
  // com o preço), então trava direto sem circularidade — Math.min basta.
  const rebatePct =
    input.rebate.enabled && input.rebate.mode === "percent" && input.rebate.value > 0
      ? Math.min(input.rebate.value, input.commissionPct)
      : 0;

  const proportional =
    input.commissionPct -
    rebatePct +
    input.taxPct +
    (input.difalEnabled ? input.difalPct : 0) +
    extraAsPct(input.cupom) +
    extraAsPct(input.afiliado) +
    extraAsPct(input.promo);
  const fixed =
    input.fixedFee +
    input.shippingCost +
    extraAsAmount(input.cupom) +
    extraAsAmount(input.afiliado) +
    extraAsAmount(input.promo);

  // Teto em modo R$: o rebate é um valor fixo, mas o teto (não pode abater
  // mais que a comissão bruta = price * commissionPct / 100) DEPENDE do
  // preço que estamos resolvendo — dependência circular (price é a própria
  // incógnita). Resolve em duas fases:
  //
  // Fase 1 ("sem teto"): assume que o rebate cabe inteiro na comissão bruta
  // do preço resolvido — mesma fórmula de antes, rebate sai do `fixed`.
  // Se o preço resultante sustenta essa suposição (comissão bruta NAQUELE
  // preço >= rebate pedido), é a resposta certa.
  //
  // Fase 2 ("teto bate"): se não sustenta, a comissão líquida vira 0 no
  // preço-alvo — não `comissaoBruta − rebate` (que ficaria negativo). Isso
  // remove a comissão INTEIRA da equação (não só a parte do rebate): o termo
  // `commissionPct` sai do proporcional, e nada é subtraído do fixo (o
  // rebate não "sobra" além da comissão cheia). Reresolve nesse regime.
  const rebateAmt =
    input.rebate.enabled && input.rebate.mode === "amount" && input.rebate.value > 0
      ? input.rebate.value
      : 0;

  if (rebateAmt <= 0) {
    return solve(proportional, fixed);
  }

  if (input.commissionPct <= 0) {
    // Sem comissão não há nada pro rebate abater — contribui 0, igual a
    // estar sempre no teto (comissaoBruta é sempre 0 < rebateAmt > 0).
    return solve(proportional, fixed);
  }

  const uncappedPrice = solve(proportional, fixed - rebateAmt);
  const threshold = (rebateAmt * 100) / input.commissionPct; // preço onde comissaoBruta === rebateAmt

  if (uncappedPrice != null && uncappedPrice >= threshold) {
    // Ao preço resolvido, a comissão bruta já cobre o rebate pedido — teto
    // não bate, fase 1 é autoconsistente.
    return uncappedPrice;
  }

  // Teto bate: comissão líquida = 0 no preço-alvo.
  const cappedProportional = proportional - input.commissionPct;
  return solve(cappedProportional, fixed);
}

/** Color tier for margin-based UI badges. */
export function marginTier(pct: number): "good" | "warn" | "bad" {
  if (pct >= 20) return "good";
  if (pct >= 10) return "warn";
  return "bad";
}

export function parseNumber(input: string): number {
  if (!input) return 0;
  const cleaned = input.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : 0;
}

export const formatBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

export const formatPct = (v: number) => `${v.toFixed(1)}%`;