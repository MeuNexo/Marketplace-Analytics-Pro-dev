// ============================================================================
// CashGapTable — Fase 230 Plano 02, Task 3 (CX-03) · orig. Fase 224 Plano 07
//
// Em que datas das próximas treze semanas falta dinheiro, de quanto, e qual é
// o pior caso plausível. O card abre com UM VEREDITO DE UMA LINHA — a primeira
// data em que falta dinheiro, ou a confirmação de que nenhuma falta — e as
// demais datas ficam recolhidas. O formato de 224 listava todas as datas de
// uma vez e foi rejeitado pelo Wesley por densidade; nenhuma medição saiu,
// só o que abre.
//
// A régua de utilidade, literal: "se o output não dispara uma decisão concreta
// (prorrogar, antecipar, segurar compra), o indicador não vale o custo de
// manter". Um WAPE de 9% não dispara nada. A frase que dispara é "em 12/09 o
// saldo projetado é R$ 4.200, e no pior caso plausível é −R$ 6.800".
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
// 🔴 A JANELA DA PERGUNTA É MAIOR QUE A DA MEDIÇÃO, E ISSO FICA ESCRITO NA
// TELA. A pergunta olha treze semanas (`HORIZONTE_TESOURARIA_DIAS`); o pior
// caso continua parando em D+9. Uma janela de 91 dias com banda de 9 dias é
// exatamente o tipo de número que parece medição e não é — por isso o rodapé
// declara a assimetria e cada dia sem banda continua dizendo por quê.
//
// ⚠️ ATÉ ONDE A BANDA VALE. A banda vem do backtest do escopo `entradas`, que
// modela a AGENDA do Mercado Pago. De D+10 em diante a projeção da tela deixa
// de ler agenda e passa a usar a média de 15 dias como PISO — coisa que o
// backtest não modela (224-PROVA-DEFLATOR.md, M-01). Por isso o pior caso é
// publicado só até D+9, e nos dias seguintes a linha diz por quê. Publicar
// uma banda ali seria comparar duas coisas diferentes com cara de medição.
// ============================================================================

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown } from "lucide-react";
import { format, addDays } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import {
  HORIZONTE_TESOURARIA_DIAS,
  HORIZONTE_TESOURARIA_SEMANAS,
} from "@/lib/horizonteTesouraria";

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

/**
 * Uma data negativa no formato completo — o mesmo de antes da redução. Vive
 * fora do card porque agora é usado dentro do recolhido, não no primeiro plano.
 */
function DetalheDaData({ linha }: { linha: LinhaDeFalta }) {
  return (
    <div className="rounded-lg border border-border/60 p-3 space-y-1">
      <p className="text-sm">
        <span className="font-medium tabular-nums">{linha.dataLabel}</span>{" "}
        <span className="text-muted-foreground text-xs">(D+{linha.horizonte})</span> — saldo
        projetado{" "}
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
  );
}

export interface CashGapTableProps {
  /** Propaga o toggle da página: com ou sem as ordens de compra não faturadas. */
  includePurchaseForecasts?: boolean;
}

