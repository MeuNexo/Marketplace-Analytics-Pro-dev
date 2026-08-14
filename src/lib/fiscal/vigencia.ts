/**
 * vigencia.ts — decide o que fazer ao SALVAR a régua fiscal de uma loja:
 * corrigir a vigência corrente, abrir uma nova, ou recusar (Fase 222,
 * plano 222-05-R).
 *
 * Helper PURO, no molde de `mcoCenarios.ts`: zero IO, zero React, zero cliente
 * de banco. Quem escreve é a tela; este arquivo só decide.
 *
 * POR QUE ISTO EXISTE: a tela fiscal salvava por upsert, sobrescrevendo a
 * única linha da loja. Com isso a alteração de alíquota apagava a régua
 * anterior, e todo pedido recalculado depois passava a usar a alíquota nova —
 * inclusive os do passado. Foi assim que 352 pedidos do Junior de 01–10/08/2026
 * foram regravados com 4% quando a config mudou de 6% para 4% em 11/08.
 * Versionar a leitura e deixar a escrita como estava não conserta nada: o
 * histórico nasceria correto uma vez e seria destruído no segundo salvamento.
 *
 * A REGRA, EM UMA FRASE: mudar a alíquota com uma data POSTERIOR à do início
 * da vigência corrente cria história; mudar com a MESMA data corrige a
 * vigência corrente (escolha explícita do usuário, não omissão); mudar com
 * data ANTERIOR sobreporia vigência já encerrada e é recusado.
 */

/** A vigência corrente da loja (a linha com `vigencia_fim` nulo). */
export interface VigenciaAberta {
  id: string;
  /** `AAAA-MM-DD`. Nulo em banco ainda não migrado — ver `abrir_nova` abaixo. */
  vigencia_inicio: string | null;
}

/**
 * O que a tela deve executar. União discriminada: nenhum caminho de escrita
 * fica implícito, e `recusar` NUNCA escreve nada.
 */
export type PlanoSalvamentoVigencia<T> =
  | { acao: "inserir_primeira"; vigencia_inicio: string; campos: T }
  | { acao: "atualizar"; id: string; vigencia_inicio: string; campos: T }
  | {
      acao: "abrir_nova";
      /** Linha da vigência corrente, a ser fechada em `fechar_em`. */
      id_anterior: string;
      /** Último dia da vigência anterior: o dia ANTERIOR ao novo início. */
      fechar_em: string;
      vigencia_inicio: string;
      campos: T;
    }
  | { acao: "recusar"; motivo: string };

const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normaliza para `AAAA-MM-DD` ou devolve `null`.
 *
 * Valida o formato E a existência do dia no calendário: `2026-13-45` casa com
 * a expressão mas não é data — deixar passar produziria uma vigência que nunca
 * cobre pedido nenhum, e a loja sairia sem imposto sem ninguém entender por quê.
 */
function normalizarData(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim().substring(0, 10);
  if (!FORMATO_DATA.test(s)) return null;
  // Comparar de volta com o que o calendário devolve rejeita 31/02 e 13/45 sem
  // aritmética própria de mês. `Date.UTC` mantém tudo em UTC: converter para
  // horário local reintroduz o desvio de fuso que faz um dia virar o anterior.
  const [ano, mes, dia] = s.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.toISOString().substring(0, 10) === s ? s : null;
}

/** Dia anterior a uma data `AAAA-MM-DD`, em UTC puro (sem desvio de fuso). */
function diaAnterior(data: string): string {
  const [ano, mes, dia] = data.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia) - 24 * 60 * 60 * 1000);
  return d.toISOString().substring(0, 10);
}

/**
 * Decide como salvar a régua fiscal de uma loja.
 *
 * - Sem vigência aberta (loja nunca configurada) → inserir a primeira, com
 *   início na data informada.
 * - Data informada IGUAL ao início da vigência aberta → atualizar aquela
 *   linha. É correção retroativa por escolha explícita do usuário: ele viu a
 *   data no formulário e não a mudou.
 * - Data informada POSTERIOR → fechar a aberta no dia anterior e inserir uma
 *   vigência nova a partir da data informada. O passado fica preservado.
 * - Data informada ANTERIOR → recusar: sobreporia uma vigência já encerrada, e
 *   a restrição de não-sobreposição do banco recusaria de qualquer forma —
 *   melhor dizer isso na tela do que estourar erro de banco.
 * - Data ausente ou malformada → recusar. Nunca cair no caminho de atualizar,
 *   que é justamente o que destrói o histórico.
 * - Vigência aberta com início ILEGÍVEL (banco ainda não migrado) → abrir
 *   nova. Não dá para saber se a data informada é correção ou período novo, e
 *   preservar o passado é a direção conservadora: o pior caso é uma linha a
 *   mais, nunca dado histórico destruído.
 *
 * `campos` é repassado intacto — este helper não interpreta nenhum valor
 * fiscal, só decide onde ele vai.
 */
export function planejarSalvamentoVigencia<T>(
  vigenciaAberta: VigenciaAberta | null | undefined,
  dataInicioInformada: unknown,
  campos: T,
): PlanoSalvamentoVigencia<T> {
  const inicio = normalizarData(dataInicioInformada);
  if (inicio === null) {
    return {
      acao: "recusar",
      motivo:
        "Informe a data a partir da qual esta régua fiscal vale, no formato dia/mês/ano. Sem ela não dá para saber se a alteração corrige o período atual ou inaugura um novo.",
    };
  }

  if (!vigenciaAberta) {
    return { acao: "inserir_primeira", vigencia_inicio: inicio, campos };
  }

  const inicioAtual = normalizarData(vigenciaAberta.vigencia_inicio);
  if (inicioAtual === null) {
    return {
      acao: "abrir_nova",
      id_anterior: vigenciaAberta.id,
      fechar_em: diaAnterior(inicio),
      vigencia_inicio: inicio,
      campos,
    };
  }

  if (inicio === inicioAtual) {
    return { acao: "atualizar", id: vigenciaAberta.id, vigencia_inicio: inicio, campos };
  }

  if (inicio < inicioAtual) {
    return {
      acao: "recusar",
      motivo:
        `A régua vigente começa em ${inicioAtual}. Uma data anterior a essa sobreporia uma vigência já encerrada — ` +
        "para corrigir o período atual, use a própria data dele; para registrar uma mudança, use uma data posterior.",
    };
  }

  return {
    acao: "abrir_nova",
    id_anterior: vigenciaAberta.id,
    fechar_em: diaAnterior(inicio),
    vigencia_inicio: inicio,
    campos,
  };
}
