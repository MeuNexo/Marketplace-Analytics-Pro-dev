/**
 * Seletor puro dos dois cenários de REBATE por LINHA — Fase 223, plano 223-02.
 *
 * QUAL É O IRMÃO DELE: `src/lib/mcoLinhaCenarios.ts` decide o par sem/com
 * DIFAL — imposto, estimativa declarada (D-12 da Fase 222). Este módulo
 * decide outra coisa: o que uma linha (um anúncio, um pedido, um recorte) tem
 * a exibir nos dois cenários de REBATE — desconto de comissão efetivamente
 * creditado, medido na fatura do Mercado Livre. São duas réguas
 * INDEPENDENTES, e os motivos de ausência de uma não significam nada para a
 * outra (`sem_operacao_interestadual`/`regime_nao_aplicavel`/
 * `uf_nao_confirmada` são do DIFAL; `sem_campanha_no_periodo`/
 * `nao_capturado`/`conferencia_nao_fecha` são do rebate). Acoplar os dois no
 * mesmo tipo faz uma mudança na régua fiscal quebrar a leitura de promoção, e
 * vice-versa (223-PATTERNS, decisão (b)) — por isso este é um módulo irmão,
 * não uma generalização de `mcoLinhaCenarios`.
 *
 * 🔴 ESTE MÓDULO NÃO FAZ ARITMÉTICA DE REBATE. Ele recebe os dois pares JÁ
 * APURADOS por quem apurou — o banco (223-03/223-05). Somar o rebate cru
 * sobre a margem pronta é o mesmo atalho que custou R$ 3,85 por pedido no
 * retrabalho 222-06-R/07-R: o segundo cenário não custa o rebate cheio,
 * porque comissão maior gera crédito maior de PIS/COFINS, e esse crédito
 * abate parte do golpe. `rebateEfeito` já vem líquido desse crédito;
 * `rebateBruto` é o valor cru da fatura, exibido só para conferência.
 *
 * POR QUE A AUSÊNCIA TEM NOME (D-223-06): `rebate: 0.0` é MEDIÇÃO — o anúncio
 * não estava em campanha comercial no período, e a margem dele já é por
 * mérito próprio. Pedido sem linha capturada na tabela é AUSÊNCIA DE
 * CAPTURA — não sabemos. E a medição do 223-01 obrigou um TERCEIRO estado a
 * existir: pedido cuja tarifa cobrada (`sale_fee`) não bate com a comissão
 * que gravamos (`orders.comissao × quantidade`) — aí o erro é NOSSO, e o
 * rebate daquele pedido não pode ser afirmado em lugar nenhum. Os três
 * produzem "dois números iguais" (ou "sem segundo número"), e são respostas
 * diferentes à pergunta que a fase existe para responder. Zero nunca é
 * inferido de ausência, e ausência nunca é exibida como zero.
 *
 * Puro: nenhum import de React, de interface ou de rede.
 */

/** Um cenário de rebate já apurado: valor em reais e percentual da receita. */
export interface ValorPct {
  /** Valor em R$. */
  valor: number;
  /** Percentual da receita; `null` quando a receita do recorte é zero. */
  pct: number | null;
}

/**
 * Por que a linha não tem segundo cenário (sem rebate) — ou `"ok"` quando
 * tem.
 *
 * NUNCA é inferido do valor ser zero: zero é um resultado legítimo (o rebate
 * pode simplesmente não ter existido naquele recorte), e tratá-lo como
 * ausência esconderia um número medido.
 */
export type MotivoSemRebate =
  /** Há segundo cenário legítimo para exibir. */
  | "ok"
  /** Nenhum pedido do recorte teve rebate no período — medido, não lacuna. */
  | "sem_campanha_no_periodo"
  /** Pedido(s) ainda não consultados na fatura do Mercado Livre — não sabemos. */
  | "nao_capturado"
  /**
   * A tarifa que o ML cobrou (`sale_fee`) não bate com a comissão gravada
   * (`orders.comissao × quantidade`). Causa NOSSA, não do ML: o rebate
   * daquele(s) pedido(s) não pode ser afirmado enquanto a conferência não
   * fechar.
   */
  | "conferencia_nao_fecha"
  /** O dado do segundo cenário não carregou (RPC ausente, erro ou pendente). */
  | "indisponivel";

