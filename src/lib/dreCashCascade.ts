// ============================================================================
// dreCashCascade — Phase 99 Plan 02, Task 1
// Função pura que monta a cascata do DRE Caixa a partir das linhas cruas da
// RPC get_dre_cash (Plano 99-01): recebimento líquido MP → resultado
// operacional de caixa → resultado de caixa do mês, com badge-resposta e
// previsão de imposto null-safe. Espelho estrutural de src/lib/dreCascade.ts
// (Phase 88), adaptado à régua LOCKED do 99-CONTEXT.
//
// Guardrail crítico (99-CONTEXT "Cascata (LOCKED)"): a seção `entrada` e a
// seção `previsao` são informativas — NUNCA entram na soma de saídas. Dentro
// da seção `saida`, o bloco `financeiro` só desce DEPOIS do Resultado
// Operacional de Caixa (empréstimos etc. não são despesa operacional). O
// particionamento por `secao`/`bloco` acontece na entrada da função, antes
// de qualquer soma — mesmo padrão de dreCascade.ts.
//
// [AJUSTE Wesley 2026-07-16, checkpoint de verificação visual da Phase 99]:
// "Nessa DRE não é para excluir fornecedores — fornecedor também é saída."
// O bloco `excluido` (categoria Tiny "Fornecedores", via
// dre_bloco_for_category) era herdado do filtro da DRE por competência
// (dreCascade.ts, onde `excluido` evita dupla-contagem). Aqui, na DRE Caixa,
// esse conceito não se aplica — todo pagamento é saída. `excluido` agora
// SOMA como a PRIMEIRA linha de saída da cascata, rotulada
// "Fornecedores (compras)", antes de impostos.
//
// [FIX 2 Wesley 2026-07-16, decisão do checkpoint]: "Entrada cheia + estorno
// como saída". `entradas.liquido` agora É a base cheia — os créditos que
// caíram na conta, sem estornos netados dentro (a RPC get_dre_cash já
// recalcula `liquido`/`bruto` só com net_amount > 0, migration
// 20260717020000). A linha `refunds` da seção `entrada` da RPC (negativa)
// vira aqui a linha de SAÍDA "Estornos (devoluções MP)", com valor ABS,
// posicionada logo após "Fornecedores (compras)" — soma no resultado
// operacional/final/KPIs/badge como qualquer outro bloco de saída. Sem
// drill-down (`drillable: false`): os lançamentos originam de cash_inflows
// (Mercado Pago), não de cash_outflows (Tiny) — get_dre_cash_items não
// teria nada a mostrar para esse bloco. O resultado do mês não muda; só a
// leitura (a base de entrada estava líquida por dentro, agora fica cheia
// por fora, com o estorno explícito como saída).
//
// [FIX 4 Wesley 2026-07-17, checkpoint de verificação visual da Phase 99]:
// o dono lança no Tiny, na MESMA categoria "excluída" de dre_bloco_for_
// category, tanto Fornecedores quanto ADS Mercado Livre e Full — todas
// mapeadas para o bloco `excluido`. Uma linha única "Fornecedores (compras)"
// escondia ads/Full dentro do rótulo errado. O bloco `excluido` agora é
// exibido POR CATEGORIA — uma linha de saída por categoria dentro do bloco,
// ordenadas por total desc, todas somando no resultado exatamente como
// antes (só muda a granularidade de exibição, não a matemática). Ver
// `buildExcluidoLines`/`EXCLUIDO_CATEGORIA_LABELS`.
//
// Regime: caixa puro, sem shift de competência (Pitfall 1 do 99-RESEARCH) —
// a previsão de imposto compara guia paga NO MESMO MÊS exibido, nunca M+1.
//
// Sem React/Supabase — módulo 100% puro, testável sem rede.
// ============================================================================

/** Linha crua da RPC get_dre_cash — 1 por (secao, bloco, categoria). */
export interface DreCashRow {
  secao: string;
  bloco: string | null;
  categoria: string;
  total: number | null;
  n: number;
}

