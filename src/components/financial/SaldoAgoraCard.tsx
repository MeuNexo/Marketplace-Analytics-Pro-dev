// ============================================================================
// SaldoAgoraCard — Fase 233 Plano 06 (D-11)
//
// 🔴 O NÚMERO GRANDE DA TELA É O SALDO DE AGORA. Escolha do Wesley em
// 27/08/2026, depois de o D-10 derrubar o D-07: ele declara olhando o EXTRATO,
// então o número que ele reconhece é o do instante, não a abertura do dia.
//
// 🔴 A ARMADILHA QUE ESTE CARD PRECISA DESARMAR — e é a mesma que o 233-05
// acabou de fechar. Com o card mostrando o saldo de agora e o gráfico começando
// na ABERTURA, a página volta a exibir dois números discordantes ao mesmo tempo
// (37.430,00 no card × 33.758,27 no gráfico). A diferença desta vez é legítima e
// explicável — `get_cashflow` só acumula `d_date > hoje`, então a primeira
// coluna do gráfico é, por definição, a abertura.
//
// **Mas se a tela não disser qual é qual, o Wesley vê a mesma confusão de
// antes, e o fato de a conta estar certa não o ajuda em nada.** Por isso a frase
// que distingue os dois é ENTREGA, não enfeite: ela vale tanto quanto o número,
// está visível sem clique, e há um portão varrendo por ela
// (`src/pages/mercadolivre/__tests__/saldoAncorado.test.ts`).
//
// 🔴 ESTE CARD NÃO CALCULA O SALDO DE AGORA. Ele vem da coluna `saldo_agora` de
// `get_daily_balance`. Somar `saldo_inicial + entradas_liquidadas −
// saidas_pagas` aqui criaria uma SEGUNDA implementação da classificação por
// estado (`approved`/`refunded`/`in_mediation`/`paid`/`pending`/`cancelled`), e
// duas implementações da mesma regra divergem — a divergência aparece como
// número errado na tela, não como erro. Foi assim que o 233-03 quebrou.
//
// 🔴 ESTADO DESCONHECIDO APARECE. Se o Mercado Pago passar a devolver um
// `status_mp` que não está na allowlist, o valor sai em linha própria em vez de
// ser absorvido em silêncio por um agregado. A regra do banco é allowlist, não
// denylist, exatamente para que este caso EXISTA em vez de sumir.
// ============================================================================

import { Settings2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTodayBalance } from "@/hooks/useTodayBalance";

const currFmt = (v: number): string =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export interface SaldoAgoraCardProps {
  /** Só o owner declara saldo — mesma regra do botão que este card absorveu. */
  podeCorrigir?: boolean;
  onCorrigir?: () => void;
}

/** Uma linha da decomposição: rótulo à esquerda, valor tabular à direita. */
function Linha({
  rotulo,
  valor,
  tom,
  titulo,
}: {
  rotulo: string;
  valor: number;
  tom?: "positivo" | "negativo";
  titulo?: string;
}) {
  const cor =
    tom === "positivo" ? "text-kpi-positive" : tom === "negativo" ? "text-kpi-negative" : "";
  return (
    <div className="flex justify-between gap-3" title={titulo}>
      <span className="text-muted-foreground">{rotulo}</span>
      <span className={`tabular-nums ${cor}`}>{currFmt(valor)}</span>
    </div>
  );
}

export function SaldoAgoraCard({ podeCorrigir = false, onCorrigir }: SaldoAgoraCardProps) {
  const { data: b, isLoading, error } = useTodayBalance();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-10 w-56" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  // ⚠️ A ausência diz o MOTIVO REAL. "Não foi possível" sem causa é o estado mudo
  // que esta fase inteira combate.
  if (error || !b) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-sm text-destructive">
            Não foi possível ler o saldo de hoje
            {error ? `: ${(error as Error).message}` : " — a consulta não devolveu linha."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const temDesconhecido =
    b.entradas_estado_desconhecido > 0 || b.saidas_estado_desconhecido > 0;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Wallet className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold leading-tight">Saldo agora</h3>
              <p className="text-xs text-muted-foreground">
                O que você tem no caixa neste momento
              </p>
            </div>
          </div>

          {podeCorrigir && (
            <Button variant="outline" size="sm" onClick={onCorrigir} className="gap-1.5 text-xs">
              <Settings2 className="w-3.5 h-3.5" />
              Corrigir saldo de hoje
            </Button>
          )}
        </div>

        {/* ── O número grande (D-11) ──
            🔵 Vem de `saldo_agora`, coluna do banco. Ver o cabeçalho. */}
        <p className="text-3xl font-bold tabular-nums leading-none">
          {currFmt(b.saldo_agora)}
        </p>

        {/* ── A decomposição, no layout que o Wesley escolheu ── */}
        <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs space-y-1">
          <Linha
            rotulo="Abertura do dia"
            valor={b.saldo_inicial}
            titulo="O saldo com que o dia começou. É por este número que o gráfico de fluxo de caixa começa."
          />
          <Linha
            rotulo="Já entrou hoje"
            valor={b.entradas_liquidadas}
            tom="positivo"
            titulo="Recebimentos que já caíram na conta (aprovados e estornos já efetivados)."
          />
          <Linha
            rotulo="Já saiu hoje"
            valor={b.saidas_pagas}
            tom="negativo"
            titulo="Pagamentos que já saíram do caixa."
          />

          {/* 🔴 Só aparece quando é maior que zero, e diz o que ela É. Uma linha
              de R$ 0,00 chamada "ainda pode entrar" ensina que existe algo
              pendente quando não existe. */}
          {b.entradas_pendentes > 0 && (
            <Linha
              rotulo="Ainda pode entrar hoje"
              valor={b.entradas_pendentes}
              titulo="O que o dia ainda pode receber e ainda não recebeu — não está no saldo de agora, mas está na previsão de fechamento."
            />
          )}

          <div className="flex justify-between gap-3 border-t border-border/60 pt-1 font-semibold">
            <span>Fechamento previsto</span>
            <span className="tabular-nums">{currFmt(b.saldo_final_previsto)}</span>
          </div>
        </div>

        {/* 🔴 ESTADO NOVO DO MERCADO PAGO NÃO SOME EM SILÊNCIO */}
        {temDesconhecido && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
            <strong>Movimento em situação não reconhecida hoje:</strong>{" "}
            {b.entradas_estado_desconhecido > 0 && (
              <>entradas {currFmt(b.entradas_estado_desconhecido)}</>
            )}
            {b.entradas_estado_desconhecido > 0 && b.saidas_estado_desconhecido > 0 && " · "}
            {b.saidas_estado_desconhecido > 0 && (
              <>saídas {currFmt(b.saidas_estado_desconhecido)}</>
            )}
            . Esse valor <strong>não</strong> entrou no saldo de agora — só contamos como
            dinheiro em mãos o que tem situação conhecida.
          </div>
        )}

        {/* 🔴 A DISTINÇÃO CARD × GRÁFICO — entrega, não enfeite. Ver o cabeçalho. */}
        <p className="text-xs text-muted-foreground leading-snug">
          O <strong>gráfico</strong> abaixo começa na{" "}
          <strong>abertura do dia</strong> ({currFmt(b.saldo_inicial)}), não neste número: ele
          projeta o futuro a partir do início de hoje. O saldo acima já inclui o que entrou e
          saiu até agora — por isso os dois são diferentes.
        </p>
      </CardContent>
    </Card>
  );
}
