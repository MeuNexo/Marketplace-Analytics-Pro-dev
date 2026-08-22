// ============================================================================
// cicloCaixa.ts — Fase 230, Plano 03, Task 2 (CX-02)
//
// A pergunta: "por que faturei bem e não tenho dinheiro na conta?". A resposta
// canônica do varejo com estoque é o ciclo de conversão de caixa —
// DIO + DSO − DPO —, e ela só dispara decisão DECOMPOSTA: dos três
// componentes, o único sob controle direto da Pé Vermeio é o DIO (o DSO é a
// agenda do Mercado Pago, o DPO é o prazo do fornecedor). Um número único de
// "36 dias" não diz onde apertar; decomposto, ele aponta a compra.
//
// 🔴 NENHUM COMPONENTE AUSENTE VIRA ZERO. Se o DPO faltar, o ciclo não é
// "DIO + DSO"; ele é desconhecido, e o motivo entra escrito em
// `frasesDeRessalva`. Somar com um buraco de 12 dias tratado como zero
// devolveria um ciclo maior do que o real e apontaria a decisão errada.
// Mesma disciplina de `estoqueCapital.ts` (SKU sem custo sai do numerador e
// entra na contagem declarada) e de `fraseMotivoSemRebate`.
//
// 🔴 O DSO NÃO É MEDIDO HOJE. `lag_liberacao_dias` de `get_dre_cash_forecast`
// é uma diferença de centroides presa entre 7 e 30 dias, e o valor observado
// em 21/08 (7) está exatamente no piso. Não há como medir por par
// venda→liberação: `cash_inflows` guarda `payment_id` do Mercado Pago e
// `orders` guarda `ml_order_id`, sem chave comum. Por isso o estado
// `no_limite` existe e contamina o ciclo inteiro: publicado assim, o número é
// um PISO ("pelo menos X dias"), nunca uma medição. Publicar o piso como
// medição repetiria a forma exata do erro dos "102,4%" da Fase 224.
//
// Módulo puro: nenhum import de React, de Supabase ou de rede.
// ============================================================================

/**
 * Intervalo de referência de ciclo de conversão de caixa em varejo com
 * estoque, vindo da literatura e declarado no ROADMAP da fase.
 *
 * 🔴 NÃO é meta aprovada pelo Wesley. Serve para escrever a leitura em
 * palavras ("dentro do intervalo de referência"), e nenhuma cor da tela pode
 * ser decidida por ele — cor por estado nomeado, nunca por número solto.
 */
export const BENCHMARK_CCC_VAREJO = { minimo: 30, maximo: 60 } as const;

/**
 * Abaixo deste número de observações, a mediana do prazo de fornecedor é
 * publicada como provisória, com o n ao lado. Prazo de fornecedor tem cauda:
 * com meia dúzia de títulos, a mediana descreve o acaso do mês, não a política
 * de pagamento.
 */
export const N_MINIMO_COMPONENTE = 20;

/** Espelha 1 para 1 o retorno da RPC `get_cash_cycle`. */
export interface InsumosCicloCaixa {
  valorEstoque: number | null;
  unidadesEstoque: number | null;
  unidadesSemCusto: number | null;
  skusSemCusto: number | null;
  cmvDiario: number | null;
  cmvPedidos: number | null;
  dsoDias: number | null;
  dsoN: number | null;
  /** Verdadeiro quando o DSO encostou num extremo da conta original ou caiu no valor fixo. */
  dsoNoLimite: boolean;
  dpoDias: number | null;
  dpoN: number | null;
  janelaDias: number | null;
}

export type EstadoComponente = "medido" | "no_limite" | "provisorio" | "nao_medido";

export interface ComponenteDoCiclo {
  chave: "dio" | "dso" | "dpo";
  /** Em português de negócio, nunca a sigla sozinha. */
  rotulo: string;
  dias: number | null;
  estado: EstadoComponente;
  /** Tooltip: SEMPRE nomeia a procedência ou o motivo real da ausência. */
  titulo: string;
}

