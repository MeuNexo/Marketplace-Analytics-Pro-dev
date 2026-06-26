import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";

// ── Tipos exportados ───────────────────────────────────────────────────────────

/** Atributo de variação (Cor/Tamanho) retornado pela RPC */
export interface AttributeCombination {
  id: string;
  name: string;
  value: string;
}

/**
 * Uma linha por SKU retornada pela RPC `get_replenishment_by_sku`.
 * variation_id = null → anúncio sem variação (SKU único).
 * param_origem: 'sku' | 'marca' | 'global' — espelha a CTE params da RPC (CMP-05).
 */
export interface ReplenishmentSkuRow {
  item_id: string;
  variation_id: string | null;
  title: string | null;
  brand: string | null;
  sku_code: string | null;
  attribute_combinations: AttributeCombination[] | null;
  /** Label legível das variações (ex: "Natural / G") — derivado de attribute_combinations */
  attribute_combinations_label: string;
  logistic_type: string | null;
  sku_stock: number;
  venda_dia: number;
  cobertura_atual: number | null;
  ponto_reposicao: number;
  alvo: number;
  compra_sugerida: number;
  valor_estimado: number | null;
  custo_ausente: boolean;
  sem_giro: boolean;
  gatilho_ativo: boolean;
  param_lead_time: number;
  param_cobertura: number;
  param_safety: number;
  param_moq: number;
  param_pack: number;
  param_origem: "sku" | "marca" | "global";
  /** Quantidade já comprada e a caminho (OCs em aberto no Tiny) — Phase 65 */
  qtd_a_caminho: number;
  /** Data da próxima chegada (menor data_entrega futura das OCs do SKU) — Phase 65 */
  data_proxima_chegada: string | null;
}

/**
 * Linha de anúncio agrupada com suas variações (para o drill anúncio → variações).
 * Exposta como `grouped` pelo hook.
 */
