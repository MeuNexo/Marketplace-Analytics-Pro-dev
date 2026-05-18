import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import {
  Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing/calculator";
import type { AnalysisSnapshot } from "@/hooks/useAnalysisSnapshots";
import { ELASTICITY_BADGE } from "@/lib/analysis/elasticityConfig";

// ── Types ─────────────────────────────────────────────────────────────────────

type Strategy = 'gmv' | 'neutral' | 'margin';

export interface AnalisePrecosTableProps {
  snapshots: AnalysisSnapshot[];
  onStrategyChange: (id: string, strategy: Strategy) => void;
}

// ── Strategy cell highlight classes ──────────────────────────────────────────

const STRATEGY_CELL_CLASSES: Record<Strategy, string> = {
  gmv:     'bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/30 text-emerald-700 font-semibold',
  neutral: 'bg-blue-500/10    ring-1 ring-inset ring-blue-500/30    text-blue-700    font-semibold',
  margin:  'bg-amber-500/10   ring-1 ring-inset ring-amber-500/30   text-amber-700   font-semibold',
};

// ── Component ─────────────────────────────────────────────────────────────────

export function AnalisePrecosTable({ snapshots, onStrategyChange }: AnalisePrecosTableProps) {
  return (
    <Table>
      <TableHeader className="bg-muted/40">
        <TableRow className="hover:bg-transparent">
          <TableHead>Produto</TableHead>
          <TableHead>Marca</TableHead>
          <TableHead className="text-right">Preço GMV</TableHead>
          <TableHead className="text-right">Preço Neutro</TableHead>
          <TableHead className="text-right">Preço Margem</TableHead>
          <TableHead>Impacto Comercial</TableHead>
          <TableHead>Estratégia</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {snapshots.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
              Nenhum snapshot disponível. Execute uma análise.
            </TableCell>
          </TableRow>
        ) : (
          snapshots.map((snapshot) => {
            const badge = ELASTICITY_BADGE[snapshot.elasticityClass];
            return (
              <TableRow key={snapshot.id} className="hover:bg-muted/50">
                {/* Produto */}
                <TableCell className="font-medium max-w-[200px] truncate">
                  {snapshot.productTitle}
                </TableCell>

                {/* Marca */}
                <TableCell className="text-muted-foreground">
                  {snapshot.brand ?? "—"}
                </TableCell>

                {/* Preço GMV */}
                <TableCell
                  className={cn(
                    "text-right tabular-nums",
                    snapshot.strategy === 'gmv' && STRATEGY_CELL_CLASSES.gmv,
                  )}
                >
                  {formatBRL(snapshot.priceGmv)}
                </TableCell>

                {/* Preço Neutro */}
                <TableCell
                  className={cn(
                    "text-right tabular-nums",
                    snapshot.strategy === 'neutral' && STRATEGY_CELL_CLASSES.neutral,
                  )}
                >
                  {formatBRL(snapshot.priceNeutral)}
                </TableCell>

                {/* Preço Margem */}
                <TableCell
                  className={cn(
                    "text-right tabular-nums",
                    snapshot.strategy === 'margin' && STRATEGY_CELL_CLASSES.margin,
                  )}
                >
                  {formatBRL(snapshot.priceMargin)}
                </TableCell>

                {/* Impacto Comercial */}
                <TableCell>
                  <Badge variant="outline" className={cn(badge.className)}>
                    {badge.label}
                  </Badge>
                </TableCell>

                {/* Estratégia */}
                <TableCell>
                  <Select
                    value={snapshot.strategy ?? ""}
                    onValueChange={(v) => onStrategyChange(snapshot.id, v as Strategy)}
                  >
                    <SelectTrigger className="h-8 w-[120px] text-xs">
                      <SelectValue placeholder="Estratégia" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gmv">GMV</SelectItem>
                      <SelectItem value="neutral">Neutro</SelectItem>
                      <SelectItem value="margin">Margem</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