export interface CicloCaixaResult {
  ciclo: number | null;
  estado: EstadoComponente;
  componentes: ComponenteDoCiclo[];
  texto: string;
  titulo: string;
  frasesDeRessalva: string[];
}

/** Gravidade do estado — o ciclo herda o PIOR estado entre os componentes. */
const GRAVIDADE: Record<EstadoComponente, number> = {
  medido: 0,
  provisorio: 1,
  no_limite: 2,
  nao_medido: 3,
};

const num = (v: number, casas = 1): string =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

const inteiro = (v: number): string => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

/**
 * Compõe o ciclo de conversão de caixa a partir dos insumos crus da RPC.
 *
 * Ordem de decisão, item a item:
 *  (a) DIO = valor do estoque ÷ CMV diário. Sem CMV diário positivo o DIO é
 *      nulo — dividir por zero devolveria infinito, e um estoque sem venda não
 *      tem "dias de estoque", tem outro problema.
 *  (b) DSO vem pronto da RPC; o que se decide aqui é o ESTADO dele.
 *  (c) DPO vem pronto; provisório quando a amostra é pequena.
 *  (d) O ciclo só existe com os três presentes. Qualquer ausência devolve nulo
 *      e escreve o motivo.
 *  (e) O estado do ciclo é o pior dos três — um piso e um provisório não se
 *      cancelam, o mais frágil manda.
 */
