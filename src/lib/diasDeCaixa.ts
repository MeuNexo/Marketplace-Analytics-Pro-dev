/**
 * diasDeCaixa.ts — a régua de "quanto tempo eu aguento sem nenhuma entrada?"
 * (CX-01, Fase 230, plano 01).
 *
 * QUAL É O IRMÃO DELE, E POR QUE NÃO É UMA GENERALIZAÇÃO: o Runway (mês) que
 * `TreasuryPanel` já mostra usa o burn LÍQUIDO — já descontando o que entra
 * no período. Este módulo responde outra pergunta: quantos dias o saldo de
 * hoje aguenta se a entrada for ZERO. São perguntas diferentes, com números
 * diferentes, e as duas coexistem na tela sem uma apagar a outra
 * (230-MEDICOES-CAIXA.md: "Runway ≠ dias de caixa").
 *
 * A FONTE DA SAÍDA DIÁRIA: `get_treasury_panel.burn_rate` soma 90 dias de
 * `cash_outflows` pagas (`status='paid'`) e divide por 3 — já é uma média
 * MENSAL (ver MESES_NA_JANELA_DO_BURN). A saída diária deste módulo divide
 * esse valor por 30, nunca por 3 de novo (isso devolveria a saída MENSAL,
 * não a diária).
 *
 * Disciplina inegociável, a mesma de `rebateLinhaCenarios.ts` e
 * `estoqueCapital.ts`: ausência nunca vira zero, denominador zero devolve
 * null (nunca Infinity), e todo estado de ausência carrega no `titulo` o
 * motivo real — jamais um traço mudo.
 *
 * 🔴 ESTE MÓDULO NÃO DEFINE LIMIAR DE ALERTA E NÃO DECIDE COR. Ele responde
 * quantos dias são. A leitura de gravidade é do Wesley, como na D-6 da
 * Fase 224 — a `FAIXA_REFERENCIA_VAREJO` é literatura citada, nunca vira
 * semáforo.
 *
 * Puro: nenhum import de React, de Supabase/rede, ou de date-fns.
 */

/**
 * Quantos meses a janela de `burn_rate` da RPC `get_treasury_panel` cobre:
 * ela soma 90 dias de saídas pagas e divide por 3, ou seja, entrega uma
 * média MENSAL (90 / 3 = 30 dias por "mês" de referência). Este módulo só
 * existe para transformar essa média mensal em saída DIÁRIA — dividir de
 * novo por este número devolveria a saída mensal, não a diária.
 */
export const MESES_NA_JANELA_DO_BURN = 3;

/**
 * Referência de literatura (Bragg, Berman & Knight — ver ROADMAP da
 * Fase 230) para "dias de caixa" saudáveis em varejo com estoque. NÃO é meta
 * aprovada pelo Wesley e NÃO é limiar de alerta: nenhuma cor da tela pode
 * ser decidida por esta faixa — ela só pode aparecer como texto no rodapé.
 */
export const FAIXA_REFERENCIA_VAREJO = { minimo: 60, maximo: 180 } as const;

export type EstadoDiasDeCaixa = "medido" | "sem_saida_medida" | "caixa_negativo";

export interface DiasDeCaixaResult {
  estado: EstadoDiasDeCaixa;
  /** Dias de caixa; `null` em todo estado que não seja `medido`. */
  dias: number | null;
  /** Saída diária usada como divisor; `null` quando não há medição. */
  saidaDiaria: number | null;
  /** Saldo usado como numerador; `null` quando o próprio saldo é ausente. */
  saldo: number | null;
  /** O que aparece grande na tela. */
  texto: string;
  /** O tooltip — SEMPRE nomeia a régua e, em ausência, o motivo real. */
  titulo: string;
}

/**
 * Converte o burn MENSAL da RPC (`get_treasury_panel.burn_rate`) em saída
 * DIÁRIA. Divide por 30 — nunca por `MESES_NA_JANELA_DO_BURN`, que já foi
 * usado pela própria RPC para produzir o valor mensal.
 *
 * Ausência (`null`) ou burn zero devolvem `null`: uma saída diária zero não
 * é uma medição válida — é a mesma ausência de dado que motivou D-selo-04 em
 * `seloPromo.ts` a nunca inferir zero em silêncio.
 */
