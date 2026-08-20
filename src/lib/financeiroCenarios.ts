/**
 * financeiroCenarios — o par de cenários de MCO (sem DIFAL / com DIFAL) para
 * as duas superfícies AGREGADAS de PERÍODO de `/financeiro`: o KPI de Lucro
 * Bruto e o Waterfall de Margem. Fase 222, quick 260820-2l7.
 *
 * 🔴 ESTE MÓDULO NÃO FAZ ARITMÉTICA DE DIFAL. Ele monta a entrada de MCO do
 * Financeiro e delega a decisão inteira a `computeMcoCenarios` (./mcoCenarios)
 * e a `resolveLinhaCenarios` (./mcoLinhaCenarios) — os dois únicos donos da
 * conta do efeito líquido, no cliente e no banco. Recompor o segundo cenário
 * aqui seria criar um TERCEIRO dono, exatamente o que a Fase 222 existe para
 * não repetir.
 *
 * Sem React, sem rede, sem Supabase — puro e testável (mesmo padrão de
 * `mcoLinhaCenarios.ts`, escolhido porque não há teste de página neste repo).
 *
 * QUAL É O IRMÃO DELE: `mcoLinhaCenarios.ts` decide o par por LINHA (um
 * anúncio, um dia, uma marca). Este módulo decide o par por PERÍODO — as duas
 * únicas superfícies de `/financeiro` que têm dado de DIFAL, porque
 * `useMLDifalSummary`/`get_difal_summary` (222-07) é uma consulta agregada do
 * intervalo inteiro, não por linha. As cinco superfícies restantes da tela
 * (dois gráficos por dia, três tabelas por linha) não têm coluna de DIFAL nas
 * RPCs que consomem — ganham declaração de régua na própria tela, não par.
 */

import { computeMco, type McoInput } from "./mco";
import {
  computeMcoCenarios,
  DIFAL_ESTIMATIVA_LABEL,
  type DifalProcedencia,
  type DifalSummaryInput,
} from "./mcoCenarios";
import {
  resolveLinhaCenarios,
  DIFAL_ESTIMATIVA_AJUDA,
  type LinhaCenariosResult,
} from "./mcoLinhaCenarios";

export interface CenariosLucroBrutoFinanceiroInput {
  receita: number;
  cmv: number;
  comissao: number;
  frete: number;
  impostos: number;
  publicidade: number;
  /** Resumo cru de `useMLDifalSummary`; `null`/`undefined` = indisponível. */
  difal: DifalSummaryInput | null | undefined;
  /** O recorte de lojas selecionado recolhe DIFAL? `undefined` = não sabemos. */
  regimeAplicaDifal?: boolean;
}

export interface CenariosLucroBrutoFinanceiroResult {
  /** Cenário sem DIFAL — o número que a tela já exibia antes desta fase. */
  lucro: number;
  /** Percentual arredondado a duas casas; `null` quando a receita é zero. */
  lucroPct: number | null;
  /** O par pronto para `<McoDoisCenarios cenarios={...} />`. */
  cenarios: LinhaCenariosResult;
  /** Procedência do valor de DIFAL somado (informativa — não decide exibição). */
  procedencia: DifalProcedencia;
}

/**
 * Arredonda um percentual a duas casas, preservando `null`. É a MESMA
 * expressão que a tela já usava para `kpiLucroPct`
 * (`Math.round((lucro/receita)*10000)/100 === Math.round(pct*100)/100`, dado
 * que `computeMco` devolve `pct` já multiplicado por 100) — aplicada aos dois
 * cenários, para a entrada do semáforo não mudar e os dois números do par não
 * divergirem na última casa por motivo nenhum.
 */
function arredondarPct(v: number | null): number | null {
  return v == null ? null : Math.round(v * 100) / 100;
}

/**
 * `cenariosLucroBrutoFinanceiro(entrada)` — o Lucro Bruto do Financeiro em
 * dois cenários.
 *
 * 1. Monta o `McoInput` com `platformCost: comissao + frete` — a ÚNICA soma
 *    deste módulo, e ela não tem nada de fiscal.
 * 2. Chama `computeMcoCenarios({ base, difal })` UMA vez. É dela que saem os
 *    dois valores, o DIFAL aplicado e a procedência.
 * 3. Arredonda os dois percentuais com a mesma regra.
 * 4. Monta o par via `resolveLinhaCenarios`. `temOperacaoInterestadual` não é
 *    informado: nenhuma RPC desta tela sabe responder, e não saber não pode
 *    virar a afirmação de que o DIFAL não se aplica.
 */