/** Badge-resposta no topo da página (LOCKED "Cascata"). */
export interface DreCashBadge {
  tone: "positive" | "negative" | "neutral";
  valor: number;
  texto: string;
}

/**
 * Previsão de imposto (LOCKED "Imposto", DREC-05): taxa histórica média dos
 * últimos meses fechados × faturamento do mês corrente, comparada com a guia
 * realmente paga no mês. `impostoPrevisto` é null quando nenhum mês fechado
 * tem dado suficiente (frontend renderiza "—").
 */
export interface DreCashPrevisao {
  impostoPrevisto: number | null;
  impostoGuiaPaga: number;
  faturamentoMes: number;
  desvioPct: number | null;
  alert: boolean;
}

/**
 * Blocos de saída que sempre aparecem na cascata, na ordem fixa de exibição.
 * `excluido` (Fornecedores/compras) é a PRIMEIRA linha — decisão do dono
 * 2026-07-16: fornecedor também é saída na DRE Caixa.
 */
export const SAIDA_BLOCOS = [
  "excluido",
  "impostos_venda",
  "pessoal",
  "estrutura",
  "servicos",
  "operacional",
  "nao_classificado",
] as const;

export type SaidaBloco = (typeof SAIDA_BLOCOS)[number];

/** Rótulos pt-BR por bloco de saída. */
const SAIDA_LABELS: Record<SaidaBloco, string> = {
  excluido: "Fornecedores (compras)",
  impostos_venda: "Impostos (guias pagas)",
  pessoal: "Pessoal",
  estrutura: "Estrutura",
  servicos: "Serviços",
  operacional: "Operacional",
  nao_classificado: "Não classificado",
};

/**
 * Rótulo da linha sintética "Estornos" (FIX 2) — não faz parte de
 * SAIDA_BLOCOS porque não vem de cash_outflows/dre_bloco_for_category; vem
 * da categoria `refunds` da seção `entrada` da RPC, invertida em SAÍDA.
 */
const ESTORNOS_LABEL = "Estornos (devoluções MP)";

/**
 * Rótulos amigáveis por categoria dentro do bloco `excluido` (FIX 4). O
 * dono lança fornecedores, ads e Full na mesma "gaveta" do Tiny mapeada por
 * `dre_bloco_for_category` — cada categoria ganha seu próprio rótulo aqui;
 * categoria sem entrada no mapa usa o nome cru como veio do Tiny (default).
 */
const EXCLUIDO_CATEGORIA_LABELS: Record<string, string> = {
  Fornecedores: "Fornecedores (compras)",
  "ADS Mercado Livre": "ADS Mercado Livre",
  "Prestação de serviço do Mercado Envios Full": "Envios Full (armazenagem)",
};

function excluidoCategoriaLabel(categoria: string): string {
  return EXCLUIDO_CATEGORIA_LABELS[categoria] ?? categoria;
}

/** Categoria dentro de um bloco de saída, com total agregado. */
export interface DreCashCategoriaLine {
  categoria: string;
  total: number;
  n: number;
}

/**
 * Linha agregada de um bloco de saída (sempre presente, mesmo com total 0).
 * `bloco: "estornos"` é a única linha sintética que não vem de
 * `SAIDA_BLOCOS`/cash_outflows — ver `ESTORNOS_LABEL` (FIX 2).
 */
export interface DreCashSaidaLine {
  bloco: SaidaBloco | "estornos";
  /**
   * Categoria Tiny original desta linha — só presente nas linhas do bloco
   * `excluido` (FIX 4), que agora vira uma linha por categoria em vez de
   * uma linha agregada. A página usa este campo para filtrar o drill-down
   * (`get_dre_cash_items` só filtra por bloco; o filtro por categoria é
   * client-side). `undefined` nas demais linhas — não há filtro extra.
   */
  categoria?: string;
  label: string;
  total: number;
  n: number;
  categorias: DreCashCategoriaLine[];
  /** false só para "estornos" — sem lançamentos em cash_outflows para drill-down. */
  drillable: boolean;
}

