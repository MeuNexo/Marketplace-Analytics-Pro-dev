/**
 * Seletor puro dos dois cenários de MCO por LINHA — Fase 222, plano 222-15-R2.
 *
 * QUAL É O IRMÃO DELE: `src/lib/mcoCenarios.ts` decide, para um PERÍODO
 * inteiro, entre os quatro estados de procedência do DIFAL (cobrado pelo ML,
 * calculado, recolhido pela loja, indisponível) — e continua sendo a fonte
 * única disso. Este módulo decide outra coisa: o que UMA LINHA (um anúncio, um
 * intervalo, um pedido) tem a exibir nos dois cenários, e o motivo quando não
 * há segundo cenário. Os dois nunca duplicam a decisão do outro.
 *
 * 🔴 ESTE MÓDULO NÃO FAZ ARITMÉTICA DE MCO. Ele recebe os dois pares JÁ
 * APURADOS pela régua de quem apurou — o banco, nas telas de margem real
 * (`get_margin_with_ads_by_product`), ou `computeMco` chamado duas vezes, na
 * Análise de Preços. Recompor o segundo cenário aqui somando DIFAL sobre o
 * primeiro é exatamente o atalho que custou R$ 3,85 por pedido no retrabalho
 * 222-06-R/07-R: o DIFAL não custa o DIFAL cheio, porque ele derruba a base do
 * PIS/COFINS.
 *
 * POR QUE A AUSÊNCIA TEM NOME: um MCO "com DIFAL" exibido como R$ 0,00 é
 * indistinguível de um DIFAL que não carregou, de uma venda que não saiu do
 * estado e de uma loja do Simples Nacional. Três situações opostas, um número
 * só. `MotivoSemDifal` obriga cada uma a se declarar em palavras na tela.
 *
 * Puro: nenhum import de React, de interface ou de rede.
 */

import { DIFAL_ESTIMATIVA_LABEL, DIFAL_ESTIMATIVA_AJUDA } from "./mcoCenarios";

/** Um cenário de MCO já apurado: valor em reais e percentual da receita. */
export interface ValorPct {
  /** MCO em R$. */
  valor: number;
  /** MCO como % da receita; `null` quando a receita do recorte é zero. */
  pct: number | null;
}

/**
 * Por que a linha não tem segundo cenário — ou `"ok"` quando tem.
 *
 * NUNCA é inferido do valor ser zero: zero é um resultado legítimo (o DIFAL
 * estimado pode simplesmente não mover a margem daquele recorte), e tratá-lo
 * como ausência esconderia um número apurado.
 */
export type MotivoSemDifal =
  /** Há segundo cenário legítimo para exibir. */
  | "ok"
  /** Nenhuma venda saiu do estado de origem no recorte — DIFAL não incide. */
  | "sem_operacao_interestadual"
  /** Regime tributário da loja não recolhe DIFAL (Simples Nacional). */
  | "regime_nao_aplicavel"
  /** Há venda interestadual, mas a alíquota daquela UF não foi confirmada. */
  | "uf_nao_confirmada"
  /** O dado do segundo cenário não carregou (RPC ausente, erro ou pendente). */
  | "indisponivel";

export interface LinhaCenariosInput {
  /** Cenário SEM DIFAL — o número que a tela já exibia antes desta fase. */
  semDifal: ValorPct;
  /**
   * Cenário COM DIFAL, apurado pela MESMA régua que produziu o primeiro.
   * `null`/`undefined` quando a fonte não devolveu — o que acontece, por
   * exemplo, na janela entre publicar o frontend e aplicar a migration.
   */
  comDifal?: ValorPct | null;
  /**
   * Efeito líquido do DIFAL da linha, em R$ (o custo REAL de entrar com o
   * DIFAL, já descontada a queda do débito de PIS/COFINS).
   * `null`/`undefined` = não apurado.
   */
  difalEfeito?: number | null;
  /** Pedidos da linha com destino interestadual e sem DIFAL calculado. */
  pedidosDifalIndefinido?: number | null;
  /**
   * Houve venda para fora do estado de origem no recorte?
   * `false` afirma que não houve; `undefined` significa "não sabemos" — e não
   * saber nunca pode virar a afirmação de que o DIFAL não se aplica.
   */
  temOperacaoInterestadual?: boolean | null;
  /**
   * O regime tributário da loja recolhe DIFAL? `false` para Simples Nacional.
   * `undefined` = o chamador não sabe (a maioria das telas não sabe por linha).
   */
  regimeAplicaDifal?: boolean | null;
}

