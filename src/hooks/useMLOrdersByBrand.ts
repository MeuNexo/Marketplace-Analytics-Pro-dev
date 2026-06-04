import { useQuery } from "@tanstack/react-query";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";

export const BRAND_COLORS = [
  "hsl(217, 70%, 50%)",
  "hsl(142, 70%, 45%)",
  "hsl(25, 95%, 53%)",
  "hsl(270, 70%, 50%)",
  "hsl(0, 70%, 55%)",
  "hsl(185, 70%, 45%)",
  "hsl(45, 95%, 55%)",
];

export interface BrandTimeSeries {
  date: string;
  [brand: string]: string | number;
}

export interface BrandAggregate {
  marca: string;
  receita: number;
  unidades: number;
  markup_ratio: number | null;
  color: string;
}

export interface BrandMarkupSeries {
  date: string;
  [brand: string]: string | number | null;
}

export interface CustoOperacionalSeries {
  date: string;
  custo_plataforma: number;
}

export interface MLOrdersByBrandResult {
  brandRevenueSeries: BrandTimeSeries[];
  brandMarkupSeries: BrandMarkupSeries[];
  custoSeries: CustoOperacionalSeries[];
  topBrands: string[];
  brandAggregates: BrandAggregate[];
  hasData: boolean;
}

const MAX_BRANDS = 7;

