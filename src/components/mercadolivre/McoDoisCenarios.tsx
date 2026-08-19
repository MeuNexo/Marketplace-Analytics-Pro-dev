/**
 * McoDoisCenarios — o par de cenários de MCO (sem DIFAL / com DIFAL) desenhado
 * de UM jeito só, em duas densidades. Fase 222, plano 222-15-R2.
 *
 * A DECISÃO DE PADRÃO VISUAL: os dois números SEMPRE visíveis, lado a lado.
 * Nunca um alternador, nunca uma preferência de usuário. Três razões, em ordem
 * de peso:
 *
 *   1. O requisito é de CONFERÊNCIA, não de leitura. O Wesley pediu os dois
 *      cenários para VALIDAR; um alternador mostra um por vez e transforma a
 *      comparação em exercício de memória.
 *   2. Número que muda de régua não pode mudar em silêncio — precedente do
 *      `data-ads-source` da Fase 210. Uma preferência global faria uma captura
 *      de tela não dizer em que régua está.
 *   3. Consistência entre telas vale mais que elegância de cada uma. Sete
 *      superfícies dizendo a mesma coisa do mesmo jeito, com a ressalva de
 *      estimativa saindo de UMA constante.
 *
 * Na densidade `celula`, a ressalva de estimativa aparece UMA vez no cabeçalho
 * da coluna (`McoDoisCenariosCabecalho`), não repetida em centenas de linhas —
 * a palavra tem de informar, não virar ruído.
 *
 * Este componente é de APRESENTAÇÃO PURA: não decide régua (isso é
 * `resolveLinhaCenarios`), não calcula MCO (isso é `computeMco`/o banco) e não
 * recalcula semáforo (recebe o papel de cor por propriedade). Mudar a base de
 * uma cor é decisão de negócio que ninguém tomou — o semáforo continua lendo o
 * cenário SEM DIFAL.
 */

import { cn } from "@/lib/utils";
import type { McoColorRole } from "@/lib/mcoHealth";
import {
  DIFAL_ESTIMATIVA_AJUDA,
  DIFAL_ESTIMATIVA_LABEL,
  FRASE_EFEITO_NULO,
  fraseMotivoSemDifal,
  type LinhaCenariosResult,
  type ValorPct,
} from "@/lib/mcoLinhaCenarios";

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

export interface McoDoisCenariosProps {
  /** Saída de `resolveLinhaCenarios` — já decidida, nunca recomputada aqui. */
  cenarios: LinhaCenariosResult;
  /** `bloco` para faixas e KPIs; `celula` para tabelas densas. */
  densidade?: "bloco" | "celula";
  /** Rótulo do primeiro cenário. */
  rotuloSemDifal?: string;
  /** Rótulo do segundo cenário. */
  rotuloComDifal?: string;
  /**
   * Papel de cor do semáforo, aplicado ao PRIMEIRO cenário. Quem classifica é
   * o chamador (`classifyMcoHealth` + `mcoHealthRole`) — o semáforo continua
   * na régua sem DIFAL.
   */
  role?: McoColorRole;
  /**
   * `true` quando a ressalva de estimativa já aparece uma vez no cabeçalho da
   * coluna. Evita repetir a palavra em cada uma das centenas de linhas.
   */
  ressalvaNoCabecalho?: boolean;
  className?: string;
}

/**
 * Cabeçalho de coluna que carrega a ressalva de estimativa UMA vez, para a
 * densidade de célula. O texto sai da mesma constante do componente.
 */
export function McoDoisCenariosCabecalho({
  titulo,
  className,
}: {
  titulo?: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex flex-col items-end leading-tight", className)}>
      {titulo ? <span>{titulo}</span> : null}
      <span className="text-[10px] font-normal text-muted-foreground" title={DIFAL_ESTIMATIVA_AJUDA}>
        2ª linha: com DIFAL ({DIFAL_ESTIMATIVA_LABEL})
      </span>
    </span>
  );
}

export function McoDoisCenarios({
  cenarios,
  densidade = "bloco",
  rotuloSemDifal = "sem DIFAL",
  rotuloComDifal = "com DIFAL",
  role = "neutral",
  ressalvaNoCabecalho = false,
  className,
}: McoDoisCenariosProps) {
  const { semDifal, comDifal, motivo, pedidosDifalIndefinido, efeitoNulo } = cenarios;
  const frase = fraseMotivoSemDifal(motivo, pedidosDifalIndefinido);
  const compacto = densidade === "celula";

  // A ressalva só some da linha quando o cabeçalho já a carrega — nunca some
  // por completo: um número de régua diferente sem a palavra ao lado está
  // afirmando mais do que o dado sustenta (D-12).
  const mostrarRessalva = !(compacto && ressalvaNoCabecalho);

  return (
    <span
      data-difal-regua={motivo}
      data-mco-role={role}
      className={cn(
        "inline-flex flex-col",
        compacto ? "items-end leading-tight gap-0" : "items-start gap-0.5",
        className,
      )}
    >
      {/* ── Cenário 1: sem DIFAL. É ele que o semáforo colore. ── */}
      <span className={cn("inline-flex items-baseline gap-1", compacto ? "text-xs" : "text-sm")}>
        <span className={cn("font-semibold tabular-nums", ROLE_CLASSES[role])}>
          {valorEPct(semDifal)}
        </span>
        <span className={cn("text-muted-foreground", compacto ? "text-[10px]" : "text-xs")}>
          {rotuloSemDifal}
        </span>
      </span>

      {/* ── Cenário 2: com DIFAL — número, ou o motivo em palavras. ── */}
      {comDifal ? (
        <span
          className={cn(
            "inline-flex items-baseline gap-1 text-muted-foreground",
            compacto ? "text-[11px]" : "text-sm",
          )}
          title={DIFAL_ESTIMATIVA_AJUDA}
        >
          <span className="tabular-nums">{valorEPct(comDifal)}</span>
          <span className={compacto ? "text-[10px]" : "text-xs"}>
            {rotuloComDifal}
            {mostrarRessalva ? ` (${DIFAL_ESTIMATIVA_LABEL})` : ""}
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

      {/* Dois números iguais nunca ficam mudos: o efeito nulo se declara. */}
      {comDifal && efeitoNulo && (
        <span className={cn("text-muted-foreground", compacto ? "text-[10px]" : "text-xs")}>
          {FRASE_EFEITO_NULO}
        </span>
      )}

      {/* A lacuna aparece MESMO quando há segundo cenário: parte dos pedidos
          pode estar fora da conta por UF ainda não confirmada. */}
      {comDifal && pedidosDifalIndefinido > 0 && (
        <span className={cn("text-muted-foreground", compacto ? "text-[10px]" : "text-xs")}>
          {pedidosDifalIndefinido} pedido(s) fora da conta — alíquota da UF não confirmada.
        </span>
      )}
    </span>
  );
}
