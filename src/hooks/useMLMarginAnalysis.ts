import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";

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

      const orgId = currentOrg.id;
      const from  = dateFrom.substring(0, 10);
      const to    = dateTo.substring(0, 10);

      // Todas as 5 queries em paralelo — o Postgres agrega, o browser só recebe resumos
      const [summaryRes, dayRes, productRes, brandRes, estadoRes] = await Promise.all([
        supabase.rpc("get_margin_summary", {
          p_org_id: orgId, p_user_ids: resolvedMLUserIds, p_from: from, p_to: to,
        }),
        supabase.rpc("get_margin_by_day", {
          p_org_id: orgId, p_user_ids: resolvedMLUserIds, p_from: from, p_to: to,
        }),
        supabase.rpc("get_margin_by_product", {
          p_org_id: orgId, p_user_ids: resolvedMLUserIds, p_from: from, p_to: to,
        }),
        supabase.rpc("get_margin_by_brand", {
          p_org_id: orgId, p_user_ids: resolvedMLUserIds, p_from: from, p_to: to,
        }),
        supabase.rpc("get_margin_by_estado", {
          p_org_id: orgId, p_user_ids: resolvedMLUserIds, p_from: from, p_to: to,
        }),
      ]);

      if (summaryRes.error) throw summaryRes.error;
      if (dayRes.error)     throw dayRes.error;
      if (productRes.error) throw productRes.error;
      if (brandRes.error)   throw brandRes.error;
      if (estadoRes.error)  throw estadoRes.error;

      const s = summaryRes.data?.[0];

      // Curva ABC calculada no cliente sobre os dados já agregados por produto
      const productsSorted = (productRes.data ?? []) as ProductMarginRow[];
      const totalLucro = productsSorted.reduce((acc, p) => acc + Math.max(Number(p.lucro), 0), 0);
      let accLucro = 0;
      for (const p of productsSorted) {
        if (Number(p.lucro) > 0) accLucro += Number(p.lucro);
        const pct = totalLucro > 0 ? accLucro / totalLucro : 1;
        p.curva = pct <= 0.80 ? "A" : pct <= 0.95 ? "B" : "C";
        // Garantir tipos numéricos (RPC retorna strings em alguns drivers)
        p.receita   = Number(p.receita);
        p.cmv       = Number(p.cmv);
        p.comissao  = Number(p.comissao);
        p.frete     = Number(p.frete);
        p.impostos  = Number(p.impostos);
        p.lucro     = Number(p.lucro);
        p.lucro_pct = p.lucro_pct != null ? Number(p.lucro_pct) : null;
        p.pedidos   = Number(p.pedidos);
        p.unidades  = Number(p.unidades);
        p.has_cmv   = Boolean(p.has_cmv);
      }

      const summary: MarginSummary = {
        receita:            Number(s?.receita ?? 0),
        cmv:                Number(s?.cmv ?? 0),
        comissao:           Number(s?.comissao ?? 0),
        frete:              Number(s?.frete ?? 0),
        impostos:           Number(s?.impostos ?? 0),
        lucro:              Number(s?.lucro ?? 0),
        lucro_pct:          s?.lucro_pct != null ? Number(s.lucro_pct) : null,
        pedidos:            Number(s?.pedidos ?? 0),
        unidades:           Number(s?.unidades ?? 0),
        has_cmv:            false,
        ticket_medio:       Number(s?.ticket_medio ?? 0),
        lucro_medio_pedido: Number(s?.pedidos ?? 0) > 0
          ? Number(s?.lucro ?? 0) / Number(s?.pedidos ?? 1)
          : 0,
      };

      return {
        summary,
        daily:     (dayRes.data ?? []).map(normalizeRow) as DayMarginRow[],
        byProduct: productsSorted,
        byBrand:   (brandRes.data ?? []).map(normalizeBrand),
        byEstado:  (estadoRes.data ?? []).map(normalizeEstado),
      };
    },
    enabled: !!currentOrg?.id && resolvedMLUserIds.length > 0,
    staleTime: 2 * 60 * 1000,
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function emptyResult(): MarginAnalysisResult {
  const zero: MarginSummary = {
    receita: 0, cmv: 0, comissao: 0, frete: 0, impostos: 0,
    lucro: 0, lucro_pct: null, pedidos: 0, unidades: 0,
    has_cmv: false, ticket_medio: 0, lucro_medio_pedido: 0,
  };
  return { summary: zero, daily: [], byProduct: [], byBrand: [], byEstado: [] };
}

function normalizeRow(r: Record<string, unknown>): DayMarginRow {
  return {
    date:     String(r.date ?? "").substring(0, 10),
    receita:  Number(r.receita), cmv: Number(r.cmv),
    comissao: Number(r.comissao), frete: Number(r.frete),
    impostos: Number(r.impostos), lucro: Number(r.lucro),
    lucro_pct: r.lucro_pct != null ? Number(r.lucro_pct) : null,
    pedidos:  Number(r.pedidos), unidades: Number(r.pedidos),
    has_cmv:  false,
  };
}

function normalizeBrand(r: Record<string, unknown>): MarginRow & { marca: string } {
  return {
    marca:    String(r.marca ?? "Sem marca"),
    receita:  Number(r.receita), cmv: Number(r.cmv),
    comissao: Number(r.comissao), frete: Number(r.frete),
    impostos: Number(r.impostos), lucro: Number(r.lucro),
    lucro_pct: r.lucro_pct != null ? Number(r.lucro_pct) : null,
    pedidos:  Number(r.pedidos), unidades: Number(r.pedidos),
    has_cmv:  Boolean(r.has_cmv),
  };
}

function normalizeEstado(r: Record<string, unknown>): MarginRow & { estado: string } {
  return {
    estado:   String(r.estado ?? "Desconhecido"),
    receita:  Number(r.receita), lucro: Number(r.lucro),
    lucro_pct: r.lucro_pct != null ? Number(r.lucro_pct) : null,
    pedidos:  Number(r.pedidos), unidades: Number(r.pedidos),
    cmv: 0, comissao: 0, frete: 0, impostos: 0, has_cmv: false,
  };
}
