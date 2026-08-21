/**
 * seloPromo.ts — a régua do ESTADO ATUAL da promoção de rebate (Quick task
 * 260821-nof, D-selo-01..04).
 *
 * QUAL É O IRMÃO DELE, E POR QUE NÃO É UMA GENERALIZAÇÃO: `rebateLinhaCenarios.ts`
 * responde "quanto custa perder o rebate NO PERÍODO" — o par com/sem rebate que
 * o detalhe do anúncio continua mostrando. Este módulo responde outra pergunta:
 * "qual é o estado da promoção AGORA" — o selo compacto que substitui o par nas
 * listas. Acoplar os dois faria uma mudança na régua do par mudar o selo sem
 * querer, e vice-versa (mesma disciplina da 223-PATTERNS, decisão (b)).
 *
 * POR QUE ISTO EXISTE (D-selo-04, o risco central do plano): o agregado do
 * período SUBESTIMA justamente o anúncio que entrou em promoção ontem. Medido
 * no MLB6977801882, 30 dias: 24 pedidos SEM rebate entre 23/07 e 09/08 (0,0%) e
 * 14 pedidos COM rebate entre 12/08 e 19/08 (52,2%) — a média do agregado
 * (19,2%) não é "o número do período", é a média entre três semanas sem
 * promoção e uma semana com a tarifa subsidiada pela metade. Por isso o selo
 * NUNCA deriva do agregado: ele vem de uma SEGUNDA consulta com uma janela
 * curta, ancorada no FIM do período exibido.
 *
 * 🔴 ESTE MÓDULO NÃO FAZ ARITMÉTICA DE REBATE. `comissao` e `rebateBruto` já
 * vêm apurados por quem apurou (o banco); a única conta feita aqui é a razão
 * simples `rebateBruto ÷ (comissao + rebateBruto)` — a mesma fórmula que
 * `rebateLinhaCenarios.ts` já expõe como `comRebate`/`semRebate`, só que sobre
 * a janela recente em vez do período inteiro.
 *
 * 🔴 `sem_venda_recente` NUNCA cai em silêncio para a média do período. É a
 * ÚNICA forma de este trabalho falhar por dentro parecendo que funcionou:
 * cair para a média sem avisar reintroduziria escondido o viés que a
 * D-selo-04 veio remover. O `titulo` desse estado carrega a média — mas o
 * `texto` do selo, nunca.
 *
 * Puro: nenhum import de React, de interface ou de rede.
 */

import {
  FRASE_REBATE_PARCIAL,
  fraseMotivoSemRebate,
  type MotivoSemRebate,
} from "./rebateLinhaCenarios";

/**
 * Tamanho da janela do estado atual, em dias corridos. Trocar o recorte do
 * selo é trocar ESTA constante — nada mais no módulo depende de "sete" como
 * número mágico.
 */
export const JANELA_ESTADO_ATUAL_DIAS = 7;

/** Um período de datas, sempre em `YYYY-MM-DD` (comparável lexicograficamente). */
export interface JanelaPeriodo {
  from: string;
  to: string;
}

/**
 * Recorta um período para os últimos `dias` dias corridos, ancorados no FIM
 * do período — nunca em hoje. Grampeada: nunca devolve uma janela que comece
 * antes do `from` original, mesmo que `dias` seja maior que a duração do
 * período (D-selo-04, propriedade 2).
 *
 * Comparação por string funciona porque as datas chegam em `YYYY-MM-DD`: a
 * ordem lexicográfica é a ordem cronológica.
 */
export function janelaEstadoAtual(
  periodo: JanelaPeriodo,
  dias: number = JANELA_ESTADO_ATUAL_DIAS,
): JanelaPeriodo {
  const candidato = deslocarDias(periodo.to, -(dias - 1));
  const from = candidato > periodo.from ? candidato : periodo.from;
  return { from, to: periodo.to };
}

