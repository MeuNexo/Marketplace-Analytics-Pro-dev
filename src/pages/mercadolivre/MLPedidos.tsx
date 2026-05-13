import { useState, useEffect, useMemo, useCallback } from "react";
import {
  AreaChart, Area, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from "recharts";
import { format, parseISO, eachDayOfInterval } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ClipboardList, DollarSign, TrendingDown, Package,
  Truck, RefreshCw, Plug, Search, ChevronDown, ChevronUp,
  BarChart2, MapPin, Tag, TrendingUp,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { KPICard } from "@/components/dashboard/KPICard";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import { MLPeriodPicker } from "@/components/mercadolivre/MLPeriodPicker";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useMLFilters } from "@/hooks/useMLFilters";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

// ── Types ─────────────────────────────────────────────────────────────────────

type OrderStatus = "paid" | "shipped" | "delivered" | "cancelled" | "returned" | "pending";
type ListingType = "classic" | "premium" | "free";
type SortKey     = "date" | "gross" | "net" | "margin" | "commission";
type SortDir     = "asc" | "desc";
type StatusFilter = "all" | OrderStatus;

interface OrderRow {
  ml_order_id:     string;
  item_id:         string;
  titulo:          string | null;
  listing_type:    string | null;
  quantidade:      number;
  preco_unit:      number | null;
  comissao:        number | null;
  frete:           number | null;
  receita_bruta:   number | null;
  receita_liquida: number | null;
  status:          string | null;
  data_pedido:     string | null;
  comprador:       string | null;
  estado:          string | null;
}

interface ProcessedOrder {
  id:              string;
  item_id:         string;
  date:            string;
  status:          OrderStatus;
  listing_type:    ListingType;
  titulo:          string;
  quantidade:      number;
  preco_unit:      number;
  gross_revenue:   number;
  ml_commission:   number;
  shipping_cost:   number;
  net_revenue:     number;
  net_margin_pct:  number;
  commission_rate: number;
  free_shipping:   boolean;
  comprador:       string;
  estado:          string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const currFmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pctFmt  = (v: number) => `${v.toFixed(1)}%`;

function normalizeStatus(s: string | null): OrderStatus {
  const map: Record<string, OrderStatus> = {
    confirmed:           "pending",
    payment_required:    "pending",
    payment_in_process:  "pending",
    partially_paid:      "pending",
    paid:                "paid",
    partially_delivered: "shipped",
    delivered:           "delivered",
    cancelled:           "cancelled",
    returned:            "returned",
  };
  return map[s ?? ""] ?? "pending";
}

function normalizeListingType(t: string | null): ListingType {
  if (t === "premium") return "premium";
  if (t === "free")    return "free";
  return "classic";
}

function marginColor(pct: number) {
  if (pct >= 60) return "text-emerald-600";
  if (pct >= 40) return "text-amber-600";
  return "text-red-600";
}

// ── Config ────────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<OrderStatus, { label: string; color: string; bg: string; border: string }> = {
  paid:      { label: "Pago",      color: "text-blue-600",    bg: "bg-blue-500/15",    border: "border-blue-500/30"    },
  shipped:   { label: "Enviado",   color: "text-violet-600",  bg: "bg-violet-500/15",  border: "border-violet-500/30"  },
  delivered: { label: "Entregue",  color: "text-emerald-600", bg: "bg-emerald-500/15", border: "border-emerald-500/30" },
  cancelled: { label: "Cancelado", color: "text-red-600",     bg: "bg-red-500/15",     border: "border-red-500/30"     },
  returned:  { label: "Devolvido", color: "text-orange-600",  bg: "bg-orange-500/15",  border: "border-orange-500/30"  },
  pending:   { label: "Pendente",  color: "text-amber-600",   bg: "bg-amber-500/15",   border: "border-amber-500/30"   },
};

const LISTING_LABELS: Record<ListingType, string> = {
  classic: "Clássico",
  premium: "Premium",
  free:    "Grátis",
};

const LISTING_RATE: Record<ListingType, string> = {
  classic: "~11%",
  premium: "~16%",
  free:    "0%",
};

const CONFIRMED_STATUSES: OrderStatus[] = ["paid", "shipped", "delivered"];

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: OrderStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <Badge className={`${cfg.bg} ${cfg.color} ${cfg.border} whitespace-nowrap text-xs pointer-events-none`}>
      {cfg.label}
    </Badge>
  );
}

function NotConnected() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <Plug className="w-16 h-16 text-muted-foreground/40" />
      <h2 className="text-xl font-semibold">Mercado Livre não conectado</h2>
      <p className="text-muted-foreground text-sm">Conecte sua conta para acessar os pedidos.</p>
      <Button asChild><Link to="/integracoes">Conectar conta</Link></Button>
    </div>
  );
}

function SortIcon({ sortKey, k, sortDir }: { sortKey: SortKey; k: SortKey; sortDir: SortDir }) {
  if (sortKey !== k) return null;
  return sortDir === "desc"
    ? <ChevronDown className="w-3 h-3 inline ml-0.5" />
    : <ChevronUp   className="w-3 h-3 inline ml-0.5" />;
}

// ── Report: Top Produtos por Margem ──────────────────────────────────────────