/**
 * Linhas informativas da seção "entrada" — `liquido` é a base CHEIA (créditos
 * que caíram na conta, sem estornos netados dentro; FIX 2 2026-07-16). Não há
 * mais campo `refunds` aqui — os estornos viram linha de SAÍDA na cascata.
 */
export interface DreCashEntradas {
  bruto: number;
  descontosFonte: number;
  liquido: number;
  aLiberar: number;
}

/** Resultado completo da cascata de caixa a partir das linhas da RPC. */
export interface DreCashCascade {
  entradas: DreCashEntradas;
  /**
   * As linhas de saída, sempre nesta ordem, mesmo blocos sem dados (total
   * 0): 1+ linha(s) do bloco `excluido` — uma por categoria Tiny (FIX 4;
   * ao menos 1 linha placeholder quando o bloco está vazio no mês) —
   * seguidas de "estornos" (FIX 2) e dos 6 blocos padrão restantes
   * (SAIDA_BLOCOS sem `excluido`). Total de linhas = (nº categorias do
   * bloco excluido no mês, mínimo 1) + 7.
   */
  saidas: DreCashSaidaLine[];
  /** Recebimento líquido − Σ(8 linhas de saída, incl. Fornecedores/excluido e Estornos). */
  resultadoOperacional: number;
  /** Bloco financeiro (empréstimos etc.), fora do operacional. */
  financeiro: number;
  /** Resultado operacional − financeiro. */
  resultadoCaixa: number;
  previsao: DreCashPrevisao;
  badge: DreCashBadge;
  /** Total do bloco nao_classificado — gate visual quando > 0. */
  naoClassificadoTotal: number;
  /** false quando o mês não teve nenhuma movimentação (entrada nem saída). */
  hasMovimento: boolean;
}

// Arredondamento a 2 casas — consistente com dreCascade.ts (Math.round(x*100)/100).
const round2 = (v: number) => Math.round(v * 100) / 100;

// Formatação pt-BR usada nos textos do badge — mesmo padrão do resto do projeto.
const fmtBR = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2 });

/**
 * Limiar de alerta de desvio entre a previsão de imposto e a guia paga real,
 * em pontos percentuais absolutos. Valor a critério de Claude (99-CONTEXT
 * "Claude's Discretion") — 20% equilibra sensibilidade (variações normais de
 * faturamento mês a mês) contra ruído (não alertar por qualquer oscilação).
 */
export const DESVIO_ALERT_PCT = 20;

/**
 * Calcula o desvio percentual entre a guia de imposto paga e a previsão
 * (média das taxas históricas × faturamento do mês). Null-safe: previsto
 * ausente ou <= 0 não produz divisão por zero — retorna desvioPct null e
 * alert false (frontend renderiza "—", sem falso-alarme).
 */
export function computePrevisaoDesvio(
  previsto: number | null,
  guiaPaga: number,
): { desvioPct: number | null; alert: boolean } {
  if (previsto === null || previsto <= 0) {
    return { desvioPct: null, alert: false };
  }
  const desvioPct = round2(((guiaPaga - previsto) / previsto) * 100);
  return { desvioPct, alert: Math.abs(desvioPct) > DESVIO_ALERT_PCT };
}

function sumTotal(rows: DreCashRow[]): number {
  return round2(rows.reduce((s, r) => s + (r.total ?? 0), 0));
}

/**
 * Divide o bloco de saída `excluido` em uma linha por categoria (FIX 4,
 * 2026-07-17) — rótulos amigáveis em `EXCLUIDO_CATEGORIA_LABELS`, ordenado
 * por total desc. Sem linhas no mês → devolve 1 linha placeholder (rótulo
 * padrão "Fornecedores (compras)", total 0) para manter o contrato de a
 * cascata sempre mostrar o bloco, mesmo vazio.
 *
 * `categorias: []` em cada linha (diferente dos outros blocos padrão) —
 * como cada linha JÁ É uma única categoria, não há sub-detalhamento extra a
 * mostrar dentro do drill-down além dos lançamentos individuais.
 */
