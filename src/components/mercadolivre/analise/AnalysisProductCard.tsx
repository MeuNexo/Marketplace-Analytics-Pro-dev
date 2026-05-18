import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing/calculator";
import type { AnalysisSnapshot } from "@/hooks/useAnalysisSnapshots";
import type { ElasticityClass } from "@/lib/analysis/types";

// ── Elasticity badge config ───────────────────────────────────────────────────

const ELASTICITY_BADGE: Record<ElasticityClass, { label: string; className: string }> = {
  baixa:   { label: "Baixa",   className: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" },
  media:   { label: "Média",   className: "bg-blue-500/15    text-blue-700    border-blue-500/30"    },
  alta:    { label: "Alta",    className: "bg-amber-500/15   text-amber-700   border-amber-500/30"   },
  extrema: { label: "Extrema", className: "bg-red-500/15     text-red-700     border-red-500/30"     },
};

// ── Component ─────────────────────────────────────────────────────────────────

export function AnalysisProductCard({ snapshot }: { snapshot: AnalysisSnapshot }) {
  const pct = snapshot.elasticityPct.toFixed(2).replace(".", ",");
  const badge = ELASTICITY_BADGE[snapshot.elasticityClass];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold leading-5">
          {snapshot.productTitle}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {snapshot.brand ?? "Sem marca"}
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Three price boxes */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Preço GMV */}
          <div className="rounded-md border border-l-4 border-l-emerald-500 p-3">
            <p className="text-xs uppercase text-muted-foreground tracking-wide mb-1">
              Preço GMV
            </p>
            <p className={cn("text-lg font-semibold tabular-nums", "text-emerald-700")}>
              {formatBRL(snapshot.priceGmv)}
            </p>
          </div>

          {/* Preço Neutro */}
          <div className="rounded-md border border-l-4 border-l-blue-500 p-3">
            <p className="text-xs uppercase text-muted-foreground tracking-wide mb-1">
              Preço Neutro
            </p>
            <p className={cn("text-lg font-semibold tabular-nums", "text-blue-700")}>
              {formatBRL(snapshot.priceNeutral)}
            </p>
          </div>

          {/* Preço Margem */}
          <div className="rounded-md border border-l-4 border-l-amber-500 p-3">
            <p className="text-xs uppercase text-muted-foreground tracking-wide mb-1">
              Preço Margem
            </p>
            <p className={cn("text-lg font-semibold tabular-nums", "text-amber-700")}>
              {formatBRL(snapshot.priceMargin)}
            </p>
          </div>
        </div>

        {/* Elasticity info */}
        <div className="space-y-2">
          <Badge variant="outline" className={cn(badge.className)}>
            Elasticidade {badge.label}
          </Badge>
          <p className="text-xs text-muted-foreground leading-relaxed">
            A cada R$1,00 de subida a partir de {formatBRL(snapshot.priceGmv)}, perde
            aproximadamente {pct}% em volume
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