function SubTabTopProdutos({ orders }: { orders: ProcessedOrder[] }) {
  const [sortBy, setSortBy] = useState<"net" | "gross" | "margin">("net");

  const products = useMemo(() => {
    const map = new Map<string, {
      item_id: string; titulo: string;
      orderIds: Set<string>; quantidade: number;
      gross: number; net: number; commission: number; frete: number;
    }>();

    for (const o of orders) {
      if (o.status === "cancelled" || o.status === "returned") continue;
      const key = o.item_id || o.titulo;
      if (!map.has(key)) {
        map.set(key, { item_id: o.item_id, titulo: o.titulo, orderIds: new Set(), quantidade: 0, gross: 0, net: 0, commission: 0, frete: 0 });
      }
      const p = map.get(key)!;
      p.orderIds.add(o.id);
      p.quantidade  += o.quantidade;
      p.gross       += o.gross_revenue;
      p.net         += o.net_revenue;
      p.commission  += o.ml_commission;
      p.frete       += o.shipping_cost;
    }

    return Array.from(map.values())
      .map(p => ({
        ...p,
        orders:          p.orderIds.size,
        margin_pct:      p.gross > 0 ? (p.net         / p.gross) * 100 : 0,
        commission_rate: p.gross > 0 ? (p.commission  / p.gross) * 100 : 0,
      }))
      .sort((a, b) =>
        sortBy === "gross"  ? b.gross      - a.gross :
        sortBy === "margin" ? b.margin_pct - a.margin_pct :
                              b.net        - a.net
      )
      .slice(0, 20);
  }, [orders, sortBy]);

  const maxNet = Math.max(...products.map(p => p.net), 1);

  if (products.length === 0) return <EmptyReport />;

  return (
    <div className="space-y-4">
      {/* Sort toggle */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Ordenar por:</span>
        {([["net", "Líquido"], ["gross", "Bruto"], ["margin", "Margem"]] as const).map(([v, label]) => (
          <Button
            key={v}
            size="sm"
            variant={sortBy === v ? "default" : "outline"}
            className="h-7 px-3 text-xs"
            onClick={() => setSortBy(v)}
          >{label}</Button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground w-8">#</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-muted-foreground">Produto</th>
                  <th className="text-right px-3 py-2.5 text-xs font-semibold text-muted-foreground">Pedidos</th>
                  <th className="text-right px-3 py-2.5 text-xs font-semibold text-muted-foreground">Itens</th>
                  <th className="text-right px-3 py-2.5 text-xs font-semibold text-muted-foreground">Bruto</th>
                  <th className="text-right px-3 py-2.5 text-xs font-semibold text-muted-foreground">Comissão</th>
                  <th className="text-right px-3 py-2.5 text-xs font-semibold text-muted-foreground">Frete</th>
                  <th className="text-right px-3 py-2.5 text-xs font-semibold text-muted-foreground">Líquido</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Margem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {products.map((p, i) => (
                  <tr key={p.item_id || i} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{i + 1}</td>
                    <td className="px-3 py-3 max-w-[260px]">
                      <p className="text-xs font-medium truncate">{p.titulo}</p>
                      {/* Inline bar relative to max net revenue */}
                      <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden w-full">
                        <div
                          className="h-full rounded-full bg-emerald-500/60"
                          style={{ width: `${Math.max((p.net / maxNet) * 100, 2)}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right text-xs tabular-nums">{p.orders}</td>
                    <td className="px-3 py-3 text-right text-xs tabular-nums text-muted-foreground">{p.quantidade}</td>
                    <td className="px-3 py-3 text-right text-xs tabular-nums font-mono">{currFmt(p.gross)}</td>
                    <td className="px-3 py-3 text-right text-xs tabular-nums text-destructive">
                      −{currFmt(p.commission)}
                      <span className="text-[10px] text-muted-foreground ml-1">({pctFmt(p.commission_rate)})</span>
                    </td>
                    <td className="px-3 py-3 text-right text-xs tabular-nums text-orange-600">
                      {p.frete > 0 ? `−${currFmt(p.frete)}` : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-3 text-right text-xs tabular-nums font-mono font-semibold">{currFmt(p.net)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-sm font-bold ${marginColor(p.margin_pct)}`}>{pctFmt(p.margin_pct)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t text-xs text-muted-foreground">
            {products.length} produtos · Líquido total:{" "}
            <span className="font-semibold text-foreground">{currFmt(products.reduce((s, p) => s + p.net, 0))}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Report: Distribuição por UF ───────────────────────────────────────────────

const UF_COLORS = [
  "hsl(var(--primary))", "hsl(var(--accent))", "hsl(25,95%,53%)", "hsl(270,70%,50%)",
  "hsl(160,60%,45%)", "hsl(340,75%,55%)", "hsl(200,70%,50%)", "hsl(45,93%,47%)",
  "hsl(120,40%,55%)", "hsl(0,65%,50%)",
];

function SubTabUF({ orders }: { orders: ProcessedOrder[] }) {
  const states = useMemo(() => {
    const map = new Map<string, {
      uf: string; orderIds: Set<string>;
      gross: number; net: number; cancelledIds: Set<string>;
    }>();

    for (const o of orders) {
      const uf = o.estado?.trim() || null;
      if (!uf) continue; // ignora pedidos sem estado identificado
      if (!map.has(uf)) {
        map.set(uf, { uf, orderIds: new Set(), gross: 0, net: 0, cancelledIds: new Set() });
      }
      const s = map.get(uf)!;
      s.orderIds.add(o.id);
      if (o.status === "cancelled" || o.status === "returned") {
        s.cancelledIds.add(o.id);
      } else {
        s.gross += o.gross_revenue;
        s.net   += o.net_revenue;
      }
    }

    return Array.from(map.values())
      .map(s => ({
        uf:                s.uf,
        orders:            s.orderIds.size,
        gross:             s.gross,
        net:               s.net,
        cancelled:         s.cancelledIds.size,
        avg_ticket:        (s.orderIds.size - s.cancelledIds.size) > 0 ? s.gross / (s.orderIds.size - s.cancelledIds.size) : 0,
        cancellation_rate: s.orderIds.size > 0 ? (s.cancelledIds.size / s.orderIds.size) * 100 : 0,
        margin_pct:        s.gross > 0 ? (s.net / s.gross) * 100 : 0,
      }))
      .sort((a, b) => b.gross - a.gross);
  }, [orders]);

  const chartData = states.slice(0, 12);
  const totalOrders = states.reduce((s, x) => s + x.orders, 0);

  if (states.length === 0) return <EmptyReport />;

  return (
    <div className="space-y-4">
      {/* KPI mini-row */}
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="pt-4 pb-4">
          <p className="text-xs text-muted-foreground">Estados ativos</p>
          <p className="text-2xl font-bold mt-1">{states.length}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-4">
          <p className="text-xs text-muted-foreground">Maior mercado</p>
          <p className="text-2xl font-bold mt-1">{states[0]?.uf ?? "—"}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{states[0] ? pctFmt((states[0].orders / totalOrders) * 100) + " dos pedidos" : ""}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-4">
          <p className="text-xs text-muted-foreground">Ticket médio geral</p>
          <p className="text-2xl font-bold mt-1">{currFmt(states.reduce((s, x) => s + x.gross, 0) / Math.max(states.reduce((s, x) => s + x.orders - x.cancelled, 0), 1))}</p>
        </CardContent></Card>
      </div>

      {/* Horizontal bar chart */}
      <Card>
        <div className="px-4 pt-4 pb-2">
          <span className="text-sm font-medium">Receita bruta por estado (top 12)</span>
        </div>
        <CardContent className="px-4 pb-4 pt-0">
          <ResponsiveContainer width="100%" height={Math.max(chartData.length * 36, 180)}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16, top: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
              <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="uf" tick={{ fontSize: 11 }} width={32} />
              <RechartsTooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                formatter={(v: number) => [currFmt(v), "Receita Bruta"]}
              />
              <Bar dataKey="gross" radius={[0, 4, 4, 0]}>
                {chartData.map((_, i) => <Cell key={i} fill={UF_COLORS[i % UF_COLORS.length]} fillOpacity={0.85} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Detail table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30">
                <tr>
                  {["UF", "Pedidos", "Receita Bruta", "Receita Líquida", "Ticket Médio", "Margem", "Cancelados"].map(h => (
                    <th key={h} className={`py-2.5 text-xs font-semibold text-muted-foreground ${h === "UF" ? "text-left px-4" : "text-right px-3"} ${h === "Cancelados" ? "pr-4" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {states.map((s, i) => (
                  <tr key={s.uf} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-semibold text-sm">{s.uf}</td>
                    <td className="px-3 py-3 text-right text-xs tabular-nums">{s.orders}</td>
                    <td className="px-3 py-3 text-right text-xs tabular-nums font-mono">{currFmt(s.gross)}</td>
                    <td className="px-3 py-3 text-right text-xs tabular-nums font-mono">{currFmt(s.net)}</td>
                    <td className="px-3 py-3 text-right text-xs tabular-nums">{currFmt(s.avg_ticket)}</td>
                    <td className="px-3 py-3 text-right">
                      <span className={`text-xs font-semibold ${marginColor(s.margin_pct)}`}>{pctFmt(s.margin_pct)}</span>
                    </td>
                    <td className="px-3 pr-4 py-3 text-right text-xs tabular-nums text-muted-foreground">
                      {s.cancelled > 0
                        ? <span className="text-red-500">{s.cancelled} <span className="text-muted-foreground">({pctFmt(s.cancellation_rate)})</span></span>
                        : "—"
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Report: Custo por Tipo de Anúncio ─────────────────────────────────────────

const LISTING_COLORS: Record<ListingType, string> = {
  classic: "#6366f1",
  premium: "#f59e0b",
  free:    "#22c55e",
};

function SubTabTipoAnuncio({ orders }: { orders: ProcessedOrder[] }) {
  const byType = useMemo(() => {
    const base = () => ({ orderIds: new Set<string>(), gross: 0, net: 0, commission: 0, frete: 0 });
    const map: Record<ListingType, ReturnType<typeof base>> = {
      classic: base(), premium: base(), free: base(),
    };

    for (const o of orders) {
      if (o.status === "cancelled" || o.status === "returned") continue;
      const t = map[o.listing_type];
      if (!t) continue;
      t.orderIds.add(o.id);
      t.gross      += o.gross_revenue;
      t.net        += o.net_revenue;
      t.commission += o.ml_commission;
      t.frete      += o.shipping_cost;
    }

    return (["classic", "premium", "free"] as ListingType[]).map(type => {
      const d = map[type];
      return {
        type,
        label:           LISTING_LABELS[type],
        rate_label:      LISTING_RATE[type],
        orders:          d.orderIds.size,
        gross:           d.gross,
        net:             d.net,
        commission:      d.commission,
        frete:           d.frete,
        margin_pct:      d.gross > 0 ? (d.net        / d.gross) * 100 : 0,
        commission_rate: d.gross > 0 ? (d.commission / d.gross) * 100 : 0,
        frete_rate:      d.gross > 0 ? (d.frete      / d.gross) * 100 : 0,
        avg_ticket:      d.orderIds.size > 0 ? d.gross / d.orderIds.size : 0,
      };
    });
  }, [orders]);

  const totalGross = byType.reduce((s, t) => s + t.gross, 0);

  const chartData = byType.map(t => ({
    name:      t.label,
    "Bruto":   Math.round(t.gross * 100) / 100,
    "Líquido": Math.round(t.net   * 100) / 100,
  }));

  if (totalGross === 0) return <EmptyReport />;

  return (
    <div className="space-y-4">
      {/* Comparison cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {byType.map(t => (
          <Card key={t.type} style={{ borderColor: `${LISTING_COLORS[t.type]}40` }}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-semibold">{t.label}</p>
                  <p className="text-[10px] text-muted-foreground">Taxa padrão {t.rate_label}</p>
                </div>
                <span
                  className="text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{ background: `${LISTING_COLORS[t.type]}20`, color: LISTING_COLORS[t.type] }}
                >
                  {t.orders} pedidos
                </span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Receita bruta</span>
                  <span className="font-mono font-semibold">{currFmt(t.gross)}</span>
                </div>
                <div className="flex justify-between text-destructive">
                  <span>Comissão ML</span>
                  <span className="font-mono">−{currFmt(t.commission)} <span className="text-muted-foreground">({pctFmt(t.commission_rate)})</span></span>
                </div>
                <div className="flex justify-between text-orange-600">
                  <span>Frete</span>
                  <span className="font-mono">
                    {t.frete > 0 ? `−${currFmt(t.frete)} (${pctFmt(t.frete_rate)})` : <span className="text-muted-foreground">—</span>}
                  </span>
                </div>
                <div className="flex justify-between pt-2 border-t border-border/60">
                  <span className="font-medium">Receita líquida</span>
                  <span className="font-mono font-semibold">{currFmt(t.net)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Margem líquida</span>
                  <span className={`font-bold ${marginColor(t.margin_pct)}`}>{pctFmt(t.margin_pct)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ticket médio</span>
                  <span className="font-mono">{currFmt(t.avg_ticket)}</span>
                </div>
                {/* Revenue share bar */}
                <div className="pt-1">
                  <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                    <span>% da receita total</span>
                    <span>{totalGross > 0 ? pctFmt((t.gross / totalGross) * 100) : "—"}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${totalGross > 0 ? (t.gross / totalGross) * 100 : 0}%`, background: LISTING_COLORS[t.type] }}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Grouped bar chart */}
      <Card>
        <div className="px-4 pt-4 pb-2">
          <span className="text-sm font-medium">Bruto vs Líquido por tipo de anúncio</span>
        </div>
        <CardContent className="px-4 pb-4 pt-0">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
              <RechartsTooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                formatter={(v: number) => [currFmt(v)]}
              />
              <Bar dataKey="Bruto"   fill="hsl(var(--accent))"  fillOpacity={0.6} radius={[4, 4, 0, 0]} />
              <Bar dataKey="Líquido" fill="hsl(var(--success))" fillOpacity={0.85} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex items-center justify-center gap-6 mt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm inline-block bg-accent/60" />Receita Bruta</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm inline-block bg-success/85" />Receita Líquida</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Empty state for reports ───────────────────────────────────────────────────

function EmptyReport() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
      <TrendingUp className="w-10 h-10 text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground">Nenhum dado para exibir no período selecionado.</p>
    </div>
  );
}

// ── PedidosRelatorios ─────────────────────────────────────────────────────────

function PedidosRelatorios({ orders }: { orders: ProcessedOrder[] }) {
  return (
    <Tabs defaultValue="produtos">
      <TabsList className="mb-4 h-8 w-auto overflow-x-auto no-scrollbar">
        <TabsTrigger value="produtos"  className="text-xs px-3 h-7 gap-1.5"><BarChart2 className="w-3.5 h-3.5" />Top Produtos</TabsTrigger>
        <TabsTrigger value="uf"        className="text-xs px-3 h-7 gap-1.5"><MapPin    className="w-3.5 h-3.5" />Por Estado</TabsTrigger>
        <TabsTrigger value="tipo"      className="text-xs px-3 h-7 gap-1.5"><Tag       className="w-3.5 h-3.5" />Tipo de Anúncio</TabsTrigger>
      </TabsList>
      <TabsContent value="produtos"><SubTabTopProdutos orders={orders} /></TabsContent>
      <TabsContent value="uf">      <SubTabUF          orders={orders} /></TabsContent>
      <TabsContent value="tipo">    <SubTabTipoAnuncio orders={orders} /></TabsContent>
    </Tabs>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MLPedidos() {
  const { stores, resolvedMLUserIds } = useMLStore();
  const { toast } = useToast();

  const {
    period, setPeriod,
    customRange, setCustomRange,
    popoverOpen, setPopoverOpen,
    pendingRange, setPendingRange,
    pendingPeriod, setPendingPeriod,
    pendingLabel, canConfirm,
    periodLabel,
    currentFrom: dateFrom,
    currentTo:   dateTo,
  } = useMLFilters();

  const [rows, setRows]                 = useState<OrderRow[]>([]);
  const [loading, setLoading]           = useState(false);
  const [syncing, setSyncing]           = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number } | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [search, setSearch]             = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey]           = useState<SortKey>("date");
  const [sortDir, setSortDir]           = useState<SortDir>("desc");

  const connected = stores.length > 0;

  // ── Load last sync time from ml_sync_log on mount ───────────────────────────
  useEffect(() => {
    if (!resolvedMLUserIds.length) return;
    supabase
      .from("ml_sync_log")
      .select("synced_at")
      .in("ml_user_id", resolvedMLUserIds)
      .eq("source", "orders")
      .order("synced_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.synced_at) setLastSyncedAt(new Date(data.synced_at));
      });
  }, [resolvedMLUserIds]);

  // ── Load orders from DB ─────────────────────────────────────────────────────
  const loadOrders = useCallback(async () => {
    if (!resolvedMLUserIds.length) return;
    setLoading(true);
    try {
      const PAGE = 1000;
      let allRows: OrderRow[] = [];
      let from = 0;

      while (true) {
        const { data, error, count } = await (supabase as any)
          .from("orders")
          .select(
            [
              "ml_order_id", "item_id", "titulo", "listing_type",
              "quantidade", "preco_unit", "comissao", "frete",
              "receita_bruta", "receita_liquida",
              "status", "data_pedido", "comprador", "estado",
            ].join(", "),
            { count: "exact" },
          )
          .in("ml_user_id", resolvedMLUserIds)
          .gte("data_pedido", dateFrom)
          .lte("data_pedido", dateTo)
          .order("data_pedido", { ascending: false })
          .range(from, from + PAGE - 1);

        if (error) throw error;
        const page = (data as OrderRow[]) ?? [];
        allRows = allRows.concat(page);
        if (page.length < PAGE || allRows.length >= (count ?? 0)) break;
        from += PAGE;
      }

      setRows(allRows);
    } catch (err: any) {
      toast({ title: "Erro ao carregar pedidos", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [resolvedMLUserIds, dateFrom, dateTo, toast]);

  useEffect(() => {
    if (connected) loadOrders();
  }, [connected, loadOrders]);

  // ── Sync — fatiado por dia para evitar timeout da edge function ──────────────
  const handleSync = useCallback(async () => {
    if (!resolvedMLUserIds.length || syncing) return;
    setSyncing(true);
    setSyncProgress(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Sessão expirada");

      // Gera lista de datas individuais no range
      const days = eachDayOfInterval({ start: parseISO(dateFrom), end: parseISO(dateTo) });
      const total = days.length * resolvedMLUserIds.length;
      let current = 0;

      for (const ml_user_id of resolvedMLUserIds) {
        const store = stores.find(s => s.ml_user_id === ml_user_id);
        for (const day of days) {
          const dateStr = format(day, "yyyy-MM-dd");
          current++;
          setSyncProgress({ current, total });

          const { data, error } = await supabase.functions.invoke("sync-ml-orders", {
            body: {
              ml_user_id,
              date_from: dateStr,
              date_to:   dateStr,
              seller_id: store?.seller_id ?? null,
            },
          });
          if (error) throw error;
          if (!data?.success) throw new Error(data?.error || "Sync failed");
        }
      }

      const now = new Date();
      setLastSyncedAt(now);
      await loadOrders();
      toast({ title: "Sincronizado", description: `Pedidos atualizados: ${dateFrom} → ${dateTo}.` });
    } catch (err: any) {
      toast({ title: "Erro na sincronização", description: err.message, variant: "destructive" });
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  }, [resolvedMLUserIds, stores, syncing, dateFrom, dateTo, loadOrders, toast]);

  const handleConfirmPeriod = useCallback(() => {
    if (pendingRange !== null) { setCustomRange(pendingRange); setPeriod(30); }
    else if (pendingPeriod !== null) { setPeriod(pendingPeriod); setCustomRange(null); }
    setPopoverOpen(false);
    setPendingRange(null);
    setPendingPeriod(null);
  }, [pendingRange, pendingPeriod, setCustomRange, setPeriod, setPopoverOpen, setPendingRange, setPendingPeriod]);

  // ── Derived data ─────────────────────────────────────────────────────────────
  const orders = useMemo<ProcessedOrder[]>(() =>
    rows.map(r => ({
      id:              r.ml_order_id,
      item_id:         r.item_id,
      date:            r.data_pedido ?? "",
      status:          normalizeStatus(r.status),
      listing_type:    normalizeListingType(r.listing_type),
      titulo:          r.titulo ?? "—",
      quantidade:      r.quantidade,
      preco_unit:      r.preco_unit ?? 0,
      gross_revenue:   Number(r.receita_bruta  ?? 0),
      ml_commission:   Number(r.comissao        ?? 0),
      shipping_cost:   Number(r.frete           ?? 0),
      net_revenue:     Number(r.receita_liquida ?? 0),
      net_margin_pct:  Number(r.receita_bruta) > 0
        ? (Number(r.receita_liquida ?? 0) / Number(r.receita_bruta)) * 100 : 0,
      commission_rate: Number(r.receita_bruta) > 0
        ? (Number(r.comissao ?? 0) / Number(r.receita_bruta)) * 100 : 0,
      free_shipping:   (r.frete ?? 0) > 0,
      comprador:       r.comprador ?? "—",
      estado:          r.estado ?? null,
    })),
  [rows]);

  // ── Summary ─────────────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const orderStatusMap = new Map<string, OrderStatus>();
    for (const o of orders) {
      if (!orderStatusMap.has(o.id)) orderStatusMap.set(o.id, o.status);
    }
    const uniqueOrderIds    = Array.from(orderStatusMap.keys());
    const confirmedOrderIds = uniqueOrderIds.filter(id =>  CONFIRMED_STATUSES.includes(orderStatusMap.get(id)!));
    const pendingOrderIds   = uniqueOrderIds.filter(id =>  orderStatusMap.get(id) === "pending");
    const cancelledOrderIds = uniqueOrderIds.filter(id => {
      const s = orderStatusMap.get(id)!;
      return s === "cancelled" || s === "returned";
    });

    const confirmed  = orders.filter(o => CONFIRMED_STATUSES.includes(o.status));
    const gross      = confirmed.reduce((s, o) => s + o.gross_revenue, 0);
    const net        = confirmed.reduce((s, o) => s + o.net_revenue,   0);
    const commission = confirmed.reduce((s, o) => s + o.ml_commission, 0);
    const shipping   = confirmed.reduce((s, o) => s + o.shipping_cost, 0);

    return {
      total_orders:     confirmedOrderIds.length + pendingOrderIds.length,
      confirmed_orders: confirmedOrderIds.length,
      pending_orders:   pendingOrderIds.length,
      cancelled_orders: cancelledOrderIds.length,
      gross_revenue:    gross,
      net_revenue:      net,
      ml_commission:    commission,
      shipping_cost:    shipping,
      net_margin_pct:   gross > 0 ? (net / gross) * 100 : 0,
      avg_ticket:       confirmedOrderIds.length > 0 ? gross / confirmedOrderIds.length : 0,
    };
  }, [orders]);

  // ── Chart ────────────────────────────────────────────────────────────────────
  const chartData = useMemo(() => {
    const from  = parseISO(dateFrom);
    const to    = parseISO(dateTo);
    const days  = eachDayOfInterval({ start: from, end: to });
    const slice = days.length > 60 ? days.slice(-60) : days;
    return slice.map(d => {
      const date = format(d, "yyyy-MM-dd");
      const day  = orders.filter(o => o.date === date && CONFIRMED_STATUSES.includes(o.status));
      return {
        date:              format(d, "dd/MM", { locale: ptBR }),
        "Receita Bruta":   Math.round(day.reduce((s, o) => s + o.gross_revenue, 0) * 100) / 100,
        "Receita Líquida": Math.round(day.reduce((s, o) => s + o.net_revenue,   0) * 100) / 100,
      };
    });
  }, [orders, dateFrom, dateTo]);

  // ── Filtered + sorted table ──────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = orders.filter(o => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !o.id.toLowerCase().includes(q) &&
          !o.titulo.toLowerCase().includes(q) &&
          !o.comprador.toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
    return [...result].sort((a, b) => {
      let diff = 0;
      if (sortKey === "date")       diff = a.date.localeCompare(b.date);
      if (sortKey === "gross")      diff = a.gross_revenue   - b.gross_revenue;
      if (sortKey === "net")        diff = a.net_revenue     - b.net_revenue;
      if (sortKey === "margin")     diff = a.net_margin_pct  - b.net_margin_pct;
      if (sortKey === "commission") diff = a.commission_rate - b.commission_rate;
      return sortDir === "desc" ? -diff : diff;
    });
  }, [orders, search, statusFilter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  if (!connected) return <NotConnected />;

  const isEmpty = !loading && orders.length === 0;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <Tabs defaultValue="pedidos" className="space-y-6">

      {/* ── Sticky header ── */}
      <div className="sticky -top-4 md:-top-6 lg:-top-8 z-20 -mx-4 md:-mx-6 lg:-mx-8 -mt-4 md:-mt-6 lg:-mt-8 px-4 md:px-6 lg:px-8 pb-4 pt-4 bg-background/95 backdrop-blur-sm border-b border-border/40">
        <div className="flex items-center justify-between gap-4">
          <MLPageHeader title="Pedidos" lastUpdated={lastSyncedAt} />
          <div className="flex items-center gap-2">
            <MLPeriodPicker
              periodLabel={periodLabel}
              popoverOpen={popoverOpen}
              setPopoverOpen={setPopoverOpen}
              pendingRange={pendingRange}
              setPendingRange={setPendingRange}
              pendingPeriod={pendingPeriod}
              setPendingPeriod={setPendingPeriod}
              pendingLabel={pendingLabel}
              canConfirm={canConfirm}
              customRange={customRange}
              period={period}
              onConfirm={handleConfirmPeriod}
            />
            <TabsList className="h-8">
              <TabsTrigger value="pedidos"    className="text-xs px-3 h-7">Pedidos</TabsTrigger>
              <TabsTrigger value="relatorios" className="text-xs px-3 h-7">Relatórios</TabsTrigger>
            </TabsList>
            <Button
              variant="ghost"
              size="sm"
              disabled={syncing || loading}
              onClick={handleSync}
              className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:bg-muted hover:text-muted-foreground"
              aria-label="Atualizar"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">
                {syncProgress
                  ? `${syncProgress.current}/${syncProgress.total} dias`
                  : syncing ? "Sincronizando..." : "Atualizar"}
              </span>
            </Button>
          </div>
        </div>
      </div>

      {/* ═══════════════════ ABA PEDIDOS ═══════════════════ */}
      <TabsContent value="pedidos" className="space-y-6 mt-0">

        {/* Empty state */}
        {isEmpty && (
          <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 text-center">
            <ClipboardList className="w-14 h-14 text-muted-foreground/30" />
            <p className="text-base font-medium">Nenhum pedido encontrado</p>
            <p className="text-sm text-muted-foreground max-w-xs">
              Clique em <strong>Atualizar</strong> para buscar os pedidos do período selecionado.
            </p>
            <Button onClick={handleSync} disabled={syncing}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Sincronizando…" : "Buscar pedidos"}
            </Button>
          </div>
        )}

        {!isEmpty && (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard
                title="Pedidos ativos"
                value={String(summary.total_orders)}
                variant="minimal"
                iconClassName="bg-primary/10 text-primary"
                size="compact"
                icon={<ClipboardList className="w-4 h-4" />}
                subtitle={
                  summary.pending_orders > 0
                    ? `${summary.confirmed_orders} confirmados · ${summary.pending_orders} pendentes`
                    : `${summary.cancelled_orders} cancelados/devolvidos`
                }
              />
              <KPICard
                title="Receita bruta"
                value={currFmt(summary.gross_revenue)}
                variant="minimal"
                iconClassName="bg-accent/10 text-accent"
                size="compact"
                icon={<DollarSign className="w-4 h-4" />}
                subtitle="Apenas pedidos confirmados"
              />
              <KPICard
                title="Receita líquida"
                value={currFmt(summary.net_revenue)}
                variant="minimal"
                iconClassName="bg-success/10 text-success"
                size="compact"
                icon={<TrendingDown className="w-4 h-4" />}
                subtitle={`Margem média ${pctFmt(summary.net_margin_pct)}`}
              />
              <KPICard
                title="Ticket médio"
                value={currFmt(summary.avg_ticket)}
                variant="minimal"
                iconClassName="bg-[hsl(25,95%,53%)]/10 text-[hsl(25,95%,53%)]"
                size="compact"
                icon={<Package className="w-4 h-4" />}
                subtitle="Por pedido confirmado"
              />
            </div>

            {/* Fee breakdown */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground font-medium">Comissão ML</p>
                  <p className="text-2xl font-bold mt-1 text-destructive">{currFmt(summary.ml_commission)}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {pctFmt(summary.gross_revenue > 0 ? (summary.ml_commission / summary.gross_revenue) * 100 : 0)} da receita bruta
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                    <Truck className="w-3.5 h-3.5" /> Frete grátis (custo)
                  </p>
                  <p className="text-2xl font-bold mt-1 text-orange-600">{currFmt(summary.shipping_cost)}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {pctFmt(summary.gross_revenue > 0 ? (summary.shipping_cost / summary.gross_revenue) * 100 : 0)} da receita bruta
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground font-medium">Margem líquida média</p>
                  <p className={`text-2xl font-bold mt-1 ${marginColor(summary.net_margin_pct)}`}>
                    {pctFmt(summary.net_margin_pct)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Bruto − Comissão − Frete</p>
                </CardContent>
              </Card>
            </div>

            {/* Chart — only shown for multi-day ranges */}
            {dateFrom !== dateTo && <Card>
              <div className="px-4 pt-4 pb-3">
                <span className="text-sm font-medium text-foreground">Receita — {periodLabel}</span>
              </div>
              <CardContent className="px-4 pb-2 pt-0">
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="gradBruta" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="hsl(var(--accent))"  stopOpacity={0.25} />
                        <stop offset="95%" stopColor="hsl(var(--accent))"  stopOpacity={0}    />
                      </linearGradient>
                      <linearGradient id="gradLiquida" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="hsl(var(--success))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--success))" stopOpacity={0}   />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={Math.ceil(chartData.length / 8)} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `R$${(v / 1000).toFixed(1)}k`} />
                    <RechartsTooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                      formatter={(v: number) => currFmt(v)}
                    />
                    <Area dataKey="Receita Bruta"    stroke="hsl(var(--accent))"  fill="url(#gradBruta)"   strokeWidth={1.5} />
                    <Area dataKey="Receita Líquida"  stroke="hsl(var(--success))" fill="url(#gradLiquida)" strokeWidth={2}   />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>}

            {/* Orders table */}
            <Card>
              <div className="px-4 pt-4 pb-3">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <span className="text-sm font-medium text-foreground">
                    Pedidos ({new Set(filtered.map(o => o.id)).size}
                    {filtered.length !== new Set(filtered.map(o => o.id)).size && (
                      <span className="text-xs font-normal text-muted-foreground ml-1">· {filtered.length} itens</span>
                    )})
                  </span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative w-44">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                      <Input
                        placeholder="Buscar..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="pl-8 h-8 text-xs"
                      />
                    </div>
                    <Select value={statusFilter} onValueChange={v => setStatusFilter(v as StatusFilter)}>
                      <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos os status</SelectItem>
                        {(Object.keys(STATUS_CONFIG) as OrderStatus[]).map(s => (
                          <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <CardContent className="p-0">
                <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card border-b border-border z-10">
                      <tr>
                        <th className="text-left px-6 py-3 text-xs text-muted-foreground font-medium">
                          <button onClick={() => toggleSort("date")} className="hover:text-foreground transition-colors">
                            Data <SortIcon sortKey={sortKey} k="date" sortDir={sortDir} />
                          </button>
                        </th>
                        <th className="text-left px-3 py-3 text-xs text-muted-foreground font-medium">Pedido / Produto</th>
                        <th className="text-left px-3 py-3 text-xs text-muted-foreground font-medium">Tipo</th>
                        <th className="text-left px-3 py-3 text-xs text-muted-foreground font-medium">Status</th>
                        <th className="text-right px-3 py-3 text-xs text-muted-foreground font-medium">
                          <button onClick={() => toggleSort("gross")} className="hover:text-foreground transition-colors">
                            Bruto <SortIcon sortKey={sortKey} k="gross" sortDir={sortDir} />
                          </button>
                        </th>
                        <th className="text-right px-3 py-3 text-xs text-muted-foreground font-medium">
                          <button onClick={() => toggleSort("commission")} className="hover:text-foreground transition-colors">
                            Comissão <SortIcon sortKey={sortKey} k="commission" sortDir={sortDir} />
                          </button>
                        </th>
                        <th className="text-right px-3 py-3 text-xs text-muted-foreground font-medium">Frete</th>
                        <th className="text-right px-3 py-3 text-xs text-muted-foreground font-medium">
                          <button onClick={() => toggleSort("net")} className="hover:text-foreground transition-colors">
                            Líquido <SortIcon sortKey={sortKey} k="net" sortDir={sortDir} />
                          </button>
                        </th>
                        <th className="text-right px-6 py-3 text-xs text-muted-foreground font-medium">
                          <button onClick={() => toggleSort("margin")} className="hover:text-foreground transition-colors">
                            Margem <SortIcon sortKey={sortKey} k="margin" sortDir={sortDir} />
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filtered.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="text-center py-12 text-muted-foreground text-sm">
                            Nenhum pedido encontrado
                          </td>
                        </tr>
                      ) : (
                        filtered.map((order, idx) => (
                          <tr key={`${order.id}-${idx}`} className="hover:bg-muted/30 transition-colors">
                            <td className="px-6 py-3 text-muted-foreground text-xs whitespace-nowrap">
                              {order.date ? format(parseISO(order.date), "dd/MM/yy") : "—"}
                            </td>
                            <td className="px-3 py-3 max-w-[220px]">
                              <p className="font-medium text-xs truncate">{order.id}</p>
                              <p className="text-xs text-muted-foreground truncate">{order.titulo}</p>
                              <p className="text-[10px] text-muted-foreground/60">{order.comprador} · {order.quantidade}x</p>
                            </td>
                            <td className="px-3 py-3 text-xs text-muted-foreground">
                              {LISTING_LABELS[order.listing_type]}
                            </td>
                            <td className="px-3 py-3">
                              <StatusBadge status={order.status} />
                            </td>
                            <td className="px-3 py-3 text-right font-mono text-xs">
                              {currFmt(order.gross_revenue)}
                            </td>
                            <td className="px-3 py-3 text-right text-xs">
                              <span className="text-destructive font-mono">−{currFmt(order.ml_commission)}</span>
                              <span className="text-[10px] text-muted-foreground ml-1">({pctFmt(order.commission_rate)})</span>
                            </td>
                            <td className="px-3 py-3 text-right text-xs">
                              {order.free_shipping
                                ? <span className="text-orange-600 font-mono">−{currFmt(order.shipping_cost)}</span>
                                : <span className="text-muted-foreground">—</span>
                              }
                            </td>
                            <td className="px-3 py-3 text-right font-mono text-xs font-semibold">
                              {currFmt(order.net_revenue)}
                            </td>
                            <td className="px-6 py-3 text-right">
                              <span className={`text-sm font-bold ${marginColor(order.net_margin_pct)}`}>
                                {pctFmt(order.net_margin_pct)}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {filtered.length > 0 && (
                  <div className="px-6 py-3 border-t text-xs text-muted-foreground">
                    {new Set(filtered.map(o => o.id)).size} pedidos
                    {filtered.length !== new Set(filtered.map(o => o.id)).size && (
                      <span className="ml-1 opacity-60">({filtered.length} itens)</span>
                    )}
                    {" · "}Líquido total:{" "}
                    <span className="font-semibold text-foreground">
                      {currFmt(filtered.reduce((s, o) => s + o.net_revenue, 0))}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </TabsContent>

      {/* ═══════════════════ ABA RELATÓRIOS ═══════════════════ */}
      <TabsContent value="relatorios" className="mt-0">
        {orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3 text-center">
            <TrendingUp className="w-12 h-12 text-muted-foreground/30" />
            <p className="text-base font-medium">Sem dados para análise</p>
            <p className="text-sm text-muted-foreground max-w-xs">
              Sincronize os pedidos na aba <strong>Pedidos</strong> para ver os relatórios.
            </p>
          </div>
        ) : (
          <PedidosRelatorios orders={orders} />
        )}
      </TabsContent>

    </Tabs>
  );
}