function buildExcluidoLines(excluidoRows: DreCashRow[]): DreCashSaidaLine[] {
  if (excluidoRows.length === 0) {
    return [
      {
        bloco: "excluido",
        label: SAIDA_LABELS.excluido,
        total: 0,
        n: 0,
        categorias: [],
        drillable: true,
      },
    ];
  }

  const byCategoria = new Map<string, { total: number; n: number }>();
  for (const r of excluidoRows) {
    const cur = byCategoria.get(r.categoria) ?? { total: 0, n: 0 };
    cur.total += r.total ?? 0;
    cur.n += r.n;
    byCategoria.set(r.categoria, cur);
  }

  const lines: DreCashSaidaLine[] = Array.from(byCategoria.entries()).map(
    ([categoria, agg]) => ({
      bloco: "excluido" as const,
      categoria,
      label: excluidoCategoriaLabel(categoria),
      total: round2(agg.total),
      n: agg.n,
      categorias: [],
      drillable: true,
    }),
  );

  lines.sort((a, b) => b.total - a.total);
  return lines;
}

/**
 * Monta a cascata do DRE Caixa a partir das linhas cruas da RPC get_dre_cash.
 *
 * Guardrail (aplicado ANTES de qualquer soma): particiona `rows` por `secao`
 * (entrada / saida / previsao) — entrada e previsao nunca entram na soma de
 * saídas. Dentro de `saida`, o bloco `financeiro` é somado separadamente, só
 * descontado APÓS o resultado operacional. O bloco `excluido`
 * (Fornecedores/compras) soma normalmente dentro do operacional — decisão
 * do dono 2026-07-16 (99-CONTEXT "Régua de saídas").
 */
