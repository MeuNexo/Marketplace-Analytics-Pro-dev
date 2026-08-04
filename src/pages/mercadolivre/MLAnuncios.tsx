import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { EmptyState } from "@/components/ui/empty-state";
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
// AV-03: a ausência de CMV é contada e declarada em agregado, em vez de virar
// um traço solto célula a célula. Ver o cabeçalho de custoFaltante.ts.
import { contarSemCusto } from "@/lib/custoFaltante";
import { AvisoCustoFaltante } from "@/components/mercadolivre/AvisoCustoFaltante";
// CR-09: a régua da publicidade desta tela é a fatura do ML rateada — a tela é
// obrigada a dizer isso e a mostrar o que da fatura ficou sem dono.
import { AdsOrigemNota } from "@/components/mercadolivre/AdsOrigemNota";
import { useMLPrecosCustos, type MLItemSuggestion } from "@/hooks/useMLPrecosCustos";
import { KPICard } from "@/components/dashboard/KPICard";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
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
  ShoppingBag, RefreshCw, Search, ExternalLink, Plug, Tag, TrendingUp, Package,
  ChevronDown, ChevronRight, Receipt, Truck, ArrowUpDown, ArrowUp, ArrowDown,
  BookOpen, CalendarIcon, X, Check, Lightbulb, BarChart2, CheckCircle2, TrendingDown, AlertCircle,
  Pencil, Eye,
} from "lucide-react";
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
  Cell, ReferenceLine, CartesianGrid,
} from "recharts";

// Sentinela do período "Total". Fase 213/CR-07: "Total" NÃO significa mais
// "sem filtro de data, cai para o `sold_quantity` vitalício da API do ML".
// Significa "desde a primeira venda registrada na base" — uma janela real,
// resolvida em `primeiraVendaDate` e aplicada como qualquer outro período.
const TOTAL_PERIOD = -1;

// Fase 213/plano 07: o seletor de período desta tela deixou de servir a uma aba
// de relatórios (que saiu daqui para `/resultado`) e passou a servir APENAS às
// duas colunas de vendas reais do catálogo — Mg. Op. e Mg. Pós-Ads. É por isso
// que ele agora vive dentro da aba Catálogo, ao lado das colunas que governa.
const VENDAS_QUICK_RANGES = [
  { label: "Total",   value: TOTAL_PERIOD },
  { label: "Hoje",    value: 0  },
  { label: "7 dias",  value: 7  },
  { label: "15 dias", value: 15 },
  { label: "30 dias", value: 30 },
];

