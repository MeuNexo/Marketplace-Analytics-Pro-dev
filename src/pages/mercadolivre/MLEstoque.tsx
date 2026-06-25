import { useEffect, useMemo, useState } from "react";
import { useMLInventory } from "@/contexts/MLInventoryContext";
import { useMLCoverage, COVERAGE_PERIODS, COVERAGE_CLASS_LABELS, defaultThresholds } from "@/hooks/useMLCoverage";
import type { CoveragePeriod, CoverageClass, CoverageData, CoverageThresholds } from "@/hooks/useMLCoverage";
import type { ProductItem } from "@/contexts/MLInventoryContext";
import { CoverageAlerts } from "@/components/mercadolivre/CoverageAlerts";
import { CoverageSettingsPopover } from "@/components/mercadolivre/CoverageSettingsPopover";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import { KPICard } from "@/components/dashboard/KPICard";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Package, PackageX, AlertTriangle, Boxes, RefreshCw, Search, ExternalLink, Plug,
  ChevronDown, ChevronRight, Clock, DollarSign, TrendingUp, Activity, Truck, BarChart3,
  ShieldAlert, Eye, Tag, ArrowUp, ArrowDown, ArrowUpDown, CheckCircle2, ShoppingCart,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, ComposedChart, Area, ReferenceLine,
} from "recharts";
import { Link, useSearchParams } from "react-router-dom";
import { EmptyState } from "@/components/ui/empty-state";
import { ReplenishmentPanel } from "@/components/mercadolivre/ReplenishmentPanel";

// ─── Helpers ────────────────────────────────────────────────────────────────

export const LOGISTIC_LABELS: Record<string, string> = {
  fulfillment:    "Full",
  default:        "Padrão",
  drop_off:       "Drop-off",
  xd_drop_off:    "XD Drop-off",
  not_specified:  "Não especif.",
};

// Tailwind bg/text pairs — one colour per logistics type
const LOGISTIC_BADGE: Record<string, { bg: string; text: string }> = {
  fulfillment:   { bg: "bg-blue-500/15",   text: "text-blue-600 dark:text-blue-400" },
  default:       { bg: "bg-violet-500/15", text: "text-violet-600 dark:text-violet-400" },
  drop_off:      { bg: "bg-amber-500/15",  text: "text-amber-600 dark:text-amber-400" },
  xd_drop_off:   { bg: "bg-muted",         text: "text-muted-foreground" },
  not_specified: { bg: "bg-muted",         text: "text-muted-foreground" },
};

