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
 *   get_dre_monthly       → table ml_billing_monthly (.eq org, .in ml_user_id)
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
      "DRE consolidado do período (receita, CMV, comissão, frete, impostos, lucro, lucro_pct, pedidos, ticket médio). Use para visão geral de lucratividade.",
    parameters: { type: "object", properties: { ...DATE_PROPS } },
  },
  {
    name: "get_day_kpis",
    description:
      "Waterfall de custo/receita do período (paid_revenue, cmv, comissão, frete, imposto, pedidos). Use para MCO/receita do dia e composição de custo.",
    parameters: { type: "object", properties: { ...DATE_PROPS } },
  },
  {
    name: "get_coverage",
    description:
      "Cobertura de estoque (dias) e venda média diária por SKU. Use para ruptura, estoque crítico, runway de estoque.",
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
      "Gasto/ROAS/CTR/CPC por item no período (publicidade). Use para performance de ads por produto, ACoS/TACoS, ads sem venda.",
    parameters: { type: "object", properties: { ...DATE_PROPS } },
  },
  {
    name: "get_dre_monthly",
    description:
      "Fatura ML do mês (CFFE, CFONPN, total de cobranças). Use para custos fixos do ML, fatura do mês de fechamento.",
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
      "Projeção FUTURA de fluxo de caixa (entradas/saídas/saldo diário e acumulado), padrão próximos 90 dias. Use para 'meu caixa vai ficar negativo?', liquidez, quando o dinheiro cai/sai, projeção de caixa.",
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
      "KPIs de vendas do período: faturamento, nº de pedidos, ticket médio, unidades. Use para 'quanto vendi', faturamento, volume de vendas.",
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
      "Custos/DRE por mês (vários meses). Use para tendência de custos e fatura ML mês a mês.",
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
      "Estoque atual por anúncio: quantidade disponível, vendida, preço, saúde do anúncio, visitas, marca. Use para 'quanto tenho em estoque', estoque/situação de um produto específico (passe 'search'), anúncios ativos/pausados.",
    parameters: {
      type: "object",
      properties: { search: { type: "string", description: "Filtra por texto no título ou SKU do produto (opcional)" } },
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
      "Campanhas de publicidade no nível CAMPANHA: status, orçamento diário, gasto, receita atribuída, ROAS. Use para visão por campanha (diferente de ads por produto).",
    parameters: { type: "object", properties: {} },
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
      // PROJEÇÃO FUTURA: caixa é forward-looking → default hoje → +90d
      // (a janela genérica de -30d→hoje devolvia ~0 linhas e o modelo concluía
      // que não havia dados / "não configurado").
      const cfFrom = clampDate(args.from) ?? today();
      const cfTo = clampDate(args.to) ?? daysAhead(90);
      const { data } = await sb.rpc("get_cashflow", {
        p_org_id: orgId, p_start_date: cfFrom, p_end_date: cfTo,
      });
      return cap(data ?? []);
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
      return cap(data ?? []);
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
      const pm = clampMonth(args.period_month) ?? today().slice(0, 7);
      const { data } = await sb
        .from("ml_billing_monthly")
        .select("ml_user_id,period_month,resumo")
        .eq("organization_id", orgId)
        .in("ml_user_id", mlUserIds)
        .eq("period_month", pm)
        .limit(MAX_ROWS);
      return cap(data ?? []);
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
      let q = sb.from("ml_inventory_cache")
        .select("item_id,title,status,available_quantity,sold_quantity,price,health,visits,brand,seller_custom_field")
        .eq("organization_id", orgId);
      if (mlUserIds.length) q = q.in("ml_user_id", mlUserIds);
      // sanitiza o search: remove caracteres especiais do filtro PostgREST/ilike
      const raw = typeof args.search === "string" ? args.search : "";
      const safe = raw.replace(/[%,()*\\]/g, "").trim().slice(0, 60);
      if (safe) q = q.or(`title.ilike.%${safe}%,seller_custom_field.ilike.%${safe}%`);
      q = q.order("available_quantity", { ascending: true }).limit(MAX_ROWS);
      const { data } = await q;
      return cap(data ?? []);
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
      let q = sb.from("ml_ads_campaigns_cache")
        .select("name,status,daily_budget,impressions,clicks,spend,attributed_revenue,attributed_orders,cpc,ctr,roas")
        .eq("organization_id", orgId);
      if (mlUserIds.length) q = q.in("ml_user_id", mlUserIds);
      const { data } = await q.order("spend", { ascending: false }).limit(MAX_ROWS);
      return cap(data ?? []);
    }

    default:
      return { error: "unknown_tool" };
  }
}

/** Mês YYYY-MM válido; senão null. */
function clampMonth(s: unknown): string | null {
  if (typeof s !== "string") return null;
  if (!/^\d{4}-\d{2}$/.test(s)) return null;
  const mm = Number(s.slice(5, 7));
  if (mm < 1 || mm > 12) return null;
  return s;
}
