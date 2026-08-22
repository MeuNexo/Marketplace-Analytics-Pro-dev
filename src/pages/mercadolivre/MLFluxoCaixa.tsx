// ============================================================================
// MLFluxoCaixa — /fluxo-de-caixa
//
// Aba "Caixa Real", remontada na Fase 230 Plano 04 (CX-03, CX-04): UM BLOCO
// POR PERGUNTA, em ordem de decisão. O comentário anterior descrevia um modelo
// de 3 cards que não existia na árvore de render desde a Fase 51 e já induziu
// leitura errada uma vez — foi reescrito, e esta lista é a ordem real:
//
//   1. DiasDeCaixaCard ....... Quanto tempo aguento sem vender?
//   2. CashGapTable .......... Quando aperta? (veredito de uma linha)
//   3. CashFlowChart ......... Como meu dinheiro vai evoluir?
//      + ForecastErrorCard ... Dá para confiar nessa previsão? (colado abaixo,
//                              porque é a leitura DAQUELE gráfico)
//   4. CicloCaixaCard ........ Onde meu dinheiro está preso?
//   5. PainelConferencia ..... (nenhuma — é conferência; os KPIs recolhidos)
//   6. Composição de custo + exposição por fornecedor
//                             Para onde vai o dinheiro / quanto devo a quem
//
// 🔴 `CashFlowChart` É INTOCÁVEL — decisão explícita do Wesley. É o único bloco
// que ele aprovou ("exceto a parte de como meu dinheiro vai fluir"). A página
// passa `data` e `isLoading`, e nada mais. Qualquer mudança nele é regressão
// (T-230-13, gate de diff vazio na fase inteira).
//
// 🔴 A JANELA VEM DE `HORIZONTE_TESOURARIA_DIAS` (13 semanas), nunca de um
// número digitado aqui — o mesmo módulo alimenta a CashGapTable, e duplicar o
// valor é exatamente como duas telas divergem sobre a mesma pergunta.
//
// Estado da aba: `includePurchaseForecasts` é estado da página propagado por
// prop a todo bloco que o aceita. Nenhum contexto React novo.
//
// CASH-04 · CX-03 · CX-04
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
import { CostCompositionChart } from "@/components/financial/CostCompositionChart";
import { SupplierExposureChart } from "@/components/financial/SupplierExposureChart";
import { CashFlowSimulator } from "@/components/financial/CashFlowSimulator";
import { CashGapTable } from "@/components/financial/CashGapTable";
import { ForecastErrorCard } from "@/components/financial/ForecastErrorCard";
import { DiasDeCaixaCard } from "@/components/financial/DiasDeCaixaCard";
import { CicloCaixaCard } from "@/components/financial/CicloCaixaCard";
import { PainelConferencia } from "@/components/financial/PainelConferencia";
import { HORIZONTE_TESOURARIA_DIAS } from "@/lib/horizonteTesouraria";
import { useCashFlowData } from "@/hooks/useCashFlowData";
import { useFinancialSettings } from "@/hooks/useFinancialSettings";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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

  // Período: hoje → hoje + 13 semanas (futuro-only). A janela vem da constante
  // compartilhada com a CashGapTable; `get_cashflow` aceita qualquer data final,
  // e nem a RPC nem o gráfico mudam por causa disto (CX-03).
  const { startDate, endDate } = useMemo(() => {
    const today = new Date();
    return {
      startDate: format(today, "yyyy-MM-dd"),
      endDate:   format(addDays(today, HORIZONTE_TESOURARIA_DIAS), "yyyy-MM-dd"),
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
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
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

        {/* ── Aba Caixa Real — um bloco por pergunta, em ordem de decisão ── */}
        <TabsContent value="real" className="space-y-6 mt-0">

          {/* ── Controles de escopo da aba ──
              Linha única e discreta, logo abaixo do cabeçalho. Saíram de baixo
              do painel de tesouraria: são escopo da página inteira, não do
              painel. ── */}
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

          {/* ── 1. Quanto tempo aguento sem vender? (Fase 230, CX-01/CX-06) ──
              É o alarme. Com o colchão medido em ~2 dias, nada abaixo importa
              mais — por isso abre a página. ── */}
          <DiasDeCaixaCard includePurchaseForecasts={includePurchaseForecasts} />

          {/* ── 2. Quando aperta? (Fase 224 ERR-04, reduzida na Fase 230) ──
              Continua ANTES do gráfico: a Fase 224 decidiu, por escrito, que o
              que dispara decisão — pago hoje ou prorrogo? — precede o que
              ilustra. A decisão vale; agora ela custa uma linha. ── */}
          <CashGapTable includePurchaseForecasts={includePurchaseForecasts} />

          {/* ── 3. Como meu dinheiro vai evoluir? ──
              🔴 O gráfico é intocável (decisão do Wesley). A frase de confiança
              vem colada abaixo porque é a leitura DESTE gráfico, não um bloco
              independente. ── */}
          {chartLoading ? (
            <Skeleton className="h-72 rounded-xl" />
          ) : hasData ? (
            <CashFlowChart data={cashFlowData} isLoading={false} />
          ) : (
            <CashFlowEmptyState />
          )}
          <ForecastErrorCard />

          {/* ── 4. Onde meu dinheiro está preso? (Fase 230, CX-02) ──
              Fecha a história que os blocos acima abriram: o ciclo está
              saudável; o colchão é que não existe. ── */}
          <CicloCaixaCard includePurchaseForecasts={includePurchaseForecasts} />

          {/* ── 5. Conferência — os 12 KPIs de tesouraria, recolhidos ──
              Nada foi apagado. O que não dispara decisão deixou de abrir a
              página (T-230-12). ── */}
          <PainelConferencia includePurchaseForecasts={includePurchaseForecasts} />

          {/* ── 6. Para onde vai o dinheiro / quanto devo a quem ──
              Respondem pergunta própria e não estavam entre os blocos
              rejeitados em 21/08. ── */}
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
