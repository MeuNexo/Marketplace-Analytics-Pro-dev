import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { formatBRL } from "@/lib/pricing/calculator";
import type { AnalysisSnapshot } from "@/hooks/useAnalysisSnapshots";
import type { PriceBucket } from "@/lib/analysis/types";
import { ELASTICITY_BADGE } from "@/lib/analysis/elasticityConfig";

const PRICE_TILES = [
  { key: "priceGmv" as const,     label: "Preço GMV",     accent: "bg-emerald-500/10 border-emerald-500/20" },
  { key: "priceNeutral" as const, label: "Preço Neutro",  accent: "bg-blue-500/10 border-blue-500/20" },
  { key: "priceMargin" as const,  label: "Preço Margem",  accent: "bg-amber-500/10 border-amber-500/20" },
];

function findUnitsAtPrice(curve: PriceBucket[], target: number): number | null {
  const t = Math.round(target * 100);
  const bucket = curve.find((b) => Math.round(b.price * 100) === t);
  return bucket ? bucket.units : null;
}

export function AnalysisProductCard({ snapshot }: { snapshot: AnalysisSnapshot }) {
  const badge = ELASTICITY_BADGE[snapshot.elasticityClass];

  const totalUnits = useMemo(
    () => snapshot.priceCurve.reduce((acc, b) => acc + b.units, 0),
    [snapshot.priceCurve],
  );

  const periodLabel = useMemo(() => {
    try {
      const from = format(new Date(snapshot.periodStart + "T12:00:00"), "dd/MM/yyyy");
      const to   = format(new Date(snapshot.periodEnd   + "T12:00:00"), "dd/MM/yyyy");
      return from === to ? from : `${from} – ${to}`;
    } catch {
      return `${snapshot.periodStart} – ${snapshot.periodEnd}`;
    }
  }, [snapshot.periodStart, snapshot.periodEnd]);

  const analysisDate = useMemo(() => {
    try {
      return format(new Date(snapshot.createdAt), "dd/MM/yyyy 'às' HH:mm");
    } catch {
      return snapshot.createdAt;
    }
  }, [snapshot.createdAt]);

  const [basePrice, setBasePrice] = useState<number>(snapshot.priceGmv);
  const [increment, setIncrement] = useState<number>(1);

  useEffect(() => {
    setBasePrice(snapshot.priceGmv);
    setIncrement(1);
  }, [snapshot.id, snapshot.priceGmv]);

  const perdaPct = Math.min(100, Math.max(0, snapshot.elasticityPct * increment));
  const unidadesPerdidas = Math.round((totalUnits * perdaPct) / 100);
  const perdaPctStr = perdaPct.toFixed(2).replace(".", ",");

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-1.5">
          <CardTitle className="text-sm font-medium text-foreground leading-5 truncate max-w-[75%]">
            {snapshot.productTitle}
          </CardTitle>
          <div className="flex flex-col items-end gap-0.5 shrink-0">
            <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
              {periodLabel}
            </span>
            <span className="text-[10px] text-muted-foreground/70">
              Analisado em {analysisDate}
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {PRICE_TILES.map((tile) => {
            const units = findUnitsAtPrice(snapshot.priceCurve, snapshot[tile.key]);
            return (
              <div key={tile.key} className={`rounded-md border p-3 ${tile.accent}`}>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                  {tile.label}
                </p>
                <p className="text-base font-semibold tabular-nums text-foreground">
                  {formatBRL(snapshot[tile.key])}
                </p>
                <p className="text-[11px] text-muted-foreground tabular-nums mt-1">
                  Vendidos: {units !== null ? `${units} un` : "—"}
                </p>
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground tabular-nums">
          Total vendido em <span className="font-medium text-foreground">{periodLabel}</span>:{" "}
          <span className="text-foreground font-medium">{totalUnits} un</span>
        </p>

        <div className="space-y-2">
          <Badge variant="outline" className={badge.className}>
            Elasticidade {badge.label}
          </Badge>

          <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Simular: a partir de</span>
              <div className="flex items-center gap-1">
                <span>R$</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={basePrice}
                  onChange={(e) => setBasePrice(Number(e.target.value) || 0)}
                  className="h-8 w-24 tabular-nums"
                />
              </div>
              <span>subida de</span>
              <div className="flex items-center gap-1">
                <span>R$</span>
                <Input
                  type="number"
                  step="0.5"
                  min="0"
                  value={increment}
                  onChange={(e) => setIncrement(Number(e.target.value) || 0)}
                  className="h-8 w-24 tabular-nums"
                />
              </div>
            </div>
            <p className="text-xs text-foreground leading-relaxed">
              A cada <span className="font-medium tabular-nums">R$ {increment.toFixed(2).replace(".", ",")}</span>{" "}
              de subida a partir de{" "}
              <span className="font-medium tabular-nums">{formatBRL(basePrice)}</span>, perde
              aproximadamente <span className="font-medium tabular-nums">{perdaPctStr}%</span> em volume
              {" "}(<span className="tabular-nums">≈ {unidadesPerdidas} un</span> a menos no período).
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
