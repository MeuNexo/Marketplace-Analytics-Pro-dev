import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import type { VendaDiaOrigem, LeadTimeOrigem, StatusEsgotado } from "@/lib/analysis/replenishmentUtils";

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
  /** null quando o SKU so existe no Tiny (sem anuncio ML). Nunca a string "null". */
  item_id: string | null;
  variation_id: string | null;
  title: string | null;
  brand: string | null;
  sku_code: string | null;
  attribute_combinations: AttributeCombination[] | null;
  /** Label legível das variações (ex: "Natural / G") — derivado de attribute_combinations */
  attribute_combinations_label: string;
  logistic_type: string | null;
  /** Full (ML) + CD (Tiny). E a base de decisao de compra (D-3). */
  sku_stock: number;
  /** Parte do sku_stock que vem do Full do ML (D-2). */
  estoque_full: number;
  /** Parte do sku_stock que vem do deposito CD Expedicao do Tiny (D-5). */
  estoque_cd: number;
  /**
   * INFORMATIVO: saldo em 'Centro de distribuicao'. FORA do calculo por D-5.
   * Existe para a divergencia aparecer na tela em vez de ficar silenciosa —
   * medidas 794 unidades aqui em 2026-08-04, 38,5% do estoque proprio.
   */
  estoque_centro: number;
  /** false => o item apenas SINALIZA; compra_sugerida e sempre 0 (D-1). */
  tem_anuncio_ativo: boolean;
  origem_catalogo: "ml" | "tiny";
  /** Full do Tiny menos Full do ML. null quando o Tiny nao conhece o SKU. */
  divergencia_full: number | null;
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
  param_origem: "sku" | "fornecedor" | "marca" | "global";
  /** Quantidade já comprada e a caminho (OCs em aberto no Tiny) — Phase 65 */
  qtd_a_caminho: number;
  /** Data da próxima chegada (menor data_entrega futura das OCs do SKU) — Phase 65 */
  data_proxima_chegada: string | null;
  /** Como venda_dia foi calculado — Phase 67 (p_smart) */
  venda_dia_origem: VendaDiaOrigem;
  /** Origem do lead time — Phase 67 */
  lead_time_origem: LeadTimeOrigem;
  /** Tendência recente vs anterior — Phase 67 */
  tendencia: "↑" | "↓" | "~";
  /** Fator sazonal aplicado (null se não aplicado) — Phase 67 */
  fator_sazonal: number | null;
  /** Mediana real de lead time em dias (null se fornecedor sem OCs suficientes) — Phase 67 */
  lead_time_real: number | null;
  /** Venda diária simples = média da janela (a espinha que decide a compra) — Phase 68 */
  venda_simples: number;
  /** Venda diária inteligente = EWMA × sazonal (boost-only); null quando sem sinal — Phase 68 */
  venda_inteligente: number | null;
  /** Balde de recência para esgotados — Phase 69 (ESGOT-01) */
  status_esgotado: StatusEsgotado;
}

/**
 * Linha de anúncio agrupada com suas variações (para o drill anúncio → variações).
 * Exposta como `grouped` pelo hook.
 */
