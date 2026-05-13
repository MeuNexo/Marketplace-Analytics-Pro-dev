import { useMemo, useState, useEffect } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, Legend, ReferenceLine,
  PieChart, Pie, Cell, ScatterChart, Scatter, ZAxis,
} from "recharts";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { TrendingUp, TrendingDown, Target } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  const scatterData = useMemo(() => validProducts.map((p) => ({
    x: p.spend,
    y: p.roas,
    z: p.attributed_orders + 1,
    title: p.title,
    item_id: p.item_id,
  })), [validProducts]);

  // ─── 5. Campaign comparison vs previous period ─────────────────────────
  const compareData = useMemo(() => {
    const prevMap = new Map(prevCampaigns.map((c) => [c.id || c.name, c]));
    return campaigns.map((c) => {
      const prev = prevMap.get(c.id || c.name);
      return {
        id: c.id,
        name: c.name,
        spend: c.spend,
        roas:  c.roas,
        orders: c.attributed_orders,
        deltaSpend:  deltaPct(c.spend, prev?.spend ?? 0),
        deltaRoas:   deltaPct(c.roas,  prev?.roas  ?? 0),
        deltaOrders: deltaPct(c.attributed_orders, prev?.attributed_orders ?? 0),
        score: deltaPct(c.roas, prev?.roas ?? 0) + deltaPct(c.attributed_orders, prev?.attributed_orders ?? 0),
      };
    }).sort((a, b) => b.score - a.score);
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
    <div className="space-y-5">

      {/* ── 1. Performance evolution ─────────────────────────── */}
      <Section
        title="1. Evolução de Performance"
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

      {/* ── 2. Spend distribution by campaign ────────────────── */}
      <Section
        title="2. Distribuição do Gasto por Campanha"
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

      {/* ── 3. Weekday heatmap ──────────────────────────────── */}
      <Section
        title="3. Mapa de Calor por Dia da Semana"
        subtitle="Padrões semanais — intensidade da cor representa o valor da métrica selecionada."
        action={
          <div className="flex items-center gap-1 text-xs">
            <button
              onClick={() => setHeatMode("roas")}
              className={`px-2 h-7 rounded-md ${heatMode === "roas" ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >ROAS</button>
            <button
              onClick={() => setHeatMode("spend")}
              className={`px-2 h-7 rounded-md ${heatMode === "spend" ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >Gasto</button>
          </div>
        }
      >
        {heat.weeks.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sem dados para gerar o mapa.</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="inline-block min-w-full">
              <div className="grid gap-1" style={{ gridTemplateColumns: `auto repeat(7, minmax(40px, 1fr))` }}>
                <div />
                {WEEKDAYS.map((d) => (
                  <div key={d} className="text-[10px] text-muted-foreground text-center">{d}</div>
                ))}
                {heat.weeks.map((w, wi) => (
                  <>
                    <div key={`l-${wi}`} className="text-[10px] text-muted-foreground pr-2 self-center">{w.label}</div>
                    {w.cells.map((cell, di) => {
                      const intensity = heat.max > 0 ? cell.value / heat.max : 0;
                      const empty = !cell.date;
                      return (
                        <div
                          key={`c-${wi}-${di}`}
                          title={cell.date ? `${cell.date} — ${heatMode === "roas" ? `${cell.value.toFixed(2)}x ROAS` : currFmt(cell.value)}` : ""}
                          className="h-9 rounded flex items-center justify-center text-[10px] tabular-nums"
                          style={{
                            background: empty
                              ? "hsl(var(--muted) / 0.3)"
                              : `hsl(var(--primary) / ${0.1 + intensity * 0.85})`,
                            color: intensity > 0.5 ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))",
                          }}
                        >
                          {!empty && cell.value > 0 ? (heatMode === "roas" ? `${cell.value.toFixed(1)}` : `${(cell.value / 1000).toFixed(1)}k`) : ""}
                        </div>
                      );
                    })}
                  </>
                ))}
              </div>
            </div>
          </div>
        )}
      </Section>

      {/* ── 4. Spend × ROAS matrix ─────────────────────────── */}
      <Section
        title="4. Eficiência por Produto (Gasto × ROAS)"
        subtitle="Quadrantes ajudam a decidir: Escale, Pause, Invista mais ou Descarte."
      >
        <ResponsiveContainer width="100%" height={320}>
          <ScatterChart margin={{ top: 16, right: 24, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
            <XAxis
              type="number" dataKey="x" name="Gasto"
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={(v) => `R$${(v / 1000).toFixed(1)}k`}
              tickLine={false} axisLine={false}
            />
            <YAxis
              type="number" dataKey="y" name="ROAS"
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={(v) => `${v}x`}
              tickLine={false} axisLine={false} width={42}
            />
            <ZAxis type="number" dataKey="z" range={[40, 280]} />
            <ReferenceLine x={medianSpend} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
            <ReferenceLine y={roasGoal} stroke="#10b981" strokeDasharray="3 3" label={{ value: `Meta ${roasGoal}x`, position: "right", fill: "#10b981", fontSize: 10 }} />
            <RechartsTooltip
              cursor={{ strokeDasharray: "3 3" }}
              contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
              formatter={(value: number, name: string) => {
                if (name === "Gasto") return [currFmt(value), "Gasto"];
                if (name === "ROAS") return [`${value.toFixed(2)}x`, "ROAS"];
                return [value, name];
              }}
              labelFormatter={() => ""}
              content={({ active, payload }) => {
                if (!active || !payload?.[0]?.payload) return null;
                const p = payload[0].payload as { title: string; item_id: string; x: number; y: number };
                return (
                  <div className="rounded-md border border-border bg-card p-2 text-xs shadow-sm max-w-[260px]">
                    <p className="font-medium leading-tight line-clamp-2">{p.title}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{p.item_id}</p>
                    <div className="mt-1 flex justify-between gap-3 tabular-nums">
                      <span>Gasto: {currFmt(p.x)}</span>
                      <span>ROAS: {p.y.toFixed(2)}x</span>
                    </div>
                  </div>
                );
              }}
            />
            <Scatter data={scatterData} fill="hsl(var(--primary))" fillOpacity={0.65} />
          </ScatterChart>
        </ResponsiveContainer>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-[11px]">
          <div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2 py-1.5">
            <p className="font-semibold text-emerald-700">↑ Gasto · ↑ ROAS</p>
            <p className="text-muted-foreground">Escale</p>
          </div>
          <div className="rounded-md bg-red-500/10 border border-red-500/20 px-2 py-1.5">
            <p className="font-semibold text-red-700">↑ Gasto · ↓ ROAS</p>
            <p className="text-muted-foreground">Pause / Revise</p>
          </div>
          <div className="rounded-md bg-primary/10 border border-primary/20 px-2 py-1.5">
            <p className="font-semibold text-primary">↓ Gasto · ↑ ROAS</p>
            <p className="text-muted-foreground">Invista mais</p>
          </div>
          <div className="rounded-md bg-muted/60 border border-border px-2 py-1.5">
            <p className="font-semibold text-muted-foreground">↓ Gasto · ↓ ROAS</p>
            <p className="text-muted-foreground">Descarte</p>
          </div>
        </div>
      </Section>

      {/* ── 5. Campaign comparison ─────────────────────────── */}
      <Section
        title="5. Comparativo de Campanhas vs Período Anterior"
        subtitle="Variação de Gasto, ROAS e Pedidos. Ranking pelo maior ganho combinado."
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
                  <td className="px-3 py-2 max-w-[260px] truncate font-medium">{c.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{currFmt(c.spend)}</td>
                  <td className="px-3 py-2 text-right"><DeltaBadge value={c.deltaSpend} invert /></td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.roas.toFixed(2)}x</td>
                  <td className="px-3 py-2 text-right"><DeltaBadge value={c.deltaRoas} /></td>
                  <td className="px-3 py-2 text-right tabular-nums">{numFmt(c.orders)}</td>
                  <td className="px-3 py-2 text-right"><DeltaBadge value={c.deltaOrders} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── 6. Funnel per campaign ─────────────────────────── */}
      <Section
        title="6. Funil de Eficiência por Campanha"
        subtitle="Top 10 por impressões. CTR e CVR mostram onde está o gargalo."
      >
        <div className="space-y-3">
          {funnelData.length === 0 && (
            <p className="text-xs text-muted-foreground">Sem campanhas com impressões no período.</p>
          )}
          {funnelData.map((c) => (
            <div key={c.fullName} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium truncate max-w-[60%]" title={c.fullName}>{c.name}</span>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
                  <span>CTR <strong className="text-foreground">{pctFmt(c.ctr)}</strong></span>
                  <span>CVR <strong className="text-foreground">{pctFmt(c.cvr)}</strong></span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1">
                <div className="h-5 rounded-sm bg-indigo-500/70 flex items-center px-2 text-[10px] text-white tabular-nums">
                  {numFmt(c.impressions)} impr.
                </div>
                <div className="h-5 rounded-sm bg-violet-500/70 flex items-center px-2 text-[10px] text-white tabular-nums" style={{ width: `${Math.max(8, c.clicksPct)}%` }}>
                  {numFmt(c.clicks)} cliq.
                </div>
                <div className="h-5 rounded-sm bg-fuchsia-500/70 flex items-center px-2 text-[10px] text-white tabular-nums" style={{ width: `${Math.max(8, c.ordersPct)}%` }}>
                  {numFmt(c.orders)} ped.
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── 7. CPA over time ───────────────────────────────── */}
      <Section
        title="7. Custo por Pedido (CPA) ao Longo do Tempo"
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
            <Badge className={avgCpa < avgTicket * 0.5 ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" : avgCpa < avgTicket ? "bg-amber-500/15 text-amber-700 border-amber-500/30" : "bg-red-500/15 text-red-700 border-red-500/30"}>
              {avgCpa < avgTicket * 0.5
                ? "Saudável: CPA representa menos da metade do ticket médio."
                : avgCpa < avgTicket
                  ? "Atenção: CPA acima de 50% do ticket médio."
                  : "Alerta: CPA superior ao ticket médio — você gasta mais do que vende."}
            </Badge>
          </div>
        )}
      </Section>
    </div>
  );
}