export function resolveCicloCaixa(insumos: InsumosCicloCaixa): CicloCaixaResult {
  const frasesDeRessalva: string[] = [];

  // ── (a) DIO ────────────────────────────────────────────────────────────────
  const cmvUtil = insumos.cmvDiario != null && insumos.cmvDiario > 0 ? insumos.cmvDiario : null;
  const dio =
    insumos.valorEstoque != null && cmvUtil != null ? insumos.valorEstoque / cmvUtil : null;

  let dioTitulo: string;
  if (dio != null) {
    dioTitulo =
      `Estoque a custo (${insumos.valorEstoque!.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
      })}) dividido pelo custo das vendas por dia (${cmvUtil!.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
      })}), na janela de ${insumos.janelaDias ?? "?"} dias.`;
  } else if (cmvUtil == null) {
    dioTitulo =
      "Sem custo das vendas por dia no período, não há como dizer em quantos dias o estoque " +
      "gira — o número seria infinito, não alto.";
    frasesDeRessalva.push(
      "Os dias de estoque não puderam ser medidos: o custo das vendas (CMV) do período está " +
        "zerado ou ausente.",
    );
  } else {
    dioTitulo = "O valor do estoque a custo não veio na leitura desta vez.";
    frasesDeRessalva.push(
      "Os dias de estoque não puderam ser medidos: o valor do estoque a custo não foi lido.",
    );
  }

  // ── (b) DSO ────────────────────────────────────────────────────────────────
  let dsoEstado: EstadoComponente;
  let dsoTitulo: string;
  if (insumos.dsoDias == null) {
    dsoEstado = "nao_medido";
    dsoTitulo = "O prazo entre a venda e o dinheiro na conta não veio na leitura desta vez.";
    frasesDeRessalva.push(
      "O prazo entre a venda e o dinheiro cair na conta não pôde ser lido.",
    );
  } else if (insumos.dsoNoLimite) {
    dsoEstado = "no_limite";
    dsoTitulo =
      `Este número está preso no limite da conta que o sistema usa hoje (ela nunca devolve ` +
      `menos de 7 nem mais de 30 dias). Não há vínculo entre a venda e a liberação do dinheiro ` +
      `no banco, então ele é estimado por centroides — é um limite, não uma medição.`;
    frasesDeRessalva.push(
      "O prazo até o dinheiro cair está no limite da conta que o sistema usa hoje, não é um " +
        "valor observado — por isso o ciclo é um piso: o real é igual ou maior, nunca menor.",
    );
  } else if (insumos.dsoN != null && insumos.dsoN < N_MINIMO_COMPONENTE) {
    dsoEstado = "provisorio";
    dsoTitulo = `Estimado sobre ${inteiro(insumos.dsoN)} liberações — amostra pequena.`;
    frasesDeRessalva.push(
      `O prazo até o dinheiro cair saiu de apenas ${inteiro(insumos.dsoN)} liberações — provisório.`,
    );
  } else {
    dsoEstado = "medido";
    dsoTitulo =
      `Diferença entre o centroide das liberações e o das vendas na janela de ` +
      `${insumos.janelaDias ?? "?"} dias` +
      (insumos.dsoN != null ? `, sobre ${inteiro(insumos.dsoN)} liberações.` : ".");
  }

  // ── (c) DPO ────────────────────────────────────────────────────────────────
  let dpoEstado: EstadoComponente;
  let dpoTitulo: string;
  if (insumos.dpoDias == null) {
    dpoEstado = "nao_medido";
    dpoTitulo =
      "Nenhum pagamento a fornecedor com mês de competência gravado no período — sem isso não " +
      "há prazo a medir.";
    frasesDeRessalva.push(
      "O prazo do fornecedor não pôde ser medido no período: nenhum pagamento com mês de " +
        "competência gravado.",
    );
  } else if (insumos.dpoN != null && insumos.dpoN < N_MINIMO_COMPONENTE) {
    dpoEstado = "provisorio";
    dpoTitulo =
      `Mediana de ${inteiro(insumos.dpoN)} pagamentos a fornecedor — amostra pequena, o número ` +
      `pode mudar bastante no próximo pagamento.`;
    frasesDeRessalva.push(
      `O prazo do fornecedor saiu da mediana de apenas ${inteiro(insumos.dpoN)} pagamentos — provisório.`,
    );
  } else {
    dpoEstado = "medido";
    // A janela sai junto do número de propósito: a mesma mediana dá 15 dias em
    // 90 e 12 em 180, e nenhum dos dois está errado. Um ciclo composto por três
    // janelas diferentes não é um ciclo — aqui as três são a mesma.
    dpoTitulo =
      `Mediana entre o mês de competência e o pagamento efetivo, nos últimos ` +
      `${insumos.janelaDias ?? "?"} dias` +
      (insumos.dpoN != null ? `, sobre ${inteiro(insumos.dpoN)} pagamentos a fornecedor.` : ".");
  }

  const componentes: ComponenteDoCiclo[] = [
    {
      chave: "dio",
      rotulo: "dias de estoque",
      dias: dio,
      estado: dio != null ? "medido" : "nao_medido",
      titulo: dioTitulo,
    },
    {
      chave: "dso",
      rotulo: "dias até o dinheiro cair",
      dias: insumos.dsoDias,
      estado: dsoEstado,
      titulo: dsoTitulo,
    },
    {
      chave: "dpo",
      rotulo: "dias de prazo do fornecedor",
      dias: insumos.dpoDias,
      estado: dpoEstado,
      titulo: dpoTitulo,
    },
  ];

  // ── (d) o ciclo só existe inteiro ─────────────────────────────────────────
  const ciclo =
    dio != null && insumos.dsoDias != null && insumos.dpoDias != null
      ? dio + insumos.dsoDias - insumos.dpoDias
      : null;

  // ── (e) o pior estado manda ───────────────────────────────────────────────
  const estado = componentes.reduce<EstadoComponente>(
    (pior, c) => (GRAVIDADE[c.estado] > GRAVIDADE[pior] ? c.estado : pior),
    "medido",
  );

  // ── Cobertura de custo: existe mesmo com o ciclo medido ───────────────────
  if (insumos.unidadesSemCusto != null && insumos.unidadesSemCusto > 0) {
    const skus = insumos.skusSemCusto ?? 0;
    frasesDeRessalva.push(
      `${inteiro(insumos.unidadesSemCusto)} unidade(s) em ${inteiro(skus)} anúncio(s) ficaram ` +
        `fora do valor do estoque por não terem custo cadastrado — não viraram zero, ficaram de ` +
        `fora, então os dias de estoque são um piso também por este lado.`,
    );
  }

  // ── Leitura em uma frase ──────────────────────────────────────────────────
  let texto: string;
  if (ciclo == null) {
    texto =
      "O ciclo não fecha: falta um dos três componentes, e somar com um buraco tratado como " +
      "zero apontaria a decisão errada.";
  } else {
    const prefixo = estado === "no_limite" ? "O ciclo é de pelo menos" : "O ciclo é de";
    const leitura =
      ciclo < BENCHMARK_CCC_VAREJO.minimo
        ? "abaixo do intervalo de referência do varejo — o dinheiro volta rápido"
        : ciclo <= BENCHMARK_CCC_VAREJO.maximo
          ? "dentro do intervalo de referência do varejo"
          : "acima do intervalo de referência do varejo — o dinheiro demora a voltar";
    texto = `${prefixo} ${num(ciclo)} dias entre pagar a mercadoria e receber por ela — ${leitura}.`;
  }

  const titulo =
    `Ciclo de conversão de caixa = dias de estoque + dias até o dinheiro cair − dias de prazo ` +
    `do fornecedor. Referência de literatura para varejo com estoque: ` +
    `${BENCHMARK_CCC_VAREJO.minimo} a ${BENCHMARK_CCC_VAREJO.maximo} dias — referência, não ` +
    `meta aprovada.`;

  return { ciclo, estado, componentes, texto, titulo, frasesDeRessalva };
}

