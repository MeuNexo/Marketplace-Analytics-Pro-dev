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
import { Banknote } from "lucide-react";
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
import { SaldoAgoraCard } from "@/components/financial/SaldoAgoraCard";
import { CicloCaixaCard } from "@/components/financial/CicloCaixaCard";
import { PainelConferencia } from "@/components/financial/PainelConferencia";
import { HORIZONTE_TESOURARIA_DIAS } from "@/lib/horizonteTesouraria";
import { useCashFlowData } from "@/hooks/useCashFlowData";
import { useTodayBalance } from "@/hooks/useTodayBalance";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/formatters";
import { brToday } from "@/lib/brDate";
import {
  montarDeclaracao,
  numeroOuNulo,
  podeDeclarar,
  saldoExibido,
  type MovimentosDoDia,
} from "@/lib/saldoDeclarado";
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

// ─── Dialog de correção do saldo de hoje (233-03, refeito no 233-05) ──────────
//
// 🔴 O QUE ESTAVA ERRADO, e não era conta: era CAMINHO. Esta tela gravava
// `financial_settings` direto, e esse caminho **não toca em
// `balance_anchor_date`**. O número que o gráfico de fluxo de caixa exibe é o
// saldo da ÂNCORA rolado por tudo que entrou e saiu desde ela — e a âncora da Pé
// Vermeio estava parada em **2026-07-13**, 45 dias atrás. O Wesley digitou
// R$ 37.430 e leu R$ 29.301,42: declarou, sem saber, um saldo de 13 de julho.
//
// 🔵 A CORREÇÃO É MOVER A ÂNCORA. Com `balance_anchor_date = hoje` o intervalo
// `[hoje, hoje)` é vazio e a abertura devolve o declarado ao centavo. A RPC que
// faz isso — `set_financial_balance` — já estava em produção, INVOKER, com
// `EXECUTE` para `authenticated`, e nunca tinha sido chamada por nenhuma linha
// deste repositório.
//
// 🔴 O 233-03 tentou consertar isso invertendo a conta contra os movimentos DE
// HOJE. A identidade estava certa e a quantidade errada; 59 testes verdes não
// pegaram. Por isso existe agora `__tests__/saldoAncorado.test.ts`, que reprova
// pela FORMA — se a escrita direta voltar, ele falha.
//
// 🔴 E a MESMA ação grava a declaração em `saldo_declarado` — o valor digitado é
// a fonte de verdade que ancora a curva de confiança do 233-02. Sem isso a série
// tem um ponto só, o que a migration inseriu à mão.
//
// ============================================================================
// 🔴 233-06 — O QUE ELE DIGITA É O SALDO DE AGORA, NÃO A ABERTURA (D-10)
//
// O 233-05 gravou o valor digitado direto na âncora, sob o D-07 ("o declarado é
// a abertura do dia"). O Wesley derrubou o D-07 horas depois: *"hoje o saldo já
// considerando a liberação já é o que passei, 37430"*. Ele declara olhando o
// EXTRATO, a qualquer hora.
//
// O estrago, medido: gravado como abertura, o sistema somou o dia por cima e
// contou R$ 13.157,27 DUAS VEZES (fechamento previsto R$ 42.457,04 contra os
// R$ 38.785,31 corretos).
//
// 🔵 Agora o diálogo DECOMPÕE antes de ancorar:
//     abertura = digitado − o que já entrou + o que já saiu
// e a prévia mostra essa conta acontecendo, em vez de prometer que o número
// atravessa intacto.
// ============================================================================

interface AdjustBalanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * 🔴 O SALDO DE AGORA (D-10) — o número que ele lê no extrato, e o que ele
   * está corrigindo. NÃO é a abertura (essa o sistema decompõe sozinho) nem a
   * previsão de fechamento: pré-preencher com qualquer um dos dois faria ele
   * "corrigir" um valor que não é o que ele quer mudar.
   */
  saldoDeAgora: number | null;
  movimentos: MovimentosDoDia | null;
  carregandoMovimentos: boolean;
  orgId: string;
}

