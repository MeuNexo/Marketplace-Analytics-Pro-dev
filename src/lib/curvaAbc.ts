// ============================================================================
// curvaAbc — Fase 213, Plano 04, Task 1 (CR-06, AV-06)
//
// Régua deste módulo, em uma frase: a Curva ABC classifica por RECEITA
// REALIZADA NO PERÍODO INFORMADO — quem escolhe o período é o chamador, e o
// módulo nunca busca dado, nunca inventa preço e nunca multiplica unidades por
// preço de hoje.
//
// Por que este módulo existe (CR-06): a Curva ABC de `/anuncios` ordenava por
// `sold_quantity × price` — unidades vendidas ao longo de ANOS multiplicadas
// pelo preço de HOJE. Como a régua não era a do seletor de período da tela, o
// autor escondeu o seletor quando a sub-aba ABC estava ativa, em vez de
// corrigir a fonte. O efeito prático: um produto aposentado há um ano continua
// na Curva A e segue puxando estoque e verba de publicidade, e a coluna
// "Receita" do Ranking e a coluna "Receita" da ABC mostram números diferentes
// para o mesmo anúncio com o mesmo rótulo.
//
// AV-06 (`calcularParticipacao`): a coluna de participação dividia pela receita
// de TODOS os itens enquanto o KPI de Receita Total ao lado somava só os
// FILTRADOS — com filtro de marca ativo a coluna não fechava em cem e não batia
// com o cartão ao lado. A correção é aritmética: dividir pela soma do conjunto
// que a função recebe. Quem chama passa o conjunto filtrado.
//
// Os cortes são os mesmos de sempre — acumulado até 80% é curva A, até 95% é B,
// o resto é C —, idênticos aos da Curva de Giro de `/estoque`
// (`MLEstoque.tsx`, `SubTabCurvaABC`). O que muda é a receita que entra, não
// onde se corta.
//
// Determinismo: o empate de receita é desempatado pelo identificador. Sem isso
// a ordem de itens empatados depende da ordem de chegada dos dados e a mesma
// carteira pode produzir curvas diferentes entre dois carregamentos da tela.
//
// Este módulo é PURO: nenhum import de React, de Supabase ou de rede.
// ============================================================================

export type CurvaAbc = "A" | "B" | "C";

/** O mínimo que a classificação exige de cada item: quem é, e quanto rendeu. */
export interface EntradaCurvaAbc {
  id: string;
  /** Receita JÁ APURADA no período que o chamador escolheu. */
  receita: number;
}

/** Campos que a classificação acrescenta a cada item. */
export interface CamposCurvaAbc {
  /** Posição no ranking de receita, começando em 1. */
  rank: number;
  /** Participação individual sobre a receita do conjunto, em %. */
  pct: number;
  /** Participação acumulada até esta posição, em %. Termina em 100 exato. */
  cumPct: number;
  curva: CurvaAbc;
}

export interface ResumoClasseAbc {
  count: number;
  revenue: number;
  /** Fatia da receita total que a classe representa, em %. */
  pct: number;
}

export interface ResumoCurvaAbc {
  A: ResumoClasseAbc;
  B: ResumoClasseAbc;
  C: ResumoClasseAbc;
  /** Quantidade de itens classificados. */
  total: number;
  /** Soma da receita do conjunto recebido. */
  receitaTotal: number;
}

export interface ResultadoCurvaAbc<T> {
  /** Itens ordenados por receita decrescente, com os campos da classificação. */
  itens: (T & CamposCurvaAbc)[];
  resumo: ResumoCurvaAbc;
}

/** Corte da curva A: acumulado até este percentual. */
const CORTE_A = 80;
/** Corte da curva B: acumulado até este percentual. */
const CORTE_B = 95;

/**
 * Receita saneada: valor não finito ou negativo não é receita, é ruído de
 * fonte. Vira zero em vez de contaminar o total e produzir NaN na tela.
 */
