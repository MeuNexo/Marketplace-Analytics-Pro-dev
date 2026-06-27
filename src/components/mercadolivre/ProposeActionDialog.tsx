import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { RULE_TO_ACTION } from "@/lib/consultor/actionMapping";
import type { InsightRow } from "@/hooks/useConsultorInsights";
import { useConsultorActions } from "@/hooks/useConsultorActions";
import type { ProposedValue } from "@/lib/consultor/actionMapping";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const NUMERIC_TYPES = new Set(["update_price", "update_ads_budget"]);

function actionTypeLabel(type: string): string {
  switch (type) {
    case "update_price":      return "Atualizar preço";
    case "pause_listing":     return "Pausar anúncio";
    case "activate_listing":  return "Ativar anúncio";
    case "pause_ads_campaign": return "Pausar campanha de anúncio";
    case "update_ads_budget": return "Atualizar orçamento de ads";
    default:                  return type;
  }
}

function fixedProposedValue(type: string): ProposedValue {
  if (type === "activate_listing") return { status: "active" };
  // pause_listing / pause_ads_campaign
  return { status: "paused" };
}

function numericInputLabel(type: string): string {
  return type === "update_price" ? "Novo preço (R$)" : "Novo orçamento diário (R$)";
}

function numericInputPlaceholder(type: string): string {
  return type === "update_price" ? "Ex: 149.90" : "Ex: 50.00";
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface ProposeActionDialogProps {
  insight: InsightRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ProposeActionDialog({ insight, open, onOpenChange }: ProposeActionDialogProps) {
  const { propose } = useConsultorActions();
  const [value, setValue] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const actionType = RULE_TO_ACTION[insight.rule_key];
  const needsNumericInput = actionType ? NUMERIC_TYPES.has(actionType) : false;

  const impactFormatted =
    insight.impact_brl != null
      ? Math.abs(insight.impact_brl).toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        })
      : null;

  const parsedValue = parseFloat(value);
  const isValid = needsNumericInput ? isFinite(parsedValue) && parsedValue > 0 : true;

  function handleClose() {
    if (loading) return;
    onOpenChange(false);
    setValue("");
  }

  async function handleSubmit() {
    if (!actionType || !isValid || loading) return;
    setLoading(true);
    try {
      const proposedValue: ProposedValue = needsNumericInput
        ? { value: parsedValue }
        : fixedProposedValue(actionType);
      await propose(insight, proposedValue);
      toast.success("Proposta enviada para aprovação");
      onOpenChange(false);
      setValue("");
    } catch {
      toast.error("Erro ao criar proposta. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  // Guard: only render when a valid action type exists for this insight
  if (!actionType) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{actionTypeLabel(actionType)}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            {insight.title}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Impact estimate (D-14: always from insight.impact_brl, never recalculated) */}
          {impactFormatted && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3">
              <p className="text-xs font-medium text-destructive">
                Impacto estimado: ~{impactFormatted}/mês
              </p>
            </div>
          )}

          {/* Conditional input: numeric for price/budget; summary for pause/activate */}
          {needsNumericInput ? (
            <div className="space-y-2">
              <Label htmlFor="proposed-value">
                {numericInputLabel(actionType)}
              </Label>
              <Input
                id="proposed-value"
                type="number"
                min="0.01"
                step="0.01"
                placeholder={numericInputPlaceholder(actionType)}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-full"
                disabled={loading}
              />
              {value !== "" && !isValid && (
                <p className="text-xs text-destructive">Digite um valor maior que zero.</p>
              )}
            </div>
          ) : (
            <div className="rounded-md bg-muted/50 border border-border/50 p-3">
              <p className="text-sm text-muted-foreground">
                {actionType === "activate_listing" &&
                  "O anúncio será ativado no Mercado Livre."}
                {actionType === "pause_listing" &&
                  "O anúncio será pausado no Mercado Livre."}
                {actionType === "pause_ads_campaign" &&
                  "A campanha de publicidade será pausada no Mercado Livre."}
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !isValid}>
            {loading ? "Enviando…" : "Enviar para aprovação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
