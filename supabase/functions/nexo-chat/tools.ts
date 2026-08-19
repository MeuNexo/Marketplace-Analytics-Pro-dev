/**
 * tools.ts — function-calling read-only do Nexo (Plan 57-02).
 *
 * Duas exportações:
 *   - TOOL_DECLARATIONS: function declarations no formato Gemini. NENHUMA declara
 *     org_id/seller_id/ml_user_id como parâmetro — o modelo NÃO escolhe org/loja.
 *     Só aceitam datas opcionais (from/to YYYY-MM-DD) onde a RPC suporta.
 *   - dispatchTool(sb, orgId, mlUserIds, name, args, ctx?): mapeia cada tool à RPC/tabela
 *     REAL existente (ckcdevcxgvueywivefgx), SEMPRE injetando p_org_id=orgId (do JWT)
 *     e p_user_ids=mlUserIds (derivado server-side de ml_tokens). Qualquer
 *     args.org_id/args.seller_id/args.ml_user_id vindo do modelo é IGNORADO.
 *     ctx.userJwt (opcional, ÚLTIMO parâmetro com default {}) é o JWT real do usuário
 *     — usado EXCLUSIVAMENTE para invocar EFs que exigem JWT do usuário (ex.: ml-reputation).
 *     NUNCA logado, nunca exposto ao modelo.
 *
 * ANTI-IDOR (T-57-07/08): orgId e mlUserIds são parâmetros do SERVIDOR; args só
 * influenciam datas (com clamp/default). Selects diretos via service_role bypassam
 * RLS → .eq('organization_id', orgId) (+ .in('ml_user_id', mlUserIds)) é obrigatório.
 *
 * Read-only (T-57-12): só rpc()/select() sobre dados do Mercado Livre. NENHUMA mutação
 * no ML. Cap de 50 linhas/tool (T-57-09) para conter tokens/custo do functionResponse.
 *
 * ÚNICA EXCEÇÃO (Phase 106): `propose_memory` insere em `nexo_memories` — a memória do
 * próprio Consultor — sempre com status='pending' (aprovação humana). Não toca em preço,
 * lance, status de anúncio nem em nada do ML: o contrato read-only sobre o marketplace
 * permanece intacto.
 *
 * Mapeamento confirmado em 57-RESEARCH (grep nas migrations):
 *   get_margin_by_product → get_margin_with_ads_by_product(p_org_id,p_user_ids,p_from,p_to) [INVOKER]
 *   get_margin_summary    → get_margin_summary(idem) [INVOKER]
 *   get_day_kpis          → get_cost_waterfall(idem) [INVOKER]
 *   get_coverage          → get_consultor_coverage(p_org_id,p_from) [DEFINER]
 *   get_paused_with_sales → get_consultor_paused_with_sales(p_org_id,p_from) [DEFINER]
 *   get_no_cost_count     → get_consultor_no_cost_count(p_org_id) [DEFINER]
 *   get_cashflow          → get_cashflow(p_org_id,p_start_date,p_end_date) [INVOKER]
 *   get_treasury_panel    → get_treasury_panel(p_org_id,p_horizon) [INVOKER]
 *   get_active_insights   → table insights (.eq org, status=active)
 *   get_ads_by_product    → table ml_ads_products_cache (.eq org, .in ml_user_id) — pagina .range()
 *   get_dre_monthly       → table ml_billing_daily (.eq org, .in ml_user_id) agrega por mês-calendário
 *   get_health_score      → table consultor_health_snapshots (.eq org)
 *   get_reputation        → EF ml-reputation (jwt real do usuário via ctx.userJwt) — sem tabela persistida
 *   get_goals             → table ml_targets (.in seller_id, mlUserIds — sem organization_id!) anti-IDOR via seller_id
 *   get_replenishment     → get_replenishment_by_sku(p_org_id,p_sales_window_days,p_demand_multiplier,p_smart) [INVOKER, org-only, p_smart=true]
 *   get_purchase_suppliers → get_purchase_order_suppliers(p_org_id) [INVOKER, org-only]
 *   get_dre_result        → get_dre_operational_by_competence(p_org_id,p_month) [INVOKER, org-only] + select dre_month_close (regime)
 *   get_dre_cash          → get_dre_cash(p_org_id,p_month) [INVOKER, org-only, sempre] + get_dre_cash_forecast(idem) [SÓ mês corrente]
 *   get_projected_balance → get_projected_balance_summary(p_org_id,p_projection_days,p_include_purchase_forecasts) [INVOKER, org-only, default 120d]
 *   get_taxes_paid        → get_imposto_guia_by_competence(p_org_id,p_competence) + get_inss_guia_by_competence(idem) [INVOKER, org-only, régua M+1]
 *   get_price_practiced   → orders_sold_products_agg(_ml_user_ids SÓ, sem p_org_id) + ml_mco_targets(.eq org, sku='') [só-mlUserIds]
 *   get_competitive_price → EF ml-precos-custos ?type=references via ctx.userJwt [EF-com-JWT, molde get_reputation]
 *   get_cost_gaps         → get_cmv_cheio_gaps(p_org_id,p_user_ids,p_from,p_to) [INVOKER, org+mlUserIds]
 *   get_cancelled_revenue → get_cancelled_revenue(idem) [INVOKER, org+mlUserIds]
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_ROWS = 50; // cap de linhas/tool (guardrail de tokens/custo — T-57-09)

// ── helpers de data ──────────────────────────────────────────────────────────
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
export function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}
export function daysAhead(n: number): string {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}
/** Aceita só YYYY-MM-DD válido e real; senão null (cai no default no caller). */
export function clampDate(s: unknown): string | null {
  if (typeof s !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  if (isNaN(d.getTime())) return null;
  // round-trip: rejeita datas impossíveis (ex.: 2026-13-40 vira outra coisa)
  if (d.toISOString().slice(0, 10) !== s) return null;
  return s;
}

function cap(rows: unknown): unknown {
  return Array.isArray(rows) ? rows.slice(0, MAX_ROWS) : rows;
}

/**
 * sumGuiaReal — helper PURO exportado (Task 1, Phase 104). Soma `total` das linhas
 * de guia (get_imposto_guia_by_competence / get_inss_guia_by_competence) EXCLUINDO
 * status='cancelled' (crédito, nunca imposto pago). Mirror de apuracaoImpostoReal
 * (src/lib/dreRegime.ts) / resolveInssReal (src/lib/dreInss.ts). Um mês 100%
 * cancelado soma 0, nunca null.
 */
export function sumGuiaReal(rows: Array<{ status?: string; total?: number }>): number {
  return Math.round(
    rows
      .filter((r) => r.status !== "cancelled")
      .reduce((sum, r) => sum + (Number(r.total) || 0), 0) * 100,
  ) / 100;
}

/**
 * monthPlusOne — mês seguinte a `pMonth` ("YYYY-MM-01" → "YYYY-MM-01" do mês seguinte),
 * aritmética NUMÉRICA (nunca concat de string), tratando virada de dezembro. Mirror de
 * monthPlusOne em src/lib/dreRegime.ts. Usado pela régua M+1 de get_taxes_paid.
 */
function monthPlusOne(pMonth: string): string {
  const [y, m] = pMonth.split("-").map(Number);
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
}

// ── function declarations (Gemini) — SEM param de org/seller ─────────────────
type FnDecl = {
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
};

const DATE_PROPS = {
  from: { type: "string", description: "Data inicial YYYY-MM-DD (opcional, default 30 dias atrás)" },
  to: { type: "string", description: "Data final YYYY-MM-DD (opcional, default hoje)" },
};

export const TOOL_DECLARATIONS: FnDecl[] = [
  {
    name: "get_margin_by_product",
    description:
      "Margem/MCO e ads por SKU da conta no período. Use para lucro por produto, produtos no prejuízo, ads comendo margem, ranking de margem. " +
      "RÉGUA (Fase 222): o número PRINCIPAL é `lucro`/`lucro_pct` (e `lucro_pos_ads`/`lucro_pct_pos_ads` após publicidade) — cenário SEM DIFAL, que é o que os alertas e os limiares do Consultor avaliam. " +
      "Os campos `lucro_com_difal`, `lucro_pct_com_difal`, `lucro_pos_ads_com_difal` e `lucro_pct_pos_ads_com_difal` são o SEGUNDO cenário e são ESTIMATIVA: o DIFAL é calculado pela régua fiscal, não apurado pela nota, e onde há NF-e emitida o valor que vale é o do documento fiscal. " +
      "Ao falar do segundo cenário, diga sempre a palavra estimativa. `difal_efeito` é o custo líquido do DIFAL (já descontada a queda do PIS/COFINS) — NUNCA some `difal_efeito` a `lucro_com_difal`, ele já está lá dentro. " +
      "`pedidos_difal_indefinido` conta pedidos interestaduais cuja alíquota de destino ainda não foi confirmada: cite a contagem em vez de tratar a lacuna como zero.",
    parameters: { type: "object", properties: { ...DATE_PROPS } },
  },
  {
    name: "get_margin_summary",
    description:
      "DRE consolidado do período (receita de pedidos PAGOS, CMV, comissão, frete, impostos, lucro, lucro_pct, pedidos, ticket médio). " +
      "Receita aqui é de pedidos PAGOS — pode divergir levemente do card 'Receita Total' do painel /vendas (que usa ml_daily_cache com escopo levemente diferente). " +
      "Use para visão geral de lucratividade. Pedidos com status partially_refunded (~21) podem não estar incluídos no total (alinhado ao painel atual). " +
      "RÉGUA (Fase 222): os números deste resumo são o cenário SEM DIFAL. O cenário com DIFAL é ESTIMATIVA e vive em `get_difal_summary`/nas telas de margem — não o invente somando DIFAL por cima destes totais.",
    parameters: { type: "object", properties: { ...DATE_PROPS } },
  },
  {
    name: "get_day_kpis",
    description:
      "Waterfall de pedidos do período (paid_revenue, cmv, comissão, frete, imposto, pedidos). " +
      "NÃO inclui tarifas fixas do ML (CFFE/CFONPN/PADS) — para a fatura/DRE do ML use get_dre_monthly. " +
      "Use para MCO/receita do período e composição de custo operacional.",
    parameters: { type: "object", properties: { ...DATE_PROPS } },
  },
  {
    name: "get_coverage",
    description:
      "Cobertura de estoque em dias e venda média diária por SKU, calculada sobre os últimos 30 dias (janela fixa). " +
      "Ruptura aqui é ruptura no FULL — não no estoque total (pode haver saldo em CD/Tiny). " +
      "sold_quantity de outras tools é total histórico do anúncio, não venda do período.",
    parameters: { type: "object", properties: { from: DATE_PROPS.from } },
  },
  {
    name: "get_paused_with_sales",
    description:
      "Anúncios pausados que vendiam (vendas nos últimos 30d). Use para recuperar receita perdida por anúncios pausados.",
    parameters: { type: "object", properties: { from: DATE_PROPS.from } },
  },
  {
    name: "get_no_cost_count",
    description:
      "Quantidade de SKUs sem custo (CMV) cadastrado. Use para avaliar completude de dados antes de afirmar margem.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_active_insights",
    description:
      "Alertas ativos do consultor (rule_key, severidade, categoria, título, impacto em R$). Use para 'o que está pegando agora' e priorização.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_ads_by_product",
    description:
      "Top 50 produtos por gasto de publicidade no período (não é o total da conta). " +
      "attributed_revenue por produto é receita atribuída a ads daquele item, subconjunto do faturamento. " +
      "Para o total de ads da conta use get_ads_account_summary. " +
      "Use para performance de ads por produto, ACoS/TACoS, ads sem venda.",
    parameters: { type: "object", properties: { ...DATE_PROPS } },
  },
  {
    name: "get_dre_monthly",
    description:
      "Fatura/tarifas do ML por MÊS-CALENDÁRIO (espelha o card DRE do painel). " +
      "Agrega ml_billing_daily por mês (01 ao último dia do mês), mesma fonte e escopo do card 'DRE do Mês' em /vendas. " +
      "NÃO é DRE completo: só tarifas ML (CFFE/CFONPN/PADS e outros), sem CMV/impostos/lucro. " +
      "Para lucro e margem use get_margin_summary. " +
      "Retorna by_type (totais por tipo de tarifa), total, coverage_until (último dia coberto) e freshness (quando sincronizou). " +
      "Use coverage_until para verificar se o mês está completo ou parcialmente sincronizado.",
    parameters: {
      type: "object",
      properties: {
        period_month: { type: "string", description: "Mês YYYY-MM (opcional, default mês corrente)" },
      },
    },
  },
  {
    name: "get_cashflow",
    description:
      "Projeção FUTURA de fluxo de caixa (entradas/saídas/saldo diário e acumulado), padrão próximos 90 dias. " +
      "saldo_hoje é o saldo do caixa no dia de hoje. " +
      "ATENÇÃO: inflows projetados existem só até ~+27 dias; o saldo muito à frente é projeção parcial " +
      "(outflows chegam até 2030, inflows têm cobertura limitada) — o horizon_label indica isso. " +
      "Para visão resumida de caixa e saldo mínimo use get_treasury_panel (horizonte 30d). " +
      "Use para 'meu caixa vai ficar negativo?', liquidez, quando o dinheiro cai/sai, projeção de caixa.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "Data inicial YYYY-MM-DD (opcional, default HOJE)" },
        to: { type: "string", description: "Data final YYYY-MM-DD (opcional, default +90 dias)" },
      },
    },
  },
  {
    name: "get_treasury_panel",
    description:
      "Painel de tesouraria: saldo atual + saldo MÍNIMO projetado no horizonte (e quando). Melhor ferramenta para responder se/quando o caixa fica negativo. Horizonte default 30 dias.",
    parameters: {
      type: "object",
      properties: {
        horizon: { type: "integer", description: "Horizonte em dias (opcional, default 30)" },
      },
    },
  },
  {
    name: "get_health_score",
    description:
      "Score de saúde do negócio (0-100) e 5 pilares (margem, ads, estoque, reputação, completude). Use para diagnóstico geral.",
    parameters: { type: "object", properties: {} },
  },

  // ── Cobertura ampla dos dados da conta (Phase 57) ────────────────────────
  {
    name: "get_sales_kpis",
    description:
      "KPIs de receita de pedidos PAGOS no período: gross_revenue, nº de pedidos, ticket médio, unidades. " +
      "Fonte: RPC get_kpi_summary sobre pedidos pagos — pode divergir levemente do card 'Receita Total' do painel /vendas (~R$296k ml_daily_cache) " +
      "porque o painel inclui pedidos com escopo/data levemente diferente. " +
      "Para 'quanto faturei' alinhado ao painel, este é o realizado de pedidos pagos; o painel pode mostrar GMV bruto maior. " +
      "Use para 'quanto vendi', faturamento, volume de vendas.",
    parameters: { type: "object", properties: { ...DATE_PROPS } },
  },
  {
    name: "get_margin_by_brand",
    description:
      "Margem/lucro por MARCA no período. Use para 'qual marca dá mais lucro', ranking de marcas, mix por marca.",
    parameters: { type: "object", properties: { ...DATE_PROPS } },
  },
  {
    name: "get_margin_trend",
    description:
      "Série DIÁRIA de margem/lucro no período (tendência). Use para evolução do lucro dia a dia, se está melhorando ou piorando.",
    parameters: { type: "object", properties: { ...DATE_PROPS } },
  },
  {
    name: "get_margin_by_state",
    description:
      "Margem/receita por estado (UF) no período. Use para desempenho por região e onde concentrar.",
    parameters: { type: "object", properties: { ...DATE_PROPS } },
  },
  {
    name: "get_costs_by_month",
    description:
      "Saídas de caixa por categoria e por mês (Fornecedores, Salários, Empréstimo, etc., pagas + a pagar). " +
      "NÃO é CMV nem a fatura do ML. " +
      "Para fatura/tarifas ML use get_dre_monthly; para CMV/lucro use get_margin_summary. " +
      "Use para tendência de gastos por categoria, exposição por tipo de custo, mês a mês.",
    parameters: {
      type: "object",
      properties: { months: { type: "integer", description: "Qtde de meses (opcional, default 9)" } },
    },
  },
  {
    name: "get_supplier_exposure",
    description:
      "Exposição financeira por fornecedor (contas a pagar). Use para 'quanto devo a cada fornecedor', concentração de fornecedores.",
    parameters: {
      type: "object",
      properties: { top_n: { type: "integer", description: "Top N fornecedores (opcional, default 10)" } },
    },
  },
  {
    name: "get_inventory",
    description:
      "Estoque FULL (fulfillment) por anúncio — NÃO é estoque total da empresa; não há saldo de CD/Tiny nesta base. " +
      "Por padrão lista anúncios ATIVOS. Retorna um resumo agregado (total de itens, total de unidades Full, ativos, pausados, " +
      "com ruptura, tamanhos esgotados) + amostra de até 50 itens. Quando o anúncio tem variações (has_variations=true), " +
      "resume os tamanhos/cores esgotados ('X de N tamanhos esgotados'). " +
      "Passe search para um produto específico. " +
      "IMPORTANTE: 'vendido' (sold_quantity) é total histórico do anúncio, NÃO estoque. " +
      "Ruptura no Full NÃO implica ruptura total (pode haver estoque em CD/Tiny). " +
      "O campo freshness indica quando o cache foi sincronizado pela última vez.",
    parameters: {
      type: "object",
      properties: {
        search: { type: "string", description: "Filtra por texto no título ou SKU do produto (opcional)" },
        status: {
          type: "string",
          enum: ["active", "paused", "all"],
          description: "Status dos anúncios: 'active' (padrão), 'paused' ou 'all'",
        },
      },
    },
  },
  {
    name: "get_open_questions",
    description:
      "Perguntas de compradores sem resposta (status UNANSWERED) — mais recentes. " +
      "Use para 'tenho perguntas pendentes?', dúvidas de clientes a responder. " +
      "Filtra por resposta IS NULL (equivalente a status UNANSWERED nesta base).",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_claims",
    description:
      "Reclamações / devoluções / mediações: status e tipo + contagem aberto×total. " +
      "NÃO há prazo/solução nesta base (data_limite e solução são 100% nulos — campos não populados). " +
      "Use para pós-venda, reclamações abertas, distribuição por tipo (mediations/returns/change/cancel_purchase).",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_ads_campaigns",
    description:
      "Lista campanhas de publicidade com nome e status. " +
      "ATENÇÃO: sem dados de performance por campanha nesta base (gasto/ROAS/impressões por CAMPANHA não disponível — ml_ads_campaigns_cache não tem coluna date e está zerada). " +
      "Para performance de ads use get_ads_account_summary (total da conta) ou get_ads_by_product (por item).",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_ads_account_summary",
    description:
      "Resumo AGREGADO de publicidade da conta no período: gasto total, receita atribuída total, ROAS médio, impressões e cliques totais — visão confiável do total de ads da conta (diferente de get_ads_by_product que é top 50 por gasto, não o total). " +
      "attributed_revenue é receita ATRIBUÍDA a ads, subconjunto do faturamento (não é o total vendido). " +
      "Fonte: ml_ads_daily_cache agregada por período.",
    parameters: { type: "object", properties: { ...DATE_PROPS } },
  },

  // ── OPS-1/D12: reputação ao vivo (mesma fonte do /reputacao) ─────────────
  {
    name: "get_reputation",
    description:
      "Reputação do ML ao vivo (mesma fonte do /reputacao): nível/termômetro (level_id), claims_rate, " +
      "cancellation_rate, power_seller_status. Read-only. " +
      "Retorna por loja. Se os dados não estiverem disponíveis no momento, declara a limitação.",
    parameters: { type: "object", properties: {} },
  },

  // ── OPS-2/D13: metas × realizado (ml_targets por seller_id ∈ mlUserIds) ──
  {
    name: "get_goals",
    description:
      "Meta do mês × realizado: meta de receita/lucro (ml_targets) vs realizado (get_kpi_summary) → % atingido. " +
      "Metas são por loja (seller_id). " +
      "Passe period_month (YYYY-MM) para outro mês; sem parâmetro usa o mês corrente. " +
      "Se não houver meta cadastrada para o mês, declara a limitação em vez de inventar.",
    parameters: {
      type: "object",
      properties: {
        period_month: { type: "string", description: "Mês YYYY-MM (opcional, default mês corrente)" },
      },
    },
  },

  // ── Phase 103: reposição/compra × fornecedores (mesma fonte de /compras) ────
  {
    name: "get_replenishment",
    description:
      "Reposição/compra sugerida por SKU (mesma fonte da página /compras): compra_sugerida e " +
      "valor_estimado são PROJEÇÃO baseada em velocidade de venda, NÃO pedido feito. gatilho_ativo " +
      "indica SKU com compra recomendada agora. cobertura_atual/ponto_reposicao/alvo mostram a " +
      "régua de estoque. sem_giro=true (capital parado / mico — tem estoque mas não vende) é " +
      "DIFERENTE de status_esgotado (SKU zerado, classificado por recência: repor_esgotado / " +
      "revisar_esgotado / descontinuar). custo_ausente=true (comum em conta de revenda sem custo " +
      "cadastrado no Tiny) torna valor_estimado incompleto. qtd_a_caminho/data_proxima_chegada " +
      "indicam OC já em trânsito (compra parcial já registrada). Use para 'o que comprar agora', " +
      "capital parado, priorização de compra.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_purchase_suppliers",
    description:
      "Lista de fornecedores distintos das ordens de compra da conta. Use antes de recomendar " +
      "consolidação de pedido ou responder 'de quem eu compro'.",
    parameters: { type: "object", properties: {} },
  },

  // ── Phase 104: DRE real (competência) & caixa (recebimento) — Consultor CCO ──
  {
    name: "get_dre_result",
    description:
      "DEDUÇÕES OPERACIONAIS por bloco/categoria do mês por COMPETÊNCIA (Pessoal, Estrutura, " +
      "Serviços, Operacional, Financeiro, Não classificado). NÃO é o DRE completo — falta " +
      "receita/CMV/margem (para isso combinar com get_margin_summary/get_day_kpis do mesmo mês). " +
      "Os blocos impostos_venda e excluido são informativos e NÃO devem ser somados ao resultado " +
      "operacional (duplicaria). Expõe regime (apuracao=mês fechado / previsao=mês aberto) e o " +
      "flag double_count_risk por linha. Competência ≠ pagos ≠ caixa.",
    parameters: {
      type: "object",
      properties: {
        month: { type: "string", description: "Mês YYYY-MM (opcional, default mês corrente)" },
      },
    },
  },
  {
    name: "get_dre_cash",
    description:
      "DRE de regime de CAIXA — quando o dinheiro entrou/saiu de fato (recebimento Mercado Pago), " +
      "DIFERENTE de get_dre_result (competência). Inclui um forecast completo do painel 'Fechar o " +
      "mês' (ritmo de vendas, taxas medidas, break-even), presente SÓ para o mês corrente.",
    parameters: {
      type: "object",
      properties: {
        month: { type: "string", description: "Mês YYYY-MM (opcional, default mês corrente)" },
      },
    },
  },
  {
    name: "get_projected_balance",
    description:
      "Saldo PROJETADO em 2 cenários (pessimista/realista — NÃO existe otimista) + data crítica + " +
      "saldo mínimo, no fim de um horizonte longo (default 120 dias). DIFERENTE de get_treasury_panel " +
      "(saldo mínimo, horizonte curto, foco alerta) e get_cashflow (série diária). É PROJEÇÃO, não " +
      "realizado.",
    parameters: {
      type: "object",
      properties: {
        horizon_days: { type: "integer", description: "Horizonte em dias (opcional, default 120)" },
        include_purchase_forecasts: {
          type: "boolean",
          description: "Incluir previsões de compra no cálculo (opcional, default false)",
        },
      },
    },
  },
  {
    name: "get_taxes_paid",
    description:
      "Imposto (ICMS/PIS/COFINS) e INSS REAIS por guia (com créditos), do mês de venda pedido — a " +
      "tool aplica a régua M+1 internamente (a guia da venda do mês M vence em M+1). DIFERENTE do " +
      "imposto estimado (total_tax de get_day_kpis/get_margin_summary, que serve só para " +
      "MCO/precificação). Passe só o mês de VENDA, nunca a competência da guia.",
    parameters: {
      type: "object",
      properties: {
        month: { type: "string", description: "Mês de VENDA YYYY-MM (opcional, default mês corrente)" },
      },
    },
  },

  // ── Phase 105: preços/competitivo/completude — Consultor CCO ────────────────
  {
    name: "get_price_practiced",
    description:
      "Preço MÉDIO praticado (histórico, DERIVADO de receita_bruta/quantidade de pedidos pagos no " +
      "período — NÃO é o preço ATUAL do anúncio) por anúncio (item_id), cruzado com a meta de MCO " +
      "cadastrada (ml_mco_targets). A meta só existe para o anúncio INTEIRO (metas por " +
      "variação/SKU não aparecem — este agregado é por item_id, não por SKU). " +
      "meta_mco_pct=null significa SEM meta cadastrada (não é 0%).",
    parameters: { type: "object", properties: { ...DATE_PROPS } },
  },
  {
    name: "get_competitive_price",
    description:
      "SUGESTÃO de preço competitiva do próprio Mercado Livre (endpoint de referência de preços) + " +
      "custos ML embutidos (comissão/frete) — é SUGESTÃO/indicativo, NÃO garantia de venda nem " +
      "preço mínimo obrigatório, e NÃO é o preço do concorrente. Sem item_id retorna sugestões em " +
      "lote por loja; com item_id detalha 1 anúncio específico. Nem todo item tem sugestão " +
      "disponível.",
    parameters: {
      type: "object",
      properties: {
        item_id: { type: "string", description: "ID do anúncio ML (opcional — ex.: MLB123456789)" },
      },
    },
  },
  {
    name: "get_cost_gaps",
    description:
      "QUAIS SKUs estão sem custo CHEIO cadastrado no período (não só a contagem) — custo ausente " +
      "pode ser LEGÍTIMO em conta de revenda (custo não está no Tiny), não necessariamente erro. " +
      "tem_custo_medio=true distingue 'tem custo médio, falta o cheio' de 'sem custo nenhum'.",
    parameters: { type: "object", properties: { ...DATE_PROPS } },
  },
  {
    name: "get_cancelled_revenue",
    description:
      "Receita de pedidos cancelados/estornados no período — NÃO é faturamento. Complementa " +
      "get_sales_kpis (que só soma pedidos pagos).",
    parameters: { type: "object", properties: { ...DATE_PROPS } },
  },
  // ── Phase 106: única tool que ESCREVE — e só na memória do próprio Consultor ──
  {
    name: "propose_memory",
    description:
      "PROPÕE (não grava direto) um fato para a memória de longo prazo do Consultor. A proposta " +
      "fica pendente até o lojista aprovar na interface — você NUNCA deve afirmar que algo 'foi " +
      "salvo', apenas que foi proposto. Use SÓ para fato DURÁVEL que mude análises futuras: " +
      "decisão travada pelo lojista (ex: 'CMV = custo cheio da nota'), preferência de trabalho, " +
      "contexto estrutural do negócio (ex: 'lead time da Pralana é longo, pedido não pega o pico') " +
      "ou referência. NÃO proponha número volátil que a tool já responde sob demanda (faturamento " +
      "do mês, estoque atual, ROAS da semana) — isso vira memória velha e leva a erro. Se o fato " +
      "contiver número, marque has_numbers=true: ele será tratado como pista histórica, nunca " +
      "como valor atual. Proponha no máximo 1 por conversa, e só quando o fato for realmente novo.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Título curto do fato (aparece na lista de aprovação)" },
        body: { type: "string", description: "O fato em 1-3 frases, autocontido" },
        type: {
          type: "string",
          description: "decision | preference | context | reference",
        },
        scope: {
          type: "string",
          description: "org (fato do negócio) | user (preferência pessoal de quem conversa)",
        },
        has_numbers: {
          type: "boolean",
          description: "true se o fato contém número que envelhece (lead time, meta, patamar)",
        },
      },
      required: ["title", "body", "type"],
    },
  },
];

