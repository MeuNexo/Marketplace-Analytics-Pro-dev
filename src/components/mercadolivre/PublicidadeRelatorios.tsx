import { useMemo, useState, useEffect } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, Legend, ReferenceLine,
  PieChart, Pie, Cell,
} from "recharts";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { TrendingUp, TrendingDown, Target, LineChart as LineChartIcon, PieChart as PieChartIcon, Crosshair, GitCompare, Coins } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type {
  AdsDailyStat, AdsCampaign, AdsProductStat,
} from "@/hooks/useMLAds";

// ─── Helpers ───────────────────────────────────────────────────────────────

const currFmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const numFmt  = (v: number) => v.toLocaleString("pt-BR");

function safeDiv(a: number, b: number) { return b > 0 ? a / b : 0; }

function deltaPct(curr: number, prev: number) {
  if (!prev || prev === 0) return curr > 0 ? 100 : 0;
  return ((curr - prev) / prev) * 100;
}

function DeltaBadge({ value, invert = false }: { value: number; invert?: boolean }) {
  const v = Number.isFinite(value) ? value : 0;
  const positive = invert ? v < 0 : v > 0;
  const negative = invert ? v > 0 : v < 0;
  if (Math.abs(v) < 0.05) return <span className="text-muted-foreground tabular-nums text-xs">—</span>;
  const Icon = v > 0 ? TrendingUp : TrendingDown;
  const cls = positive
    ? "text-emerald-600"
    : negative
      ? "text-red-600"
      : "text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-0.5 tabular-nums text-xs ${cls}`}>
      <Icon className="w-3 h-3" />{Math.abs(v).toFixed(1)}%
    </span>
  );
}

// ─── Props ─────────────────────────────────────────────────────────────────

interface Props {
  daily: AdsDailyStat[];
  campaigns: AdsCampaign[];
  products: AdsProductStat[];
  prevCampaigns: AdsCampaign[];
  currentFrom: string;
  currentTo: string;
  prevFrom: string;
  prevTo: string;
}

const ROAS_GOAL_KEY = "ml-publicidade-roas-goal";

// ─── Section wrapper ───────────────────────────────────────────────────────

