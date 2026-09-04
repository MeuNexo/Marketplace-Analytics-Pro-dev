// ============================================================================
// 225-03 — a régua de urgência do monitor de conciliação ("Protetor do caixa")
//
// 🔴 MÓDULO PURO, DE PROPÓSITO. Sem React, sem Supabase, sem `@/components`,
// sem uma única linha de `import`. Há grep no plano que reprova o contrário.
//
// 🔴 ELE NÃO CALCULA PRAZO. `dias_restantes` chega pronto de
// `get_casos_conciliacao` (225-02), que o deriva de `data_evento` com a régua
// de 30 dias de D-225-01. Duas réguas para o mesmo número foi exatamente como
// o saldo quebrou na fase 233 — aqui a régua mora no banco e a tela só rotula.
//
// ⚠️ `tom` é um dos quatro nomes do UI-SPEC, NUNCA uma classe Tailwind: mapear
// tom → classe é decisão da página. O módulo não conhece CSS.
//
// ⚠️ Os limiares não são os de `claimStatus.ts`. Lá a régua é o
// `action_due_date` do claim; aqui é a janela de ressarcimento do ML. O que se
// copiou de lá foi a forma (pura, nulo explícito), nunca os números.
// ============================================================================

/** Os quatro tons nomeados do UI-SPEC. A página traduz para classe. */
export type TomUrgencia = "destructive" | "warning" | "neutro" | "expirado";

export interface RotuloUrgencia {
  /** Texto sempre com o número — cor sozinha falha em foto de tela e no sol. */
  texto: string;
  tom: TomUrgencia;
  /** Falso a partir de 15 dias: o estado normal não recebe cor. */
  badge: boolean;
  /** Só "Expira hoje" — o único caso em que peso extra ainda significa algo. */
  forte: boolean;
}