// ── Phase 103: get_replenishment — summary+sample estratificado (Pitfall 1) ──
/**
 * REPL_LABEL — rótulo de veracidade anexado a TODO retorno de get_replenishment.
 * compra_sugerida/valor_estimado são PROJEÇÃO (não pedido feito); custo_ausente=true
 * (comum em revenda) torna valor_estimado incompleto; qtd_a_caminho/data_proxima_chegada
 * refletem OC já registrada (parcial); sem_giro (capital parado, tem estoque) ≠
 * status_esgotado (estoque zerado).
 */
const REPL_LABEL =
  "compra_sugerida/valor_estimado são PROJEÇÃO baseada em velocidade de venda, NÃO pedido feito. " +
  "custo_ausente=true (comum em conta de revenda sem custo cadastrado no Tiny) torna valor_estimado " +
  "incompleto. qtd_a_caminho/data_proxima_chegada refletem OC já registrada — parcial se não cobrir " +
  "toda a compra sugerida. sem_giro=true (capital parado, tem estoque) é DIFERENTE de " +
  "status_esgotado (estoque zerado, classificado por recência de venda).";

const REPL_SAMPLE_FIELDS = [
  "item_id", "variation_id", "title", "brand", "sku_code", "sku_stock", "venda_dia",
  "venda_inteligente", "cobertura_atual", "ponto_reposicao", "alvo", "compra_sugerida",
  "valor_estimado", "custo_ausente", "sem_giro", "gatilho_ativo", "qtd_a_caminho",
  "data_proxima_chegada", "status_esgotado", "tendencia", "fator_sazonal",
] as const;

