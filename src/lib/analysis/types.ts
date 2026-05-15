/**
 * Motor de análise puro — sem dependências React ou Supabase.
 *
 * Define os contratos de dados usados por computeAnalysis e consumidos
 * pelo hook de snapshots e pelo Dashboard de Análise.
 */

/** Registro de pedido proveniente da tabela `orders` do Supabase. */
export interface OrderRecord {
  id: string;
  /** Preço unitário praticado no pedido. */
  price: number;
  /** Quantidade de unidades vendidas. */
  quantity: number;
  /** Data do pedido no formato YYYY-MM-DD. */
  order_date: string;
  ml_user_id: string;
  item_id: string;
  title: string;
  brand: string | null;
}

/** Resultado do agrupamento de pedidos por faixa de preço (MOTOR-01). */
export interface PriceBucket {
  /** Preço unitário do grupo. */
  price: number;
  /** Total de unidades vendidas neste preço. */
  units: number;
  /** GMV total (price × units). */
  gmv: number;
  /** Quantidade de dias distintos com vendas neste preço. */
  activeDays: number;
  /** Venda diária média: units / periodDays (período total, não activeDays). */
  dailyAvg: number;
  /** Participação em volume: units / totalUnits (0-1). */
  volShare: number;
  /** Participação em GMV: gmv / totalGmv (0-1). */
  gmvShare: number;
}

/** Classificação de elasticidade por R$1,00 acima do Preço GMV. */
export type ElasticityClass = "baixa" | "media" | "alta" | "extrema";

/** Saída completa de computeAnalysis, contendo a curva e os três preços recomendados. */
export interface AnalysisResult {
  /** Curva Preço × Volume ordenada por preço ASC. */
  priceCurve: PriceBucket[];
  /** Preço com maior venda diária (MOTOR-02). */
  priceGmv: number;
  /** Maior preço com volume qualificado (MOTOR-03). */
  priceMargin: number;
  /** Preço real mais próximo da média ponderada no intervalo [priceGmv, priceMargin] (MOTOR-04). */
  priceNeutral: number;
  /** Percentual de perda de volume por R$1,00 acima do priceGmv (MOTOR-05). */
  elasticityPct: number;
  /** Classificação da elasticidade (MOTOR-05). */
  elasticityClass: ElasticityClass;
}
