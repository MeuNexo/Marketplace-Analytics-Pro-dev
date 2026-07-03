/**
 * Util puro de resumo de variações do anúncio para o seletor de
 * `/analise-precos` (Phase 82) — opções do dropdown, contagem de
 * esgotadas (aviso do nível pai) e lookup de estoque por SKU.
 *
 * Vínculo SEMPRE por SKU (`seller_custom_field`), NUNCA `variation_id`
 * (validado com dados reais: orders.variation_id casa 0/43; orders.sku
 * casa 43/43 com seller_custom_field). Zero I/O, sem imports de UI/rede.
 */
import type { ProductVariation } from "@/contexts/MLInventoryContext";

export interface VariacaoOption {
  sku: string;
  label: string;
  estoque: number;
  esgotada: boolean;
}

export interface ResumoVariacoes {
  total: number;
  esgotadas: number;
  opcoes: VariacaoOption[];
}

/**
 * Resumo das variações de um anúncio: total, nº de esgotadas (sobre TODAS
 * as variações, com ou sem SKU — é o número do aviso do pai) e as opções
 * selecionáveis do dropdown (só variações com SKU não-nulo/não-vazio —
 * sem SKU não há como filtrar vendas por join). Opções ordenadas por
 * estoque desc.
 */
export function resumoVariacoes(variations: ProductVariation[]): ResumoVariacoes {
  const total = variations.length;
  const esgotadas = variations.filter((v) => v.available_quantity <= 0).length;

  const opcoes: VariacaoOption[] = variations
    .filter((v) => v.seller_custom_field != null && v.seller_custom_field !== "")
    .map((v) => {
      const atributos = v.attribute_combinations.length > 0
        ? v.attribute_combinations.map((a) => a.value).join(" / ")
        : "Variação";
      return {
        sku: v.seller_custom_field as string,
        label: `${atributos} · ${v.seller_custom_field} · ${v.available_quantity} und`,
        estoque: v.available_quantity,
        esgotada: v.available_quantity <= 0,
      };
    })
    .sort((a, b) => b.estoque - a.estoque);

  return { total, esgotadas, opcoes };
}

/**
 * Estoque (available_quantity) da variação cujo seller_custom_field === sku.
 * Retorna null se sku é nulo/vazio ou nenhuma variação casa — nunca 0 por
 * ausência (a UI/precoFaixas tratam null como "cobertura não computável").
 */
export function estoqueDaVariacao(variations: ProductVariation[], sku: string | null): number | null {
  if (sku == null || sku === "") return null;
  const found = variations.find((v) => v.seller_custom_field === sku);
  return found ? found.available_quantity : null;
}