/** Um número utilizável? Nulo, indefinido e NaN são todos "não sei". */
function finito(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Rótulo de prazo a partir de `dias_restantes` já calculado pela RPC.
 *
 * 🔴 O corte de 15 dias é o coração da tela: 87,7% dos repasses liberam em
 * 7–14 dias (research Q3). Dar cor ao estado normal apagaria o sinal dos dois
 * estados que pedem atenção, que é o propósito inteiro deste monitor.
 */
export function rotuloUrgencia(diasRestantes: number | null | undefined): RotuloUrgencia {
  if (!finito(diasRestantes)) {
    // Nunca "0 dias": ausência de prazo é outra coisa que prazo esgotado.
    return { texto: "Sem prazo apurado", tom: "neutro", badge: false, forte: false };
  }

  const d = Math.trunc(diasRestantes);

  if (d < 0) {
    // Dessaturado e sem badge: o pior desfecho não pode parecer "mais um
    // vermelho" no meio de uma fila de urgências que ainda dá tempo de tratar.
    return { texto: "Expirado", tom: "expirado", badge: false, forte: false };
  }
  if (d === 0) {
    return { texto: "Expira hoje", tom: "destructive", badge: true, forte: true };
  }
  if (d <= 7) {
    return {
      texto: `Expira em ${d} ${d === 1 ? "dia" : "dias"}`,
      tom: "destructive",
      badge: true,
      forte: false,
    };
  }
  if (d <= 14) {
    return { texto: `Expira em ${d} dias`, tom: "warning", badge: true, forte: false };
  }
  return { texto: `Expira em ${d} dias`, tom: "neutro", badge: false, forte: false };
}

/**
 * D-225-03: a fila ordena por dias restantes, NUNCA por valor. Um caso de
 * R$ 2 mil com 2 dias de vida vale mais atenção que um de R$ 5 mil com 25.
 *
 * 🔴 Nulo vai para o fim nos dois sentidos. Um comparador assimétrico produz
 * ordem dependente da ordem de entrada — a fila mudaria sozinha entre dois
 * renders com os mesmos dados.
 */
export function compararPorPrazo(
  a: { dias_restantes: number | null | undefined },
  b: { dias_restantes: number | null | undefined },
): number {
  const ka = finito(a?.dias_restantes);
  const kb = finito(b?.dias_restantes);
  if (!ka && !kb) return 0;
  if (!ka) return 1;
  if (!kb) return -1;
  return (a.dias_restantes as number) - (b.dias_restantes as number);
}

/**
 * A fila "Nosso erro" não tem prazo de ressarcimento — ordena por tamanho do
 * erro, decrescente em valor absoluto (o sinal ali não é acusação, é grandeza).
 */
export function compararPorValor(
  a: { diferenca: number | null | undefined },
  b: { diferenca: number | null | undefined },
): number {
  const ka = finito(a?.diferenca);
  const kb = finito(b?.diferenca);
  if (!ka && !kb) return 0;
  if (!ka) return 1;
  if (!kb) return -1;
  return Math.abs(b.diferenca as number) - Math.abs(a.diferenca as number);
}

export interface CasoChaveavel {
  caso_id?: string | null;
  ml_order_id?: string | null;
  tipo_caso?: string | null;
  payment_ids?: string[] | null;
}

/**
 * 🔴 `ml_order_id` NUNCA é key de React nesta base.
 *
 * Ele é NULO em entrada que não é venda do ML (aporte, rendimento, repasse de
 * frete) e não é único por split payment — 2,39% dos pedidos têm mais de um
 * pagamento. `strictNullChecks` está desligado neste repositório e um campo
 * nulável usado como key já quebrou o agrupamento e os três filtros da tela
 * /compras de uma vez, em silêncio.
 *
 * Ordem: `caso_id` (UUID persistido) → pedido+tipo → pagamento+tipo → sentinela.
 * Devolve string não vazia em todos os caminhos.
 */
export function chaveDeLista(caso: CasoChaveavel): string {
  const id = typeof caso?.caso_id === "string" ? caso.caso_id.trim() : "";
  if (id.length > 0) return id;
  return chaveLogica(caso);
}

/**
 * 🔴 A identidade que SOBREVIVE à primeira escrita.
 *
 * `chaveDeLista` prefere `caso_id` porque é o identificador estável para a
 * reconciliação do React. Mas a seleção do painel é uma STRING guardada na
 * página, e `caso_id` NASCE no meio da sessão: enquanto o caso é só
 * pré-visualização da RPC ele é nulo, e a primeira escrita em
 * `conciliacao_casos` — a conferência no Mercado Pago (225-07) ou o "marcar
 * como contestado" — faz a RPC passar a devolvê-lo. A chave da MESMA linha
 * muda, a busca exata falha e o painel fecha sozinho, exatamente no instante em
 * que o usuário precisava continuar.
 *
 * Identidade de reconciliação e identidade de seleção são coisas diferentes.
 * Esta é a segunda: derivada só de campos que a escrita não cria.
 */
export function chaveLogica(caso: CasoChaveavel): string {
  const tipo =
    typeof caso?.tipo_caso === "string" && caso.tipo_caso.trim().length > 0
      ? caso.tipo_caso.trim()
      : "sem-tipo";

  const pedido = typeof caso?.ml_order_id === "string" ? caso.ml_order_id.trim() : "";
  if (pedido.length > 0) return `${pedido}:${tipo}`;

  const pagamento = Array.isArray(caso?.payment_ids)
    ? caso.payment_ids.find((p) => typeof p === "string" && p.trim().length > 0)
    : undefined;
  if (pagamento) return `pgto-${pagamento.trim()}:${tipo}`;

  return `sem-pedido:${tipo}`;
}

/**
 * Acha o caso selecionado tolerando a troca de chave descrita em `chaveLogica`.
 *
 * ⚠️ A chave EXATA vem primeiro: se a linha ainda casa por `chaveDeLista`, é
 * ela. O caminho lógico é o resgate, não o padrão — invertê-los faria duas
 * entradas sem origem do mesmo pedido não ingerido colidirem.
 */
export function acharCasoSelecionado<T extends CasoChaveavel>(
  linhas: T[] | null | undefined,
  chave: string | null | undefined,
): T | null {
  if (!Array.isArray(linhas) || typeof chave !== "string" || chave.length === 0) {
    return null;
  }
  return (
    linhas.find((c) => chaveDeLista(c) === chave) ??
    linhas.find((c) => chaveLogica(c) === chave) ??
    null
  );
}

// ─── Traduções do contrato da RPC para o português da tela ──────────────────
//
// Regra em todas elas: código desconhecido devolve o PRÓPRIO código, nunca
// string vazia. Um motivo novo no banco tem que aparecer feio na tela, não
// desaparecer dela.

const TIPOS_DE_CASO: Record<string, string> = {
  repasse_ausente: "Repasse ausente",
  repasse_a_menor: "Repasse a menor",
  entrada_sem_origem: "Entrada sem origem",
  // 225-06 — a terceira régua: o frete publicado na ficha do anúncio contra o
  // frete cobrado na fatura. 🔴 O rótulo diz "acima do publicado", nunca "a
  // mais": "a mais" é a hipótese do Wesley, e a tela não pode afirmar a
  // hipótese antes de F-02 medir a direção. O tipo nomeia a comparação; o
  // motivo é que diz de que lado o número caiu.
  frete_a_maior: "Frete cobrado acima do publicado",
};

export function rotuloTipoCaso(codigo: string | null | undefined): string {
  if (!codigo) return "Tipo não informado";
  return TIPOS_DE_CASO[codigo] ?? codigo;
}

/** `2026-01-28` → `28/01/2026`. Sem date-fns: o módulo não importa nada. */
function dataBR(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Espelho do default de `conciliacao_config.ingestao_inicio` (225-02). */
const INGESTAO_INICIO_PADRAO = "2026-01-28";

const MOTIVOS: Record<string, string> = {
  // ── Fila "A cobrar do ML" ─────────────────────────────────────────────────
  sem_repasse_confirmado:
    "Ausência de repasse confirmada no Mercado Pago — este caso pode virar chamado",
  repasse_a_menor_confirmado:
    "Repasse a menor confirmado pelas duas pontas do próprio Mercado Livre",
  // 🔴 Medido na onda 2: os 5 únicos candidatos a ausência em 75 dias voltaram
  // 5/5 `charged_back` — contestação de cartão do comprador, não retenção do
  // ML. Acusar sem verificar queimaria a credibilidade do próximo chamado.
  ausencia_a_verificar:
    "Nenhum repasse encontrado, mas falta verificar o status no Mercado Pago antes de cobrar — os casos medidos até aqui eram contestação de cartão do comprador",

  // ── Medido, mas fora de ação ──────────────────────────────────────────────
  // 🔴 A calibração da onda 2 reprovou a própria régua: mediana do resíduo
  // 0,0000, mas só 55,3% dos pedidos dentro de ±R$ 0,01 e vazamento líquido de
  // −R$ 14.221,84 contra +R$ 3.752,44 do lado que acusaria.
  regua_nao_liberada:
    "Diferença medida, mas a régua de valor a menor não está liberada: a calibração reprovou com 55,3% de aderência ao centavo. Fica visível para não sumir do total, e não vira caso",
  abaixo_do_piso:
    "Diferença abaixo do piso de materialidade — soma no total, não vira caso individual",
  aguardando_liberacao:
    "Ainda dentro do prazo normal de liberação do repasse — não há o que cobrar hoje",
  fora_do_escopo:
    "Em mediação ou contestação de cartão — fora deste monitor por política interna",

  // ── Fila "Nosso erro" ─────────────────────────────────────────────────────
  fora_da_janela_de_ingestao: "", // montado dinamicamente com a data — ver abaixo
  sem_captura_cobranca:
    "A cobrança do Mercado Livre ainda não foi capturada para este pedido — falta dado nosso, não dinheiro deles",
  divergencia_da_nossa_base:
    "As duas pontas do Mercado Livre batem entre si; quem diverge é a nossa base. Correção de cadastro, não chamado",
  possivel_carrinho:
    "Mais de um pedido no mesmo pacote — o repasse pode ter vindo agrupado. Não acusamos em cima de carrinho",
  frete_multi_item:
    "O pedido tem mais de um anúncio: o custo de tabela é por anúncio e o frete é por pacote — não há soma honesta, então não comparamos",
  frete_sem_cobranca_registrada:
    "Não há linha de cobrança de frete para este pedido. Pode ser frete grátis ou lacuna da nossa captura — não presumimos zero",

  // ── Frete: medido, ainda sem ação (225-06) ────────────────────────────────
  frete_sem_vigencia_na_venda:
    "A venda é anterior à primeira captura do custo de tabela deste anúncio — comparar com o custo de hoje seria comparar réguas diferentes. Fica como diagnóstico, não como caso",
  frete_abaixo_do_piso:
    "Diferença de frete abaixo do piso de materialidade — aparece, não vira caso individual",
  // 🔴 Este motivo é a metade que torna a pergunta respondível: se só o lado
  // positivo aparecesse, "é sempre a mais" seria irrefutável pelo recorte.
  frete_a_menor_medido:
    "O frete cobrado ficou ABAIXO do publicado na ficha. Não é caso — aparece porque medir direção exige os dois lados",
  regua_frete_nao_liberada:
    "Diferença de frete medida, mas a régua ainda não está liberada: a direção do desvio não foi medida. Fica visível para não sumir do total, e não vira caso",
  frete_a_maior_confirmado:
    "Frete cobrado acima do publicado na ficha do anúncio, com a régua vigente na data da venda — este caso pode virar chamado",

  // ── Entradas sem origem identificada (D-225-10) ───────────────────────────
  repasse_de_frete:
    "Repasse de frete do marketplace — entrada legítima, sem pedido próprio para casar",
  pedido_nao_ingerido:
    "O pagamento tem número de pedido, mas o pedido não está na nossa base — falha de ingestão nossa",
  entrada_fora_do_marketplace:
    "Entrada sem tarifa do marketplace — aporte, rendimento ou transferência, não é venda",
  venda_sem_chave:
    "Entrada sem número de pedido identificado — não dá para casar com uma venda",

  // ── 225-11: a compra do titular ───────────────────────────────────────────
  // 🔴 ESTE MOTIVO EXISTE PARA LIMPAR DOIS NÚMEROS DE UMA VEZ. A compra
  // pessoal do dono no ML, paga com a mesma conta Mercado Pago da empresa,
  // carrega o identificador do pedido do OUTRO vendedor — então ela tem
  // `ml_order_id`, não casa com `orders`, e vinha caindo no balde
  // `pedido_nao_ingerido`, se passando pelas vendas realmente perdidas do
  // G-05. São R$ 12.232,60 em 38 linhas desde 07/01/2026 (censo: 438 de 438
  // linhas classificadas contra a API, zero sem prova).
  //
  // 🔴 A LINHA CONTINUA APARECENDO. Filtrar do caixa e esconder da tela são
  // coisas diferentes: D-225-10 exige classificar TODA entrada, e uma linha
  // que some da tela vira exatamente o buraco que esta fase existe para
  // fechar. Ela sai do caixa e ganha nome — não desaparece.
  compra_do_titular:
    "Compra pessoal do titular da conta, paga pelo mesmo Mercado Pago da empresa — não é receita e não entra no caixa. A linha fica visível para não sumir do total",
};

export interface OpcoesMotivo {
  /** `ingestao_inicio` vindo de `get_conciliacao_resumo`. A régua é do banco. */
  ingestaoInicio?: string | null;
}

export function rotuloMotivo(codigo: string | null | undefined, opcoes?: OpcoesMotivo): string {
  if (!codigo) return "Motivo não informado";

  if (codigo === "fora_da_janela_de_ingestao") {
    const inicio =
      typeof opcoes?.ingestaoInicio === "string" && opcoes.ingestaoInicio.length > 0
        ? opcoes.ingestaoInicio
        : INGESTAO_INICIO_PADRAO;
    return (
      `Ingestão começou em ${dataBR(inicio)} — este período não pode ser cobrado, ` +
      `não é repasse ausente`
    );
  }

  const texto = MOTIVOS[codigo];
  return texto && texto.length > 0 ? texto : codigo;
}

export type TomEstado = "neutro" | "warning" | "success" | "destructive" | "expirado";

export interface RotuloEstado {
  texto: string;
  tom: TomEstado;
}

const ESTADOS: Record<string, RotuloEstado> = {
  aberto: { texto: "Aberto", tom: "neutro" },
  contestado: { texto: "Contestado — aguardando ML", tom: "warning" },
  ganho: { texto: "Ganho", tom: "success" },
  negado: { texto: "Negado pelo ML", tom: "destructive" },
  // Vitória diferente de "Ganho": aqui ninguém abriu chamado, o repasse chegou.
  resolvido_sozinho: { texto: "Resolvido sozinho — o repasse chegou", tom: "success" },
  expirado: { texto: "Expirado — prazo perdido", tom: "expirado" },
};

export function rotuloEstado(codigo: string | null | undefined): RotuloEstado {
  if (!codigo) return { texto: "Estado não informado", tom: "neutro" };
  return ESTADOS[codigo] ?? { texto: codigo, tom: "neutro" };
}

// ─── Dinheiro: 🔴 nulo NUNCA vira R$ 0,00 ───────────────────────────────────

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/**
 * 🔴 `formatCurrency` de `@/lib/formatters` devolve "R$ 0,00" para nulo. Aqui
 * isso seria uma mentira medida: `nosso_erro_soma` e `fora_escopo_soma` vêm
 * NULOS da RPC quando não há valor mensurável, e a onda 2 removeu de propósito
 * o `coalesce` que os transformava em zero — na tela leria "o nosso erro custa
 * R$ 0,00". Zero é uma afirmação; nulo é a ausência dela.
 */
export function valorEmReais(
  valor: number | null | undefined,
  ausente = "não apurado",
): string {
  if (!finito(valor)) return ausente;
  return BRL.format(valor);
}