export function cenariosLucroBrutoFinanceiro(
  entrada: CenariosLucroBrutoFinanceiroInput,
): CenariosLucroBrutoFinanceiroResult {
  const { receita, cmv, comissao, frete, impostos, publicidade, difal, regimeAplicaDifal } =
    entrada;

  const base: McoInput = {
    grossRevenue: receita,
    cmv,
    platformCost: comissao + frete,
    ads: publicidade,
    tax: impostos,
  };

  const resultado = computeMcoCenarios({ base, difal });

  const semDifalPct = arredondarPct(resultado.semDifal.pct);
  const comDifalPct =
    resultado.comDifal != null ? arredondarPct(resultado.comDifal.pct) : null;

  const cenarios = resolveLinhaCenarios({
    semDifal: { valor: resultado.semDifal.mco, pct: semDifalPct },
    comDifal:
      resultado.comDifal != null
        ? { valor: resultado.comDifal.mco, pct: comDifalPct }
        : null,
    difalEfeito: resultado.difalAplicado,
    pedidosDifalIndefinido: resultado.pedidosIndefinidos,
    regimeAplicaDifal,
  });

  return {
    lucro: resultado.semDifal.mco,
    lucroPct: semDifalPct,
    cenarios,
    procedencia: resultado.procedencia,
  };
}

/** Um degrau do waterfall, no mesmo formato dos sete degraus que a tela já monta. */
export interface PassoWaterfall {
  key: string;
  label: string;
  value: number;
}

/**
 * `passosWaterfallComDifal(resultado)` — os dois degraus novos do fim do
 * waterfall: `(-) DIFAL — efeito líquido` e `= Lucro Bruto com DIFAL`.
 *
 * Vazio quando não há segundo cenário. Quando há, os dois degraus fecham a
 * escada ao centavo: `resultado.lucro + degrau[0].value === degrau[1].value`.
 */
export function passosWaterfallComDifal(
  resultado: CenariosLucroBrutoFinanceiroResult,
): PassoWaterfall[] {
  if (resultado.cenarios.comDifal == null) return [];

  const efeito = resultado.cenarios.difalEfeito ?? 0;

  return [
    {
      key: "difal_efeito",
      label: `(-) DIFAL — efeito líquido (${DIFAL_ESTIMATIVA_LABEL})`,
      value: -efeito,
    },
    {
      key: "lucro_com_difal",
      label: `= Lucro Bruto com DIFAL (${DIFAL_ESTIMATIVA_LABEL})`,
      value: resultado.cenarios.comDifal.valor,
    },
  ];
}

/**
 * Três constantes de texto, para os cinco pontos de declaração de régua desta
 * tela não divergirem entre si (a mesma disciplina de `DIFAL_ESTIMATIVA_LABEL`
 * em `mcoCenarios.ts`).
 */

/** Curto — cabe numa legenda de gráfico ou ao lado de um título de card. */
export const ROTULO_REGUA_SEM_DIFAL = "régua: sem DIFAL";

/**
 * Frase longa para `title`: o que o número é, por que não há segundo cenário
 * aqui, e onde o par existe nesta mesma tela.
 */
export const DECLARACAO_REGUA_SEM_DIFAL =
  "Este número é o cenário sem DIFAL. A régua do DIFAL é apurada por período — " +
  "não há rateio por dia nem por linha. O par do período está nos KPIs de " +
  "Lucro Bruto e no Waterfall de Margem, acima.";

/**
 * Frase para o card `Lucro Bruto %`: onde o leitor descobre em que régua o
 * semáforo foi decidido. A fase mostra o segundo número — não muda decisão
 * automática nenhuma.
 */
export const DECLARACAO_SEMAFORO_SEM_DIFAL =
  "A cor deste card lê o cenário sem DIFAL. O par com DIFAL está no card " +
  "Lucro Bruto, ao lado — mostrar o segundo número não muda a decisão " +
  "automática do semáforo.";

/** Reexportada para as telas nunca redigitarem a ressalva de estimativa (D-12). */
export { DIFAL_ESTIMATIVA_AJUDA };
