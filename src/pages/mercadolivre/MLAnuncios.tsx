import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { KPI_GLOSSARY } from "@/lib/kpi-glossary";
import { EmptyState } from "@/components/ui/empty-state";
import { STORE_BADGE_COLORS } from "@/config/storeColors";
import { useMLInventory } from "@/contexts/MLInventoryContext";
import type { ProductItem, ProductVariation } from "@/contexts/MLInventoryContext";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { format, subDays, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import {
  getListingLabel,
  currencyFmt,
  mlListingUrl,
} from "@/components/mercadolivre/anuncios/listingHelpers";
// Fonte única da margem teórica do catálogo (CR-08) — os ramos mobile, desktop
// e a sub-tabela de variações chamam os dois helpers abaixo, nunca aritmética
// de margem inline. Ver o cabeçalho de anuncioMargens.ts para a régua completa.
import { calcularMargensDoAnuncio, precoPromocionalAplicavel } from "@/lib/anuncioMargens";
import { classificarCurvaAbc, calcularParticipacao } from "@/lib/curvaAbc";
// AV-03: a ausência de CMV é contada e declarada em agregado, em vez de virar
// um traço solto célula a célula. Ver o cabeçalho de custoFaltante.ts.
import { contarSemCusto } from "@/lib/custoFaltante";
import { AvisoCustoFaltante } from "@/components/mercadolivre/AvisoCustoFaltante";
// CR-09: a régua da publicidade desta tela é a fatura do ML rateada — a tela é
// obrigada a dizer isso e a mostrar o que da fatura ficou sem dono.
import { AdsOrigemNota } from "@/components/mercadolivre/AdsOrigemNota";
import { useMLPrecosCustos, type MLItemSuggestion } from "@/hooks/useMLPrecosCustos";
import { KPICard } from "@/components/dashboard/KPICard";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ShoppingBag, RefreshCw, Search, ExternalLink, Plug, DollarSign, Tag, TrendingUp, Package,
  ChevronDown, ChevronRight, Receipt, Truck, ArrowUpDown, ArrowUp, ArrowDown,
  BookOpen, CalendarIcon, X, Check, Lightbulb, BarChart2, CheckCircle2, TrendingDown, AlertCircle, Download,
  Pencil, Eye,
} from "lucide-react";
import * as XLSX from "xlsx";
import { Link, useSearchParams } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMLProductCosts } from "@/hooks/useMLProductCosts";
import { useMLTaxConfig } from "@/hooks/useMLTaxConfig";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useMLMarginWithAds } from "@/hooks/useMLMarginWithAds";
import { ImportacaoCustos } from "@/components/mercadolivre/anuncios/ImportacaoCustos";
import { ListingDetailModal } from "@/components/mercadolivre/anuncios/ListingDetailModal";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer,
  PieChart, Pie, Cell, ComposedChart, Line, Area, ReferenceLine, CartesianGrid, Legend,
} from "recharts";

// Sentinela do período "Total". Fase 213/CR-07: "Total" NÃO significa mais
// "sem filtro de data, cai para o `sold_quantity` vitalício da API do ML".
// Significa "desde a primeira venda registrada na base" — uma janela real,
// resolvida em `primeiraVendaDate` e aplicada como qualquer outro período.
const TOTAL_PERIOD = -1;

// ─── Glossary tip helper ──────────────────────────────────────────────────────
const tip = (key: keyof typeof KPI_GLOSSARY) => {
  const e = KPI_GLOSSARY[key];
  return e.example ? `${e.definition} ${e.example}` : e.definition;
};

const RANKING_QUICK_RANGES = [
  { label: "Total",   value: TOTAL_PERIOD },
  { label: "Hoje",    value: 0  },
  { label: "7 dias",  value: 7  },
  { label: "15 dias", value: 15 },
  { label: "30 dias", value: 30 },
];

// ─── Financial helpers ────────────────────────────────────────────────────────
// getListingLabel, currencyFmt e mlListingUrl são importados de
// @/components/mercadolivre/anuncios/listingHelpers (módulo compartilhado).
// A margem teórica (comissão, imposto, margem bruta/líquida) vem de
// @/lib/anuncioMargens — ver calcularMargensDoAnuncio.

type StatusFilter = "all" | "active" | "paused";
type StockFilter = "all" | "in_stock" | "low" | "out";
type SortBy = "title_asc" | "title_desc" | "price_desc" | "price_asc" | "stock_desc" | "stock_asc";
type LogisticFilter = "all" | "fulfillment" | "cross_docking" | "self_service" | "drop_off";
type ColumnView = "financeiro" | "preco";

const healthBadge = (health: number | null) => {
  if (health === null) return <span className="text-xs text-muted-foreground">—</span>;
  if (health >= 0.8) return <Badge variant="outline" className="text-xs border-emerald-500 text-emerald-600">Ótima</Badge>;
  if (health >= 0.5) return <Badge variant="outline" className="text-xs border-amber-500 text-amber-600">Regular</Badge>;
  return <Badge variant="destructive" className="text-xs">Baixa</Badge>;
};

const stockBadge = (qty: number) => {
  if (qty === 0) return <Badge variant="outline" className="text-xs text-muted-foreground">Sem estoque</Badge>;
  if (qty <= 5) return <Badge variant="outline" className="text-xs border-amber-500 text-amber-600">Baixo</Badge>;
  return <Badge variant="outline" className="text-xs border-emerald-500 text-emerald-600">OK</Badge>;
};

const variationLabel = (v: ProductVariation) =>
  v.attribute_combinations.map((a) => a.value).join(" / ") || `Var. ${v.variation_id}`;

/** Shown when the listing is linked to the ML product catalog */
function CatalogBadge() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 cursor-default leading-none">
          <BookOpen className="w-2.5 h-2.5" />
          Catálogo
        </span>
      </TooltipTrigger>
      <TooltipContent className="text-xs max-w-[180px]">
        Anúncio vinculado ao catálogo de produtos do Mercado Livre
      </TooltipContent>
    </Tooltip>
  );
}

