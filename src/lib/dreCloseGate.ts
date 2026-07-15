// ============================================================================
// dreCloseGate — Phase 96 Plan 02, Task 1
//
// Lógica pura do gate de fechamento do mês (botão "marcar mês como apurado",
// dre_month_close — Phase 94). Combina dois gates independentes:
//
//  (a) [C7] canApurarImposto — o gate de imposto. O sinal é o `status` das
//      3 guias (ICMS/PIS/COFINS) da competência M+1, NUNCA o `total`. Wesley
//      confirmou (2026-07-15) que PIS/COFINS de maio geraram CRÉDITO — a
//      guia foi apurada e deu R$0,01 a pagar. Um gate que bloqueasse em
//      0,01 travaria maio à toa; isso é o bug que esta função corrige, não
//      o comportamento a manter. O placeholder real do Tiny é outro:
//      lançamentos `status='pending'` repetindo os mesmos valores todo mês
//      (jul/2026–abr/2027) — o valor pode ser QUALQUER coisa, alto ou
//      baixo, o que importa é a guia nunca ter sido paga.
//
//  (b) [C6] o gate de CMV cheio — bloqueia se existir qualquer SKU vendido
//      no mês sem `custo_unit_cheio`. O tipo CmvCheioGap mora aqui (mesmo
//      padrão de DreOperationalRow em dreCascade.ts) e é populado/re-
//      exportado pelo hook do plano 96-03; este módulo só consome a lista
//      já resolvida.
//
// POR QUE O GATE MORA AQUI E NÃO EM resolveDreRegime (dreRegime.ts):
// resolveDreRegime só decide PREVISÃO vs APURAÇÃO e monta o (CMV, imposto)
// coerente da DRE já fechada — o branch `!isClosed` (previsão) nunca lê
// cmvCheio/guiaReal (propriedade estrutural que garante o SC5: a previsão é
// byte-a-byte igual à do legado). Colocar o gate DENTRO do resolver
// misturaria "que dado usar" com "pode fechar o mês" — mudaria a previsão e
// quebraria o SC5 (Pitfall 7 do 96-RESEARCH). O gate é sobre a AÇÃO de
// fechar (dre_month_close), não sobre qual base de cálculo exibir; por isso
// vive num módulo irmão, puro e sem qualquer import de dreRegime.ts exceto
// o tipo GuiaRealCategoryTotal e a lista de categorias (fonte única).
//
// POR QUE O STATUS É O SINAL E NÃO O VALOR (Pitfall 8 do 96-RESEARCH):
// o histórico mostra guias reais em R$0,01 em vários meses (nov/2024,
// jun/2025, jun/2026, mai/2027) — todos casos de CRÉDITO de Lucro Real, não
// placeholder. E o placeholder real (lançamento recorrente do Tiny) tem
// valores ALTOS (PIS 716,19 / COFINS 3.298,87). Um gate por valor erraria
// nos dois sentidos: travaria os créditos legítimos e deixaria passar
// placeholders altos. `status='paid'` é o único sinal que não erra.
//
// Sem React/Supabase — módulo puro, testável sem round-trip ao banco
// (padrão de dreCascade.ts e dreRegime.ts).
// ============================================================================

import { IMPOSTO_VENDA_CATEGORIES } from "./dreRegime";
import type { GuiaRealCategoryTotal } from "./dreRegime";

const round2 = (v: number) => Math.round(v * 100) / 100;

export interface ImpostoGateResult {
  ok: boolean;
  /** Categorias da lista IMPOSTO_VENDA_CATEGORIES ausentes na guia. */
  missing: string[];
  /** Categorias presentes em que ALGUMA linha não está com status 'paid'. */
  pending: string[];
}

/**
 * [C7] Gate de imposto — aprova só quando as 3 guias (ICMS/PIS/COFINS) da
 * competência M+1 estão TODAS com status 'paid'. Nunca lê o campo `total`
 * de nenhuma linha — o valor não é sinal de nada (ver cabeçalho do arquivo).
 */
export function canApurarImposto(
  guia: GuiaRealCategoryTotal[] | null,
): ImpostoGateResult {
  const rows = guia ?? [];

  // Agrupa por categoria: uma categoria só é "paid" se TODAS as suas linhas
  // estiverem pagas (a RPC agrupa por categoria×status, então uma linha
  // pendente contamina a categoria inteira).
  const rowsByCategory = new Map<string, GuiaRealCategoryTotal[]>();
  for (const r of rows) {
    const list = rowsByCategory.get(r.category) ?? [];
    list.push(r);
    rowsByCategory.set(r.category, list);
  }

  const missing: string[] = [];
  const pending: string[] = [];

  for (const category of IMPOSTO_VENDA_CATEGORIES) {
    const categoryRows = rowsByCategory.get(category);
    if (!categoryRows || categoryRows.length === 0) {
      missing.push(category);
      continue;
    }
    const allPaid = categoryRows.every((r) => r.status === "paid");
    if (!allPaid) {
      pending.push(category);
    }
  }

  return { ok: missing.length === 0 && pending.length === 0, missing, pending };
}

/** Um SKU vendido no mês sem custo_unit_cheio — gap do gate C6. */
export interface CmvCheioGap {
  sku: string;
  marca: string | null;
  linhas: number;
  unidades: number;
  receita: number;
  temCustoMedio: boolean;
}

export interface CloseGateResult {
  blocked: boolean;
  /** Frases pt-BR curtas e acionáveis, prontas para tooltip. */
  reasons: string[];
  impostoMissing: string[];
  impostoPending: string[];
  skusFaltando: number;
  receitaFaltando: number;
}

/**
 * Combina o gate de imposto (C7) com o gate de CMV cheio (C6). Fail-closed:
 * `gaps === null` (dado ainda carregando) bloqueia — nunca libera fechar o
 * mês sem saber se há custo faltando.
 */
export function resolveCloseGate(input: {
  gaps: CmvCheioGap[] | null;
  guia: GuiaRealCategoryTotal[] | null;
}): CloseGateResult {
  const { gaps, guia } = input;
  const reasons: string[] = [];

  const skusFaltando = gaps === null ? 0 : gaps.length;
  const receitaFaltando =
    gaps === null ? 0 : round2(gaps.reduce((sum, g) => sum + g.receita, 0));

  const cmvBlocked = gaps === null || gaps.length > 0;
  if (gaps === null) {
    reasons.push("Dados de custo ainda carregando — aguarde antes de fechar o mês.");
  } else if (gaps.length > 0) {
    reasons.push(
      `${skusFaltando} SKUs sem custo cheio (R$${receitaFaltando.toFixed(2)} da receita)`,
    );
  }

  const impostoGate = canApurarImposto(guia);
  if (!impostoGate.ok) {
    const categoriasComProblema = [...impostoGate.missing, ...impostoGate.pending];
    reasons.push(
      `Guia de ${categoriasComProblema.join(", ")} ainda não paga na competência M+1`,
    );
  }

  return {
    blocked: cmvBlocked || !impostoGate.ok,
    reasons,
    impostoMissing: impostoGate.missing,
    impostoPending: impostoGate.pending,
    skusFaltando,
    receitaFaltando,
  };
}
