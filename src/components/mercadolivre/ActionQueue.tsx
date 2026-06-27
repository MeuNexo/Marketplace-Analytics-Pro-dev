import { useState } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useConsultorActions } from "@/hooks/useConsultorActions";
import type { ProposedActionRow } from "@/hooks/useConsultorActions";

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

function formatBRL(value: number | null | undefined): string | null {
  if (value == null) return null;
  return Math.abs(value).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatJsonValue(raw: unknown): string {
  if (raw == null) return "—";
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if ("value" in obj && typeof obj.value === "number") {
      return obj.value.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
    if ("status" in obj) return String(obj.status);
  }
  if (typeof raw === "number" || typeof raw === "string") return String(raw);
  return JSON.stringify(raw);
}

/** Returns true when the action was created more than 24 h ago (ACT-07). */
function isStale(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() > 24 * 60 * 60 * 1000;
}

// ─── ActionCard ───────────────────────────────────────────────────────────────

interface ActionCardProps {
  action: ProposedActionRow;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}

function ActionCard({ action, onApprove, onReject }: ActionCardProps) {
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const stale = isStale(action.created_at);
  const impact = formatBRL(action.estimated_impact_brl);
  const currentLabel = formatJsonValue(action.current_value);
  const proposedLabel = formatJsonValue(action.proposed_value);

  const isProposed = action.status === "proposed";

  async function handleApprove() {
    setApproving(true);
    try {
      await onApprove(action.id);
      toast.success("Ação enviada para execução");
    } catch {
      toast.error("Erro ao aprovar ação. Tente novamente.");
    } finally {
      setApproving(false);
    }
  }

  async function handleReject() {
    setRejecting(true);
    try {
      await onReject(action.id);
      toast.info("Ação rejeitada");
    } catch {
      toast.error("Erro ao rejeitar ação. Tente novamente.");
    } finally {
      setRejecting(false);
    }
  }

  return (
    <Card className="border-border/50">
      <CardContent className="pt-4 pb-3 flex flex-col gap-3">
        {/* Header row: action type, status badge, staleness badge, date */}
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 leading-4">
                {actionTypeLabel(action.action_type)}
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] px-1.5 py-0 leading-4",
                  isProposed
                    ? "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/30"
                    : "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/30",
                )}
              >
                {isProposed ? "Aguardando aprovação" : "Aprovada"}
              </Badge>
              {/* ACT-07 UI: staleness badge when >24h */}
              {stale && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 leading-4 flex items-center gap-1 bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/30"
                >
                  <AlertTriangle className="h-2.5 w-2.5" />
                  impacto pode ter mudado
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Ref: <span className="font-mono">{action.target_ref}</span>
            </p>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
            <Clock className="h-3 w-3" />
            <span>
              {new Date(action.created_at).toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                year: "2-digit",
              })}
            </span>
          </div>
        </div>

        {/* Diff: current_value → proposed_value */}
        <div className="flex items-center gap-2 text-xs bg-muted/30 rounded-md px-3 py-2">
          <span className="text-muted-foreground line-through">{currentLabel}</span>
          <span className="text-muted-foreground mx-1">→</span>
          <span className="font-medium">{proposedLabel}</span>
        </div>

        {/* Impact estimate */}
        {impact && (
          <p className="text-xs font-medium text-destructive">
            Impacto estimado: ~{impact}/mês
          </p>
        )}

        {/* Approve / Reject — only for proposed status (ACT-03) */}
        {isProposed && (
          <div className="flex items-center gap-2 pt-1">
            {/* Approve inside AlertDialog (execution is irreversible — T-54-15) */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" className="h-7 text-xs" disabled={approving}>
                  {approving ? "Aprovando…" : "Aprovar"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirmar aprovação</AlertDialogTitle>
                  <AlertDialogDescription>
                    Essa ação será executada imediatamente no Mercado Livre e não pode
                    ser desfeita. Deseja confirmar?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleApprove}>
                    Confirmar e executar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={handleReject}
              disabled={rejecting}
            >
              {rejecting ? "Rejeitando…" : "Rejeitar"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── ActionQueue ──────────────────────────────────────────────────────────────

export function ActionQueue() {
  const { queue, approve, reject, loading } = useConsultorActions();

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {[1, 2].map((i) => (
          <Card key={i} className="border-border/50">
            <CardContent className="py-4">
              <div className="h-3 bg-muted rounded animate-pulse w-1/2 mb-2" />
              <div className="h-2 bg-muted rounded animate-pulse w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <Card className="border-dashed border-border/50">
        <CardContent className="py-8 text-center">
          <p className="text-sm font-medium">Nenhuma ação pendente</p>
          <p className="text-xs text-muted-foreground mt-1">
            Proponha ações nos alertas da aba Insights.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {queue.map((action) => (
        <ActionCard
          key={action.id}
          action={action}
          onApprove={approve}
          onReject={reject}
        />
      ))}
    </div>
  );
}