function replKey(row: Record<string, unknown>): string {
  return `${row.item_id ?? ""}|${row.variation_id ?? ""}`;
}

function projectReplRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of REPL_SAMPLE_FIELDS) out[f] = row[f];
  return out;
}

const STATUS_ESGOTADO_BUCKETS = ["com_giro", "repor_esgotado", "revisar_esgotado", "descontinuar"] as const;

/**
 * buildReplenishmentResult — helper PURO exportado (Task 1). Recebe TODAS as linhas
 * cruas retornadas por get_replenishment_by_sku (a RPC não pagina — 1 chamada só) e
 * devolve { label, summary, sample }.
 *
 * summary: computado sobre TODAS as rows (não a amostra) — total_skus, gatilho_ativo_count,
 * sem_giro_count, custo_ausente_count, by_status_esgotado.
 *
 * sample: estratificado, DETERMINÍSTICO, teto MAX_ROWS (50), dedupe por item_id|variation_id,
 * na ordem: (1) gatilho_ativo=true por compra_sugerida DESC até 25; (2) sem_giro=true ainda não
 * incluído por sku_stock DESC até 15; (3) preenchimento restante por compra_sugerida DESC até
 * completar 50. Garante representação de micos (sem_giro) mesmo com a ordenação natural da RPC
 * (compra DESC NULLS LAST), que os afunda por terem compra_sugerida=0 — Pitfall 1.
 */
