import { useState, useEffect, useMemo, useCallback } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from "recharts";
import { format, parseISO, eachDayOfInterval } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ClipboardList, DollarSign, TrendingDown, Package,
  Truck, RefreshCw, Plug, Search, ChevronDown, ChevronUp,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const currFmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pctFmt  = (v: number) => `${v.toFixed(1)}%`;

/** Map ML order status → display status */
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


// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: OrderStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <Badge className={`${cfg.bg} ${cfg.color} ${cfg.border} whitespace-nowrap text-xs`}>
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
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [search, setSearch]             = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey]           = useState<SortKey>("date");
  const [sortDir, setSortDir]           = useState<SortDir>("desc");

  const connected = stores.length > 0;

  // Confirma a seleção do picker (igual ao padrão de Vendas)
  const handleConfirmPeriod = useCallback(() => {
    if (pendingRange !== null) { setCustomRange(pendingRange); setPeriod(30); }
    else if (pendingPeriod !== null) { setPeriod(pendingPeriod); setCustomRange(null); }
    setPopoverOpen(false);
    setPendingRange(null);
    setPendingPeriod(null);
  }, [pendingRange, pendingPeriod, setCustomRange, setPeriod, setPopoverOpen, setPendingRange, setPendingPeriod]);

  // resolvedMLUserIds já vem filtrado pelo seletor de loja do header:
  // "Todas" → todos os ml_user_ids do seller, loja específica → só o dela.

  // ── Load orders from DB ─────────────────────────────────────────────────────
  const loadOrders = useCallback(async () => {
    if (!resolvedMLUserIds.length) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("orders")
        .select([
          "ml_order_id", "item_id", "titulo", "listing_type",
          "quantidade", "preco_unit", "comissao", "frete",
          "receita_bruta", "receita_liquida",
          "status", "data_pedido", "comprador",
        ].join(", "))
        .in("ml_user_id", resolvedMLUserIds)
        .gte("data_pedido", dateFrom)
        .lte("data_pedido", dateTo)
        .order("data_pedido", { ascending: false });

      if (error) throw error;
      setRows((data as OrderRow[]) ?? []);
    } catch (err: any) {
      toast({ title: "Erro ao carregar pedidos", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [resolvedMLUserIds, dateFrom, dateTo, toast]);

  useEffect(() => {
    if (connected) loadOrders();
  }, [connected, loadOrders]);

  // ── Sync (call edge function then reload) ───────────────────────────────────
  const handleSync = useCallback(async () => {
    if (!resolvedMLUserIds.length || syncing) return;
    setSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Sessão expirada");

      for (const ml_user_id of resolvedMLUserIds) {
        const store = stores.find(s => s.ml_user_id === ml_user_id);
        const { data, error } = await supabase.functions.invoke("sync-ml-orders", {
          body: {
            ml_user_id,
            date_from: dateFrom,
            date_to:   dateTo,
            seller_id: store?.seller_id ?? null,
          },
        });
        if (error) throw error;
        if (!data?.success) throw new Error(data?.error || "Sync failed");
      }

      const now = new Date().toISOString();
      setLastSyncedAt(now);
      await loadOrders();
      toast({ title: "Sincronizado", description: `Pedidos atualizados: ${dateFrom} → ${dateTo}.` });
    } catch (err: any) {
      toast({ title: "Erro na sincronização", description: err.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }, [resolvedMLUserIds, stores, syncing, dateFrom, dateTo, loadOrders, toast]);

  // ── Derived display data ────────────────────────────────────────────────────
  const orders = useMemo(() =>
    rows.map(r => ({
      id:              r.ml_order_id,
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
        ? (Number(r.receita_liquida ?? 0) / Number(r.receita_bruta)) * 100
        : 0,
      commission_rate: Number(r.receita_bruta) > 0
        ? (Number(r.comissao ?? 0) / Number(r.receita_bruta)) * 100
        : 0,
      free_shipping:   (r.frete ?? 0) > 0,
      comprador:       r.comprador ?? "—",
    })),
  [rows]);

  // ── Summary ─────────────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const active    = orders.filter(o => o.status !== "cancelled" && o.status !== "returned");
    const cancelled = orders.filter(o => o.status === "cancelled" || o.status === "returned");
    const gross     = active.reduce((s, o) => s + o.gross_revenue, 0);
    const net       = active.reduce((s, o) => s + o.net_revenue, 0);
    const commission = active.reduce((s, o) => s + o.ml_commission, 0);
    const shipping   = active.reduce((s, o) => s + o.shipping_cost, 0);
    return {
      total_orders:     active.length,
      cancelled_orders: cancelled.length,
      gross_revenue:    gross,
      net_revenue:      net,
      ml_commission:    commission,
      shipping_cost:    shipping,
      net_margin_pct:   gross > 0 ? (net / gross) * 100 : 0,
      avg_ticket:       active.length > 0 ? gross / active.length : 0,
    };
  }, [orders]);

  // ── Chart (grouped by date within the selected range) ─────────────────────
  const chartData = useMemo(() => {
    const from = parseISO(dateFrom);
    const to   = parseISO(dateTo);
    const days = eachDayOfInterval({ start: from, end: to });
    // Cap at 60 days for readability; show every Nth tick on x-axis
    const slice = days.length > 60 ? days.slice(-60) : days;
    return slice.map(d => {
      const date = format(d, "yyyy-MM-dd");
      const day  = orders.filter(o => o.date === date && o.status !== "cancelled" && o.status !== "returned");
      return {
        date:              format(d, "dd/MM", { locale: ptBR }),
        "Receita Bruta":   Math.round(day.reduce((s, o) => s + o.gross_revenue, 0) * 100) / 100,
        "Receita Líquida": Math.round(day.reduce((s, o) => s + o.net_revenue,   0) * 100) / 100,
      };
    });
  }, [orders, dateFrom, dateTo]);

  // ── Filtered + sorted table ─────────────────────────────────────────────────
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
      if (sortKey === "gross")      diff = a.gross_revenue  - b.gross_revenue;
      if (sortKey === "net")        diff = a.net_revenue    - b.net_revenue;
      if (sortKey === "margin")     diff = a.net_margin_pct - b.net_margin_pct;
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
    <div className="space-y-6">

      {/* Header */}
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
            <Button
              variant="outline"
              size="sm"
              disabled={syncing || loading}
              onClick={handleSync}
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Sincronizando…" : "Atualizar"}
            </Button>
          </div>
        </div>
      </div>

      {/* Empty state — no data synced yet */}
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
              subtitle={`${summary.cancelled_orders} cancelados/devolvidos`}
            />
            <KPICard
              title="Receita bruta"
              value={currFmt(summary.gross_revenue)}
              variant="minimal"
              iconClassName="bg-accent/10 text-accent"
              size="compact"
              icon={<DollarSign className="w-4 h-4" />}
              subtitle={periodLabel}
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
              subtitle="Por pedido ativo"
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

          {/* Chart */}
          <Card>
            <div className="px-4 pt-4 pb-3">
              <span className="text-sm font-medium text-foreground">
                Receita — {periodLabel}
              </span>
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
          </Card>

          {/* Orders table */}
          <Card>
            <div className="px-4 pt-4 pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <span className="text-sm font-medium text-foreground">Pedidos ({filtered.length})</span>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative w-52">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Pedido, produto ou comprador…"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="pl-9 h-8 text-xs"
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
                  {filtered.length} pedidos · Líquido total:{" "}
                  <span className="font-semibold text-foreground">
                    {currFmt(filtered.reduce((s, o) => s + o.net_revenue, 0))}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