export function saidaDiariaDeBurnRate(burnMensal: number | null): number | null {
  if (burnMensal == null || burnMensal <= 0) return null;
  return burnMensal / 30;
}

const TITULO_REGRA =
  "O divisor é a média das saídas efetivamente pagas dos últimos 90 dias " +
  "(mesma fonte do Runway), e o cálculo supõe ZERO entrada no período — é " +
  "justamente isso que separa este número do Runway, que já desconta o que entra.";

function tituloSemSaidaMedida(): string {
  return (
    "Não há saída paga suficiente nos últimos 90 dias para medir uma saída " +
    "diária — sem esse divisor, não existe número de dias de caixa a mostrar."
  );
}

function tituloCaixaNegativo(): string {
  return (
    "O saldo de hoje já está negativo — a conta está a descoberto. \"Dias de " +
    "caixa\" pressupõe folga para consumir; uma conta negativa é outra " +
    "pergunta (o tamanho do descoberto), não um número negativo de dias."
  );
}

function tituloSaldoAusente(): string {
  return "O saldo de hoje ainda não foi apurado — sem ele, não há como medir quanto tempo a operação aguenta.";
}

/**
 * Decide o estado de dias de caixa, na ordem:
 *
 * 1. Saldo ausente (`null`): sem numerador não há nada a medir. Não é o
 *    mesmo texto de `sem_saida_medida` (motivo diferente), mas usa o mesmo
 *    estado de ausência de saída para não multiplicar estados de ausência
 *    sem necessidade — a régua distingue o motivo pelo `titulo`, nunca pelo
 *    `estado`, quando os dois levam à mesma decisão de exibição (dias null).
 * 2. Saldo negativo: "caixa_negativo" vence tudo — não existe "menos dias de
 *    folego", existe conta a descoberto, que é outra pergunta.
 * 3. Saída diária não medível (burn nulo ou zero): "sem_saida_medida", dias
 *    null, nunca 0 — ausência não é medição.
 * 4. Saldo zero com saída positiva: dias = 0 é MEDIÇÃO (o caixa acabou),
 *    nunca tratado como ausência.
 * 5. Caso geral: dias = saldo / saída diária.
 */
export function resolveDiasDeCaixa(entrada: {
  saldo: number | null;
  burnMensal: number | null;
}): DiasDeCaixaResult {
  const saidaDiaria = saidaDiariaDeBurnRate(entrada.burnMensal);

  // 1. Sem saldo, não há numerador — nada a medir.
  if (entrada.saldo == null) {
    return {
      estado: "sem_saida_medida",
      dias: null,
      saidaDiaria,
      saldo: null,
      texto: "—",
      titulo: tituloSaldoAusente(),
    };
  }

  // 2. Saldo negativo vence tudo: é conta a descoberto, não "dias negativos".
  if (entrada.saldo < 0) {
    return {
      estado: "caixa_negativo",
      dias: null,
      saidaDiaria,
      saldo: entrada.saldo,
      texto: "—",
      titulo: tituloCaixaNegativo(),
    };
  }

  // 3. Sem saída diária medível: ausência, nunca 0.
  if (saidaDiaria == null) {
    return {
      estado: "sem_saida_medida",
      dias: null,
      saidaDiaria: null,
      saldo: entrada.saldo,
      texto: "—",
      titulo: tituloSemSaidaMedida(),
    };
  }

  // 4./5. Medido — inclusive quando o saldo é exatamente zero (medição, não ausência).
  const dias = entrada.saldo / saidaDiaria;
  return {
    estado: "medido",
    dias,
    saidaDiaria,
    saldo: entrada.saldo,
    texto: `${dias.toFixed(1)} dias`,
    titulo: TITULO_REGRA,
  };
}
