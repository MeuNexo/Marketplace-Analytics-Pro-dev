// ============================================================================
// curvaGiro — Fase 213, Plano 08, Task 2 (RE-04)
//
// Régua deste módulo, em uma frase: a Curva de Giro classifica por UNIDADES POR
// DIA no período que o chamador escolheu — nunca por receita, nunca por preço.
//
// Por que este módulo existe apesar de já haver `curvaAbc.ts`: a pergunta é
// outra. A curva de RECEITA responde "onde eu ganho dinheiro" e vive em
// `/resultado`. A curva de GIRO responde "o que eu preciso repor primeiro" e
// vive em `/estoque`. Quem lê a primeira está decidindo verba e preço; quem lê
// a segunda está decidindo pedido de compra.
//
// A forma matemática é a mesma — ordenar, acumular, cortar em 80 e 95 —, mas os
// critérios e os NOMES são diferentes de propósito. Duas telas com o mesmo nome
// "Curva ABC" e critérios diferentes foi exatamente o defeito que a auditoria da
// fase 212 encontrou: `/anuncios` classificava por `sold_quantity × price`
// (unidades vitalícias × preço de hoje) e `/estoque` fazia a mesma conta, de
// modo que o operador via "Curva A" em dois lugares sem saber qual das duas
// respondia à sua pergunta. A correção não é unir os dois num módulo com um
// parâmetro de critério — isso apenas esconderia a ambiguidade dentro de um
// argumento. A correção é dar nomes distintos a perguntas distintas.
//
// Por isso este módulo fala em PRIORIDADE DE REPOSIÇÃO (A, B, C) e em `giro`,
// nunca em `receita`. Item sem giro nenhum recebe a menor prioridade sempre:
// repor primeiro o que não vende é o oposto exato da decisão que a tela apoia.
//
// Determinismo: o empate de giro é desempatado pelo identificador. Sem isso a
// ordem de itens empatados depende da ordem de chegada dos dados e a mesma
// carteira produz curvas diferentes entre dois carregamentos da tela.
//
// Este módulo é PURO: nenhum import de React, de Supabase ou de rede.
// ============================================================================

/**
 * Classe de prioridade de reposição.
 *
 * A = o giro que sustenta a operação, repor primeiro.
 * B = giro intermediário.
 * C = cauda longa e itens parados, repor por último ou não repor.
 */
export type PrioridadeGiro = "A" | "B" | "C";

/** O mínimo que a classificação exige de cada item: quem é, e quanto gira. */
export interface EntradaCurvaGiro {
  id: string;
  /**
   * Unidades vendidas por dia no período que o chamador escolheu — em
   * `/estoque` é o `avg_daily_sales` de `useMLCoverage`, que já vem escopado
   * por loja e paginado (plano 213-01). Este módulo não busca dado e não
   * recalcula a média.
   */
  unidadesPorDia: number;
}

/** Campos que a classificação acrescenta a cada item. */
export interface CamposCurvaGiro {
  /** Posição no ranking de giro, começando em 1. */
  rank: number;
  /** Participação individual sobre o giro do conjunto, em %. */
  pct: number;
  /** Participação acumulada até esta posição, em %. Termina em 100 exato. */
  cumPct: number;
  prioridade: PrioridadeGiro;
}

export interface ResumoClasseGiro {
  count: number;
  /** Soma de unidades por dia da classe. */
  giro: number;
  /** Fatia do giro total que a classe representa, em %. */
  pct: number;
}

export interface ResumoCurvaGiro {
  A: ResumoClasseGiro;
  B: ResumoClasseGiro;
  C: ResumoClasseGiro;
  /** Quantidade de itens classificados. */
  total: number;
  /** Soma de unidades por dia do conjunto recebido. */
  giroTotal: number;
}

export interface ResultadoCurvaGiro<T> {
  /** Itens ordenados por giro decrescente, com os campos da classificação. */
  itens: (T & CamposCurvaGiro)[];
  resumo: ResumoCurvaGiro;
}

/** Corte da prioridade A: acumulado de giro até este percentual. */
const CORTE_A = 80;
/** Corte da prioridade B: acumulado de giro até este percentual. */
const CORTE_B = 95;

/**
 * Giro saneado: valor não finito ou negativo não é giro, é ruído de fonte.
 * Vira zero em vez de contaminar o total e produzir NaN na tela.
 */
function giroValido(valor: number): number {
  return Number.isFinite(valor) && valor > 0 ? valor : 0;
}

/**
 * Classifica um conjunto de itens em prioridades de reposição A, B e C pelo
 * giro em unidades por dia.
 *
 * O chamador entrega a média diária já apurada no período que a tela mostra —
 * este módulo não sabe de onde ela veio e não a recalcula.
 */
export function classificarCurvaGiro<T extends EntradaCurvaGiro>(
  itens: readonly T[],
): ResultadoCurvaGiro<T> {
  const resumoVazio = (): ResumoCurvaGiro => ({
    A: { count: 0, giro: 0, pct: 0 },
    B: { count: 0, giro: 0, pct: 0 },
    C: { count: 0, giro: 0, pct: 0 },
    total: 0,
    giroTotal: 0,
  });

  if (itens.length === 0) {
    return { itens: [], resumo: resumoVazio() };
  }

  const giroTotal = itens.reduce((s, i) => s + giroValido(i.unidadesPorDia), 0);

  // Ordem decrescente de giro, com desempate por identificador — a mesma
  // entrada produz sempre a mesma classificação.
  const ordenados = [...itens].sort((a, b) => {
    const diff = giroValido(b.unidadesPorDia) - giroValido(a.unidadesPorDia);
    if (diff !== 0) return diff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const ultimo = ordenados.length - 1;
  let acumulado = 0;

  const classificados = ordenados.map((item, idx) => {
    const giro = giroValido(item.unidadesPorDia);
    acumulado += giro;

    const pct = giroTotal > 0 ? (giro / giroTotal) * 100 : 0;
    // O acumulado da última posição é 100 por definição: fixá-lo evita que a
    // soma de frações binárias termine em 99,999999 na tela.
    const cumPct =
      giroTotal > 0
        ? idx === ultimo
          ? 100
          : Math.min((acumulado / giroTotal) * 100, 100)
        : 0;

    // Giro zero nunca é prioridade A, nem quando o item é o único do conjunto:
    // um SKU que não sai da prateleira não é prioridade de compra — é candidato
    // a liquidação, que é a decisão oposta.
    //
    // O item de maior giro, quando tem giro, é sempre A. Sem essa guarda o
    // corte por acumulado INCLUSIVO produz um absurdo no caso degenerado: um
    // SKU que sozinho responde por 100% do giro tem acumulado 100 e cairia na
    // classe C.
    const prioridade: PrioridadeGiro =
      giro <= 0
        ? "C"
        : idx === 0
          ? "A"
          : cumPct <= CORTE_A
            ? "A"
            : cumPct <= CORTE_B
              ? "B"
              : "C";

    return { ...item, rank: idx + 1, pct, cumPct, prioridade } as T & CamposCurvaGiro;
  });

  const resumo = resumoVazio();
  resumo.total = classificados.length;
  resumo.giroTotal = giroTotal;
  for (const item of classificados) {
    const classe = resumo[item.prioridade];
    classe.count += 1;
    classe.giro += giroValido(item.unidadesPorDia);
  }
  for (const chave of ["A", "B", "C"] as const) {
    resumo[chave].pct = giroTotal > 0 ? (resumo[chave].giro / giroTotal) * 100 : 0;
  }

  return { itens: classificados, resumo };
}
