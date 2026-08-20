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
  BarChart2, MapPin, TrendingUp, Calculator, AlertTriangle,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { KPICard } from "@/components/dashboard/KPICard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import { MLPeriodPicker } from "@/components/mercadolivre/MLPeriodPicker";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useMLFilters } from "@/hooks/useMLFilters";
import { useToast } from "@/hooks/use-toast";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { KPI_GLOSSARY } from "@/lib/kpi-glossary";
import { avaliarConfiabilidadeMargem } from "@/lib/custoFaltante";
// Quick 260820-ikj — a tela LÊ o mesmo predicado que a fórmula usa, nunca
// repete a subtração "débitos − créditos". Foram três cópias divergentes dessa
// fórmula que criaram a Fase 220.
import { ehPosicaoCredora, liquidoSemDifalBruto, type ComponentesFiscais } from "@/lib/tax/perOrder";
import { supabase } from "@/integrations/supabase/client";

// Helper: build tooltip string from glossary key
const tip = (key: keyof typeof KPI_GLOSSARY) => {
  const e = KPI_GLOSSARY[key];
  return e.example ? `${e.definition} ${e.example}` : e.definition;
};

// ── Types ─────────────────────────────────────────────────────────────────────

type OrderStatus = "paid" | "shipped" | "delivered" | "cancelled" | "returned" | "pending";
type ListingType = "classic" | "premium" | "free";
type SortKey     = "date" | "gross" | "net" | "margin" | "commission";
// extended sort columns include cost / taxes / full net
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
  custo_unit:      number | null;
  tax_rate:        number | null;
  tax_amount:      number | null;
  // Fase 222 (222-07): decomposição fiscal + Flex. Nulo = régua anterior a
  // esta fase, nunca zero disfarçado (mesma régua de custo_unit acima).
  logistic_type:        string | null;
  bonus_envio:           number | null;
  custo_entrega:          number | null;
  icms_debito:            number | null;
  pis_cofins_debito:      number | null;
  credito_pc_comissao:    number | null;
  credito_pc_frete:       number | null;
  /** Crédito de ICMS sobre o frete (D-10.2). Entra na tela no Quick 260820-ikj:
   *  sem ele a decomposição exibida fica MENOR que os créditos reais e desmente
   *  a frase "os créditos superaram os débitos" na célula ao lado. */
  credito_icms_frete:     number | null;
  difal_amount:           number | null;
  fcp_amount:             number | null;
  difal_fonte:            string | null;
  tax_versao:             number | null;
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
  /**
   * AV-07 — Fase 213, Plano 08. Este campo chamava-se `free_shipping` e valia
   * `true` quando HÁ custo de frete: nome invertido em relação ao valor. Os
   * usos sempre foram coerentes com o VALOR (mostram o frete descontado quando
   * ele é verdadeiro), então a correção é de nome. Inverter o booleano trocaria
   * um defeito de rótulo por um defeito de dado.
   */
  tem_custo_frete: boolean;
  comprador:       string;
  estado:          string | null;
  cost_total:      number | null;
  tax_total:       number | null;
  tax_rate:        number | null;
  gross_margin_pct: number | null;
  full_net_revenue: number | null;
  full_net_margin_pct: number | null;
  // Fase 222 (222-07): decomposição fiscal + Flex, exibidos no detalhe do pedido.
  logistic_type:        string | null;
  is_flex:               boolean;
  bonus_envio:            number | null;
  custo_entrega:          number | null;
  icms_debito:            number | null;
  pis_cofins_debito:      number | null;
  credito_pc_comissao:    number | null;
  credito_pc_frete:       number | null;
  difal_amount:           number | null;
  fcp_amount:             number | null;
  difal_fonte:            string | null;
  /** true quando o pedido foi gravado pela régua anterior à Fase 222 (tax_versao nulo ou < 2). */
  regua_antiga:           boolean;
  /**
   * Quick 260820-ikj — os créditos superaram os débitos e o imposto foi
   * LANÇADO como zero pela régua que a contadora aprovou. Nesses pedidos a soma
   * das partes deliberadamente NÃO reconstrói o total, e a tela tem de dizer
   * isso: sem o nome, a decomposição do tooltip desmente o total em silêncio.
   */
  posicao_credora:        boolean;
  /** `débitos − créditos` CRU (sem clamp), para dizer de QUANTO os créditos superaram. */
  liquido_bruto:          number | null;
}

/**
 * Os cinco componentes fiscais da linha, no formato que o dono único da conta
 * (`liquidoSemDifalBruto` / `ehPosicaoCredora`) consome.
 *
 * ⚠️ `strictNullChecks: false` neste projeto: cada componente é convertido com
 * a checagem explícita `!= null`, nunca por coalescência sobre um campo que o
 * tipo afirma existir. Ausência permanece `null` — nunca vira zero.
 */
