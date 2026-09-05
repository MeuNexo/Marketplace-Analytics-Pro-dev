/**
 * conciliacaoFamilias.ts — quais rótulos do Protetor do Caixa AFIRMAM um
 * desfecho, e quais apenas relatam o que se sabe.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE (239-05, item 1 do 239-VEREDITO) ────────────
 *
 * O contrato da fase 239, ditado pelo Wesley: *"ele é o ditador da verdade, e
 * para ditar ele precisa provar"*. Rótulo afirmativo exige as TRÊS linhas do
 * card fechadas — esperado, recebido e diferença. Sem elas, o item não é caso.
 *
 * 🔴 A exceção dos `entrada_sem_origem` estava decidida EM PROSA e não em
 * código. O predicado que mediu a invariante testava `tipo_caso like
 * '%_em_aberto'` — um SUFIXO, não a propriedade. Foi por acidente de sufixo que
 * as 9 linhas de `entrada_sem_origem` entraram na conta como violação, e seria
 * por acidente de sufixo que uma família NOVA escaparia dela em silêncio.
 *
 * `entrada_sem_origem` não afirma desfecho nenhum: ela diz o que provou —
 * entrou dinheiro, não casou com pedido — e o motivo nomeia a procedência
 * (compra do titular, repasse de frete, pedido não ingerido). Classificação de
 * procedência é outra grandeza, não comparação de esperado × recebido.
 *
 * ⚠️ A lista é FECHADA de propósito. Família que não está aqui não é
 * "provavelmente inofensiva": é desconhecida, e `exigeProva` a trata como
 * afirmativa — o lado seguro, porque força o portão a falhar em vez de deixar
 * passar acusação sem conta.
 */

/** Rótulos que AFIRMAM o que aconteceu com o dinheiro. Exigem as três linhas. */
export const FAMILIAS_QUE_AFIRMAM = [
  "repasse_a_menor",
  "repasse_ausente",
  "frete_a_maior",
  // ── 244-03: as duas da régua de comissão ─────────────────────────────────
  // As DUAS afirmam, e por isso as duas exigem as três linhas. O que muda
  // entre elas não é o rigor da prova: é CONTRA O QUE a prova foi feita.
  // `comissao_a_maior` afirma sobre a tarifa do Mercado Livre (fonte
  // independente); `comissao_divergente` afirma que as duas leituras DELE
  // discordam entre si. Nenhuma das duas pode aparecer sem esperado, cobrado e
  // diferença fechados.
  "comissao_a_maior",
  "comissao_divergente",
] as const;

/** Rótulos que NÃO afirmam desfecho — dizem qual pergunta está em aberto. */
export const FAMILIAS_QUE_NAO_AFIRMAM = [
  "repasse_em_aberto",
  "frete_em_aberto",
  "comissao_em_aberto",
  // 🔴 A exceção que motivou o arquivo. Ela é declarada, não derivada do nome.
  "entrada_sem_origem",
] as const;

export type FamiliaConhecida =
  | (typeof FAMILIAS_QUE_AFIRMAM)[number]
  | (typeof FAMILIAS_QUE_NAO_AFIRMAM)[number];

const NAO_AFIRMAM: ReadonlySet<string> = new Set(FAMILIAS_QUE_NAO_AFIRMAM);
const AFIRMAM: ReadonlySet<string> = new Set(FAMILIAS_QUE_AFIRMAM);

/** A família é conhecida por esta régua? */
export function familiaConhecida(tipoCaso: string | null | undefined): boolean {
  const t = (tipoCaso ?? "").trim();
  return AFIRMAM.has(t) || NAO_AFIRMAM.has(t);
}

/**
 * Este rótulo precisa das três linhas provadas?
 *
 * 🔴 Desconhecido responde `true`. Ausência de declaração é dúvida, e dúvida
 * cai no lado que faz o portão FALHAR — nunca no que deixa passar. É a mesma
 * régua de `aceite.ts` (225-13): campo que não veio não vira zero.
 */
export function exigeProva(tipoCaso: string | null | undefined): boolean {
  return !NAO_AFIRMAM.has((tipoCaso ?? "").trim());
}

/** A linha honra o contrato: ou não afirma, ou afirma com as três linhas. */
export function linhaHonraOContrato(linha: {
  tipo_caso: string | null;
  esperado_nosso: number | null;
  recebido: number | null;
  diferenca: number | null;
}): boolean {
  if (!exigeProva(linha.tipo_caso)) return true;
  return (
    linha.esperado_nosso !== null && linha.recebido !== null && linha.diferenca !== null
  );
}

/**
 * O rótulo da LINHA, não do código solto — o segundo portão, na tela.
 *
 * 🔴 A RPC já rebaixa para `*_em_aberto` a linha que não fecha as três provas
 * (239-04). Este portão existe porque aquela régua mora dentro de uma função
 * SQL de 400 linhas: uma regressão lá volta a emitir `repasse_a_menor` com as
 * três colunas nulas, e o card voltaria a acusar sem conta sem que nada
 * quebrasse. Aqui a acusação não passa.
 *
 * ⚠️ Ele mora NESTE arquivo, e não em `casoUrgencia.ts`, porque aquele módulo é
 * puro **sem uma única linha de `import`** — e há portão que reprova o
 * contrário. A dependência anda no sentido certo: quem precisa da isenção
 * importa daqui.
 */
export function rotuloTipoCasoDaLinha(
  linha: {
    tipo_caso: string | null;
    esperado_nosso: number | null;
    recebido: number | null;
    diferenca: number | null;
  },
  rotulo: (codigo: string | null | undefined) => string,
): string {
  if (linhaHonraOContrato(linha)) return rotulo(linha.tipo_caso);
  return "Em aberto — falta prova";
}
