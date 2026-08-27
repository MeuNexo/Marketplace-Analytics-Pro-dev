// ============================================================================
// SaldoEConfiancaPorDia — Fase 233 Plano 07, Task 2 (D-13)
//
// "Quanto vou ter neste dia, e quanto posso confiar nisso?" — na MESMA linha,
// D+1 a D+30. O Wesley pediu isto no mesmo fôlego em que pediu a página menos
// carregada: *"eu queria ver o saldo em cada dia da previsao e ver tambem a
// porcentagem de confianca que posso ter nele... somente isso"*. Hoje o saldo
// vive no gráfico e a confiança vive num card abaixo; ele cruza os dois de
// cabeça. Esta tabela é a fusão dos dois, sem recalcular nenhum dos dois.
//
// 🔴 A DECISÃO QUE FUNDA A TABELA, e nenhuma escolha aqui é neutra: de D+10 em
// diante o número PRINCIPAL é `saldo_previsto` (`accumulated_balance_sma` — a
// mesma linha que `CashFlowChart` já desenha em âmbar). `saldo_so_agendado`
// (`accumulated_balance`) aparece do LADO, só na faixa `media`, rotulado como
// o que a agenda sozinha diz. Os três motivos, na ordem em que importam:
//
//   1. `get_cashflow` só injeta a média a partir do 10º dia — em D+1..D+9 as
//      duas colunas são iguais por construção (PORTÃO EXISTENCIAL, verificado
//      pelo orquestrador contra o banco vivo antes deste componente existir).
//      A coluna principal atravessa os 30 dias sem costura própria; a costura
//      que existe é a da FRONTEIRA, declarada abaixo, não a da fórmula.
//   2. A DIFERENÇA entre as duas colunas na faixa `media` é o tamanho do que
//      a média está inventando — mostrar as duas entrega essa medida de graça.
//   3. Publicar só a confirmada afirmaria −R$ 301 mil em 30/09 (M-10) como se
//      fosse previsão — a ausência de agenda desenhada como falência.
//
// 🔴 O AVISO DA FRONTEIRA FICA À VISTA, nunca no expansor (D-14, os avisos que
// não colapsam). Sem ele a tabela publica trinta dias de queda como previsão,
// quando o que a M-10 mediu é a RECEITA sumindo do cálculo, não o caixa
// acabando: a agenda do Mercado Pago não enxerga além do 9º dia, e as
// despesas seguem agendadas meses à frente.
//
// 🔴 SEM SEMÁFORO, SEM LIMIAR DE TOLERÂNCIA. A confiança é número com o `n`
// ao lado — o corte entre "confiável" e "não confiável" é do Wesley, e ele
// não o deu (D-6 do 224-CONTEXT).
//
// 🔴 CÉLULA DE CONFIANÇA NUNCA VAZIA. Onde não há medição, ela traz o motivo
// que a RPC já mandou, via `textoDaAusencia()` — extraído de
// `CurvaDeConfianca.tsx` no 233-07, frases inalteradas. Uma tabela de 30
// linhas publica um texto POR LINHA (a curva publicava um por faixa
// contígua) — mais palavras renderizadas em bruto, mas a leitura passa a ser
// tabular, não prosa empilhada (233-TEXTO.md).
//
// 🔴 A CONFIANÇA VEM PRONTA de `useConfiancaDoSaldo()` (233-04): 30 pontos com
// `estado`, `motivo_ausencia` e `medivel_em` já resolvidos. Este componente
// NÃO recalcula calendário — reimplementar a regra aqui seria uma segunda
// implementação que diverge da primeira (M-06).
//
// 🔴 A SÉRIE DE SALDO CHEGA POR PROP — a mesma chamada de `useCashFlowData`
// que a página já faz para o `CashFlowChart`. A tabela não consulta de novo:
// duas consultas com escopos diferentes fariam a tabela e o gráfico
// discordarem sobre o mesmo dia, o defeito que as últimas quatro fases
// gastaram consertando.
//
// 🔴 A FRONTEIRA ENTRA POR PARÂMETRO (`ultimoDiaDeAgenda`), no molde de
// `horizonteLimite` em `frasePrevisao.ts`. O invólucro passa a constante
// compartilhada de `useForecastErrorCurve.ts` (`ULTIMO_HORIZONTE_COMPARAVEL`)
// — o módulo puro (`saldoEConfianca.ts`) não conhece nenhum literal de
// fronteira.
//
// ⚠️ `strictNullChecks: false`: a chave de cada linha é o HORIZONTE, que
// existe em toda linha por construção. `data` pode ser nula e nunca vira
// chave (`feedback_garment_key_nulavel_react`).
// ============================================================================

import { useOrganization } from "@/contexts/OrganizationContext";
import { useConfiancaDoSaldo, HORIZONTE_MAXIMO } from "@/hooks/useConfiancaDoSaldo";
import { ULTIMO_HORIZONTE_COMPARAVEL } from "@/hooks/useForecastErrorCurve";
import type { CashFlowDataPoint } from "@/hooks/useCashFlowData";
import { textoDaAusencia, type PontoDeConfianca } from "@/lib/confiancaDoSaldo";
import { linhasDeSaldoEConfianca, type LinhaDeSaldoEConfianca } from "@/lib/saldoEConfianca";
import { brToday } from "@/lib/brDate";
import { Skeleton } from "@/components/ui/skeleton";

const currFmt = (v: number): string =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "2026-09-05" → "05/09". Fatiado à mão pelo mesmo motivo de `brDate.ts`:
 *  `new Date` em ISO puro é UTC e o fuso local empurra o dia para trás. */