export function CashGapTable({ includePurchaseForecasts = false }: CashGapTableProps) {
  const [demaisAbertas, setDemaisAbertas] = useState(false);
  const [saibaMaisAberto, setSaibaMaisAberto] = useState(false);

  const { hoje, inicio, fim } = useMemo(() => {
    const agora = new Date();
    return {
      hoje: agora,
      inicio: format(agora, "yyyy-MM-dd"),
      fim: format(addDays(agora, HORIZONTE_TESOURARIA_DIAS), "yyyy-MM-dd"),
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
      if (horizonte < 0 || horizonte > HORIZONTE_TESOURARIA_DIAS) continue;

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

  const janelaLabel = `${format(hoje, "dd/MM")} a ${format(addDays(hoje, HORIZONTE_TESOURARIA_DIAS), "dd/MM")}`;
  const primeira = linhas.length > 0 ? linhas[0] : null;
  const demais = linhas.slice(1);

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
              Próximas {HORIZONTE_TESOURARIA_SEMANAS} semanas · {janelaLabel}
            </p>
          </div>
        </div>

        {/* ── O VEREDITO, em uma linha. Nenhuma data negativa TAMBÉM é resposta, e
             dispara "pode pagar" ── */}
        {primeira == null ? (
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1">
            <p className="text-sm font-medium">
              Nenhuma data negativa nas próximas {HORIZONTE_TESOURARIA_SEMANAS} semanas — nem no
              pior caso.
            </p>
            {menorSaldo != null && (
              <p className="text-xs text-muted-foreground">
                O menor saldo do período é {currFmt(menorSaldo.valor)}, em{" "}
                {format(parseDataSimples(menorSaldo.fullDate), "dd/MM")}.
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-border/60 p-3 space-y-1">
            <p className="text-sm">
              Falta dinheiro em{" "}
              <span className="font-semibold tabular-nums">{primeira.dataLabel}</span>{" "}
              <span className="text-muted-foreground text-xs">(D+{primeira.horizonte})</span> —
              saldo projetado{" "}
              <span
                className={`font-semibold tabular-nums ${
                  primeira.saldoProjetado < 0 ? "text-kpi-negative" : ""
                }`}
              >
                {currFmt(primeira.saldoProjetado)}
              </span>
              {primeira.piorCaso != null && (
                <>
                  , e no pior caso plausível{" "}
                  <span
                    className={`font-semibold tabular-nums ${
                      primeira.piorCaso < 0 ? "text-kpi-negative" : ""
                    }`}
                  >
                    {currFmt(primeira.piorCaso)}
                  </span>
                </>
              )}
              .{demais.length > 0 && ` Outras ${demais.length} datas negativas na janela.`}
            </p>
            {/* Ausência de banda continua com o motivo escrito, inclusive no veredito. */}
            {primeira.semBanda != null && (
              <p className="text-[11px] text-muted-foreground">{primeira.semBanda}</p>
            )}
          </div>
        )}

        {/* ── As demais datas, recolhidas. Nada de medição sai; muda o que abre ── */}
        {demais.length > 0 && (
          <Collapsible open={demaisAbertas} onOpenChange={setDemaisAbertas}>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${demaisAbertas ? "rotate-180" : ""}`}
              />
              Ver as outras {demais.length} datas negativas
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2 space-y-2">
              {demais.map((linha) => (
                // Chave = a data-alvo: sempre presente e única na série. Campo
                // nulável como chave de React já quebrou agrupamento e três
                // filtros de uma vez na tela de compras, e `strictNullChecks`
                // está desligado neste projeto — não avisa.
                <DetalheDaData key={linha.fullDate} linha={linha} />
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* 🔴 A ausência de banda NOMEIA o motivo real (falha de leitura, não
            ausência de medição) — fica À VISTA, não é procedência. */}
        {erroBanda && (
          <p className="text-[11px] text-destructive">
            O histórico de erro não pôde ser lido agora — as datas acima estão sem pior caso
            por falha de leitura, não por ausência de medição.
          </p>
        )}

        {/* ── 233-07 (D-14) — a procedência (224-07) é EXPLICAÇÃO: o que a
            banda É e até onde ela vale, não proteção de leitura de número à
            vista. Vai para o "saiba mais" — nenhuma frase foi apagada
            (233-TEXTO.md). ── */}
        <Collapsible open={saibaMaisAberto} onOpenChange={setSaibaMaisAberto}>
          <CollapsibleTrigger className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <ChevronDown
              className={`w-3 h-3 transition-transform ${saibaMaisAberto ? "rotate-180" : ""}`}
            />
            Saiba mais
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
              O pior caso é o saldo projetado menos o erro histórico daquele horizonte — erro é o
              que a agenda prometeu menos o que entrou, então o cenário ruim é o de maior promessa
              não cumprida. Ele é publicado até D+{ULTIMO_HORIZONTE_COMPARAVEL}, que é até onde a
              projeção lê a agenda do Mercado Pago; a partir do 10º dia ela usa a média de 15 dias
              como piso, e o histórico de erro não mede o piso.{" "}
              <span className="font-medium">
                A pergunta olha {HORIZONTE_TESOURARIA_SEMANAS} semanas, a medição de pior caso alcança{" "}
                {ULTIMO_HORIZONTE_COMPARAVEL} dias
              </span>{" "}
              — ampliar a janela não amplia a validade da banda, e por isso a esmagadora maioria das
              datas aparece sem pior caso, cada uma dizendo o motivo.
            </p>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
