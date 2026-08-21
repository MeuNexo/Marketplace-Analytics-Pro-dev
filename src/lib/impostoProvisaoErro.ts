// ============================================================================
// impostoProvisaoErro — Fase 224 Plano 04, Task 2 (ERR-05)
//
// Módulo puro que mede de quanto erra a provisão de imposto que o sistema JÁ
// FAZ (previsao_calc/get_dre_cash_forecast, Fase 100) contra o que de fato
// aconteceu — na régua de caixa e na régua de apuração da RPC
// get_imposto_provisao_erro (migration 20260821160000). Não propõe uma
// previsão melhor: mede o erro da que existe (224-CONTEXT <domain>).
//
// DUAS RÉGUAS, cada uma respondendo a sua pergunta:
//   'caixa'              -> quanto de imposto SAIU DO CAIXA no mês M
//   'apuracao_m_mais_1'  -> quanto as VENDAS do mês M geraram de imposto
//     (nome da coluna preservado por compatibilidade com 224-MEDICOES.md e
//     224-CONTEXT.md; o conteúdo casa pela MESMA competência da venda, não
//     por M+1 — a régua M+1 de useImpostoGuiaReal.ts foi medida e REFUTADA
//     para impostos_venda nesta conta em Q-B do 224-04-PLAN.md. A régua M+1
//     TRAVADA da Fase 94 continua intacta em useImpostoGuiaReal.ts; este
//     módulo não a altera nem a redecide — só nomeia o que a RPC devolve.)
//
// A régua é ARGUMENTO OBRIGATÓRIO, sem valor padrão: escolher por omissão é
// exatamente o defeito que este plano corrigiu (a versão anterior escolhia
// a régua pelo número que ela produzia).
//
// Sem React/Supabase — módulo 100% puro, testável sem rede.
// ============================================================================

/** Linha crua da RPC get_imposto_provisao_erro — 1 por mês de venda. */
export interface ImpostoProvisaoErroRow {
  mesVenda: string;
  faturamento: number;
  taxaMediaPrevista: number | null;
  nMesesBase: number;
  /** null quando o mês não tem base de 3 meses anteriores suficiente — nunca 0. */
  provisaoPrevista: number | null;
  /** null quando não há NENHUMA linha de guia no bloco fiscal no mês (lacuna) — nunca 0. */
  guiaCaixaNoMes: number | null;
  nGuiasCaixa: number;
  /** Competência lida pela régua de apuração (mesma competência da venda — ver cabeçalho). */
  competenciaApuracao: string;
  /** null quando a RPC de competência não devolve NENHUMA linha (lacuna) — nunca 0. */
  guiaApuracaoMMaisUm: number | null;
  nLinhasApuracao: number;
}

/** As duas únicas réguas de comparação — escolha é sempre explícita. */
export type ReguaImpostoProvisaoErro = "caixa" | "apuracao_m_mais_1";

/**
 * Mínimo de meses avaliáveis para o resumo ser considerado confiável. A
 * provisão medida usa média de 3 meses anteriores — abaixo de 4 meses
 * avaliáveis o resumo descreve praticamente uma única observação.
 */
export const N_MINIMO_DE_MESES = 4;

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Item de erro por mês, já na régua escolhida. */
export interface ItemErroProvisao {
  mesVenda: string;
  /** false quando provisão ou guia (na régua escolhida) são nulos — nada abaixo é lido. */
  avaliavel: boolean;
  provisaoPrevista: number | null;
  guia: number | null;
  /** provisão prevista menos guia; positivo é provisionar a mais. null quando não avaliável. */
  erroReais: number | null;
  /** erroReais ÷ guia × 100; null quando não avaliável ou guia = 0 (nunca Infinity). */
  erroPct: number | null;
  /** competência usada na régua de apuração — exposta em ambas as réguas, vinda da linha crua. */
  competenciaApuracao: string;
}

/**
 * Monta um item por mês de venda, ordenado por `mesVenda` ascendente, na
 * régua escolhida. `regua` é obrigatório — ver cabeçalho do módulo.
 */
export function construirErroDaProvisao(
  rows: ImpostoProvisaoErroRow[],
  regua: ReguaImpostoProvisaoErro,
): ItemErroProvisao[] {
  if (!rows || rows.length === 0) return [];

  const itens = rows.map((r): ItemErroProvisao => {
    const guia = regua === "caixa" ? r.guiaCaixaNoMes : r.guiaApuracaoMMaisUm;
    const avaliavel = r.provisaoPrevista != null && guia != null;

    const erroReais = avaliavel ? round2((r.provisaoPrevista as number) - (guia as number)) : null;
    const erroPct =
      avaliavel && guia !== 0 ? round2(((erroReais as number) / (guia as number)) * 100) : null;

    return {
      mesVenda: r.mesVenda,
      avaliavel,
      provisaoPrevista: r.provisaoPrevista ?? null,
      guia: guia ?? null,
      erroReais,
      erroPct,
      competenciaApuracao: r.competenciaApuracao,
    };
  });

  return itens.slice().sort((a, b) => (a.mesVenda < b.mesVenda ? -1 : a.mesVenda > b.mesVenda ? 1 : 0));
}

/** Resumo por razão de somas — nunca média de razões mensais (mesma disciplina de ERR-01). */
export interface ResumoErroProvisao {
  /** soma(provisaoPrevista) ÷ soma(guia), sobre os meses avaliáveis. null quando soma(guia) = 0. */
  fator: number | null;
  /** soma(|erroReais|) ÷ soma(guia). null quando soma(guia) = 0. */
  wape: number | null;
  /** soma(provisaoPrevista) − soma(guia), sinal preservado — viés total em reais no período. */
  vies: number | null;
  somaProvisao: number | null;
  somaGuia: number | null;
  mesesAvaliaveis: number;
  /** false quando mesesAvaliaveis < N_MINIMO_DE_MESES. */
  suficiente: boolean;
}

export function resumirErroDaProvisao(itens: ItemErroProvisao[]): ResumoErroProvisao {
  const avaliaveis = (itens ?? []).filter((i) => i.avaliavel);
  const mesesAvaliaveis = avaliaveis.length;
  const suficiente = mesesAvaliaveis >= N_MINIMO_DE_MESES;

  if (mesesAvaliaveis === 0) {
    return {
      fator: null,
      wape: null,
      vies: null,
      somaProvisao: null,
      somaGuia: null,
      mesesAvaliaveis: 0,
      suficiente: false,
    };
  }

  const somaProvisao = round2(avaliaveis.reduce((acc, i) => acc + (i.provisaoPrevista as number), 0));
  const somaGuia = round2(avaliaveis.reduce((acc, i) => acc + (i.guia as number), 0));
  const somaErroAbs = round2(avaliaveis.reduce((acc, i) => acc + Math.abs(i.erroReais as number), 0));
  const vies = round2(somaProvisao - somaGuia);

  const fator = somaGuia !== 0 ? somaProvisao / somaGuia : null;
  const wape = somaGuia !== 0 ? somaErroAbs / somaGuia : null;

  return { fator, wape, vies, somaProvisao, somaGuia, mesesAvaliaveis, suficiente };
}