export function buildReplenishmentResult(
  rows: Array<Record<string, unknown>>,
): { label: string; summary: Record<string, unknown>; sample: Record<string, unknown>[] } {
  const total_skus = rows.length;
  let gatilho_ativo_count = 0;
  let sem_giro_count = 0;
  let custo_ausente_count = 0;
  const by_status_esgotado: Record<string, number> = {};
  for (const b of STATUS_ESGOTADO_BUCKETS) by_status_esgotado[b] = 0;
  for (const r of rows) {
    if (r.gatilho_ativo === true) gatilho_ativo_count++;
    if (r.sem_giro === true) sem_giro_count++;
    if (r.custo_ausente === true) custo_ausente_count++;
    const status = typeof r.status_esgotado === "string" ? r.status_esgotado : null;
    if (status && status in by_status_esgotado) {
      by_status_esgotado[status]++;
    }
  }
  const summary = {
    total_skus,
    gatilho_ativo_count,
    sem_giro_count,
    custo_ausente_count,
    by_status_esgotado,
  };

  const included = new Set<string>();
  const sampleRows: Record<string, unknown>[] = [];

  // Bucket 1: gatilho_ativo=true, ordenado por compra_sugerida DESC, até 25
  const gatilhoBucket = rows
    .filter((r) => r.gatilho_ativo === true)
    .sort((a, b) => (Number(b.compra_sugerida) || 0) - (Number(a.compra_sugerida) || 0))
    .slice(0, 25);
  for (const r of gatilhoBucket) {
    const key = replKey(r);
    if (included.has(key)) continue;
    included.add(key);
    sampleRows.push(r);
  }

  // Bucket 2: sem_giro=true ainda não incluído, ordenado por sku_stock DESC, até 15
  const microsBucket = rows
    .filter((r) => r.sem_giro === true && !included.has(replKey(r)))
    .sort((a, b) => (Number(b.sku_stock) || 0) - (Number(a.sku_stock) || 0))
    .slice(0, 15);
  for (const r of microsBucket) {
    const key = replKey(r);
    if (included.has(key)) continue;
    included.add(key);
    sampleRows.push(r);
  }

  // Bucket 3: preenchimento — restante não incluído, por compra_sugerida DESC, até completar 50
  if (sampleRows.length < MAX_ROWS) {
    const remaining = rows
      .filter((r) => !included.has(replKey(r)))
      .sort((a, b) => (Number(b.compra_sugerida) || 0) - (Number(a.compra_sugerida) || 0));
    for (const r of remaining) {
      if (sampleRows.length >= MAX_ROWS) break;
      const key = replKey(r);
      if (included.has(key)) continue;
      included.add(key);
      sampleRows.push(r);
    }
  }

  const sample = sampleRows.slice(0, MAX_ROWS).map(projectReplRow);

  return { label: REPL_LABEL, summary, sample };
}

// ── Phase 105: buildPricePracticed — helper PURO exportado ───────────────────
/**
 * buildPricePracticed — helper PURO exportado (Task 1, Phase 105). Recebe as rows
 * CRUAS de orders_sold_products_agg (item_id, titulo, marca, quantidade, receita_bruta)
 * e as rows de ml_mco_targets (item_id, sku, target_mco_pct); monta
 * Map<item_id, target_mco_pct> SOMENTE a partir das targetRows com sku === '' (defensivo
 * — Pitfall 4, mesmo que o select já filtre, o helper filtra de novo para ser
 * determinístico em teste com fixture mista). Deriva
 * preco_medio_praticado = quantidade>0 ? receita_bruta/quantidade : null (GUARDA de
 * divisão por zero obrigatória — Pitfall 3, nunca NaN/Infinity).
 */
export function buildPricePracticed(
  soldRows: Array<{
    item_id: string;
    titulo?: string | null;
    marca?: string | null;
    quantidade: number | string;
    receita_bruta: number | string;
  }>,
  targetRows: Array<{ item_id: string; sku?: string; target_mco_pct: number | string }>,
): Array<{
  item_id: string;
  titulo: string | null;
  marca: string | null;
  quantidade: number;
  receita_bruta: number;
  preco_medio_praticado: number | null;
  meta_mco_pct: number | null;
}> {
  const targetMap = new Map<string, number>();
  for (const t of targetRows) {
    if (t.sku !== "") continue; // só o sentinela do anúncio inteiro (Pitfall 4)
    targetMap.set(t.item_id, Number(t.target_mco_pct));
  }
  return soldRows.map((r) => {
    const quantidade = Number(r.quantidade) || 0;
    const receita_bruta = Number(r.receita_bruta) || 0;
    return {
      item_id: r.item_id,
      titulo: r.titulo ?? null,
      marca: r.marca ?? null,
      quantidade,
      receita_bruta,
      preco_medio_praticado:
        quantidade > 0 ? Math.round((receita_bruta / quantidade) * 100) / 100 : null,
      meta_mco_pct: targetMap.get(r.item_id) ?? null,
    };
  });
}

// ── dispatcher escopado (anti-IDOR) ──────────────────────────────────────────
/**
 * dispatchTool — executa a tool `name` escopada por org/mlUserIds do servidor.
 *
 * ctx (ÚLTIMO parâmetro, default {}) carrega o JWT real do usuário para tools que
 * invocam EFs que exigem autenticação por JWT de usuário (não service_role):
 *   ctx.userJwt — JWT real extraído do request em index.ts; NUNCA logado; NUNCA
 *   exposto ao modelo; só trafega internamente index→runChat→loop→dispatchTool.
 *
 * Chamadas sem o 6º argumento (testes legados, call-sites anteriores) continuam
 * funcionando porque ctx tem default {} e todas as tools que não precisam de JWT
 * simplesmente ignoram ctx.
 */
