import { format } from "date-fns";
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
  onDelete?: (id: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function HistoricoSnapshotTable({
  snapshots,
  selected,
  onToggle,
  onDelete,
}: HistoricoSnapshotTableProps) {
  return (
    <Table>
      <TableHeader className="bg-muted/40">
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-10 px-3" />
          <TableHead>Data</TableHead>
          <TableHead>Período</TableHead>
          <TableHead className="tabular-nums">Preço GMV</TableHead>
          <TableHead className="tabular-nums">Preço Neutro</TableHead>
          <TableHead className="tabular-nums">Preço Margem</TableHead>
          <TableHead>Elasticidade</TableHead>
          {onDelete && <TableHead className="w-10" />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {snapshots.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={onDelete ? 8 : 7} className="text-center text-muted-foreground py-6">
              Nenhuma análise salva para este produto.
            </TableCell>
          </TableRow>
        ) : (
          snapshots.map((snapshot) => {
            const isChecked = selected.includes(snapshot.id);
            const isDisabled = selected.length >= 2 && !isChecked;
            const badge = ELASTICITY_BADGE[snapshot.elasticityClass];

            return (
              <TableRow key={snapshot.id} className="hover:bg-muted/50">
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
                {onDelete && (
                  <TableCell className="px-2">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          aria-label="Excluir análise"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Excluir análise?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Esta ação remove permanentemente o snapshot de{" "}
                            {format(new Date(snapshot.createdAt), "dd/MM/yyyy HH:mm")}.
                            Não é possível desfazer.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => onDelete(snapshot.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Excluir
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                )}
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
