// ============================================================================
// MLFluxoCaixa — /fluxo-de-caixa
// Modelo futuro-only (2026-06-18):
//   - 3 cards: Caixa Hoje, Projeção Futura, Capacidade de Compra
//   - Gráfico: Como meu dinheiro vai evoluir? (120 dias à frente)
//   - Botão "Ajustar saldo de hoje" (owner only) → Dialog c/ upsert financial_settings
// CASH-04
// ============================================================================

import { useMemo, useState } from "react";
import { format, addDays } from "date-fns";
import { Banknote, Settings2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import { CashFlowChart } from "@/components/financial/CashFlowChart";
import { TreasuryPanel } from "@/components/financial/TreasuryPanel";
import { CostCompositionChart } from "@/components/financial/CostCompositionChart";
import { SupplierExposureChart } from "@/components/financial/SupplierExposureChart";
import { CashFlowSimulator } from "@/components/financial/CashFlowSimulator";
import { useCashFlowData } from "@/hooks/useCashFlowData";
import { useFinancialSettings } from "@/hooks/useFinancialSettings";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ─── Constante ────────────────────────────────────────────────────────────────

const FUTURE_DAYS = 120; // dias de projeção à frente (alinhado ao horizonte do card de projeção)

// ─── Empty state ───────────────────────────────────────────────────────────────

function CashFlowEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 border border-dashed border-border/50 rounded-xl bg-muted/20">
      <Banknote className="w-12 h-12 text-muted-foreground/30" />
      <p className="text-sm font-medium text-muted-foreground">
        Dados de caixa não encontrados
      </p>
      <p className="text-xs text-muted-foreground/70 text-center max-w-xs">
        Sincronize o Mercado Pago (entradas) e o Tiny ERP (saídas) para ver
        o fluxo de caixa real da sua operação.
      </p>
    </div>
  );
}

// ─── Dialog de ajuste de saldo inicial ────────────────────────────────────────

interface AdjustBalanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentBalance: number;
  orgId: string;
}

