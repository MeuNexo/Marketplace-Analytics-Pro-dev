import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatBRL } from "@/lib/pricing/calculator";
import type { AnalysisSnapshot } from "@/hooks/useAnalysisSnapshots";
import { ELASTICITY_BADGE } from "@/lib/analysis/elasticityConfig";

const PRICE_TILES = [
  { key: "priceGmv" as const,     label: "Preço GMV",     accent: "bg-emerald-500/10 border-emerald-500/20" },
  { key: "priceNeutral" as const, label: "Preço Neutro",  accent: "bg-blue-500/10 border-blue-500/20" },
  { key: "priceMargin" as const,  label: "Preço Margem",  accent: "bg-amber-500/10 border-amber-500/20" },
];

export function AnalysisProductCard({ snapshot }: { snapshot: AnalysisSnapshot }) {
  const pct = snapshot.elasticityPct.toFixed(2).replace(".", ",");
  const badge = ELASTICITY_BADGE[snapshot.elasticityClass];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-foreground leading-5 truncate">
          {snapshot.productTitle}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {snapshot.brand ?? "Sem marca"}
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {PRICE_TILES.map((tile) => (
            <div key={tile.key} className={`rounded-md border p-3 ${tile.accent}`}>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                {tile.label}
              </p>
              <p className="text-base font-semibold tabular-nums text-foreground">
                {formatBRL(snapshot[tile.key])}
              </p>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <Badge variant="outline" className={badge.className}>
            Elasticidade {badge.label}
          </Badge>
          <p className="text-xs text-muted-foreground leading-relaxed">
            A cada R$1,00 de subida a partir de {formatBRL(snapshot.priceGmv)}, perde
            aproximadamente {pct}% em volume.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
