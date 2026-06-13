import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from "recharts";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Star, ThumbsUp, ThumbsDown, Minus, ShieldCheck,
  Clock, MessageSquare, Plug, RefreshCw, Check,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { KPICard } from "@/components/dashboard/KPICard";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useMLReputation } from "@/hooks/useMLReputation";
import {
  type ReputationLevel,
  type FeedbackEntry,
} from "@/types/reputacao";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const pctFmt = (v: number | null) => v != null ? `${v.toFixed(1)}%` : "—";

/**
 * Derives daily feedback chart data from real feedback dates (D-07).
 * Groups feedbacks by date (substring(0,10)), sorted ascending.
 * Empty feedbacks[] → empty series (valid — never fabricated per D-07).
 */
function buildDailyFeedback(feedbacks: FeedbackEntry[]): Array<{ date: string; Positivo: number; Negativo: number }> {
  const byDay = new Map<string, { positive: number; negative: number }>();
  for (const f of feedbacks) {
    if (!f.date) continue;
    const day = f.date.substring(0, 10);
    const cur = byDay.get(day) ?? { positive: 0, negative: 0 };
    if (f.rating === "positive") cur.positive++;
    else cur.negative++;
    byDay.set(day, cur);
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({
      date: (() => {
        try { return format(parseISO(date), "dd/MM", { locale: ptBR }); }
        catch { return date; }
      })(),
      Positivo: counts.positive,
      Negativo: counts.negative,
    }));
}

// ─── Level config ─────────────────────────────────────────────────────────────

const LEVEL_CONFIG: Record<ReputationLevel, { label: string; color: string; bg: string; border: string }> = {
  green:       { label: "Verde",       color: "text-emerald-600", bg: "bg-emerald-500/15", border: "border-emerald-500/30" },
  light_green: { label: "Verde Claro", color: "text-teal-600",    bg: "bg-teal-500/15",    border: "border-teal-500/30"   },
  yellow:      { label: "Amarelo",     color: "text-amber-600",   bg: "bg-amber-500/15",   border: "border-amber-500/30"  },
  orange:      { label: "Laranja",     color: "text-orange-600",  bg: "bg-orange-500/15",  border: "border-orange-500/30" },
  red:         { label: "Vermelho",    color: "text-red-600",     bg: "bg-red-500/15",     border: "border-red-500/30"    },
};

const LEVEL_STEPS: ReputationLevel[] = ["red", "orange", "yellow", "light_green", "green"];