function LogisticBadge({ type }: { type: string | null }) {
  const key   = type ?? "not_specified";
  const label = LOGISTIC_LABELS[key] ?? key;
  const style = LOGISTIC_BADGE[key] ?? LOGISTIC_BADGE.not_specified;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${style.bg} ${style.text}`}>
      {label}
    </span>
  );
}

const currencyFmt = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const currencyFmtShort = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);

const numFmt = (v: number) =>
  new Intl.NumberFormat("pt-BR").format(v);

const COVERAGE_COLORS: Record<CoverageClass, string> = {
  ruptura: "#ef4444",
  critico: "#f97316",
  alerta: "#f59e0b",
  ok: "#22c55e",
  sem_giro: "#94a3b8",
};

import type { LucideIcon } from "lucide-react";

const COVERAGE_CLASS_ICONS: Record<CoverageClass, LucideIcon> = {
  ruptura: PackageX,
  critico: AlertTriangle,
  alerta: Clock,
  ok: CheckCircle2,
  sem_giro: Activity,
};

function CoverageBadge({ cls }: { cls: CoverageClass }) {
  const color = COVERAGE_COLORS[cls];
  const label = COVERAGE_CLASS_LABELS[cls] ?? cls;
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-white"
      style={{ backgroundColor: color }}
    >
      {label}
    </span>
  );
}

function HealthBar({ health }: { health: number | null }) {
  if (health === null) return <span className="text-xs text-muted-foreground">—</span>;
  const pct = Math.round(health * 100);
  const color = health < 0.5 ? "bg-red-500" : health < 0.8 ? "bg-amber-500" : "bg-green-500";
  return (
    <div className="flex items-center gap-1.5 min-w-[80px]">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
    </div>
  );
}

// ─── EstoqueRelatorios ───────────────────────────────────────────────────────

interface RelatoriosProps {
  items: ProductItem[];
  coverageMap: Map<string, CoverageData>;
  coveragePeriod: CoveragePeriod;
}

function SubTabCobertura({ items, coverageMap, coveragePeriod }: Pick<RelatoriosProps, "items" | "coverageMap" | "coveragePeriod">) {

  // ── KPI summary ──────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const withData = items.map(i => ({ item: i, cd: coverageMap.get(i.id) })).filter(({ cd }) => cd);
    const ruptura  = withData.filter(({ cd }) => cd!.coverage_class === "ruptura").length;
    const critico  = withData.filter(({ cd }) => cd!.coverage_class === "critico").length;
    const alerta   = withData.filter(({ cd }) => cd!.coverage_class === "alerta").length;
    const ok       = withData.filter(({ cd }) => cd!.coverage_class === "ok").length;
    const semGiro  = withData.filter(({ cd }) => cd!.coverage_class === "sem_giro").length;
    const withDays = withData.filter(({ cd }) => cd!.coverage_days !== null && cd!.coverage_days > 0);
    const avgDays  = withDays.length > 0
      ? Math.round(withDays.reduce((s, { cd }) => s + cd!.coverage_days!, 0) / withDays.length)
      : null;
    const okPct = withData.length > 0 ? Math.round((ok / withData.length) * 100) : 0;
    return { total: withData.length, ruptura, critico, alerta, ok, semGiro, avgDays, okPct };
  }, [items, coverageMap]);

  // ── Donut distribution ───────────────────────────────────────────────────
  const pieData = useMemo(() => {
    const counts: Record<CoverageClass, number> = { ruptura: 0, critico: 0, alerta: 0, ok: 0, sem_giro: 0 };
    items.forEach(item => { const cd = coverageMap.get(item.id); if (cd) counts[cd.coverage_class]++; });
    return (Object.keys(counts) as CoverageClass[])
      .map(cls => ({ name: COVERAGE_CLASS_LABELS[cls], value: counts[cls], color: COVERAGE_COLORS[cls] }))
      .filter(d => d.value > 0);
  }, [items, coverageMap]);

  // ── Day-range buckets ────────────────────────────────────────────────────
  const bucketData = useMemo(() => {
    const t = coveragePeriod;
    const raw = [
      { name: "Ruptura",          color: "#ef4444", test: (cd: CoverageData) => cd.coverage_class === "ruptura" },
      { name: `1–${Math.ceil(t*0.25)-1}d`,  color: "#f97316", test: (cd: CoverageData) => { const d = cd.coverage_days ?? -1; return d >= 1 && d < Math.ceil(t*0.25); } },
      { name: `${Math.ceil(t*0.25)}–${t-1}d`, color: "#f59e0b", test: (cd: CoverageData) => { const d = cd.coverage_days ?? -1; return d >= Math.ceil(t*0.25) && d < t; } },
      { name: `${t}–${t*2}d`,    color: "#84cc16", test: (cd: CoverageData) => { const d = cd.coverage_days ?? -1; return d >= t && d <= t*2; } },
      { name: `>${t*2}d`,        color: "#22c55e", test: (cd: CoverageData) => (cd.coverage_days ?? -1) > t*2 },
      { name: "Sem giro",        color: "#94a3b8", test: (cd: CoverageData) => cd.coverage_class === "sem_giro" },
    ];
    return raw.map(b => ({
      ...b,
      count: items.filter(item => { const cd = coverageMap.get(item.id); return cd ? b.test(cd) : false; }).length,
    })).filter(b => b.count > 0);
  }, [items, coverageMap, coveragePeriod]);

  // ── Coverage by brand (stacked class counts) ─────────────────────────────
  const brandCoverage = useMemo(() => {
    const map = new Map<string, Record<CoverageClass, number>>();
    items.forEach(item => {
      const brand = item.brand || "Sem marca";
      const cd = coverageMap.get(item.id);
      if (!cd) return;
      if (!map.has(brand)) map.set(brand, { ruptura: 0, critico: 0, alerta: 0, ok: 0, sem_giro: 0 });
      map.get(brand)![cd.coverage_class]++;
    });
    return Array.from(map.entries())
      .map(([brand, c]) => ({
        brand: brand.length > 14 ? brand.slice(0, 14) + "…" : brand,
        ok: c.ok, alerta: c.alerta, critico: c.critico, ruptura: c.ruptura, sem_giro: c.sem_giro,
        total: c.ok + c.alerta + c.critico + c.ruptura + c.sem_giro,
      }))
      .filter(d => d.total > 0)
      .sort((a, b) => (b.ruptura + b.critico) - (a.ruptura + a.critico))
      .slice(0, 10);
  }, [items, coverageMap]);

  // ── Urgency table ─────────────────────────────────────────────────────────
  const urgencyItems = useMemo(() => {
    const order: CoverageClass[] = ["ruptura", "critico", "alerta"];
    return items
      .map(item => ({ item, cd: coverageMap.get(item.id) }))
      .filter(({ cd }) => cd && order.includes(cd.coverage_class))
      .sort((a, b) => {
        const oa = order.indexOf(a.cd!.coverage_class);
        const ob = order.indexOf(b.cd!.coverage_class);
        if (oa !== ob) return oa - ob;
        return (a.cd!.coverage_days ?? 0) - (b.cd!.coverage_days ?? 0);
      });
  }, [items, coverageMap]);

  return (
    <div className="space-y-4">

      {/* ── KPI row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPICard title="SKUs analisados" value={String(kpis.total)} variant="minimal" size="compact" icon={<Boxes className="w-4 h-4" />} iconClassName="bg-primary/10 text-primary" />
        <KPICard title="Cobertos (OK)" value={`${kpis.okPct}%`} variant="minimal" size="compact" icon={<CheckCircle2 className="w-4 h-4" />} iconClassName="bg-success/10 text-success" />
        <KPICard title="Média cobertura" value={kpis.avgDays != null ? `${kpis.avgDays}d` : "—"} variant="minimal" size="compact" icon={<Clock className="w-4 h-4" />} iconClassName="bg-accent/10 text-accent" />
        <KPICard title="Ruptura" value={String(kpis.ruptura)} variant="minimal" size="compact" icon={<PackageX className="w-4 h-4" />} iconClassName="bg-destructive/10 text-destructive" />
        <KPICard title="CRÍTICO + ALERTA" value={String(kpis.critico + kpis.alerta)} variant="minimal" size="compact" icon={<AlertTriangle className="w-4 h-4" />} iconClassName="bg-warning/10 text-warning" />
        <KPICard title="Sem giro" value={String(kpis.semGiro)} variant="minimal" size="compact" icon={<Package className="w-4 h-4" />} iconClassName="bg-muted text-muted-foreground" />
      </div>

      {/* ── Distribution + Buckets ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Distribuição por Classe</CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground text-xs">
                <Package className="w-8 h-8 mb-2 opacity-40" />Sem dados
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={210}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={80} paddingAngle={3}>
                    {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number, name: string) => [`${v} SKUs`, name]} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">SKUs por Faixa de Dias</CardTitle>
            <CardDescription className="text-xs">Horizonte: {coveragePeriod} dias</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={bucketData} margin={{ left: 4, right: 8, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number) => [`${v} SKUs`, "Quantidade"]} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} name="SKUs">
                  {bucketData.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* ── Coverage by brand ── */}
      {brandCoverage.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Saúde do Estoque por Marca</CardTitle>
            <CardDescription className="text-xs">
              Distribuição de SKUs por classe de cobertura — ordenado pelos mais críticos
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={brandCoverage} margin={{ left: 4, right: 8, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="brand" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  formatter={(v: number, name: string) => [`${v} SKUs`, name]}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="ruptura"  stackId="s" fill={COVERAGE_COLORS.ruptura}  name="Ruptura" />
                <Bar dataKey="critico"  stackId="s" fill={COVERAGE_COLORS.critico}  name="Crítico" />
                <Bar dataKey="alerta"   stackId="s" fill={COVERAGE_COLORS.alerta}   name="Alerta" />
                <Bar dataKey="ok"       stackId="s" fill={COVERAGE_COLORS.ok}       name="OK" />
                <Bar dataKey="sem_giro" stackId="s" fill={COVERAGE_COLORS.sem_giro} name="Sem giro" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── Urgency table ── */}
      {urgencyItems.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Reposição Urgente</CardTitle>
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {urgencyItems.length} produto{urgencyItems.length !== 1 ? "s" : ""}
              </span>
            </div>
            <CardDescription className="text-xs">
              Ruptura, Crítico e Alerta — ordenados por urgência crescente
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-80 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs w-10 pl-3" />
                    <TableHead className="text-xs">Produto</TableHead>
                    <TableHead className="text-xs text-right">Estoque</TableHead>
                    <TableHead className="text-xs text-right">Unid/dia</TableHead>
                    <TableHead className="text-xs text-right">Dias restantes</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs w-8 pr-3" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {urgencyItems.map(({ item, cd }) => (
                    <TableRow key={item.id} className="group">
                      <TableCell className="p-1 pl-3">
                        {item.thumbnail ? (
                          <img src={item.thumbnail.replace("http://", "https://")} alt="" loading="lazy" decoding="async" className="w-8 h-8 rounded object-cover" />
                        ) : (
                          <div className="w-8 h-8 rounded bg-muted flex items-center justify-center">
                            <Package className="w-3.5 h-3.5 text-muted-foreground" />
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs max-w-[220px]">
                        <p className="font-medium truncate">{item.title}</p>
                        <p className="text-muted-foreground text-[10px] font-mono">{item.id}</p>
                      </TableCell>
                      <TableCell className="text-xs text-right tabular-nums font-semibold">
                        {item.available_quantity}
                      </TableCell>
                      <TableCell className="text-xs text-right tabular-nums text-muted-foreground">
                        {cd!.avg_daily_sales > 0 ? cd!.avg_daily_sales.toFixed(1) : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-right tabular-nums font-bold"
                        style={{ color: COVERAGE_COLORS[cd!.coverage_class] }}>
                        {cd!.coverage_class === "ruptura" ? "Zerado" : `${cd!.coverage_days}d`}
                      </TableCell>
                      <TableCell><CoverageBadge cls={cd!.coverage_class} /></TableCell>
                      <TableCell className="p-1 pr-3">
                        <a href={`https://produto.mercadolivre.com.br/${item.id.replace(/^(MLB)(\d+)$/, "$1-$2")}`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>Todos os produtos com giro cobrem o horizonte de <strong>{coveragePeriod} dias</strong>.</span>
        </div>
      )}
    </div>
  );
}

