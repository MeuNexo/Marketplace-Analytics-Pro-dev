import { useMemo, useState, useEffect } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, Legend, ReferenceLine,
  PieChart, Pie, Cell,
} from "recharts";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Target, LineChart as LineChartIcon, PieChart as PieChartIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type {
  AdsDailyStat, AdsCampaign,
} from "@/hooks/useMLAds";

// ─── Helpers ───────────────────────────────────────────────────────────────

const currFmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function safeDiv(a: number, b: number) { return b > 0 ? a / b : 0; }

// ─── Props ─────────────────────────────────────────────────────────────────

interface Props {
  daily: AdsDailyStat[];
  campaigns: AdsCampaign[];
  products: unknown[];
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
  daily, campaigns,
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

  // ─── Empty state ──────────────────────────────────────────────────────
  if (currDaily.length === 0 && campaigns.length === 0) {
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
    </Tabs>
  );
}