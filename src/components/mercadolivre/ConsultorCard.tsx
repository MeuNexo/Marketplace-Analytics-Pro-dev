import { XCircle, AlertTriangle, Info, ArrowRight, Activity, X, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { InsightRow, ScoreBand } from "@/hooks/useConsultorInsights";

// ─── Props ────────────────────────────────────────────────────────────────────

interface ConsultorCardProps {
  insights: InsightRow[];
  score: number | null;
  scoreDelta: number | null;
  scoreBand: ScoreBand | null;
  syncing: boolean;
  onDismiss: (id: string) => void;
  /** Explicação sob demanda por insight (camada LLM, Plan 53). Opcional: sem ela o botão não aparece. */
  onExplain?: (id: string) => Promise<string>;
}

// ─── Score band helpers (D-10) ────────────────────────────────────────────────

function scoreLabel(band: ScoreBand | null): string {
  if (band === "healthy") return "Saudável";
  if (band === "attention") return "Atenção";
  if (band === "critical") return "Crítico";
  return "—";
}

function scoreBandClasses(band: ScoreBand | null): string {
  if (band === "healthy")
    return "bg-[hsl(var(--success))/10] text-[hsl(var(--success))] border-[hsl(var(--success))/30]";
  if (band === "attention")
    return "bg-[hsl(var(--warning))/10] text-[hsl(var(--warning))] border-[hsl(var(--warning))/30]";
  return "bg-destructive/10 text-destructive border-destructive/30";
}

// ─── Severity icon (D-14 / D-21) ─────────────────────────────────────────────

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "critical")
    return <XCircle className="h-4 w-4 shrink-0 text-destructive" />;
  if (severity === "high")
    return <AlertTriangle className="h-4 w-4 shrink-0 text-[hsl(var(--warning))]" />;
  return <Info className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

// ─── Impact label (D-14: framing de perda) ────────────────────────────────────

function impactLabel(impact_brl: number | null): string | null {
  if (impact_brl == null) return null;
  const formatted = Math.abs(impact_brl).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return `Você está perdendo ~${formatted}/mês`;
}

// ─── Single insight row ────────────────────────────────────────────────────────

interface InsightItemProps {
  insight: InsightRow;
  onDismiss: (id: string) => void;
  onExplain?: (id: string) => Promise<string>;
}

function InsightItem({ insight, onDismiss, onExplain }: InsightItemProps) {
  const impact = impactLabel(insight.impact_brl);
  const [explaining, setExplaining] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);

  const handleExplain = async () => {
    if (!onExplain || explaining) return;
    setExplaining(true);
    try {
      const text = await onExplain(insight.id);
      // EF desligada/fallback retorna vazio → não mostra bloco LLM
      setExplanation(text || null);
      if (!text) toast.info("Explicação indisponível no momento.");
    } catch {
      toast.error("Não foi possível explicar agora. Tente novamente.");
    } finally {
      setExplaining(false);
    }
  };

  return (
    <div className="flex flex-col gap-1 py-1.5 border-t border-border/40 first:border-t-0">
      <div className="flex items-start gap-2.5">
        <SeverityIcon severity={insight.severity} />
        <div className="flex-1 min-w-0">
          <Link
            to={insight.action_href}
            className="text-sm font-medium leading-tight hover:underline line-clamp-2"
          >
            {insight.title}
          </Link>
          {impact && (
            <p className="text-xs text-destructive mt-0.5">{impact}</p>
          )}
        </div>
        <button
          onClick={() => onDismiss(insight.id)}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Dispensar alerta"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ── Explicar (camada LLM, Plan 53) ──────────────────────────────── */}
      {onExplain && (
        <div className="pl-6">
          {explanation ? (
            <p className="text-xs leading-relaxed text-muted-foreground">{explanation}</p>
          ) : (
            <button
              onClick={handleExplain}
              disabled={explaining}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-60"
            >
              {explaining ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {explaining ? "Explicando…" : "Explicar"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main card ────────────────────────────────────────────────────────────────

export function ConsultorCard({
  insights,
  score,
  scoreDelta,
  scoreBand,
  syncing,
  onDismiss,
  onExplain,
}: ConsultorCardProps) {
  // Top 3 insights (D-16)
  const topInsights = insights.slice(0, 3);

  // Trend arrow (D-12)
  const trendArrow =
    scoreDelta == null
      ? null
      : scoreDelta > 0
      ? "▲"
      : scoreDelta < 0
      ? "▼"
      : null;
  const trendColor =
    scoreDelta == null
      ? ""
      : scoreDelta > 0
      ? "text-[hsl(var(--success))]"
      : scoreDelta < 0
      ? "text-destructive"
      : "";

  return (
    <Card className="border-primary/20 shadow-[var(--shadow-glow)]">
      <CardContent className="flex flex-col gap-2 py-3">

        {/* ── Score line ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary shrink-0" />
            <span className="text-sm font-semibold">Saúde do negócio</span>
            {syncing && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {trendArrow && (
              <span className={cn("text-xs font-medium", trendColor)}>
                {trendArrow}
                {scoreDelta != null && Math.abs(scoreDelta) > 0 && (
                  <span className="ml-0.5">{Math.abs(scoreDelta)}</span>
                )}
              </span>
            )}
            <Badge
              variant="outline"
              className={cn(
                "text-xs font-semibold px-2 py-0.5",
                scoreBandClasses(scoreBand),
              )}
            >
              {score != null ? score : "—"} — {scoreLabel(scoreBand)}
            </Badge>
          </div>
        </div>

        {/* ── Insights list ────────────────────────────────────────────────── */}
        {syncing && topInsights.length === 0 ? (
          <p className="text-xs text-muted-foreground py-1">
            Analisando sua operação…
          </p>
        ) : topInsights.length === 0 ? (
          <p className="text-xs text-muted-foreground py-1">
            Tudo certo por aqui. Nenhum alerta ativo no momento.
          </p>
        ) : (
          <div className="flex flex-col">
            {topInsights.map((insight) => (
              <InsightItem key={insight.id} insight={insight} onDismiss={onDismiss} onExplain={onExplain} />
            ))}
          </div>
        )}

        {/* ── Ver todos ────────────────────────────────────────────────────── */}
        <div className="pt-1">
          <Button variant="ghost" size="sm" asChild className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground">
            <Link to="/consultor">
              Ver todos <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>

      </CardContent>
    </Card>
  );
}
