// ============================================================================
// CashGapTable — Fase 224 Plano 07, Task 2 (ERR-04)
//
// A única saída desta fase que dispara decisão: em que datas dos próximos
// trinta dias falta dinheiro, de quanto, e qual é o pior caso plausível.
//
// A régua de utilidade da fase, literal: "se o output não dispara uma decisão
// concreta (prorrogar, antecipar, segurar compra), o indicador não vale o
// custo de manter". Um WAPE de 9% não dispara nada. A frase que dispara é
// "em 12/09 o saldo projetado é R$ 4.200, e no pior caso plausível é
// −R$ 6.800".
//
// 🔴 NENHUM LIMIAR DE TOLERÂNCIA MORA AQUI (D-6 do 224-CONTEXT). O único corte
// usado é o ZERO, e zero não é escolha de tolerância — é a definição de faltar
// dinheiro. O limiar da Pé Vermeio é decisão do Wesley depois de ver a curva.
//
// 🔴 AUSÊNCIA DE BANDA APARECE COM O MOTIVO ESCRITO, nunca como traço, zero ou
// silêncio. Os três motivos possíveis são nomeáveis e estão abaixo em
// `motivoSemBanda` — se algum dia surgir um caso sem motivo nomeável, o
// problema é a régua, não o texto.
//
// ⚠️ ATÉ ONDE A BANDA VALE. A banda vem do backtest do escopo `entradas`, que
// modela a AGENDA do Mercado Pago. De D+10 em diante a projeção da tela deixa
// de ler agenda e passa a usar a média de 15 dias como PISO — coisa que o
// backtest não modela (224-PROVA-DEFLATOR.md, M-01). Por isso o pior caso é
// publicado só até D+9, e nos dias seguintes a linha diz por quê. Publicar
// uma banda ali seria comparar duas coisas diferentes com cara de medição.
// ============================================================================

import { useMemo } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { format, addDays } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCashFlowData } from "@/hooks/useCashFlowData";
import {
  useForecastErrorCurve,
  ULTIMO_HORIZONTE_COMPARAVEL,
  HORIZONTE_MAXIMO,
} from "@/hooks/useForecastErrorCurve";
import {
  faixaDoHorizonte,
  saldoNoPiorCaso,
  type BandaDaFaixa,
} from "@/lib/forecastErrorCurve";

/** A janela da pergunta: "vai faltar dinheiro nos próximos trinta dias?" */
const DIAS_DA_JANELA = 30;