/**
 * `saldo_declarado` não está nos tipos gerados do Supabase (a migration do
 * 233-02 foi aplicada pela Management API). O escape é local e explícito.
 *
 * ⚠️ `.bind(supabase)`: os métodos do client dependem de `this` — desacoplá-los
 * estoura `Cannot read properties of undefined (reading 'rest')`, que foi
 * exatamente o defeito do 233-01.
 */
type TabelaSolta = {
  select: (cols: string) => any;
  insert: (linhas: unknown) => PromiseLike<{ error: { message: string } | null }>;
  update: (patch: unknown) => any;
};

function AdjustBalanceDialog({
  open,
  onOpenChange,
  saldoDeAgora,
  movimentos,
  carregandoMovimentos,
  orgId,
}: AdjustBalanceDialogProps) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const veredito = podeDeclarar(movimentos, carregandoMovimentos);

  // Ao abrir, o campo já vem com o SALDO DE AGORA — o número que ele vai
  // comparar contra o extrato, que é exatamente o que ele está corrigindo.
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) setValue(saldoDeAgora == null ? "" : String(saldoDeAgora));
    onOpenChange(isOpen);
  };

  // 🔵 A prévia usa o MESMO `montarDeclaracao` que o salvamento — prometer uma
  // conta na tela e executar outra no clique é como o defeito do 233-03
  // sobreviveu a 59 testes verdes.
  const previa = montarDeclaracao(orgId, brToday(), value, movimentos);
  const digitado = numeroOuNulo(value);

  const handleSave = async () => {
    // 🔴 O BLOQUEIO. Sem as parcelas LIQUIDADAS não há decomposição, e o
    // declarado seria gravado como abertura — o defeito do D-07, silencioso.
    if (!veredito.pode) {
      toast.error(veredito.motivo ?? "Não é possível salvar agora.");
      return;
    }

    const hoje = brToday();
    const montado = montarDeclaracao(orgId, hoje, value, movimentos);
    if (montado == null) {
      toast.error("Digite um valor numérico válido.");
      return;
    }

    setSaving(true);
    try {
      // 🔴 MOVER A ÂNCORA, não gravar o campo. `set_financial_balance` grava
      // `initial_balance` E `balance_anchor_date = hoje` na mesma operação — é a
      // segunda parte que faz a tela abrir no valor digitado. Escrever em
      // `financial_settings` por caminho direto deixa a âncora onde estava, e foi
      // esse caminho que produziu o defeito de 27/08/2026.
      //
      // ⚠️ `.bind(supabase)`: os métodos do client dependem de `this` —
      // desacoplá-los estoura `Cannot read properties of undefined (reading
      // 'rest')`, que foi exatamente o defeito do 233-01.
      const rpc = supabase.rpc.bind(supabase) as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => PromiseLike<{ error: { message: string } | null }>;

      // 🔴 O QUE VAI PARA A ÂNCORA É A ABERTURA DECOMPOSTA, não o digitado
      // (D-10). `saldoParaAncora` = digitado − o que já entrou + o que já saiu.
      // Mandar o digitado aqui faz o sistema somar o dia por cima e contar o
      // liquidado duas vezes — foi o que aconteceu em 27/08.
      const { error } = await rpc("set_financial_balance", {
        p_org_id: orgId,
        p_amount: montado.saldoParaAncora,
      });

      if (error) throw error;

      // ── A declaração — a âncora da curva de confiança ──
      // ⚠️ Redeclarar o mesmo dia atualiza o `saldo_real` (vale a última palavra
      // dele) mas PRESERVA o retrato anterior: na segunda declaração do dia o
      // "exibido" já é o valor que ele mesmo acabou de gravar, e sobrescrevê-lo
      // faria o erro do dia zero aparecer como zero em toda linha corrigida
      // duas vezes.
      try {
        const from = supabase.from.bind(supabase) as unknown as (n: string) => TabelaSolta;
        const { data: existente, error: erroLeitura } = await from("saldo_declarado")
          .select("id")
          .eq("organization_id", orgId)
          .eq("data_declarada", hoje)
          .maybeSingle();
        if (erroLeitura) throw erroLeitura;

        // ⚠️ Na redeclaração, `saldo_exibido`/`initial_balance` são PRESERVADOS
        // (o retrato do erro do dia zero é o da primeira), mas as parcelas de
        // liquidação são ATUALIZADAS: elas descrevem o instante desta
        // declaração, e é contra elas que a abertura acabou de ser decomposta.
        const escrita = existente?.id
          ? await from("saldo_declarado")
              .update({
                saldo_real: montado.declaracao.saldo_real,
                abertura_ancorada: montado.declaracao.abertura_ancorada,
                entradas_liquidadas: montado.declaracao.entradas_liquidadas,
                saidas_pagas: montado.declaracao.saidas_pagas,
                entradas_pendentes: montado.declaracao.entradas_pendentes,
              })
              .eq("id", existente.id)
              .eq("organization_id", orgId)
          : await from("saldo_declarado").insert(montado.declaracao);

        if (escrita?.error) throw escrita.error;
        await queryClient.invalidateQueries({ queryKey: ["confianca-do-saldo", orgId] });
      } catch (errDecl: any) {
        // A correção do saldo já valeu — não desfazemos. Mas o motivo REAL da
        // falha vai para a tela: declaração perdida em silêncio é série que
        // nunca nasce.
        toast.warning(
          `Saldo corrigido, mas a declaração não foi registrada: ${errDecl?.message ?? "erro desconhecido"}`,
        );
      }

      await queryClient.invalidateQueries({ queryKey: ["financial_settings", orgId] });
      await queryClient.invalidateQueries({ queryKey: ["cashflow"] });
      await queryClient.invalidateQueries({ queryKey: ["today_balance"] });
      await queryClient.invalidateQueries({ queryKey: ["projected_balance"] });

      toast.success(
        `Pronto. O saldo de agora passa a ser ${formatCurrency(montado.declaracao.saldo_real)}, ` +
          `e o dia abre em ${formatCurrency(montado.saldoParaAncora)}.`,
      );
      onOpenChange(false);
    } catch (err: any) {
      toast.error(`Erro ao salvar: ${err?.message ?? "Tente novamente."}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Corrigir o saldo de hoje</DialogTitle>
          <DialogDescription>
            Informe o <strong>saldo que você tem agora</strong> — o número que você vê no
            extrato neste momento, já com o que caiu hoje. O sistema desconta sozinho o que
            já entrou e devolve o que já saiu para chegar à abertura do dia.
          </DialogDescription>
        </DialogHeader>

        {/* 🔴 O AVISO FOI REFEITO NO 233-06, e o anterior SAIU inteiro. Ele dizia
            que o valor era lido como o saldo de ABERTURA do dia e que declarar
            de manhã era o caminho sem ambiguidade — o D-10 derrubou os dois. Ele
            declara olhando o extrato, a qualquer hora. Deixar uma instrução que
            contradiz o comportamento é pior do que não ter instrução. */}
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          <strong>Mudou:</strong> antes, o valor digitado era gravado como o saldo de{" "}
          <strong>abertura</strong> do dia — e como você declara olhando o extrato, o que já
          tinha caído hoje era contado <strong>duas vezes</strong> na previsão de fechamento.
          Agora pode declarar <strong>a qualquer hora</strong>: o sistema desconta o que já
          entrou e recompõe a abertura sozinho.
        </div>

        {/* ── A DECOMPOSIÇÃO QUE VAI ACONTECER ──
            🔵 A prévia deixou de prometer que o número atravessa intacto (ele
            não atravessa) e passa a mostrar a conta: digitado − já entrou + já
            saiu = a abertura que vai para a âncora. ── */}
        <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs space-y-1 tabular-nums">
          <div className="font-medium text-muted-foreground mb-1">
            O que já se moveu hoje
          </div>
          {carregandoMovimentos ? (
            <Skeleton className="h-16 w-full" />
          ) : movimentos == null ? (
            <p className="text-destructive">
              Não foi possível carregar as entradas e saídas de hoje.
            </p>
          ) : (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Já entrou (caiu na conta)</span>
                <span className="text-kpi-positive">
                  {formatCurrency(numeroOuNulo(movimentos.entradasLiquidadas) ?? 0)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Já saiu (pago)</span>
                <span className="text-kpi-negative">
                  {formatCurrency(numeroOuNulo(movimentos.saidasPagas) ?? 0)}
                </span>
              </div>
              {(numeroOuNulo(movimentos.entradasPendentes) ?? 0) > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Ainda pode entrar hoje (não está no seu extrato)
                  </span>
                  <span>{formatCurrency(numeroOuNulo(movimentos.entradasPendentes) ?? 0)}</span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="space-y-2 py-1">
          <Label htmlFor="saldo-real-hoje">Qual é o saldo do seu extrato agora? (R$)</Label>
          <Input
            id="saldo-real-hoje"
            type="number"
            step={0.01}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Ex: 37430"
            className="tabular-nums"
            disabled={!veredito.pode}
          />
          {!veredito.pode ? (
            <p className="text-xs text-destructive">{veredito.motivo}</p>
          ) : previa != null ? (
            <div className="text-xs text-muted-foreground space-y-0.5 tabular-nums">
              <p>
                <strong>Saldo agora:</strong>{" "}
                <span className="font-medium">{formatCurrency(previa.declaracao.saldo_real)}</span>
              </p>
              <p>
                {formatCurrency(previa.declaracao.saldo_real)} −{" "}
                {formatCurrency(previa.declaracao.entradas_liquidadas)} +{" "}
                {formatCurrency(previa.declaracao.saidas_pagas)} ={" "}
                <strong>{formatCurrency(previa.saldoParaAncora)}</strong> — é essa a{" "}
                <strong>abertura do dia</strong>, e é por ela que o gráfico passa a começar.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Digite o valor que você vê no extrato agora.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || !veredito.pode || digitado == null}>
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

  // 🔴 A fonte dos movimentos de hoje. Depois da migration
  // `20260827190000_saldo_ancorado_no_dia_declarado.sql`, `saldo_inicial` é a
  // ABERTURA ROLADA — o mesmo número pelo qual o gráfico de fluxo de caixa abre —
  // e `saldo_final_previsto` é a previsão de FECHAMENTO do dia. São perguntas
  // diferentes e a página passa a rotulá-las como tal (233-05).
  const { data: saldoHoje, isLoading: saldoHojeLoading } = useTodayBalance();

  const movimentosDeHoje: MovimentosDoDia | null = saldoHoje
    ? {
        saldoInicial: saldoHoje.saldo_inicial,
        entradas: saldoHoje.entradas_hoje,
        saidas: saldoHoje.saidas_hoje,
        // 🔴 233-06 — as parcelas de LIQUIDAÇÃO, todas vindas do banco. É delas
        // que sai a abertura decomposta; os totais acima ficam só para o
        // retrato do erro do dia zero.
        entradasLiquidadas: saldoHoje.entradas_liquidadas,
        saidasPagas: saldoHoje.saidas_pagas,
        entradasPendentes: saldoHoje.entradas_pendentes,
        saidasCanceladas: saldoHoje.saidas_canceladas,
        saldoAgora: saldoHoje.saldo_agora,
      }
    : null;

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

            {/* ── A linha apertada de decomposição SAIU aqui (233-06) ──
                Ela era o resumo comprimido de três números — abertura, previsão
                de fechamento e a conta entre eles — espremido ao lado de um
                botão. O `SaldoAgoraCard` abaixo diz tudo isso inteiro, com o
                saldo de AGORA em primeiro plano (D-11), e o botão de correção
                foi junto: manter os dois punha o mesmo número em dois lugares
                com rótulos diferentes, que é o defeito que o 233-05 fechou. ── */}
          </div>

          {/* ── 0. Quanto eu tenho AGORA? (Fase 233, D-11) ──
              🔴 Abre a aba porque é o número que o Wesley reconhece: o do
              extrato. E porque é ele que precisa explicar, antes do gráfico, por
              que o gráfico começa mais baixo. ── */}
          <SaldoAgoraCard podeCorrigir={isOwner} onCorrigir={() => setAdjustOpen(true)} />

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
          saldoDeAgora={saldoHoje?.saldo_agora ?? null}
          movimentos={movimentosDeHoje}
          carregandoMovimentos={saldoHojeLoading}
          orgId={currentOrg.id}
        />
      )}

    </div>
  );
}
