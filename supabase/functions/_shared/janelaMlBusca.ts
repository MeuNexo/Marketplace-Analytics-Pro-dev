/**
 * janelaMlBusca.ts — a régua de janela da busca de pedidos do Mercado Livre
 * (Fase 225, plano 225-10).
 *
 * Módulo PURO, no mesmo molde de `flexOrder.ts`, `orderTaxRate.ts` e
 * `janelaDataPedido.ts`: NENHUM import, nenhuma referência ao runtime das edge
 * functions, zero IO — importável tanto pelo Deno das edge functions quanto pelo
 * vitest (node).
 *
 * ── POR QUE ESTE MÓDULO EXISTE ──────────────────────────────────────────────
 *
 * `sync-ml-orders` passou a ter DOIS consumidores da mesma janela: a captura,
 * que varre um período, e a conferência, que colhe os identificadores dia a dia
 * para o diff por conjunto. Se as duas montarem a janela por conta própria, um
 * pedido que caia do outro lado da borda é acusado de ausente sem estar — e as
 * duas réguas divergem em SILÊNCIO, que é a classe de defeito que derrubou o
 * saldo na Fase 233.
 *
 * Então a régua é uma só, e mora aqui. O portão de forma de `sync-ml-orders`
 * afirma que nenhum literal de meia-noite BRT sobrevive fora deste arquivo.
 *
 * ── E POR QUE ELE É TESTADO POR COMPORTAMENTO, NÃO SÓ POR TEXTO ─────────────
 *
 * O desenho inteiro da repescagem repousa em aritmética de data: a janela de 30
 * dias, o rodízio de blocos, o gatilho em D−3, a virada de mês e de ano. Um
 * portão de forma prova que o código TEM a forma certa; só um teste de
 * comportamento prova que ele CALCULA certo. `janelaDataPedido.ts` está nesta
 * pasta justamente porque um erro de fronteira de data passou meses invisível
 * em produção.
 */

/** Profundidade da janela de repescagem, em dias. */
export const REPESCAGEM_JANELA_DIAS = 30;

/**
 * Teto de dias examinados por invocação. O bloqueio por excesso do ML é por
 * ENDEREÇO DE ORIGEM e derrubaria as outras sincronizações junto: recuar é
 * obrigatório, insistir não.
 */
export const REPESCAGEM_TETO_DIAS = 10;

/**
 * Profundidade da janela retroativa do corpo VIVO de `dispatch_orders_jobs`
 * (`v_dias_retro := 3`). A rodada diária despacha D−1, D−2 e D−3 como jobs de um
 * dia; a repescagem pega carona na mais antiga das três, que ocorre uma vez por
 * dia. O cron horário varre sempre o dia CORRENTE, então nunca casa com isto.
 */
export const REPESCAGEM_DIA_GATILHO = 3;

/**
 * A ÚNICA construção de janela BRT do sync de pedidos. Meia-noite BRT = 03:00Z.
 *
 * O fim é o último milissegundo do dia `dateTo`, e não a meia-noite seguinte:
 * a API do ML trata `order.date_created.to` como INCLUSIVO, então fechar em
 * `dateTo+1 00:00Z` traria o primeiro instante do dia seguinte para dentro.
 */
export function janelaBRT(dateFrom: string, dateTo: string): { rangeStart: Date; rangeEnd: Date } {
  const rangeStart   = new Date(`${dateFrom}T03:00:00.000Z`);
  const rangeEndBase = new Date(`${dateTo}T03:00:00.000Z`);
  rangeEndBase.setUTCDate(rangeEndBase.getUTCDate() + 1);
  return { rangeStart, rangeEnd: new Date(rangeEndBase.getTime() - 1) };
}

/**
 * Desloca um dia do calendário (`AAAA-MM-DD`) por N passos.
 *
 * Ancorado ao MEIO-DIA UTC de propósito: aritmética de dia ancorada na
 * meia-noite passa a depender do fuso do runtime, e é assim que se produz o
 * defeito dos 111 pedidos gravados um dia antes do correto
 * (`225-CENSO-PEDIDOS.md`, seção 5). Virada de mês, virada de ano e fevereiro
 * saem de graça do `setUTCDate`, sem tabela de dias.
 */
export function deslocarDia(dia: string, passos: number): string {
  const d = new Date(`${dia}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + passos);
  return d.toISOString().substring(0, 10);
}

/**
 * Os dias do calendário de uma janela, inclusivos nas duas pontas.
 *
 * Janela invertida devolve lista VAZIA, sem lançar: quem decide o que fazer com
 * isso é o chamador. O teto de 400 iterações é rede de segurança — janela maior
 * que um ano é erro de chamada, não pedido.
 */
export function diasDaJanela(dateFrom: string, dateTo: string): string[] {
  const dias: string[] = [];
  let atual = dateFrom;
  for (let i = 0; i < 400 && atual <= dateTo; i++) {
    dias.push(atual);
    atual = deslocarDia(atual, 1);
  }
  return dias;
}

/** O dia do calendário BRT de um instante. Meia-noite BRT = 03:00Z. */
export function hojeBRT(agora: Date = new Date()): string {
  return new Date(agora.getTime() - 3 * 60 * 60 * 1000).toISOString().substring(0, 10);
}

/**
 * A trava da repescagem: reconhece a rodada diária pela FORMA do job, sem tabela
 * nova e sem cron novo.
 *
 * O cron diário insere jobs de um dia só; o cron horário varre sempre o dia
 * corrente; a sincronização manual da tela usa faixa arbitrária. Se por acaso
 * uma manual coincidir com D−3, a repescagem roda duas vezes no mesmo dia — e
 * rodar duas vezes é inofensivo, porque ela só INSERE o que falta.
 * **A trava protege contra custo, não contra correção.**
 */
export function temAssinaturaDaRodadaDiaria(dateFrom: string, dateTo: string, hoje: string): boolean {
  if (dateFrom !== dateTo) return false;
  return dateFrom === deslocarDia(hoje, -REPESCAGEM_DIA_GATILHO);
}

/**
 * A fatia da janela de 30 dias que ESTA invocação examina.
 *
 * Rodízio sem estado novo em tabela: o bloco sai do próprio dia do calendário,
 * então três rodadas seguidas cobrem os 30 dias sem furo e sem sobreposição, e a
 * rodada seguinte retoma de onde a anterior parou por construção. Cada dia é
 * reexaminado a cada 3 rodadas — folga larga contra os ~12 dias do pior atraso
 * de fechamento já medido.
 */
export function blocoDaRepescagem(hoje: string): {
  bloco: number;
  blocos: number;
  de: string;
  ate: string;
  dias: number;
} {
  const blocos = Math.ceil(REPESCAGEM_JANELA_DIAS / REPESCAGEM_TETO_DIAS);
  const diasDesdeEpoca = Math.floor(Date.parse(`${hoje}T12:00:00.000Z`) / 86_400_000);
  const bloco = ((diasDesdeEpoca % blocos) + blocos) % blocos;

  const maisAntigo  = Math.min(REPESCAGEM_JANELA_DIAS, (bloco + 1) * REPESCAGEM_TETO_DIAS);
  const maisRecente = bloco * REPESCAGEM_TETO_DIAS + 1;

  return {
    bloco,
    blocos,
    de:   deslocarDia(hoje, -maisAntigo),
    ate:  deslocarDia(hoje, -maisRecente),
    dias: maisAntigo - maisRecente + 1,
  };
}
