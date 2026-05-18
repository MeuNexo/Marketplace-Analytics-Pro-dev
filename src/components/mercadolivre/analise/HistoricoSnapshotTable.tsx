import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AnalysisSnapshot } from "@/hooks/useAnalysisSnapshots";
import { ELASTICITY_BADGE } from "@/lib/analysis/elasticityConfig";
import { formatBRL } from "@/lib/pricing/calculator";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HistoricoSnapshotTableProps {
  snapshots: AnalysisSnapshot[];
  selected: string[]; // up to 2 IDs
  onToggle: (id: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function HistoricoSnapshotTable({
  snapshots,
  selected,
  onToggle,
}: HistoricoSnapshotTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10 px-3" />
          <TableHead>Data</TableHead>
          <TableHead>Período</TableHead>
          <TableHead className="tabular-nums">Preço GMV</TableHead>
          <TableHead className="tabular-nums">Preço Neutro</TableHead>
          <TableHead className="tabular-nums">Preço Margem</TableHead>
          <TableHead>Elasticidade</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {snapshots.length === 0 ? (
          <TableRow>
            <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
              Nenhuma análise salva para este produto.
            </TableCell>
          </TableRow>
        ) : (
          snapshots.map((snapshot) => {
            const isChecked = selected.includes(snapshot.id);
            const isDisabled = selected.length >= 2 && !isChecked;
            const badge = ELASTICITY_BADGE[snapshot.elasticityClass];

            return (
              <TableRow key={snapshot.id}>
                <TableCell className="px-3">
                  <Checkbox
                    checked={isChecked}
                    disabled={isDisabled}
                    onCheckedChange={() => onToggle(snapshot.id)}
                  />
                </TableCell>
                <TableCell className="text-xs tabular-nums whitespace-nowrap">
                  {format(new Date(snapshot.createdAt), "dd/MM/yyyy HH:mm")}
                </TableCell>
                <TableCell className="text-xs tabular-nums whitespace-nowrap">
                  {snapshot.periodStart} → {snapshot.periodEnd}
                </TableCell>
                <TableCell className="text-xs tabular-nums">
                  {formatBRL(snapshot.priceGmv)}
                </TableCell>
                <TableCell className="text-xs tabular-nums">
                  {formatBRL(snapshot.priceNeutral)}
                </TableCell>
                <TableCell className="text-xs tabular-nums">
                  {formatBRL(snapshot.priceMargin)}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={badge.className}>
                    {badge.label}
                  </Badge>
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