function AdjustBalanceDialog({
  open,
  onOpenChange,
  currentBalance,
  orgId,
}: AdjustBalanceDialogProps) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState<string>(String(currentBalance));
  const [saving, setSaving] = useState(false);

  // Sincronizar valor quando o dialog abre com saldo atual
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) setValue(String(currentBalance));
    onOpenChange(isOpen);
  };

  const handleSave = async () => {
    const parsed = parseFloat(value.replace(",", "."));
    if (isNaN(parsed)) {
      toast.error("Digite um valor numérico válido.");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("financial_settings")
        .upsert(
          { organization_id: orgId, initial_balance: parsed },
          { onConflict: "organization_id" }
        );

      if (error) throw error;

      // Invalidar queries de fluxo de caixa para recalcular cards e gráfico
      await queryClient.invalidateQueries({ queryKey: ["financial_settings", orgId] });
      await queryClient.invalidateQueries({ queryKey: ["cashflow"] });
      await queryClient.invalidateQueries({ queryKey: ["today_balance"] });
      await queryClient.invalidateQueries({ queryKey: ["projected_balance"] });

      toast.success("Saldo de hoje atualizado com sucesso.");
      onOpenChange(false);
    } catch (err: any) {
      toast.error(`Erro ao salvar: ${err?.message ?? "Tente novamente."}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Ajustar saldo de hoje</DialogTitle>
          <DialogDescription>
            Informe quanto você tem disponível no caixa agora. Este valor é o ponto de
            partida da projeção — não é atualizado automaticamente.
            <br />
            <span className="text-xs text-muted-foreground mt-1 block">
              Dica: atualize manualmente quando quiser calibrar a projeção com o
              saldo real do banco.
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <Label htmlFor="initial-balance">Quanto você tem de caixa hoje? (R$)</Label>
          <Input
            id="initial-balance"
            type="number"
            min={0}
            step={0.01}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Ex: 15000"
            className="tabular-nums"
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Página ────────────────────────────────────────────────────────────────────

export default function MLFluxoCaixa() {
  const { currentOrg } = useOrganization();
  const isOwner = currentOrg?.role === "owner";

  const [adjustOpen, setAdjustOpen] = useState(false);
  // CASHFIX-06: incluir/excluir ordens de compra não faturadas ("Previsões de compra").
  // OFF (padrão) = caixa alinhado com o contas a pagar do Tiny/DFC.
  const [includePurchaseForecasts, setIncludePurchaseForecasts] = useState(false);

  const { data: financialSettings } = useFinancialSettings();

  // Período: hoje → hoje + 90 dias (futuro-only)
  const { startDate, endDate } = useMemo(() => {
    const today = new Date();
    return {
      startDate: format(today, "yyyy-MM-dd"),
      endDate:   format(addDays(today, FUTURE_DAYS), "yyyy-MM-dd"),
    };
  }, []);

  const { data: cashFlowData, isLoading: chartLoading } = useCashFlowData(
    startDate,
    endDate,
    includePurchaseForecasts,
  );

  const isPageLoading = !currentOrg;

  if (isPageLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-56" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }

  const hasData =
    cashFlowData &&
    cashFlowData.length > 0 &&
    cashFlowData.some((p) => p.daily_income > 0 || p.daily_expense > 0 || p.accumulated_balance !== 0);

  return (
    <div className="space-y-6">

      {/* ── Header sticky ── */}
      <div className="sticky -top-4 md:-top-6 lg:-top-8 z-20 -mx-4 md:-mx-6 lg:-mx-8 -mt-4 md:-mt-6 lg:-mt-8 px-4 md:px-6 lg:px-8 pb-4 pt-4 bg-background/95 backdrop-blur-sm border-b border-border/40">
        <MLPageHeader title="Fluxo de Caixa" />
      </div>

      {/* ── Tabs: Caixa Real | Simulador ── */}
      <Tabs defaultValue="real" className="space-y-6">
        <TabsList>
          <TabsTrigger value="real">Caixa Real</TabsTrigger>
          <TabsTrigger value="simulador">Simulador</TabsTrigger>
        </TabsList>

        {/* ── Aba Caixa Real (conteúdo atual INTOCADO) ── */}
        <TabsContent value="real" className="space-y-6 mt-0">
          {/* ── Painel de Tesouraria (12 KPIs) + botão Ajustar saldo ── */}
          <div className="flex flex-col gap-4">
            <TreasuryPanel includePurchaseForecasts={includePurchaseForecasts} />

            {/* Toggle de previsões de compra + botão owner-only de ajuste de saldo */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Switch
                  id="include-purchase-forecasts"
                  checked={includePurchaseForecasts}
                  onCheckedChange={setIncludePurchaseForecasts}
                />
                <Label
                  htmlFor="include-purchase-forecasts"
                  className="text-xs text-muted-foreground cursor-pointer"
                  title="Inclui ordens de compra ainda não faturadas (previsões). Desligado, o caixa reflete só o contas a pagar do Tiny."
                >
                  Incluir previsões de compra
                </Label>
              </div>

              {isOwner && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAdjustOpen(true)}
                  className="gap-1.5 text-xs"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  Ajustar saldo de hoje
                </Button>
              )}
            </div>
          </div>

          {/* ── Gráfico: Como meu dinheiro vai evoluir? ── */}
          {chartLoading ? (
            <Skeleton className="h-72 rounded-xl" />
          ) : hasData ? (
            <CashFlowChart data={cashFlowData} isLoading={false} />
          ) : (
            <CashFlowEmptyState />
          )}

          {/* ── Composição de Custos e Exposição por Fornecedor ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <CostCompositionChart />
            <SupplierExposureChart />
          </div>
        </TabsContent>

        {/* ── Aba Simulador ("E se...?") ── */}
        <TabsContent value="simulador" className="mt-0">
          <CashFlowSimulator />
        </TabsContent>
      </Tabs>

      {/* ── Dialog de ajuste de saldo (owner only) ── */}
      {isOwner && currentOrg && (
        <AdjustBalanceDialog
          open={adjustOpen}
          onOpenChange={setAdjustOpen}
          currentBalance={financialSettings?.initial_balance ?? 0}
          orgId={currentOrg.id}
        />
      )}

    </div>
  );
}