export interface DinheiroPresoResult {
  razao: number | null;
  texto: string;
  titulo: string;
}

/**
 * A razão entre o estoque a custo e o caixa em conta — o par que conta a
 * história da operação. Um ciclo saudável com 12,9× de estoque sobre caixa
 * significa que o dinheiro existe, mas está em mercadoria.
 *
 * Caixa zero ou negativo devolve razão nula com o motivo escrito: dividir por
 * caixa negativo produz um múltiplo negativo que não quer dizer nada.
 */
export function resolveDinheiroPreso(entrada: {
  valorEstoque: number | null;
  caixa: number | null;
}): DinheiroPresoResult {
  const { valorEstoque, caixa } = entrada;

  const titulo =
    "Estoque avaliado a custo dividido pelo saldo em conta. É quantas vezes o dinheiro parado " +
    "em mercadoria supera o dinheiro disponível para pagar contas.";

  if (valorEstoque == null) {
    return {
      razao: null,
      texto:
        "O valor do estoque a custo não foi lido — sem ele não dá para dizer quanto do dinheiro " +
        "está em mercadoria.",
      titulo,
    };
  }

  if (caixa == null) {
    return {
      razao: null,
      texto: "O saldo em conta não foi lido — a comparação com o estoque fica sem denominador.",
      titulo,
    };
  }

  if (caixa < 0) {
    return {
      razao: null,
      texto:
        "O saldo em conta está negativo: a razão entre estoque e caixa não tem leitura aqui — o " +
        "problema já não é onde o dinheiro está, é que ele acabou.",
      titulo,
    };
  }

  if (caixa === 0) {
    return {
      razao: null,
      texto:
        "O saldo em conta está zerado: todo o dinheiro da operação está em mercadoria, e não há " +
        "razão a calcular.",
      titulo,
    };
  }

  const razao = valorEstoque / caixa;
  return {
    razao,
    texto:
      `O estoque a custo é ${num(razao)}× o saldo em conta — o dinheiro existe, está em ` +
      `mercadoria, não em conta.`,
    titulo,
  };
}