function componentesFiscaisDaLinha(r: OrderRow): ComponentesFiscais {
  return {
    icmsDebito:         r.icms_debito         != null ? Number(r.icms_debito)         : null,
    pisCofinsDebito:    r.pis_cofins_debito   != null ? Number(r.pis_cofins_debito)   : null,
    creditoPcComissao:  r.credito_pc_comissao != null ? Number(r.credito_pc_comissao) : null,
    creditoPcFrete:     r.credito_pc_frete    != null ? Number(r.credito_pc_frete)    : null,
    creditoIcmsFrete:   r.credito_icms_frete  != null ? Number(r.credito_icms_frete)  : null,
  };
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
  if (pct >= 10) return "text-kpi-positive";
  if (pct >= 5)  return "text-amber-600";    // warning — manter amber
  if (pct >= 0)  return "text-orange-500";   // borderline — manter orange
  return "text-kpi-negative";
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

// Fase 222 (222-07) — procedência do DIFAL por pedido (D-07, orderTaxRate.ts).
const DIFAL_FONTE_LABELS: Record<string, string> = {
  cobrado_ml:      "cobrado pelo ML",
  calculado:       "calculado (régua)",
  nao_conciliado:  "calculado — cruzamento pendente",
};

function difalFonteLabel(fonte: string | null): string {
  if (!fonte) return "—";
  return DIFAL_FONTE_LABELS[fonte] ?? fonte;
}

// `LISTING_RATE` foi removido no plano 213-08: seu único consumidor era a
// sub-aba de Tipo de Anúncio. As taxas de referência por tipo continuam
// disponíveis em /precificacao, junto da margem que elas afetam.

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
    <EmptyState
      icon={Plug}
      title="Mercado Livre não conectado"
      description="Conecte sua conta para acessar os pedidos e relatórios de vendas."
      actionLabel="Ir para Integrações"
      actionHref="/integracoes"
    />
  );
}

function SortIcon({ sortKey, k, sortDir }: { sortKey: SortKey; k: SortKey; sortDir: SortDir }) {
  if (sortKey !== k) return null;
  return sortDir === "desc"
    ? <ChevronDown className="w-3 h-3 inline ml-0.5" />
    : <ChevronUp   className="w-3 h-3 inline ml-0.5" />;
}

// ── Atalho: o ranking por margem mudou de endereço ───────────────────────────
//
// Fase 213, Plano 08, Task 3 (RE-01). "Top Produtos por Margem" vivia aqui com
// uma régua própria — margem pré-ads, sobre pedidos, sem rateio de publicidade —
// enquanto `/resultado` mostra o mesmo ranking pós-ads. Dois rankings de margem
// por produto, no mesmo período, com o mesmo nome e números diferentes.
// O ranking não foi apagado: passou a ter um dono só. Aqui fica o endereço.

