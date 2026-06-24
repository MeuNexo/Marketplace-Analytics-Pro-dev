import { Sparkles, RefreshCw, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useConsultorInsights } from "@/hooks/useConsultorInsights";

/**
 * ConsultorLLMSummary — resumo COO em prosa (camada LLM, Plan 53-02).
 *
 * Renderizado no topo de /vendas, ACIMA do ConsultorCard determinístico (v1).
 * É 100% aditivo: quando a EF está desligada (kill-switch) ou retorna fallback,
 * o componente não renderiza nada e o lojista vê só o consultor v1.
 *
 * - loading → Skeleton
 * - summaryDisabled → null (kill-switch, LLM-07)
 * - summaryFallback → null (cai pro v1, LLM-05 — guard server-side reprovou)
 * - normal → prosa COO (split por \n, sem markdown renderer — React escapa, T-53-11)
 *   + "Atualizar análise" (LLM-04) + badge "análise desatualizada" quando stale (LLM-06)
 */
export function ConsultorLLMSummary() {
  const {
    summaryText,
    summaryDisabled,
    summaryFallback,
    summaryStale,
    summaryLoading,
    summaryRefreshing,
    refreshSummary,
  } = useConsultorInsights();

  // Skeleton enquanto carrega a 1ª vez
  if (summaryLoading) {
    return (
      <Card className="border-primary/15">
        <CardContent className="flex flex-col gap-2 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary shrink-0" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-[85%]" />
        </CardContent>
      </Card>
    );
  }

  // Kill-switch ou fallback → não renderiza (lojista vê só o v1)
  if (summaryDisabled || summaryFallback || !summaryText) return null;

  const paragraphs = summaryText
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);

  const handleRefresh = async () => {
    try {
      await refreshSummary();
    } catch {
      toast.error("Não foi possível atualizar a análise agora. Tente novamente em instantes.");
    }
  };

  return (
    <Card className="border-primary/15 bg-primary/[0.02]">
      <CardContent className="flex flex-col gap-2 py-3">
        {/* ── Cabeçalho ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-semibold">Leitura do consultor</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={summaryRefreshing}
            className="h-7 px-2 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", summaryRefreshing && "animate-spin")} />
            Atualizar análise
          </Button>
        </div>

        {/* ── Badge desatualizada (LLM-06) ───────────────────────────────── */}
        {summaryStale && (
          <button
            onClick={handleRefresh}
            disabled={summaryRefreshing}
            className="flex items-center gap-1.5 self-start rounded-md bg-[hsl(var(--warning))/10] px-2 py-1 text-xs font-medium text-[hsl(var(--warning))] hover:bg-[hsl(var(--warning))/20] transition-colors"
          >
            <AlertCircle className="h-3.5 w-3.5" />
            análise desatualizada — clique para atualizar
          </button>
        )}

        {/* ── Prosa COO ──────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-1.5">
          {paragraphs.map((p, i) => (
            <p key={i} className="text-sm leading-relaxed text-foreground/90">
              {p}
            </p>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