export interface LinhaRebateInput {
  /** Cenário COM rebate — o número REAL, o que o semáforo continua colorindo. */
  comRebate: ValorPct;
  /**
   * Cenário SEM rebate — a mesma venda com a tarifa cheia (`gross`).
   * `null`/`undefined` quando a fonte não devolveu — por exemplo, na janela
   * entre publicar o frontend e aplicar a migration.
   */
  semRebate?: ValorPct | null;
  /**
   * Efeito LÍQUIDO de perder o rebate, em R$: o custo REAL de a campanha
   * acabar, já descontado o crédito maior de PIS/COFINS que a tarifa cheia
   * gera. `null`/`undefined` = não apurado (nada capturado, ou conferência
   * que não fecha).
   *
   * 🔵 Valor TOTAL do pedido, não por unidade — a medição do 223-01 provou
   * que `sale_fee` é o total e `orders.comissao` é por unidade
   * (`net == comissao × quantidade`). Foi essa ambiguidade que produziu o
   * defeito de comissão subestimada registrado no contrato (223-CONTRATO-
   * SALE-FEE.md, Q3). Quem consome este campo precisa saber qual unidade
   * está lendo.
   */
  rebateEfeito?: number | null;
  /**
   * Valor CRU do rebate na fatura (`sale_fee.rebate`), exibido só para
   * conferência — não é o efeito líquido, não é o que a margem usa.
   *
   * 🔵 Também valor TOTAL do pedido, mesma ressalva de `rebateEfeito`.
   */
  rebateBruto?: number | null;
  /** Pedidos do recorte ainda sem linha capturada na tabela de sale_fee. */
  pedidosSemCaptura?: number | null;
  /**
   * Pedidos do recorte cuja tarifa cobrada não bate com a comissão gravada —
   * a conferência que não fecha. Tem precedência sobre `pedidosSemCaptura`
   * como causa da ausência: é mais específica, e é a única acionável por nós.
   */
  pedidosNaoConferidos?: number | null;
}

export interface LinhaRebateResult {
  comRebate: ValorPct;
  /** `null` sempre que `motivo` for diferente de `"ok"` — nunca zero. */
  semRebate: ValorPct | null;
  /** Efeito líquido apurado; `null` quando não foi apurado. */
  rebateEfeito: number | null;
  /** Valor cru da fatura, só para conferência; `null` quando não apurado. */
  rebateBruto: number | null;
  motivo: MotivoSemRebate;
  /** Contagem de pedidos fora da conta por falta de captura. Sempre exibível. */
  pedidosSemCaptura: number;
  /** Contagem de pedidos fora da conta por conferência que não fecha. */
  pedidosNaoConferidos: number;
  /**
   * `true` quando o efeito apurado é exatamente zero. Serve para a tela dizer,
   * em palavras, POR QUE os dois números são iguais — dois números iguais e
   * mudos são indistinguíveis de um erro.
   */
  efeitoNulo: boolean;
}

/** O rótulo curto do segundo cenário — as quatro superfícies herdam esta palavra. */
export const REBATE_CENARIO_LABEL = "tarifa cheia";

/**
 * O texto de ajuda do segundo cenário — a mesma venda com a tarifa sem
 * campanha, com o crédito maior de PIS/COFINS já descontado.
 */
export const REBATE_CENARIO_AJUDA =
  "Mesma venda com a tarifa cheia do Mercado Livre (sem o desconto de campanha comercial), já descontado o crédito maior de PIS/COFINS que a tarifa maior gera.";

