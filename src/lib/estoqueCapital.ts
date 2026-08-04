// ============================================================================
// estoqueCapital.ts — Fase 213, Plano 01, Task 2 (CR-05)
//
// Régua: capital imobilizado é CMV × quantidade — não preço × quantidade.
// Preço × quantidade é receita potencial (quanto o estoque valeria se vendido
// inteiro ao preço de tabela), uma pergunta diferente que não decide desconto
// nem liquidação. Na Pé Vermeio, confundir as duas infla o "capital parado"
// pelo markup inteiro, tipicamente 2 a 3×.
//
// Módulo puro: só tipos e aritmética, nenhum import de React, de Supabase ou
// de rede.
// ============================================================================

import type { CoverageClass } from "@/hooks/useMLCoverage";

/** Forma mínima de uma linha de `ml_product_costs` — só o campo que este módulo usa. */
export interface EntradaCusto {
  cost: number | null;
}

/** Item de estoque com o mínimo necessário para resolver custo e agregar capital. */
export interface ItemEstoqueCapital {
  id: string;
  available_quantity: number;
  seller_custom_field: string | null;
}

export type CapitalPorClasse = Record<CoverageClass, number>;

export interface CapitalAgregado {
  porClasse: CapitalPorClasse;
  /** Ruptura + Crítico */
  risco: number;
  /** Sem giro */
  parado: number;
  /** OK */
  saudavel: number;
  /** Quantos SKUs considerados não têm custo cadastrado em nenhum dos dois índices */
  skusSemCusto: number;
  /** Unidades desses SKUs sem custo — ficam fora do numerador em reais */
  unidadesSemCusto: number;
  /** SKUs com custo ÷ SKUs considerados, em percentual. Nulo quando não há SKU nenhum. */
  coberturaCmvPct: number | null;
}

/**
 * Resolve o custo de um item: primeiro pelo `item_id` (entrada manual, mais
 * específica), na ausência pelo SKU do anúncio (sync do Tiny). Mesma
 * precedência de `costFor` em `MLAnuncios.tsx`.
 *
 * Devolve `null` quando não há custo em nenhum dos dois índices — nunca `0`,
 * nunca o preço. Regra inegociável: SKU sem custo não recebe fallback.
 */
export function custoDoItem(
  itemId: string,
  sku: string | null,
  custosPorItem: ReadonlyMap<string, EntradaCusto>,
  custosPorSku: ReadonlyMap<string, EntradaCusto>,
): number | null {
  const entrada = custosPorItem.get(itemId) ?? (sku ? custosPorSku.get(sku) : undefined);
  return entrada?.cost ?? null;
}

/**
 * Agrega capital imobilizado (custo × quantidade) por classe de cobertura.
 *
 * SKU sem custo não recebe fallback silencioso: sai do numerador em reais e
 * entra na contagem de faltantes (`skusSemCusto` / `unidadesSemCusto`) — a
 * mesma disciplina do `has_cmv` em `/produtos-vendidos` e do `naoRateado` do
 * rateio de ads. Item com quantidade zero contribui zero para o capital,
 * qualquer que seja o custo, porque a própria multiplicação já resolve isso.
 */
export function agregarCapitalPorClasse(
  itens: ItemEstoqueCapital[],
  classePorItem: ReadonlyMap<string, CoverageClass>,
  custosPorItem: ReadonlyMap<string, EntradaCusto>,
  custosPorSku: ReadonlyMap<string, EntradaCusto>,
): CapitalAgregado {
  const porClasse: CapitalPorClasse = { ruptura: 0, critico: 0, alerta: 0, ok: 0, sem_giro: 0 };
  let skusSemCusto = 0;
  let unidadesSemCusto = 0;
  let skusComCusto = 0;

  for (const item of itens) {
    const custo = custoDoItem(item.id, item.seller_custom_field, custosPorItem, custosPorSku);
    const cls = classePorItem.get(item.id) ?? "sem_giro";

    if (custo === null) {
      skusSemCusto++;
      unidadesSemCusto += item.available_quantity;
      continue;
    }

    skusComCusto++;
    porClasse[cls] += custo * item.available_quantity;
  }

  const skusConsiderados = itens.length;
  const coberturaCmvPct = skusConsiderados > 0 ? (skusComCusto / skusConsiderados) * 100 : null;

  return {
    porClasse,
    risco: porClasse.ruptura + porClasse.critico,
    parado: porClasse.sem_giro,
    saudavel: porClasse.ok,
    skusSemCusto,
    unidadesSemCusto,
    coberturaCmvPct,
  };
}