export interface LinhaCenariosResult {
  semDifal: ValorPct;
  /** `null` sempre que `motivo` for diferente de `"ok"` — nunca zero. */
  comDifal: ValorPct | null;
  /** Efeito líquido apurado; `null` quando não foi apurado. */
  difalEfeito: number | null;
  motivo: MotivoSemDifal;
  /** Contagem de pedidos fora da conta por UF não confirmada. Sempre exibível. */
  pedidosDifalIndefinido: number;
  /**
   * `true` quando o efeito apurado é exatamente zero. Serve para a tela dizer,
   * em palavras, POR QUE os dois números são iguais — dois números iguais e
   * mudos são indistinguíveis de um erro.
   */
  efeitoNulo: boolean;
}

/** Reexportados para as telas nunca redigitarem o texto da ressalva (D-12). */
export { DIFAL_ESTIMATIVA_LABEL, DIFAL_ESTIMATIVA_AJUDA };

/**
 * Decide o que uma linha exibe nos dois cenários.
 *
 * Ordem das decisões, e por que ela é essa:
 *
 * 1. **Regime primeiro.** Loja do Simples Nacional não recolhe DIFAL. Exibir
 *    um segundo número ali seria afirmar um imposto que ela não paga — mesmo
 *    que a linha, por qualquer motivo, traga efeito apurado.
 * 2. **Efeito ausente.** Sem efeito não há segundo cenário. Se houver pedidos
 *    interestaduais fora da conta, a ausência tem causa conhecida (a alíquota
 *    da UF ainda não foi confirmada pelo contador) e a tela diz isso com a
 *    contagem; senão, a causa é o dado não ter carregado.
 * 3. **Segundo par ausente.** O efeito veio mas o par não: é a janela de
 *    publicação (frontend novo, RPC antiga). Mostra-se o primeiro cenário e
 *    diz-se que o segundo não carregou — nunca se quebra a página.
 * 4. **Efeito zero.** Só é ausência quando SABEMOS que não houve venda fora do
 *    estado. Zero com venda interestadual é resultado apurado.
 */
export function resolveLinhaCenarios(entrada: LinhaCenariosInput): LinhaCenariosResult {
  const semDifal = entrada.semDifal;
  const pedidosDifalIndefinido = entrada.pedidosDifalIndefinido ?? 0;
  const difalEfeito = entrada.difalEfeito ?? null;
  const comDifalEntrada = entrada.comDifal ?? null;

  const ausencia = (motivo: MotivoSemDifal): LinhaCenariosResult => ({
    semDifal,
    comDifal: null,
    difalEfeito,
    motivo,
    pedidosDifalIndefinido,
    efeitoNulo: difalEfeito === 0,
  });

  if (entrada.regimeAplicaDifal === false) return ausencia("regime_nao_aplicavel");

  if (difalEfeito === null) {
    return ausencia(pedidosDifalIndefinido > 0 ? "uf_nao_confirmada" : "indisponivel");
  }

  if (comDifalEntrada === null) return ausencia("indisponivel");

  if (difalEfeito === 0 && entrada.temOperacaoInterestadual === false) {
    return ausencia("sem_operacao_interestadual");
  }

  return {
    semDifal,
    comDifal: comDifalEntrada,
    difalEfeito,
    motivo: "ok",
    pedidosDifalIndefinido,
    efeitoNulo: difalEfeito === 0,
  };
}

/**
 * Frase de negócio correspondente a cada motivo — fonte única do texto, para
 * sete superfícies de tela não divergirem no que afirmam sobre a mesma régua.
 * `"ok"` não tem frase de ausência: nesse caso o que aparece é o número.
 */
export function fraseMotivoSemDifal(
  motivo: MotivoSemDifal,
  pedidosDifalIndefinido = 0,
): string | null {
  switch (motivo) {
    case "ok":
      return null;
    case "sem_operacao_interestadual":
      return "Todas as vendas do recorte ficaram dentro do estado de origem — o DIFAL não se aplica.";
    case "regime_nao_aplicavel":
      return "O regime tributário desta loja não recolhe DIFAL — não há segundo cenário a estimar.";
    case "uf_nao_confirmada":
      return pedidosDifalIndefinido > 0
        ? `${pedidosDifalIndefinido} pedido(s) para fora do estado ainda sem alíquota confirmada — o cenário com DIFAL não pode ser estimado.`
        : "Alíquota do estado de destino ainda não confirmada — o cenário com DIFAL não pode ser estimado.";
    case "indisponivel":
      return "O cenário com DIFAL não carregou.";
  }
}

/** Frase que explica dois números iguais: o DIFAL estimado não moveu a margem. */
export const FRASE_EFEITO_NULO =
  "O DIFAL estimado não muda a margem neste recorte — os dois cenários coincidem.";