/**
 * Decide o que uma linha exibe nos dois cenários de rebate.
 *
 * Ordem das decisões, e por que ela é essa:
 *
 * 1. **Conferência que não fecha primeiro, entre as ausências de efeito.**
 *    Se o efeito não foi apurado E há pedidos cuja tarifa cobrada não bate
 *    com a comissão gravada, a causa é `conferencia_nao_fecha` — é mais
 *    específica que "não capturamos ainda", e é erro NOSSO, não do ML.
 * 2. **Efeito ausente, sem conferência quebrada.** Sem efeito não há segundo
 *    cenário. Se houver pedidos sem captura, a ausência tem causa conhecida
 *    (ainda não consultamos a fatura) e a tela diz isso com a contagem;
 *    senão, a causa é o dado não ter carregado.
 * 3. **Segundo par ausente.** O efeito veio mas o par não: é a janela de
 *    publicação (frontend novo, migration ainda não aplicada). Mostra-se o
 *    primeiro cenário e diz-se que o segundo não carregou — nunca se quebra
 *    a página.
 * 4. **Efeito zero, com captura completa E conferência fechada.** Só é
 *    "sem campanha no período" quando SABEMOS que nenhum pedido do recorte
 *    ficou de fora — captura completa e conferência fechada, os dois. Efeito
 *    zero com qualquer lacuna aberta não pode afirmar "sem campanha": vira
 *    `"ok"`, os dois números aparecem, e a contagem da lacuna acompanha.
 */
export function resolveLinhaRebate(entrada: LinhaRebateInput): LinhaRebateResult {
  const comRebate = entrada.comRebate;
  const pedidosSemCaptura = entrada.pedidosSemCaptura ?? 0;
  const pedidosNaoConferidos = entrada.pedidosNaoConferidos ?? 0;
  const rebateEfeito = entrada.rebateEfeito ?? null;
  const rebateBruto = entrada.rebateBruto ?? null;
  const semRebateEntrada = entrada.semRebate ?? null;

  const ausencia = (motivo: MotivoSemRebate): LinhaRebateResult => ({
    comRebate,
    semRebate: null,
    rebateEfeito,
    rebateBruto,
    motivo,
    pedidosSemCaptura,
    pedidosNaoConferidos,
    efeitoNulo: rebateEfeito === 0,
  });

  if (rebateEfeito === null) {
    if (pedidosNaoConferidos > 0) return ausencia("conferencia_nao_fecha");
    return ausencia(pedidosSemCaptura > 0 ? "nao_capturado" : "indisponivel");
  }

  if (semRebateEntrada === null) return ausencia("indisponivel");

  if (rebateEfeito === 0 && pedidosSemCaptura === 0 && pedidosNaoConferidos === 0) {
    return ausencia("sem_campanha_no_periodo");
  }

  return {
    comRebate,
    semRebate: semRebateEntrada,
    rebateEfeito,
    rebateBruto,
    motivo: "ok",
    pedidosSemCaptura,
    pedidosNaoConferidos,
    efeitoNulo: rebateEfeito === 0,
  };
}

/**
 * Frase de negócio correspondente a cada motivo — fonte única do texto, para
 * as quatro superfícies (D-223-07) não divergirem no que afirmam sobre a
 * mesma régua. `"ok"` não tem frase de ausência: nesse caso o que aparece é o
 * número.
 */
export function fraseMotivoSemRebate(
  motivo: MotivoSemRebate,
  pedidosSemCaptura = 0,
  pedidosNaoConferidos = 0,
): string | null {
  switch (motivo) {
    case "ok":
      return null;
    case "sem_campanha_no_periodo":
      return "Nenhum pedido do recorte teve rebate no período — a margem já é por mérito próprio.";
    case "nao_capturado":
      return pedidosSemCaptura > 0
        ? `${pedidosSemCaptura} pedido(s) ainda não consultado(s) na fatura do Mercado Livre — o cenário sem rebate não pode ser estimado.`
        : "Pedidos ainda não consultados na fatura do Mercado Livre — o cenário sem rebate não pode ser estimado.";
    case "conferencia_nao_fecha":
      return pedidosNaoConferidos > 0
        ? `A tarifa cobrada não bate com a comissão gravada em ${pedidosNaoConferidos} pedido(s) — o erro é nosso, e o rebate deles não pode ser afirmado.`
        : "A tarifa cobrada não bate com a comissão gravada — o erro é nosso, e o rebate não pode ser afirmado.";
    case "indisponivel":
      return "O cenário sem rebate não carregou.";
  }
}

