/**
 * tools.ts — function-calling read-only do Nexo (Plan 57-02).
 *
 * Duas exportações:
 *   - TOOL_DECLARATIONS: function declarations no formato Gemini. NENHUMA declara
 *     org_id/seller_id/ml_user_id como parâmetro — o modelo NÃO escolhe org/loja.
 *     Só aceitam datas opcionais (from/to YYYY-MM-DD) onde a RPC suporta.
 *   - dispatchTool(sb, orgId, mlUserIds, name, args): mapeia cada tool à RPC/tabela
 *     REAL existente (ckcdevcxgvueywivefgx), SEMPRE injetando p_org_id=orgId (do JWT)
 *     e p_user_ids=mlUserIds (derivado server-side de ml_tokens). Qualquer
 *     args.org_id/args.seller_id/args.ml_user_id vindo do modelo é IGNORADO.
 *
 * ANTI-IDOR (T-57-07/08): orgId e mlUserIds são parâmetros do SERVIDOR; args só
 * influenciam datas (com clamp/default). Selects diretos via service_role bypassam
 * RLS → .eq('organization_id', orgId) (+ .in('ml_user_id', mlUserIds)) é obrigatório.
 *
 * Read-only (T-57-12): só rpc()/select(). NENHUMA mutação. Cap de 50 linhas/tool
 * (T-57-09) para conter tokens/custo do functionResponse.
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
      "Margem/MCO e ads por SKU da conta no período. Use para lucro por produto, produtos no prejuízo, ads comendo margem, ranking de margem.",
    parameters: { type: "object", properties: { ...DATE_PROPS } },
  },
  {
    name: "get_margin_summary",
    description:
      "DRE consolidado do período (receita de pedidos PAGOS, CMV, comissão, frete, impostos, lucro, lucro_pct, pedidos, ticket médio). " +
      "Receita aqui é de pedidos PAGOS — pode divergir levemente do card 'Receita Total' do painel /vendas (que usa ml_daily_cache com escopo levemente diferente). " +
      "Use para visão geral de lucratividade. Pedidos com status partially_refunded (~21) podem não estar incluídos no total (alinhado ao painel atual).",
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
      "Perguntas de compradores SEM resposta (mais recentes). Use para 'tenho perguntas pendentes?', dúvidas de clientes a responder.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_claims",
    description:
      "Reclamações / devoluções / mediações (mais recentes). Use para pós-venda, reclamações abertas, devoluções, prazos de resposta.",
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
];

// ── dispatcher escopado (anti-IDOR) ──────────────────────────────────────────
export async function dispatchTool(
  sb: SupabaseClient,
  orgId: string,
  mlUserIds: string[],
  name: string,
  args: Record<string, unknown>,
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
      const { data } = await sb
        .from("consultor_health_snapshots")
        .select("score,score_margin,score_ads,score_estoque,score_reputacao,score_completude,created_at")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
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
      let q = sb.from("ml_claims")
        .select("claim_id,tipo,status,motivo,data_abertura,data_limite,solucao")
        .eq("organization_id", orgId);
      if (mlUserIds.length) q = q.in("ml_user_id", mlUserIds);
      const { data } = await q.order("data_abertura", { ascending: false }).limit(MAX_ROWS);
      return cap(data ?? []);
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
