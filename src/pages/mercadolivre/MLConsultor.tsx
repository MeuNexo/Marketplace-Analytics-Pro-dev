import { Link } from "react-router-dom";
import { DIFAL_ESTIMATIVA_LABEL } from "@/lib/mcoLinhaCenarios";
import { useState } from "react";
import { XCircle, AlertTriangle, Info, Activity, Loader2, X, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useConsultorInsights } from "@/hooks/useConsultorInsights";
import type { InsightRow, ScoreBand } from "@/hooks/useConsultorInsights";

// ─── Score band helpers (D-10) ────────────────────────────────────────────────

function scoreLabelText(band: ScoreBand | null): string {
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

function scoreTextColor(band: ScoreBand | null): string {
  if (band === "healthy") return "text-[hsl(var(--success))]";
  if (band === "attention") return "text-[hsl(var(--warning))]";
  return "text-destructive";
}

// ─── Severity icon ────────────────────────────────────────────────────────────

function SeverityIcon({ severity, className }: { severity: string; className?: string }) {
  if (severity === "critical")
    return <XCircle className={cn("h-4 w-4 shrink-0 text-destructive", className)} />;
  if (severity === "high")
    return <AlertTriangle className={cn("h-4 w-4 shrink-0 text-[hsl(var(--warning))]", className)} />;
  return <Info className={cn("h-4 w-4 shrink-0 text-muted-foreground", className)} />;
}

function severityBadgeClass(severity: string): string {
  if (severity === "critical") return "bg-destructive/10 text-destructive border-destructive/30";
  if (severity === "high") return "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/30";
  return "bg-muted/30 text-muted-foreground border-border/40";
}

function severityLabel(severity: string): string {
  if (severity === "critical") return "Crítico";
  if (severity === "high") return "Alto";
  return "Médio";
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

// ─── Single insight card ──────────────────────────────────────────────────────

interface InsightCardProps {
  insight: InsightRow;
  onDismiss: (id: string) => void;
  onExplain?: (id: string) => Promise<string>;
}

function InsightCard({ insight, onDismiss, onExplain }: InsightCardProps) {
  const impact = impactLabel(insight.impact_brl);
  const [explaining, setExplaining] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);

  const handleExplain = async () => {
    if (!onExplain || explaining) return;
    setExplaining(true);
    try {
      const text = await onExplain(insight.id);
      setExplanation(text || null);
      if (!text) toast.info("Explicação indisponível no momento.");
    } catch {
      toast.error("Não foi possível explicar agora. Tente novamente.");
    } finally {
      setExplaining(false);
    }
  };

  return (
    <Card className="border-border/50">
      <CardContent className="pt-4 pb-3 flex flex-col gap-2">
        {/* Header: severity badge + title + dismiss */}
        <div className="flex items-start gap-2">
          <SeverityIcon severity={insight.severity} className="mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                variant="outline"
                className={cn("text-[10px] px-1.5 py-0 leading-4", severityBadgeClass(insight.severity))}
              >
                {severityLabel(insight.severity)}
              </Badge>
              <span className="text-xs text-muted-foreground">{insight.category}</span>
            </div>
            <p className="text-sm font-medium mt-1 leading-snug">{insight.title}</p>
          </div>
          <button
            onClick={() => onDismiss(insight.id)}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors mt-0.5"
            aria-label="Dispensar alerta"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Body: "por que importa" (CONSUL-03) */}
        <p className="text-xs text-muted-foreground leading-relaxed">{insight.body}</p>

        {/* Impact (D-14) */}
        {impact && (
          <p className="text-xs font-medium text-destructive">{impact}</p>
        )}

        {/* Explicação sob demanda (camada LLM, Plan 53) */}
        {explanation && (
          <p className="text-xs leading-relaxed text-foreground/90 border-l-2 border-primary/30 pl-2">
            {explanation}
          </p>
        )}

        {/* Action: "como resolver" — deep-link para a página certa (D-19) + Explicar */}
        <div className="pt-1 flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" asChild className="h-7 text-xs gap-1.5">
            <Link to={insight.action_href}>{insight.action_label}</Link>
          </Button>
          {onExplain && !explanation && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleExplain}
              disabled={explaining}
              className="h-7 text-xs gap-1.5 text-primary hover:text-primary"
            >
              {explaining ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {explaining ? "Explicando…" : "Explicar"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Pillar breakdown row ─────────────────────────────────────────────────────

function PillarRow({ label, score }: { label: string; score: number }) {
  const band: ScoreBand = score >= 75 ? "healthy" : score >= 50 ? "attention" : "critical";
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground w-24 shrink-0">{label}</span>
      <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            band === "healthy" ? "bg-[hsl(var(--success))]" : band === "attention" ? "bg-[hsl(var(--warning))]" : "bg-destructive",
          )}
          style={{ width: `${Math.min(Math.max(score, 0), 100)}%` }}
        />
      </div>
      <span className={cn("w-8 text-right font-medium tabular-nums", scoreTextColor(band))}>
        {score}
      </span>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MLConsultor() {
  const { insights, score, scoreDelta, scoreBand, pillars, loading, syncing, dismiss, explain, summaryDisabled } =
    useConsultorInsights();

  const trendArrow =
    scoreDelta == null
      ? null
      : scoreDelta > 0
      ? "▲"
      : scoreDelta < 0
      ? "▼"
      : null;
  const trendColor =
    scoreDelta != null && scoreDelta > 0
      ? "text-[hsl(var(--success))]"
      : scoreDelta != null && scoreDelta < 0
      ? "text-destructive"
      : "";

  return (
    <div className="space-y-5">
      {/* ── Score header (D-10) ──────────────────────────────────────────── */}
      <Card className="border-primary/20 shadow-[var(--shadow-glow)]">
        <CardContent className="py-4 flex flex-col gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Activity className="h-6 w-6 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-base font-semibold">Saúde do negócio</p>
              <p className="text-xs text-muted-foreground">Diagnóstico geral da sua operação</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {trendArrow && (
                <span className={cn("text-sm font-medium", trendColor)}>
                  {trendArrow}
                  {scoreDelta != null && Math.abs(scoreDelta) > 0 && (
                    <span className="ml-0.5 text-xs">{Math.abs(scoreDelta)} pts</span>
                  )}
                </span>
              )}
              <Badge
                variant="outline"
                className={cn("text-sm font-bold px-3 py-1", scoreBandClasses(scoreBand))}
              >
                {score != null ? score : "—"} — {scoreLabelText(scoreBand)}
              </Badge>
              {(loading || syncing) && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>

          {/* Pillar breakdown (D-09) */}
          {pillars && (
            <div className="flex flex-col gap-2 pt-1 border-t border-border/40">
              <p className="text-xs font-medium text-muted-foreground mb-1">Pontuação por pilar</p>
              <PillarRow label="Margem (30%)" score={pillars.margin} />
              {/* [222-15-R2] DECLARAÇÃO DE RÉGUA — não é um segundo cenário.
                  Um score de 0 a 100 não tem dois cenários; o que ele pode e
                  deve dizer é EM QUAL régua foi apurado. Os limiares de alerta
                  continuam avaliados sobre a margem SEM DIFAL: trocar a base de
                  um alerta é decisão de negócio que ninguém tomou (dívida
                  nomeada no resumo do plano). */}
              <p className="text-[11px] text-muted-foreground pl-1 -mt-1">
                O score e os alertas de margem usam a margem{" "}
                <strong>sem DIFAL</strong>. O cenário com DIFAL é{" "}
                <strong>{DIFAL_ESTIMATIVA_LABEL}</strong> e aparece ao lado do
                primeiro em{" "}
                <Link to="/resultado" className="underline">Resultado</Link>,{" "}
                <Link to="/publicidade" className="underline">Publicidade</Link> e{" "}
                <Link to="/anuncios" className="underline">Anúncios</Link>.
              </p>
              <PillarRow label="Ads (25%)" score={pillars.ads} />
              <PillarRow label="Estoque (20%)" score={pillars.estoque} />
              <PillarRow label="Reputação (15%)" score={pillars.reputacao} />
              <PillarRow label="Completude (10%)" score={pillars.completude} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Insights list ─────────────────────────────────────────────────── */}
      <div>
        <CardHeader className="px-0 pt-0 pb-3">
          <CardTitle className="text-base">
            {insights.length > 0
              ? `${insights.length} alerta${insights.length !== 1 ? "s" : ""} ativo${insights.length !== 1 ? "s" : ""}`
              : "Alertas"}
          </CardTitle>
        </CardHeader>

        {loading || syncing ? (
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="border-border/50">
                <CardContent className="py-4 flex items-center gap-3">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-muted rounded animate-pulse w-3/4" />
                    <div className="h-2 bg-muted rounded animate-pulse w-full" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : insights.length === 0 ? (
          <Card className="border-dashed border-border/50">
            <CardContent className="py-8 text-center">
              <Activity className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm font-medium">Nenhum alerta no momento</p>
              <p className="text-xs text-muted-foreground mt-1">
                Sua operação está sem pontos críticos identificados. O consultor roda diariamente.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {insights.map((insight) => (
              <InsightCard key={insight.id} insight={insight} onDismiss={dismiss} onExplain={summaryDisabled ? undefined : explain} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