/**
 * Frase que acompanha o par quando ele EXISTE (`motivo === "ok"`) mas parte
 * dos pedidos do recorte ficou fora da conta — por falta de captura, por
 * conferência que não fecha, ou pelas duas causas ao mesmo tempo. Distingue
 * as duas causas em vez de somá-las numa contagem só, porque uma é lacuna
 * (não sabemos) e a outra é erro nosso (sabemos, e é acionável).
 */
export function FRASE_REBATE_PARCIAL(
  pedidosSemCaptura: number,
  pedidosNaoConferidos: number,
): string | null {
  if (pedidosSemCaptura <= 0 && pedidosNaoConferidos <= 0) return null;

  const partes: string[] = [];
  if (pedidosSemCaptura > 0) {
    partes.push(`${pedidosSemCaptura} pedido(s) ainda não consultado(s)`);
  }
  if (pedidosNaoConferidos > 0) {
    partes.push(`${pedidosNaoConferidos} pedido(s) com tarifa que não confere (erro nosso)`);
  }
  return `${partes.join(" e ")} ficaram fora desta conta.`;
}

/**
 * Formato mínimo de uma linha de `get_margin_with_ads_by_product` — só os
 * campos que o par de cenários de rebate consome. Deliberadamente estrutural
 * (e não o tipo inteiro do hook) para este módulo continuar sem dependência
 * de rede.
 */
export interface LinhaMargemComRebate {
  lucro: number;
  lucro_pct: number | null;
  lucro_pos_ads: number;
  lucro_pct_pos_ads: number | null;
  lucro_sem_rebate?: number | null;
  lucro_pct_sem_rebate?: number | null;
  lucro_pos_ads_sem_rebate?: number | null;
  lucro_pct_pos_ads_sem_rebate?: number | null;
  rebate_efeito?: number | null;
  rebate_bruto?: number | null;
  pedidos_rebate_sem_captura?: number | null;
  pedidos_rebate_nao_conferidos?: number | null;
}

/**
 * Monta o par de cenários de rebate de uma linha de margem REAL — a que vem
 * pronta do banco. Existe para as três telas de margem real (D-223-07: 2, 3 e
 * 4) não escreverem três vezes a mesma projeção: foi assim que a página de
 * anúncios acabou com duas fórmulas de margem, uma por ramo de renderização
 * (CR-08).
 *
 * 🔴 Zero aritmética: os valores já vieram prontos do banco, trocando só o
 * termo pré/pós-Ads.
 */
export function cenariosRebateMargemReal(
  linha: LinhaMargemComRebate | null | undefined,
  qual: "preAds" | "posAds",
): LinhaRebateResult {
  const preAds = qual === "preAds";
  const comRebateValor = preAds ? linha?.lucro ?? 0 : linha?.lucro_pos_ads ?? 0;
  const comRebatePct = preAds ? linha?.lucro_pct ?? null : linha?.lucro_pct_pos_ads ?? null;
  const semValor = preAds ? linha?.lucro_sem_rebate : linha?.lucro_pos_ads_sem_rebate;
  const semPct = preAds ? linha?.lucro_pct_sem_rebate : linha?.lucro_pct_pos_ads_sem_rebate;

  return resolveLinhaRebate({
    comRebate: { valor: comRebateValor, pct: comRebatePct },
    semRebate: semValor != null ? { valor: semValor, pct: semPct ?? null } : null,
    rebateEfeito: linha?.rebate_efeito,
    rebateBruto: linha?.rebate_bruto,
    pedidosSemCaptura: linha?.pedidos_rebate_sem_captura,
    pedidosNaoConferidos: linha?.pedidos_rebate_nao_conferidos,
  });
}