/** Desloca uma data `YYYY-MM-DD` em `n` dias (negativo = para trás), sem depender de fuso. */
function deslocarDias(iso: string, n: number): string {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const base = new Date(Date.UTC(ano, mes - 1, dia));
  base.setUTCDate(base.getUTCDate() + n);
  const y = base.getUTCFullYear();
  const m = String(base.getUTCMonth() + 1).padStart(2, "0");
  const d = String(base.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ─── Os sete estados ──────────────────────────────────────────────────────────

export type EstadoSelo =
  /** (a) Anúncio ausente da janela recente — nenhuma venda nela. */
  | "sem_venda_recente"
  /** (b)/(f) Insumo ausente ou zero, com pedido cuja tarifa não bate — erro nosso. */
  | "conferencia_nao_fecha"
  /** (c)/(g) Insumo ausente ou zero, com pedido ainda não consultado na fatura. */
  | "nao_capturado"
  /** (d)/(e) Sem contagem nenhuma, ou denominador inválido. */
  | "indisponivel"
  /** (h) Rebate bruto zero, sem nenhuma lacuna — medição, não ausência. */
  | "sem_promo"
  /** (i) Percentual positivo apurado sobre recorte com lacuna aberta. */
  | "com_promo_parcial"
  /** (j) Percentual positivo apurado, sem lacuna. */
  | "com_promo";

/** Os textos curtos por estado — os únicos que aparecem no selo em si. */
const TEXTO_POR_ESTADO: Record<
  Exclude<EstadoSelo, "com_promo" | "com_promo_parcial">,
  string
> = {
  // 🔴 [260821-qps] Célula VAZIA, não selo: um anúncio que não vendeu na
  // semana não é lacuna nem erro — não merece marca nenhuma na tela. O estado
  // continua existindo por dentro (`data-selo-promo="sem_venda_recente"`) e o
  // `titulo` continua carregando a ressalva; só a marca visível saiu.
  sem_venda_recente: "",
  // 🔴 [260821-qps] Os três estados de ausência convergem para o mesmo traço
  // discreto — decisão do Wesley em 21/08 com a tela na frente: "o sistema não
  // pode dizer 'não sei' nem 'erro nosso'". A DISTINÇÃO NÃO FOI PERDIDA: cada
  // um mantém seu `estado`, seu `data-selo-promo` e seu `titulo` com o motivo
  // real. O que saiu foi a confissão vaga na célula onde se decide preço.
  conferencia_nao_fecha: "—",
  nao_capturado: "—",
  indisponivel: "—",
  sem_promo: "—",
};

export interface SeloPromoInput {
  /** Comissão REAL (com rebate) da JANELA RECENTE, R$ — denominador da fórmula. */
  comissao: number;
  /** Rebate bruto da JANELA RECENTE, R$; `null` = não apurado (ausência). */
  rebateBruto: number | null;
  /**
   * Efeito líquido do rebate da JANELA RECENTE — não entra na fórmula do
   * percentual, mas é um gate de ausência adicional: um chamador que sabe que
   * o efeito não foi apurado (mesmo que `rebateBruto` por algum motivo tenha
   * chegado sozinho) pode declarar isso aqui, e o selo respeita — nunca
   * confia silenciosamente que uma coluna presente sozinha significa dado
   * bom (mesma cautela de `computeSemRebatePonto` em `precoMcoSeries.ts`).
   */
  rebateEfeito?: number | null;
  /** Pedidos da janela recente ainda não consultados na fatura do Mercado Livre. */
  pedidosSemCaptura?: number | null;
  /** Pedidos da janela recente cuja tarifa cobrada não bate com a comissão gravada. */
  pedidosNaoConferidos?: number | null;
  /** O anúncio (ou grupo) teve QUALQUER venda na janela recente? */
  semVendaNaJanela: boolean;
  /**
   * Percentual médio do rebate no PERÍODO INTEIRO (o agregado que a D-selo-04
   * tirou do selo) — usado SÓ no `titulo`, nunca no `texto`. `null` quando o
   * período também não tem apuração.
   */
  mediaPeriodoPct?: number | null;
}

export interface SeloPromoResult {
  estado: EstadoSelo;
  /** Percentual do estado atual; `null` em todo estado que não seja com_promo(_parcial). */
  pct: number | null;
  /** O texto curto do selo — nunca um percentual quando o estado não afirma promoção. */
  texto: string;
  /** O texto completo do `title`/tooltip — nomeia a causa e, quando aplicável, a média do período. */
  titulo: string;
}

/** Formata o percentual do selo — nunca `0% promo` (T-nof-02). */
function formatarPct(pct: number): string {
  if (pct < 1) return "<1% promo";
  return `${Math.round(pct)}% promo`;
}

/** Reusa a frase da 223-02 — nunca redigita o motivo de ausência. */
function tituloAusencia(
  motivo: MotivoSemRebate,
  pedidosSemCaptura: number,
  pedidosNaoConferidos: number,
): string {
  return (
    fraseMotivoSemRebate(motivo, pedidosSemCaptura, pedidosNaoConferidos) ??
    TEXTO_POR_ESTADO[motivo as Exclude<EstadoSelo, "com_promo" | "com_promo_parcial">]
  );
}

function resultadoAusencia(
  estado: Exclude<EstadoSelo, "com_promo" | "com_promo_parcial" | "sem_venda_recente" | "sem_promo">,
  motivoReuso: MotivoSemRebate,
  pedidosSemCaptura: number,
  pedidosNaoConferidos: number,
): SeloPromoResult {
  return {
    estado,
    pct: null,
    texto: TEXTO_POR_ESTADO[estado],
    titulo: tituloAusencia(motivoReuso, pedidosSemCaptura, pedidosNaoConferidos),
  };
}

function tituloSemVendaRecente(mediaPeriodoPct: number | null | undefined): string {
  const media = mediaPeriodoPct != null ? `${mediaPeriodoPct.toFixed(1)}%` : "—";
  return (
    `Sem venda nos últimos ${JANELA_ESTADO_ATUAL_DIAS} dias — o estado atual da ` +
    `promoção é desconhecido. A média do período inteiro foi ${media}, mas ela ` +
    `NÃO representa o estado atual: a promoção pode ter começado ou terminado ` +
    `depois da última venda registrada.`
  );
}

const SELO_RECORTE_FRASE =
  `janela recente (${JANELA_ESTADO_ATUAL_DIAS} dias)` as const;

/**
 * Decide o estado do selo — a ordem de decisão da tabela `<a_regua_do_selo>`,
 * linhas (a) a (j), e por que ela é essa:
 *
 * (a) **Ausência de venda na janela recente vem PRIMEIRO**, antes de qualquer
 *     outra checagem: sem venda não há como medir o estado atual, e cair para
 *     qualquer outro número (inclusive a média) reintroduziria escondido o
 *     viés que este selo existe para remover.
 * (b)-(d) **Insumo ausente**: mesma ordem de causa da 223-02 — conferência
 *     que não fecha é mais específica que "não capturamos ainda" (é erro
 *     NOSSO, e é a única acionável), e "indisponível" só quando nenhuma das
 *     duas contagens explica a ausência.
 * (e) **Denominador inválido ou rebate negativo**: o dado não sustenta um
 *     percentual — não é medição, é indisponibilidade.
 * (f)-(h) **Percentual zero**: zero nunca é ausência (é medição — "não teve
 *     promoção nesses pedidos"), MAS uma lacuna aberta vence o zero medido:
 *     "nada nos pedidos que eu vi, e há pedidos que eu não vi" não é o mesmo
 *     que "vi tudo e não tinha promoção".
 * (i)/(j) **Percentual positivo**: um pedido faltando não pode apagar uma
 *     medição boa, mas o número também não pode se apresentar como fechado —
 *     por isso vira `com_promo_parcial`, com asterisco, em vez de sumir ou
 *     de se disfarçar de `com_promo`.
 */
export function resolveSeloPromo(entrada: SeloPromoInput): SeloPromoResult {
  const pedidosSemCaptura = entrada.pedidosSemCaptura ?? 0;
  const pedidosNaoConferidos = entrada.pedidosNaoConferidos ?? 0;
  const mediaPeriodoPct = entrada.mediaPeriodoPct ?? null;

  // (a) Nunca cai para a média — é o único jeito de este plano falhar por
  // dentro parecendo que funcionou (D-selo-04).
  if (entrada.semVendaNaJanela) {
    return {
      estado: "sem_venda_recente",
      pct: null,
      texto: TEXTO_POR_ESTADO.sem_venda_recente,
      titulo: tituloSemVendaRecente(mediaPeriodoPct),
    };
  }

  // O rebate bruto (ou o efeito líquido, quando o chamador o declara ausente
  // separadamente) é o insumo mínimo do selo.
  const rebateAusente = entrada.rebateBruto == null || entrada.rebateEfeito === null;

  // (b)-(d) Insumo ausente.
  if (rebateAusente) {
    if (pedidosNaoConferidos > 0) {
      return resultadoAusencia(
        "conferencia_nao_fecha",
        "conferencia_nao_fecha",
        pedidosSemCaptura,
        pedidosNaoConferidos,
      );
    }
    if (pedidosSemCaptura > 0) {
      return resultadoAusencia("nao_capturado", "nao_capturado", pedidosSemCaptura, pedidosNaoConferidos);
    }
    return resultadoAusencia("indisponivel", "indisponivel", pedidosSemCaptura, pedidosNaoConferidos);
  }

  const rebateBruto = entrada.rebateBruto as number;
  const comissaoCheia = entrada.comissao + rebateBruto;

  // (e) Denominador inválido, ou rebate negativo (estorno mal formado) — o
  // dado não sustenta um percentual.
  if (comissaoCheia <= 0 || rebateBruto < 0) {
    return resultadoAusencia("indisponivel", "indisponivel", pedidosSemCaptura, pedidosNaoConferidos);
  }

  const pctBruto = (100 * rebateBruto) / comissaoCheia;

  // (f)-(h) Percentual zero.
  if (pctBruto === 0) {
    if (pedidosNaoConferidos > 0) {
      return resultadoAusencia(
        "conferencia_nao_fecha",
        "conferencia_nao_fecha",
        pedidosSemCaptura,
        pedidosNaoConferidos,
      );
    }
    if (pedidosSemCaptura > 0) {
      return resultadoAusencia("nao_capturado", "nao_capturado", pedidosSemCaptura, pedidosNaoConferidos);
    }
    return {
      estado: "sem_promo",
      pct: null,
      texto: TEXTO_POR_ESTADO.sem_promo,
      titulo: tituloAusencia("sem_campanha_no_periodo", pedidosSemCaptura, pedidosNaoConferidos),
    };
  }

  // (i)/(j) Percentual positivo.
  const texto = formatarPct(pctBruto);
  const temLacuna = pedidosSemCaptura > 0 || pedidosNaoConferidos > 0;

  if (temLacuna) {
    const fraseParcial = FRASE_REBATE_PARCIAL(pedidosSemCaptura, pedidosNaoConferidos);
    return {
      estado: "com_promo_parcial",
      pct: pctBruto,
      texto: `${texto}*`,
      titulo: `${texto} apurado sobre a ${SELO_RECORTE_FRASE} — parcial: ${fraseParcial ?? ""}`.trim(),
    };
  }

  return {
    estado: "com_promo",
    pct: pctBruto,
    texto,
    titulo: `${texto} na ${SELO_RECORTE_FRASE} — parte da margem depende de a campanha comercial continuar.`,
  };
}

// ─── Agregação sobre uma série diária ──────────────────────────────────────────

/**
 * Um ponto diário mínimo, no formato que `PrecoSeriesRow` (`precoMcoSeries.ts`)
 * já entrega — nomes conferidos contra a origem, não redigitados: `qtd`,
 * `comissao`, `rebate_bruto`, `pedidos_sem_captura_rebate`,
 * `pedidos_rebate_nao_conferido`. Este tipo é deliberadamente estrutural (só
 * os campos que a régua consome), para o módulo continuar sem dependência da
 * RPC inteira.
 */
export interface PontoSerieRebate {
  /** `YYYY-MM-DD`. */
  bucket: string;
  qtd: number;
  comissao: number;
  /** `null`/ausente = não apurado no bucket. */
  rebateBruto?: number | null;
  pedidosSemCaptura?: number | null;
  pedidosNaoConferidos?: number | null;
}

/**
 * Agrega os pontos da série diária dentro da `janelaEstadoAtual` de `periodo`
 * e devolve o resultado de `resolveSeloPromo`. Ausência de `rebateBruto` em
 * QUALQUER ponto da janela propaga — nunca soma só os apurados, porque um
 * numerador parcial sobre um denominador cheio inventa um percentual.
 */
export function estadoAtualDaSerie(
  serie: readonly PontoSerieRebate[],
  periodo: JanelaPeriodo,
  mediaPeriodoPct: number | null = null,
  dias: number = JANELA_ESTADO_ATUAL_DIAS,
): SeloPromoResult {
  const janela = janelaEstadoAtual(periodo, dias);
  const pontos = (serie ?? []).filter((p) => p.bucket >= janela.from && p.bucket <= janela.to);

  const temVenda = pontos.some((p) => p.qtd > 0);
  if (!temVenda) {
    return resolveSeloPromo({
      comissao: 0,
      rebateBruto: null,
      semVendaNaJanela: true,
      mediaPeriodoPct,
    });
  }

  let comissaoSum = 0;
  let rebateBrutoSum = 0;
  let algumSemRebate = false;
  let pedidosSemCapturaSum = 0;
  let pedidosNaoConferidosSum = 0;

  for (const p of pontos) {
    comissaoSum += p.comissao ?? 0;
    if (p.rebateBruto == null) {
      algumSemRebate = true;
    } else {
      rebateBrutoSum += p.rebateBruto;
    }
    pedidosSemCapturaSum += p.pedidosSemCaptura ?? 0;
    pedidosNaoConferidosSum += p.pedidosNaoConferidos ?? 0;
  }

  return resolveSeloPromo({
    comissao: comissaoSum,
    rebateBruto: algumSemRebate ? null : rebateBrutoSum,
    pedidosSemCaptura: pedidosSemCapturaSum,
    pedidosNaoConferidos: pedidosNaoConferidosSum,
    semVendaNaJanela: false,
    mediaPeriodoPct,
  });
}

// ─── A data de início da faixa vigente ──────────────────────────────────────────

export interface InicioPromocaoResult {
  /** `YYYY-MM-DD` do primeiro dia da faixa contígua vigente; `null` = sem promoção vigente. */
  data: string | null;
  /**
   * `true` quando a faixa alcança o primeiro ponto da série — a série só
   * enxerga o período exibido, e afirmar o início a partir dessa borda
   * confundiria o limite da consulta com o começo do fato. A tela escreve
   * "ativa desde PELO MENOS" quando `truncada` é verdadeiro.
   */
  truncada: boolean;
}

/**
 * Varre a série (ordenada internamente, para não depender da ordem de quem
 * chama) do fim para o começo, procurando a faixa contígua de dias COM VENDA
 * e rebate positivo mais recente.
 *
 * Dia sem venda NÃO quebra a faixa — ausência de venda não é ausência de
 * promoção; tratar como quebra encurtaria a faixa e mentiria a data para
 * baixo. Dia COM venda e rebate zero quebra: é o fim (olhando do presente
 * para o passado) da campanha.
 */
export function inicioPromocaoVigente(
  serie: readonly PontoSerieRebate[],
): InicioPromocaoResult {
  if (!serie || serie.length === 0) return { data: null, truncada: false };

  const ordenada = [...serie].sort((a, b) =>
    a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0,
  );

  let dataInicio: string | null = null;
  let primeiroDiaComVendaVisto = false;

  for (let i = ordenada.length - 1; i >= 0; i--) {
    const ponto = ordenada[i];
    if (ponto.qtd <= 0) continue; // dia sem venda: pula, nunca quebra a faixa

    const temRebate = (ponto.rebateBruto ?? 0) > 0;

    if (!primeiroDiaComVendaVisto) {
      primeiroDiaComVendaVisto = true;
      // O dia mais recente com venda não tem rebate: não há promoção vigente.
      if (!temRebate) return { data: null, truncada: false };
    } else if (!temRebate) {
      // Dia com venda e rebate zero no meio da faixa: quebra — a data
      // devolvida é a do reinício, não a do começo original.
      return { data: dataInicio, truncada: false };
    }

    dataInicio = ponto.bucket;
  }

  // Varreu a série inteira sem achar quebra: a faixa alcança a borda.
  if (dataInicio !== null) return { data: dataInicio, truncada: true };
  return { data: null, truncada: false };
}

/** O recorte do selo, declarado em palavras — para tooltips de cabeçalho de coluna. */
export const SELO_RECORTE_AJUDA =
  `O selo mede o estado da promoção nos últimos ${JANELA_ESTADO_ATUAL_DIAS} dias do ` +
  `período exibido — não a média do período inteiro. Uma janela que atravessa o ` +
  `início ou o fim de uma campanha pode misturar os dois estados por alguns dias; ` +
  `o detalhe do anúncio mostra desde quando a promoção vigente está ativa.`;