const diaMes = (iso: string | null): string => {
  if (iso == null || iso.length < 10) return "—";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
};

/** A célula de confiança: percentual OU o motivo — nunca vazia. */
function celulaDeConfianca(linha: LinhaDeSaldoEConfianca): string {
  if (linha.estado === "medido" && linha.confianca_pct != null) {
    return `${Math.round(linha.confianca_pct)}% · n ${linha.n_pares}`;
  }
  return textoDaAusencia({
    estado: linha.estado,
    de: linha.horizonte,
    ate: linha.horizonte,
    medivel_em: linha.medivel_em,
  });
}

export interface SaldoEConfiancaPorDiaProps {
  /** A mesma série que alimenta `CashFlowChart` — vem por PROP, uma consulta. */
  serie: CashFlowDataPoint[] | null | undefined;
  isLoading?: boolean;
}

/** A parte apresentacional: recebe a confiança já resolvida por PROP, para
 *  ser testável por FORMA sem montar o `QueryClientProvider`. */
export interface SaldoEConfiancaPorDiaViewProps {
  serie: CashFlowDataPoint[] | null | undefined;
  pontos: PontoDeConfianca[] | null | undefined;
  isLoading?: boolean;
  /** yyyy-MM-dd. Default `brToday()` — só existe como prop para o teste fixar
   *  a data sem depender do relógio da máquina que roda a suíte. */
  hoje?: string;
}

export function SaldoEConfiancaPorDiaView({
  serie,
  pontos,
  isLoading,
  hoje = brToday(),
}: SaldoEConfiancaPorDiaViewProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  const linhas = linhasDeSaldoEConfianca({
    serie,
    pontos,
    hoje,
    ultimoDiaDeAgenda: ULTIMO_HORIZONTE_COMPARAVEL,
    horizonteMaximo: HORIZONTE_MAXIMO,
  });

  // A fronteira: entre a ÚLTIMA linha `agenda` e a PRIMEIRA `media`.
  const indiceFronteira = linhas.findIndex((l) => l.faixa === "media");

  return (
    <div className="space-y-2" data-tabela-saldo-confianca>
      <div>
        <p className="text-xs uppercase tracking-wider font-medium text-muted-foreground leading-tight">
          Quanto vou ter, e quanto posso confiar?
        </p>
        <p className="text-[11px] text-muted-foreground/60">
          Saldo previsto e confiança da previsão, dia a dia, D+1 a D+{linhas.length}
        </p>
      </div>

      <div className="rounded-lg border border-border/60 overflow-hidden">
        <div className="grid grid-cols-[4.5rem_1fr_1fr_1fr] gap-2 px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground/70 bg-muted/30">
          <span>Dia</span>
          <span className="text-right">Saldo previsto</span>
          <span className="text-right">Só o agendado</span>
          <span className="text-right">Confiança</span>
        </div>

        <div className="max-h-[26rem] overflow-y-auto divide-y divide-border/30">
          {linhas.map((linha, i) => (
            <div key={linha.horizonte}>
              {/* 🔴 A FRONTEIRA — avisada, à vista, nunca no expansor (D-14). */}
              {i === indiceFronteira && (
                <p
                  data-aviso="fronteira-agenda"
                  className="px-3 py-2 text-[11px] leading-snug text-amber-600 dark:text-amber-500 bg-amber-500/10 border-y border-amber-500/30"
                >
                  A partir daqui (D+{linha.horizonte}), a agenda do Mercado Pago não enxerga mais
                  receita — o número passa a usar a média dos últimos 15 dias, enquanto as
                  despesas continuam agendadas meses à frente.{" "}
                  <strong>O saldo cai porque a receita some do cálculo, não porque o caixa
                  vai acabar.</strong>
                </p>
              )}

              <div
                data-horizonte={linha.horizonte}
                data-faixa={linha.faixa}
                className="grid grid-cols-[4.5rem_1fr_1fr_1fr] gap-2 px-3 py-1.5 text-xs items-baseline"
              >
                <span className="text-muted-foreground tabular-nums">
                  D+{linha.horizonte}
                  <span className="block text-[10px] text-muted-foreground/60">
                    {diaMes(linha.data)}
                  </span>
                </span>
                <span
                  className={`text-right font-medium tabular-nums ${
                    linha.saldo_previsto != null && linha.saldo_previsto < 0 ? "text-kpi-negative" : ""
                  }`}
                >
                  {linha.saldo_previsto != null ? currFmt(linha.saldo_previsto) : "—"}
                </span>
                <span className="text-right text-muted-foreground tabular-nums">
                  {linha.faixa === "media" && linha.saldo_so_agendado != null
                    ? currFmt(linha.saldo_so_agendado)
                    : "—"}
                </span>
                <span className="text-right text-muted-foreground">{celulaDeConfianca(linha)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** O invólucro: liga o hook da confiança (233-04) e entrega os dois insumos
 *  já resolvidos à parte apresentacional. A série chega por PROP — nenhuma
 *  consulta nova. */
export function SaldoEConfiancaPorDia({ serie, isLoading }: SaldoEConfiancaPorDiaProps) {
  const { currentOrg } = useOrganization();
  const { data: confianca, isLoading: carregandoConfianca } = useConfiancaDoSaldo();

  return (
    <SaldoEConfiancaPorDiaView
      serie={serie}
      pontos={confianca?.pontos ?? []}
      isLoading={Boolean(isLoading) || carregandoConfianca || !currentOrg}
    />
  );
}
