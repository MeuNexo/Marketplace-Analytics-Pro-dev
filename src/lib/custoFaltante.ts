// ============================================================================
// custoFaltante — Fase 213, Plano 05, Task 1 (AV-03)
//
// Régua deste módulo, em uma frase: sem CMV não existe margem, e uma tela que
// mostra um traço célula a célula sem dizer QUANTOS traços são não está
// informando — está escondendo.
//
// Por que existe: `/produtos-vendidos` tem o sinal de CMV ausente por item e por
// grupo, e `/pedidos` tem o banner; já `/anuncios` e `/publicidade` ficam mudas.
// Numa organização 100% sem custo — o caso real da conta Thales — a tela inteira
// fica muda em vez de gritar, e o operador lê traços isolados como "faltou um
// dado ali" em vez de "nenhuma margem desta tela vale".
//
// A régua da obrigatoriedade é a EXISTÊNCIA de faltante, não um limiar de
// percentual. Um anúncio sem custo em cem já basta: aquele anúncio pode ser
// exatamente o que está dando prejuízo, e um limiar de 5% ou 10% seria uma
// escolha arbitrária que decide por quem lê. O percentual muda apenas a
// INTENSIDADE da apresentação (o componente usa tom mais forte quando o conjunto
// inteiro está sem custo), nunca se o aviso aparece.
//
// Divisão vazia: conjunto sem nenhuma linha devolve percentual `null`, nunca
// 100% e nunca `NaN`. "Não há o que contar" não é "está tudo errado".
//
// Este módulo é PURO: nenhum import de React, de Supabase ou de rede.
// ============================================================================

/**
 * O mínimo que a contagem exige de cada linha exibida: se ela tem CMV.
 *
 * Quem chama decide como resolve `temCusto`, e deve usar EXATAMENTE a mesma
 * fonte das colunas de margem da própria tela — no catálogo de `/anuncios` é o
 * custo resolvido por item ou por SKU (`custo != null`, porque custo zero é um
 * custo válido); em `/publicidade` é o `has_cmv` da linha de margem.
 */
export interface LinhaCusto {
  temCusto: boolean;
}

/** O que a tela precisa saber para decidir se avisa, e com que intensidade. */
export interface ContagemCusto {
  /** Quantas linhas exibidas estão sem CMV. */
  semCusto: number;
  /** Quantas linhas foram consideradas (o conjunto EXIBIDO, já filtrado). */
  total: number;
  /** Percentual de faltantes, uma casa decimal. `null` quando `total === 0`. */
  pctSemCusto: number | null;
  /** `true` só quando há linhas e TODAS estão sem CMV. */
  todosSemCusto: boolean;
}

/**
 * Conta quantas das linhas exibidas estão sem CMV.
 *
 * O conjunto passado tem de ser o **exibido** — o filtrado, não o catálogo
 * inteiro. Um aviso que conta o catálogo inteiro enquanto a tela mostra um
 * recorte filtrado é uma terceira régua escondida, exatamente o defeito que a
 * fase 213 está corrigindo.
 */
export function contarSemCusto(linhas: readonly LinhaCusto[]): ContagemCusto {
  const total = linhas.length;
  const semCusto = linhas.reduce((n, l) => (l.temCusto ? n : n + 1), 0);

  return {
    semCusto,
    total,
    // Divisão vazia devolve indefinido, jamais 100%.
    pctSemCusto: total > 0 ? Math.round((semCusto / total) * 1000) / 10 : null,
    todosSemCusto: total > 0 && semCusto === total,
  };
}

/**
 * O aviso agregado é obrigatório sempre que houver ao menos um faltante.
 *
 * Sem limiar: a decisão de "quanto de ausência já incomoda" é de quem lê o
 * número, não de quem desenha a tela.
 */
export function avisoCustoObrigatorio(contagem: ContagemCusto): boolean {
  return contagem.semCusto > 0;
}