function Section({ title, subtitle, children, action }: { title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card>
      <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm font-medium text-foreground">{title}</span>
          {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      <CardContent className="px-4 pb-4 pt-0">{children}</CardContent>
    </Card>
  );
}

// ─── Main component ───────────────────────────────────────────────────────

export function PublicidadeRelatorios({
  daily, campaigns, products, prevCampaigns,
  currentFrom, currentTo,
}: Props) {
  // ROAS goal — persisted
  const [roasGoal, setRoasGoal] = useState<number>(() => {
    if (typeof window === "undefined") return 10;
    const saved = window.localStorage.getItem(ROAS_GOAL_KEY);
    const n = saved ? Number(saved) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 10;
  });
  useEffect(() => {
    try { window.localStorage.setItem(ROAS_GOAL_KEY, String(roasGoal)); } catch { /* noop */ }
  }, [roasGoal]);

  // ─── Filter daily to current period ─────────────────────────────────────
  const currDaily = useMemo(
    () => daily.filter((d) => d.date >= currentFrom && d.date <= currentTo)
               .sort((a, b) => a.date.localeCompare(b.date)),
    [daily, currentFrom, currentTo],
  );

  // ─── 1. Performance evolution ───────────────────────────────────────────
  const perfData = useMemo(() => currDaily.map((d) => ({
    label: format(parseISO(d.date), "dd/MM", { locale: ptBR }),
    ROAS: Number(d.roas?.toFixed(2) ?? 0),
    CPC:  Number(d.cpc?.toFixed(2) ?? 0),
    CTR:  Number(d.ctr?.toFixed(2) ?? 0),
  })), [currDaily]);

  // ─── 2. Spend distribution by campaign (donut + table) ──────────────────
  const totalSpend   = campaigns.reduce((s, c) => s + (c.spend ?? 0), 0);
  const totalRevenue = campaigns.reduce((s, c) => s + (c.attributed_revenue ?? 0), 0);
  const distribData  = useMemo(() => {
    return campaigns
      .filter((c) => c.spend > 0)
      .map((c) => ({
        id: c.id,
        name: c.name,
        spend: c.spend,
        revenue: c.attributed_revenue,
        spendPct:   safeDiv(c.spend, totalSpend) * 100,
        revenuePct: safeDiv(c.attributed_revenue, totalRevenue) * 100,
        efficiency: safeDiv(c.attributed_revenue, c.spend),
      }))
      .sort((a, b) => b.spend - a.spend);
  }, [campaigns, totalSpend, totalRevenue]);
  const DONUT_COLORS = ["hsl(var(--primary))", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

  // ─── 4. Spend × ROAS matrix (products) ──────────────────────────────────
  const validProducts = useMemo(() => products.filter((p) => p.spend > 0), [products]);
  const medianSpend   = useMemo(() => {
    if (validProducts.length === 0) return 0;
    const arr = [...validProducts].map((p) => p.spend).sort((a, b) => a - b);
    return arr[Math.floor(arr.length / 2)];
  }, [validProducts]);
  const productBuckets = useMemo(() => {
    const buckets: Record<"escale" | "pause" | "invista" | "descarte", AdsProductStat[]> = {
      escale: [], pause: [], invista: [], descarte: [],
    };
    validProducts.forEach((p) => {
      const highSpend = p.spend >= medianSpend;
      const goodRoas  = p.roas  >= roasGoal;
      if (highSpend && goodRoas)        buckets.escale.push(p);
      else if (highSpend && !goodRoas)  buckets.pause.push(p);
      else if (!highSpend && goodRoas)  buckets.invista.push(p);
      else                              buckets.descarte.push(p);
    });
    (Object.keys(buckets) as (keyof typeof buckets)[]).forEach((k) => {
      buckets[k].sort((a, b) => b.spend - a.spend);
    });
    return buckets;
  }, [validProducts, medianSpend, roasGoal]);

  // ─── 5. Campaign comparison vs previous period ─────────────────────────
  const compareData = useMemo(() => {
    const prevMap = new Map(prevCampaigns.map((c) => [c.id || c.name, c]));
    return campaigns.map((c) => {
      const prev = prevMap.get(c.id || c.name);
      const isNew = !prev;
      return {
        id: c.id,
        name: c.name,
        spend: c.spend,
        roas:  c.roas,
        orders: c.attributed_orders,
        isNew,
        deltaSpend:  deltaPct(c.spend, prev?.spend ?? 0),
        deltaRoas:   deltaPct(c.roas,  prev?.roas  ?? 0),
        deltaOrders: deltaPct(c.attributed_orders, prev?.attributed_orders ?? 0),
        score: isNew ? -Infinity : deltaPct(c.roas, prev?.roas ?? 0) + deltaPct(c.attributed_orders, prev?.attributed_orders ?? 0),
      };
    }).sort((a, b) => {
      if (a.isNew && !b.isNew) return 1;
      if (b.isNew && !a.isNew) return -1;
      return b.score - a.score;
    });
  }, [campaigns, prevCampaigns]);

  // ─── 7. CPA over time ─────────────────────────────────────────────────
  const cpaData = useMemo(() => currDaily.map((d) => {
    const cpa = safeDiv(d.spend, d.attributed_orders);
    const ticket = safeDiv(d.attributed_revenue, d.attributed_orders);
    return {
      label: format(parseISO(d.date), "dd/MM", { locale: ptBR }),
      CPA:    Number(cpa.toFixed(2)),
      Ticket: Number(ticket.toFixed(2)),
    };
  }), [currDaily]);
  const avgCpa = useMemo(() => {
    const valid = cpaData.filter((d) => d.CPA > 0);
    return valid.length > 0 ? valid.reduce((s, d) => s + d.CPA, 0) / valid.length : 0;
  }, [cpaData]);
  const avgTicket = useMemo(() => {
    const valid = cpaData.filter((d) => d.Ticket > 0);
    return valid.length > 0 ? valid.reduce((s, d) => s + d.Ticket, 0) / valid.length : 0;
  }, [cpaData]);

  // ─── Empty state ──────────────────────────────────────────────────────
  if (currDaily.length === 0 && campaigns.length === 0 && products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3 text-center text-muted-foreground">
        <Target className="w-10 h-10 opacity-30" />
        <p className="text-sm">Sem dados de publicidade para o período selecionado.</p>
      </div>
    );
  }

  return (
    <Tabs defaultValue="evolucao" className="space-y-4">
      <TabsList className="h-8 w-auto overflow-x-auto no-scrollbar">
        <TabsTrigger value="evolucao"   className="text-xs px-3 h-7 gap-1.5"><LineChartIcon className="w-3.5 h-3.5" />Evolução</TabsTrigger>
        <TabsTrigger value="distribuicao" className="text-xs px-3 h-7 gap-1.5"><PieChartIcon className="w-3.5 h-3.5" />Distribuição do Gasto</TabsTrigger>
        <TabsTrigger value="eficiencia" className="text-xs px-3 h-7 gap-1.5"><Crosshair className="w-3.5 h-3.5" />Eficiência por Produto</TabsTrigger>
        <TabsTrigger value="comparativo" className="text-xs px-3 h-7 gap-1.5"><GitCompare className="w-3.5 h-3.5" />Comparativo</TabsTrigger>
        <TabsTrigger value="cpa"        className="text-xs px-3 h-7 gap-1.5"><Coins className="w-3.5 h-3.5" />CPA</TabsTrigger>
      </TabsList>

      {/* ── 1. Performance evolution ─────────────────────────── */}
      <TabsContent value="evolucao" className="mt-0">
      <Section
        title="Evolução de Performance"
        subtitle="ROAS, CPC e CTR ao longo do período. Meta de ROAS é a linha tracejada."
        action={
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Meta ROAS:</span>
            <Input
              type="number"
              min={0}
              step={0.5}
              value={roasGoal}
              onChange={(e) => setRoasGoal(Math.max(0, Number(e.target.value) || 0))}
              className="h-7 w-16 text-xs tabular-nums"
            />
          </div>
        }
      >
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={perfData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false}
              interval={perfData.length <= 7 ? 0 : Math.floor(perfData.length / 7)} />
            <YAxis yAxisId="left"  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={36} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={42} tickFormatter={(v) => `R$${v}`} />
            <RechartsTooltip
              contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
              formatter={(v: number, name: string) => name === "CPC" ? [currFmt(v), name] : name === "ROAS" ? [`${v}x`, name] : [`${v}%`, name]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine yAxisId="left" y={roasGoal} stroke="#10b981" strokeDasharray="4 3" label={{ value: `Meta ${roasGoal}x`, position: "right", fill: "#10b981", fontSize: 10 }} />
            <Line yAxisId="left"  type="monotone" dataKey="ROAS" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            <Line yAxisId="left"  type="monotone" dataKey="CTR"  stroke="#f59e0b" strokeWidth={2} dot={false} strokeDasharray="3 3" />
            <Line yAxisId="right" type="monotone" dataKey="CPC"  stroke="#ef4444" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </Section>
      </TabsContent>

      {/* ── 2. Spend distribution by campaign ────────────────── */}
      <TabsContent value="distribuicao" className="mt-0">
      <Section
        title="Distribuição do Gasto por Campanha"
        subtitle="Quanto cada campanha consome do orçamento e quanto retorna em receita atribuída."
      >
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-2">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={distribData.slice(0, 8)}
                  dataKey="spend"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={2}
                >
                  {distribData.slice(0, 8).map((_, i) => (
                    <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                  ))}
                </Pie>
                <RechartsTooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number) => [currFmt(v), "Gasto"]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="lg:col-span-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 text-muted-foreground">
                  <th className="px-2 py-2 text-left font-semibold">Campanha</th>
                  <th className="px-2 py-2 text-right font-semibold">% Gasto</th>
                  <th className="px-2 py-2 text-right font-semibold">% Receita</th>
                  <th className="px-2 py-2 text-right font-semibold">Eficiência</th>
                </tr>
              </thead>
              <tbody>
                {distribData.slice(0, 12).map((d, i) => {
                  const ineficiente = d.spendPct > d.revenuePct + 5;
                  return (
                    <tr key={d.id} className="border-b border-border/30">
                      <td className="px-2 py-2 max-w-[200px] truncate">
                        <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                        {d.name}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{d.spendPct.toFixed(1)}%</td>
                      <td className="px-2 py-2 text-right tabular-nums">{d.revenuePct.toFixed(1)}%</td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        <span className={ineficiente ? "text-red-600" : "text-emerald-600"}>{d.efficiency.toFixed(2)}x</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Section>
      </TabsContent>

      {/* ── 4. Spend × ROAS matrix ─────────────────────────── */}
      <TabsContent value="eficiencia" className="mt-0">
      <Section
        title="Eficiência por Produto"
        subtitle={`Cada produto é classificado em um dos 4 grupos comparando gasto (mediana ${currFmt(medianSpend)}) com ROAS (meta ${roasGoal}x).`}
      >
        {validProducts.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">Sem produtos com gasto no período.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {([
              { key: "escale",   label: "Escale",        hint: "Alto gasto · ROAS acima da meta",  tone: "emerald" },
              { key: "invista",  label: "Invista mais",  hint: "Baixo gasto · ROAS acima da meta", tone: "primary" },
              { key: "pause",    label: "Pause / Revise",hint: "Alto gasto · ROAS abaixo da meta", tone: "red" },
              { key: "descarte", label: "Descarte",      hint: "Baixo gasto · ROAS abaixo da meta",tone: "muted" },
            ] as const).map(({ key, label, hint, tone }) => {
              const list = productBuckets[key];
              const toneCls =
                tone === "emerald" ? "bg-emerald-500/5 border-emerald-500/30"
                : tone === "primary" ? "bg-primary/5 border-primary/30"
                : tone === "red"     ? "bg-red-500/5 border-red-500/30"
                : "bg-muted/40 border-border";
              const titleCls =
                tone === "emerald" ? "text-emerald-700"
                : tone === "primary" ? "text-primary"
                : tone === "red"     ? "text-red-700"
                : "text-muted-foreground";
              return (
                <div key={key} className={`rounded-md border ${toneCls} p-3`}>
                  <div className="flex items-baseline justify-between mb-2">
                    <div>
                      <p className={`text-xs font-semibold ${titleCls}`}>{label}</p>
                      <p className="text-[10px] text-muted-foreground">{hint}</p>
                    </div>
                    <span className="text-[11px] tabular-nums text-muted-foreground">{list.length} {list.length === 1 ? "produto" : "produtos"}</span>
                  </div>
                  {list.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground py-2">Nenhum produto neste grupo.</p>
                  ) : (
                    <ul className="divide-y divide-border/40">
                      {list.slice(0, 5).map((p) => (
                        <li key={p.item_id} className="py-1.5 flex items-center gap-2 text-[11px]">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium" title={p.title}>{p.title}</p>
                            <p className="text-[10px] text-muted-foreground font-mono">{p.item_id}</p>
                          </div>
                          <div className="text-right tabular-nums shrink-0">
                            <p>{currFmt(p.spend)}</p>
                            <p className={p.roas >= roasGoal ? "text-emerald-600" : "text-red-600"}>{p.roas.toFixed(2)}x</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  {list.length > 5 && (
                    <p className="text-[10px] text-muted-foreground mt-1">+ {list.length - 5} outros</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>
      </TabsContent>

      {/* ── 5. Campaign comparison ─────────────────────────── */}
      <TabsContent value="comparativo" className="mt-0">
      <Section
        title="Comparativo de Campanhas vs Período Anterior"
        subtitle="Variação de Gasto, ROAS e Pedidos vs período imediatamente anterior. Campanhas sem histórico aparecem como Novas."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/60 text-muted-foreground bg-muted/30">
                <th className="px-3 py-2 text-left font-semibold">Campanha</th>
                <th className="px-3 py-2 text-right font-semibold">Gasto</th>
                <th className="px-3 py-2 text-right font-semibold">Δ Gasto</th>
                <th className="px-3 py-2 text-right font-semibold">ROAS</th>
                <th className="px-3 py-2 text-right font-semibold">Δ ROAS</th>
                <th className="px-3 py-2 text-right font-semibold">Pedidos</th>
                <th className="px-3 py-2 text-right font-semibold">Δ Pedidos</th>
              </tr>
            </thead>
            <tbody>
              {compareData.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Sem campanhas no período.</td></tr>
              )}
              {compareData.map((c) => (
                <tr key={c.id} className="border-b border-border/30">
                  <td className="px-3 py-2 max-w-[260px] truncate font-medium">
                    {c.name}
                    {c.isNew && <Badge variant="secondary" className="ml-2 text-[10px] py-0 px-1.5 h-4 hover:bg-secondary">Nova</Badge>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{currFmt(c.spend)}</td>
                  <td className="px-3 py-2 text-right">{c.isNew ? <span className="text-muted-foreground text-xs">—</span> : <DeltaBadge value={c.deltaSpend} invert />}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.roas.toFixed(2)}x</td>
                  <td className="px-3 py-2 text-right">{c.isNew ? <span className="text-muted-foreground text-xs">—</span> : <DeltaBadge value={c.deltaRoas} />}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{numFmt(c.orders)}</td>
                  <td className="px-3 py-2 text-right">{c.isNew ? <span className="text-muted-foreground text-xs">—</span> : <DeltaBadge value={c.deltaOrders} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {compareData.length > 0 && prevCampaigns.length === 0 && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            Sem dados do período anterior ({prevFrom} a {prevTo}) para comparar — as variações aparecerão na próxima sincronização.
          </p>
        )}
      </Section>
      </TabsContent>

      {/* ── 7. CPA over time ───────────────────────────────── */}
      <TabsContent value="cpa" className="mt-0">
      <Section
        title="Custo por Pedido (CPA) ao Longo do Tempo"
        subtitle="CPA diário comparado com o ticket médio atribuído aos anúncios."
        action={
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span>CPA médio: <strong className="text-foreground tabular-nums">{currFmt(avgCpa)}</strong></span>
            <span>Ticket médio: <strong className="text-foreground tabular-nums">{currFmt(avgTicket)}</strong></span>
          </div>
        }
      >
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={cpaData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false}
              interval={cpaData.length <= 7 ? 0 : Math.floor(cpaData.length / 7)} />
            <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={52}
              tickFormatter={(v) => `R$${v}`} />
            <RechartsTooltip
              contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
              formatter={(v: number, name: string) => [currFmt(v), name]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine y={avgTicket} stroke="#10b981" strokeDasharray="4 3" label={{ value: "Ticket médio", position: "right", fill: "#10b981", fontSize: 10 }} />
            <Line type="monotone" dataKey="CPA"    stroke="#ef4444" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Ticket" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} strokeDasharray="3 3" />
          </LineChart>
        </ResponsiveContainer>
        {avgCpa > 0 && avgTicket > 0 && (
          <div className="mt-3">
            <Badge className={`hover:bg-inherit ${avgCpa < avgTicket * 0.5 ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" : avgCpa < avgTicket ? "bg-amber-500/15 text-amber-700 border-amber-500/30" : "bg-red-500/15 text-red-700 border-red-500/30"}`}>
              {avgCpa < avgTicket * 0.5
                ? "Saudável: CPA representa menos da metade do ticket médio."
                : avgCpa < avgTicket
                  ? "Atenção: CPA acima de 50% do ticket médio."
                  : "Alerta: CPA superior ao ticket médio — você gasta mais do que vende."}
            </Badge>
          </div>
        )}
      </Section>
      </TabsContent>
    </Tabs>
  );
}