function receitaValida(valor: number): number {
  return Number.isFinite(valor) && valor > 0 ? valor : 0;
}

/**
 * Classifica um conjunto de itens em curvas A, B e C pela receita informada.
 *
 * O chamador entrega a receita já apurada no período que a tela mostra — este
 * módulo não sabe de onde ela veio e não a recalcula.
 */
export function classificarCurvaAbc<T extends EntradaCurvaAbc>(
  itens: readonly T[],
): ResultadoCurvaAbc<T> {
  const resumoVazio = (): ResumoCurvaAbc => ({
    A: { count: 0, revenue: 0, pct: 0 },
    B: { count: 0, revenue: 0, pct: 0 },
    C: { count: 0, revenue: 0, pct: 0 },
    total: 0,
    receitaTotal: 0,
  });

  if (itens.length === 0) {
    return { itens: [], resumo: resumoVazio() };
  }

  const receitaTotal = itens.reduce((s, i) => s + receitaValida(i.receita), 0);

  // Ordem decrescente de receita, com desempate por identificador — a mesma
  // entrada produz sempre a mesma classificação.
  const ordenados = [...itens].sort((a, b) => {
    const diff = receitaValida(b.receita) - receitaValida(a.receita);
    if (diff !== 0) return diff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const ultimo = ordenados.length - 1;
  let acumulado = 0;

  const classificados = ordenados.map((item, idx) => {
    const receita = receitaValida(item.receita);
    acumulado += receita;

    const pct = receitaTotal > 0 ? (receita / receitaTotal) * 100 : 0;
    // O acumulado da última posição é 100 por definição: fixá-lo evita que a
    // soma de frações binárias termine em 99,999999 na tela.
    const cumPct =
      receitaTotal > 0
        ? idx === ultimo
          ? 100
          : Math.min((acumulado / receitaTotal) * 100, 100)
        : 0;

    // Receita zero nunca é curva A, nem quando o item é o único do conjunto:
    // um anúncio que não vendeu no período não é prioridade de estoque.
    //
    // O item de maior receita, quando tem receita, é sempre A. Sem essa guarda
    // o corte por acumulado INCLUSIVO produz um absurdo no caso degenerado: um
    // anúncio que sozinho responde por 100% da receita tem acumulado 100 e
    // cairia na curva C. Fora esse caso, os cortes são exatamente os de hoje.
    const curva: CurvaAbc =
      receita <= 0
        ? "C"
        : idx === 0
          ? "A"
          : cumPct <= CORTE_A
            ? "A"
            : cumPct <= CORTE_B
              ? "B"
              : "C";

    return { ...item, rank: idx + 1, pct, cumPct, curva } as T & CamposCurvaAbc;
  });

  const resumo = resumoVazio();
  resumo.total = classificados.length;
  resumo.receitaTotal = receitaTotal;
  for (const item of classificados) {
    const classe = resumo[item.curva];
    classe.count += 1;
    classe.revenue += receitaValida(item.receita);
  }
  for (const chave of ["A", "B", "C"] as const) {
    resumo[chave].pct =
      receitaTotal > 0 ? (resumo[chave].revenue / receitaTotal) * 100 : 0;
  }

  return { itens: classificados, resumo };
}

/**
 * Participação de cada item sobre a soma do conjunto RECEBIDO (AV-06).
 *
 * Quem chama passa o conjunto filtrado — o mesmo que alimenta o KPI de Receita
 * Total ao lado da tabela. É isso que faz a coluna fechar em cem dentro do
 * filtro ativo e bater com o cartão.
 *
 * A ordem recebida é preservada: a ordenação da tabela é decisão de quem chama.
 */
export function calcularParticipacao<T extends EntradaCurvaAbc>(
  itens: readonly T[],
): (T & { participacao: number })[] {
  const total = itens.reduce((s, i) => s + receitaValida(i.receita), 0);
  return itens.map((item) => ({
    ...item,
    participacao: total > 0 ? (receitaValida(item.receita) / total) * 100 : 0,
  }));
}