const currFmt = (v: number): string =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "2026-09-12" → Date local, sem o deslocamento de fuso do parse ISO. */
const parseDataSimples = (iso: string): Date => {
  const [y, m, d] = iso.substring(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};

const ROTULO_REGUA: Record<string, string> = {
  p95: "percentil 95",
  p90: "percentil 90",
  maximo: "pior caso já observado",
};

/**
 * Por que este dia não tem banda. Todos os motivos são nomeáveis — o sistema
 * não diz "não sei".
 */
function motivoSemBanda(horizonte: number, banda: BandaDaFaixa | null): string {
  if (horizonte <= 0) {
    return "hoje: o dia já está realizado, não há erro de previsão a medir";
  }
  if (horizonte > ULTIMO_HORIZONTE_COMPARAVEL) {
    return horizonte > HORIZONTE_MAXIMO
      ? `sem pior caso: o histórico de erro vai até D+${HORIZONTE_MAXIMO}`
      : `sem pior caso: a partir do 10º dia a projeção usa a média de 15 dias como piso, e o histórico de erro mede só a agenda do Mercado Pago — comparar os dois daria um número com cara de medição`;
  }
  if (banda == null || banda.n === 0) {
    return "sem pior caso: nenhum par observado neste horizonte";
  }
  return "sem pior caso: a banda deste horizonte não foi medida";
}

interface LinhaDeFalta {
  fullDate: string;
  dataLabel: string;
  horizonte: number;
  saldoProjetado: number;
  piorCaso: number | null;
  banda: BandaDaFaixa | null;
  /** Só preenchido quando não há pior caso — e aí diz o motivo. */
  semBanda: string | null;
}

export interface CashGapTableProps {
  /** Propaga o toggle da página: com ou sem as ordens de compra não faturadas. */
  includePurchaseForecasts?: boolean;
}

export function CashGapTable({ includePurchaseForecasts = false }: CashGapTableProps) {
  const { hoje, inicio, fim } = useMemo(() => {
    const agora = new Date();
    return {
      hoje: agora,
      inicio: format(agora, "yyyy-MM-dd"),
      fim: format(addDays(agora, DIAS_DA_JANELA), "yyyy-MM-dd"),
    };
  }, []);

  const {
    data: serie,
    isLoading: carregandoSerie,
    isError: erroSerie,
  } = useCashFlowData(inicio, fim, includePurchaseForecasts);

  const {
    data: erroCurva,
    isLoading: carregandoBanda,
    isError: erroBanda,
  } = useForecastErrorCurve();

  const { linhas, menorSaldo } = useMemo(() => {
    const pontos = serie ?? [];
    const bandas = erroCurva?.bandasSaldo ?? [];
    const hojeMs = parseDataSimples(format(hoje, "yyyy-MM-dd")).getTime();

    const achadas: LinhaDeFalta[] = [];
    let menor: { valor: number; fullDate: string } | null = null;

    for (const ponto of pontos) {
      const dia = parseDataSimples(ponto.fullDate);
      const horizonte = Math.round((dia.getTime() - hojeMs) / 86_400_000);
      if (horizonte < 0 || horizonte > DIAS_DA_JANELA) continue;

      const saldoProjetado = ponto.accumulated_balance;
      if (menor == null || saldoProjetado < menor.valor) {
        menor = { valor: saldoProjetado, fullDate: ponto.fullDate };
      }

      // A banda só descreve a projeção até D+9 — ver o cabeçalho.
      const faixa =
        horizonte >= 1 && horizonte <= ULTIMO_HORIZONTE_COMPARAVEL
          ? faixaDoHorizonte(horizonte)
          : null;
      const banda = faixa == null ? null : bandas.find((b) => b.faixa === faixa) ?? null;
      const piorCaso = saldoNoPiorCaso(saldoProjetado, banda);

      if (saldoProjetado < 0 || (piorCaso != null && piorCaso < 0)) {
        achadas.push({
          fullDate: ponto.fullDate,
          dataLabel: format(dia, "dd/MM"),
          horizonte,
          saldoProjetado,
          piorCaso,
          banda,
          semBanda: piorCaso == null ? motivoSemBanda(horizonte, banda) : null,
        });
      }
    }

    return { linhas: achadas, menorSaldo: menor };
  }, [serie, erroCurva, hoje]);

  if (carregandoSerie || carregandoBanda) {
    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  if (erroSerie) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-destructive">
            Erro ao carregar a projeção de caixa — as datas com falta de dinheiro não puderam
            ser calculadas.
          </p>
        </CardContent>
      </Card>
    );
  }

  const janelaLabel = `${format(hoje, "dd/MM")} a ${format(addDays(hoje, DIAS_DA_JANELA), "dd/MM")}`;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        {/* ── Cabeçalho ── */}
        <div className="flex items-start gap-2">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-muted shrink-0">
            {linhas.length > 0 ? (
              <AlertTriangle className="w-4 h-4 text-kpi-negative" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-kpi-positive" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider font-medium text-muted-foreground leading-tight">
              Vai faltar dinheiro?
            </p>
            <p className="text-[11px] text-muted-foreground/60">
              Próximos {DIAS_DA_JANELA} dias · {janelaLabel}
            </p>
          </div>
        </div>

        {/* ── Nenhuma data negativa: isto TAMBÉM é uma resposta, e dispara "pode pagar" ── */}
        {linhas.length === 0 ? (
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1">
            <p className="text-sm font-medium">
              Nenhuma data negativa nos próximos {DIAS_DA_JANELA} dias — nem no pior caso.
            </p>
            {menorSaldo != null && (
              <p className="text-xs text-muted-foreground">
                O menor saldo do período é {currFmt(menorSaldo.valor)}, em{" "}
                {format(parseDataSimples(menorSaldo.fullDate), "dd/MM")}.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {linhas.map((linha) => (
              // Chave = a data-alvo: sempre presente e única na série. Campo
              // nulável como chave de React já quebrou agrupamento e três
              // filtros de uma vez na tela de compras, e `strictNullChecks`
              // está desligado neste projeto — não avisa.
              <div
                key={linha.fullDate}
                className="rounded-lg border border-border/60 p-3 space-y-1"
              >
                <p className="text-sm">
                  <span className="font-medium tabular-nums">{linha.dataLabel}</span>{" "}
                  <span className="text-muted-foreground text-xs">(D+{linha.horizonte})</span>{" "}
                  — saldo projetado{" "}
                  <span
                    className={`font-semibold tabular-nums ${
                      linha.saldoProjetado < 0 ? "text-kpi-negative" : ""
                    }`}
                  >
                    {currFmt(linha.saldoProjetado)}
                  </span>
                  {linha.piorCaso != null && (
                    <>
                      , e no pior caso plausível{" "}
                      <span
                        className={`font-semibold tabular-nums ${
                          linha.piorCaso < 0 ? "text-kpi-negative" : ""
                        }`}
                      >
                        {currFmt(linha.piorCaso)}
                      </span>
                    </>
                  )}
                  .
                </p>

                {linha.piorCaso != null && linha.banda != null ? (
                  <p className="text-[11px] text-muted-foreground">
                    Pior caso medido em {linha.banda.faixa.rotulo} pelo{" "}
                    {ROTULO_REGUA[linha.banda.regua] ?? linha.banda.regua}, com n ={" "}
                    <span className="tabular-nums">{linha.banda.n}</span>
                    {linha.banda.provisorio && (
                      <span className="ml-1 font-medium text-kpi-negative">
                        · provisório, amostra pequena
                      </span>
                    )}
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">{linha.semBanda}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Procedência: o que a banda é, e até onde ela vale ── */}
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
          O pior caso é o saldo projetado menos o erro histórico daquele horizonte — erro é o
          que a agenda prometeu menos o que entrou, então o cenário ruim é o de maior promessa
          não cumprida. Ele é publicado até D+{ULTIMO_HORIZONTE_COMPARAVEL}, que é até onde a
          projeção lê a agenda do Mercado Pago; a partir do 10º dia ela usa a média de 15 dias
          como piso, e o histórico de erro não mede o piso.
          {erroBanda && (
            <span className="block mt-1 text-destructive">
              O histórico de erro não pôde ser lido agora — as datas acima estão sem pior caso
              por falha de leitura, não por ausência de medição.
            </span>
          )}
        </p>
      </CardContent>
    </Card>
  );
}
