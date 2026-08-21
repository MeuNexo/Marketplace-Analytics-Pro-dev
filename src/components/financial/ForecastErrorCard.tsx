// ============================================================================
// ForecastErrorCard — Fase 224 Plano 07, Task 3 (ERR-04)
//
// De quanto a própria previsão de caixa costuma errar, por horizonte, com a
// amostra que sustenta cada número. Mostra três coisas e nada além delas: a
// curva de erro, as saídas em separado das entradas, e o deflator vigente.
//
// 🔴 ENTRADAS E SAÍDAS NUNCA SÃO SOMADAS NUM NÚMERO DE SALDO AQUI. As entradas
// superestimam no curto prazo e desabam no longo; as saídas subestimam por 2 a
// 3% de ponta a ponta. Somados, os dois erros se cancelam parcialmente e
// produzem um saldo aparentemente quase certo que está errado dos dois lados
// (224-CURVA.md, resposta 3). É por isso que as duas colunas existem lado a
// lado e o card diz por quê.
//
// 🔴 NENHUM LIMIAR DE TOLERÂNCIA. O card NÃO diz "a previsão é confiável até
// D+N": mostra a curva e deixa o corte para o Wesley, que é o que a D-6 do
// 224-CONTEXT determina. Nem ±5% nem qualquer outro número aparece como
// aprovação.
//
// 🔴 DEFLATOR NULO É "NÃO MEDIDO", NUNCA 1,00. A coalescência para 1 existe só
// dentro do SQL do `get_cashflow`, onde a RPC precisa devolver número. Aqui,
// no caminho que vai para a tela, ausência de medição continua visível — ver o
// cabeçalho de `useEstornoDeflator.ts`.
// ============================================================================

import { useState } from "react";
import { Activity, ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useEstornoDeflator } from "@/hooks/useEstornoDeflator";
import {
  useForecastErrorCurve,
  ULTIMO_HORIZONTE_COMPARAVEL,
  DEFLATOR_SPAN_DIAS,
} from "@/hooks/useForecastErrorCurve";
import { N_MINIMO_PARA_PUBLICAR, type PontoDaCurva } from "@/lib/forecastErrorCurve";

const currFmt = (v: number): string =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fatorFmt = (v: number | null): string =>
  v == null ? "não medido" : v.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const pctFmt = (v: number | null): string =>
  v == null ? "não medido" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

/** Junta os dois escopos pelo horizonte, para as colunas ficarem lado a lado. */
function porHorizonte(
  entradas: PontoDaCurva[],
  saidas: PontoDaCurva[],
): Array<{ horizonte: number; entrada: PontoDaCurva | null; saida: PontoDaCurva | null }> {
  const horizontes = new Set<number>();
  for (const p of entradas) horizontes.add(p.horizonte);
  for (const p of saidas) horizontes.add(p.horizonte);
  return [...horizontes]
    .sort((a, b) => a - b)
    .map((h) => ({
      horizonte: h,
      entrada: entradas.find((p) => p.horizonte === h) ?? null,
      saida: saidas.find((p) => p.horizonte === h) ?? null,
    }));
}