/** Shown when the listing participates in one or more active ML promotions */
function PromoBadge({ count }: { count: number }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-0.5 rounded-full border border-orange-500/30 bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-medium text-orange-600 cursor-default leading-none">
          <Tag className="w-2.5 h-2.5" />
          {count > 1 ? `${count} promoções` : "Em promoção"}
        </span>
      </TooltipTrigger>
      <TooltipContent className="text-xs max-w-[180px]">
        Anúncio participando de {count > 1 ? `${count} promoções` : "uma promoção"} ativa no Mercado Livre
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Sortable header helper ──────────────────────────────────────────────────
function SortableHead({ label, field, current, onSort, className = "" }: {
  label: string; field: string; current: SortBy; onSort: (f: string) => void; className?: string;
}) {
  const asc = `${field}_asc` as SortBy;
  const desc = `${field}_desc` as SortBy;
  const isActive = current === asc || current === desc;
  const isAsc = current === asc;
  return (
    <TableHead className={`text-xs ${className} cursor-pointer select-none group`} onClick={() => onSort(field)}>
      <div className="inline-flex items-center gap-1">
        {label}
        {isActive ? (
          isAsc ? <ArrowUp className="w-3 h-3 text-foreground" /> : <ArrowDown className="w-3 h-3 text-foreground" />
        ) : (
          <ArrowUpDown className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>
    </TableHead>
  );
}

// ─── Inline editable cell ────────────────────────────────────────────────────

function InlineEditCell({
  value,
  onSave,
  format = "currency",
}: {
  value: number | null;
  onSave: (v: number | null) => Promise<void>;
  format?: "currency" | "percent";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = async () => {
    const raw = draft.trim().replace(",", ".");
    const parsed = raw === "" ? null : Number(raw);
    const v = parsed === null || isNaN(parsed) || parsed < 0 ? null : parsed;
    setSaving(true);
    await onSave(v);
    setSaving(false);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center justify-end gap-1">
        {format === "currency" && <span className="text-[10px] text-muted-foreground">R$</span>}
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-20 text-xs text-right border border-primary/40 rounded px-1.5 py-0.5 bg-background outline-none ring-1 ring-primary/30"
          type="number"
          min={0}
          step={format === "percent" ? "0.1" : "0.01"}
        />
        {format === "percent" && <span className="text-[10px] text-muted-foreground">%</span>}
      </div>
    );
  }

  return (
    <div
      className="group flex items-center justify-end gap-1 cursor-pointer select-none"
      onClick={(e) => { e.stopPropagation(); setDraft(value != null ? String(value) : ""); setEditing(true); }}
    >
      {saving ? (
        <span className="text-xs text-muted-foreground animate-pulse">…</span>
      ) : value != null ? (
        <span className="text-xs tabular-nums font-mono">
          {format === "currency" ? currencyFmt(value) : `${value.toFixed(1)}%`}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground italic">Informar</span>
      )}
      <Pencil className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-60 transition-opacity shrink-0" />
    </div>
  );
}

// ─── Price analysis status config ────────────────────────────────────────────

const STATUS_CONFIG = {
  with_benchmark_highest: {
    label: "Muito Acima do Mercado",
    badgeClass: "bg-red-500/15 text-red-700 border-red-500/30",
    icon: <TrendingUp className="w-3.5 h-3.5 text-red-600" />,
    advice: (s) =>
      `Seu preço está ${Math.abs(s.percent_difference).toFixed(0)}% acima dos concorrentes. Reduzir para ${s.suggested_price ? s.suggested_price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "o preço sugerido"} pode aumentar significativamente a visibilidade e as chances de venda.`,
  },
  with_benchmark_high: {
    label: "Acima do Mercado",
    badgeClass: "bg-amber-500/15 text-amber-700 border-amber-500/30",
    icon: <TrendingUp className="w-3.5 h-3.5 text-amber-600" />,
    advice: (s) =>
      `Seu preço está ${Math.abs(s.percent_difference).toFixed(0)}% acima da média. Uma pequena redução${s.suggested_price ? ` para ${s.suggested_price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : ""} pode melhorar o posicionamento nos resultados de busca.`,
  },
  no_benchmark_ok: {
    label: "Preço Competitivo",
    badgeClass: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
    icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />,
    advice: () => "Seu preço está alinhado com o mercado. Mantenha a estratégia atual e monitore os concorrentes periodicamente.",
  },
  no_benchmark_lowest: {
    label: "Abaixo do Mercado",
    badgeClass: "bg-blue-500/15 text-blue-700 border-blue-500/30",
    icon: <TrendingDown className="w-3.5 h-3.5 text-blue-600" />,
    advice: (s) =>
      `Seu preço está abaixo da média dos concorrentes. Você pode aumentar a margem${s.suggested_price && s.suggested_price > s.current_price ? ` para até ${s.suggested_price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : ""} sem perder competitividade.`,
  },
};

const fmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ─── Price Detail Sheet ───────────────────────────────────────────────────────

function PriceDetailSheet({
  open,
  onClose,
  item,
  suggestion,
  noSuggestion,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  item: { id: string; title: string; thumbnail: string; price: number } | null;
  suggestion: MLItemSuggestion | null;
  noSuggestion: boolean;
  loading: boolean;
}) {
  const statusCfg = suggestion
    ? (STATUS_CONFIG[suggestion.status] ?? STATUS_CONFIG.no_benchmark_ok)
    : null;

  const graphData = suggestion?.graph
    ? [...suggestion.graph]
        .sort((a, b) => a.price.amount - b.price.amount)
        .map((entry, i) => ({
          label: `Conc. ${i + 1}`,
          title: entry.info?.title ?? `Concorrente ${i + 1}`,
          preco: entry.price.amount,
          vendas: entry.info?.sold_quantity ?? 0,
        }))
    : [];

  const mostSoldCompetitor = graphData.length
    ? graphData.reduce((best, cur) => (cur.vendas > best.vendas ? cur : best), graphData[0])
    : null;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-[560px] overflow-y-auto p-0">
        <SheetHeader className="px-6 py-4 border-b sticky top-0 bg-background z-10">
          <SheetTitle className="flex items-center gap-2 text-base">
            <BarChart2 className="w-4 h-4 text-primary" />
            Análise de Preço Competitivo
          </SheetTitle>
        </SheetHeader>

        <div className="px-6 py-5 space-y-5">
          {/* Loading skeleton */}
          {loading && (
            <div className="space-y-4">
              <div className="h-20 rounded-xl bg-muted animate-pulse" />
              <div className="grid grid-cols-3 gap-3">
                {[1,2,3].map(i => <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />)}
              </div>
              <div className="h-32 rounded-xl bg-muted animate-pulse" />
              <div className="h-52 rounded-xl bg-muted animate-pulse" />
            </div>
          )}

          {/* No suggestion */}
          {!loading && noSuggestion && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800">Sem referência disponível</p>
                <p className="text-xs text-amber-700 mt-1">
                  O Mercado Livre ainda não gerou sugestões competitivas para este anúncio.
                  Tente novamente mais tarde ou consulte outro produto.
                </p>
              </div>
            </div>
          )}

          {/* Product header */}
          {!loading && item && suggestion && statusCfg && (
            <>
              <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
                {item.thumbnail ? (
                  <img
                    src={item.thumbnail.replace("http://", "https://")}
                    alt=""
                    className="w-14 h-14 object-contain rounded-lg bg-muted shrink-0"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-lg bg-muted shrink-0 flex items-center justify-center">
                    <Package className="w-5 h-5 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm line-clamp-2 leading-snug">{item.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.id}</p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <Badge className={`text-[11px] gap-1 px-2 py-0.5 ${statusCfg.badgeClass}`}>
                      {statusCfg.icon}
                      {statusCfg.label}
                    </Badge>
                    {suggestion.applicable_suggestion && (
                      <Badge className="text-[11px] bg-emerald-500/15 text-emerald-700 border-emerald-500/30 px-2 py-0.5">
                        Sugestão aplicável
                      </Badge>
                    )}
                    {suggestion.compared_values > 0 && (
                      <span className="text-[11px] text-muted-foreground">
                        {suggestion.compared_values} produto{suggestion.compared_values !== 1 ? "s" : ""} analisado{suggestion.compared_values !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* KPIs */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                  <p className="text-[11px] text-muted-foreground font-medium">Seu Preço Atual</p>
                  <p className="text-lg font-bold tabular-nums mt-1">{fmt(suggestion.current_price)}</p>
                  {suggestion.percent_difference !== 0 && (
                    <p className={`text-[11px] mt-0.5 font-medium ${suggestion.percent_difference > 0 ? "text-destructive" : "text-kpi-positive"}`}>
                      {suggestion.percent_difference > 0 ? "+" : ""}{suggestion.percent_difference.toFixed(1)}% vs mercado
                    </p>
                  )}
                </div>
                <div className={`rounded-xl border p-3 ${suggestion.suggested_price != null ? "border-emerald-500/30 bg-emerald-500/5" : ""}`}>
                  <p className="text-[11px] text-muted-foreground font-medium">Sugerido ML</p>
                  {suggestion.suggested_price != null ? (
                    <>
                      <p className="text-lg font-bold tabular-nums mt-1 text-kpi-positive">{fmt(suggestion.suggested_price)}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Recomendação ML</p>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-2">Não disponível</p>
                  )}
                </div>
                <div className="rounded-xl border p-3">
                  <p className="text-[11px] text-muted-foreground font-medium">Menor Concorrente</p>
                  {suggestion.lowest_price != null ? (
                    <>
                      <p className="text-lg font-bold tabular-nums mt-1 text-blue-700">{fmt(suggestion.lowest_price)}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Menor preço no mercado</p>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-2">Não disponível</p>
                  )}
                </div>
              </div>

              {/* Recommendation */}
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex items-start gap-3">
                <Lightbulb className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-primary">Sugestão de Precificação</p>
                  <p className="text-sm mt-1 text-foreground/80">{statusCfg.advice(suggestion)}</p>
                  {(suggestion.selling_fees > 0 || suggestion.shipping_fees > 0) && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Custos estimados:{" "}
                      {suggestion.selling_fees > 0 && <span className="font-medium">comissão {fmt(suggestion.selling_fees)}</span>}
                      {suggestion.selling_fees > 0 && suggestion.shipping_fees > 0 && " + "}
                      {suggestion.shipping_fees > 0 && <span className="font-medium">frete {fmt(suggestion.shipping_fees)}</span>}
                    </p>
                  )}
                </div>
              </div>

              {/* Competitor distribution chart */}
              {graphData.length > 0 && (
                <div className="rounded-xl border bg-card p-4">
                  <p className="text-sm font-medium mb-0.5">Distribuição de Preços dos Concorrentes</p>
                  <p className="text-xs text-muted-foreground mb-3">
                    Barras = unidades vendidas por faixa de preço
                    {mostSoldCompetitor && (
                      <> · Mais vendido: <span className="font-medium">{fmt(mostSoldCompetitor.preco)}</span> ({mostSoldCompetitor.vendas} vendas)</>
                    )}
                  </p>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={graphData} barSize={26}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="preco" tickFormatter={(v) => `R$${v}`} tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 11 }} label={{ value: "Vendas", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} />
                      <RechartsTooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0].payload;
                          return (
                            <div className="bg-background border rounded-lg px-3 py-2 shadow text-xs">
                              <p className="font-semibold line-clamp-1 max-w-[180px]">{d.title}</p>
                              <p className="text-muted-foreground">Preço: {fmt(d.preco)}</p>
                              <p className="text-muted-foreground">Vendas: {d.vendas}</p>
                            </div>
                          );
                        }}
                      />
                      <ReferenceLine x={suggestion.current_price} stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 2"
                        label={{ value: "Seu preço", position: "top", style: { fontSize: 10, fill: "#f59e0b" } }} />
                      {suggestion.suggested_price != null && (
                        <ReferenceLine x={suggestion.suggested_price} stroke="#22c55e" strokeWidth={2} strokeDasharray="4 2"
                          label={{ value: "Sugerido", position: "top", style: { fontSize: 10, fill: "#22c55e" } }} />
                      )}
                      <Bar dataKey="vendas" radius={[4, 4, 0, 0]}>
                        {graphData.map((entry, i) => (
                          <Cell key={i} fill={entry.preco === mostSoldCompetitor?.preco ? "#6366f1" : "hsl(var(--muted-foreground) / 0.4)"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap gap-3 mt-2">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <div className="w-3 h-0.5 bg-amber-500" style={{ borderTop: "2px dashed" }} />
                      Seu preço ({fmt(suggestion.current_price)})
                    </div>
                    {suggestion.suggested_price != null && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <div className="w-3 h-0.5 bg-emerald-500" />
                        Sugerido ({fmt(suggestion.suggested_price)})
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <div className="w-3 h-3 rounded-sm bg-indigo-500 shrink-0" />
                      Mais vendido
                    </div>
                  </div>
                </div>
              )}

              {/* Competitor table */}
              {graphData.length > 0 && (
                <div className="rounded-xl border bg-card overflow-hidden">
                  <div className="px-4 py-3 border-b">
                    <p className="text-sm font-medium">Produtos Concorrentes</p>
                    <p className="text-xs text-muted-foreground">Ordenados pelo menor preço</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Produto</th>
                          <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Preço</th>
                          <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Vendas</th>
                          <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">vs Seu Preço</th>
                          <th className="px-4 py-2.5" />
                        </tr>
                      </thead>
                      <tbody>
                        {graphData.map((entry, i) => {
                          const diff = ((entry.preco - suggestion.current_price) / suggestion.current_price) * 100;
                          const mlSearchUrl = `https://lista.mercadolivre.com.br/${encodeURIComponent(entry.title.replace(/\s+/g, "-"))}`;
                          return (
                            <tr key={i} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                              <td className="px-4 py-2.5"><p className="text-xs line-clamp-1">{entry.title}</p></td>
                              <td className="px-4 py-2.5 text-right tabular-nums font-medium text-xs">{fmt(entry.preco)}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground text-xs">{entry.vendas > 0 ? entry.vendas : "—"}</td>
                              <td className="px-4 py-2.5 text-right">
                                <span className={`text-xs font-medium tabular-nums ${diff < 0 ? "text-kpi-positive" : diff > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                                  {diff > 0 ? "+" : ""}{diff.toFixed(1)}%
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-center">
                                <a
                                  href={mlSearchUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="Buscar no Mercado Livre"
                                  className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function MLProdutos() {
  const { items, loading, hasToken, lastUpdated, refresh } = useMLInventory();
  const { selectedStore, stores, sellerId, resolvedMLUserIds, scopeKey } = useMLStore();
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;
  const isMobile = useIsMobile();
  const { data: taxMap } = useMLTaxConfig(resolvedMLUserIds, orgId ?? "");
  const showTaxBanner = !!taxMap && stores.some((s) => !taxMap.has(s.ml_user_id));
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightIds = useMemo(() => {
    const raw = searchParams.get("items");
    return raw ? new Set(raw.split(",").filter(Boolean)) : null;
  }, [searchParams]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("title_asc");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [columnView, setColumnView] = useState<ColumnView>("financeiro");
  const [brandFilter, setBrandFilter] = useState("all");
  const [hideOutOfStock, setHideOutOfStock] = useState(true);
  const [logisticFilter, setLogisticFilter] = useState<LogisticFilter>("all");
  const [onlyDiscount, setOnlyDiscount] = useState(false);
  const [usePromoPrice, setUsePromoPrice] = useState(false);
  const [rankingBrandFilter, setRankingBrandFilter] = useState("all");
  const [rankingSort, setRankingSort] = useState("revenue_desc");
  const [rankingSearch, setRankingSearch] = useState("");
  const [reportTab, setReportTab] = useState("ranking");

  // ── Price Sheet state ──────────────────────────────────────────────────────
  const [priceSheetOpen, setPriceSheetOpen] = useState(false);
  const [priceSheetItem, setPriceSheetItem] = useState<{ id: string; title: string; thumbnail: string; price: number } | null>(null);

  // ── Detail Modal state ──────────────────────────────────────────────────────
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ProductItem | null>(null);
  const [loadingSuggestion, setLoadingSuggestion] = useState(false);
  const [suggestion, setSuggestion] = useState<MLItemSuggestion | null>(null);
  const [noSuggestion, setNoSuggestion] = useState(false);
  const { fetchItemSuggestion, fetchSalePrice, fetchCosts, refresh: precosRefresh } = useMLPrecosCustos();
  const { costs, costsBySku, upsert: upsertCost } = useMLProductCosts();
  // Custo pode estar keyado por MLB item_id (entrada manual) ou por seller_sku (sync Tiny).
  const costFor = useCallback(
    (itemId: string, sku: string | null) =>
      costs.get(itemId) ?? (sku ? costsBySku.get(sku) : undefined),
    [costs, costsBySku],
  );

  // Cache lazy: busca current_price via suggestions API apenas para itens com deal_ids
  // (promoção ativa), ao entrar na view "Preço"
  const [dealPriceCache, setDealPriceCache] = useState<Map<string, number>>(new Map());

  // Cache lazy: busca comissão real por produto via ML Listing Costs API ao entrar na view "Financeiro"
  const [commCache, setCommCache] = useState<Map<string, { pct: number; amount: number }>>(new Map());

  const toggleRankingSort = (field: string) => {
    setRankingSort((prev) =>
      prev === `${field}_asc` ? `${field}_desc` : `${field}_asc`
    );
  };

  // ── Ranking date filter ──────────────────────────────────────────────────────
  const { user } = useAuth();
  const [rankingPeriod, setRankingPeriod] = useState<number>(0);
  const [rankingRange, setRankingRange] = useState<{ from: Date; to: Date } | null>(null);
  const [rankingPopoverOpen, setRankingPopoverOpen] = useState(false);
  const [pendingPeriod, setPendingPeriod] = useState<number | null>(TOTAL_PERIOD);
  const [pendingRange, setPendingRange] = useState<DateRange | null>(null);
  const [rankingRawData, setRankingRawData] = useState<{ item_id: string; qty_sold: number; revenue: number; ml_user_id: string | null; date: string | null }[]>([]);

  // ── CR-07: o período "Total" é uma janela real ────────────────────────────
  // Data da primeira venda registrada no escopo (org via RLS + loja resolvida).
  // `undefined` = ainda resolvendo; `null` = a base não tem venda nenhuma aqui.
  // É essa data que passa a delimitar o início do período "Total"; nunca mais
  // se cai para `sold_quantity × price` (unidades de anos × preço de hoje).
  const [primeiraVendaDate, setPrimeiraVendaDate] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setPrimeiraVendaDate(undefined);
    (async () => {
      // Escopo idêntico ao da leitura paginada abaixo — mesma RLS, mesma loja.
      // Nada vem de query string. `limit(1)` devolve uma linha só.
      let query = supabase
        .from("ml_product_daily_cache")
        .select("date")
        .order("date", { ascending: true })
        .limit(1);
      if (selectedStore !== "all") {
        query = query.eq("ml_user_id", selectedStore);
      } else if (sellerId) {
        query = query.eq("seller_id", sellerId);
      }
      const { data } = await query;
      if (cancelled) return;
      setPrimeiraVendaDate(data && data.length > 0 && data[0].date ? data[0].date : null);
    })();
    return () => { cancelled = true; };
  }, [user, selectedStore, sellerId]);

  /**
   * A janela do relatório — uma só, usada pela busca de vendas, pela coluna de
   * margem e pelo rótulo da tela. `from`/`to` nulos significam janela ainda não
   * resolvida ou base sem venda nenhuma: nesse caso a tela mostra zeros e diz
   * que não houve venda, em vez de cair para o número vitalício.
   */
  const rankingWindow = useMemo((): { from: string | null; to: string | null; resolvida: boolean } => {
    const today = format(new Date(), "yyyy-MM-dd");
    if (rankingRange) {
      return {
        from: format(rankingRange.from, "yyyy-MM-dd"),
        to:   format(rankingRange.to,   "yyyy-MM-dd"),
        resolvida: true,
      };
    }
    if (rankingPeriod === TOTAL_PERIOD) {
      if (primeiraVendaDate === undefined) return { from: null, to: null, resolvida: false };
      if (primeiraVendaDate === null)      return { from: null, to: null, resolvida: true };
      return { from: primeiraVendaDate, to: today, resolvida: true };
    }
    if (rankingPeriod === 0) {
      return { from: today, to: today, resolvida: true };
    }
    return {
      from: format(subDays(new Date(), rankingPeriod), "yyyy-MM-dd"),
      to:   today,
      resolvida: true,
    };
  }, [rankingRange, rankingPeriod, primeiraVendaDate]);

  const fetchRankingSales = useCallback(async () => {
    if (!user) return;
    const fromDate = rankingWindow.from;
    const toDate   = rankingWindow.to;
    // Janela ainda não resolvida, ou base sem venda nenhuma: sem linhas — e sem
    // fallback. Um período vazio tem de parecer vazio (CR-07).
    if (!fromDate || !toDate) {
      setRankingRawData([]);
      return;
    }

    // Paginate through all rows to bypass Supabase's 1 000-row default limit.
    // Without this, sellers with many products × days get truncated results and
    // individual items appear with artificially low sold counts.
    const PAGE = 1000;
    const MAX_ROWS = 50000;
    const allRows: { item_id: string; qty_sold: number; revenue: number; ml_user_id: string | null; date: string | null }[] = [];
    let pageFrom = 0;
    while (pageFrom < MAX_ROWS) {
      let query = supabase
        .from("ml_product_daily_cache")
        .select("item_id, qty_sold, revenue, ml_user_id, date")
        .gte("date", fromDate)
        .lte("date", toDate)
        .range(pageFrom, pageFrom + PAGE - 1);
      if (selectedStore !== "all") {
        query = query.eq("ml_user_id", selectedStore);
      } else if (sellerId) {
        query = query.eq("seller_id", sellerId);
      }
      const { data } = await query;
      if (!data || data.length === 0) break;
      allRows.push(...data);
      if (data.length < PAGE) break;
      pageFrom += PAGE;
    }
    setRankingRawData(allRows);
  }, [user, rankingWindow, selectedStore, sellerId]);

  useEffect(() => { fetchRankingSales(); }, [fetchRankingSales]);

  // ── Margem com Ads — a MESMA janela do relatório ─────────────────────────
  // Fase 213/CR-07: aqui existia um recuo silencioso de 365 dias quando o
  // período era "Total". A coluna de margem cobria um ano enquanto o resto da
  // tela dizia "Todo o período". Com a janela resolvida de verdade, as duas
  // passam a ser a mesma. Janela não resolvida → hoje/hoje (nenhuma linha).
  const { rankingFrom, rankingTo } = useMemo(() => {
    const today = format(new Date(), "yyyy-MM-dd");
    return {
      rankingFrom: rankingWindow.from ?? today,
      rankingTo:   rankingWindow.to   ?? today,
    };
  }, [rankingWindow]);

  const { data: marginWithAds } = useMLMarginWithAds(rankingFrom, rankingTo);

  // Fase 212: `ads_spend` destas linhas já vem na régua da fatura (rateada),
  // não no gasto do relatório de publicidade.
  const marginByItem = useMemo(
    () => new Map((marginWithAds?.rows ?? []).map((m) => [m.item_id, m])),
    [marginWithAds],
  );

  // ── CR-09: os metadados de publicidade deixam de ser descartados ───────────
  // O hook devolve `{ rows, ads }` e esta tela só lia `.rows`, apesar de as
  // colunas Mg. Pós-Ads consumirem a régua da fatura. `/produtos-vendidos` já
  // declarava a origem; aqui a troca de régua acontecia escondida — e a parcela
  // da fatura que não achou dono sumia sem ninguém saber que a soma das colunas
  // não fecha com a fatura.
  const adsMeta = marginWithAds?.ads ?? null;

  /**
   * O intervalo efetivo que as colunas Mg. Op. e Mg. Pós-Ads cobrem, em datas.
   * É `rankingFrom`/`rankingTo` — a MESMA janela do relatório desde o plano
   * 213-04. Uma coluna de margem ao lado de um seletor de período sem dizer que
   * janela cobre é um convite ao engano, então o rótulo vai para o tooltip.
   */
  const janelaMargemLabel = useMemo(() => {
    const fmt = (d: string) => {
      const [y, m, dd] = d.split("-");
      return `${dd}/${m}/${y}`;
    };
    return `${fmt(rankingFrom)} a ${fmt(rankingTo)}`;
  }, [rankingFrom, rankingTo]);

  // Deduplicate raw rows by (ml_user_id, date, item_id) before aggregating.
  // Guard against duplicate rows that arise when multiple members of the same
  // org sync the same store on the same day (unique constraint was previously
  // per-user, not per-org, so two rows could coexist with identical data).
  const rankingDeduped = useMemo(() => {
    const seen = new Set<string>();
    return rankingRawData.filter((row) => {
      const key = `${row.ml_user_id ?? ""}:${row.date ?? ""}:${row.item_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [rankingRawData]);

  const rankingSoldMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rankingDeduped) {
      map.set(row.item_id, (map.get(row.item_id) ?? 0) + row.qty_sold);
    }
    return map;
  }, [rankingDeduped]);

  const rankingRevenueMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rankingDeduped) {
      map.set(row.item_id, (map.get(row.item_id) ?? 0) + (row.revenue ?? 0));
    }
    return map;
  }, [rankingDeduped]);

  const rankingLabel = rankingRange
    ? `${format(rankingRange.from, "dd/MM")} – ${format(rankingRange.to, "dd/MM")}`
    : rankingPeriod === TOTAL_PERIOD
      // CR-07: "Todo o período" agora tem começo declarado — a primeira venda
      // registrada na base. Sem venda nenhuma, a tela diz isso.
      ? primeiraVendaDate
        ? `Todo o período (desde ${format(new Date(`${primeiraVendaDate}T12:00:00`), "dd/MM/yy")})`
        : primeiraVendaDate === null ? "Todo o período (sem venda registrada)" : "Todo o período"
    : rankingPeriod === 0            ? "Hoje"
    : `Últimos ${rankingPeriod} dias`;

  const pendingLabel = pendingRange?.from
    ? pendingRange.to && pendingRange.to.getTime() !== pendingRange.from.getTime()
      ? `${format(pendingRange.from, "dd/MM/yy")} – ${format(pendingRange.to, "dd/MM/yy")}`
      : format(pendingRange.from, "dd/MM/yy")
    : pendingPeriod !== null
      ? pendingPeriod === TOTAL_PERIOD ? "Todo o período"
      : pendingPeriod === 0            ? "Hoje"
      : `Últimos ${pendingPeriod} dias`
    : null;

  const canConfirm = pendingRange?.from != null || pendingPeriod !== null;

  const handleRankingConfirm = () => {
    if (pendingRange?.from) {
      setRankingRange({ from: pendingRange.from, to: pendingRange.to ?? pendingRange.from });
      setRankingPeriod(0);
    } else if (pendingPeriod !== null) {
      setRankingPeriod(pendingPeriod);
      setRankingRange(null);
    }
    setRankingPopoverOpen(false);
  };

  const handleOpenPriceSheet = useCallback(async (item: { id: string; title: string; thumbnail: string; price: number }) => {
    setPriceSheetItem(item);
    setPriceSheetOpen(true);
    setSuggestion(null);
    setNoSuggestion(false);
    setLoadingSuggestion(true);
    try {
      const result = await fetchItemSuggestion(item.id);
      setSuggestion(result.suggestion);
      setNoSuggestion(result.no_suggestion);
    } finally {
      setLoadingSuggestion(false);
    }
  }, [fetchItemSuggestion]);

  const openDetail = useCallback((item: ProductItem) => {
    setSelectedItem(item);
    setDetailModalOpen(true);
  }, []);

  const toggleSort = (field: string) => {
    const asc = `${field}_asc` as SortBy;
    const desc = `${field}_desc` as SortBy;
    setSortBy((prev) => (prev === asc ? desc : asc));
  };

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Unique brands for filter
  const brands = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => { if (i.brand) set.add(i.brand); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  // Filter + sort
  const filtered = useMemo(() => {
    return items
      .filter((item) => {
        // Filtro do Consultor (?items=): intenção explícita de ver ESTES produtos.
        // Ignora os demais filtros (status, estoque, marca, busca) — senão itens
        // pausados/sem estoque sinalizados (ex: prejuízo) somem da lista.
        if (highlightIds !== null) return highlightIds.has(item.id);
        const matchesSearch =
          item.title.toLowerCase().includes(search.toLowerCase()) ||
          item.id.toLowerCase().includes(search.toLowerCase());
        if (!matchesSearch) return false;
        if (statusFilter === "active" && item.status !== "active") return false;
        if (statusFilter === "paused" && item.status !== "paused") return false;
        if (stockFilter === "out" && item.available_quantity !== 0) return false;
        if (stockFilter === "low" && !(item.available_quantity > 0 && item.available_quantity <= 5)) return false;
        if (stockFilter === "in_stock" && item.available_quantity === 0) return false;
        if (brandFilter !== "all" && (item.brand || "") !== brandFilter) return false;
        if (hideOutOfStock && item.available_quantity === 0) return false;
        if (logisticFilter !== "all") {
          const lt = item.logistic_type || "";
          const match = logisticFilter === "drop_off"
            ? lt === "drop_off" || lt === "xd_drop_off"
            : lt === logisticFilter;
          if (!match) return false;
        }
        if (onlyDiscount && columnView === "preco") {
          const cachedDealPrice = dealPriceCache.get(item.id);
          const priceSale = cachedDealPrice ?? item.price;
          if (!(cachedDealPrice != null && priceSale < item.price)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "price_desc") return b.price - a.price;
        if (sortBy === "price_asc") return a.price - b.price;
        if (sortBy === "stock_desc") return b.available_quantity - a.available_quantity;
        if (sortBy === "stock_asc") return a.available_quantity - b.available_quantity;
        if (sortBy === "title_desc") return b.title.localeCompare(a.title);
        return a.title.localeCompare(b.title);
      });
  }, [items, search, statusFilter, stockFilter, sortBy, brandFilter, hideOutOfStock, logisticFilter, onlyDiscount, columnView, dealPriceCache, highlightIds]);

  // ── AV-03: quantos dos anúncios EXIBIDOS estão sem CMV ────────────────────
  // O conjunto é `filtered` — o que está na tela —, nunca o catálogo inteiro:
  // um aviso que conta o catálogo enquanto a tela mostra um recorte é mais uma
  // régua escondida. A fonte de "tem custo" é `costFor`, exatamente a mesma que
  // alimenta `calcularMargensDoAnuncio` nas colunas de margem teórica (e, como
  // lá, `custo != null` — custo zero é um custo válido, não uma ausência).
  const contagemCusto = useMemo(
    () =>
      contarSemCusto(
        filtered.map((item) => ({
          temCusto: costFor(item.id, item.seller_custom_field || null)?.cost != null,
        })),
      ),
    [filtered, costFor],
  );

  // Lazy-fetch de preço real (current_price via suggestions API) para todos os itens
  // visíveis ao entrar na view "Preço" — cobre deal_ids E promoções do vendedor
  const filteredItemKey = useMemo(
    () => filtered.map(i => i.id).sort().join(','),
    [filtered],
  );

  useEffect(() => {
    const needsFetch = columnView === "preco" || (columnView === "financeiro" && usePromoPrice);
    if (!needsFetch || !filteredItemKey) return;
    const toFetch = filtered.filter(i => !dealPriceCache.has(i.id));
    if (toFetch.length === 0) return;
    toFetch.forEach(async (item) => {
      const result = await fetchSalePrice(item.id, item._ml_user_id);
      // price_sale = preço efetivo que o comprador paga (inclui promoções de canal)
      // Só sobrescreve item.price se houver realmente um preço promocional diferente
      const price = result.price_sale;
      if (price != null) {
        setDealPriceCache(prev => new Map(prev).set(item.id, price));
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnView, usePromoPrice, filteredItemKey]);

  // Lazy-fetch da comissão real (ML Listing Costs API) para todos os itens filtrados.
  // Populado independentemente de columnView para que a comissão real (via listing_prices/sale_fee)
  // esteja disponível em qualquer visualização — DATA-05: commCache prioritário sobre LISTING_TYPE_RATES.
  useEffect(() => {
    if (!filteredItemKey) return;
    const toFetch = filtered.filter(i => !commCache.has(i.id));
    if (toFetch.length === 0) return;
    // Processa em chunks de 5 com Promise.allSettled — sem isso, um catálogo
    // grande dispara centenas de chamadas simultâneas à ML API (risco de 429
    // degradando todo o token) a cada mudança de filtro.
    let cancelled = false;
    const CHUNK_SIZE = 5;
    (async () => {
      for (let i = 0; i < toFetch.length && !cancelled; i += CHUNK_SIZE) {
        const chunk = toFetch.slice(i, i + CHUNK_SIZE);
        await Promise.allSettled(chunk.map(async (item) => {
          const costs = await fetchCosts({
            price: item.price,
            categoryId: item.category_id ?? undefined,
            logisticType: item.logistic_type ?? undefined,
          });
          if (!costs.length || cancelled) return;
          const lt = item.listing_type_id ?? "";
          // Tenta correspondência exata, depois parcial, depois usa o primeiro resultado
          const match =
            costs.find(c => c.listing_type_id === lt) ??
            costs.find(c => lt.includes(c.listing_type_id) || c.listing_type_id.includes(lt)) ??
            costs[0];
          if (!match) return;
          const amount = match.sale_fee_amount > 0
            ? match.sale_fee_amount
            : item.price * match.percentage_fee / 100;
          setCommCache(prev => new Map(prev).set(item.id, { pct: match.percentage_fee, amount }));
        }));
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredItemKey]);

  // KPI stats derived from filtered items so cards react to active filters
  const filteredKPIs = useMemo(() => {
    const totalRevenuePotential = filtered.reduce((s, i) => s + i.price * i.available_quantity, 0);
    const avgPrice = filtered.length > 0 ? filtered.reduce((s, i) => s + i.price, 0) / filtered.length : 0;
    const totalSold = filtered.reduce((s, i) => s + i.sold_quantity, 0);
    return { totalRevenuePotential, avgPrice, totalSold };
  }, [filtered]);

  // ─── Reports data ───────────────────────────────────────────────────────────
  // CR-07: aqui existiam dois fallbacks para `sold_quantity × price` — unidades
  // vendidas ao longo de ANOS multiplicadas pelo preço de HOJE — disparados por
  // uma condição de TAMANHO DE MAPA, válida para o dataset inteiro. Um período
  // genuinamente sem vendas fazia TODOS os itens voltarem em silêncio ao número
  // vitalício: um período vazio parecia um período cheio. Os dois morreram. A
  // ausência no mapa agora é zero, e zero é o que a tela mostra.
  const rankingAll = useMemo(() => {
    return [...items]
      .map((i) => ({
        id: i.id,
        title: i.title,
        thumbnail: i.thumbnail,
        price: i.price,
        sold: rankingSoldMap.get(i.id) ?? 0,
        revenue: rankingRevenueMap.get(i.id) ?? 0,
        stock: i.available_quantity,
        brand: i.brand || "Sem marca",
        _ml_user_id: i._ml_user_id,
      }))
      .sort((a, b) => b.sold - a.sold);
  }, [items, rankingSoldMap, rankingRevenueMap]);

  const rankingFiltered = useMemo(() => {
    let base = rankingBrandFilter === "all"
      ? rankingAll
      : rankingAll.filter((r) => r.brand === rankingBrandFilter);

    if (rankingSearch.trim()) {
      const q = rankingSearch.trim().toLowerCase();
      base = base.filter((r) => r.title.toLowerCase().includes(q) || r.id.toLowerCase().includes(q));
    }

    // AV-06: a participação divide pela receita do conjunto FILTRADO — o mesmo
    // conjunto que alimenta o KPI de Receita Total ao lado. Antes dividia pelo
    // total de TODOS os itens, e com filtro de marca ativo a coluna não fechava
    // em cem nem batia com o cartão.
    const comShare = calcularParticipacao(
      base.map((r) => ({ ...r, receita: r.revenue })),
    ).map((r) => ({ ...r, share: r.participacao }));

    const [field, dir] = rankingSort.split("_");
    return [...comShare].sort((a, b) => {
      const aVal = field === "price" ? a.price
        : field === "sold"    ? a.sold
        : field === "revenue" ? a.revenue
        : field === "stock"   ? a.stock
        : field === "share"   ? a.share
        : a.sold;
      const bVal = field === "price" ? b.price
        : field === "sold"    ? b.sold
        : field === "revenue" ? b.revenue
        : field === "stock"   ? b.stock
        : field === "share"   ? b.share
        : b.sold;
      return dir === "asc" ? aVal - bVal : bVal - aVal;
    });
  }, [rankingAll, rankingBrandFilter, rankingSearch, rankingSort]);

  // CR-07: sinal explícito de que a janela do relatório foi resolvida e não
  // trouxe venda nenhuma. Deriva da JANELA, não do tamanho de um mapa usado
  // como gatilho de fallback — o fallback não existe mais.
  const periodoSemVenda = rankingWindow.resolvida && rankingDeduped.length === 0;
  const avisoPeriodoSemVenda = rankingWindow.from === null && rankingWindow.resolvida
    ? "Nenhuma venda registrada na base para esta loja — não há período a exibir."
    : `Nenhuma venda no período selecionado (${rankingLabel}). Os valores abaixo são zero porque não houve venda, não porque falta dado.`;

  const rankingKPIs = useMemo(() => {
    const totalUnits = rankingFiltered.reduce((s, r) => s + r.sold, 0);
    const totalRev = rankingFiltered.reduce((s, r) => s + r.revenue, 0);
    return { totalUnits, totalRev, avgTicket: totalUnits > 0 ? totalRev / totalUnits : 0 };
  }, [rankingFiltered]);

  const brandData = useMemo(() => {
    // Mesma régua do ranking: receita do período, sem fallback vitalício (CR-07).
    const map = new Map<string, { revenue: number; qty: number; ads: number; stock: number }>();
    items.forEach((i) => {
      const brand = i.brand || "Sem marca";
      const sold = rankingSoldMap.get(i.id) ?? 0;
      const prev = map.get(brand) ?? { revenue: 0, qty: 0, ads: 0, stock: 0 };
      map.set(brand, {
        revenue: prev.revenue + (rankingRevenueMap.get(i.id) ?? 0),
        qty: prev.qty + sold,
        ads: prev.ads + 1,
        stock: prev.stock + i.available_quantity,
      });
    });
    return Array.from(map.entries())
      .map(([brand, d]) => ({ brand, ...d, avgTicket: d.qty > 0 ? d.revenue / d.qty : 0 }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [items, rankingSoldMap, rankingRevenueMap]);

  const maxBrandRevenue = brandData.length > 0 ? brandData[0].revenue : 1;

  // Chart data for brand analysis
  const CHART_COLORS = [
    "hsl(var(--primary))", "hsl(var(--accent))", "hsl(25,95%,53%)", "hsl(270,70%,50%)",
    "hsl(160,60%,45%)", "hsl(340,75%,55%)", "hsl(200,70%,50%)", "hsl(45,93%,47%)",
    "hsl(120,40%,55%)", "hsl(0,65%,50%)",
  ];

  const brandBarData = useMemo(() =>
    brandData.slice(0, 10).map((b) => ({ name: b.brand, revenue: b.revenue })),
  [brandData]);

  const brandPieData = useMemo(() => {
    const top8 = brandData.slice(0, 8).map((b) => ({ name: b.brand, value: b.qty }));
    const othersQty = brandData.slice(8).reduce((s, b) => s + b.qty, 0);
    if (othersQty > 0) top8.push({ name: "Outros", value: othersQty });
    return top8;
  }, [brandData]);

  // ─── ABC Curve data ──────────────────────────────────────────────────────────
  // CR-06: a curva ABC classificava por `sold_quantity × price` — unidades
  // vendidas ao longo de ANOS multiplicadas pelo preço de HOJE — enquanto a
  // coluna "Receita" do Ranking ao lado mostrava a receita do período. Duas
  // colunas com o mesmo rótulo e números diferentes para o mesmo anúncio.
  // Agora a entrada é `rankingRevenueMap`: exatamente a mesma fonte do Ranking,
  // na janela que o seletor de período da tela definiu.
  const abcResultado = useMemo(
    () =>
      classificarCurvaAbc(
        items.map((i) => ({
          id: i.id,
          receita: rankingRevenueMap.get(i.id) ?? 0,
          title: i.title,
          thumbnail: i.thumbnail,
          price: i.price,
          sold: rankingSoldMap.get(i.id) ?? 0,
          stock: i.available_quantity,
          brand: i.brand || "Sem marca",
        })),
      ),
    [items, rankingRevenueMap, rankingSoldMap],
  );

  const abcData = useMemo(
    () => abcResultado.itens.map((r) => ({ ...r, revenue: r.receita, curve: r.curva })),
    [abcResultado],
  );

  const abcSummary = useMemo(
    () => ({
      A: abcResultado.resumo.A,
      B: abcResultado.resumo.B,
      C: abcResultado.resumo.C,
      total: abcResultado.resumo.total,
    }),
    [abcResultado],
  );

  const abcChartData = useMemo(() => {
    if (abcData.length === 0) return [];
    const step = Math.max(1, Math.floor(abcData.length / 50));
    return abcData.filter((_, idx) => idx % step === 0 || idx === abcData.length - 1).map((d) => ({
      rank: d.rank,
      pct: Number(d.pct.toFixed(2)),
      cumPct: Number(d.cumPct.toFixed(2)),
      title: d.title,
      curve: d.curve,
    }));
  }, [abcData]);

  if (hasToken === false) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Plug className="w-12 h-12 mb-4 text-muted-foreground/40" />
            <h3 className="text-lg font-semibold mb-2">Conta não conectada</h3>
            <p className="text-sm text-muted-foreground mb-4">Conecte sua conta do Mercado Livre para visualizar os anúncios.</p>
            <Button asChild><Link to="/integracoes">Ir para Integrações</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
    <Tabs defaultValue="catalogo" className="space-y-5">
      {/* ── Sticky header ── */}
      <div className="sticky -top-4 md:-top-6 lg:-top-8 z-20 -mx-4 md:-mx-6 lg:-mx-8 -mt-4 md:-mt-6 lg:-mt-8 px-4 md:px-6 lg:px-8 pb-4 pt-4 bg-background/95 backdrop-blur-sm border-b border-border/40">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <MLPageHeader title="Anúncios" lastUpdated={lastUpdated} />
          <div className="flex items-center gap-3">
            <TabsList className="h-8">
              <TabsTrigger value="catalogo"  className="text-xs px-3 h-7">Anúncios</TabsTrigger>
              <TabsTrigger value="relatorios" className="text-xs px-3 h-7">Relatórios</TabsTrigger>
              <TabsTrigger value="custos"    className="text-xs px-3 h-7">Custos</TabsTrigger>
            </TabsList>
            <Button
              onClick={() => { refresh(); precosRefresh(); }}
              disabled={loading}
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:bg-muted hover:text-muted-foreground"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </div>
      </div>

      {/* ═══════════════════ ABA CATÁLOGO ═══════════════════ */}
      <TabsContent value="catalogo" className="space-y-5 mt-0">
        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {loading && items.length === 0 ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}><CardContent className="p-6"><Skeleton className="h-16 w-full" /></CardContent></Card>
            ))
          ) : (
            <>
              <KPICard title="Total de Anúncios" value={String(filtered.length)} icon={<ShoppingBag className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-accent/10 text-accent" tooltip="Quantidade de anúncios que correspondem ao filtro atual." />
              <KPICard title="Ticket Médio" value={currencyFmt(filteredKPIs.avgPrice)} icon={<Tag className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-[hsl(25,95%,53%)]/10 text-[hsl(25,95%,53%)]" tooltip={tip("ticket_medio")} />
              <KPICard title="Unidades Vendidas" value={String(filteredKPIs.totalSold)} icon={<TrendingUp className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-[hsl(270,70%,50%)]/10 text-[hsl(270,70%,50%)]" tooltip={tip("unidades_vendidas")} />
              <KPICard title="Receita Potencial" value={filteredKPIs.totalRevenuePotential.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 })} icon={<DollarSign className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-success/10 text-success" tooltip="Receita potencial dos anúncios filtrados com base no preço atual e estoque disponível." />
            </>
          )}
        </div>

        {/* CATALOG-02 — tax config missing banner */}
        {showTaxBanner && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800">Regime tributário não configurado</p>
              <p className="text-xs text-amber-700 mt-1">
                Uma ou mais contas não têm regime tributário configurado. A coluna Impostos pode não refletir os valores corretos.{" "}
                <Link to="/fiscal" className="underline font-medium">Configurar agora →</Link>
              </p>
            </div>
          </div>
        )}

        {/* ── AV-03 — ausência de custo, em agregado ──
            Convive com o banner de regime tributário acima: um fala de imposto,
            o outro de custo, e faltar qualquer um dos dois quebra a margem por
            um motivo diferente. Só na visão Financeiro, que é onde as colunas de
            margem aparecem. */}
        {columnView === "financeiro" && (
          <AvisoCustoFaltante contagem={contagemCusto} destinoCadastro="/precificacao" />
        )}

        {/* ── CR-09 — de onde veio o número de publicidade da coluna Mg. Pós-Ads ──
            A régua desta coluna é a fatura do ML rateada por anúncio. A troca
            nunca pode acontecer escondida, e a parcela da fatura sem chave de
            rateio aparece aqui em vez de sumir. */}
        {columnView === "financeiro" && adsMeta && (
          <AdsOrigemNota source={adsMeta.source} naoRateado={adsMeta.naoRateado} />
        )}

        {/* Filters + Table */}
        <Card>
          <div className="px-4 pt-4 pb-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <span className="text-sm font-medium text-foreground">Catálogo de Anúncios</span>
              <div className="flex items-center gap-1.5 w-full sm:w-auto flex-wrap">
                {/* Search */}
                <div className="relative flex-1 min-w-[120px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <Input placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-xs w-full" />
                </div>

                {/* Brand filter */}
                <Select value={brandFilter} onValueChange={setBrandFilter}>
                  <SelectTrigger className="w-full sm:w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as marcas</SelectItem>
                    {brands.map((b) => (
                      <SelectItem key={b} value={b}>{b}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Logistic filter */}
                <Select value={logisticFilter} onValueChange={(v) => setLogisticFilter(v as LogisticFilter)}>
                  <SelectTrigger className="w-full sm:w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toda logística</SelectItem>
                    <SelectItem value="fulfillment">Full</SelectItem>
                    <SelectItem value="cross_docking">Coleta</SelectItem>
                    <SelectItem value="self_service">Flex</SelectItem>
                    <SelectItem value="drop_off">Drop Off</SelectItem>
                  </SelectContent>
                </Select>

                {/* Hide out of stock */}
                <label className="flex items-center gap-1.5 cursor-pointer opacity-60 hover:opacity-100 transition-opacity">
                  <Checkbox
                    checked={hideOutOfStock}
                    onCheckedChange={(v) => setHideOutOfStock(!!v)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Ocultar sem estoque</span>
                </label>

                {/* Only with discount (only for "Preço" view) */}
                {columnView === "preco" && (
                  <label className="flex items-center gap-1.5 cursor-pointer opacity-60 hover:opacity-100 transition-opacity">
                    <Checkbox
                      checked={onlyDiscount}
                      onCheckedChange={(v) => setOnlyDiscount(!!v)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">Com desconto</span>
                  </label>
                )}

                {columnView === "financeiro" && (
                  <label className="flex items-center gap-1.5 cursor-pointer opacity-60 hover:opacity-100 transition-opacity">
                    <Checkbox
                      checked={usePromoPrice}
                      onCheckedChange={(v) => setUsePromoPrice(!!v)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">Preço promocional</span>
                  </label>
                )}

                {/* Column view toggle */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5">
                      <button
                        onClick={() => setColumnView("financeiro")}
                        className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all ${columnView === "financeiro" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        <Receipt className="w-3 h-3" /> Financeiro
                      </button>
                      <button
                        onClick={() => setColumnView("preco")}
                        className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all ${columnView === "preco" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        <BarChart2 className="w-3 h-3" /> Preço
                      </button>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>Alternar visão de colunas</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>

          {highlightIds !== null && (
            <div className="flex items-center gap-2 px-4 py-2 bg-accent/10 border-b border-accent/20 text-sm text-accent-foreground">
              <Lightbulb className="w-4 h-4 shrink-0 text-accent" />
              <span>Mostrando {filtered.length} produto(s) sinalizado(s) pelo Consultor</span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-6 px-2 text-xs"
                onClick={() => setSearchParams((prev) => { const p = new URLSearchParams(prev); p.delete("items"); return p; })}
              >
                Limpar filtro
              </Button>
            </div>
          )}

          <CardContent className="p-0">
            {loading && items.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                <p className="text-sm">Carregando anúncios...</p>
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={ShoppingBag}
                title={search || stockFilter !== "all" || statusFilter !== "all" ? "Nenhum produto encontrado" : "Nenhum produto ativo"}
                description={search || stockFilter !== "all" || statusFilter !== "all"
                  ? "Nenhum anúncio corresponde ao filtro atual. Tente limpar os filtros."
                  : "Você não tem anúncios ativos no Mercado Livre."}
                size="compact"
              />
            ) : isMobile ? (
              /* ── Mobile: stacked cards (D-06) ── */
              <div className="space-y-2 p-2">
                {/* CR-09: o ramo mobile não tem cabeçalho de coluna onde pendurar
                    o tooltip — a janela da Mg. Op. é declarada aqui, uma vez,
                    para que os dois ramos digam a mesma coisa. */}
                {columnView === "financeiro" && (
                  <p className="text-[10px] text-muted-foreground px-1">
                    Mg. Op. apurada sobre as vendas de{" "}
                    <span className="tabular-nums">{janelaMargemLabel}</span>.
                  </p>
                )}
                {filtered.map((item) => {
                  // AV-05: o campo de SKU do item é seller_custom_field — seller_sku
                  // não existe no tipo ProductItem e nunca resolvia custo vindo do Tiny.
                  const sku = item.seller_custom_field || null;
                  const productCost = costFor(item.id, sku);
                  const cost = productCost?.cost ?? null;
                  // Mesma resolução de alíquota e comissão real do ramo desktop, para
                  // que os dois ramos recebam exatamente a mesma entrada (CR-08).
                  const taxEntry = item._ml_user_id ? taxMap?.get(item._ml_user_id) : undefined;
                  const effectiveTaxRate = taxEntry != null
                    ? Math.max(0, taxEntry.effective_rate)
                    : (productCost?.tax_rate ?? null);
                  const commCached = commCache.get(item.id);
                  const margens = calcularMargensDoAnuncio({
                    precoTabela: item.price,
                    precoPromocional: dealPriceCache.get(item.id) ?? null,
                    usarPromocao: usePromoPrice,
                    custo: cost,
                    aliquotaEfetivaPct: effectiveTaxRate,
                    comissaoRealPct: commCached?.pct ?? null,
                    tipoAnuncio: item.listing_type_id,
                  });
                  const marginBruta = margens.margemBruta;
                  const marginLiq = margens.margemLiquida;
                  const mads = marginByItem.get(item.id);
                  const mgOp = mads?.lucro_pct;
                  return (
                    <div
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openDetail(item)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(item); } }}
                      className="rounded-lg border border-border bg-card p-3 space-y-1.5 cursor-pointer active:bg-muted/50 transition-colors"
                    >
                      <p className="text-xs font-medium line-clamp-2">{item.title}</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        {([
                          ["Preço",   currencyFmt(item.price)],
                          ["Estoque", String(item.available_quantity)],
                          ...(columnView === "financeiro" ? [
                            ["Mg. Bruta", marginBruta != null ? `${marginBruta.toFixed(1)}%` : "—"],
                            ["Mg. Líq.",  marginLiq   != null ? `${marginLiq.toFixed(1)}%`   : "—"],
                            ["Mg. Op.",   mgOp        != null ? `${mgOp.toFixed(1)}%`         : "—"],
                          ] as [string, string][] : []),
                        ] as [string, string][]).map(([label, val]) => (
                          <div key={label}>
                            <span className="text-muted-foreground">{label} </span>
                            <span className="font-mono tabular-nums">{val}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* ── Desktop: shadcn Table (D-07) ── */
              <div className="max-h-[600px] overflow-x-auto overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-card z-10">
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead className="w-12" />
                      <SortableHead label="Anúncio" field="title" current={sortBy} onSort={toggleSort} />
                      <TableHead className="text-xs w-24">SKU</TableHead>
                      <SortableHead label="Preço" field="price" current={sortBy} onSort={toggleSort} className="text-right w-24" />
                      <SortableHead label="Estoque" field="stock" current={sortBy} onSort={toggleSort} className="text-right w-20" />
                      {columnView === "financeiro" ? (
                        <>
                          <TableHead className="text-xs text-right w-28">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help border-b border-dashed border-muted-foreground/40">Custo</span>
                              </TooltipTrigger>
                              <TooltipContent className="text-xs max-w-[200px]">Custo do produto (CMV). Clique na célula para editar.</TooltipContent>
                            </Tooltip>
                          </TableHead>
                          <TableHead className="text-xs text-right w-24">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help border-b border-dashed border-muted-foreground/40">Impostos</span>
                              </TooltipTrigger>
                              <TooltipContent className="text-xs max-w-[220px]">Estimativa baseada no regime tributário configurado em Fiscal. Não considere créditos de entrada. Consulte seu contador.</TooltipContent>
                            </Tooltip>
                          </TableHead>
                          <TableHead className="text-xs text-right w-28">Comissão ML</TableHead>
                          <TableHead className="text-xs text-right w-28">Mg. Bruta</TableHead>
                          <TableHead className="text-xs text-right w-28">Mg. Líq.</TableHead>
                          <TableHead className="text-xs text-right w-28">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help border-b border-dashed border-muted-foreground/40">
                                  Mg. Op.
                                  {/* CR-09: a janela que a coluna cobre, em datas. Sem
                                      isso, uma coluna de margem ao lado de um seletor de
                                      período é um convite ao engano. */}
                                  <span className="block text-[9px] font-normal text-muted-foreground tabular-nums">
                                    {janelaMargemLabel}
                                  </span>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="text-xs max-w-[220px]">
                                Margem com base nas vendas reais de {janelaMargemLabel} — a mesma
                                janela do relatório de Ranking.
                              </TooltipContent>
                            </Tooltip>
                          </TableHead>
                          <TableHead className="text-xs text-right w-28">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help border-b border-dashed border-muted-foreground/40">
                                  Mg. Pós-Ads
                                  <span className="block text-[9px] font-normal text-muted-foreground tabular-nums">
                                    {janelaMargemLabel}
                                  </span>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="text-xs max-w-[220px]">
                                Margem de {janelaMargemLabel} após descontar a publicidade do
                                anúncio — na régua da fatura do Mercado Livre rateada, não do
                                relatório de publicidade.
                              </TooltipContent>
                            </Tooltip>
                          </TableHead>
                        </>
                      ) : (
                        <>
                          <TableHead className="text-xs text-right w-32">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help border-b border-dashed border-muted-foreground/40">Preço atual</span>
                              </TooltipTrigger>
                              <TooltipContent className="text-xs max-w-[220px]">
                                Preço efetivo cobrado do comprador, incluindo promoções de canal do Mercado Livre.
                              </TooltipContent>
                            </Tooltip>
                          </TableHead>
                          <TableHead className="text-xs text-center w-24">Frete</TableHead>
                          <TableHead className="text-xs text-center w-28">Análise</TableHead>
                        </>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((item) => {
                      const isExpanded = expandedRows.has(item.id);
                      const sku = item.seller_custom_field || null;

                      return (
                        <>
                          <TableRow
                            key={item.id}
                            className={item.has_variations ? "cursor-pointer hover:bg-muted/50" : ""}
                            onClick={() => item.has_variations && toggleRow(item.id)}
                          >
                            <TableCell className="p-1 pl-3">
                              {item.has_variations ? (
                                isExpanded
                                  ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                  : <ChevronRight className="w-4 h-4 text-muted-foreground" />
                              ) : null}
                            </TableCell>

                            <TableCell className="p-2 cursor-pointer" onClick={(e) => { e.stopPropagation(); openDetail(item); }} title="Ver detalhes">
                              {item.thumbnail ? (
                                <img src={item.thumbnail.replace("http://", "https://")} alt="" className="w-10 h-10 rounded object-cover hover:opacity-80 transition-opacity" loading="lazy" />
                              ) : (
                                <div className="w-10 h-10 rounded bg-muted flex items-center justify-center hover:bg-muted/70 transition-colors">
                                  <Package className="w-4 h-4 text-muted-foreground" />
                                </div>
                              )}
                            </TableCell>

                            <TableCell>
                              <a href={mlListingUrl(item.id)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs font-medium line-clamp-2 leading-tight hover:underline hover:text-primary transition-colors">
                                {item.title} <ExternalLink className="w-3 h-3 inline mb-0.5 ml-0.5" />
                              </a>
                              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                <p className="text-xs text-muted-foreground font-mono">{item.id}</p>
                                {item.has_variations && item.variations.length > 0 && (
                                  <Badge variant="outline" className="text-[10px] h-4 px-1">
                                    {item.variations.length} var.
                                  </Badge>
                                )}
                                {item.catalog_product_id && <CatalogBadge />}
                                {item.deal_ids.length > 0 && <PromoBadge count={item.deal_ids.length} />}
                              </div>
                            </TableCell>

                            {/* SKU — dedicated column */}
                            <TableCell className="text-xs text-muted-foreground font-mono">
                              {sku || <span className="text-muted-foreground/40">—</span>}
                            </TableCell>

                            <TableCell className="text-right text-xs font-medium">
                              {(() => {
                                if (columnView === "financeiro" && usePromoPrice) {
                                  const promoP = dealPriceCache.get(item.id);
                                  if (promoP != null && promoP < item.price) {
                                    return (
                                      <div className="flex flex-col items-end gap-0.5">
                                        <div className="flex items-center gap-1">
                                          <Badge className="text-[9px] font-bold bg-orange-500/15 text-orange-600 hover:bg-orange-500/15 border-0 px-1.5 py-0 h-4 leading-none pointer-events-none">
                                            −{Math.round(((item.price - promoP) / item.price) * 100)}%
                                          </Badge>
                                          <span className="font-semibold tabular-nums">{currencyFmt(promoP)}</span>
                                        </div>
                                        <span className="text-[10px] font-mono tabular-nums text-muted-foreground line-through">{currencyFmt(item.price)}</span>
                                      </div>
                                    );
                                  }
                                  return <span>{currencyFmt(promoP ?? item.price)}</span>;
                                }
                                return <span>{currencyFmt(item.price)}</span>;
                              })()}
                            </TableCell>

                            {/* Estoque — always visible */}
                            <TableCell className="text-right">
                              <span className={`text-xs font-semibold tabular-nums ${item.available_quantity === 0 ? "text-destructive" : "text-foreground"}`}>
                                {item.available_quantity}
                              </span>
                            </TableCell>

                            {columnView === "financeiro" ? (() => {
                              const productCost = costFor(item.id, sku);
                              const cost = productCost?.cost ?? null;
                              const taxEntry = item._ml_user_id ? taxMap?.get(item._ml_user_id) : undefined;
                              const effectiveTaxRate = taxEntry != null
                                ? Math.max(0, taxEntry.effective_rate)
                                : (productCost?.tax_rate ?? null);
                              const commCached = commCache.get(item.id);
                              // Fonte única da margem teórica (CR-08) — ver src/lib/anuncioMargens.ts.
                              const margens = calcularMargensDoAnuncio({
                                precoTabela: item.price,
                                precoPromocional: dealPriceCache.get(item.id) ?? null,
                                usarPromocao: usePromoPrice,
                                custo: cost,
                                aliquotaEfetivaPct: effectiveTaxRate,
                                comissaoRealPct: commCached?.pct ?? null,
                                tipoAnuncio: item.listing_type_id,
                              });
                              const { comissaoValor: commission, impostoValor, margemBruta: marginBruta, margemLiquida: marginLiq } = margens;
                              const mgBrutaColor = marginBruta == null ? "" : marginBruta >= 50 ? "text-emerald-600" : marginBruta >= 30 ? "text-amber-600" : "text-red-600";
                              const mgLiqColor   = marginLiq   == null ? "" : marginLiq   >= 30 ? "text-emerald-600" : marginLiq   >= 10 ? "text-amber-600" : "text-red-600";
                              return (
                                <>
                                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                    <InlineEditCell
                                      value={cost}
                                      format="currency"
                                      onSave={async (v) => { const prev = costs.get(item.id); await upsertCost(item.id, v, prev?.tax_rate ?? null); }}
                                    />
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {effectiveTaxRate != null ? (
                                      <span className="text-xs font-mono tabular-nums">
                                        {currencyFmt(impostoValor ?? 0)}{" "}
                                        ({(effectiveTaxRate).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%)
                                      </span>
                                    ) : (
                                      <span className="text-xs text-muted-foreground/40">—</span>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <span className="text-xs text-destructive font-mono tabular-nums">−{currencyFmt(commission)}</span>
                                    {margens.comissaoReal
                                      ? <span className="text-[10px] text-muted-foreground ml-1">({margens.comissaoPct.toFixed(1)}%)</span>
                                      : <span className="text-[10px] text-muted-foreground ml-1 animate-pulse">…</span>}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {marginBruta != null
                                      ? <span className={`text-xs font-bold tabular-nums ${mgBrutaColor}`}>{marginBruta.toFixed(1)}%</span>
                                      : <span className="text-xs text-muted-foreground/40">—</span>}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {marginLiq != null
                                      ? <span className={`text-xs font-bold tabular-nums ${mgLiqColor}`}>{marginLiq.toFixed(1)}%</span>
                                      : <span className="text-xs text-muted-foreground/40">—</span>}
                                  </TableCell>
                                  {/* Mg. Op. e Mg. Pós-Ads — dados reais de pedidos do período via RPC */}
                                  {(() => {
                                    const mads = marginByItem.get(item.id);
                                    const mgOp     = mads?.lucro_pct;
                                    const mgPosAds = mads?.lucro_pct_pos_ads;
                                    const colorFor = (v: number | null | undefined) =>
                                      v == null ? "" : v >= 0 ? "text-kpi-positive" : "text-kpi-negative";
                                    const semVendas = mads === undefined;
                                    return (
                                      <>
                                        <TableCell className="text-right">
                                          {semVendas || mgOp == null ? (
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <span className="text-xs text-muted-foreground/40 cursor-help">—</span>
                                              </TooltipTrigger>
                                              <TooltipContent className="text-xs max-w-[220px]">
                                                Sem vendas no período selecionado
                                              </TooltipContent>
                                            </Tooltip>
                                          ) : (
                                            <span className={`text-xs font-bold tabular-nums ${colorFor(mgOp)}`}>{mgOp!.toFixed(1)}%</span>
                                          )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                          {semVendas || mgPosAds == null ? (
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <span className="text-xs text-muted-foreground/40 cursor-help">—</span>
                                              </TooltipTrigger>
                                              <TooltipContent className="text-xs max-w-[220px]">
                                                Sem vendas no período selecionado
                                              </TooltipContent>
                                            </Tooltip>
                                          ) : (
                                            <span className={`text-xs font-bold tabular-nums ${colorFor(mgPosAds)}`}>{mgPosAds!.toFixed(1)}%</span>
                                          )}
                                        </TableCell>
                                      </>
                                    );
                                  })()}
                                </>
                              );
                            })() : (() => {
                              const cachedPrice = dealPriceCache.get(item.id);
                
                              const priceSale = cachedPrice ?? item.price;
                              const hasDiscount = cachedPrice != null && cachedPrice < item.price;
                              const loadingPrice = cachedPrice == null;
                              return (
                                <>
                                  <TableCell className="text-right">
                                    {loadingPrice ? (
                                      <span className="text-xs text-muted-foreground animate-pulse font-mono">…</span>
                                    ) : (
                                      <div className="flex flex-col items-end gap-0.5">
                                        <div className="flex items-center gap-1.5">
                                          {hasDiscount && (
                                            <Badge className="text-[9px] font-bold bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15 hover:text-emerald-600 border-0 px-1.5 py-0 h-4 leading-none pointer-events-none">
                                              −{Math.round(((item.price - priceSale) / item.price) * 100)}%
                                            </Badge>
                                          )}
                                          <span className="text-xs font-semibold font-mono tabular-nums text-foreground">
                                            {currencyFmt(priceSale)}
                                          </span>
                                        </div>
                                        {hasDiscount && (
                                          <span className="text-[10px] font-mono tabular-nums text-muted-foreground line-through">
                                            {currencyFmt(item.price)}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-center">
                                    {item.free_shipping ? (
                                      <Badge variant="outline" className="text-[10px] border-emerald-500 text-emerald-600 bg-emerald-50 px-[4px] py-px">
                                        <Truck className="w-3 h-3 mr-0.5" /> Grátis
                                      </Badge>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">Pago</span>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                                    <div className="flex items-center justify-center gap-1">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-xs px-2 gap-1"
                                        onClick={() => handleOpenPriceSheet({ id: item.id, title: item.title, thumbnail: item.thumbnail ?? "", price: priceSale })}
                                      >
                                        <BarChart2 className="w-3 h-3" />
                                        Análise
                                      </Button>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-7 w-7 p-0"
                                            onClick={(e) => { e.stopPropagation(); openDetail(item); }}
                                            aria-label="Ver detalhes"
                                          >
                                            <Eye className="w-3.5 h-3.5" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="text-xs">Ver detalhes</TooltipContent>
                                      </Tooltip>
                                    </div>
                                  </TableCell>
                                </>
                              );
                            })()}

                          </TableRow>

                          {/* Expanded variations sub-table */}
                          {item.has_variations && isExpanded && (
                            <TableRow key={`${item.id}-variations`}>
                              <TableCell colSpan={columnView === "financeiro" ? 13 : 9} className="p-0 bg-muted/20 border-b">
                                <div className="px-10 py-3">
                                  <Table>
                                    <TableHeader>
                                      <TableRow className="border-b border-border/50">
                                        <TableHead className="text-xs h-8 font-medium">Variação</TableHead>
                                        <TableHead className="text-xs h-8 font-medium text-left">SKU</TableHead>
                                        <TableHead className="text-xs h-8 font-medium text-right">Preço</TableHead>
                                        <TableHead className="text-xs h-8 font-medium text-right">Estoque</TableHead>
                                        {columnView === "financeiro" ? (
                                          <>
                                            <TableHead className="text-xs h-8 font-medium text-right">Custo</TableHead>
                                            <TableHead className="text-xs h-8 font-medium text-right">Impostos</TableHead>
                                            <TableHead className="text-xs h-8 font-medium text-right">Comissão ML</TableHead>
                                            <TableHead className="text-xs h-8 font-medium text-right">Mg. Bruta</TableHead>
                                            <TableHead className="text-xs h-8 font-medium text-right">Mg. Líq.</TableHead>
                                          </>
                                        ) : (
                                          <>
                                            <TableHead className="text-xs h-8 font-medium text-right">Preço atual</TableHead>
                                            <TableHead className="text-xs h-8 font-medium text-center">Frete</TableHead>
                                            <TableHead className="text-xs h-8 font-medium text-center">—</TableHead>
                                          </>
                                        )}
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {item.variations
                                        .filter((v) => !hideOutOfStock || v.available_quantity > 0)
                                        .map((v) => {
                                        const vSku = v.seller_custom_field || null;
                                        return (
                                          <TableRow key={v.variation_id} className="border-b border-border/30 last:border-0">
                                            <TableCell className="py-2 text-xs font-medium">{variationLabel(v)}</TableCell>
                                            <TableCell className="py-2 text-xs text-muted-foreground font-mono">{vSku || "—"}</TableCell>
                                            <TableCell className="py-2 text-xs text-right">
                                              {(() => {
                                                if (columnView === "financeiro" && usePromoPrice) {
                                                  // AV-04: a promoção é publicada pelo anúncio, não pela
                                                  // variação — só é legítima quando a variação parte do
                                                  // mesmo preço de tabela do pai.
                                                  const promoDoPai = dealPriceCache.get(item.id) ?? null;
                                                  const promoAplicavel = precoPromocionalAplicavel(promoDoPai, item.price, v.price);
                                                  if (promoAplicavel != null) {
                                                    return (
                                                      <div className="flex flex-col items-end gap-0.5">
                                                        <div className="flex items-center gap-1">
                                                          <Badge className="text-[9px] font-bold bg-orange-500/15 text-orange-600 hover:bg-orange-500/15 border-0 px-1.5 py-0 h-4 leading-none pointer-events-none">
                                                            −{Math.round(((v.price - promoAplicavel) / v.price) * 100)}%
                                                          </Badge>
                                                          <span className="font-semibold tabular-nums">{currencyFmt(promoAplicavel)}</span>
                                                        </div>
                                                        <span className="text-[10px] font-mono tabular-nums text-muted-foreground line-through">{currencyFmt(v.price)}</span>
                                                      </div>
                                                    );
                                                  }
                                                  if (promoDoPai != null) {
                                                    // O pai tem promoção ativa, mas esta variação tem preço
                                                    // próprio diferente — aplicar o desconto do pai aqui seria
                                                    // um percentual fabricado (o ML não informa a proporção).
                                                    return (
                                                      <Tooltip>
                                                        <TooltipTrigger asChild>
                                                          <span className="cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-2">
                                                            {currencyFmt(v.price)}
                                                          </span>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                          <p className="text-xs max-w-[220px]">Promoção publicada pelo anúncio, não pela variação — esta variação tem preço próprio.</p>
                                                        </TooltipContent>
                                                      </Tooltip>
                                                    );
                                                  }
                                                  return <span>{currencyFmt(v.price)}</span>;
                                                }
                                                return <span>{currencyFmt(v.price)}</span>;
                                              })()}
                                            </TableCell>
                                            <TableCell className="py-2 text-right">
                                              <span className={`text-xs font-semibold ${v.available_quantity === 0 ? "text-destructive" : "text-foreground"}`}>
                                                {v.available_quantity}
                                              </span>
                                            </TableCell>
                                            {columnView === "financeiro" ? (() => {
                                              const productCost = costFor(item.id, v.seller_custom_field || null);
                                              const cost = productCost?.cost ?? null;
                                              const taxEntryV = item._ml_user_id ? taxMap?.get(item._ml_user_id) : undefined;
                                              const effectiveTaxRate = taxEntryV != null
                                                ? Math.max(0, taxEntryV.effective_rate)
                                                : (productCost?.tax_rate ?? null);
                                              const commCachedV = commCache.get(item.id);
                                              // AV-04: a promoção é do anúncio pai; só é legítima para esta
                                              // variação quando ela parte do mesmo preço de tabela do pai.
                                              const promoAplicavelV = precoPromocionalAplicavel(
                                                dealPriceCache.get(item.id) ?? null,
                                                item.price,
                                                v.price,
                                              );
                                              // Fonte única da margem teórica (CR-08) — ver src/lib/anuncioMargens.ts.
                                              const margensV = calcularMargensDoAnuncio({
                                                precoTabela: v.price,
                                                precoPromocional: promoAplicavelV,
                                                usarPromocao: usePromoPrice,
                                                custo: cost,
                                                aliquotaEfetivaPct: effectiveTaxRate,
                                                comissaoRealPct: commCachedV?.pct ?? null,
                                                tipoAnuncio: item.listing_type_id,
                                              });
                                              const { comissaoValor: commission, impostoValor, margemBruta: marginBruta, margemLiquida: marginLiq } = margensV;
                                              const mgBrutaColor = marginBruta == null ? "" : marginBruta >= 50 ? "text-emerald-600" : marginBruta >= 30 ? "text-amber-600" : "text-red-600";
                                              const mgLiqColor   = marginLiq   == null ? "" : marginLiq   >= 30 ? "text-emerald-600" : marginLiq   >= 10 ? "text-amber-600" : "text-red-600";
                                              return (
                                                <>
                                                  <TableCell className="py-2 text-right text-xs text-muted-foreground italic">↑ item</TableCell>
                                                  <TableCell className="py-2 text-right">
                                                    {effectiveTaxRate != null ? (
                                                      <span className="text-xs font-mono tabular-nums text-muted-foreground">
                                                        {currencyFmt(impostoValor ?? 0)}{" "}
                                                        ({(effectiveTaxRate).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%)
                                                      </span>
                                                    ) : (
                                                      <span className="text-xs text-muted-foreground/40">—</span>
                                                    )}
                                                  </TableCell>
                                                  <TableCell className="py-2 text-right">
                                                    <span className="text-xs text-destructive font-mono tabular-nums">−{currencyFmt(commission)}</span>
                                                    {margensV.comissaoReal
                                                      ? <span className="text-[10px] text-muted-foreground ml-1">({margensV.comissaoPct.toFixed(1)}%)</span>
                                                      : <span className="text-[10px] text-muted-foreground ml-1 animate-pulse">…</span>}
                                                  </TableCell>
                                                  <TableCell className="py-2 text-right">
                                                    {marginBruta != null ? <span className={`text-xs font-bold ${mgBrutaColor}`}>{marginBruta.toFixed(1)}%</span> : <span className="text-xs text-muted-foreground/40">—</span>}
                                                  </TableCell>
                                                  <TableCell className="py-2 text-right">
                                                    {marginLiq != null ? <span className={`text-xs font-bold ${mgLiqColor}`}>{marginLiq.toFixed(1)}%</span> : <span className="text-xs text-muted-foreground/40">—</span>}
                                                  </TableCell>
                                                </>
                                              );
                                            })() : (() => {
                                              // AV-04: mesma regra do ramo financeiro acima — a promoção do
                                              // pai só se aplica quando a variação parte do mesmo preço de
                                              // tabela; caso contrário, preço próprio sem selo fabricado.
                                              const promoDoPai = dealPriceCache.get(item.id) ?? null;
                                              const promoAplicavel = precoPromocionalAplicavel(promoDoPai, item.price, v.price);
                                              const priceSale = promoAplicavel ?? v.price;
                                              const hasDiscount = promoAplicavel != null;
                                              const promoNaoAplicavel = promoDoPai != null && promoAplicavel == null;
                                              return (
                                                <>
                                                  <TableCell className="py-2 text-right">
                                                    <div className="flex flex-col items-end gap-0.5">
                                                      <div className="flex items-center gap-1.5">
                                                        {hasDiscount && (
                                                          <Badge className="text-[9px] font-bold bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15 hover:text-emerald-600 border-0 px-1.5 py-0 h-4 leading-none pointer-events-none">
                                                            −{Math.round(((v.price - priceSale) / v.price) * 100)}%
                                                          </Badge>
                                                        )}
                                                        {promoNaoAplicavel ? (
                                                          <Tooltip>
                                                            <TooltipTrigger asChild>
                                                              <span className="text-xs font-semibold font-mono tabular-nums cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-2">
                                                                {currencyFmt(priceSale)}
                                                              </span>
                                                            </TooltipTrigger>
                                                            <TooltipContent>
                                                              <p className="text-xs max-w-[220px]">Promoção publicada pelo anúncio, não pela variação — esta variação tem preço próprio.</p>
                                                            </TooltipContent>
                                                          </Tooltip>
                                                        ) : (
                                                          <span className="text-xs font-semibold font-mono tabular-nums">{currencyFmt(priceSale)}</span>
                                                        )}
                                                      </div>
                                                      {hasDiscount && (
                                                        <span className="text-[10px] font-mono tabular-nums text-muted-foreground line-through">{currencyFmt(v.price)}</span>
                                                      )}
                                                    </div>
                                                  </TableCell>
                                                  <TableCell className="py-2 text-center">
                                                    <span className="text-xs text-muted-foreground">—</span>
                                                  </TableCell>
                                                  <TableCell className="py-2" />
                                                </>
                                              );
                                            })()}
                                          </TableRow>
                                        );
                                      })}
                                    </TableBody>
                                  </Table>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
            {filtered.length > 0 && (
              <div className="px-4 py-3 border-t text-xs text-muted-foreground">
                Exibindo {filtered.length} de {items.length} anúncios
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* ═══════════════════ ABA RELATÓRIOS ═══════════════════ */}
      <TabsContent value="relatorios" className="space-y-5 mt-0">
        {/* ── CR-09 — o segundo ponto onde a régua da fatura aparece na tela ──
            O Ranking traz margem pós-ads por anúncio na mesma janela do
            relatório. Declarar a origem aqui também, e não só no catálogo, é o
            que impede que a aba herde o silêncio. */}
        {adsMeta && (
          <AdsOrigemNota source={adsMeta.source} naoRateado={adsMeta.naoRateado} />
        )}
        <Tabs defaultValue="ranking" className="space-y-4" onValueChange={(v) => setReportTab(v)}>
          <div className="flex flex-col gap-3">
            <TabsList className="h-8">
              <TabsTrigger value="ranking" className="text-xs px-3 h-7">Ranking de Anúncios</TabsTrigger>
              <TabsTrigger value="marca" className="text-xs px-3 h-7">Análise por Marca</TabsTrigger>
              <TabsTrigger value="abc" className="text-xs px-3 h-7">Curva ABC</TabsTrigger>
            </TabsList>
            {/* CR-06: a barra de período aparece nas TRÊS sub-abas. Ela era
                escondida na Curva ABC porque a ABC rodava numa régua própria
                (vitalícia) que o seletor não afetava. Agora afeta. */}
            {(
              <div className="flex items-center gap-2 flex-wrap">
                {/* Date / period selector */}
                <Popover
                  open={rankingPopoverOpen}
                  onOpenChange={(open) => {
                    setRankingPopoverOpen(open);
                    if (open) {
                      setPendingRange(rankingRange ? { from: rankingRange.from, to: rankingRange.to } : null);
                      setPendingPeriod(rankingRange ? null : rankingPeriod);
                    } else {
                      setPendingRange(null);
                      setPendingPeriod(null);
                    }
                  }}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5 rounded-lg bg-muted/60 px-3 text-xs font-medium text-foreground hover:bg-muted/60 hover:text-foreground cursor-pointer"
                    >
                      <span className="text-muted-foreground">Período:</span>
                      <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground" />
                      {rankingLabel}
                      <ChevronDown className="w-3 h-3 text-muted-foreground ml-0.5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-3" align="start">
                    <div className="flex gap-1 mb-3">
                      {RANKING_QUICK_RANGES.map((opt) => (
                        <Button
                          key={opt.value}
                          variant={pendingPeriod === opt.value && !pendingRange ? "default" : "outline"}
                          size="sm"
                          className="h-7 px-3 text-xs"
                          onClick={() => { setPendingPeriod(opt.value); setPendingRange(null); }}
                        >
                          {opt.label}
                        </Button>
                      ))}
                    </div>
                    <Calendar
                      mode="range"
                      selected={pendingRange ?? undefined}
                      onSelect={(range) => {
                        if (!range?.from) { setPendingRange(null); return; }
                        const from = startOfDay(range.from);
                        const to = range.to ? startOfDay(range.to) : from;
                        setPendingRange({ from, to });
                        setPendingPeriod(null);
                      }}
                      disabled={(date) => date > new Date()}
                      numberOfMonths={isMobile ? 1 : 2}
                      locale={ptBR}
                      className="pointer-events-auto"
                    />
                    {pendingLabel && (
                      <p className="text-xs text-center text-muted-foreground mt-2 mb-1">{pendingLabel}</p>
                    )}
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground"
                        onClick={() => { setPendingRange(null); setPendingPeriod(TOTAL_PERIOD); }}
                      >
                        <X className="w-3.5 h-3.5 mr-1" />
                        Limpar
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        disabled={!canConfirm}
                        onClick={handleRankingConfirm}
                      >
                        <Check className="w-3.5 h-3.5 mr-1" />
                        Confirmar
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
                {reportTab === "ranking" && (
                  <>
                    <div className="w-px h-4 bg-border" />
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Buscar..."
                        value={rankingSearch}
                        onChange={(e) => setRankingSearch(e.target.value)}
                        className="w-48 h-8 text-xs pl-8 bg-secondary/50 border-0 focus-visible:ring-accent"
                      />
                    </div>
                    <Select value={rankingBrandFilter} onValueChange={setRankingBrandFilter}>
                      <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="Filtrar por marca" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas as marcas</SelectItem>
                        {brands.map((b) => (
                          <SelectItem key={b} value={b}>{b}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {rankingBrandFilter !== "all" && (
                      <Button variant="ghost" size="sm" className="h-8 text-xs px-2" onClick={() => setRankingBrandFilter("all")}>✕</Button>
                    )}
                    <div className="w-px h-4 bg-border" />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (!rankingFiltered.length) return;
                        const totalRev = rankingFiltered.reduce((s, r) => s + r.revenue, 0);
                        const rows = rankingFiltered.map((r, i) => ({
                          "#": i + 1,
                          "Item ID": r.id,
                          "Título": r.title,
                          "Marca": r.brand,
                          "Preço (R$)": Number((r.price ?? 0).toFixed(2)),
                          "Qtd. Vendida": r.sold,
                          "Receita (R$)": Number((r.revenue ?? 0).toFixed(2)),
                          "% Participação": totalRev > 0 ? Number(((r.revenue / totalRev) * 100).toFixed(2)) : 0,
                          "Estoque": r.stock ?? 0,
                        }));
                        const ws = XLSX.utils.json_to_sheet(rows);
                        ws["!cols"] = [{ wch: 5 }, { wch: 16 }, { wch: 70 }, { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 10 }];
                        const wb = XLSX.utils.book_new();
                        XLSX.utils.book_append_sheet(wb, ws, "Ranking de Anúncios");
                        const stamp = new Date().toISOString().slice(0, 10);
                        XLSX.writeFile(wb, `ranking-anuncios-${stamp}.xlsx`);
                      }}
                      disabled={!rankingFiltered.length}
                      className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:bg-muted hover:text-muted-foreground"
                      title="Exportar ranking para Excel"
                    >
                      <Download className={`w-3.5 h-3.5`} />
                      Exportar
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── Sub-aba Ranking ── */}
          <TabsContent value="ranking" className="mt-0 space-y-4">
            {periodoSemVenda && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 px-4 py-2.5 text-xs text-muted-foreground">
                <AlertCircle className="w-4 h-4 shrink-0 mt-px text-warning" />
                <span>{avisoPeriodoSemVenda}</span>
              </div>
            )}
            {/* KPIs */}
            <div className="grid grid-cols-3 gap-3">
              <KPICard title="Unidades Vendidas" value={String(rankingKPIs.totalUnits)} icon={<TrendingUp className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-accent/10 text-accent" tooltip={tip("unidades_vendidas")} />
              <KPICard title="Receita Total" value={currencyFmt(rankingKPIs.totalRev)} icon={<DollarSign className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-success/10 text-success" tooltip={tip("receita_total")} />
              <KPICard title="Ticket Médio" value={currencyFmt(rankingKPIs.avgTicket)} icon={<Tag className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-[hsl(25,95%,53%)]/10 text-[hsl(25,95%,53%)]" tooltip={tip("ticket_medio")} />
            </div>

            <Card>
              <CardContent className="p-0">
                {loading && items.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                    <p className="text-sm">Carregando...</p>
                  </div>
                ) : rankingFiltered.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Nenhum dado disponível</p>
                  </div>
                ) : (
                  <div className="max-h-[600px] overflow-auto">
                    <Table className="min-w-[640px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10 text-center text-xs">#</TableHead>
                          <TableHead className="w-12"></TableHead>
                          <TableHead className="text-xs">Anúncio</TableHead>
                          <SortableHead label="Preço"    field="price"   current={rankingSort as SortBy} onSort={toggleRankingSort} className="text-right w-24" />
                          <SortableHead label="Vendidos" field="sold"    current={rankingSort as SortBy} onSort={toggleRankingSort} className="text-right w-20" />
                          <SortableHead label="Receita"  field="revenue" current={rankingSort as SortBy} onSort={toggleRankingSort} className="text-right w-28" />
                          <SortableHead label="Estoque"  field="stock"   current={rankingSort as SortBy} onSort={toggleRankingSort} className="text-center w-20" />
                          <SortableHead label="% Part."  field="share"   current={rankingSort as SortBy} onSort={toggleRankingSort} className="text-right w-20" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rankingFiltered.map((r, idx) => (
                          <TableRow key={r.id} className={idx === 0 ? "bg-[hsl(45,93%,47%)]/5" : idx === 1 ? "bg-[hsl(0,0%,66%)]/5" : idx === 2 ? "bg-[hsl(25,60%,50%)]/5" : ""}>
                            <TableCell className="text-center text-sm font-bold">
                              {idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : idx + 1}
                            </TableCell>
                            <TableCell className="p-2">
                              {r.thumbnail ? (
                                <img src={r.thumbnail.replace("http://", "https://")} alt="" className="w-10 h-10 rounded object-cover" loading="lazy" />
                              ) : (
                                <div className="w-10 h-10 rounded bg-muted flex items-center justify-center"><Package className="w-4 h-4 text-muted-foreground" /></div>
                              )}
                            </TableCell>
                            <TableCell>
                              <a href={mlListingUrl(r.id)} target="_blank" rel="noopener noreferrer" className="text-sm font-medium line-clamp-2 leading-tight hover:underline hover:text-primary transition-colors">
                                {r.title} <ExternalLink className="w-3 h-3 inline mb-0.5 ml-0.5" />
                              </a>
                              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                <p className="text-xs text-muted-foreground">{r.id}</p>
                                {selectedStore === "all" && r._ml_user_id && (() => {
                                  const storeIdx = stores.findIndex((s) => s.ml_user_id === r._ml_user_id);
                                  const store = storeIdx >= 0 ? stores[storeIdx] : null;
                                  const colorCls = STORE_BADGE_COLORS[storeIdx % STORE_BADGE_COLORS.length];
                                  return store ? (
                                    <Badge variant="outline" className={`text-[9px] leading-none ${colorCls} px-[4px] py-px`}>
                                      {store.custom_name || store.nickname || store.ml_user_id}
                                    </Badge>
                                  ) : null;
                                })()}
                              </div>
                            </TableCell>
                            <TableCell className="text-right text-sm">{currencyFmt(r.price)}</TableCell>
                            <TableCell className="text-right text-sm font-semibold">{r.sold}</TableCell>
                            <TableCell className="text-right text-sm font-semibold text-primary">{currencyFmt(r.revenue)}</TableCell>
                            <TableCell className="text-center">
                              <span className={`text-sm font-semibold ${r.stock === 0 ? "text-destructive" : ""}`}>{r.stock}</span>
                            </TableCell>
                            <TableCell className="text-right text-sm text-muted-foreground">{r.share.toFixed(1)}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {rankingFiltered.length > 0 && (
                  <div className="px-4 py-3 border-t text-xs text-muted-foreground">
                    {rankingFiltered.length} anúncios · {rankingLabel}
                    {rankingBrandFilter !== "all" && ` · Marca: ${rankingBrandFilter}`}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Sub-aba Análise por Marca ── */}
          <TabsContent value="marca" className="mt-0 space-y-4">
            {/* KPIs */}
            {brandData.length > 0 && (() => {
              const topRevenue = brandData[0];
              const topTicket = [...brandData].filter((b) => b.qty > 0).sort((a, b) => b.avgTicket - a.avgTicket)[0];
              const topAds = [...brandData].sort((a, b) => b.ads - a.ads)[0];
              const topSold = [...brandData].sort((a, b) => b.qty - a.qty)[0];
              return (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <KPICard title="Maior Receita" value={topRevenue.brand} subtitle={currencyFmt(topRevenue.revenue)} icon={<DollarSign className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-success/10 text-success" tooltip={tip("receita_total")} />
                  <KPICard title="Maior Ticket Médio" value={topTicket?.brand ?? "—"} subtitle={topTicket ? currencyFmt(topTicket.avgTicket) : "—"} icon={<Tag className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-[hsl(25,95%,53%)]/10 text-[hsl(25,95%,53%)]" tooltip={tip("ticket_medio")} />
                  <KPICard title="Mais Vendida (un.)" value={topSold.brand} subtitle={`${topSold.qty} unidades`} icon={<TrendingUp className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-accent/10 text-accent" tooltip={tip("unidades_vendidas")} />
                  <KPICard title="Mais Anúncios" value={topAds.brand} subtitle={`${topAds.ads} anúncios`} icon={<ShoppingBag className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-[hsl(270,70%,50%)]/10 text-[hsl(270,70%,50%)]" tooltip="Marca com maior número de anúncios ativos no catálogo." />
                </div>
              );
            })()}
            {/* Charts */}
            {brandData.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">Receita por Marca (Top 10)</CardTitle>
                  </CardHeader>
                  <CardContent className="pb-4">
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart layout="vertical" data={brandBarData} margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
                        <XAxis type="number" hide />
                        <YAxis dataKey="name" type="category" width={100} fontSize={11} tick={{ fill: "hsl(var(--muted-foreground))" }} />
                        <RechartsTooltip
                          formatter={(value: number) => [currencyFmt(value), "Receita"]}
                          contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                        />
                        <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                          {brandBarData.map((_, idx) => (
                            <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">Distribuição de Vendas por Marca</CardTitle>
                  </CardHeader>
                  <CardContent className="pb-4">
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie
                          data={brandPieData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={55}
                          outerRadius={100}
                          paddingAngle={2}
                          label={!isMobile ? ({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%` : undefined}
                          labelLine={!isMobile}
                          fontSize={10}
                        >
                          {brandPieData.map((_, idx) => (
                            <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <RechartsTooltip
                          formatter={(value: number, name: string) => [value, name]}
                          contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                        />
                        {isMobile && (
                          <Legend
                            iconSize={8}
                            wrapperStyle={{ fontSize: 11 }}
                          />
                        )}
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Table */}
            <Card>
              <CardContent className="p-0">
                {loading && items.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                    <p className="text-sm">Carregando...</p>
                  </div>
                ) : brandData.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Nenhum dado disponível</p>
                  </div>
                ) : (
                  <div className="max-h-[600px] overflow-auto">
                    <Table className="min-w-[500px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Marca</TableHead>
                          <TableHead className="text-center w-20">Anúncios</TableHead>
                          <TableHead className="text-right w-20">Vendidos</TableHead>
                          <TableHead className="w-48">Receita</TableHead>
                          <TableHead className="text-right w-24">TM</TableHead>
                          <TableHead className="text-center w-20">Estoque</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {brandData.map((b) => {
                          const pct = maxBrandRevenue > 0 ? (b.revenue / maxBrandRevenue) * 100 : 0;
                          return (
                            <TableRow key={b.brand}>
                              <TableCell className="text-sm font-medium">{b.brand}</TableCell>
                              <TableCell className="text-center text-sm">{b.ads}</TableCell>
                              <TableCell className="text-right text-sm">{b.qty}</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <div className="flex-1">
                                    <Progress value={pct} className="h-2" />
                                  </div>
                                  <span className="text-xs font-semibold text-primary whitespace-nowrap">{currencyFmt(b.revenue)}</span>
                                </div>
                              </TableCell>
                              <TableCell className="text-right text-sm">{currencyFmt(b.avgTicket)}</TableCell>
                              <TableCell className="text-center text-sm">{b.stock}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {brandData.length > 0 && (
                  <div className="px-4 py-3 border-t text-xs text-muted-foreground">
                    {brandData.length} marcas encontradas · {rankingLabel}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Sub-aba Curva ABC ── */}
          <TabsContent value="abc" className="mt-0 space-y-4">
            {periodoSemVenda && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 px-4 py-2.5 text-xs text-muted-foreground">
                <AlertCircle className="w-4 h-4 shrink-0 mt-px text-warning" />
                <span>{avisoPeriodoSemVenda}</span>
              </div>
            )}
            {/* Summary KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KPICard title="Total de Anúncios" value={String(abcSummary.total)} icon={<ShoppingBag className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-accent/10 text-accent" tooltip="Total de anúncios ativos analisados na Curva ABC." />
              <KPICard title="Curva A" value={String(abcSummary.A.count)} subtitle={`${abcSummary.A.pct.toFixed(1)}% · ${currencyFmt(abcSummary.A.revenue)}`} icon={<TrendingUp className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-success/10 text-success" tooltip="Anúncios de alta performance: respondem por ~80% da receita total (Curva A)." />
              <KPICard title="Curva B" value={String(abcSummary.B.count)} subtitle={`${abcSummary.B.pct.toFixed(1)}% · ${currencyFmt(abcSummary.B.revenue)}`} icon={<Package className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-[hsl(25,95%,53%)]/10 text-[hsl(25,95%,53%)]" tooltip="Anúncios de média performance: contribuem com ~15% da receita (Curva B)." />
              <KPICard title="Curva C" value={String(abcSummary.C.count)} subtitle={`${abcSummary.C.pct.toFixed(1)}% · ${currencyFmt(abcSummary.C.revenue)}`} icon={<Tag className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-[hsl(270,70%,50%)]/10 text-[hsl(270,70%,50%)]" tooltip="Anúncios de baixa performance: respondem pelo restante (~5%) da receita (Curva C)." />
            </div>

            {/* ABC Chart */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Curva ABC — Receita Acumulada</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Receita realizada no período selecionado ({rankingLabel}) — a mesma do Ranking de Anúncios.
                </p>
              </CardHeader>
              <CardContent className="pb-4">
                {abcChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={abcChartData} margin={{ left: 0, right: 16, top: 8, bottom: 0 }}>
                      <defs>
                        <linearGradient id="abcAreaGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="rank" fontSize={11} tick={{ fill: "hsl(var(--muted-foreground))" }} label={{ value: "Anúncios (posição)", position: "insideBottom", offset: -2, fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis fontSize={11} tick={{ fill: "hsl(var(--muted-foreground))" }} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
                      <RechartsTooltip
                        formatter={(value: number, name: string) => [`${value.toFixed(1)}%`, name === "cumPct" ? "Acumulado" : "Participação"]}
                        labelFormatter={(label) => `Posição ${label}`}
                        contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                      />
                      {/* Reference lines for 80% and 95% thresholds */}
                      <Area type="monotone" dataKey="cumPct" fill="url(#abcAreaGrad)" stroke="none" />
                      <Line type="monotone" dataKey="cumPct" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="cumPct" />
                      <Line type="monotone" dataKey="pct" stroke="hsl(var(--accent))" strokeWidth={1.5} dot={false} name="pct" strokeDasharray="4 3" />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">Sem dados</div>
                )}
                <div className="flex items-center gap-6 mt-3 text-xs text-muted-foreground justify-center">
                  <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-primary rounded" /> % Acumulado</div>
                  <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-accent rounded" style={{ borderTop: "2px dashed" }} /> % Individual</div>
                  <div className="flex items-center gap-1.5"><span className="text-emerald-600 font-semibold">A</span> até 80%</div>
                  <div className="flex items-center gap-1.5"><span className="text-amber-600 font-semibold">B</span> 80–95%</div>
                  <div className="flex items-center gap-1.5"><span className="text-red-600 font-semibold">C</span> 95–100%</div>
                </div>
              </CardContent>
            </Card>

            {/* ABC Table */}
            <Card>
              <CardContent className="p-0">
                {abcData.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Nenhum dado disponível</p>
                  </div>
                ) : (
                  <div className="max-h-[600px] overflow-auto">
                    <Table className="min-w-[700px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10 text-center">#</TableHead>
                          <TableHead className="w-16 text-center">Curva</TableHead>
                          <TableHead className="w-12"></TableHead>
                          <TableHead>Anúncio</TableHead>
                          <TableHead className="text-right w-24">Receita</TableHead>
                          <TableHead className="text-right w-16">% Ind.</TableHead>
                          <TableHead className="text-right w-20">% Acum.</TableHead>
                          <TableHead className="text-right w-20">Vendidos</TableHead>
                          <TableHead className="text-center w-20">Estoque</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {abcData.map((r) => (
                          <TableRow key={r.id} className={r.curve === "A" ? "bg-emerald-500/5" : r.curve === "B" ? "bg-amber-500/5" : ""}>
                            <TableCell className="text-center text-sm font-medium text-muted-foreground">{r.rank}</TableCell>
                            <TableCell className="text-center">
                              <Badge variant="outline" className={
                                r.curve === "A" ? "border-emerald-500 text-emerald-600" :
                                r.curve === "B" ? "border-amber-500 text-amber-600" :
                                "border-destructive text-destructive"
                              }>{r.curve}</Badge>
                            </TableCell>
                            <TableCell className="p-2">
                              {r.thumbnail ? (
                                <img src={r.thumbnail.replace("http://", "https://")} alt="" className="w-10 h-10 rounded object-cover" loading="lazy" />
                              ) : (
                                <div className="w-10 h-10 rounded bg-muted flex items-center justify-center"><Package className="w-4 h-4 text-muted-foreground" /></div>
                              )}
                            </TableCell>
                            <TableCell>
                              <a href={mlListingUrl(r.id)} target="_blank" rel="noopener noreferrer" className="text-sm font-medium line-clamp-2 leading-tight hover:underline hover:text-primary transition-colors">
                                {r.title} <ExternalLink className="w-3 h-3 inline mb-0.5 ml-0.5" />
                              </a>
                              <p className="text-xs text-muted-foreground mt-0.5">{r.brand} · {r.id}</p>
                            </TableCell>
                            <TableCell className="text-right text-sm font-semibold text-primary">{currencyFmt(r.revenue)}</TableCell>
                            <TableCell className="text-right text-sm text-muted-foreground">{r.pct.toFixed(1)}%</TableCell>
                            <TableCell className="text-right text-sm font-medium">{r.cumPct.toFixed(1)}%</TableCell>
                            <TableCell className="text-right text-sm">{r.sold}</TableCell>
                            <TableCell className="text-center">
                              <span className={`text-sm font-semibold ${r.stock === 0 ? "text-destructive" : ""}`}>{r.stock}</span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {abcData.length > 0 && (
                  <div className="px-4 py-3 border-t text-xs text-muted-foreground">
                    {abcData.length} anúncios · {rankingLabel} · A: {abcSummary.A.count} · B: {abcSummary.B.count} · C: {abcSummary.C.count}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </TabsContent>

      {/* ═══════════════════ ABA CUSTOS ═══════════════════ */}
      <TabsContent value="custos" className="mt-0 animate-fade-in">
        <ImportacaoCustos />
      </TabsContent>
    </Tabs>

    <PriceDetailSheet
      open={priceSheetOpen}
      onClose={() => setPriceSheetOpen(false)}
      item={priceSheetItem}
      suggestion={suggestion}
      noSuggestion={noSuggestion}
      loading={loadingSuggestion}
    />
    <ListingDetailModal
      item={selectedItem}
      open={detailModalOpen}
      onOpenChange={setDetailModalOpen}
      margin={selectedItem ? marginByItem.get(selectedItem.id) : undefined}
    />
    </>
  );
}
