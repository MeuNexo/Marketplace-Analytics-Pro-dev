import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useConsultorActions } from "@/hooks/useConsultorActions";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function actionTypeLabel(type: string): string {
  switch (type) {
    case "update_price":       return "Atualizar preço";
    case "pause_listing":      return "Pausar anúncio";
    case "activate_listing":   return "Ativar anúncio";
    case "pause_ads_campaign": return "Pausar campanha";
    case "update_ads_budget":  return "Atualizar orçamento";
    default:                   return type;
  }
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── ActionHistory ────────────────────────────────────────────────────────────

export function ActionHistory() {
  const { history, loading } = useConsultorActions();

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 bg-muted rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <Card className="border-dashed border-border/50">
        <CardContent className="py-8 text-center">
          <p className="text-sm font-medium">Nenhuma ação executada</p>
          <p className="text-xs text-muted-foreground mt-1">
            Ações aprovadas aparecem aqui após a execução.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="rounded-md border border-border/50 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30">
            <TableHead className="text-xs font-medium">Ação</TableHead>
            <TableHead className="text-xs font-medium">Referência</TableHead>
            <TableHead className="text-xs font-medium">Resultado</TableHead>
            <TableHead className="text-xs font-medium text-right">Executada em</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {history.map((action) => {
            const isDone = action.status === "done";
            return (
              <TableRow key={action.id} className="text-xs">
                {/* Action type */}
                <TableCell className="font-medium">
                  {actionTypeLabel(action.action_type)}
                </TableCell>

                {/* target_ref */}
                <TableCell>
                  <span className="font-mono text-muted-foreground">{action.target_ref}</span>
                </TableCell>

                {/* result_summary with done/failed badge (ACT-08) */}
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] px-1.5 py-0 leading-4 w-fit",
                        isDone
                          ? "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/30"
                          : "bg-destructive/10 text-destructive border-destructive/30",
                      )}
                    >
                      {isDone ? "Concluída" : "Falhou"}
                    </Badge>
                    {action.result_summary && (
                      <span className="text-[10px] text-muted-foreground">
                        {action.result_summary}
                      </span>
                    )}
                  </div>
                </TableCell>

                {/* executed_at */}
                <TableCell className="text-right text-muted-foreground">
                  {formatDate(action.executed_at)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
