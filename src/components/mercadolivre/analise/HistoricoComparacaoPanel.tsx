import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalysisSnapshot } from "@/hooks/useAnalysisSnapshots";
import { ELASTICITY_BADGE } from "@/lib/analysis/elasticityConfig";
import { formatBRL } from "@/lib/pricing/calculator";

// ── Helpers ───────────────────────────────────────────────────────────────────

interface DiffResult {
  label: string;
  className: string;
}

function priceDiff(a: number, b: number, kind: "currency" | "percent"): DiffResult {
  const d = b - a;
  if (d === 0) return { label: "=", className: "text-muted-foreground" };
  const sign = d > 0 ? "↑" : "↓";
  const abs = Math.abs(d);
  const formatted =
    kind === "currency"
      ? `${sign} ${formatBRL(abs)}`
      : `${sign} ${abs.toFixed(2).replace(".", ",")}%`;
  const className = d > 0 ? "text-emerald-600" : "text-red-600";
  return { label: formatted, className };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function HistoricoComparacaoPanel({
  snapshots,
}: {
  snapshots: [AnalysisSnapshot, AnalysisSnapshot];
}) {
  const [a, b] = snapshots;

  const gmvDiff = priceDiff(a.priceGmv, b.priceGmv, "currency");
  const neutralDiff = priceDiff(a.priceNeutral, b.priceNeutral, "currency");
  const marginDiff = priceDiff(a.priceMargin, b.priceMargin, "currency");
  const elasticityDiff = priceDiff(a.elasticityPct, b.elasticityPct, "percent");

  const badgeA = ELASTICITY_BADGE[a.elasticityClass];
  const badgeB = ELASTICITY_BADGE[b.elasticityClass];
  const classificationSameOrDiff =
    a.elasticityClass === b.elasticityClass ? "=" : "→";

  return (
    <Card>
      <CardHeader className="px-4 pt-3 pb-2">
        <CardTitle className="text-sm font-medium">Comparação</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="grid grid-cols-[auto_1fr_auto_1fr] gap-x-4 gap-y-3 items-center text-sm">
          {/* Header row */}
          <div className="text-xs text-muted-foreground font-medium" />
          <div className="text-xs text-muted-foreground font-medium text-center">Análise A (anterior)</div>
          <div className="text-xs text-muted-foreground font-medium text-center">Variação</div>
          <div className="text-xs text-muted-foreground font-medium text-center">Análise B (recente)</div>

          {/* Período */}
          <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
            Período analisado
          </span>
          <span className="text-xs tabular-nums text-center">
            {a.periodStart} → {a.periodEnd}
          </span>
          <span className="text-xs text-muted-foreground text-center">—</span>
          <span className="text-xs tabular-nums text-center">
            {b.periodStart} → {b.periodEnd}
          </span>

          {/* Preço GMV */}
          <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
            Preço GMV
          </span>
          <span className="text-xs tabular-nums text-center">{formatBRL(a.priceGmv)}</span>
          <span className={`text-xs tabular-nums text-center ${gmvDiff.className}`}>
            {gmvDiff.label}
          </span>
          <span className="text-xs tabular-nums text-center">{formatBRL(b.priceGmv)}</span>

          {/* Preço Neutro */}
          <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
            Preço Neutro
          </span>
          <span className="text-xs tabular-nums text-center">{formatBRL(a.priceNeutral)}</span>
          <span className={`text-xs tabular-nums text-center ${neutralDiff.className}`}>
            {neutralDiff.label}
          </span>
          <span className="text-xs tabular-nums text-center">{formatBRL(b.priceNeutral)}</span>

          {/* Preço Margem */}
          <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
            Preço Margem
          </span>
          <span className="text-xs tabular-nums text-center">{formatBRL(a.priceMargin)}</span>
          <span className={`text-xs tabular-nums text-center ${marginDiff.className}`}>
            {marginDiff.label}
          </span>
          <span className="text-xs tabular-nums text-center">{formatBRL(b.priceMargin)}</span>

          {/* Elasticidade */}
          <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
            Elasticidade (%)
          </span>
          <span className="text-xs tabular-nums text-center">
            {a.elasticityPct.toFixed(2).replace(".", ",")}%
          </span>
          <span className={`text-xs tabular-nums text-center ${elasticityDiff.className}`}>
            {elasticityDiff.label}
          </span>
          <span className="text-xs tabular-nums text-center">
            {b.elasticityPct.toFixed(2).replace(".", ",")}%
          </span>

          {/* Classificação */}
          <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
            Classificação
          </span>
          <div className="flex justify-center">
            <Badge variant="outline" className={badgeA.className}>
              {badgeA.label}
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground text-center">
            {classificationSameOrDiff}
          </span>
          <div className="flex justify-center">
            <Badge variant="outline" className={badgeB.className}>
              {badgeB.label}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