function SubTabValorRisco({ items, coverageMap }: Pick<RelatoriosProps, "items" | "coverageMap">) {
  const { byClass, top10, capitalCards } = useMemo(() => {
    const classMap: Record<CoverageClass, number> = { ruptura: 0, critico: 0, alerta: 0, ok: 0, sem_giro: 0 };
    const withValor = items.map((item) => {
      const valor = item.price * item.available_quantity;
      const cd = coverageMap.get(item.id);
      const cls: CoverageClass = cd?.coverage_class ?? "sem_giro";
      classMap[cls] += valor;
      return { item, valor, cls };
    });
    const byClass = (Object.keys(classMap) as CoverageClass[]).map((cls) => ({
      name: COVERAGE_CLASS_LABELS[cls] ?? cls,
      valor: classMap[cls],
      color: COVERAGE_COLORS[cls],
    }));
    const top10 = [...withValor].sort((a, b) => b.valor - a.valor).slice(0, 10);
    const capitalCards = {
      risco: classMap.ruptura + classMap.critico,
      parado: classMap.sem_giro,
      saudavel: classMap.ok,
    };
    return { byClass, top10, capitalCards };
  }, [items, coverageMap]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KPICard title="Capital em Ruptura/Crítico" value={currencyFmt(capitalCards.risco)} variant="minimal" size="compact" icon={<AlertTriangle className="w-4 h-4" />} iconClassName="bg-destructive/10 text-destructive" />
        <KPICard title="Capital Parado (Sem Giro)" value={currencyFmt(capitalCards.parado)} variant="minimal" size="compact" icon={<Package className="w-4 h-4" />} iconClassName="bg-muted text-muted-foreground" />
        <KPICard title="Capital Saudável" value={currencyFmt(capitalCards.saudavel)} variant="minimal" size="compact" icon={<CheckCircle2 className="w-4 h-4" />} iconClassName="bg-success/10 text-success" />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Capital por Classe de Cobertura</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byClass} margin={{ left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number) => [currencyFmt(v), "Valor"]} />
              <Bar dataKey="valor" radius={[4, 4, 0, 0]}>
                {byClass.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Top 10 por Valor em Estoque</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Produto</TableHead>
                <TableHead className="text-xs text-right">Valor</TableHead>
                <TableHead className="text-xs">Cobertura</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {top10.map(({ item, valor, cls }) => (
                <TableRow key={item.id}>
                  <TableCell className="text-xs max-w-[240px] truncate">{item.title}</TableCell>
                  <TableCell className="text-xs text-right font-medium">{currencyFmt(valor)}</TableCell>
                  <TableCell><CoverageBadge cls={cls} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function SubTabCurvaABC({ items }: Pick<RelatoriosProps, "items">) {
  const { paretoData, summary, topA, counts } = useMemo(() => {
    const sorted = [...items]
      .map((item) => ({ item, revenue: item.sold_quantity * item.price }))
      .sort((a, b) => b.revenue - a.revenue);
    const totalRevenue = sorted.reduce((s, d) => s + d.revenue, 0);
    let cumulative = 0;
    const classified = sorted.map(({ item, revenue }) => {
      cumulative += revenue;
      const cumPct = totalRevenue > 0 ? (cumulative / totalRevenue) * 100 : 0;
      const abc: "A" | "B" | "C" = cumPct <= 80 ? "A" : cumPct <= 95 ? "B" : "C";
      return { item, revenue, cumPct, abc };
    });
    const paretoData = classified.slice(0, 20).map((d, i) => ({
      name: `#${i + 1}`,
      receita: d.revenue,
      cumulativo: parseFloat(d.cumPct.toFixed(1)),
      abc: d.abc,
    }));
    const topA = classified.filter((d) => d.abc === "A").slice(0, 5);
    const counts = {
      A: classified.filter((d) => d.abc === "A").length,
      B: classified.filter((d) => d.abc === "B").length,
      C: classified.filter((d) => d.abc === "C").length,
    };
    const aPct = items.length > 0 ? Math.round((counts.A / items.length) * 100) : 0;
    const summary = `${aPct}% dos SKUs (Classe A) respondem por ~80% da receita`;
    return { paretoData, summary, topA, counts };
  }, [items]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm text-muted-foreground bg-muted/40">
        <TrendingUp className="w-4 h-4 shrink-0" />
        <span>{summary}</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <KPICard title="Classe A" value={String(counts.A)} variant="minimal" size="compact" icon={<TrendingUp className="w-4 h-4" />} iconClassName="bg-success/10 text-success" />
        <KPICard title="Classe B" value={String(counts.B)} variant="minimal" size="compact" icon={<Activity className="w-4 h-4" />} iconClassName="bg-warning/10 text-warning" />
        <KPICard title="Classe C" value={String(counts.C)} variant="minimal" size="compact" icon={<BarChart3 className="w-4 h-4" />} iconClassName="bg-destructive/10 text-destructive" />
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Curva de Pareto (Top 20 SKUs)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={paretoData} margin={{ left: 8, right: 24 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar yAxisId="left" dataKey="receita" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Receita" />
              <Line yAxisId="right" type="monotone" dataKey="cumulativo" stroke="#f97316" dot={false} strokeWidth={2} name="Acumulado %" />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      {topA.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Top Itens Classe A</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Produto</TableHead>
                  <TableHead className="text-xs text-right">Receita</TableHead>
                  <TableHead className="text-xs text-right">Acumulado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topA.map(({ item, revenue, cumPct }) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-xs max-w-[240px] truncate">{item.title}</TableCell>
                    <TableCell className="text-xs text-right font-medium">{currencyFmt(revenue)}</TableCell>
                    <TableCell className="text-xs text-right">{cumPct.toFixed(1)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SubTabLogistica({ items }: Pick<RelatoriosProps, "items">) {
  const { logisticData, shippingData, listingData, fulfillmentComparison } = useMemo(() => {
    const logisticCounts: Record<string, number> = {};
    let freeCount = 0;
    const listingCounts: Record<string, number> = {};
    let fulfillmentSold = 0, fulfillmentCount = 0, otherSold = 0, otherCount = 0;

    items.forEach((item) => {
      const lt = item.logistic_type ?? "not_specified";
      logisticCounts[lt] = (logisticCounts[lt] ?? 0) + 1;
      if (item.free_shipping) freeCount++;
      const lt2 = item.listing_type_id ?? "unknown";
      listingCounts[lt2] = (listingCounts[lt2] ?? 0) + 1;
      if (lt === "fulfillment") { fulfillmentSold += item.sold_quantity; fulfillmentCount++; }
      else { otherSold += item.sold_quantity; otherCount++; }
    });

    const LOGISTIC_LABELS_FULL: Record<string, string> = {
      fulfillment: "Full (Fulfillment)",
      default: "Padrão",
      drop_off: "Drop-off",
      xd_drop_off: "XD Drop-off",
      not_specified: "Não especificado",
    };
    const logisticColors = ["#6366f1", "#22c55e", "#f59e0b", "#f97316", "#94a3b8"];
    const logisticData = Object.entries(logisticCounts).map(([k, v], i) => ({
      name: LOGISTIC_LABELS_FULL[k] ?? k,
      value: v,
      color: logisticColors[i % logisticColors.length],
    }));
    const shippingData = [
      { name: "Com Frete Grátis", value: freeCount, color: "#22c55e" },
      { name: "Sem Frete Grátis", value: items.length - freeCount, color: "#94a3b8" },
    ].filter((d) => d.value > 0);
    const listingData = Object.entries(listingCounts).map(([k, v]) => ({ name: k, count: v })).sort((a, b) => b.count - a.count);
    const fulfillmentComparison = [
      { name: "Full (Fulfillment)", avg: fulfillmentCount > 0 ? fulfillmentSold / fulfillmentCount : 0 },
      { name: "Outros", avg: otherCount > 0 ? otherSold / otherCount : 0 },
    ];
    return { logisticData, shippingData, listingData, fulfillmentComparison };
  }, [items]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Tipo de Logística</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={logisticData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3}>
                  {logisticData.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Frete Grátis</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={shippingData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3}>
                  {shippingData.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Tipo de Anúncio</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={listingData} margin={{ left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Qtd" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Média de Vendas: Full vs Outros</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={fulfillmentComparison} margin={{ left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number) => [v.toFixed(1), "Média Vendidos"]} />
                <Bar dataKey="avg" fill="#6366f1" radius={[4, 4, 0, 0]} name="Média Vendidos" />
              </BarChart>
            </ResponsiveContainer>
            <p className="text-xs text-muted-foreground mt-2">
              Produtos com logística Full (Fulfillment) tendem a ter maior visibilidade no ML.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SubTabEstoqueMarca({ items }: Pick<RelatoriosProps, "items">) {
  const brandData = useMemo(() => {
    const map = new Map<string, { skus: number; units: number; value: number; sold: number }>();
    for (const item of items) {
      const brand = item.brand || "Sem marca";
      const prev = map.get(brand) ?? { skus: 0, units: 0, value: 0, sold: 0 };
      map.set(brand, {
        skus: prev.skus + 1,
        units: prev.units + item.available_quantity,
        value: prev.value + item.price * item.available_quantity,
        sold: prev.sold + item.sold_quantity,
      });
    }
    return Array.from(map.entries())
      .map(([brand, d]) => ({ brand, ...d }))
      .sort((a, b) => b.units - a.units);
  }, [items]);

  const topUnits = brandData.slice(0, 10);
  const topValue = [...brandData].sort((a, b) => b.value - a.value).slice(0, 10);

  const totalUnits = brandData.reduce((s, b) => s + b.units, 0);
  const totalValue = brandData.reduce((s, b) => s + b.value, 0);

  const CHART_COLORS = [
    "hsl(var(--primary))", "#6366f1", "#22c55e", "#f59e0b", "#f97316",
    "#a855f7", "#14b8a6", "#ef4444", "#84cc16", "#0ea5e9",
  ];

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPICard title="Marcas" value={String(brandData.length)} variant="minimal" size="compact" icon={<Tag className="w-4 h-4" />} iconClassName="bg-primary/10 text-primary" />
        <KPICard title="Total de SKUs" value={numFmt(items.length)} variant="minimal" size="compact" icon={<Boxes className="w-4 h-4" />} iconClassName="bg-accent/10 text-accent" />
        <KPICard title="Unidades em Estoque" value={numFmt(totalUnits)} variant="minimal" size="compact" icon={<Package className="w-4 h-4" />} iconClassName="bg-success/10 text-success" />
        <KPICard title="Valor em Estoque" value={currencyFmtShort(totalValue)} variant="minimal" size="compact" icon={<DollarSign className="w-4 h-4" />} iconClassName="bg-warning/10 text-warning" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Top 10 por Unidades em Estoque</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={topUnits} layout="vertical" margin={{ left: 4, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => numFmt(v)} />
                <YAxis type="category" dataKey="brand" width={100} tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number) => [numFmt(v), "Unidades"]} />
                <Bar dataKey="units" radius={[0, 4, 4, 0]}>
                  {topUnits.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Top 10 por Valor em Estoque</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={topValue} layout="vertical" margin={{ left: 4, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="brand" width={100} tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number) => [currencyFmt(v), "Valor"]} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {topValue.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Full table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Estoque por Marca</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs pl-4">Marca</TableHead>
                <TableHead className="text-xs text-right">SKUs</TableHead>
                <TableHead className="text-xs text-right">Unidades</TableHead>
                <TableHead className="text-xs text-right">% Estoque</TableHead>
                <TableHead className="text-xs text-right">Valor</TableHead>
                <TableHead className="text-xs text-right">% Valor</TableHead>
                <TableHead className="text-xs text-right">Vendidos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {brandData.map((b) => (
                <TableRow key={b.brand}>
                  <TableCell className="text-xs font-medium pl-4">{b.brand}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums">{numFmt(b.skus)}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums font-medium">{numFmt(b.units)}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums text-muted-foreground">
                    {totalUnits > 0 ? ((b.units / totalUnits) * 100).toFixed(1) : "0.0"}%
                  </TableCell>
                  <TableCell className="text-xs text-right tabular-nums">{currencyFmt(b.value)}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums text-muted-foreground">
                    {totalValue > 0 ? ((b.value / totalValue) * 100).toFixed(1) : "0.0"}%
                  </TableCell>
                  <TableCell className="text-xs text-right tabular-nums text-muted-foreground">{numFmt(b.sold)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function EstoqueRelatorios({ items, coverageMap, coveragePeriod }: RelatoriosProps) {
  return (
    <Tabs defaultValue="cobertura">
      <TabsList className="mb-4 h-8 w-auto">
        <TabsTrigger value="cobertura" className="text-xs px-3 h-7 gap-1.5"><Clock className="w-3.5 h-3.5" />Cobertura</TabsTrigger>
        <TabsTrigger value="marca" className="text-xs px-3 h-7 gap-1.5"><Tag className="w-3.5 h-3.5" />Por Marca</TabsTrigger>
        <TabsTrigger value="valor" className="text-xs px-3 h-7 gap-1.5"><DollarSign className="w-3.5 h-3.5" />Valor em Risco</TabsTrigger>
        <TabsTrigger value="abc" className="text-xs px-3 h-7 gap-1.5"><BarChart3 className="w-3.5 h-3.5" />Curva ABC</TabsTrigger>
        <TabsTrigger value="logistica" className="text-xs px-3 h-7 gap-1.5"><Truck className="w-3.5 h-3.5" />Logística</TabsTrigger>
      </TabsList>
      <TabsContent value="cobertura"><SubTabCobertura items={items} coverageMap={coverageMap} coveragePeriod={coveragePeriod} /></TabsContent>
      <TabsContent value="marca"><SubTabEstoqueMarca items={items} /></TabsContent>
      <TabsContent value="valor"><SubTabValorRisco items={items} coverageMap={coverageMap} /></TabsContent>
      <TabsContent value="abc"><SubTabCurvaABC items={items} /></TabsContent>
      <TabsContent value="logistica"><SubTabLogistica items={items} /></TabsContent>
    </Tabs>
  );
}

function SortableHead({ label, sortAsc, sortDesc, current, onSort, className = "" }: {
  label: string; sortAsc: string; sortDesc: string; current: string;
  onSort: (v: string) => void; className?: string;
}) {
  const isAsc = current === sortAsc;
  const isDesc = current === sortDesc;
  return (
    <TableHead
      className={`text-xs cursor-pointer select-none group ${className}`}
      onClick={() => onSort(isAsc ? sortDesc : sortAsc)}
    >
      <div className="inline-flex items-center gap-1">
        {label}
        {(isAsc || isDesc) ? (
          isAsc ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
        ) : (
          <ArrowUpDown className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>
    </TableHead>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function MLEstoque() {
  const { items, loading: isLoading, syncing, hasToken, lastUpdated, refresh, syncNow } = useMLInventory();
  // hasToken: null = ainda carregando, false = sem token, true = conectado
  const isConnected = hasToken !== false;
  const [coveragePeriod, setCoveragePeriod] = useState<CoveragePeriod>(30);
  const [thresholds, setThresholds] = useState<CoverageThresholds>(() => {
    if (typeof window === "undefined") return defaultThresholds(30);
    try {
      const raw = window.localStorage.getItem("ml_coverage_thresholds");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          parsed &&
          Number.isInteger(parsed.criticoMax) &&
          Number.isInteger(parsed.alertaMax) &&
          parsed.criticoMax >= 1 &&
          parsed.alertaMax <= 365 &&
          parsed.criticoMax < parsed.alertaMax
        ) {
          const rupturaMax =
            Number.isInteger(parsed.rupturaMax) &&
            parsed.rupturaMax >= 0 &&
            parsed.rupturaMax < parsed.criticoMax
              ? parsed.rupturaMax
              : 0;
          return {
            rupturaMax,
            criticoMax: parsed.criticoMax,
            alertaMax: parsed.alertaMax,
          };
        }
      }
    } catch {
      /* ignore */
    }
    return defaultThresholds(30);
  });

  useEffect(() => {
    try {
      window.localStorage.setItem("ml_coverage_thresholds", JSON.stringify(thresholds));
    } catch {
      /* ignore */
    }
  }, [thresholds]);

  const { coverageMap, stats } = useMLCoverage(items, coveragePeriod, thresholds);

  // Filter / sort state
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState("all");
  const [coverageFilter, setCoverageFilter] = useState("all");
  const [logisticFilter, setLogisticFilter] = useState("all");
  const [sortBy, setSortBy] = useState("title");
  const [hideOutOfStock, setHideOutOfStock] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [searchParams, setSearchParams] = useSearchParams();
  const highlightIds = useMemo(() => {
    const raw = searchParams.get("items");
    return raw ? new Set(raw.split(",").filter(Boolean)) : null;
  }, [searchParams]);

  const brands = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => { if (i.brand) set.add(i.brand); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filteredItems = useMemo(() => {
    let result = [...items];
    if (highlightIds !== null) {
      // Filtro do Consultor (?items=): mostra exatamente os itens sinalizados,
      // ignorando os demais filtros (busca, sem-estoque, marca, cobertura,
      // logística) — senão itens fora dos filtros padrão somem da lista.
      result = result.filter((i) => highlightIds.has(i.id));
    } else {
      const trimmedSearch = search.trim();
      if (trimmedSearch) {
        const q = trimmedSearch.toLowerCase();
        result = result.filter(
          (i) => i.title.toLowerCase().includes(q) || i.id.toLowerCase().includes(q) || (i.seller_custom_field ?? "").toLowerCase().includes(q)
        );
      } else if (hideOutOfStock) {
        result = result.filter((i) => i.available_quantity > 0);
      }
      if (brandFilter !== "all") result = result.filter((i) => (i.brand || "") === brandFilter);
      if (coverageFilter !== "all") {
        result = result.filter((i) => {
          const cd = coverageMap.get(i.id);
          return cd?.coverage_class === coverageFilter;
        });
      }
      if (logisticFilter !== "all") {
        result = result.filter((i) => (i.logistic_type ?? "not_specified") === logisticFilter);
      }
    }
    result.sort((a, b) => {
      switch (sortBy) {
        case "price_desc": return b.price - a.price;
        case "price_asc": return a.price - b.price;
        case "qty_desc": return b.available_quantity - a.available_quantity;
        case "qty_asc": return a.available_quantity - b.available_quantity;
        case "sold_desc": return (coverageMap.get(b.id)?.total_sold ?? 0) - (coverageMap.get(a.id)?.total_sold ?? 0);
        case "sold_asc": return (coverageMap.get(a.id)?.total_sold ?? 0) - (coverageMap.get(b.id)?.total_sold ?? 0);
        case "health_asc": return (a.health ?? 1) - (b.health ?? 1);
        case "health_desc": return (b.health ?? 0) - (a.health ?? 0);
        case "title_desc": return b.title.localeCompare(a.title);
        case "logistic_asc": return (a.logistic_type ?? "").localeCompare(b.logistic_type ?? "");
        case "logistic_desc": return (b.logistic_type ?? "").localeCompare(a.logistic_type ?? "");
        case "shipping_desc": return (b.free_shipping ? 1 : 0) - (a.free_shipping ? 1 : 0);
        case "shipping_asc": return (a.free_shipping ? 1 : 0) - (b.free_shipping ? 1 : 0);
        default: return a.title.localeCompare(b.title);
      }
    });
    return result;
  }, [items, search, brandFilter, coverageFilter, logisticFilter, sortBy, hideOutOfStock, coverageMap, highlightIds]);

  // KPI stats derived from filtered items so cards react to active filters
  const filteredStats = useMemo(() => {
    const totalStockValue = filteredItems.reduce((s, i) => s + i.price * i.available_quantity, 0);
    const totalUnits = filteredItems.reduce((s, i) => s + i.available_quantity, 0);
    let ruptura = 0, critico = 0, alerta = 0, ok = 0, sem_giro = 0, withDays = 0, sumDays = 0;
    for (const item of filteredItems) {
      const cd = coverageMap.get(item.id);
      if (!cd) continue;
      if (cd.coverage_class === "ruptura") ruptura++;
      else if (cd.coverage_class === "critico") critico++;
      else if (cd.coverage_class === "alerta") alerta++;
      else if (cd.coverage_class === "ok") ok++;
      else if (cd.coverage_class === "sem_giro") sem_giro++;
      if (cd.coverage_days !== null && cd.coverage_days > 0) { withDays++; sumDays += cd.coverage_days; }
    }
    return { totalStockValue, totalUnits, ruptura, critico, alerta, ok, sem_giro };
  }, [filteredItems, coverageMap]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (!isConnected) {
    return (
      <EmptyState
        icon={Plug}
        title="Mercado Livre não conectado"
        description="Conecte sua conta para visualizar o estoque em tempo real."
        actionLabel="Ir para Integrações"
        actionHref="/integracoes"
      />
    );
  }

  // Only show full-page skeleton on initial load (no data yet).
  // On subsequent refreshes keep the current view and just animate the button.
  if (isLoading && items.length === 0) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <Tabs defaultValue="estoque" className="space-y-5">
      {/* ── Sticky header ── */}
      <div className="sticky -top-4 md:-top-6 lg:-top-8 z-20 -mx-4 md:-mx-6 lg:-mx-8 -mt-4 md:-mt-6 lg:-mt-8 px-4 md:px-6 lg:px-8 pb-4 pt-4 bg-background/95 backdrop-blur-sm border-b border-border/40">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4 min-w-0">
          <MLPageHeader title="Estoque" lastUpdated={lastUpdated} />
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            {/* Coverage period selector */}
            <div className="flex gap-1 overflow-x-auto no-scrollbar">
              {COVERAGE_PERIODS.map(({ label, value }) => (
                <button
                  key={value}
                  onClick={() => setCoveragePeriod(value)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors border shrink-0 ${
                    coveragePeriod === value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <CoverageSettingsPopover
              period={coveragePeriod}
              thresholds={thresholds}
              onChange={setThresholds}
            />
            <TabsList className="h-8 overflow-x-auto no-scrollbar max-w-full">
              <TabsTrigger value="estoque" className="text-xs px-3 h-7">Estoque</TabsTrigger>
              <TabsTrigger value="relatorios" className="text-xs px-3 h-7">Relatórios</TabsTrigger>
              <TabsTrigger value="compra" className="text-xs px-3 h-7 gap-1">
                <ShoppingCart className="w-3 h-3" />
                Compra Recomendada
              </TabsTrigger>
            </TabsList>
            <Button
              variant="ghost"
              size="sm"
              onClick={refresh}
              disabled={isLoading || syncing}
              className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:bg-muted hover:text-muted-foreground"
              aria-label="Recarregar cache"
              title="Recarregar dados do banco"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Atualizar</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={syncNow}
              disabled={isLoading || syncing}
              className="h-8 gap-1.5 px-2.5 text-xs"
              aria-label="Sincronizar inventário com Mercado Livre"
              title="Busca dados atualizados no Mercado Livre (pode levar alguns segundos)"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">{syncing ? "Sincronizando…" : "Sincronizar ML"}</span>
            </Button>
          </div>
        </div>
      </div>

      {/* ═══════════════════ ABA ESTOQUE ═══════════════════ */}
      <TabsContent value="estoque" className="space-y-5 mt-0">
        {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <KPICard title="Valor em Estoque" value={currencyFmtShort(filteredStats.totalStockValue)} icon={<DollarSign className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-accent/10 text-accent" />
          <KPICard
            title="Qtd. em Estoque"
            value={numFmt(filteredStats.totalUnits)}
            icon={<Boxes className="w-4 h-4" />}
            variant="minimal" size="compact" iconClassName="bg-success/10 text-success"
          />
          <KPICard
            title="RUPTURA"
            value={numFmt(filteredStats.ruptura)}
            icon={<PackageX className="w-4 h-4" />}
            variant={filteredStats.ruptura > 0 ? "danger" : "minimal"}
            size="compact"
            iconClassName="bg-destructive/10 text-destructive"
          />
          <KPICard
            title="CRÍTICO + ALERTA"
            value={numFmt(filteredStats.critico + filteredStats.alerta)}
            icon={<AlertTriangle className="w-4 h-4" />}
            variant={filteredStats.critico + filteredStats.alerta > 0 ? "warning" : "minimal"}
            size="compact"
            iconClassName="bg-warning/10 text-warning"
          />
          <KPICard
            title="OK"
            value={numFmt(filteredStats.ok)}
            icon={<CheckCircle2 className="w-4 h-4" />}
            variant={filteredStats.ok > 0 ? "success" : "minimal"}
            size="compact"
            iconClassName="bg-success/10 text-success"
          />
        </div>

        <CoverageAlerts coverageMap={coverageMap} items={items} />

        {/* Filters + Table inside Card */}
        <Card>
          <div className="px-4 pt-4 pb-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <span className="text-sm font-medium text-foreground">Inventário</span>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Cobertura: últimos {coveragePeriod}d
                </p>
              </div>
              <div className="flex items-center gap-1.5 w-full sm:w-auto flex-wrap">
                <div className="relative w-44">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Buscar..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-8 h-8 text-xs"
                  />
                </div>
                <Select value={brandFilter} onValueChange={setBrandFilter}>
                  <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Marcas</SelectItem>
                    {brands.map((b) => (
                      <SelectItem key={b} value={b}>{b}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={coverageFilter} onValueChange={setCoverageFilter}>
                  <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Coberturas</SelectItem>
                    {(Object.keys(COVERAGE_CLASS_LABELS) as CoverageClass[]).map((cls) => {
                      const Icon = COVERAGE_CLASS_ICONS[cls];
                      const color = COVERAGE_COLORS[cls];
                      return (
                        <SelectItem
                          key={cls}
                          value={cls}
                          className="focus:bg-transparent"
                          style={{ ["--cov-color" as string]: color }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLElement).style.color = color;
                            (e.currentTarget as HTMLElement).style.backgroundColor = `${color}1f`;
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.color = "";
                            (e.currentTarget as HTMLElement).style.backgroundColor = "";
                          }}
                          onFocus={(e) => {
                            (e.currentTarget as HTMLElement).style.color = color;
                            (e.currentTarget as HTMLElement).style.backgroundColor = `${color}1f`;
                          }}
                          onBlur={(e) => {
                            (e.currentTarget as HTMLElement).style.color = "";
                            (e.currentTarget as HTMLElement).style.backgroundColor = "";
                          }}
                        >
                          <span className="flex items-center gap-2">
                            <Icon className="w-3.5 h-3.5" style={{ color }} />
                            {COVERAGE_CLASS_LABELS[cls]}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <Select value={logisticFilter} onValueChange={setLogisticFilter}>
                  <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Logística</SelectItem>
                    {Object.entries(LOGISTIC_LABELS).map(([k, label]) => (
                      <SelectItem key={k} value={k}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1.5 cursor-pointer opacity-60 hover:opacity-100 transition-opacity"
                  onClick={(e) => { e.preventDefault(); setHideOutOfStock((v) => !v); }}
                >
                  <Checkbox checked={hideOutOfStock} className="h-3.5 w-3.5 pointer-events-none" />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Ocultar sem estoque</span>
                </div>
              </div>
            </div>
          </div>

          {highlightIds !== null && (
            <div className="flex items-center gap-2 px-4 py-2 bg-accent/10 border-b border-accent/20 text-sm text-accent-foreground">
              <ShieldAlert className="w-4 h-4 shrink-0 text-accent" />
              <span>Mostrando {filteredItems.length} produto(s) sinalizado(s) pelo Consultor</span>
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
            {filteredItems.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">{search || brandFilter !== "all" || coverageFilter !== "all" ? "Nenhum produto encontrado" : "Nenhum produto no inventário"}</p>
              </div>
            ) : (
              <div className="max-h-[600px] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-card z-10">
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead className="w-10" />
                      <SortableHead label="Produto" sortAsc="title" sortDesc="title_desc" current={sortBy} onSort={setSortBy} />
                      <SortableHead label="Preço" sortAsc="price_asc" sortDesc="price_desc" current={sortBy} onSort={setSortBy} className="text-right" />
                      <SortableHead label="Estoque" sortAsc="qty_asc" sortDesc="qty_desc" current={sortBy} onSort={setSortBy} className="text-right" />
                      <SortableHead label={`Vendidos (${coveragePeriod}d)`} sortAsc="sold_asc" sortDesc="sold_desc" current={sortBy} onSort={setSortBy} className="text-right" />
                      <TableHead className="text-xs text-right">Unid/dia</TableHead>
                      <TableHead className="text-xs">Cobertura</TableHead>
                      <SortableHead label="Logística" sortAsc="logistic_asc" sortDesc="logistic_desc" current={sortBy} onSort={setSortBy} />
                      <SortableHead label="Frete" sortAsc="shipping_asc" sortDesc="shipping_desc" current={sortBy} onSort={setSortBy} />
                      <SortableHead label="Saúde" sortAsc="health_asc" sortDesc="health_desc" current={sortBy} onSort={setSortBy} />
                      <TableHead className="w-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.map((item) => {
                      const cd = coverageMap.get(item.id);
                      const isOpen = expanded.has(item.id);
                      const visibleVariations = hideOutOfStock
                        ? item.variations.filter((v) => v.available_quantity > 0)
                        : item.variations;
                      const hasVisibleVariations = item.has_variations && visibleVariations.length > 0;

                      return (
                        <>
                          <TableRow key={item.id} className="group">
                            <TableCell className="p-1 pl-2">
                              {hasVisibleVariations && (
                                <button onClick={() => toggleExpand(item.id)} className="text-muted-foreground hover:text-foreground">
                                  {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                </button>
                              )}
                            </TableCell>
                            <TableCell className="p-1">
                              {item.thumbnail ? (
                                <img src={item.thumbnail} alt="" loading="lazy" decoding="async" className="w-8 h-8 rounded object-cover" />
                              ) : (
                                <div className="w-8 h-8 rounded bg-muted flex items-center justify-center">
                                  <Package className="w-4 h-4 text-muted-foreground" />
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-xs max-w-[200px]">
                              <div className="font-medium truncate">{item.title}</div>
                              <div className="text-muted-foreground text-[10px] flex gap-1 flex-wrap mt-0.5">
                                <span>{item.id}</span>
                                {item.seller_custom_field && <Badge variant="outline" className="text-[10px] h-4 px-1">{item.seller_custom_field}</Badge>}

                                {item.has_variations && item.variations.length > 0 && (
                                  <Badge variant="outline" className="text-[10px] h-4 px-1">{item.variations.length} var.</Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-right font-medium">{currencyFmt(item.price)}</TableCell>
                            <TableCell className={`text-xs text-right font-semibold ${item.available_quantity === 0 ? "text-red-500" : ""}`}>
                              {numFmt(item.available_quantity)}
                            </TableCell>
                            <TableCell className="text-xs text-right">{numFmt(cd?.total_sold ?? item.sold_quantity)}</TableCell>
                            <TableCell className="text-xs text-right tabular-nums text-muted-foreground">
                              {cd && cd.avg_daily_sales > 0 ? cd.avg_daily_sales.toFixed(1) : "—"}
                            </TableCell>
                            <TableCell>
                              {cd ? (
                                <div className="flex flex-col gap-0">
                                  <span
                                    className="text-xs font-semibold tabular-nums leading-tight"
                                    style={{ color: COVERAGE_COLORS[cd.coverage_class] }}
                                  >
                                    {cd.coverage_class === "ruptura"
                                      ? "Ruptura"
                                      : cd.coverage_days === null
                                        ? "Sem giro"
                                        : `${cd.coverage_days} dias`}
                                  </span>
                                  {cd.coverage_class !== "ruptura" && cd.coverage_days !== null && (
                                    <span className="text-[10px] text-muted-foreground leading-tight">
                                      {COVERAGE_CLASS_LABELS[cd.coverage_class]}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <LogisticBadge type={item.logistic_type} />
                            </TableCell>
                            <TableCell>
                              {item.free_shipping ? (
                                <Badge variant="outline" className="text-[10px] border-emerald-500 text-emerald-600 bg-emerald-50 px-[4px] py-px">
                                  <Truck className="w-3 h-3 mr-0.5" /> Grátis
                                </Badge>
                              ) : <span className="text-xs text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell><HealthBar health={item.health} /></TableCell>
                            <TableCell className="p-1">
                              <a
                                href={`https://produto.mercadolivre.com.br/${item.id.replace(/^(MLB)(\d+)$/, "$1-$2")}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            </TableCell>
                          </TableRow>
                          {isOpen && hasVisibleVariations && (
                            <TableRow key={`${item.id}-vars`}>
                              <TableCell colSpan={12} className="p-0 bg-muted/20 border-b">
                                <div className="px-10 py-3">
                                  <Table>
                                    <TableHeader>
                                      <TableRow className="border-b border-border/50">
                                        <TableHead className="text-xs h-8 font-medium">Variação</TableHead>
                                        <TableHead className="text-xs h-8 font-medium text-right">Estoque</TableHead>
                                        <TableHead className="text-xs h-8 font-medium text-right">Vendidos</TableHead>
                                        <TableHead className="text-xs h-8 font-medium text-right">Unid/dia</TableHead>
                                        <TableHead className="text-xs h-8 font-medium">Cobertura</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {visibleVariations.map((v) => {
                                        const ratio = item.sold_quantity > 0 ? v.sold_quantity / item.sold_quantity : 0;
                                        const avgDailyV = cd ? cd.avg_daily_sales * ratio : 0;
                                        const coverageDaysV = avgDailyV > 0 ? Math.floor(v.available_quantity / avgDailyV) : null;
                                        let covClassV: CoverageClass = "sem_giro";
                                        if (v.available_quantity === 0) covClassV = "ruptura";
                                        else if (avgDailyV > 0 && coverageDaysV !== null) {
                                          if (coverageDaysV < thresholds.rupturaMax) covClassV = "ruptura";
                                          else if (coverageDaysV < thresholds.criticoMax) covClassV = "critico";
                                          else if (coverageDaysV < thresholds.alertaMax) covClassV = "alerta";
                                          else covClassV = "ok";
                                        }
                                        return (
                                          <TableRow key={v.variation_id} className="border-b border-border/30 last:border-0">
                                            <TableCell className="py-2 text-xs font-medium">
                                              {v.attribute_combinations?.map((a) => `${a.name}: ${a.value}`).join(" / ") || `Variação ${v.variation_id}`}
                                            </TableCell>
                                            <TableCell className={`py-2 text-xs text-right font-semibold ${v.available_quantity === 0 ? "text-red-500" : ""}`}>
                                              {numFmt(v.available_quantity)}
                                            </TableCell>
                                            <TableCell className="py-2 text-xs text-right text-muted-foreground">
                                              {numFmt(v.sold_quantity)}
                                            </TableCell>
                                            <TableCell className="py-2 text-xs text-right tabular-nums text-muted-foreground">
                                              {avgDailyV > 0 ? avgDailyV.toFixed(1) : "—"}
                                            </TableCell>
                                            <TableCell className="py-2">
                                              {v.available_quantity === 0 ? (
                                                <span className="text-xs font-semibold" style={{ color: COVERAGE_COLORS.ruptura }}>Ruptura</span>
                                              ) : avgDailyV === 0 ? (
                                                <span className="text-xs text-muted-foreground">Sem giro</span>
                                              ) : (
                                                <div className="flex flex-col gap-0">
                                                  <span className="text-xs font-semibold tabular-nums leading-tight" style={{ color: COVERAGE_COLORS[covClassV] }}>
                                                    {coverageDaysV} dias
                                                  </span>
                                                  <span className="text-[10px] text-muted-foreground leading-tight">
                                                    {COVERAGE_CLASS_LABELS[covClassV]}
                                                  </span>
                                                </div>
                                              )}
                                            </TableCell>
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

            {/* Footer */}
            <div className="border-t border-border/60 bg-muted/20 px-6 py-2.5 flex items-center gap-8 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{filteredItems.length} de {items.length} produtos</span>
              <span>Estoque: <strong className="text-foreground">{numFmt(filteredStats.totalUnits)} unid.</strong></span>
              <span>Valor: <strong className="text-foreground">{currencyFmt(filteredStats.totalStockValue)}</strong></span>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* ═══════════════════ ABA RELATÓRIOS ═══════════════════ */}
      <TabsContent value="relatorios" className="mt-0">
        <EstoqueRelatorios items={items} coverageMap={coverageMap} coveragePeriod={coveragePeriod} />
      </TabsContent>

      {/* ═══════════════════ ABA COMPRA RECOMENDADA ═══════════════════ */}
      <TabsContent value="compra" className="mt-0">
        <ReplenishmentPanel />
      </TabsContent>
    </Tabs>
  );
}
