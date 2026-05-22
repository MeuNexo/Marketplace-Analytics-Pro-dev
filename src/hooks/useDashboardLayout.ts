import { useState, useCallback, useEffect } from "react";

export interface WidgetConfig {
  id: string;
  label: string;
  description: string;
  visible: boolean;
}

const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: "kpi_grid",         label: "KPIs de Vendas",           description: "Cards com receita, pedidos, ticket, visitas e mais",   visible: true },
  { id: "revenue_chart",    label: "Gráfico de Receita",       description: "Evolução diária ou horária da receita + metas",         visible: true },
  { id: "cost_waterfall",   label: "Custos & Top Anúncios",    description: "Waterfall financeiro e produtos mais vendidos",         visible: true },
  { id: "brand_revenue",    label: "Receita por Marca",        description: "Faturamento diário por marca ao longo do período",      visible: true },
  { id: "brand_markup",     label: "Markup por Marca",         description: "Evolução do markup médio por marca",                   visible: true },
  { id: "operational_cost", label: "Custo Operacional Diário", description: "Frete + Comissão + Publicidade em R$ e % da receita",  visible: true },
  { id: "brand_share",      label: "Share de Marca",           description: "Participação de receita e volume por marca",           visible: true },
  { id: "analytics",        label: "Análises Detalhadas",      description: "Venda por hora, ticket médio, estados e funil",        visible: true },
];

const STORAGE_KEY = "ml_dashboard_layout_v2";

function loadLayout(): WidgetConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_WIDGETS;
    const saved: WidgetConfig[] = JSON.parse(raw);
    const savedIds = new Set(saved.map((w) => w.id));
    const merged = [
      ...saved.filter((s) => DEFAULT_WIDGETS.some((d) => d.id === s.id)),
      ...DEFAULT_WIDGETS.filter((d) => !savedIds.has(d.id)),
    ];
    return merged.length > 0 ? merged : DEFAULT_WIDGETS;
  } catch {
    return DEFAULT_WIDGETS;
  }
}

function saveLayout(widgets: WidgetConfig[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets));
  } catch { /* ignore quota/security errors */ }
}

export function useDashboardLayout() {
  const [widgets, setWidgets] = useState<WidgetConfig[]>(loadLayout);

  useEffect(() => {
    saveLayout(widgets);
  }, [widgets]);

  const toggleWidget = useCallback((id: string) => {
    setWidgets((prev) => prev.map((w) => (w.id === id ? { ...w, visible: !w.visible } : w)));
  }, []);

  const moveUp = useCallback((id: string) => {
    setWidgets((prev) => {
      const idx = prev.findIndex((w) => w.id === id);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  }, []);

  const moveDown = useCallback((id: string) => {
    setWidgets((prev) => {
      const idx = prev.findIndex((w) => w.id === id);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  }, []);

  const resetLayout = useCallback(() => {
    setWidgets(DEFAULT_WIDGETS);
  }, []);

  const isVisible = useCallback(
    (id: string) => widgets.find((w) => w.id === id)?.visible ?? true,
    [widgets],
  );

  return { widgets, toggleWidget, moveUp, moveDown, resetLayout, isVisible };
}