export async function dispatchTool(
  sb: SupabaseClient,
  orgId: string,
  mlUserIds: string[],
  name: string,
  args: Record<string, unknown>,
  ctx: { userJwt?: string; userId?: string; conversationId?: string } = {},
): Promise<unknown> {
  // janela de datas: SÓ datas vindas do modelo são respeitadas (não-sensíveis),
  // com clamp + defaults. org/seller dos args são SEMPRE ignorados.
  const to = clampDate(args.to) ?? today();
  const from = clampDate(args.from) ?? daysAgo(30);

  switch (name) {
    // ── RPCs INVOKER: p_org_id (servidor) + p_user_ids (servidor) ────────────
    case "get_margin_by_product": {
      const { data } = await sb.rpc("get_margin_with_ads_by_product", {
        p_org_id: orgId, p_user_ids: mlUserIds, p_from: from, p_to: to,
      });
      return cap(data ?? []);
    }
    case "get_margin_summary": {
      const { data } = await sb.rpc("get_margin_summary", {
        p_org_id: orgId, p_user_ids: mlUserIds, p_from: from, p_to: to,
      });
      return cap(data ?? []);
    }
    case "get_day_kpis": {
      const { data } = await sb.rpc("get_cost_waterfall", {
        p_org_id: orgId, p_user_ids: mlUserIds, p_from: from, p_to: to,
      });
      return cap(data ?? []);
    }
    case "get_cashflow": {
      // FIN-3 (D10): PROJEÇÃO FUTURA, default hoje → +90d. Enriquece com saldo_hoje
      // e horizon_label para o modelo não confundir projeção parcial com saldo real.
      // ATENÇÃO: inflows projetados têm cobertura ~+27d; saldo além disso é artefato
      // de outflows sem inflows correspondentes (não significa falência).
      const cfFrom = clampDate(args.from) ?? today();
      const cfTo = clampDate(args.to) ?? daysAhead(90);
      const { data: cfData } = await sb.rpc("get_cashflow", {
        p_org_id: orgId, p_start_date: cfFrom, p_end_date: cfTo,
      });
      const rows = (cfData ?? []) as Array<Record<string, unknown>>;
      const todayStr = today();
      // saldo_hoje: linha cuja data == hoje; senão o primeiro ponto da série
      const todayRow = rows.find((r) => {
        const d = r.date ?? r.data ?? r.dia;
        return typeof d === "string" && d.slice(0, 10) === todayStr;
      });
      const firstRow = rows[0];
      const saldoHojeRow = todayRow ?? firstRow;
      const saldo_hoje =
        saldoHojeRow !== undefined
          ? (saldoHojeRow.saldo_acumulado ?? saldoHojeRow.saldo ?? saldoHojeRow.balance ?? null)
          : null;
      const horizon_label =
        `Projeção ${cfFrom} → ${cfTo}. ` +
        "saldo_hoje = saldo do caixa hoje. " +
        "Inflows projetados cobrem apenas ~+27 dias; o saldo muito à frente é projeção parcial " +
        "(outflows chegam a 2030, inflows têm cobertura limitada). " +
        "Para saldo mínimo nos próximos 30d use get_treasury_panel.";
      return { horizon_label, saldo_hoje, series: cap(rows) };
    }
    case "get_treasury_panel": {
      const horizon = typeof args.horizon === "number" && args.horizon > 0 && args.horizon <= 365
        ? Math.floor(args.horizon)
        : 30;
      const { data } = await sb.rpc("get_treasury_panel", {
        p_org_id: orgId, p_horizon: horizon,
      });
      return cap(data ?? []);
    }

    // ── RPCs DEFINER: só p_org_id (servidor) ─────────────────────────────────
    case "get_coverage": {
      const { data } = await sb.rpc("get_consultor_coverage", {
        p_org_id: orgId, p_from: from,
      });
      // Anexar rótulo de janela fixa para o modelo não interpretar sold_qty como venda do período
      return { window: "30d-fixed", label: "ruptura no Full (fulfillment)", data: cap(data ?? []) };
    }
    case "get_paused_with_sales": {
      const { data } = await sb.rpc("get_consultor_paused_with_sales", {
        p_org_id: orgId, p_from: from,
      });
      return cap(data ?? []);
    }
    case "get_no_cost_count": {
      const { data } = await sb.rpc("get_consultor_no_cost_count", { p_org_id: orgId });
      return data ?? 0;
    }

    // ── selects diretos: .eq(org) obrigatório (service_role bypassa RLS) ─────
    case "get_active_insights": {
      const { data } = await sb
        .from("insights")
        .select("rule_key,severity,category,title,impact_brl")
        .eq("organization_id", orgId)
        .eq("status", "active")
        .order("impact_brl", { ascending: false, nullsFirst: false })
        .limit(MAX_ROWS);
      return cap(data ?? []);
    }
    case "get_ads_by_product": {
      // pagina ml_ads_products_cache (~6000 linhas/30d → trunca em 1000 sem .range)
      type AdsRow = {
        item_id: string; title: string | null; impressions: number; clicks: number;
        spend: number; attributed_revenue: number; attributed_orders: number;
        cpc: number; ctr: number; roas: number;
      };
      const acc = new Map<string, AdsRow>();
      const PAGE = 1000;
      let offset = 0;
      while (true) {
        const { data: page } = await sb
          .from("ml_ads_products_cache")
          .select("item_id,title,impressions,clicks,spend,attributed_revenue,attributed_orders,cpc,ctr,roas")
          .eq("organization_id", orgId)
          .in("ml_user_id", mlUserIds)
          .gte("date", from)
          .lte("date", to)
          .range(offset, offset + PAGE - 1);
        const rows = (page ?? []) as AdsRow[];
        for (const r of rows) {
          const cur = acc.get(r.item_id);
          if (!cur) {
            acc.set(r.item_id, { ...r });
          } else {
            cur.impressions += r.impressions ?? 0;
            cur.clicks += r.clicks ?? 0;
            cur.spend += r.spend ?? 0;
            cur.attributed_revenue += r.attributed_revenue ?? 0;
            cur.attributed_orders += r.attributed_orders ?? 0;
          }
        }
        if (rows.length < PAGE) break;
        offset += PAGE;
      }
      const agg = Array.from(acc.values())
        .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))
        .slice(0, MAX_ROWS);
      return agg;
    }
    case "get_dre_monthly": {
      // FIN-1/FIN-5 (D8): agrega ml_billing_daily por mês-calendário (01–fim),
      // espelhando o card DRE do dashboard (useMLBillingDaily). Fonte trocada de
      // ml_billing_monthly (ciclo 06→05) → ml_billing_daily (competência = data de lançamento).
      const pm = clampMonth(args.period_month) ?? today().slice(0, 7);
      const dreFrom = `${pm}-01`;
      // último dia do mês: dia 0 do mês seguinte
      const [pmY, pmM] = pm.split("-").map(Number);
      const lastDay = new Date(Date.UTC(pmY, pmM, 0)).getUTCDate();
      const dreTo = `${pm}-${String(lastDay).padStart(2, "0")}`;

      // pagina defensivamente (multi-loja pode ter >1000 linhas)
      type DailyRow = {
        charge_type: string;
        charge_label: string;
        amount: number;
        charge_date: string;
        synced_at: string;
      };
      const allRows: DailyRow[] = [];
      const PAGE = 1000;
      let offset = 0;
      while (true) {
        const { data: page } = await sb
          .from("ml_billing_daily")
          .select("charge_type,charge_label,amount,charge_date,synced_at")
          .eq("organization_id", orgId)
          .in("ml_user_id", mlUserIds)
          .gte("charge_date", dreFrom)
          .lte("charge_date", dreTo)
          .range(offset, offset + PAGE - 1);
        const rows = (page ?? []) as DailyRow[];
        allRows.push(...rows);
        if (rows.length < PAGE) break;
        offset += PAGE;
      }

      // agregar por tipo
      const byType: Record<string, { label: string; amount: number }> = {};
      let total = 0;
      let coverageUntil: string | null = null;
      let freshness: string | null = null;
      for (const r of allRows) {
        const t = r.charge_type ?? "OUTROS";
        if (!byType[t]) byType[t] = { label: r.charge_label ?? t, amount: 0 };
        byType[t].amount += r.amount ?? 0;
        total += r.amount ?? 0;
        if (!coverageUntil || r.charge_date > coverageUntil) coverageUntil = r.charge_date;
        if (!freshness || r.synced_at > freshness) freshness = r.synced_at;
      }
      // arredondar totais
      for (const t of Object.keys(byType)) {
        byType[t].amount = Math.round(byType[t].amount * 100) / 100;
      }

      return {
        period_month: pm,
        label:
          "fatura/tarifas ML do mês-calendário (01–" + String(lastDay).padStart(2, "0") + "), " +
          "espelho do card DRE do painel — NÃO é DRE completo " +
          "(sem CMV/impostos/lucro); para lucro use get_margin_summary",
        by_type: byType,
        total: Math.round(total * 100) / 100,
        coverage_until: coverageUntil,
        freshness,
      };
    }
    case "get_health_score": {
      // OPS-4/D14: ordenar por snapshot_month DESC (casar com o dashboard) — não created_at
      const { data } = await sb
        .from("consultor_health_snapshots")
        .select("snapshot_month,score,score_margin,score_ads,score_estoque,score_reputacao,score_completude,created_at")
        .eq("organization_id", orgId)
        .order("snapshot_month", { ascending: false })
        .limit(1);
      return cap(data ?? []);
    }

    // ── RPCs de margem/vendas (INVOKER): p_org_id + p_user_ids do servidor ───
    case "get_sales_kpis": {
      const { data } = await sb.rpc("get_kpi_summary", {
        p_org_id: orgId, p_user_ids: mlUserIds, p_from: from, p_to: to,
      });
      return cap(data ?? []);
    }
    case "get_margin_by_brand": {
      const { data } = await sb.rpc("get_margin_by_brand", {
        p_org_id: orgId, p_user_ids: mlUserIds, p_from: from, p_to: to,
      });
      return cap(data ?? []);
    }
    case "get_margin_trend": {
      const { data } = await sb.rpc("get_margin_by_day", {
        p_org_id: orgId, p_user_ids: mlUserIds, p_from: from, p_to: to,
      });
      return cap(data ?? []);
    }
    case "get_margin_by_state": {
      const { data } = await sb.rpc("get_margin_by_estado", {
        p_org_id: orgId, p_user_ids: mlUserIds, p_from: from, p_to: to,
      });
      return cap(data ?? []);
    }
    case "get_costs_by_month": {
      const months = typeof args.months === "number" && args.months > 0 && args.months <= 24
        ? Math.floor(args.months) : 9;
      const { data } = await sb.rpc("get_cost_by_month", { p_org_id: orgId, p_months: months });
      return cap(data ?? []);
    }
    case "get_supplier_exposure": {
      const topN = typeof args.top_n === "number" && args.top_n > 0 && args.top_n <= 50
        ? Math.floor(args.top_n) : 10;
      const { data } = await sb.rpc("get_supplier_exposure", { p_org_id: orgId, p_top_n: topN });
      return cap(data ?? []);
    }

    // ── selects diretos: .eq(org) obrigatório + .in(ml_user_id) quando houver ─
    case "get_inventory": {
      // allow-list de status: valor fora do enum cai no default "active" (T-58-01-STATUS)
      const rawStatus = typeof args.status === "string" ? args.status : "active";
      const statusEnum = rawStatus === "paused" ? "paused" : rawStatus === "all" ? "all" : "active";

      // sanitiza o search: remove caracteres especiais do filtro PostgREST/ilike
      const raw = typeof args.search === "string" ? args.search : "";
      const safe = raw.replace(/[%,()*\\]/g, "").trim().slice(0, 60);

      // ── query de agregado (sem cap — roda sobre TODO o conjunto da org) ─────
      // Seleciona só o necessário para o sumário; pagina se >1000 linhas (PostgREST)
      type AggRow = {
        status: string;
        available_quantity: number;
        has_variations: boolean;
        variations: unknown;
      };
      const aggAcc: AggRow[] = [];
      const PAGE_SIZE = 1000;
      let aggOffset = 0;
      while (true) {
        let aq = sb.from("ml_inventory_cache")
          .select("status,available_quantity,has_variations,variations")
          .eq("organization_id", orgId);
        if (mlUserIds.length) aq = aq.in("ml_user_id", mlUserIds);
        if (statusEnum !== "all") aq = aq.eq("status", statusEnum);
        if (safe) aq = aq.or(`title.ilike.%${safe}%,seller_custom_field.ilike.%${safe}%`);
        aq = aq.range(aggOffset, aggOffset + PAGE_SIZE - 1);
        const { data: aggPage } = await aq;
        const pageRows = (aggPage ?? []) as AggRow[];
        aggAcc.push(...pageRows);
        if (pageRows.length < PAGE_SIZE) break;
        aggOffset += PAGE_SIZE;
      }

      // calcular agregado em memória
      let totalItems = aggAcc.length;
      let totalUnits = 0;
      let countActive = 0;
      let countPaused = 0;
      let countOutOfStock = 0;
      let countItemsWithSizeOutOfStock = 0;
      for (const r of aggAcc) {
        totalUnits += r.available_quantity ?? 0;
        if (r.status === "active") countActive++;
        else if (r.status === "paused") countPaused++;
        if ((r.available_quantity ?? 0) === 0) countOutOfStock++;
        if (r.has_variations) {
          const vs = summarizeVariations(r.variations);
          if (vs.out_of_stock > 0) countItemsWithSizeOutOfStock++;
        }
      }
      const summary = {
        totalItems,
        totalUnits,
        active: countActive,
        paused: countPaused,
        outOfStock: countOutOfStock,
        itemsWithSizeOutOfStock: countItemsWithSizeOutOfStock,
      };

      // ── query de amostra (com cap MAX_ROWS) ──────────────────────────────────
      let sq = sb.from("ml_inventory_cache")
        .select("item_id,title,status,available_quantity,sold_quantity,price,health,visits,brand,seller_custom_field,has_variations,variations,logistic_type,synced_at")
        .eq("organization_id", orgId);
      if (mlUserIds.length) sq = sq.in("ml_user_id", mlUserIds);
      if (statusEnum !== "all") sq = sq.eq("status", statusEnum);
      if (safe) sq = sq.or(`title.ilike.%${safe}%,seller_custom_field.ilike.%${safe}%`);
      sq = sq.order("available_quantity", { ascending: true }).limit(MAX_ROWS);
      const { data: sampleRaw } = await sq;

      // enriquecer amostra com variações esgotadas e calcular freshness
      let maxSyncedAt: string | null = null;
      type SampleRow = Record<string, unknown>;
      const sample: SampleRow[] = ((sampleRaw ?? []) as SampleRow[]).map((row) => {
        // frescura: max(synced_at) das linhas da amostra
        const sa = row.synced_at as string | null;
        if (sa && (maxSyncedAt === null || sa > maxSyncedAt)) maxSyncedAt = sa;

        const enriched: SampleRow = { ...row };
        // remover campos volumosos que o modelo não precisa em lista
        delete enriched.variations;
        if (row.has_variations) {
          const vs = summarizeVariations(row.variations);
          enriched.variations_out_of_stock = vs.out_of_stock > 0
            ? `${vs.out_of_stock} de ${vs.total} tamanhos/cores esgotados (${vs.names.slice(0, 5).join(", ")}${vs.names.length > 5 ? ", ..." : ""})`
            : "todos os tamanhos com estoque";
        }
        return enriched;
      });

      return {
        label: "estoque Full (fulfillment) — não inclui CD/Tiny; não é estoque total",
        freshness: maxSyncedAt,
        summary,
        sample,
      };
    }
    case "get_open_questions": {
      let q = sb.from("ml_questions")
        .select("item_title,texto,status,data_pergunta")
        .eq("organization_id", orgId)
        .is("resposta", null);
      if (mlUserIds.length) q = q.in("ml_user_id", mlUserIds);
      const { data } = await q.order("data_pergunta", { ascending: false }).limit(MAX_ROWS);
      return cap(data ?? []);
    }
    case "get_claims": {
      // OPS-3/D14: removidos data_limite e solucao (100% null — campos mortos que
      // prometem "prazos" inexistentes). Retorna status/tipo + contagem aberto×total.
      let q = sb.from("ml_claims")
        .select("claim_id,tipo,status,motivo,data_abertura")
        .eq("organization_id", orgId);
      if (mlUserIds.length) q = q.in("ml_user_id", mlUserIds);
      const { data } = await q.order("data_abertura", { ascending: false }).limit(MAX_ROWS);
      const rows = (data ?? []) as Array<{ tipo?: string; status?: string }>;
      // contagem aberto × total e distribuição por tipo
      const totalClaims = rows.length;
      const openCount = rows.filter((r) => r.status === "opened").length;
      const byType: Record<string, number> = {};
      for (const r of rows) {
        const t = r.tipo ?? "unknown";
        byType[t] = (byType[t] ?? 0) + 1;
      }
      return {
        label: "Reclamações: NÃO há prazo/solução nesta base (data_limite e solucao 100% nulos)",
        total: totalClaims,
        open: openCount,
        by_type: byType,
        items: rows,
      };
    }
    case "get_ads_campaigns": {
      // NEUTRALIZADO (VMA-1 / D5): ml_ads_campaigns_cache não tem coluna date e está zerada.
      // Retornar APENAS name+status para não induzir o modelo a inferir ROAS=0 como verdade.
      let q = sb.from("ml_ads_campaigns_cache")
        .select("name,status")
        .eq("organization_id", orgId);
      if (mlUserIds.length) q = q.in("ml_user_id", mlUserIds);
      const { data } = await q.order("name", { ascending: true }).limit(MAX_ROWS);
      return {
        performance_note:
          "Sem dados de performance por campanha nesta base (gasto/ROAS por CAMPANHA não disponível). " +
          "Para performance de ads use get_ads_account_summary (total da conta) ou get_ads_by_product (por item).",
        campaigns: cap(data ?? []),
      };
    }
    case "get_ads_account_summary": {
      // Agrega ml_ads_daily_cache por período para visão confiável do total de ads da conta.
      // Anti-IDOR: .eq(organization_id) + .in(ml_user_id) — ambos do servidor.
      type DailyRow = {
        spend: number;
        attributed_revenue: number;
        impressions: number;
        clicks: number;
        synced_at: string;
      };
      let totalSpend = 0;
      let totalAttributed = 0;
      let totalImpressions = 0;
      let totalClicks = 0;
      let maxSyncedAt: string | null = null;
      const PAGE = 1000;
      let offset = 0;
      while (true) {
        const { data: page } = await sb
          .from("ml_ads_daily_cache")
          .select("spend,attributed_revenue,impressions,clicks,synced_at")
          .eq("organization_id", orgId)
          .in("ml_user_id", mlUserIds)
          .gte("date", from)
          .lte("date", to)
          .range(offset, offset + PAGE - 1);
        const rows = (page ?? []) as DailyRow[];
        for (const r of rows) {
          totalSpend += r.spend ?? 0;
          totalAttributed += r.attributed_revenue ?? 0;
          totalImpressions += r.impressions ?? 0;
          totalClicks += r.clicks ?? 0;
          const sa = r.synced_at;
          if (sa && (maxSyncedAt === null || sa > maxSyncedAt)) maxSyncedAt = sa;
        }
        if (rows.length < PAGE) break;
        offset += PAGE;
      }
      const roas = totalSpend > 0 ? totalAttributed / totalSpend : null;
      return {
        period: { from, to },
        spend: totalSpend,
        attributed_revenue: totalAttributed,
        roas,
        impressions: totalImpressions,
        clicks: totalClicks,
        freshness: maxSyncedAt,
        note: "attributed_revenue é receita atribuída a ads, subconjunto do faturamento — não é o total vendido.",
      };
    }

    // ── OPS-1/D12: reputação ao vivo via EF ml-reputation ───────────────────
    // Anti-IDOR (T-58-04-REP-IDOR): ml_user_id SEMPRE de mlUserIds (servidor);
    // ctx.userJwt é o JWT real do usuário — a EF revalida is_org_member como 2ª barreira.
    // NUNCA logar ctx.userJwt.
    case "get_reputation": {
      // Sem JWT real → declarar limitação (VERAC-05), não inventar
      if (!ctx.userJwt) {
        return { error: "sem_jwt", label: "não foi possível consultar a reputação ao vivo agora" };
      }
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      // Invoca a EF ml-reputation para cada loja (ml_user_id ∈ mlUserIds — servidor)
      // com o JWT real do usuário (requerido pela EF — service_role retornaria 401)
      type RepResult = {
        ml_user_id: string;
        level_id?: string | null;
        claims_rate?: number | null;
        cancellation_rate?: number | null;
        power_seller_status?: string | null;
        nickname?: string | null;
        error?: string;
      };
      const results: RepResult[] = [];
      for (const mlUserId of mlUserIds) {
        try {
          const efUrl = `${supabaseUrl}/functions/v1/ml-reputation?ml_user_id=${encodeURIComponent(mlUserId)}`;
          const res = await fetch(efUrl, {
            headers: { "Authorization": `Bearer ${ctx.userJwt}` },
          });
          if (!res.ok) {
            results.push({ ml_user_id: mlUserId, error: `ef_status_${res.status}` });
            continue;
          }
          const data = await res.json() as Record<string, unknown>;
          const rep = data.seller_reputation as Record<string, unknown> | null ?? null;
          results.push({
            ml_user_id: mlUserId,
            level_id: (rep?.level_id as string | null) ?? null,
            claims_rate: (rep?.transactions as Record<string, unknown>)?.claims_rate as number | null ?? null,
            cancellation_rate: (rep?.transactions as Record<string, unknown>)?.cancellation_rate as number | null ?? null,
            power_seller_status: data.power_seller_status as string | null ?? null,
            nickname: data.nickname as string | null ?? null,
          });
        } catch {
          results.push({ ml_user_id: mlUserId, error: "ef_fetch_error" });
        }
      }
      return { label: "reputação ao vivo do ML", data: results.slice(0, MAX_ROWS) };
    }

    // ── OPS-2/D13: metas × realizado — anti-IDOR adaptado para ml_targets ────
    // CRÍTICO (T-58-04-GOALS-IDOR): ml_targets NÃO tem organization_id.
    // Scopar SOMENTE por .in('seller_id', mlUserIds) derivado server-side.
    // seller do modelo é COMPLETAMENTE IGNORADO.
    case "get_goals": {
      const pm = clampMonth(args.period_month) ?? today().slice(0, 7);
      const [pmY, pmM] = pm.split("-").map(Number);
      // mês como inteiros para comparar com year/month na tabela
      const { data: targetRows } = await sb
        .from("ml_targets")
        .select("seller_id,target_value,kpi_targets")
        // Anti-IDOR: SOMENTE mlUserIds do servidor; seller do modelo ignorado
        .in("seller_id", mlUserIds)
        .eq("year", pmY)
        .eq("month", pmM);

      const targets = (targetRows ?? []) as Array<{
        seller_id: string;
        target_value: number;
        kpi_targets: Record<string, number> | null;
      }>;

      // Cruzar com o realizado (receita de pedidos pagos no período)
      const monthFrom = `${pm}-01`;
      const lastDay = new Date(Date.UTC(pmY, pmM, 0)).getUTCDate();
      const monthTo = `${pm}-${String(lastDay).padStart(2, "0")}`;
      const { data: kpiData } = await sb.rpc("get_kpi_summary", {
        p_org_id: orgId,
        p_user_ids: mlUserIds,
        p_from: monthFrom,
        p_to: monthTo,
      });
      const kpi = (Array.isArray(kpiData) ? kpiData[0] : kpiData) as Record<string, unknown> | null ?? null;
      const realizadoReceita = (kpi?.gross_revenue as number) ?? (kpi?.receita as number) ?? null;

      if (targets.length === 0) {
        return {
          period_month: pm,
          label: `sem meta cadastrada para ${pm} — nenhum registro em ml_targets para as lojas desta conta neste mês`,
          by_seller: [],
          realizado_receita: realizadoReceita,
        };
      }

      const bySeller = targets.map((t) => {
        const metaReceita = Number(t.target_value ?? 0);
        const pctAtingido =
          metaReceita > 0 && realizadoReceita !== null
            ? Math.round((realizadoReceita / metaReceita) * 1000) / 10
            : null;
        return {
          seller_id: t.seller_id,
          meta_receita: metaReceita,
          meta_lucro_pct: t.kpi_targets?.gross_profit ?? t.kpi_targets?.lucro_pct ?? null,
          realizado_receita: realizadoReceita,
          pct_atingido: pctAtingido,
        };
      });

      return {
        period_month: pm,
        label: `meta × realizado ${pm} — realizado é receita de pedidos pagos (get_kpi_summary)`,
        by_seller: bySeller,
      };
    }

    // ── Phase 103: reposição/compra × fornecedores — org-only, SEM p_user_ids ──
    case "get_purchase_suppliers": {
      const { data } = await sb.rpc("get_purchase_order_suppliers", { p_org_id: orgId });
      const fornecedores = ((data ?? []) as Array<{ fornecedor: string }>).map((r) => r.fornecedor);
      return cap(fornecedores);
    }
    case "get_replenishment": {
      // p_smart:true EXPLÍCITO — paridade com o hook useReplenishmentBySku (painel /compras).
      // O default SQL é FALSE (Pitfall 2) — NÃO omitir este parâmetro.
      const { data } = await sb.rpc("get_replenishment_by_sku", {
        p_org_id: orgId,
        p_sales_window_days: 30,
        p_demand_multiplier: 1.0,
        p_smart: true,
      });
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      return buildReplenishmentResult(rows);
    }

    // ── Phase 104: DRE real (competência) & caixa (recebimento) — org-only ──────
    case "get_dre_result": {
      const pm = clampMonth(args.month) ?? today().slice(0, 7);
      const pMonth = `${pm}-01`;
      const { data } = await sb.rpc("get_dre_operational_by_competence", {
        p_org_id: orgId, p_month: pMonth,
      });
      const rows = (data ?? []) as Array<Record<string, unknown>>;

      // Regime: checar se o mês está FECHADO (apuração) — select direto anti-IDOR.
      const { data: closeRow } = await sb
        .from("dre_month_close")
        .select("closed_at")
        .eq("organization_id", orgId)
        .eq("competence_month", pMonth)
        .maybeSingle();
      const regime = closeRow ? "apuracao" : "previsao";

      return {
        month: pm,
        regime,
        label:
          "Estas são as DEDUÇÕES OPERACIONAIS por bloco/categoria (Pessoal, Estrutura, Serviços, " +
          "Operacional, Não classificado, Financeiro) que descem da Margem de Contribuição até o " +
          "Resultado — NÃO é o DRE completo (falta receita/CMV/margem: use get_margin_summary ou " +
          "get_day_kpis para o mesmo mês). Blocos impostos_venda e excluido são informativos — NÃO " +
          "somar ao resultado operacional (já contabilizados em outra camada, senão duplica). " +
          `Regime deste mês: ${
            regime === "apuracao"
              ? "APURAÇÃO (fechado — imposto/INSS deveriam vir de get_taxes_paid, não do estimado)"
              : "PREVISÃO (aberto — valores ainda são estimativa)"
          }.`,
        rows: cap(rows),
      };
    }
    case "get_dre_cash": {
      const pm = clampMonth(args.month) ?? today().slice(0, 7);
      const pMonth = `${pm}-01`;
      const isCurrentMonth = pm === today().slice(0, 7);

      const { data: cashData } = await sb.rpc("get_dre_cash", { p_org_id: orgId, p_month: pMonth });
      const rows = (cashData ?? []) as Array<Record<string, unknown>>;

      let forecast: unknown = null;
      if (isCurrentMonth) {
        const { data: fcData } = await sb.rpc("get_dre_cash_forecast", {
          p_org_id: orgId, p_month: pMonth,
        });
        forecast = cap(fcData ?? []);
      }

      return {
        month: pm,
        label:
          "DRE de regime de CAIXA — quando o dinheiro efetivamente entrou/saiu (recebimento Mercado " +
          "Pago), DIFERENTE de get_dre_result (regime de competência). Seção 'entrada': " +
          "bruto/liquido/descontos_fonte/refunds/a_liberar por liberação do MP. Seção 'saida': pago " +
          "no mês por bloco/categoria (SEM filtrar impostos_venda/excluido — inclui tudo). Seção " +
          "'previsao': previsão SIMPLES de imposto (não confundir com o campo forecast abaixo).",
        rows: cap(rows),
        forecast,
        forecast_note: isCurrentMonth
          ? "Forecast completo do painel 'Fechar o mês' (Phase 100) — inclui ritmo de vendas, taxas " +
            "medidas e alerta_recorrencia (detector de recorrência suspeita — PODE ter falso-positivo " +
            "em parcelas reais, tratar como sinal a checar, não como fato)."
          : "Forecast só se aplica ao MÊS CORRENTE — não disponível para mês passado/futuro.",
      };
    }
    case "get_projected_balance": {
      const horizonDays = typeof args.horizon_days === "number" && args.horizon_days > 0 &&
          args.horizon_days <= 365
        ? Math.floor(args.horizon_days)
        : 120; // default do hook, NÃO 30 (get_treasury_panel usa 30)
      const includePurchaseForecasts = args.include_purchase_forecasts === true; // default false (CASHFIX-06)

      const { data } = await sb.rpc("get_projected_balance_summary", {
        p_org_id: orgId,
        p_projection_days: horizonDays,
        p_include_purchase_forecasts: includePurchaseForecasts,
      });
      const row = Array.isArray(data) ? data[0] : data;

      return {
        horizon_days: horizonDays,
        label:
          "Saldo PROJETADO em 2 cenários (pessimista e realista — não há um terceiro cenário): " +
          "pessimista = saldo atual menos TODAS as saídas previstas no horizonte, sem contar " +
          "nenhuma entrada futura (pior caso); realista = saldo atual + entradas − saídas " +
          "projetadas dia a dia. critical_date = 1º dia em que o realista fica negativo; " +
          "min_balance = pior ponto do horizonte. DIFERENTE de get_treasury_panel (saldo MÍNIMO em " +
          "horizonte curto, foco em alerta) e de get_cashflow (série diária detalhada) — esta é a " +
          "projeção de 'quanto vou ter' no fim do horizonte.",
        ...(row ?? {}),
      };
    }
    case "get_taxes_paid": {
      const pm = clampMonth(args.month) ?? today().slice(0, 7);
      const saleMonth = `${pm}-01`;
      const guiaCompetence = monthPlusOne(saleMonth); // régua M+1 — NUNCA o mês de venda direto

      const [{ data: impostoData }, { data: inssData }] = await Promise.all([
        sb.rpc("get_imposto_guia_by_competence", { p_org_id: orgId, p_competence: guiaCompetence }),
        sb.rpc("get_inss_guia_by_competence", { p_org_id: orgId, p_competence: guiaCompetence }),
      ]);
      const impostoRows = (impostoData ?? []) as Array<{ category: string; total: number; status: string }>;
      const inssRows = (inssData ?? []) as Array<{ category: string; total: number; status: string }>;

      return {
        sale_month: pm,
        guia_competence: guiaCompetence.slice(0, 7),
        label:
          "Imposto/INSS REAIS por guia (com créditos), régua de COMPETÊNCIA DESLOCADA: a guia que " +
          `sai/vence em ${guiaCompetence.slice(0, 7)} é o encargo real do mês de venda ${pm} (M+1, ` +
          "regra travada — ICMS de venda de junho é pago ~dia 21 de julho). DIFERENTE do imposto " +
          "estimado (total_tax) de get_day_kpis/get_margin_summary, que é sobre a venda, não a guia " +
          "real. status='cancelled' é crédito e NUNCA soma; 'paid'/'pending' somam (competência).",
        imposto_venda: { rows: cap(impostoRows), total_real: sumGuiaReal(impostoRows) },
        inss_folha: { rows: cap(inssRows), total_real: sumGuiaReal(inssRows) },
      };
    }

    // ── Phase 105: preço praticado × meta MCO — SÓ mlUserIds (molde get_goals) ──
    case "get_price_practiced": {
      const { data: soldData } = await sb.rpc("orders_sold_products_agg", {
        _ml_user_ids: mlUserIds, _from: from, _to: to,
      });
      const soldRows = (soldData ?? []) as Array<{
        item_id: string; titulo: string | null; marca: string | null;
        quantidade: number | string; receita_bruta: number | string;
      }>;

      // Anti-IDOR: select direto via service_role bypassa RLS — .eq(organization_id)
      // obrigatório. Só o sentinela sku='' ("anúncio inteiro") casa com o agregado por
      // item_id da RPC acima — metas por variação (sku != '') não têm equivalente aqui.
      const { data: targetData } = await sb
        .from("ml_mco_targets")
        .select("item_id, target_mco_pct, sku")
        .eq("organization_id", orgId)
        .eq("sku", "");
      const targetRows = (targetData ?? []) as Array<
        { item_id: string; target_mco_pct: number | string; sku?: string }
      >;

      const enriched = buildPricePracticed(soldRows, targetRows);

      return {
        label:
          "preco_medio_praticado é HISTÓRICO (receita_bruta/quantidade do período, pedidos pagos) — " +
          "não é o preço atual do anúncio. meta_mco_pct vem de ml_mco_targets (alvo cadastrado para " +
          "o anúncio INTEIRO — sku=''); meta_mco_pct=null significa SEM meta cadastrada para esse " +
          "item (não é 0% — declare a limitação, não invente). Metas específicas por VARIAÇÃO (SKU) " +
          "não aparecem aqui — este agregado é por item_id, não por variação.",
        rows: cap(enriched),
      };
    }

    // ── Phase 105: sinal competitivo real — EF via ctx.userJwt (molde get_reputation) ──
    // Anti-IDOR/credencial: ml_user_id SEMPRE de mlUserIds (servidor); ctx.userJwt é o
    // JWT real do usuário (a EF revalida is_org_member como 2ª barreira). NUNCA logar
    // nem colocar ctx.userJwt no objeto de retorno.
    case "get_competitive_price": {
      if (!ctx.userJwt) {
        return { error: "sem_jwt", label: "não foi possível consultar preço competitivo agora" };
      }
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      // item_id é input livre do modelo (não-sensível): sanitiza allow-list alfanumérico + slice 30
      const itemId = typeof args.item_id === "string" && args.item_id.trim()
        ? args.item_id.trim().replace(/[^a-zA-Z0-9]/g, "").slice(0, 30)
        : undefined;

      type RefResult = {
        ml_user_id: string;
        reference?: unknown;
        references?: unknown[];
        no_suggestion?: boolean;
        error?: string;
      };
      const results: RefResult[] = [];
      for (const mlUserId of mlUserIds) {
        try {
          const qs = new URLSearchParams({ ml_user_id: mlUserId, type: "references" });
          if (itemId) qs.set("item_id", itemId);
          const res = await fetch(
            `${supabaseUrl}/functions/v1/ml-precos-custos?${qs}`,
            { headers: { Authorization: `Bearer ${ctx.userJwt}` } },
          );
          if (!res.ok) {
            results.push({ ml_user_id: mlUserId, error: `ef_status_${res.status}` });
            continue;
          }
          const data = await res.json() as Record<string, unknown>;
          results.push({
            ml_user_id: mlUserId,
            reference: data.reference ?? null,
            references: Array.isArray(data.references) ? data.references : undefined,
            no_suggestion: data.no_suggestion === true,
          });
        } catch {
          results.push({ ml_user_id: mlUserId, error: "ef_fetch_error" });
        }
      }
      return {
        label:
          "Sugestão de preço competitiva do próprio Mercado Livre (endpoint de referência de " +
          "preços) — é SUGESTÃO/indicativo, NÃO garantia de venda nem preço mínimo obrigatório, e " +
          "NÃO é o preço do concorrente. current_price/suggested_price/lowest_price vêm direto do " +
          "ML; selling_fees/shipping_fees são custos ML já embutidos na sugestão. Sem item_id, " +
          "retorna sugestões em lote por loja; com item_id, detalhe de 1 item. Nem todo item tem " +
          "sugestão disponível (no_suggestion / omitido no bulk).",
        data: cap(results),
      };
    }

    // ── Phase 105: SKUs sem custo cheio (completude) — org+mlUserIds ─────────
    case "get_cost_gaps": {
      const { data } = await sb.rpc("get_cmv_cheio_gaps", {
        p_org_id: orgId, p_user_ids: mlUserIds, p_from: from, p_to: to,
      });
      const rows = (data ?? []) as Array<{
        sku: string; marca: string | null; linhas: number; unidades: number;
        receita: number; tem_custo_medio: boolean;
      }>;
      return {
        label:
          "SKUs sem custo CHEIO cadastrado no período. custo ausente pode ser legítimo em conta " +
          "de revenda (custo não está no Tiny) — não é necessariamente erro. tem_custo_medio=true " +
          "distingue 'tem custo médio, falta o cheio' de 'sem custo nenhum'.",
        rows: cap(rows),
      };
    }

    // ── Phase 105: receita cancelada (completude) — org+mlUserIds ────────────
    case "get_cancelled_revenue": {
      const { data } = await sb.rpc("get_cancelled_revenue", {
        p_org_id: orgId, p_user_ids: mlUserIds, p_from: from, p_to: to,
      });
      const row = (Array.isArray(data) ? data[0] : data) as
        { cancelled_revenue?: number; cancelled_orders?: number } | null;
      return {
        label: "Receita de pedidos cancelados — NÃO é faturamento; complementa get_sales_kpis " +
          "(que só soma pedidos pagos).",
        cancelled_revenue: Number(row?.cancelled_revenue ?? 0),
        cancelled_orders: Number(row?.cancelled_orders ?? 0),
      };
    }

    // ── Phase 106: propose_memory ────────────────────────────────────────────
    // ÚNICA tool que escreve — e SÓ na tabela nexo_memories. O read-only sobre o
    // Mercado Livre (T-57-12) permanece intacto: nenhuma mutação de preço, lance,
    // status de anúncio ou qualquer coisa no ML passa por aqui.
    // status é SEMPRE 'pending': aprovação é humana (decisão travada por Wesley).
    case "propose_memory": {
      const title = String(args.title ?? "").trim();
      const body = String(args.body ?? "").trim();
      if (!title || !body) return { proposed: false, error: "title_and_body_required" };

      const tipo = String(args.type ?? "context");
      const type = ["decision", "preference", "context", "reference"].includes(tipo)
        ? tipo
        : "context";
      // escopo 'user' exige dono; sem userId do servidor, cai para 'org'
      const querUser = String(args.scope ?? "org") === "user";
      const scope = querUser && ctx.userId ? "user" : "org";

      const { error } = await sb.from("nexo_memories").insert({
        organization_id: orgId,                       // SEMPRE do servidor (anti-IDOR)
        scope,
        user_id: scope === "user" ? ctx.userId : null,
        type,
        title: title.slice(0, 200),
        body: body.slice(0, 2000),
        has_numbers: args.has_numbers === true,
        status: "pending",                            // NUNCA 'active'
        source_conversation_id: ctx.conversationId ?? null,
        created_by: ctx.userId ?? null,
      });
      if (error) return { proposed: false, error: "insert_failed" };
      return {
        proposed: true,
        title,
        aviso:
          "Proposta registrada como PENDENTE. Diga ao lojista que você sugeriu lembrar disso e " +
          "que ele precisa aprovar na interface — não afirme que já está salvo.",
      };
    }

    default:
      return { error: "unknown_tool" };
  }
}

