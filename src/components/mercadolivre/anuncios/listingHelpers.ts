/**
 * Helpers compartilhados para componentes de anúncio ML.
 * Espelham as funções definidas em MLAnuncios.tsx para que o
 * modal (e futuramente a página refatorada) usem a mesma fonte.
 *
 * Zero fetch, zero React — módulo puro.
 */
import { LISTING_TYPE_RATES } from "@/data/financialMockData";

// ─── Comissão e rótulo de tipo de anúncio ─────────────────────────────────────

export function getCommissionRate(listingTypeId: string | null): number {
  if (!listingTypeId) return LISTING_TYPE_RATES.classic.rate;
  if (listingTypeId.includes("gold_pro") || listingTypeId.includes("premium"))
    return LISTING_TYPE_RATES.premium.rate;
  if (listingTypeId.includes("free")) return LISTING_TYPE_RATES.free.rate;
  return LISTING_TYPE_RATES.classic.rate;
}

export function getListingLabel(listingTypeId: string | null): string {
  if (!listingTypeId) return "Clássico";
  if (listingTypeId.includes("gold_pro") || listingTypeId.includes("premium"))
    return "Premium";
  if (listingTypeId.includes("free")) return "Grátis";
  return "Clássico";
}

// ─── Formatação de moeda ──────────────────────────────────────────────────────

export const currencyFmt = (v: number): string =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ─── URL canônica do anúncio no ML ────────────────────────────────────────────

/**
 * Converte "MLB123456" → "https://produto.mercadolivre.com.br/MLB-123456"
 * Mesmo padrão usado na coluna de título em MLAnuncios.tsx.
 */
export function mlListingUrl(id: string): string {
  return `https://produto.mercadolivre.com.br/${id.replace(/^(MLB)(\d+)$/, "$1-$2")}`;
}