function ratingBadge(r: FeedbackEntry["rating"]) {
  if (r === "positive") return (
    <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 gap-1">
      <ThumbsUp className="w-3 h-3" /> Positivo
    </Badge>
  );
  if (r === "neutral") return (
    <Badge className="bg-gray-500/15 text-gray-500 border-gray-500/30 gap-1">
      <Minus className="w-3 h-3" /> Neutro
    </Badge>
  );
  return (
    <Badge className="bg-red-500/15 text-red-600 border-red-500/30 gap-1">
      <ThumbsDown className="w-3 h-3" /> Negativo
    </Badge>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function NotConnected() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Plug className="w-16 h-16 text-muted-foreground/40" />
        <h2 className="text-xl font-semibold">Mercado Livre não conectado</h2>
        <p className="text-muted-foreground text-sm">Conecte sua conta para acessar os dados de reputação.</p>
        <Button asChild><Link to="/integracoes">Conectar conta</Link></Button>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function MLReputacao() {
  const { stores } = useMLStore();
  const { reputation: realRep, feedbacks, isRealData, loading: repLoading, refresh } = useMLReputation();

  const connected = stores.length > 0;

  // Normalize reputation values for display (multiply rates by 100 if they are fractions)
  const reputation = useMemo(() => {
    if (!realRep) return null;
    return {
      level: realRep.level,
      levelLabel: realRep.levelLabel,
      transactions_completed: realRep.transactions_completed,
      positive_rating: realRep.positive_rating !== null ? realRep.positive_rating * 100 : null,
      neutral_rating: realRep.neutral_rating !== null ? realRep.neutral_rating * 100 : null,
      negative_rating: realRep.negative_rating !== null ? realRep.negative_rating * 100 : null,
      claims_rate: realRep.claims_rate !== null ? realRep.claims_rate * 100 : null,
      delayed_handling_rate: realRep.delayed_handling_rate !== null ? realRep.delayed_handling_rate * 100 : null,
      cancellation_rate: realRep.cancellation_rate !== null ? realRep.cancellation_rate * 100 : null,
      is_power_seller: !!realRep.power_seller_status,
      power_seller_status: realRep.power_seller_status,
    };
  }, [realRep]);

  // Derive daily chart from real feedback dates (D-07)
  const chartData = useMemo(() => buildDailyFeedback(feedbacks), [feedbacks]);

  const levelCfg = reputation ? LEVEL_CONFIG[reputation.level] : LEVEL_CONFIG["3_yellow" as ReputationLevel] ?? LEVEL_CONFIG.yellow;
  const levelIdx = reputation ? LEVEL_STEPS.indexOf(reputation.level) : -1;

  if (!connected) return <NotConnected />;

  return (
    <div className="space-y-6">

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <MLPageHeader title="Reputação" lastUpdated={null} />
          {reputation && (
            <Badge className={`${levelCfg.bg} ${levelCfg.color} ${levelCfg.border} text-sm font-semibold px-3 py-1`}>
              <Star className="w-3.5 h-3.5 mr-1" /> {levelCfg.label}
            </Badge>
          )}
          {reputation?.is_power_seller && (
            <Badge className="bg-violet-500/15 text-violet-600 border-violet-500/30 gap-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              {reputation.power_seller_status === "platinum" ? "MercadoLíder Platinum" :
               reputation.power_seller_status === "gold" ? "MercadoLíder Gold" : "MercadoLíder"}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isRealData ? (
            <Badge variant="outline" className="text-xs gap-1.5 text-emerald-600 border-emerald-500/30 cursor-default">
              <Check className="w-3 h-3" /> Dados reais
            </Badge>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            disabled={repLoading}
            onClick={async () => { await refresh(); }}
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${repLoading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Reputation thermometer */}
      {reputation && (
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-muted-foreground mb-3 font-medium uppercase tracking-wide">Termômetro de reputação</p>
            <div className="flex gap-1.5">
              {LEVEL_STEPS.map((lvl, i) => {
                const cfg = LEVEL_CONFIG[lvl];
                const isActive = i <= levelIdx;
                const isCurrent = lvl === reputation.level;
                return (
                  <Tooltip key={lvl}>
                    <TooltipTrigger asChild>
                      <div
                        className={`flex-1 h-5 rounded-md transition-all cursor-default ${
                          isCurrent
                            ? `${cfg.bg} border-2 ${cfg.border} shadow-sm`
                            : isActive
                            ? `${cfg.bg} border ${cfg.border} opacity-60`
                            : "bg-muted border border-border opacity-30"
                        }`}
                      />
                    </TooltipTrigger>
                    <TooltipContent>{cfg.label}{isCurrent ? " (atual)" : ""}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-[10px] text-muted-foreground">Vermelho</span>
              <span className="text-[10px] text-muted-foreground">Verde</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPIs */}
      {reputation && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            title="Avaliações positivas"
            value={pctFmt(reputation.positive_rating)}
            variant="minimal"
            iconClassName="bg-success/10 text-success"
            size="compact"
            icon={<ThumbsUp className="w-4 h-4" />}
            subtitle={`${reputation.transactions_completed.toLocaleString("pt-BR")} transações`}
          />
          <KPICard
            title="Avaliações negativas"
            value={pctFmt(reputation.negative_rating)}
            variant="minimal"
            iconClassName={(reputation.negative_rating ?? 0) < 2 ? "bg-[hsl(25,95%,53%)]/10 text-[hsl(25,95%,53%)]" : "bg-destructive/10 text-destructive"}
            size="compact"
            icon={<ThumbsDown className="w-4 h-4" />}
            subtitle="Últimas transações"
          />
          <KPICard
            title="Taxa de reclamações"
            value={pctFmt(reputation.claims_rate)}
            variant="minimal"
            iconClassName={(reputation.claims_rate ?? 0) < 1 ? "bg-success/10 text-success" : "bg-[hsl(25,95%,53%)]/10 text-[hsl(25,95%,53%)]"}
            size="compact"
            icon={<MessageSquare className="w-4 h-4" />}
            subtitle="Meta ML: abaixo de 1%"
          />
          <KPICard
            title="Transações"
            value={reputation.transactions_completed.toLocaleString("pt-BR")}
            variant="minimal"
            iconClassName="bg-primary/10 text-primary"
            size="compact"
            icon={<Clock className="w-4 h-4" />}
            subtitle="Completas"
          />
        </div>
      )}

      {/* Rates breakdown */}
      {reputation && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: "Cancelamentos", value: reputation.cancellation_rate, max: 2 },
            { label: "Entrega atrasada", value: reputation.delayed_handling_rate, max: 5 },
            { label: "Avaliações neutras", value: reputation.neutral_rating, max: 5 },
          ].map(({ label, value, max }) => (
            <Card key={label}>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground font-medium">{label}</p>
                <p className="text-2xl font-bold mt-1">{pctFmt(value)}</p>
                {value != null && (
                  <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full ${value / max < 0.5 ? "bg-emerald-500" : value / max < 0.8 ? "bg-amber-500" : "bg-red-500"}`}
                      style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
                    />
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground mt-1">Meta: abaixo de {max}%</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Daily feedback chart — derived from real dates (D-07) */}
      <Card>
        <div className="px-4 pt-4 pb-3">
          <span className="text-sm font-medium text-foreground">Avaliações — histórico real</span>
        </div>
        <CardContent className="px-4 pb-2 pt-0">
          {repLoading ? (
            <div className="flex items-center justify-center h-[220px] text-muted-foreground">
              <RefreshCw className="w-6 h-6 animate-spin opacity-30" />
            </div>
          ) : chartData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[220px] text-muted-foreground gap-2">
              <p className="text-sm">Nenhuma avaliação no período</p>
              <p className="text-xs">Os feedbacks aparecerão quando disponíveis na API</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} barSize={8}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} />
                <RechartsTooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                />
                <Bar dataKey="Positivo" fill="hsl(var(--success))" radius={[2, 2, 0, 0]} />
                <Bar dataKey="Negativo" fill="hsl(var(--destructive))" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Feedback list — real entries */}
      <Card>
        <div className="px-4 pt-4 pb-3">
          <span className="text-sm font-medium text-foreground">Últimas avaliações</span>
        </div>
        <CardContent className="p-0">
          {feedbacks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
              <p className="text-sm">Nenhuma avaliação disponível</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {feedbacks.slice(0, 10).map((entry, idx) => (
                <div key={entry.id || idx} className="px-6 py-3 flex items-start gap-3">
                  <div className="flex-shrink-0 pt-0.5">{ratingBadge(entry.rating)}</div>
                  <div className="flex-1 min-w-0">
                    {/* Comment rendered as plain text — no dangerouslySetInnerHTML (T-42-08) */}
                    <p className="text-sm text-foreground">{entry.comment || "—"}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{entry.item_title || "—"}</p>
                  </div>
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    {entry.date ? (() => {
                      try { return format(parseISO(entry.date), "dd/MM/yy"); }
                      catch { return entry.date.substring(0, 10); }
                    })() : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
