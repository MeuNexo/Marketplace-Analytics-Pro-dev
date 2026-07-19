// ============================================================================
// DreCashForecastCard — Phase 100 Plan 02, Task 2
// Card "Fechar o mês" no topo da /dre-caixa (mês corrente): responde "quanto
// falta entrar para o mês fechar no zero (ou na meta), e quanto preciso
// vender até que dia?" (D-01, 100-CONTEXT).
//
// Fontes EXCLUSIVAS: useDreCashForecast (RPC get_dre_cash_forecast, 100-01) +
// a lib pura dreCashForecast.ts — toda a matemática do painel vem da lib, o
// card nunca recalcula gap/ritmo por conta própria. Zero acoplamento com a
// página de tesouraria/projeção de saldo (Separações, D-09): nenhuma leitura
// das RPCs/tabelas de saldo daquela página aqui.
//
// Meta é 100% client-side (D-04) — useState local em memória, sem escrita em
// banco e sem persistência no navegador. O alerta de recorrência (D-06/BEC-04)
// é sempre exibido em tom NEUTRO/informativo — nunca como erro (lição da
// recorrência acidental de ads/full de 2026-07-17).
// ============================================================================

import { useMemo, useState } from "react";
import { addDays, format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, ChevronDown, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildDreCashForecast, type DreCashForecastSemaforo } from "@/lib/dreCashForecast";
import { useDreCashForecast } from "@/hooks/useDreCashForecast";

const fmtBR = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;

interface DreCashForecastCardProps {
  pMonth: string;
}

const SEMAFORO_STYLES: Record<
  DreCashForecastSemaforo,
  { pill: string; Icon: typeof TrendingUp; label: string }
> = {
  verde: {
    pill: "bg-kpi-positive/10 text-kpi-positive border-kpi-positive/30",
    Icon: TrendingUp,
    label: "no ritmo",
  },
  vermelho: {
    pill: "bg-kpi-negative/10 text-kpi-negative border-kpi-negative/30",
    Icon: TrendingDown,
    label: "abaixo do ritmo",
  },
  neutro: {
    pill: "bg-muted text-muted-foreground border-border",
    Icon: Minus,
    label: "mês já fecha na meta",
  },
};

