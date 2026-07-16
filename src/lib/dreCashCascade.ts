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

/** Categoria dentro de um bloco de saída, com total agregado. */
export interface DreCashCategoriaLine {
  categoria: string;
  total: number;
  n: number;
}

/** Linha agregada de um bloco de saída (sempre presente, mesmo com total 0). */
export interface DreCashSaidaLine {
  bloco: SaidaBloco;
  label: string;
  total: number;
  n: number;
  categorias: DreCashCategoriaLine[];
}

/** Linhas informativas da seção "entrada" (base = liquido). */
export interface DreCashEntradas {
  bruto: number;
  descontosFonte: number;
  refunds: number;
  liquido: number;
  aLiberar: number;
}

/** Resultado completo da cascata de caixa a partir das linhas da RPC. */
export interface DreCashCascade {
  entradas: DreCashEntradas;
  /** As 7 linhas de saída, sempre nesta ordem, mesmo blocos sem dados (total 0). */
  saidas: DreCashSaidaLine[];
  /** Recebimento líquido − Σ(7 blocos de saída, incl. Fornecedores/excluido). */
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

  // ---- Entradas (informativas — base real é `liquido`) ----
  const entradaCategoriaTotal = (categoria: string) =>
    sumTotal(entradaRows.filter((r) => r.categoria === categoria));

  const entradas: DreCashEntradas = {
    bruto: entradaCategoriaTotal("bruto"),
    descontosFonte: entradaCategoriaTotal("descontos_fonte"),
    refunds: entradaCategoriaTotal("refunds"),
    liquido: entradaCategoriaTotal("liquido"),
    aLiberar: entradaCategoriaTotal("a_liberar"),
  };

  // ---- Saídas: excluido (Fornecedores) soma no operacional; financeiro à parte ----
  const saidaOperacional = saidaRows.filter((r) => r.bloco !== "financeiro");
  const saidaFinanceiro = saidaRows.filter((r) => r.bloco === "financeiro");

  const saidas: DreCashSaidaLine[] = SAIDA_BLOCOS.map((bloco) => {
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
    };
  });

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
