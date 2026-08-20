/**
 * RebateDoisCenarios — o par de cenários de rebate (com rebate / sem rebate,
 * a tarifa cheia) desenhado de UM jeito só, em duas densidades. Fase 223,
 * plano 223-02.
 *
 * QUAL É O IRMÃO DELE: `McoDoisCenarios.tsx` desenha o par sem/com DIFAL
 * (imposto). Este componente desenha outra régua — desconto de comissão
 * medido na fatura do Mercado Livre — e por isso é um componente irmão, não
 * uma generalização. As duas réguas são independentes: uma mudança na
 * fórmula fiscal não pode quebrar a leitura de promoção, e vice-versa
 * (223-PATTERNS, decisão (b)).
 *
 * A DECISÃO DE PADRÃO VISUAL (herdada da 222, mesmo requisito de
 * CONFERÊNCIA): os dois números SEMPRE visíveis, lado a lado, nunca um
 * alternador. Número que muda de régua não pode mudar em silêncio —
 * `data-rebate-regua` no elemento raiz é o mesmo precedente de
 * `data-difal-regua`/`data-ads-source`.
 *
 * 🔴 O PRIMEIRO cenário (o colorido pelo semáforo) é o COM rebate — é o
 * número REAL, o que `orders.comissao` já reflete hoje. O SEGUNDO cenário
 * responde "e se a campanha acabar": a mesma venda com a tarifa cheia. O
 * papel de cor nunca muda de base aqui — colorir pela tarifa cheia seria
 * alertar por um cenário hipotético.
 *
 * Este componente é de APRESENTAÇÃO PURA: não decide régua (isso é
 * `resolveLinhaRebate`), não calcula margem (isso é o banco) e não recalcula
 * semáforo (recebe o papel de cor por propriedade).
 */

import { cn } from "@/lib/utils";
import type { McoColorRole } from "@/lib/mcoHealth";
import {
  FRASE_REBATE_PARCIAL,
  REBATE_CENARIO_AJUDA,
  REBATE_CENARIO_LABEL,
  fraseMotivoSemRebate,
  type LinhaRebateResult,
  type ValorPct,
} from "@/lib/rebateLinhaCenarios";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);

/** Valor E percentual, sempre os dois — regra da casa (CLAUDE.md). */
function valorEPct(par: ValorPct): string {
  return `${brl(par.valor)} (${pct(par.pct)})`;
}

/** Classes de cor por papel do semáforo. O papel vem de fora, nunca daqui. */
const ROLE_CLASSES: Record<McoColorRole, string> = {
  critical: "text-destructive",
  warning: "text-warning",
  good: "text-success",
  neutral: "text-foreground",
};

export interface RebateDoisCenariosProps {
  /** Saída de `resolveLinhaRebate` — já decidida, nunca recomputada aqui. */
  cenarios: LinhaRebateResult;
  /** `bloco` para faixas e KPIs; `celula` para tabelas densas. */
  densidade?: "bloco" | "celula";
  /** Rótulo do primeiro cenário (com rebate). */
  rotuloComRebate?: string;
  /** Rótulo do segundo cenário (sem rebate — tarifa cheia). */
  rotuloSemRebate?: string;
  /**
   * Papel de cor do semáforo, aplicado ao PRIMEIRO cenário (o real, com
   * rebate). Quem classifica é o chamador — o semáforo continua na régua com
   * rebate, nunca na tarifa cheia.
   */
  role?: McoColorRole;
  /**
   * `true` quando o rótulo do segundo cenário já aparece uma vez no
   * cabeçalho da coluna. Evita repetir a palavra em cada uma das centenas de
   * linhas.
   */
  ressalvaNoCabecalho?: boolean;
  className?: string;
}

/**
 * Cabeçalho de coluna que carrega o rótulo do segundo cenário UMA vez, para a
 * densidade de célula. O texto sai da mesma constante do componente.
 */
export function RebateDoisCenariosCabecalho({
  titulo,
  className,
}: {
  titulo?: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex flex-col items-end leading-tight", className)}>
      {titulo ? <span>{titulo}</span> : null}
      <span className="text-[10px] font-normal text-muted-foreground" title={REBATE_CENARIO_AJUDA}>
        2ª linha: {REBATE_CENARIO_LABEL}
      </span>
    </span>
  );
}

export function RebateDoisCenarios({
  cenarios,
  densidade = "bloco",
  rotuloComRebate = "com rebate",
  rotuloSemRebate,
  role = "neutral",
  ressalvaNoCabecalho = false,
  className,
}: RebateDoisCenariosProps) {
  const { comRebate, semRebate, motivo, pedidosSemCaptura, pedidosNaoConferidos } = cenarios;
  const frase = fraseMotivoSemRebate(motivo, pedidosSemCaptura, pedidosNaoConferidos);
  const fraseLacuna = FRASE_REBATE_PARCIAL(pedidosSemCaptura, pedidosNaoConferidos);
  const compacto = densidade === "celula";

  // O rótulo do segundo cenário só some da linha quando o cabeçalho já o
  // carrega — nunca some por completo: um número de régua diferente sem a
  // palavra ao lado está afirmando mais do que o dado sustenta.
  const mostrarRotulo = !(compacto && ressalvaNoCabecalho);
  const rotuloSem = rotuloSemRebate ?? REBATE_CENARIO_LABEL;

  return (
    <span
      data-rebate-regua={motivo}
      data-mco-role={role}
      className={cn(
        "inline-flex flex-col",
        compacto ? "items-end leading-tight gap-0" : "items-start gap-0.5",
        className,
      )}
    >
      {/* ── Cenário 1: com rebate. É ele que o semáforo colore. ── */}
      <span className={cn("inline-flex items-baseline gap-1", compacto ? "text-xs" : "text-sm")}>
        <span className={cn("font-semibold tabular-nums", ROLE_CLASSES[role])}>
          {valorEPct(comRebate)}
        </span>
        <span className={cn("text-muted-foreground", compacto ? "text-[10px]" : "text-xs")}>
          {rotuloComRebate}
        </span>
      </span>

      {/* ── Cenário 2: sem rebate (tarifa cheia) — número, ou o motivo em palavras. ── */}
      {semRebate ? (
        <span
          className={cn(
            "inline-flex items-baseline gap-1 text-muted-foreground",
            compacto ? "text-[11px]" : "text-sm",
          )}
          title={REBATE_CENARIO_AJUDA}
        >
          <span className="tabular-nums">{valorEPct(semRebate)}</span>
          <span className={compacto ? "text-[10px]" : "text-xs"}>
            {mostrarRotulo ? rotuloSem : ""}
          </span>
        </span>
      ) : (
        <span
          className={cn(
            "text-muted-foreground",
            compacto ? "text-[10px] max-w-[220px] text-right" : "text-xs",
          )}
        >
          {frase}
        </span>
      )}

      {/* A lacuna aparece MESMO quando há segundo cenário: parte dos pedidos
          pode estar fora da conta por falta de captura ou por conferência
          que não fecha — as duas causas nomeadas separadamente. */}
      {semRebate && fraseLacuna && (
        <span className={cn("text-muted-foreground", compacto ? "text-[10px]" : "text-xs")}>
          {fraseLacuna}
        </span>
      )}
    </span>
  );
}