export function DreCashForecastCard({ pMonth }: DreCashForecastCardProps) {
  const [meta, setMeta] = useState<number>(0);
  const [metaInput, setMetaInput] = useState<string>("0");
  const [explicabilidadeOpen, setExplicabilidadeOpen] = useState(false);

  const { data: rows, isLoading, isError, refetch } = useDreCashForecast(pMonth, true);

  // Toda a matemática do painel vem da lib pura — o card NUNCA recalcula
  // gap/ritmo por conta própria.
  const forecast = useMemo(
    () => buildDreCashForecast(rows ?? [], { meta, hoje: new Date() }),
    [rows, meta],
  );

  // Valores crus só para completar a explicabilidade (display puro, sem
  // matemática nova) — taxa_estornos/taxa_liquido_bruto não fazem parte da
  // interface de saída da lib (100-02-PLAN Task 1), só do drill de composição.
  const taxaEstornos = rows?.find((r) => r.secao === "taxa" && r.categoria === "taxa_estornos")?.total ?? null;
  const taxaLiquidoBruto =
    rows?.find((r) => r.secao === "taxa" && r.categoria === "taxa_liquido_bruto")?.total ?? null;

  const handleMetaChange = (v: string) => {
    setMetaInput(v);
    const parsed = Number(v.replace(",", "."));
    setMeta(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-7 w-full max-w-sm" />
          <Skeleton className="h-4 w-2/3" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Erro ao carregar a previsão de fechamento</AlertTitle>
        <AlertDescription>
          <button type="button" onClick={() => refetch()} className="underline">
            Tentar novamente
          </button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!forecast.hasData) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">Sem dados de previsão para este mês.</p>
        </CardContent>
      </Card>
    );
  }

  const diaLimiteLabel = format(forecast.diaLimite, "dd/MM", { locale: ptBR });
  const diaAposLimiteLabel = format(addDays(forecast.diaLimite, 1), "dd/MM", { locale: ptBR });
  const semaforo = SEMAFORO_STYLES[forecast.semaforo];

  // Cascata narrativa (Phase 100 fix 2026-07-17 — feedback do dono no
  // checkpoint visual): "buraco do mês" negativo = falta entrar; positivo =
  // sobra. Mesma matemática de forecast.gapComMeta, só invertida para contar
  // a história em ordem de leitura (dinheiro que falta, não dinheiro que sai).
  const buracoDoMes = -forecast.gapComMeta;
  const taxaReaisPor100 = forecast.taxaVendaParaCaixa === null ? null : forecast.taxaVendaParaCaixa * 100;

  // Manchete "se continuar no ritmo atual, o mês fecha em ~R$ X" (Phase 100
  // fix 2026-07-17 — pedido do dono no checkpoint): lógica dele é "hoje
  // estamos assim → se continuar, resultado será X (bom/ruim) → correr atrás
  // pra manter ou melhorar". Vem ANTES da meta/venda necessária. Independe
  // da meta (a lib usa gap, não gapComMeta) — comparamos aqui contra a meta
  // só pra colorir o veredito (mês cobre a meta que o dono digitou ou não).
  const mesLabel = format(parseISO(pMonth), "MMMM", { locale: ptBR });
  const projetadoOk = forecast.resultadoProjetado !== null && forecast.resultadoProjetado >= meta;
  const projetadoLabel =
    forecast.resultadoProjetado === null
      ? ""
      : projetadoOk
        ? forecast.resultadoProjetado > meta
          ? "sobra"
          : "mês se paga"
        : "faltando — sai de outro lugar";

  return (
    <Card className="border-primary/20">
      <CardContent className="p-4 space-y-4">
        <p className="text-sm font-semibold">Fechar o mês</p>

        {/* Cascata narrativa (D-01/D-02/D-08) — conta a história do mês passo
            a passo. O gap final NUNCA aparece sem as 3 linhas acima dele. */}
        <div className="space-y-2.5 border-l-2 border-border pl-3">
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">Placar de hoje</span>
              <span
                className={`text-sm font-semibold tabular-nums ${
                  forecast.placarHoje >= 0 ? "text-kpi-positive" : "text-kpi-negative"
                }`}
              >
                {forecast.placarHoje >= 0 ? "+" : ""}
                {fmtBR(forecast.placarHoje)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">O que já entrou menos o que já saiu</p>
          </div>

          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">Ainda vai sair até o fim do mês</span>
              <span className="text-sm font-semibold tabular-nums text-kpi-negative">
                -{fmtBR(forecast.aindaVaiSair)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Contas a vencer no Tiny + estornos e imposto previstos
            </p>
          </div>

          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">Já garantido a entrar</span>
              <span className="text-sm font-semibold tabular-nums text-kpi-positive">
                +{fmtBR(forecast.entradasGarantidas.agendadas)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Vendas já feitas com liberação agendada no Mercado Pago
            </p>
          </div>

          <div className="pt-2 border-t border-border">
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <span className="text-sm font-semibold">
                {buracoDoMes < 0 ? "= Buraco do mês" : "= Sobra do mês"}
              </span>
              <span
                className={`text-lg sm:text-xl font-bold tabular-nums ${
                  buracoDoMes < 0 ? "text-kpi-negative" : "text-kpi-positive"
                }`}
              >
                {fmtBR(Math.abs(buracoDoMes))}
              </span>
            </div>

            {/* Meta editável (D-04) — 100% client-side, zero rede, zero banco */}
            <div className="flex items-center gap-2 mt-1.5">
              <Label htmlFor="dre-cash-forecast-meta" className="text-xs text-muted-foreground whitespace-nowrap">
                {buracoDoMes < 0 ? "Pra fechar no zero, ou quero sobrar (R$)" : "Quero que sobre (R$)"}
              </Label>
              <Input
                id="dre-cash-forecast-meta"
                type="number"
                min={0}
                step={100}
                inputMode="decimal"
                value={metaInput}
                onChange={(e) => handleMetaChange(e.target.value)}
                className="h-8 max-w-[140px] text-sm"
              />
            </div>
          </div>
        </div>

        {/* Manchete — projeção "se continuar no ritmo atual" (Phase 100 fix
            2026-07-17, pedido do dono no checkpoint). Vem ANTES da
            meta/venda necessária, que agora é o "plano de reação". */}
        {forecast.resultadoProjetado !== null && (
          <div
            className={`rounded-md border p-3 ${
              projetadoOk
                ? "bg-kpi-positive/10 border-kpi-positive/30"
                : "bg-kpi-negative/10 border-kpi-negative/30"
            }`}
          >
            <p className="text-sm sm:text-base">
              No ritmo atual (~{fmtBR(forecast.ritmoReal7d)}/dia), <span className="font-medium">{mesLabel}</span>{" "}
              fecha em{" "}
              <span className={`font-bold ${projetadoOk ? "text-kpi-positive" : "text-kpi-negative"}`}>
                ~{fmtBR(forecast.resultadoProjetado)}
              </span>
            </p>
            <p
              className={`text-xs font-medium mt-0.5 ${projetadoOk ? "text-kpi-positive" : "text-kpi-negative"}`}
            >
              {projetadoLabel}
            </p>
          </div>
        )}

        {/* Tradução em venda — destaque final (D-02/D-03/D-05) */}
        <div className="rounded-md bg-muted/40 p-3 space-y-1.5">
          <p className="text-sm">
            De cada R$ 100 vendidos, ~{taxaReaisPor100 === null ? "—" : fmtBR(taxaReaisPor100)} viram caixa e levam
            ~{forecast.lagLiberacaoDias} dias pra cair.
          </p>

          {forecast.vendaNecessaria === null ? (
            <p className="text-sm">
              Venda necessária: <span className="font-semibold">—</span>{" "}
              <span className="text-xs text-muted-foreground">
                (sem dados suficientes para medir a conversão venda→caixa)
              </span>
            </p>
          ) : forecast.vendaNecessaria === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma venda extra é necessária — o mês já fecha {meta > 0 ? "na meta" : "no zero"}.
            </p>
          ) : (
            <p className="text-base sm:text-lg font-bold">
              Para fechar {meta > 0 ? `com sobra de ${fmtBR(meta)}` : "no zero"}: vender ~
              {fmtBR(forecast.vendaNecessaria)} em faturamento até dia {diaLimiteLabel}
              {forecast.ritmoNecessario !== null && (
                <span className="text-sm font-medium text-muted-foreground">
                  {" "}
                  (~{fmtBR(forecast.ritmoNecessario)}/dia)
                </span>
              )}
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            Vendas a partir de {diaAposLimiteLabel} só viram caixa no mês seguinte.
          </p>

          {forecast.prazoEsgotado && (
            <div className="flex items-start gap-1.5 mt-1 text-amber-600 dark:text-amber-500 text-xs bg-amber-500/10 border border-amber-500/30 rounded-md px-2 py-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Vendas novas não viram mais caixa este mês — o gap só fecha com as liberações já agendadas.</span>
            </div>
          )}

          <div className="flex items-center justify-between flex-wrap gap-2 text-sm pt-1">
            <span>
              Ritmo real de vendas (7d): <span className="font-semibold tabular-nums">{fmtBR(forecast.ritmoReal7d)}/dia</span>
            </span>
            <span
              className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${semaforo.pill}`}
            >
              <semaforo.Icon className="w-3 h-3" />
              {semaforo.label}
            </span>
          </div>
        </div>

        {/* Explicabilidade — cada número do painel é explicável (Specifics do CONTEXT) */}
        <Collapsible open={explicabilidadeOpen} onOpenChange={setExplicabilidadeOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform duration-150 ${explicabilidadeOpen ? "rotate-0" : "-rotate-90"}`}
              />
              Como esse número é calculado
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 space-y-1 text-[11px] text-muted-foreground border-t border-border/50 pt-2">
              <p className="font-medium text-foreground/80">Saídas previstas do mês</p>
              <div className="flex justify-between">
                <span>Já pagas</span>
                <span className="tabular-nums">{fmtBR(forecast.saidasPrevistas.pagas)}</span>
              </div>
              <div className="flex justify-between">
                <span>Estornos ocorridos</span>
                <span className="tabular-nums">{fmtBR(forecast.saidasPrevistas.estornosOcorridos)}</span>
              </div>
              <div className="flex justify-between">
                <span>A pagar até o fim do mês</span>
                <span className="tabular-nums">{fmtBR(forecast.saidasPrevistas.pendentes)}</span>
              </div>
              <div className="flex justify-between">
                <span>
                  Estornos previstos{taxaEstornos !== null ? ` (${fmtPct(taxaEstornos)} × agendadas)` : ""}
                </span>
                <span className="tabular-nums">{fmtBR(forecast.saidasPrevistas.estornosPrevistos)}</span>
              </div>
              <div className="flex justify-between">
                <span>Imposto previsto restante</span>
                <span className="tabular-nums">{fmtBR(forecast.saidasPrevistas.impostoPrevistoRestante)}</span>
              </div>

              <p className="font-medium text-foreground/80 mt-2">Entradas garantidas do mês</p>
              <div className="flex justify-between">
                <span>Já liberadas</span>
                <span className="tabular-nums">{fmtBR(forecast.entradasGarantidas.liberadas)}</span>
              </div>
              <div className="flex justify-between">
                <span>Agendadas a liberar</span>
                <span className="tabular-nums">{fmtBR(forecast.entradasGarantidas.agendadas)}</span>
              </div>

              <p className="font-medium text-foreground/80 mt-2">Conversão</p>
              <div className="flex justify-between">
                <span>Venda → caixa</span>
                <span className="tabular-nums">
                  {forecast.taxaVendaParaCaixa === null ? "—" : fmtPct(forecast.taxaVendaParaCaixa)}
                </span>
              </div>
              {taxaLiquidoBruto !== null && (
                <div className="flex justify-between">
                  <span>Líquido/bruto médio</span>
                  <span className="tabular-nums">{fmtPct(taxaLiquidoBruto)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Prazo médio de liberação</span>
                <span className="tabular-nums">{forecast.lagLiberacaoDias} dias</span>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* 6. Alerta de recorrência (D-06/BEC-04) — SEMPRE neutro/informativo */}
        {forecast.alertasRecorrencia.length > 0 && (
          <Alert className="bg-muted/50 border-border">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            <AlertTitle className="text-xs font-medium">
              Contas pendentes deste mês também se repetem em meses futuros
            </AlertTitle>
            <AlertDescription>
              <p className="text-[11px] text-muted-foreground mb-1">
                Confira se não é recorrência acidental no Tiny:
              </p>
              <ul className="space-y-0.5">
                {forecast.alertasRecorrencia.map((a) => (
                  <li key={a.categoria} className="text-[11px] text-muted-foreground flex justify-between gap-2">
                    <span>{a.categoria}</span>
                    <span className="tabular-nums shrink-0">
                      {fmtBR(a.valor)} (aparece em {a.mesesFuturos} {a.mesesFuturos === 1 ? "mês futuro" : "meses futuros"})
                    </span>
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