/**
 * summarizeVariations — extrai, do jsonb `variations`, um resumo defensivo das
 * variações com estoque zerado.
 *
 * Estrutura esperada de cada variação (conforme ml-inventory/index.ts):
 *   { variation_id, attribute_combinations: [{id, name, value}], available_quantity, ... }
 *
 * Retorna { total, out_of_stock, names } onde names = lista de rótulos legíveis
 * das variações esgotadas (ex.: "Tamanho: 38 BR / Cor: Preto").
 */
export function summarizeVariations(variations: unknown): {
  total: number;
  out_of_stock: number;
  names: string[];
} {
  if (!Array.isArray(variations) || variations.length === 0) {
    return { total: 0, out_of_stock: 0, names: [] };
  }
  let total = 0;
  let out_of_stock = 0;
  const names: string[] = [];
  for (const v of variations) {
    if (typeof v !== "object" || v === null) continue;
    total++;
    const qty = (v as Record<string, unknown>).available_quantity;
    if ((typeof qty === "number" ? qty : Number(qty) || 0) === 0) {
      out_of_stock++;
      // extrair rótulo legível a partir de attribute_combinations
      const combos = (v as Record<string, unknown>).attribute_combinations;
      if (Array.isArray(combos) && combos.length > 0) {
        const label = combos
          .filter((a: unknown) => typeof a === "object" && a !== null)
          .map((a: unknown) => {
            const attr = a as Record<string, unknown>;
            const name = typeof attr.name === "string" ? attr.name : String(attr.name ?? "");
            const value = typeof attr.value === "string" ? attr.value : String(attr.value ?? "");
            return value ? `${name}: ${value}` : name;
          })
          .join(" / ");
        if (label) names.push(label);
      }
    }
  }
  return { total, out_of_stock, names };
}

/** Mês YYYY-MM válido; senão null. */
function clampMonth(s: unknown): string | null {
  if (typeof s !== "string") return null;
  if (!/^\d{4}-\d{2}$/.test(s)) return null;
  const mm = Number(s.slice(5, 7));
  if (mm < 1 || mm > 12) return null;
  return s;
}
