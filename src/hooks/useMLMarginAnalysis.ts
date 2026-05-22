import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";

const PAID = ["paid", "shipped", "delivered"] as const;

export interface MarginRow {
  receita: number;
  cmv: number;
  comissao: number;
  frete: number;
  impostos: number;
  lucro: number;
  lucro_pct: number | null;
  pedidos: number;
  unidades: number;
  has_cmv: boolean;
}

export interface ProductMarginRow extends MarginRow {
  item_id: string;
  titulo: string;
  sku: string | null;
  listing_type: string | null;
  curva: "A" | "B" | "C";
}

export interface DayMarginRow extends MarginRow {
  date: string;
}

export interface MarginSummary extends MarginRow {
  ticket_medio: number;
  lucro_medio_pedido: number;
}

export interface MarginAnalysisResult {
  summary: MarginSummary;
  daily: DayMarginRow[];
  byProduct: ProductMarginRow[];
  byBrand: (MarginRow & { marca: string })[];
  byEstado: (MarginRow & { estado: string })[];
}

export function useMLMarginAnalysis(dateFrom: string, dateTo: string) {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();

  return useQuery({
    queryKey: ["ml_margin_analysis", currentOrg?.id, resolvedMLUserIds, dateFrom, dateTo] as const,
    queryFn: async (): Promise<MarginAnalysisResult> => {
      if (!currentOrg?.id || !resolvedMLUserIds.length) return emptyResult();

      const { data, error } = await supabase
        .from("orders")
        .select(
          "data_pedido,receita_bruta,custo_unit,quantidade,comissao,frete,tax_amount,item_id,titulo,sku,marca,estado,listing_type",
        )
        .eq("organization_id", currentOrg.id)
        .in("ml_user_id", resolvedMLUserIds)
        .in("status", [...PAID])
        .gte("data_pedido", dateFrom)
        .lte("data_pedido", dateTo)
        .not("item_id", "is", null);

      if (error) throw error;
      const rows = data ?? [];

      // Aggregate maps
      const dayMap = new Map<string, DayMarginRow>();
      const productMap = new Map<string, ProductMarginRow>();
      const brandMap = new Map<string, MarginRow & { marca: string }>();
      const estadoMap = new Map<string, MarginRow & { estado: string }>();

      for (const r of rows) {
        const receita = (r.receita_bruta as number) ?? 0;
        const qty = (r.quantidade as number) ?? 1;
        const cmv = ((r.custo_unit as number) ?? 0) * qty;
        const comissao = (r.comissao as number) ?? 0;
        const frete = (r.frete as number) ?? 0;
        const impostos = (r.tax_amount as number) ?? 0;
        const lucro = receita - cmv - comissao - frete - impostos;
        const has_cmv = (r.custo_unit as number | null) != null;
        const date = ((r.data_pedido as string) ?? "").substring(0, 10);
        const item_id = r.item_id as string;
        const marca = (r.marca as string | null) ?? "Sem marca";
        const estado = (r.estado as string | null) ?? "Desconhecido";

        // day
        const d = dayMap.get(date) ?? { ...zeroMarginRow(), date };
        addToRow(d, receita, cmv, comissao, frete, impostos, lucro, qty, has_cmv);
        dayMap.set(date, d);

        // product
        const p = productMap.get(item_id) ?? {
          ...zeroMarginRow(),
          item_id,
          titulo: (r.titulo as string) ?? item_id,
          sku: (r.sku as string | null) ?? null,
          listing_type: (r.listing_type as string | null) ?? null,
          curva: "C" as const,
        };
        addToRow(p, receita, cmv, comissao, frete, impostos, lucro, qty, has_cmv);
        productMap.set(item_id, p);

        // brand
        const b = brandMap.get(marca) ?? { ...zeroMarginRow(), marca };
        addToRow(b, receita, cmv, comissao, frete, impostos, lucro, qty, has_cmv);
        brandMap.set(marca, b);

        // estado
        const e = estadoMap.get(estado) ?? { ...zeroMarginRow(), estado };
        addToRow(e, receita, cmv, comissao, frete, impostos, lucro, qty, has_cmv);
        estadoMap.set(estado, e);
      }

      // Compute lucro_pct for all maps
      finalizePct(dayMap);
      finalizePct(productMap);
      finalizePct(brandMap);
      finalizePct(estadoMap);

      // Curva ABC para produtos (por lucro_bruto R$, ordenado desc)
      const productsSorted = Array.from(productMap.values()).sort((a, b) => b.lucro - a.lucro);
      const totalLucroPositivo = productsSorted.reduce((s, p) => s + Math.max(p.lucro, 0), 0);
      let accLucro = 0;
      for (const p of productsSorted) {
        if (p.lucro > 0) accLucro += p.lucro;
        const pct = totalLucroPositivo > 0 ? accLucro / totalLucroPositivo : 1;
        p.curva = pct <= 0.8 ? "A" : pct <= 0.95 ? "B" : "C";
        productMap.set(p.item_id, p);
      }

      // Summary
      const summary = buildSummary(rows);

      // Daily sorted
      const daily = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));

      return {
        summary,
        daily,
        byProduct: productsSorted,
        byBrand: Array.from(brandMap.values()).sort((a, b) => b.lucro - a.lucro),
        byEstado: Array.from(estadoMap.values()).sort((a, b) => b.lucro - a.lucro),
      };
    },
    enabled: !!currentOrg?.id && resolvedMLUserIds.length > 0,
    staleTime: 2 * 60 * 1000,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function zeroMarginRow(): MarginRow {
  return {
    receita: 0,
    cmv: 0,
    comissao: 0,
    frete: 0,
    impostos: 0,
    lucro: 0,
    lucro_pct: null,
    pedidos: 0,
    unidades: 0,
    has_cmv: false,
  };
}

function emptyResult(): MarginAnalysisResult {
  return {
    summary: { ...zeroMarginRow(), ticket_medio: 0, lucro_medio_pedido: 0 },
    daily: [],
    byProduct: [],
    byBrand: [],
    byEstado: [],
  };
}

function addToRow(
  row: MarginRow,
  receita: number,
  cmv: number,
  comissao: number,
  frete: number,
  impostos: number,
  lucro: number,
  qty: number,
  has_cmv: boolean,
) {
  row.receita += receita;
  row.cmv += cmv;
  row.comissao += comissao;
  row.frete += frete;
  row.impostos += impostos;
  row.lucro += lucro;
  row.pedidos += 1;
  row.unidades += qty;
  if (has_cmv) row.has_cmv = true;
}

function finalizePct(map: Map<string, MarginRow & Record<string, unknown>>) {
  for (const row of map.values()) {
    row.lucro_pct =
      row.receita > 0 ? Math.round((row.lucro / row.receita) * 10000) / 100 : null;
  }
}

function buildSummary(rows: Record<string, unknown>[]): MarginSummary {
  const s = zeroMarginRow();
  for (const r of rows) {
    const receita = (r.receita_bruta as number) ?? 0;
    const qty = (r.quantidade as number) ?? 1;
    const cmv = ((r.custo_unit as number) ?? 0) * qty;
    const comissao = (r.comissao as number) ?? 0;
    const frete = (r.frete as number) ?? 0;
    const impostos = (r.tax_amount as number) ?? 0;
    const lucro = receita - cmv - comissao - frete - impostos;
    const has_cmv = (r.custo_unit as number | null) != null;
    addToRow(s, receita, cmv, comissao, frete, impostos, lucro, qty, has_cmv);
  }
  s.lucro_pct = s.receita > 0 ? Math.round((s.lucro / s.receita) * 10000) / 100 : null;
  const ticket_medio = s.pedidos > 0 ? Math.round((s.receita / s.pedidos) * 100) / 100 : 0;
  const lucro_medio_pedido =
    s.pedidos > 0 ? Math.round((s.lucro / s.pedidos) * 100) / 100 : 0;
  return { ...s, ticket_medio, lucro_medio_pedido };
}
