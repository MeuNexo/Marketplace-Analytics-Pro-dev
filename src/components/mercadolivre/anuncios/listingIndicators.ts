/**
 * Utilitários puros para indicadores de anúncio ML.
 * Zero fetch, zero React — módulo puro importável por componentes e testes.
 */
import type { ProductItem, ProductVariation } from "@/contexts/MLInventoryContext";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface QualityBand {
  /** Percentual inteiro (0–100) ou null quando health é null */
  pct: number | null;
  /** Faixa de classificação */
  band: "bom" | "medio" | "ruim" | "sem_dado";
  /** Rótulo legível em PT-BR */
  label: string;
}

export interface LogisticBucket {
  /** Valor bruto do logistic_type (ex: "fulfillment", "sem_info") */
  type: string;
  /** Rótulo legível (ex: "Full", "Cross-docking") */
  label: string;
  /** Estoque total do bucket */
  stock: number;
}

// ─── Mapeamento de tipo logístico ─────────────────────────────────────────────

/**
 * Converte o valor bruto de logistic_type em rótulo PT-BR.
 * Espelha os filtros LogisticFilter de MLAnuncios.tsx.
 */
export function logisticTypeLabel(type: string): string {
  switch (type) {
    case "fulfillment":    return "Full";
    case "cross_docking":  return "Cross-docking";
    case "self_service":   return "Flex";
    case "drop_off":       return "Agência/Correios";
    default:               return "Sem info";
  }
}

// ─── Faixa de quality score ───────────────────────────────────────────────────

/**
 * Converte health (0–1 ou null) na faixa de qualidade do anúncio.
 * Thresholds idênticos ao healthBadge atual de MLAnuncios.tsx (0.8 / 0.5).
 */
export function qualityScoreBand(health: number | null): QualityBand {
  if (health === null) {
    return { pct: null, band: "sem_dado", label: "Sem dado" };
  }
  const pct = Math.round(health * 100);
  if (health >= 0.8) return { pct, band: "bom",   label: "Boa"     };
  if (health >= 0.5) return { pct, band: "medio",  label: "Regular" };
  return                    { pct, band: "ruim",   label: "Baixa"   };
}

// ─── Agregação de tipo logístico ──────────────────────────────────────────────

type LogisticItem = Pick<ProductItem, "logistic_type" | "available_quantity" | "variations">;

/**
 * Agrega o estoque por tipo logístico do anúncio.
 *
 * Obs.: `ProductVariation` não possui campo `logistic_type` — todas as variações
 * compartilham o `logistic_type` do item pai. Por isso o agrupamento resulta em
 * um único bucket na prática; a estrutura de array está preparada para futuras
 * extensões (multi-fulfillment, etc.).
 *
 * - Sem variações: 1 bucket com logistic_type + available_quantity do item.
 * - Com variações: agrupa por logistic_type do item, somando available_quantity
 *   de cada variação.
 * - logistic_type null/"" → bucket com type "sem_info".
 *
 * Retorna array ordenado por stock desc.
 */
export function aggregateLogisticType(item: LogisticItem): LogisticBucket[] {
  const rawType = item.logistic_type || "sem_info";

  if (item.variations.length === 0) {
    return [
      { type: rawType, label: logisticTypeLabel(rawType), stock: item.available_quantity },
    ];
  }

  // Agrupar por tipo logístico (todas as variações compartilham item.logistic_type)
  const bucketMap = new Map<string, number>();
  for (const v of item.variations) {
    const type = rawType; // variações não têm logistic_type próprio
    bucketMap.set(type, (bucketMap.get(type) ?? 0) + v.available_quantity);
  }

  return Array.from(bucketMap.entries())
    .map(([type, stock]) => ({ type, label: logisticTypeLabel(type), stock }))
    .sort((a, b) => b.stock - a.stock);
}
