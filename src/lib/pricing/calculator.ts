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
  comissaoValor: number;
  taxaFixa: number;
  frete: number;
  imposto: number;
  difal: number;
  rebateValor: number;
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

  const comissaoValor = (price * input.commissionPct) / 100;
  const imposto = (price * input.taxPct) / 100;
  const difal = input.difalEnabled ? (price * input.difalPct) / 100 : 0;

  const rebateValor = resolveExtra(price, input.rebate);
  const cupomValor = resolveExtra(price, input.cupom);
  const afiliadoValor = resolveExtra(price, input.afiliado);
  const promoValor = resolveExtra(price, input.promo);

  const deducoesExtras = rebateValor + cupomValor + afiliadoValor + promoValor;

  const totalDeducoes =
    comissaoValor + input.fixedFee + input.shippingCost + imposto + difal + deducoesExtras;

  const receitaLiquida = price - totalDeducoes;
  const lucro = receitaLiquida - input.cost;
  const margemPct = price > 0 ? (lucro / price) * 100 : 0;
  const markupPct = input.cost > 0 ? (lucro / input.cost) * 100 : 0;
  const markupMultiplier = input.cost > 0 ? price / input.cost : 0;
  const roiPct = markupPct;

  const proportionalPct =
    input.commissionPct +
    input.taxPct +
    (input.difalEnabled ? input.difalPct : 0) +
    extraAsPct(input.rebate) +
    extraAsPct(input.cupom) +
    extraAsPct(input.afiliado) +
    extraAsPct(input.promo);

  const fixedDeductions =
    input.fixedFee +
    input.shippingCost +
    extraAsAmount(input.rebate) +
    extraAsAmount(input.cupom) +
    extraAsAmount(input.afiliado) +
    extraAsAmount(input.promo);

  const breakEvenDenom = 1 - proportionalPct / 100;
  const breakEven =
    breakEvenDenom > 0 ? (input.cost + fixedDeductions) / breakEvenDenom : 0;

  return {
    receitaBruta: price,
    comissaoValor,
    taxaFixa: input.fixedFee,
    frete: input.shippingCost,
    imposto,
    difal,
    rebateValor,
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
  // Compute proportional and fixed parts from the input directly because
  // deductions can be in R$ (which only counts toward `fixed`).
  const proportional =
    input.commissionPct +
    input.taxPct +
    (input.difalEnabled ? input.difalPct : 0) +
    extraAsPct(input.rebate) +
    extraAsPct(input.cupom) +
    extraAsPct(input.afiliado) +
    extraAsPct(input.promo);
  const fixed =
    input.fixedFee +
    input.shippingCost +
    extraAsAmount(input.rebate) +
    extraAsAmount(input.cupom) +
    extraAsAmount(input.afiliado) +
    extraAsAmount(input.promo);

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