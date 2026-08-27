// ============================================================================
// ForecastErrorCard — Fase 230 Plano 02, Task 2 (CX-05)
//
// De quanto a previsão de caixa costuma errar, em UMA FRASE. O card da Fase
// 224 abria com a curva inteira e foi rejeitado pelo Wesley no mesmo dia em que
// subiu ("virou uma frase só"): a tabela por horizonte não dispara decisão. Ela
// não sumiu — saiu do primeiro plano e segue a um clique, com o deflator e o
// erro absoluto. A frase é decidida em `src/lib/frasePrevisao.ts`, módulo puro
// e testado; este componente não monta texto por conta própria.
//
// 🔴 ENTRADAS E SAÍDAS NUNCA SÃO SOMADAS NUM NÚMERO DE SALDO AQUI. Somados, os
// dois erros se cancelam em parte e produzem um saldo aparentemente quase certo
// que está errado dos dois lados (224-CURVA.md, resposta 3). Por isso a frase
// diz a palavra ENTRADAS e as duas colunas do detalhe seguem lado a lado.
//
// 🔴 NENHUM LIMIAR DE TOLERÂNCIA. O "confie até o dia N" não é limiar aprovado
// de erro: N é `ULTIMO_HORIZONTE_COMPARAVEL`, a fronteira MEDIDA em que a
// projeção deixa de ler a agenda do MP (224-CURVA.md, C-02). O corte de
// tolerância é do Wesley — D-6 do 224-CONTEXT.
//
// 🔴 DEFLATOR NULO É "NÃO MEDIDO", NUNCA 1,00. A coalescência para 1 existe só
// dentro do SQL do `get_cashflow` — ver o cabeçalho de `useEstornoDeflator.ts`.
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
import { resolveFrasePrevisao } from "@/lib/frasePrevisao";
import { useConfiancaDoSaldo } from "@/hooks/useConfiancaDoSaldo";
import { CurvaDeConfianca } from "./CurvaDeConfianca";

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

  const { data: curva, isLoading: carregandoCurva, isError: erroCurva, error: detalheErro } = useForecastErrorCurve();
  const { data: deflator, isLoading: carregandoDeflator } = useEstornoDeflator();

  if (carregandoCurva || carregandoDeflator) {
    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-10 rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  if (erroCurva) {
    return (
      <Card>
        <CardContent className="p-4">
          {/* A ausência NOMEIA o motivo — regra da casa (Wesley, 21/08). Engolir
              a mensagem do banco aqui custou uma sessão inteira de diagnóstico
              às cegas: a tela dizia "erro" e o erro real nunca chegava a
              ninguém. Ver src/lib/rebateLinhaCenarios.ts. */}
          <p className="text-xs text-destructive">
            Não foi possível carregar o histórico de erro da previsão.
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground break-words">
            {detalheErro instanceof Error ? detalheErro.message : "sem detalhe devolvido pelo banco"}
          </p>
        </CardContent>
      </Card>
    );
  }

  const linhas = porHorizonte(curva?.curvaEntradas ?? [], curva?.curvaSaidas ?? []);
  const temDeflator = deflator != null && deflator.deflator != null;
  const frase = resolveFrasePrevisao({
    curvaEntradas: curva?.curvaEntradas ?? [],
    horizonteLimite: ULTIMO_HORIZONTE_COMPARAVEL,
    nMinimo: N_MINIMO_PARA_PUBLICAR,
  });

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        {/* ── Cabeçalho: a pergunta em texto ── */}
        <div className="flex items-start gap-2">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-muted shrink-0">
            <Activity className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider font-medium text-muted-foreground leading-tight">
              Dá para confiar nessa previsão?
            </p>
            <p className="text-[11px] text-muted-foreground/60">
              Erro histórico das entradas, por horizonte
            </p>
          </div>
        </div>

        {/* ── A FRASE, sozinha. `data-frase-previsao` é prova de régua: permite captura de
             tela e teste de regressão visual, como `data-selo-promo`. A cor sai do estado
             nomeado, nunca de um número solto. ── */}
        <p
          data-frase-previsao={frase.estado}
          title={frase.titulo}
          className={`text-base leading-snug ${
            frase.estado === "nao_medido" ? "text-muted-foreground" : "text-foreground"
          }`}
        >
          {frase.texto}
        </p>

        {/* ── 233-02: a curva de confiança do SALDO ────────────────────────────
            A ordem é a decisão: frase (o que decide) → curva (o que contextualiza)
            → detalhe (o que audita). Isso honra a 230 — que tirou a curva de
            ENTRADAS do primeiro plano — e entrega o que o Wesley pediu em 27/08:
            *"ver o cenário ao longo do tempo e o quanto posso confiar de 0 a 100%"*.

            🔴 Esta curva é do SALDO, medida contra o saldo DECLARADO por ele —
            não a de entradas por horizonte que ele rejeitou na 230. */}
        <CurvaDeConfianca />

        {/* ── Tudo o mais, recolhido: a curva por horizonte, o n, o deflator e o erro absoluto ── */}
        <Collapsible open={detalheAberto} onOpenChange={setDetalheAberto}>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform ${detalheAberto ? "rotate-180" : ""}`}
            />
            Ver a curva por horizonte
          </CollapsibleTrigger>

          <CollapsibleContent className="pt-3 space-y-3">
            {/* O deflator vigente. Nulo é "não medido", jamais 1,00. */}
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

            {/* A curva, entradas e saídas LADO A LADO, nunca somadas. */}
            {linhas.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Ainda não há histórico de erro para esta conta: o backtest precisa de dias de
                agenda já vencidos para comparar o previsto com o realizado.
              </p>
            ) : (
              <div className="space-y-1">
                <div className="grid grid-cols-[3.5rem_1fr_1fr_1fr_3rem] gap-2 px-1 text-[11px] uppercase tracking-wider text-muted-foreground/70">
                  <span>Prazo</span>
                  <span className="text-right">Entradas</span>
                  <span className="text-right">Saídas</span>
                  <span className="text-right">Erro abs.</span>
                  <span className="text-right">n</span>
                </div>

                {linhas.map((linha) => (
                  <div
                    key={linha.horizonte}
                    className="grid grid-cols-[3.5rem_1fr_1fr_1fr_3rem] gap-2 px-1 py-0.5 text-sm items-baseline border-b border-border/30 last:border-b-0"
                  >
                    <span className="text-muted-foreground tabular-nums">D+{linha.horizonte}</span>
                    <span className="text-right font-medium tabular-nums">
                      {fatorFmt(linha.entrada?.fator ?? null)}
                    </span>
                    <span className="text-right font-medium tabular-nums">
                      {fatorFmt(linha.saida?.fator ?? null)}
                    </span>
                    <span className="text-right text-xs text-muted-foreground tabular-nums">
                      {pctFmt(linha.entrada?.wape ?? null)}
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
                  O número é quanto a previsão prometeu para cada real que de fato entrou (ou
                  saiu): acima de 1 prometeu a mais, abaixo de 1 prometeu a menos. Entradas e
                  saídas não são somadas num número de saldo — erram em direções diferentes e,
                  somadas, se cancelam em parte, produzindo um saldo com cara de quase certo que
                  está errado dos dois lados. O erro absoluto é sobre o realizado do mesmo
                  horizonte: ali, diferente do fator, erros para mais e para menos não se
                  compensam. Menos de {N_MINIMO_PARA_PUBLICAR} observações sai como provisório.
                </p>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* ── Procedência. Sem ela um número provisório vira oficial no primeiro print ── */}
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
