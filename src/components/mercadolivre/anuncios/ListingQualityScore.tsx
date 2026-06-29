import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { qualityScoreBand } from "./listingIndicators";

interface ListingQualityScoreProps {
  health: number | null;
}

/**
 * Scoreboard isolado de qualidade do anúncio.
 * Reutilizável pela Phase 72 (health refresh via EF).
 *
 * Faixas espelham healthBadge de MLAnuncios.tsx:
 *   >= 0.8 → bom    (emerald)
 *   >= 0.5 → medio  (amber)
 *   <  0.5 → ruim   (destructive)
 *   null   → sem dado (muted)
 */
export function ListingQualityScore({ health }: ListingQualityScoreProps) {
  const { pct, band, label } = qualityScoreBand(health);

  if (band === "sem_dado") {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-muted-foreground font-medium">Qualidade do anúncio</p>
        <p className="text-2xl font-bold text-muted-foreground">—</p>
        <Badge variant="outline" className="self-start text-xs text-muted-foreground">
          Sem dado
        </Badge>
        <p className="text-[11px] text-muted-foreground/70">
          Atualizado pelo Mercado Livre com base em fotos, descrição e reputação.
        </p>
      </div>
    );
  }

  const badgeClass =
    band === "bom"
      ? "border-emerald-500 text-emerald-600 bg-emerald-50"
      : band === "medio"
        ? "border-amber-500 text-amber-600 bg-amber-50"
        : "border-destructive text-destructive bg-red-50";

  const progressClass =
    band === "bom"
      ? "[&>div]:bg-emerald-500"
      : band === "medio"
        ? "[&>div]:bg-amber-500"
        : "[&>div]:bg-destructive";

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-muted-foreground font-medium">Qualidade do anúncio</p>
      <div className="flex items-baseline gap-2">
        <p className="text-2xl font-bold tabular-nums">{pct}%</p>
        <Badge variant="outline" className={`text-xs ${badgeClass}`}>
          {label}
        </Badge>
      </div>
      <Progress value={pct ?? 0} className={`h-2 ${progressClass}`} />
      <p className="text-[11px] text-muted-foreground/70">
        Atualizado pelo Mercado Livre com base em fotos, descrição e reputação.
      </p>
    </div>
  );
}