function AtalhoResultado() {
  return (
    <Card>
      <CardContent className="py-8 flex flex-col items-center text-center gap-3">
        <TrendingUp className="w-10 h-10 text-muted-foreground/40" />
        <p className="text-sm font-medium">O ranking de produtos por margem agora vive em Resultado</p>
        <p className="text-xs text-muted-foreground max-w-md">
          Lá a margem é apurada <strong>depois da publicidade</strong>, com o rateio de ads por
          anúncio — é a fonte única de margem por produto. Esta tela ficou com o que ela faz
          melhor: conferir pedido a pedido.
        </p>
        <Button asChild size="sm" className="h-8 text-xs">
          <Link to="/resultado">Abrir Resultado</Link>
        </Button>
      </CardContent>
    </Card>
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
      gross: number; net: number; cost: number; tax: number; cancelledIds: Set<string>;
    }>();

    for (const o of orders) {
      const uf = o.estado?.trim() || null;
      if (!uf) continue; // ignora pedidos sem estado identificado
      if (!map.has(uf)) {
        map.set(uf, { uf, orderIds: new Set(), gross: 0, net: 0, cost: 0, tax: 0, cancelledIds: new Set() });
      }
      const s = map.get(uf)!;
      s.orderIds.add(o.id);
      if (o.status === "cancelled" || o.status === "returned") {
        s.cancelledIds.add(o.id);
      } else {
        s.gross += o.gross_revenue;
        s.net   += o.net_revenue;
        s.cost  += o.cost_total ?? 0;
        s.tax   += o.tax_total  ?? 0;
      }
    }

    return Array.from(map.values())
      .map(s => ({
        uf:                s.uf,
        orders:            s.orderIds.size,
        gross:             s.gross,
        net:               s.net,
        cost:              s.cost,
        tax:               s.tax,
        cancelled:         s.cancelledIds.size,
        avg_ticket:        (s.orderIds.size - s.cancelledIds.size) > 0 ? s.gross / (s.orderIds.size - s.cancelledIds.size) : 0,
        cancellation_rate: s.orderIds.size > 0 ? (s.cancelledIds.size / s.orderIds.size) * 100 : 0,
        margin_pct:        s.gross > 0 ? ((s.net - s.cost) / s.gross) * 100 : 0,
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

// ── Fase 213, Plano 08, Task 3 (RE-06): a sub-aba de Tipo de Anúncio saiu ────
//
// Ela distribuía receita e comissão entre Clássico, Premium e Grátis. A escolha
// do tipo de anúncio é por anúncio e não muda com a leitura de um agregado de
// pedidos: sem cruzar com margem por anúncio, a distribuição não decide nada.
// Nada foi apagado no banco — `listing_type` segue na tabela de pedidos, na
// coluna Tipo, e a análise por tipo com margem vive em /anuncios.

// ── Empty state for reports ───────────────────────────────────────────────────

function EmptyReport() {
  return (
    <EmptyState
      icon={ClipboardList}
      title="Sem pedidos no período"
      description="Nenhum pedido para exibir. Ajuste o filtro de período ou sincronize os dados."
      size="compact"
    />
  );
}

// ── PedidosRelatorios ─────────────────────────────────────────────────────────

function PedidosRelatorios({ orders }: { orders: ProcessedOrder[] }) {
  return (
    // A sub-aba Por Estado abre por padrão: é a única que decide algo que
    // nenhuma outra tela decide — frete e expansão regional.
    <Tabs defaultValue="uf">
      <TabsList className="mb-4 h-8 w-auto overflow-x-auto no-scrollbar">
        <TabsTrigger value="uf"        className="text-xs px-3 h-7 gap-1.5"><MapPin    className="w-3.5 h-3.5" />Por Estado</TabsTrigger>
        <TabsTrigger value="produtos"  className="text-xs px-3 h-7 gap-1.5"><BarChart2 className="w-3.5 h-3.5" />Por Produto</TabsTrigger>
      </TabsList>
      <TabsContent value="uf">      <SubTabUF orders={orders} /></TabsContent>
      <TabsContent value="produtos"><AtalhoResultado /></TabsContent>
    </Tabs>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MLPedidos() {
  const { stores, resolvedMLUserIds } = useMLStore();
  const { toast } = useToast();
  const { currentOrg } = useOrganization();
  const isMobile = useIsMobile();

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
  const [loadProgress, setLoadProgress] = useState<number>(0);
  const [cappedAt, setCappedAt]         = useState<number | null>(null);
  const [syncing, setSyncing]           = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number } | null>(null);
  const [queuePending, setQueuePending] = useState<number>(0);
  const [recalcing, setRecalcing]       = useState(false);
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
  const loadOrders = useCallback(async (): Promise<number> => {
    if (!resolvedMLUserIds.length) return 0;
    setLoading(true);
    setLoadProgress(0);
    setCappedAt(null);
    try {
      const PAGE     = 1000;
      const MAX_ROWS = 50_000; // ~38 dias a 1 300 pedidos/dia; avisa se exceder
      let allRows: OrderRow[] = [];
      let from = 0;

      // dateTo + 1 dia: data_pedido é timestamptz armazenado como meia-noite UTC.
      // Para cobrir o dia completo em BRT (UTC-3), o lte precisa ir até o começo do dia seguinte.
      const queryDateTo = (() => {
        const d = new Date(dateTo + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + 1);
        return d.toISOString().substring(0, 10);
      })();

      while (true) {
        // Sem count:"exact" — evita um COUNT(*) extra em cada página e reduz
        // latência de forma significativa em períodos longos.
        const { data, error } = await supabase
          .from("orders")
          .select(
            [
              "ml_order_id", "item_id", "titulo", "listing_type",
              "quantidade", "preco_unit", "comissao", "frete",
              "receita_bruta", "receita_liquida",
              "status", "data_pedido", "comprador", "estado",
              "custo_unit", "tax_rate", "tax_amount",
              // Fase 222 (222-07): decomposição fiscal + Flex
              "logistic_type", "bonus_envio", "custo_entrega",
              "icms_debito", "pis_cofins_debito",
              "credito_pc_comissao", "credito_pc_frete", "credito_icms_frete",
              "difal_amount", "fcp_amount", "difal_fonte", "tax_versao",
            ].join(", "),
          )
          .in("ml_user_id", resolvedMLUserIds)
          .gte("data_pedido", dateFrom)
          .lte("data_pedido", queryDateTo)
          .order("data_pedido", { ascending: false })
          .range(from, from + PAGE - 1);

        if (error) throw error;
        const page = (data as unknown as OrderRow[]) ?? [];
        allRows = allRows.concat(page);
        setLoadProgress(allRows.length);

        if (page.length < PAGE) break; // última página
        if (allRows.length >= MAX_ROWS) {
          setCappedAt(MAX_ROWS);
          break;
        }
        from += PAGE;
      }

      setRows(allRows);
      return allRows.length;
    } catch (err: any) {
      toast({ title: "Erro ao carregar pedidos", description: err.message, variant: "destructive" });
      return 0;
    } finally {
      setLoading(false);
      setLoadProgress(0);
    }
  }, [resolvedMLUserIds, dateFrom, dateTo, toast]);

  useEffect(() => {
    if (!connected) return;
    const today = new Date().toISOString().substring(0, 10);

    loadOrders().then(async (count) => {
      // Se o período inclui hoje e não há pedidos, sincroniza automaticamente
      if (count === 0 && dateTo >= today) {
        toast({ title: "Sincronizando dados de hoje…", description: "Buscando pedidos recentes." });
        for (const mlUserId of resolvedMLUserIds) {
          await supabase.functions.invoke("sync-ml-orders", {
            body: { ml_user_id: mlUserId, date_from: today, date_to: today },
          });
        }
        loadOrders();
      }
    });
  }, [connected, loadOrders, dateTo, resolvedMLUserIds, toast]);

  // ── Sync — direto para períodos curtos, job queue para períodos longos ───────
  const handleSync = useCallback(async () => {
    if (!resolvedMLUserIds.length || syncing) return;
    setSyncing(true);
    setSyncProgress(null);

    try {
      // Contar dias no range
      const msPerDay = 86_400_000;
      const days = Math.round((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / msPerDay) + 1;
      const totalJobs = days * resolvedMLUserIds.length;

      if (totalJobs <= 5) {
        // ── Fluxo direto: chama sync-ml-orders imediatamente para cada (store, dia) ──
        let done = 0;
        for (const mlUserId of resolvedMLUserIds) {
          for (let d = 0; d < days; d++) {
            const day = new Date(new Date(dateFrom).getTime() + d * msPerDay)
              .toISOString().slice(0, 10);
            await supabase.functions.invoke("sync-ml-orders", {
              body: { ml_user_id: mlUserId, date_from: day, date_to: day },
            });
            done++;
            setSyncProgress({ current: done, total: totalJobs });
          }
        }
        await loadOrders();
        setLastSyncedAt(new Date());
        toast({ title: "Pedidos atualizados", description: `Sincronização concluída: ${dateFrom} → ${dateTo}.` });
      } else {
        // ── Fluxo assíncrono: bulk dispatch → pg_cron processa em background ────
        const { data, error } = await supabase.functions.invoke("bulk-dispatch-sync-jobs", {
          body: { ml_user_ids: resolvedMLUserIds, date_from: dateFrom, date_to: dateTo, job_type: "orders" },
        });
        if (error) throw error;

        const dispatched: number = data?.dispatched ?? 0;
        const skipped: number    = data?.skipped    ?? 0;

        if (dispatched === 0 && skipped > 0) {
          toast({ title: "Já sincronizado", description: "Todos os syncs para este período já estão em andamento ou concluídos." });
        } else {
          toast({
            title: "Sincronização iniciada",
            description: `${dispatched} sync${dispatched !== 1 ? "s" : ""} criado${dispatched !== 1 ? "s" : ""}. Os pedidos serão atualizados em breve.`,
          });
          setQueuePending(dispatched);
        }
      }
    } catch (err: any) {
      toast({ title: "Erro ao sincronizar pedidos", description: err.message, variant: "destructive" });
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  }, [resolvedMLUserIds, syncing, dateFrom, dateTo, loadOrders, toast]);

  // ── Poll queue until jobs finish, then reload orders ──────────────────────
  useEffect(() => {
    if (queuePending === 0) return;
    const interval = setInterval(async () => {
      const { count } = await supabase
        .from("sync_jobs")
        .select("id", { count: "exact", head: true })
        .in("ml_user_id", resolvedMLUserIds)
        .eq("job_type", "orders")
        .in("status", ["pending", "running"]);
      const remaining = count ?? 0;
      setQueuePending(remaining);
      if (remaining === 0) {
        clearInterval(interval);
        await loadOrders();
        setLastSyncedAt(new Date());
        toast({ title: "Pedidos atualizados", description: `Sincronização concluída: ${dateFrom} → ${dateTo}.` });
      }
    }, 15_000);
    return () => clearInterval(interval);
  }, [queuePending, resolvedMLUserIds, dateFrom, dateTo, loadOrders, toast]);

  const handleConfirmPeriod = useCallback(() => {
    if (pendingRange !== null) { setCustomRange(pendingRange); setPeriod(30); }
    else if (pendingPeriod !== null) { setPeriod(pendingPeriod); setCustomRange(null); }
    setPopoverOpen(false);
    setPendingRange(null);
    setPendingPeriod(null);
  }, [pendingRange, pendingPeriod, setCustomRange, setPeriod, setPopoverOpen, setPendingRange, setPendingPeriod]);

  // ── Recalcular custos/impostos para o período ───────────────────────────────
  const handleRecalc = useCallback(async () => {
    if (!resolvedMLUserIds.length || recalcing || !currentOrg?.id) return;
    setRecalcing(true);
    try {
      const { data, error } = await supabase.functions.invoke("recalc-order-costs", {
        body: {
          ml_user_ids: resolvedMLUserIds,
          date_from: dateFrom,
          date_to: dateTo,
          organization_id: currentOrg.id,
          only_missing: false,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Falha no recálculo");
      await loadOrders();
      toast({
        title: "Custos e impostos recalculados",
        description: `${data.updated ?? 0} pedidos atualizados.`,
      });
    } catch (err: any) {
      toast({ title: "Erro ao recalcular", description: err.message, variant: "destructive" });
    } finally {
      setRecalcing(false);
    }
  }, [resolvedMLUserIds, recalcing, currentOrg, dateFrom, dateTo, loadOrders, toast]);

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
      // AV-07: o valor não muda — `frete > 0` significa que HÁ custo de frete.
      tem_custo_frete: (r.frete ?? 0) > 0,
      comprador:       r.comprador ?? "—",
      estado:          r.estado ?? null,
      cost_total:      r.custo_unit != null ? Number(r.custo_unit) * r.quantidade : null,
      tax_total:       r.tax_amount != null ? Number(r.tax_amount) : null,
      tax_rate:        r.tax_rate   != null ? Number(r.tax_rate)   : null,
      gross_margin_pct: (r.custo_unit != null && Number(r.receita_bruta) > 0)
        ? ((Number(r.receita_bruta) - Number(r.custo_unit) * r.quantidade) / Number(r.receita_bruta)) * 100
        : null,
      full_net_revenue: r.custo_unit != null
        ? Number(r.receita_liquida ?? 0) - Number(r.custo_unit) * r.quantidade
        : null,
      full_net_margin_pct: (Number(r.receita_bruta) > 0 && r.custo_unit != null)
        ? ((Number(r.receita_liquida ?? 0) - Number(r.custo_unit) * r.quantidade)
           / Number(r.receita_bruta)) * 100
        : null,
      // Fase 222 (222-07) — nulo permanece nulo, nunca vira zero silencioso.
      logistic_type:       r.logistic_type ?? null,
      is_flex:             r.logistic_type === "self_service",
      bonus_envio:         r.bonus_envio          != null ? Number(r.bonus_envio)          : null,
      custo_entrega:       r.custo_entrega        != null ? Number(r.custo_entrega)        : null,
      icms_debito:         r.icms_debito          != null ? Number(r.icms_debito)          : null,
      pis_cofins_debito:   r.pis_cofins_debito    != null ? Number(r.pis_cofins_debito)    : null,
      credito_pc_comissao: r.credito_pc_comissao  != null ? Number(r.credito_pc_comissao)  : null,
      credito_pc_frete:    r.credito_pc_frete     != null ? Number(r.credito_pc_frete)     : null,
      credito_icms_frete:  r.credito_icms_frete   != null ? Number(r.credito_icms_frete)   : null,
      difal_amount:        r.difal_amount         != null ? Number(r.difal_amount)         : null,
      fcp_amount:          r.fcp_amount           != null ? Number(r.fcp_amount)           : null,
      difal_fonte:         r.difal_fonte ?? null,
      regua_antiga:        r.tax_versao == null || r.tax_versao < 2,
      // Quick 260820-ikj — o predicado vem da FÓRMULA (via @/lib/tax/perOrder),
      // não de uma segunda cópia da subtração escrita aqui.
      posicao_credora:     ehPosicaoCredora(componentesFiscaisDaLinha(r)),
      liquido_bruto:       liquidoSemDifalBruto(componentesFiscaisDaLinha(r)),
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
    const costs      = confirmed.reduce((s, o) => s + (o.cost_total ?? 0), 0);
    const taxes      = confirmed.reduce((s, o) => s + (o.tax_total  ?? 0), 0);
    const fullNet    = net - costs; // receita_liquida já desconta imposto; custo é o único desconto adicional
    const missingCost = confirmed.filter(o => o.cost_total == null).length;
    const missingTax  = confirmed.filter(o => o.tax_total  == null).length;

    return {
      total_orders:     confirmedOrderIds.length + pendingOrderIds.length,
      confirmed_orders: confirmedOrderIds.length,
      pending_orders:   pendingOrderIds.length,
      cancelled_orders: cancelledOrderIds.length,
      gross_revenue:    gross,
      net_revenue:      net,
      ml_commission:    commission,
      shipping_cost:    shipping,
      costs,
      taxes,
      full_net_revenue: fullNet,
      full_net_margin_pct: gross > 0 ? (fullNet / gross) * 100 : 0,
      net_margin_pct:   gross > 0 ? (net / gross) * 100 : 0,
      avg_ticket:       confirmedOrderIds.length > 0 ? gross / confirmedOrderIds.length : 0,
      missing_cost:     missingCost,
      missing_tax:      missingTax,
      confirmed_total:  confirmed.length,
    };
  }, [orders]);

  // ── AV-09: a margem agregada só é exibida se houver CMV suficiente ──────────
  //
  // O custo ausente é somado como ZERO no total: quanto MENOS custo cadastrado,
  // MAIOR a margem exibida. Na organização Thales, sem nenhum CMV, a margem
  // média é positiva por construção. Acima do limiar de `custoFaltante.ts` o
  // percentual dá lugar a um marcador de ausência com a contagem explicada —
  // nunca a um número positivo.
  const confiabilidadeMargem = useMemo(
    () => avaliarConfiabilidadeMargem(summary.missing_cost, summary.confirmed_total),
    [summary.missing_cost, summary.confirmed_total],
  );

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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <MLPageHeader title="Pedidos" lastUpdated={lastSyncedAt} />
          <div className="flex items-center gap-2 flex-wrap">
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
              disabled={recalcing || syncing || loading}
              onClick={handleRecalc}
              className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:bg-muted hover:text-muted-foreground"
              aria-label="Recalcular custos e impostos"
              title="Recalcular custo e impostos para o período"
            >
              <Calculator className={`w-3.5 h-3.5 ${recalcing ? "animate-pulse" : ""}`} />
              <span className="hidden md:inline">{recalcing ? "Recalculando..." : "Recalcular"}</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={syncing || loading}
              onClick={handleSync}
              className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:bg-muted hover:text-muted-foreground"
              aria-label="Atualizar"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing || loading || queuePending > 0 ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">
                {syncing ? "Sincronizando…"
                  : queuePending > 0 ? `${queuePending} sync${queuePending !== 1 ? "s" : ""} na fila…`
                  : loading && loadProgress > 0 ? `${loadProgress.toLocaleString("pt-BR")} pedidos…`
                  : loading ? "Carregando…"
                  : "Atualizar"}
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
            <Button onClick={handleSync} disabled={syncing || queuePending > 0}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncing || queuePending > 0 ? "animate-spin" : ""}`} />
              {syncing ? "Sincronizando…" : queuePending > 0 ? `${queuePending} syncs na fila…` : "Buscar pedidos"}
            </Button>
          </div>
        )}

        {!isEmpty && (
          <>
            {/* Banner — configuração faltante */}
            {(summary.missing_cost > 0 || summary.missing_tax > 0) && summary.confirmed_total > 0 && (
              <Alert className="border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <AlertDescription className="text-xs leading-relaxed flex items-center justify-between gap-3 flex-wrap">
                  <span>
                    {summary.missing_cost > 0 && (
                      <>{summary.missing_cost} pedido(s) sem <strong>custo</strong> configurado.{" "}
                        <Link to="/anuncios" className="underline hover:no-underline">Configurar custos</Link>.{" "}</>
                    )}
                    {summary.missing_tax > 0 && (
                      <>{summary.missing_tax} pedido(s) sem <strong>imposto</strong> calculado.{" "}
                        <Link to="/fiscal" className="underline hover:no-underline">Configurar fiscal</Link>.</>
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5"
                    disabled={recalcing}
                    onClick={handleRecalc}
                  >
                    <Calculator className={`w-3 h-3 ${recalcing ? "animate-pulse" : ""}`} />
                    {recalcing ? "Recalculando..." : "Recalcular"}
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {/* Banner — período truncado no limite de 50 000 pedidos */}
            {cappedAt && (
              <Alert className="border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <AlertDescription className="text-xs leading-relaxed">
                  Período muito longo — exibindo apenas os <strong>{cappedAt.toLocaleString("pt-BR")} pedidos mais recentes</strong>.
                  Reduza o filtro de período para ver todos os pedidos do intervalo.
                </AlertDescription>
              </Alert>
            )}

            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard
                title="Pedidos ativos"
                value={String(summary.total_orders)}
                variant="minimal"
                iconClassName="bg-primary/10 text-primary"
                size="compact"
                icon={<ClipboardList className="w-4 h-4" />}
                tooltip={tip("pedidos")}
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
                tooltip={tip("receita_bruta")}
                subtitle="Apenas pedidos confirmados"
              />
              {/* AV-08: este número desconta comissão, frete, imposto e CMV —
                  e NÃO desconta publicidade. Sem o rótulo, ele convive com o
                  MCO pós-ads de /resultado no mesmo período, com o mesmo nome
                  e réguas diferentes. */}
              <KPICard
                title="Receita líquida (pré-ads)"
                value={currFmt(summary.full_net_revenue)}
                variant="minimal"
                iconClassName="bg-success/10 text-success"
                size="compact"
                icon={<TrendingDown className="w-4 h-4" />}
                tooltip={tip("receita_liquida")}
                subtitle={
                  confiabilidadeMargem.confiavel
                    ? `Antes da publicidade · ${pctFmt(summary.full_net_margin_pct)}`
                    : "Antes da publicidade · margem suprimida (sem CMV)"
                }
              />
              <KPICard
                title="Ticket médio"
                value={currFmt(summary.avg_ticket)}
                variant="minimal"
                iconClassName="bg-[hsl(25,95%,53%)]/10 text-[hsl(25,95%,53%)]"
                size="compact"
                icon={<Package className="w-4 h-4" />}
                tooltip={tip("ticket_medio")}
                subtitle="Por pedido confirmado"
              />
            </div>

            {/* Fee breakdown */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
                    <Truck className="w-3.5 h-3.5" /> Frete (custo)
                  </p>
                  <p className="text-2xl font-bold mt-1 text-orange-600">{currFmt(summary.shipping_cost)}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {pctFmt(summary.gross_revenue > 0 ? (summary.shipping_cost / summary.gross_revenue) * 100 : 0)} da receita bruta
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground font-medium">Custos + Impostos</p>
                  <p className="text-2xl font-bold mt-1 text-violet-600">
                    {currFmt(summary.costs + summary.taxes)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    CMV {currFmt(summary.costs)} · Imp. {currFmt(summary.taxes)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground font-medium">Margem líquida média (pré-ads)</p>
                  {confiabilidadeMargem.confiavel ? (
                    <>
                      <p className={`text-2xl font-bold mt-1 ${marginColor(summary.full_net_margin_pct)}`}>
                        {pctFmt(summary.full_net_margin_pct)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Bruto − Comissão − Frete − Custo − Imposto, <strong>antes da publicidade</strong>.{" "}
                        <Link to="/resultado" className="underline hover:no-underline">Ver pós-ads</Link>
                      </p>
                    </>
                  ) : (
                    <>
                      {/* AV-09: marcador de ausência, nunca um número positivo. */}
                      <p className="text-2xl font-bold mt-1 text-muted-foreground">—</p>
                      <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                        {confiabilidadeMargem.total === 0
                          ? "Sem pedidos confirmados no período."
                          : <>
                              {confiabilidadeMargem.semCusto} de {confiabilidadeMargem.total} pedidos
                              sem custo ({pctFmt(confiabilidadeMargem.pctSemCusto ?? 0)}) — acima do
                              limiar de {confiabilidadeMargem.limiarPct}%, a margem média seria ficção
                              positiva.{" "}
                              <Link to="/anuncios" className="underline hover:no-underline">Cadastrar custos</Link>
                            </>}
                      </p>
                    </>
                  )}
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
                {isMobile ? (
                  /* ── Mobile: stacked cards (D-06) ── */
                  <div className="space-y-2 p-2">
                    {filtered.length === 0 ? (
                      <p className="text-center py-8 text-muted-foreground text-sm">Nenhum pedido encontrado</p>
                    ) : (
                      filtered.map((order, idx) => (
                        <div key={`${order.id}-${idx}`} className="rounded-lg border border-border bg-card p-3 space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium truncate">{order.id}</p>
                              <p className="text-xs text-muted-foreground line-clamp-2">{order.titulo}</p>
                            </div>
                            <StatusBadge status={order.status} />
                          </div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                            {([
                              ["Data",      order.date ? format(parseISO(order.date), "dd/MM/yy") : "—"],
                              ["Bruto",     currFmt(order.gross_revenue)],
                              ["Comissão",  `−${currFmt(order.ml_commission)}`],
                              ["Frete",     order.tem_custo_frete ? `−${currFmt(order.shipping_cost)}` : "—"],
                              ["Líquido",   currFmt(order.net_revenue)],
                              ["M. Líquida", order.full_net_margin_pct != null ? pctFmt(order.full_net_margin_pct) : `${pctFmt(order.net_margin_pct)}*`],
                            ] as [string, string][]).map(([label, val]) => (
                              <div key={label}>
                                <span className="text-muted-foreground">{label} </span>
                                <span className="font-mono tabular-nums">{val}</span>
                              </div>
                            ))}
                          </div>
                          {/* Fase 222 (222-07) — Flex e decomposição fiscal, só quando a
                              régua nova já gravou a linha (regua_antiga esconde, não zera). */}
                          {order.regua_antiga ? (
                            <p className="text-[10px] text-muted-foreground italic">
                              Pedido na régua fiscal anterior — sem decomposição de DIFAL/Flex.
                            </p>
                          ) : (
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-muted-foreground border-t border-border/50 pt-1.5">
                              {order.is_flex && (
                                <div className="col-span-2">
                                  <span>Flex — bônus </span>
                                  <span className="font-mono tabular-nums text-foreground">
                                    {order.bonus_envio != null ? currFmt(order.bonus_envio) : "não informado"}
                                  </span>
                                  <span> · entrega </span>
                                  <span className="font-mono tabular-nums text-foreground">
                                    {order.custo_entrega != null ? currFmt(order.custo_entrega) : "não informado"}
                                  </span>
                                </div>
                              )}
                              <div>
                                <span>DIFAL </span>
                                <span className="font-mono tabular-nums text-foreground">
                                  {order.difal_amount != null ? currFmt(order.difal_amount) : "—"}
                                </span>
                              </div>
                              <div>{difalFonteLabel(order.difal_fonte)}</div>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                ) : (
                  /* ── Desktop: table (D-07) ── */
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
                          {/* Fase 222 (222-07): tipo logístico + Flex (bônus/custo de entrega) */}
                          <th className="text-left px-3 py-3 text-xs text-muted-foreground font-medium">Logística</th>
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
                          <th className="text-right px-3 py-3 text-xs text-muted-foreground font-medium">Custo</th>
                          <th className="text-right px-3 py-3 text-xs text-muted-foreground font-medium">Imposto</th>
                          {/* Fase 222 (222-07): DIFAL — valor, procedência (D-07) e componentes fiscais no tooltip */}
                          <th className="text-right px-3 py-3 text-xs text-muted-foreground font-medium">DIFAL</th>
                          <th className="text-right px-3 py-3 text-xs text-muted-foreground font-medium">
                            <button onClick={() => toggleSort("net")} className="hover:text-foreground transition-colors">
                              Líquido <SortIcon sortKey={sortKey} k="net" sortDir={sortDir} />
                            </button>
                          </th>
                          <th className="text-right px-3 py-3 text-xs text-muted-foreground font-medium">M. Bruta</th>
                          <th className="text-right px-6 py-3 text-xs text-muted-foreground font-medium">
                            <button onClick={() => toggleSort("margin")} className="hover:text-foreground transition-colors">
                              M. Líquida <SortIcon sortKey={sortKey} k="margin" sortDir={sortDir} />
                            </button>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {filtered.length === 0 ? (
                          <tr>
                            <td colSpan={14} className="text-center py-12 text-muted-foreground text-sm">
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
                              {/* Fase 222 (222-07): tipo logístico + Flex (bônus/custo de entrega
                                  aparecem como "não informado" quando ausentes, nunca como zero). */}
                              <td className="px-3 py-3 text-xs">
                                {order.regua_antiga ? (
                                  <span className="text-muted-foreground/60" title="Pedido gravado pela régua fiscal anterior a esta fase">
                                    régua anterior
                                  </span>
                                ) : order.is_flex ? (
                                  <div>
                                    <span className="text-sky-600 font-medium">Flex</span>
                                    <p className="text-[10px] text-muted-foreground">
                                      bônus{" "}
                                      {order.bonus_envio != null ? currFmt(order.bonus_envio) : "não informado"}
                                      {" · entrega "}
                                      {order.custo_entrega != null ? currFmt(order.custo_entrega) : "não informado"}
                                    </p>
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">
                                    {order.logistic_type ?? "—"}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-3 text-right font-mono text-xs">
                                {currFmt(order.gross_revenue)}
                              </td>
                              <td className="px-3 py-3 text-right text-xs">
                                <span className="text-destructive font-mono">−{currFmt(order.ml_commission)}</span>
                                <span className="text-[10px] text-muted-foreground ml-1">({pctFmt(order.commission_rate)})</span>
                              </td>
                              <td className="px-3 py-3 text-right text-xs">
                                {order.tem_custo_frete
                                  ? <span className="text-orange-600 font-mono">−{currFmt(order.shipping_cost)}</span>
                                  : <span className="text-muted-foreground">—</span>
                                }
                              </td>
                              <td className="px-3 py-3 text-right text-xs">
                                {order.cost_total != null
                                  ? <span className="text-kpi-negative font-mono">−{currFmt(order.cost_total)}</span>
                                  : <span className="text-muted-foreground/60" title="Custo não configurado">—</span>}
                              </td>
                              {/* Quick 260820-ikj: quando os créditos superam os débitos, o
                                  imposto é LANÇADO como zero pela régua aprovada pela contadora,
                                  e os componentes ficam CRUS — a soma das partes deliberadamente
                                  não reconstrói o total nesta linha. A célula DIZ isso; sem o
                                  aviso, o tooltip do DIFAL ao lado desmentiria o total. */}
                              <td
                                className="px-3 py-3 text-right text-xs"
                                title={
                                  order.posicao_credora && order.liquido_bruto != null
                                    ? `Posição credora: os créditos superaram os débitos em ${currFmt(Math.abs(order.liquido_bruto))}. ` +
                                      `O imposto é lançado como zero pela régua aprovada pela contadora — por isso a ` +
                                      `soma das partes não reconstrói o total nesta linha.`
                                    : undefined
                                }
                              >
                                {order.tax_total != null
                                  ? (
                                    <>
                                      <span className="text-violet-600 font-mono">−{currFmt(order.tax_total)}</span>
                                      {order.tax_rate != null && (
                                        <span className="text-[10px] text-muted-foreground ml-1">({pctFmt(order.tax_rate)})</span>
                                      )}
                                    </>
                                  )
                                  : <span className="text-muted-foreground/60" title="Fiscal não configurado">—</span>}
                              </td>
                              {/* Fase 222 (222-07): DIFAL — valor + procedência (D-07). Tooltip
                                  carrega ICMS/PIS-COFINS débito e os dois créditos de PIS/COFINS. */}
                              <td
                                className="px-3 py-3 text-right text-xs"
                                title={
                                  order.regua_antiga
                                    ? undefined
                                    : `ICMS débito ${order.icms_debito != null ? currFmt(order.icms_debito) : "—"} · ` +
                                      `PIS/COFINS débito ${order.pis_cofins_debito != null ? currFmt(order.pis_cofins_debito) : "—"} · ` +
                                      `crédito comissão ${order.credito_pc_comissao != null ? currFmt(order.credito_pc_comissao) : "—"} · ` +
                                      `crédito frete ${order.credito_pc_frete != null ? currFmt(order.credito_pc_frete) : "—"} · ` +
                                      // Quick 260820-ikj: sem esta parcela a decomposição exibida fica
                                      // MENOR que os créditos reais, e a frase "os créditos superaram
                                      // os débitos" da célula ao lado pareceria falsa na própria tela.
                                      `crédito ICMS frete ${order.credito_icms_frete != null ? currFmt(order.credito_icms_frete) : "—"} · ` +
                                      `FCP ${order.fcp_amount != null ? currFmt(order.fcp_amount) : "—"}`
                                }
                              >
                                {order.regua_antiga ? (
                                  <span className="text-muted-foreground/60">régua anterior</span>
                                ) : order.difal_amount != null ? (
                                  <>
                                    <span className="text-fuchsia-600 font-mono">−{currFmt(order.difal_amount)}</span>
                                    <p className="text-[10px] text-muted-foreground">{difalFonteLabel(order.difal_fonte)}</p>
                                  </>
                                ) : (
                                  <span className="text-muted-foreground/60">—</span>
                                )}
                              </td>
                              <td className="px-3 py-3 text-right font-mono text-xs font-semibold">
                                {currFmt(order.net_revenue)}
                              </td>
                              <td className="px-3 py-3 text-right text-xs">
                                {order.gross_margin_pct != null
                                  ? <span className={`font-semibold ${marginColor(order.gross_margin_pct)}`}>{pctFmt(order.gross_margin_pct)}</span>
                                  : <span className="text-muted-foreground/60">—</span>}
                              </td>
                              <td className="px-6 py-3 text-right">
                                {order.full_net_margin_pct != null ? (
                                  <span className={`text-sm font-bold ${marginColor(order.full_net_margin_pct)}`}>
                                    {pctFmt(order.full_net_margin_pct)}
                                  </span>
                                ) : (
                                  <span className={`text-sm font-bold ${marginColor(order.net_margin_pct)} opacity-60`} title="Sem custo/imposto — usando margem parcial">
                                    {pctFmt(order.net_margin_pct)}*
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
                {filtered.length > 0 && (
                  <div className="px-6 py-3 border-t text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                    <span>
                      {new Set(filtered.map(o => o.id)).size} pedidos
                      {filtered.length !== new Set(filtered.map(o => o.id)).size && (
                        <span className="ml-1 opacity-60">({filtered.length} itens)</span>
                      )}
                    </span>
                    <span>
                      Líquido (ML):{" "}
                      <span className="font-semibold text-foreground">
                        {currFmt(filtered.reduce((s, o) => s + o.net_revenue, 0))}
                      </span>
                    </span>
                    <span>
                      Líquido real:{" "}
                      <span className="font-semibold text-foreground">
                        {currFmt(filtered.reduce((s, o) => s + (o.full_net_revenue ?? o.net_revenue), 0))}
                      </span>
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