export function buildDreCashCascade(rows: DreCashRow[]): DreCashCascade {
  const safeRows = rows ?? [];

  const entradaRows = safeRows.filter((r) => r.secao === "entrada");
  const saidaRows = safeRows.filter((r) => r.secao === "saida");
  const previsaoRows = safeRows.filter((r) => r.secao === "previsao");

  // ---- Entradas (informativas — base real é `liquido`, agora CHEIA: FIX 2) ----
  const entradaCategoriaTotal = (categoria: string) =>
    sumTotal(entradaRows.filter((r) => r.categoria === categoria));

  const entradas: DreCashEntradas = {
    bruto: entradaCategoriaTotal("bruto"),
    descontosFonte: entradaCategoriaTotal("descontos_fonte"),
    liquido: entradaCategoriaTotal("liquido"),
    aLiberar: entradaCategoriaTotal("a_liberar"),
  };

  // ---- Saídas: excluido (Fornecedores/ads/Full) soma no operacional;
  // financeiro à parte ----
  const saidaOperacional = saidaRows.filter((r) => r.bloco !== "financeiro");
  const saidaFinanceiro = saidaRows.filter((r) => r.bloco === "financeiro");

  // Blocos padrão SEM "excluido" — esse é tratado à parte por
  // `buildExcluidoLines` (FIX 4: uma linha por categoria).
  const OUTROS_SAIDA_BLOCOS = SAIDA_BLOCOS.filter(
    (b): b is Exclude<SaidaBloco, "excluido"> => b !== "excluido",
  );

  const saidaBlocosPadrao: DreCashSaidaLine[] = OUTROS_SAIDA_BLOCOS.map((bloco) => {
    const blocoRows = saidaOperacional.filter((r) => r.bloco === bloco);
    const categorias: DreCashCategoriaLine[] = blocoRows.map((r) => ({
      categoria: r.categoria,
      total: round2(r.total ?? 0),
      n: r.n,
    }));
    return {
      bloco,
      label: SAIDA_LABELS[bloco],
      total: sumTotal(blocoRows),
      n: blocoRows.reduce((s, r) => s + r.n, 0),
      categorias,
      drillable: true,
    };
  });

  // ---- Excluido (FIX 4): uma linha de saída POR CATEGORIA do bloco, na
  // posição onde antes ficava a linha única "Fornecedores (compras)".
  const excluidoRows = saidaOperacional.filter((r) => r.bloco === "excluido");
  const excluidoLines = buildExcluidoLines(excluidoRows);

  // ---- Estornos (FIX 2): categoria `refunds` da seção entrada, negativa na
  // RPC, vira linha de SAÍDA com ABS, logo após as linhas de "excluido".
  // Sem drill-down — origem é cash_inflows (MP), não cash_outflows (Tiny).
  const estornosRows = entradaRows.filter((r) => r.categoria === "refunds");
  const estornosLine: DreCashSaidaLine = {
    bloco: "estornos",
    label: ESTORNOS_LABEL,
    total: round2(Math.abs(sumTotal(estornosRows))),
    n: estornosRows.reduce((s, r) => s + r.n, 0),
    categorias: [],
    drillable: false,
  };

  const saidas: DreCashSaidaLine[] = [
    ...excluidoLines,
    estornosLine,
    ...saidaBlocosPadrao,
  ];

  const totalSaidasOperacionais = round2(saidas.reduce((s, b) => s + b.total, 0));
  const resultadoOperacional = round2(entradas.liquido - totalSaidasOperacionais);

  const financeiro = sumTotal(saidaFinanceiro);
  const resultadoCaixa = round2(resultadoOperacional - financeiro);

  const naoClassificadoTotal =
    saidas.find((b) => b.bloco === "nao_classificado")?.total ?? 0;

  const hasMovimento =
    entradas.liquido !== 0 ||
    entradas.bruto !== 0 ||
    totalSaidasOperacionais !== 0 ||
    financeiro !== 0;

  // ---- Previsão de imposto (LOCKED, regime de caixa puro, sem shift) ----
  const previsaoValor = (categoria: string): number | null => {
    const row = previsaoRows.find((r) => r.categoria === categoria);
    if (!row || row.total === null) return null;
    return Number(row.total);
  };

  const impostoPrevisto = previsaoValor("imposto_previsto");
  const impostoGuiaPaga = previsaoValor("imposto_guia_paga") ?? 0;
  const faturamentoMes = previsaoValor("faturamento_mes") ?? 0;
  const { desvioPct, alert } = computePrevisaoDesvio(impostoPrevisto, impostoGuiaPaga);

  const previsao: DreCashPrevisao = {
    impostoPrevisto,
    impostoGuiaPaga,
    faturamentoMes,
    desvioPct,
    alert,
  };

  // ---- Badge-resposta (LOCKED "Cascata") ----
  let badge: DreCashBadge;
  if (!hasMovimento) {
    badge = { tone: "neutral", valor: 0, texto: "Sem movimentação no mês" };
  } else if (resultadoCaixa > 0) {
    badge = {
      tone: "positive",
      valor: resultadoCaixa,
      texto: `As entradas do mês pagaram as contas — sobrou R$ ${fmtBR(resultadoCaixa)}`,
    };
  } else if (resultadoCaixa < 0) {
    const abs = Math.abs(resultadoCaixa);
    badge = {
      tone: "negative",
      valor: abs,
      texto: `Faltou R$ ${fmtBR(abs)} — esse dinheiro saiu de outro lugar`,
    };
  } else {
    // Movimento houve, mas o resultado fechou exatamente em zero — sem sinal
    // de sobra nem falta; tratado como neutro (mesma família de texto).
    badge = { tone: "neutral", valor: 0, texto: "Sem movimentação no mês" };
  }

  return {
    entradas,
    saidas,
    resultadoOperacional,
    financeiro,
    resultadoCaixa,
    previsao,
    badge,
    naoClassificadoTotal,
    hasMovimento,
  };
}