export interface GroupedReplenishmentRow {
  item_id: string;
  title: string | null;
  brand: string | null;
  logistic_type: string | null;
  /** Variações (ou item único) do anúncio */
  skus: ReplenishmentSkuRow[];
  /** Soma de compra_sugerida de todas as variações do anúncio */
  total_compra_sugerida: number;
  /** Soma de valor_estimado (null se qualquer variação não tiver custo) */
  total_valor_estimado: number | null;
  /** true se ao menos uma variação tiver gatilho_ativo */
  any_gatilho_ativo: boolean;
  /** true se ao menos uma variação tiver custo_ausente */
  any_custo_ausente: boolean;
  /** Soma de qtd_a_caminho de todas as variações do anúncio — Phase 65 */
  total_a_caminho: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Deriva um label legível das variações: "Natural / G", "Azul / M" etc.
 * Se attribute_combinations estiver ausente, retorna string vazia.
 */
function deriveAttributeLabel(combinations: AttributeCombination[] | null): string {
  if (!combinations || combinations.length === 0) return "";
  return combinations.map((a) => a.value).filter(Boolean).join(" / ");
}

/** Mapeia uma linha raw da RPC para ReplenishmentSkuRow com tipos corretos */
function mapRow(r: Record<string, unknown>): ReplenishmentSkuRow {
  let attrCombinations: AttributeCombination[] | null = null;
  if (r.attribute_combinations != null) {
    try {
      const raw = typeof r.attribute_combinations === "string"
        ? JSON.parse(r.attribute_combinations)
        : r.attribute_combinations;
      if (Array.isArray(raw)) {
        attrCombinations = raw.map((a: Record<string, unknown>) => ({
          id:    String(a.id ?? ""),
          name:  String(a.name ?? ""),
          value: String(a.value ?? ""),
        }));
      }
    } catch {
      attrCombinations = null;
    }
  }

  return {
    item_id:                      String(r.item_id),
    variation_id:                 r.variation_id != null ? String(r.variation_id) : null,
    title:                        r.title != null ? String(r.title) : null,
    brand:                        r.brand != null ? String(r.brand) : null,
    sku_code:                     r.sku_code != null ? String(r.sku_code) : null,
    attribute_combinations:       attrCombinations,
    attribute_combinations_label: deriveAttributeLabel(attrCombinations),
    logistic_type:                r.logistic_type != null ? String(r.logistic_type) : null,
    sku_stock:                    Number(r.sku_stock),
    venda_dia:                    Number(r.venda_dia),
    cobertura_atual:              r.cobertura_atual != null ? Number(r.cobertura_atual) : null,
    ponto_reposicao:              Number(r.ponto_reposicao),
    alvo:                         Number(r.alvo),
    compra_sugerida:              Number(r.compra_sugerida),
    valor_estimado:               r.valor_estimado != null ? Number(r.valor_estimado) : null,
    custo_ausente:                Boolean(r.custo_ausente),
    sem_giro:                     Boolean(r.sem_giro),
    gatilho_ativo:                Boolean(r.gatilho_ativo),
    param_lead_time:              Number(r.param_lead_time),
    param_cobertura:              Number(r.param_cobertura),
    param_safety:                 Number(r.param_safety),
    param_moq:                    Number(r.param_moq),
    param_pack:                   Number(r.param_pack),
    param_origem:                 (r.param_origem as "sku" | "marca" | "global") ?? "global",
    qtd_a_caminho:                Number(r.qtd_a_caminho ?? 0),
    data_proxima_chegada:         r.data_proxima_chegada != null ? String(r.data_proxima_chegada) : null,
  };
}

/** Agrupa linhas por item_id para o drill anúncio → variações */
function groupByItem(rows: ReplenishmentSkuRow[]): GroupedReplenishmentRow[] {
  const map = new Map<string, GroupedReplenishmentRow>();

  for (const row of rows) {
    const existing = map.get(row.item_id);
    if (!existing) {
      map.set(row.item_id, {
        item_id:               row.item_id,
        title:                 row.title,
        brand:                 row.brand,
        logistic_type:         row.logistic_type,
        skus:                  [row],
        total_compra_sugerida: row.compra_sugerida,
        total_valor_estimado:  row.valor_estimado,
        any_gatilho_ativo:     row.gatilho_ativo,
        any_custo_ausente:     row.custo_ausente,
        total_a_caminho:       row.qtd_a_caminho,
      });
    } else {
      existing.skus.push(row);
      existing.total_compra_sugerida += row.compra_sugerida;
      // Se qualquer variação tem custo ausente → total estimado = null
      existing.total_valor_estimado =
        existing.total_valor_estimado != null && row.valor_estimado != null
          ? existing.total_valor_estimado + row.valor_estimado
          : null;
      if (row.gatilho_ativo) existing.any_gatilho_ativo = true;
      if (row.custo_ausente) existing.any_custo_ausente = true;
      existing.total_a_caminho += row.qtd_a_caminho;
    }
  }

  return Array.from(map.values());
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Busca dados de reposição por SKU/variação via RPC `get_replenishment_by_sku`.
 *
 * - Escopado por `currentOrg.id` (SECURITY INVOKER — sem fuga de tenant)
 * - Expõe `rows` (flat, uma linha por SKU) e `grouped` (agrupado por anúncio para drill)
 * - Paginação: sem .range() por padrão (~116 anúncios × ~4 variações ≈ 464 SKUs no Pé Vermeio)
 *
 * @param salesWindowDays  - Janela de venda em dias (default 30)
 * @param demandMultiplier - Multiplicador de campanha (default 1.0)
 */
export function useReplenishmentBySku(
  salesWindowDays = 30,
  demandMultiplier = 1.0,
) {
  const { currentOrg } = useOrganization();

  return useQuery({
    queryKey: ["get_replenishment_by_sku", currentOrg?.id, salesWindowDays, demandMultiplier] as const,
    queryFn: async (): Promise<{ rows: ReplenishmentSkuRow[]; grouped: GroupedReplenishmentRow[] }> => {
      if (!currentOrg?.id) return { rows: [], grouped: [] };

      const { data, error } = await supabase.rpc("get_replenishment_by_sku", {
        p_org_id:             currentOrg.id,
        p_sales_window_days:  salesWindowDays,
        p_demand_multiplier:  demandMultiplier,
      });

      if (error) throw error;

      const rows = (data ?? []).map((r: Record<string, unknown>) => mapRow(r));
      const grouped = groupByItem(rows);

      return { rows, grouped };
    },
    enabled:   !!currentOrg?.id,
    staleTime: 5 * 60 * 1000,
  });
}