export interface GroupedReplenishmentRow {
  /** null quando o grupo e um SKU so-Tiny, sem anuncio (ver chaveGrupo). */
  item_id: string | null;
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
    item_id:                      r.item_id != null ? String(r.item_id) : null,
    variation_id:                 r.variation_id != null ? String(r.variation_id) : null,
    title:                        r.title != null ? String(r.title) : null,
    brand:                        r.brand != null ? String(r.brand) : null,
    sku_code:                     r.sku_code != null ? String(r.sku_code) : null,
    attribute_combinations:       attrCombinations,
    attribute_combinations_label: deriveAttributeLabel(attrCombinations),
    logistic_type:                r.logistic_type != null ? String(r.logistic_type) : null,
    sku_stock:                    Number(r.sku_stock),
    estoque_full:                 Number(r.estoque_full ?? 0),
    estoque_cd:                   Number(r.estoque_cd ?? 0),
    estoque_centro:               Number(r.estoque_centro ?? 0),
    tem_anuncio_ativo:            Boolean(r.tem_anuncio_ativo),
    origem_catalogo:              r.origem_catalogo === "tiny" ? "tiny" : "ml",
    divergencia_full:             r.divergencia_full != null ? Number(r.divergencia_full) : null,
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
    param_origem:                 (r.param_origem as "sku" | "fornecedor" | "marca" | "global") ?? "global",
    qtd_a_caminho:                Number(r.qtd_a_caminho ?? 0),
    data_proxima_chegada:         r.data_proxima_chegada != null ? String(r.data_proxima_chegada) : null,
    // Phase 67 — 5 colunas de transparência (Pitfall 5: acesso via Record<string,unknown> com fallback seguro)
    venda_dia_origem:             ((r.venda_dia_origem as string) ?? "simples") as VendaDiaOrigem,
    lead_time_origem:             ((r.lead_time_origem as string) ?? "param") as LeadTimeOrigem,
    tendencia:                    ((r.tendencia as string) ?? "~") as "↑" | "↓" | "~",
    fator_sazonal:                r.fator_sazonal != null ? Number(r.fator_sazonal) : null,
    lead_time_real:               r.lead_time_real != null ? Number(r.lead_time_real) : null,
    // Phase 68 — exibe OS DOIS indicadores (simples = espinha; inteligente = EWMA×sazonal só em alta confiança)
    venda_simples:                Number(r.venda_simples ?? 0),
    venda_inteligente:            r.venda_inteligente == null ? null : Number(r.venda_inteligente),
    // Phase 69 — balde de recência para esgotados (ESGOT-01); fallback seguro 'com_giro' quando ausente
    status_esgotado:              ((r.status_esgotado as string) ?? "com_giro") as StatusEsgotado,
  };
}

/**
 * Chave de agrupamento do drill anuncio -> variacoes.
 *
 * SKU que so existe no Tiny tem `item_id = null`. Agrupar por `item_id` cru
 * jogaria TODOS eles no mesmo balde e os 476 itens de "sinalizar" virariam UMA
 * linha — a tela pareceria funcionar e estaria errada. Cai para o SKU quando
 * nao ha anuncio.
 */
export function chaveGrupo(row: ReplenishmentSkuRow): string {
  return row.item_id ?? `sku:${row.sku_code ?? ""}`;
}

/** Agrupa linhas por anúncio (ou por SKU, quando não há anúncio) */
function groupByItem(rows: ReplenishmentSkuRow[]): GroupedReplenishmentRow[] {
  const map = new Map<string, GroupedReplenishmentRow>();

  for (const row of rows) {
    const chave = chaveGrupo(row);
    const existing = map.get(chave);
    if (!existing) {
      map.set(chave, {
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
 * @param smartMode        - Ativa cálculo esperto EWMA+sazonal+lead time real (default true) — Phase 67 D-10
 */
export function useReplenishmentBySku(
  salesWindowDays = 30,
  demandMultiplier = 1.0,
  smartMode = true,
) {
  const { currentOrg } = useOrganization();

  return useQuery({
    queryKey: ["get_replenishment_by_sku", currentOrg?.id, salesWindowDays, demandMultiplier, smartMode] as const,
    queryFn: async (): Promise<{ rows: ReplenishmentSkuRow[]; grouped: GroupedReplenishmentRow[] }> => {
      if (!currentOrg?.id) return { rows: [], grouped: [] };

      const { data, error } = await supabase.rpc("get_replenishment_by_sku", {
        p_org_id:             currentOrg.id,
        p_sales_window_days:  salesWindowDays,
        p_demand_multiplier:  demandMultiplier,
        p_smart:              smartMode,   // Phase 67 — EXPLÍCITO; nunca undefined (Pitfall 1)
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