export function ForecastErrorCard() {
  const [detalheAberto, setDetalheAberto] = useState(false);

  const { data: curva, isLoading: carregandoCurva, isError: erroCurva } = useForecastErrorCurve();
  const { data: deflator, isLoading: carregandoDeflator } = useEstornoDeflator();

  if (carregandoCurva || carregandoDeflator) {
    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-14 rounded-lg" />
          <Skeleton className="h-40 rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  if (erroCurva) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-destructive">
            Erro ao carregar o histórico de erro da previsão.
          </p>
        </CardContent>
      </Card>
    );
  }

  const linhas = porHorizonte(curva?.curvaEntradas ?? [], curva?.curvaSaidas ?? []);
  const temDeflator = deflator != null && deflator.deflator != null;

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        {/* ── Cabeçalho ── */}
        <div className="flex items-start gap-2">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-muted shrink-0">
            <Activity className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider font-medium text-muted-foreground leading-tight">
              De quanto esta previsão costuma errar
            </p>
            <p className="text-[11px] text-muted-foreground/60">
              Erro acumulado até o dia, por horizonte
            </p>
          </div>
        </div>

        {/* ── O deflator vigente. Nulo é "não medido", jamais 1,00 ── */}
        <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1">
          {temDeflator ? (
            <>
              <p className="text-sm">
                A tela desconta{" "}
                <span className="font-semibold tabular-nums">
                  {pctFmt(1 - (deflator.deflator as number))}
                </span>{" "}
                da agenda do Mercado Pago nos dias D+1 a D+{ULTIMO_HORIZONTE_COMPARAVEL} —
                é a parcela que historicamente é liberada e depois estornada.
              </p>
              <p className="text-[11px] text-muted-foreground">
                Deflator {fatorFmt(deflator.deflator)} · janela de {DEFLATOR_SPAN_DIAS} dias ·
                amostra: {deflator.diasNaSerie} dias com liberação,{" "}
                {currFmt(deflator.valorLiberado)} liberados e {currFmt(deflator.valorEstornado)}{" "}
                estornados em {deflator.parcelas} parcelas.
              </p>
            </>
          ) : (
            <p className="text-sm">
              O desconto de estorno <span className="font-semibold">não foi medido</span> nesta
              conta — não há liberação suficiente na janela para calcular a taxa. A projeção
              roda sem desconto nenhum, e não com desconto igual a zero por escolha.
            </p>
          )}
        </div>

        {/* ── A curva, entradas e saídas LADO A LADO, nunca somadas ── */}
        {linhas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ainda não há histórico de erro para esta conta: o backtest precisa de dias de
            agenda já vencidos para comparar o previsto com o realizado.
          </p>
        ) : (
          <div className="space-y-1">
            <div className="grid grid-cols-[3.5rem_1fr_1fr_3rem] gap-2 px-1 text-[11px] uppercase tracking-wider text-muted-foreground/70">
              <span>Prazo</span>
              <span className="text-right">Entradas</span>
              <span className="text-right">Saídas</span>
              <span className="text-right">n</span>
            </div>

            {linhas.map((linha) => (
              <div
                key={linha.horizonte}
                className="grid grid-cols-[3.5rem_1fr_1fr_3rem] gap-2 px-1 py-0.5 text-sm items-baseline border-b border-border/30 last:border-b-0"
              >
                <span className="text-muted-foreground tabular-nums">D+{linha.horizonte}</span>
                <span className="text-right font-medium tabular-nums">
                  {fatorFmt(linha.entrada?.fator ?? null)}
                </span>
                <span className="text-right font-medium tabular-nums">
                  {fatorFmt(linha.saida?.fator ?? null)}
                </span>
                <span className="text-right text-xs text-muted-foreground tabular-nums">
                  {linha.entrada?.n ?? linha.saida?.n ?? 0}
                  {(linha.entrada?.provisorio ?? true) && (
                    // A marca é a PALAVRA, nunca só a cor.
                    <span className="ml-1 text-[10px] font-medium text-kpi-negative">
                      provisório
                    </span>
                  )}
                </span>
              </div>
            ))}

            <p className="text-[11px] text-muted-foreground/70 pt-1 leading-relaxed">
              O número é quanto a previsão prometeu para cada real que de fato entrou (ou saiu):
              acima de 1 ela prometeu a mais, abaixo de 1 prometeu a menos. Entradas e saídas
              ficam separadas de propósito e não são somadas num número de saldo — elas erram em
              direções diferentes, e somadas se cancelam em parte, produzindo um saldo com cara
              de quase certo que está errado dos dois lados. Horizonte com menos de{" "}
              {N_MINIMO_PARA_PUBLICAR} observações sai marcado como provisório.
            </p>
          </div>
        )}

        {/* ── Detalhe: o erro absoluto ponderado, para quem quiser ── */}
        {linhas.length > 0 && (
          <Collapsible open={detalheAberto} onOpenChange={setDetalheAberto}>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${detalheAberto ? "rotate-180" : ""}`}
              />
              Erro absoluto por horizonte
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2 space-y-1">
              {linhas.map((linha) => (
                <div
                  key={linha.horizonte}
                  className="grid grid-cols-[3.5rem_1fr_1fr_3rem] gap-2 px-1 text-xs items-baseline"
                >
                  <span className="text-muted-foreground tabular-nums">D+{linha.horizonte}</span>
                  <span className="text-right tabular-nums">
                    {pctFmt(linha.entrada?.wape ?? null)}
                  </span>
                  <span className="text-right tabular-nums">
                    {pctFmt(linha.saida?.wape ?? null)}
                  </span>
                  <span className="text-right text-muted-foreground tabular-nums">
                    {linha.entrada?.n ?? linha.saida?.n ?? 0}
                  </span>
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground/70 pt-1">
                Erro absoluto sobre o realizado do mesmo horizonte. Diferente do número de cima:
                lá erros para mais e para menos se compensam, aqui não.
              </p>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* ── Procedência. Sem esta linha, um número provisório vira oficial no primeiro print ── */}
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed border-t border-border/40 pt-3">
          Esta curva é <span className="font-medium">reconstruída</span> do histórico — ela
          pergunta retroativamente o que a base sabia em cada dia passado — e por isso é{" "}
          <span className="font-medium">provisória</span>. Ela{" "}
          <span className="font-medium">subestima</span> o erro: estorno parcial sobrescreve o
          valor sem deixar vestígio e o Mercado Pago remaneja datas sem guardar histórico, e
          nenhum dos dois é recuperável. Será substituída pela curva medida contra o registro
          diário do que a previsão dizia no dia, assim que essa amostra chegar a 15 dias.
        </p>
      </CardContent>
    </Card>
  );
}