export function useMLOrdersByBrand(from: string, to: string) {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<MLOrdersByBrandResult>({
    queryKey: ["ml", "orders-by-brand", orgId, resolvedMLUserIds, from, to],
    queryFn: async (): Promise<MLOrdersByBrandResult> => {
      const empty: MLOrdersByBrandResult = {
        brandRevenueSeries: [],
        brandMarkupSeries: [],
        custoSeries: [],
        topBrands: [],
        brandAggregates: [],
        hasData: false,
      };

      if (!orgId || resolvedMLUserIds.length === 0) return empty;

      // Fonte primária: tabela orders (populada por sync-ml-orders)
      const { data: ordersData, error } = await supabase
        .from("orders")
        .select("data_pedido, marca, receita_bruta, custo_unit, quantidade, frete, comissao")
        .eq("organization_id", orgId)
        .in("ml_user_id", resolvedMLUserIds)
        .gte("data_pedido", from)
        .lte("data_pedido", to)
        .in("status", ["paid", "shipped", "delivered"]);

      if (error) throw error;

      // Fallback: ml_product_daily_cache quando orders está vazio para o período
      // (ex: sync-ml-orders retorna 0 pedidos da API mas há dados de visitas/vendas)
      let rows: { data_pedido: string; marca: string | null; receita_bruta: number | null; custo_unit: null; quantidade: number; frete: null; comissao: null }[];

      if ((ordersData ?? []).length > 0) {
        rows = ordersData as typeof rows;
      } else {
        const { data: cacheData } = await supabase
          .from("ml_product_daily_cache")
          .select("date, marca, revenue, qty_sold")
          .eq("organization_id", orgId)
          .in("ml_user_id", resolvedMLUserIds)
          .gte("date", from.slice(0, 10))
          .lte("date", to.slice(0, 10));

        const cacheRows = (cacheData ?? []).filter((r) => r.revenue > 0);
        if (cacheRows.length === 0) return empty;

        rows = cacheRows.map((r) => ({
          data_pedido: r.date as string,
          marca: (r.marca as string | null) ?? "Sem Marca",
          receita_bruta: Number(r.revenue) || 0,
          custo_unit: null,
          quantidade: Number(r.qty_sold) || 1,
          frete: null,
          comissao: null,
        }));
      }

      if (rows.length === 0) return empty;

      const brandMap = new Map<
        string,
        { receita: number; unidades: number; sumCusto: number; hasCusto: boolean }
      >();

      for (const r of rows) {
        const marca = (r.marca as string | null) ?? "Sem Marca";
        const receita = r.receita_bruta ?? 0;
        const qty = r.quantidade ?? 1;
        const custo = r.custo_unit;
        const existing = brandMap.get(marca) ?? {
          receita: 0,
          unidades: 0,
          sumCusto: 0,
          hasCusto: false,
        };
        existing.receita += receita;
        existing.unidades += qty;
        if (custo != null) {
          existing.hasCusto = true;
          existing.sumCusto += custo * qty;
        }
        brandMap.set(marca, existing);
      }

      const sorted = Array.from(brandMap.entries()).sort(
        ([, a], [, b]) => b.receita - a.receita,
      );
      const topBrands = sorted.slice(0, MAX_BRANDS).map(([marca]) => marca);
      const topSet = new Set(topBrands);

      const brandAggregates: BrandAggregate[] = [];
      let outrosReceita = 0;
      let outrosUnidades = 0;

      sorted.forEach(([marca, vals]) => {
        const markup_ratio =
          vals.hasCusto && vals.sumCusto > 0
            ? Math.min(vals.receita / vals.sumCusto, 10)
            : null;
        if (topSet.has(marca)) {
          brandAggregates.push({
            marca,
            receita: vals.receita,
            unidades: vals.unidades,
            markup_ratio,
            color: BRAND_COLORS[topBrands.indexOf(marca) % BRAND_COLORS.length],
          });
        } else {
          outrosReceita += vals.receita;
          outrosUnidades += vals.unidades;
        }
      });

      if (outrosReceita > 0) {
        brandAggregates.push({
          marca: "Outros",
          receita: outrosReceita,
          unidades: outrosUnidades,
          markup_ratio: null,
          color: "hsl(220, 10%, 60%)",
        });
      }

      type DayBrandKey = string;
      const dayBrandRevMap = new Map<DayBrandKey, number>();
      const dayBrandCostMap = new Map<DayBrandKey, { sumR: number; sumC: number; hasC: boolean }>();
      const dayCustoMap = new Map<string, number>();

      for (const r of rows) {
        const date = r.data_pedido as string;
        if (!date) continue;
        const marcaRaw = (r.marca as string | null) ?? "Sem Marca";
        const marca = topSet.has(marcaRaw) ? marcaRaw : "Outros";
        const receita = r.receita_bruta ?? 0;
        const qty = r.quantidade ?? 1;
        const custo = r.custo_unit;

        const revKey = `${date}|${marca}`;
        dayBrandRevMap.set(revKey, (dayBrandRevMap.get(revKey) ?? 0) + receita);

        const existing = dayBrandCostMap.get(revKey) ?? {
          sumR: 0,
          sumC: 0,
          hasC: false,
        };
        existing.sumR += receita;
        if (custo != null) {
          existing.hasC = true;
          existing.sumC += custo * qty;
        }
        dayBrandCostMap.set(revKey, existing);

        const frete = r.frete ?? 0;
        const comissao = r.comissao ?? 0;
        dayCustoMap.set(date, (dayCustoMap.get(date) ?? 0) + frete + comissao);
      }

      const allDates = Array.from(
        new Set(rows.map((r) => r.data_pedido as string).filter(Boolean)),
      ).sort();

      const brandRevenueSeries: BrandTimeSeries[] = allDates.map((date) => {
        const row: BrandTimeSeries = { date };
        for (const marca of topBrands) {
          row[marca] = dayBrandRevMap.get(`${date}|${marca}`) ?? 0;
        }
        if (outrosReceita > 0) {
          row["Outros"] = dayBrandRevMap.get(`${date}|Outros`) ?? 0;
        }
        return row;
      });

      const brandMarkupSeries: BrandMarkupSeries[] = allDates.map((date) => {
        const row: BrandMarkupSeries = { date };
        for (const marca of topBrands) {
          const key = `${date}|${marca}`;
          const vals = dayBrandCostMap.get(key);
          if (!vals || !vals.hasC || vals.sumC === 0) {
            row[marca] = null;
          } else {
            const rawMarkup = Math.round((vals.sumR / vals.sumC) * 100) / 100;
            row[marca] = rawMarkup > 10 ? null : rawMarkup;
          }
        }
        return row;
      });

      const custoSeries: CustoOperacionalSeries[] = allDates.map((date) => ({
        date,
        custo_plataforma: Math.round((dayCustoMap.get(date) ?? 0) * 100) / 100,
      }));

      return {
        brandRevenueSeries,
        brandMarkupSeries,
        custoSeries,
        topBrands,
        brandAggregates,
        hasData: true,
      };
    },
    enabled: !!orgId && resolvedMLUserIds.length > 0 && !!from && !!to,
    staleTime: 5 * 60 * 1000,
  });
}