// A janela padrão das colunas de vendas reais. Escolha explícita, não herança:
// o catálogo precisa responder "esse anúncio deu lucro no último mês?" na
// primeira renderização, sem que o operador tenha de descobrir um seletor. O
// que está proibido (CR-07) é a janela IMPLÍCITA — um recuo silencioso que a
// tela não declara. Esta é declarada no rótulo do seletor e no cabeçalho das
// duas colunas.
const VENDAS_PERIODO_PADRAO = 30;

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

  // ── Seletor de período das colunas de vendas reais ───────────────────────────
  // Serve exclusivamente a Mg. Op. e Mg. Pós-Ads. Ver VENDAS_QUICK_RANGES.
  const { user } = useAuth();
  const [vendasPeriod, setVendasPeriod] = useState<number>(VENDAS_PERIODO_PADRAO);
  const [vendasRange, setVendasRange] = useState<{ from: Date; to: Date } | null>(null);
  const [vendasPopoverOpen, setVendasPopoverOpen] = useState(false);
  const [pendingPeriod, setPendingPeriod] = useState<number | null>(VENDAS_PERIODO_PADRAO);
  const [pendingRange, setPendingRange] = useState<DateRange | null>(null);

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
   * A janela das colunas de vendas reais — uma só, usada pelo hook de margem e
   * pelo rótulo da tela. `from`/`to` nulos significam janela ainda não resolvida
   * ou base sem venda nenhuma: nesse caso a tela mostra traços e diz que não
   * houve venda, em vez de cair para o número vitalício.
   */
  const vendasWindow = useMemo((): { from: string | null; to: string | null; resolvida: boolean } => {
    const today = format(new Date(), "yyyy-MM-dd");
    if (vendasRange) {
      return {
        from: format(vendasRange.from, "yyyy-MM-dd"),
        to:   format(vendasRange.to,   "yyyy-MM-dd"),
        resolvida: true,
      };
    }
    if (vendasPeriod === TOTAL_PERIOD) {
      if (primeiraVendaDate === undefined) return { from: null, to: null, resolvida: false };
      if (primeiraVendaDate === null)      return { from: null, to: null, resolvida: true };
      return { from: primeiraVendaDate, to: today, resolvida: true };
    }
    if (vendasPeriod === 0) {
      return { from: today, to: today, resolvida: true };
    }
    return {
      from: format(subDays(new Date(), vendasPeriod), "yyyy-MM-dd"),
      to:   today,
      resolvida: true,
    };
  }, [vendasRange, vendasPeriod, primeiraVendaDate]);

  // ── Margem com Ads — a janela declarada acima ────────────────────────────
  // Fase 213/CR-07: aqui existia um recuo silencioso de 365 dias quando o
  // período era "Total". A coluna de margem cobria um ano enquanto o resto da
  // tela dizia "Todo o período". Com a janela resolvida de verdade, as duas
  // passam a ser a mesma. Janela não resolvida → hoje/hoje (nenhuma linha).
  const { vendasFrom, vendasTo } = useMemo(() => {
    const today = format(new Date(), "yyyy-MM-dd");
    return {
      vendasFrom: vendasWindow.from ?? today,
      vendasTo:   vendasWindow.to   ?? today,
    };
  }, [vendasWindow]);

  const { data: marginWithAds } = useMLMarginWithAds(vendasFrom, vendasTo);

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
   * É `vendasFrom`/`vendasTo` — a MESMA janela do seletor ao lado da tabela.
   * Uma coluna de margem ao lado de um seletor de período sem dizer que janela
   * cobre é um convite ao engano, então o rótulo vai para o cabeçalho e para o
   * tooltip.
   */
  const janelaMargemLabel = useMemo(() => {
    const fmt = (d: string) => {
      const [y, m, dd] = d.split("-");
      return `${dd}/${m}/${y}`;
    };
    return `${fmt(vendasFrom)} a ${fmt(vendasTo)}`;
  }, [vendasFrom, vendasTo]);

  const vendasLabel = vendasRange
    ? `${format(vendasRange.from, "dd/MM")} – ${format(vendasRange.to, "dd/MM")}`
    : vendasPeriod === TOTAL_PERIOD
      // CR-07: "Todo o período" agora tem começo declarado — a primeira venda
      // registrada na base. Sem venda nenhuma, a tela diz isso.
      ? primeiraVendaDate
        ? `Todo o período (desde ${format(new Date(`${primeiraVendaDate}T12:00:00`), "dd/MM/yy")})`
        : primeiraVendaDate === null ? "Todo o período (sem venda registrada)" : "Todo o período"
    : vendasPeriod === 0            ? "Hoje"
    : `Últimos ${vendasPeriod} dias`;

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

  const handleVendasConfirm = () => {
    if (pendingRange?.from) {
      setVendasRange({ from: pendingRange.from, to: pendingRange.to ?? pendingRange.from });
      setVendasPeriod(0);
    } else if (pendingPeriod !== null) {
      setVendasPeriod(pendingPeriod);
      setVendasRange(null);
    }
    setVendasPopoverOpen(false);
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

  // CR-07: sinal explícito de que a janela das colunas de vendas reais foi
  // resolvida e não trouxe venda nenhuma. Deriva da JANELA e do resultado do
  // hook de margem — nunca de um gatilho de tamanho de coleção usado para cair
  // no número vitalício; esse fallback não existe mais.
  //
  // Fase 213/plano 07: a fonte passou a ser `marginWithAds`. A busca paginada
  // que alimentava este sinal existia só para as tabelas da aba Relatórios, que
  // migrou para `/resultado`. `undefined` = ainda carregando: nesse estado a
  // tela não afirma nada.
  const periodoSemVenda =
    vendasWindow.resolvida && marginWithAds != null && marginWithAds.rows.length === 0;
  const avisoPeriodoSemVenda = vendasWindow.from === null && vendasWindow.resolvida
    ? "Nenhuma venda registrada na base para esta loja — não há período a exibir."
    : `Nenhuma venda no período selecionado (${vendasLabel}). As colunas Mg. Op. e Mg. Pós-Ads aparecem vazias porque não houve venda, não porque falta dado.`;

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
            {/* RE-01: a aba Relatórios saiu daqui. As três visões que viviam
                nela (ranking por anúncio, agregação por marca e classificação
                de curva) foram absorvidas por `/resultado`. `/anuncios` é
                catálogo operacional e cadastro de custo — nada mais. */}
            <TabsList className="h-8">
              <TabsTrigger value="catalogo"  className="text-xs px-3 h-7">Anúncios</TabsTrigger>
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
        {/* ── KPI do topo (RE-02, RE-04) ──
            Sobrou um. Saíram três, sem substituto e de propósito:
            · Ticket Médio era a média do preço de TABELA dos anúncios filtrados,
              apresentada com o nome de uma métrica de venda — não havia venda
              nenhuma nessa conta.
            · Unidades Vendidas somava `sold_quantity`, o acumulado VITALÍCIO da
              API do ML, sem janela temporal: um número que só cresce e não
              destrava decisão.
            · Receita Potencial era preço de hoje × estoque, respondendo "quanto
              eu faturaria se vendesse todo o estoque a preço cheio" — pergunta
              que ninguém faz, e o mesmo número já aparecia em outros lugares.
            O contador de anúncios fica porque responde ao filtro que o usuário
            acabou de aplicar. Receita e unidades REAIS, por período, vivem em
            `/resultado`. */}
        <div className="grid grid-cols-1 sm:max-w-[280px] gap-3">
          {loading && items.length === 0 ? (
            <Card><CardContent className="p-6"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ) : (
            <KPICard title="Total de Anúncios" value={String(filtered.length)} icon={<ShoppingBag className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-accent/10 text-accent" tooltip="Quantidade de anúncios que correspondem ao filtro atual." />
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

        {/* CR-07: janela resolvida e sem venda nenhuma tem de PARECER vazia. */}
        {columnView === "financeiro" && periodoSemVenda && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 px-4 py-2.5 text-xs text-muted-foreground">
            <AlertCircle className="w-4 h-4 shrink-0 mt-px text-warning" />
            <span>{avisoPeriodoSemVenda}</span>
          </div>
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

                {/* ── Período das colunas de vendas reais ──
                    Herdeiro direto do seletor que vivia na aba Relatórios. Ele
                    sempre governou Mg. Op. e Mg. Pós-Ads; o que mudou é que
                    agora está ao lado das colunas que governa, em vez de numa
                    aba diferente. Só aparece na visão Financeiro, que é a única
                    onde essas colunas existem. */}
                {columnView === "financeiro" && (
                  <Popover
                    open={vendasPopoverOpen}
                    onOpenChange={(open) => {
                      setVendasPopoverOpen(open);
                      if (open) {
                        setPendingRange(vendasRange ? { from: vendasRange.from, to: vendasRange.to } : null);
                        setPendingPeriod(vendasRange ? null : vendasPeriod);
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
                        <span className="text-muted-foreground">Vendas:</span>
                        <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground" />
                        {vendasLabel}
                        <ChevronDown className="w-3 h-3 text-muted-foreground ml-0.5" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-3" align="start">
                      <p className="text-[11px] text-muted-foreground mb-2 max-w-[260px]">
                        Define a janela das colunas <strong>Mg. Op.</strong> e{" "}
                        <strong>Mg. Pós-Ads</strong> — as duas que vêm de vendas reais.
                        As demais colunas usam o preço de tabela de hoje.
                      </p>
                      <div className="flex gap-1 mb-3">
                        {VENDAS_QUICK_RANGES.map((opt) => (
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
                          onClick={() => { setPendingRange(null); setPendingPeriod(VENDAS_PERIODO_PADRAO); }}
                        >
                          <X className="w-3.5 h-3.5 mr-1" />
                          Limpar
                        </Button>
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          disabled={!canConfirm}
                          onClick={handleVendasConfirm}
                        >
                          <Check className="w-3.5 h-3.5 mr-1" />
                          Confirmar
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
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
