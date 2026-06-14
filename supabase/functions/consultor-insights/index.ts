/**
 * consultor-insights — Consultor v1 engine EF (Phase 45)
 *
 * AUTH DUAL STRATEGY (Pitfall 4 / T-45-06):
 *   verify_jwt = false in config.toml, but auth is enforced internally.
 *   - Bearer service_role_key  → mode all_orgs (cron, pg_cron Pattern B)
 *   - Bearer user JWT          → mode org_only (on-demand frontend, own org only)
 *   - Anything else            → 401 Unauthorized
 *
 * PITFALLS MITIGATED:
 *   P1: PostgREST 1000-line truncation → use get_consultor_* RPCs (SECURITY DEFINER SQL, no limit)
 *   P4: verify_jwt=false ≠ no auth → authenticate() enforces dual auth
 *   P5: ml_ads_campaigns_cache has no date column → ads_no_sale uses ml_ads_daily_cache (org-level)
 *   P6: ml_targets has no organization_id → join via ml_tokens; fallback = skip if no target
 *   P8: 150s Deno timeout → orgs serialized (not parallel), error isolation per org
 *
 * THREATS MITIGATED:
 *   T-45-06: anon invocation → authenticate() rejects without Bearer service_role OR valid JWT
 *   T-45-07: cross-org recalc → mode org_only validates is_org_member before running
 *   T-45-08: dismissed re-activation → upsert WHERE ml_user_id_key excludes dismissed rows
 *   T-45-09: ml_user_id enumeration → ml_tokens always filtered by org_id in scope
 *   T-45-10: DoS via all_orgs timeout → serialized loop with per-org try/catch
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").trim();
const SERVICE_KEY  = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Auth dual: service role (cron) + user JWT (on-demand frontend) ─────────────
// Returns: { userId: null } = service role authenticated
//          { userId: string } = valid user JWT
//          { error: Response } = unauthorized → caller returns this response

async function authenticate(req: Request): Promise<{ error: Response } | { userId: string | null }> {
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  // Fail CLOSED: se a service role key não estiver no ambiente, NÃO tratar o
  // chamador como cron (isso seria auth bypass / fail-open — classe do CR-01
  // da Phase 43). Sem a chave o servidor está mal configurado → 500, nunca
  // libera modo all_orgs.
  if (!svcKey) {
    return { error: new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    }) };
  }

  const auth = req.headers.get("authorization") ?? "";

  // Form 1: service role key (cron Pattern B, pg_cron vault)
  if (auth === "Bearer " + svcKey) return { userId: null };

  // Form 2: Bearer user JWT (frontend on-demand invocation)
  if (auth.startsWith("Bearer ") && auth !== "Bearer " + svcKey) {
    const sb = createClient(SUPABASE_URL, svcKey);
    const { data: authData } = await sb.auth.getUser(auth.replace("Bearer ", ""));
    if (authData?.user?.id) return { userId: authData.user.id };
  }

  return { error: new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { ...CORS, "Content-Type": "application/json" },
  }) };
}

// ── Default consultor config (fallback if no consultor_config row exists) ─────

interface ConsultorConfig {
  margin_critical_pct: number;
  margin_alert_pct: number;
  tacos_alert_pct: number;
  acos_alert_pct: number;
  roas_min: number;
  ads_no_sale_days: number;
  stock_critical_days: number;
  stock_alert_days: number;
  ticket_drop_pct: number;
  claims_spike_pct: number;
  goal_risk_pct: number;
  paused_ads_lookback_days: number;
  ads_eating_critical_pct: number;
  ads_eating_alert_pct: number;
}

const DEFAULT_CONFIG: ConsultorConfig = {
  margin_critical_pct: 0,
  margin_alert_pct: 10,
  tacos_alert_pct: 15,
  acos_alert_pct: 30,
  roas_min: 3,
  ads_no_sale_days: 7,
  stock_critical_days: 7,
  stock_alert_days: 15,
  ticket_drop_pct: 10,
  claims_spike_pct: 20,
  goal_risk_pct: 10,
  paused_ads_lookback_days: 30,
  ads_eating_critical_pct: 0,
  ads_eating_alert_pct: 10,
};

// ── Insight candidate type ─────────────────────────────────────────────────────

interface InsightCandidate {
  organization_id: string;
  ml_user_id: string | null;
  ml_user_id_key: string;       // '' for org-level; ml_user_id string for per-store
  rule_key: string;
  category: string;
  severity: string;             // 'critical' | 'high' | 'medium'
  title: string;
  body: string;
  action_label: string;
  action_href: string;
  impact_brl: number | null;
  status: string;
  updated_at: string;
}

// ── Helper: clamp a value to [min, max] ───────────────────────────────────────

function clamp(val: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, val));
}

// ── Helper: format currency ────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// ── Helper: truncate a list to first N and append "e mais X" ─────────────────

function listHead(items: string[], n = 3): string {
  if (items.length <= n) return items.join(", ");
  return items.slice(0, n).join(", ") + ` e mais ${items.length - n}`;
}

// ── runConsultorForOrg: the core engine for one org ───────────────────────────

async function runConsultorForOrg(
  sb: ReturnType<typeof createClient>,
  orgId: string,
  mlUserIds: string[],
  multiStore: boolean,
): Promise<{ insights_count: number; score: number }> {

  const now = new Date();
  const nowIso = now.toISOString();
  const today = now.toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);

  // ── (a) Load consultor_config; fallback to defaults ─────────────────────────

  const { data: cfgRow } = await sb
    .from("consultor_config")
    .select("*")
    .eq("organization_id", orgId)
    .maybeSingle();

  const cfg: ConsultorConfig = cfgRow ? { ...DEFAULT_CONFIG, ...cfgRow } : DEFAULT_CONFIG;

  const candidates: InsightCandidate[] = [];
  const activeRuleKeys: string[] = [];

  // ────────────────────────────────────────────────────────────────────────────
  // RULE 1 & 2: margin_critical / margin_alert
  // Via RPC get_consultor_margin_by_product (avoids PostgREST 1000-line truncation)
  // ────────────────────────────────────────────────────────────────────────────

  const marginFrom = thirtyDaysAgo;
  const marginTo = today;

  const { data: marginRows, error: marginErr } = await sb.rpc("get_consultor_margin_by_product", {
    p_org_id: orgId,
    p_user_ids: mlUserIds,
    p_from: marginFrom,
    p_to: marginTo,
  });

  if (!marginErr && marginRows && marginRows.length > 0) {
    const days = 30;

    // Rule 1: margin_critical (lucro_pct ≤ margin_critical_pct)
    const criticalItems = (marginRows as Array<{ item_id: string; receita: number; lucro: number; lucro_pct: number }>)
      .filter(r => r.lucro_pct !== null && r.lucro_pct <= cfg.margin_critical_pct);

    if (criticalItems.length > 0) {
      const totalLoss = criticalItems.reduce((s, r) => s + Math.abs(r.lucro), 0);
      const monthlyImpact = totalLoss * (30 / days);
      const titles = criticalItems.map(r => r.item_id);
      activeRuleKeys.push("margin_critical");
      candidates.push({
        organization_id: orgId,
        ml_user_id: null,
        ml_user_id_key: "",
        rule_key: "margin_critical",
        category: "Margem",
        severity: "critical",
        title: `${criticalItems.length} produto(s) vendendo no prejuízo`,
        body: `Os anúncios ${listHead(titles)} estão gerando lucro negativo. Você está perdendo ~R$ ${fmt(monthlyImpact)}/mês. Reveja o preço ou o custo cadastrado.`,
        action_label: "Ver anúncios",
        action_href: "/anuncios?items=" + criticalItems.map(r => r.item_id).slice(0, 100).join(","),
        impact_brl: Math.round(monthlyImpact),
        status: "active",
        updated_at: nowIso,
      });
    }

    // Rule 2: margin_alert (lucro_pct ≤ margin_alert_pct but > margin_critical_pct)
    const alertItems = (marginRows as Array<{ item_id: string; receita: number; lucro: number; lucro_pct: number }>)
      .filter(r => r.lucro_pct !== null && r.lucro_pct > cfg.margin_critical_pct && r.lucro_pct <= cfg.margin_alert_pct);

    if (alertItems.length > 0) {
      const potentialLoss = alertItems.reduce((s, r) => {
        const deficit = (cfg.margin_alert_pct - r.lucro_pct) * r.receita / 100;
        return s + deficit;
      }, 0);
      const monthlyImpact = potentialLoss * (30 / days);
      activeRuleKeys.push("margin_alert");
      candidates.push({
        organization_id: orgId,
        ml_user_id: null,
        ml_user_id_key: "",
        rule_key: "margin_alert",
        category: "Margem",
        severity: "high",
        title: `${alertItems.length} produto(s) com margem abaixo de ${cfg.margin_alert_pct}%`,
        body: `Margem abaixo da meta de ${cfg.margin_alert_pct}%. Potencial perda de ~R$ ${fmt(monthlyImpact)}/mês em receita não otimizada.`,
        action_label: "Ver anúncios",
        action_href: "/anuncios?items=" + alertItems.map(r => r.item_id).slice(0, 100).join(","),
        impact_brl: Math.round(monthlyImpact),
        status: "active",
        updated_at: nowIso,
      });
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // RULE ads_eating_margin: lucro operacional > 0 mas pós-ads ≤ limiar (MCO-04)
  // Separado de margin_critical (D-07): operacional pode ser positivo, ads zera a margem.
  // Usa mesma janela que RULE 1/2 (30 dias) e a RPC get_margin_with_ads_by_product (48-01).
  // Per-item: ml_user_id_key = item_id (Pitfall 3: não confundir com org-level).
  // ────────────────────────────────────────────────────────────────────────────

  const adsEatingCriticalPct = cfg.ads_eating_critical_pct ?? 0;
  const adsEatingAlertPct    = cfg.ads_eating_alert_pct ?? 10;

  const { data: marginWithAdsRows } = await sb.rpc("get_margin_with_ads_by_product", {
    p_org_id: orgId,
    p_user_ids: mlUserIds,
    p_from: marginFrom,
    p_to: marginTo,
  });

  if (marginWithAdsRows && (marginWithAdsRows as unknown[]).length > 0) {
    type MWARow = {
      item_id: string;
      receita: number;
      lucro: number;
      lucro_pct: number | null;
      ads_spend: number;
      lucro_pos_ads: number;
      lucro_pct_pos_ads: number | null;
    };
    const mwaRows = marginWithAdsRows as MWARow[];

    // Crítico: operacional positivo, mas pós-ads ≤ adsEatingCriticalPct (default 0%)
    const criticalAdsItems = mwaRows.filter(
      r => r.lucro > 0 && r.lucro_pct_pos_ads !== null && r.lucro_pct_pos_ads <= adsEatingCriticalPct
    );

    // Alerta: operacional positivo, pós-ads > crítico e ≤ adsEatingAlertPct (default 10%)
    const alertAdsItems = mwaRows.filter(
      r => r.lucro > 0 && r.lucro_pct_pos_ads !== null
        && r.lucro_pct_pos_ads > adsEatingCriticalPct
        && r.lucro_pct_pos_ads <= adsEatingAlertPct
    );

    const allEatingItems = [...criticalAdsItems, ...alertAdsItems];
    if (allEatingItems.length > 0) {
      // push a chave apenas uma vez por execução (o score usa includes, não count)
      activeRuleKeys.push("ads_eating_margin");

      for (const item of criticalAdsItems) {
        const erosao = item.lucro - item.lucro_pos_ads;
        candidates.push({
          organization_id: orgId,
          ml_user_id: null,
          ml_user_id_key: item.item_id,
          rule_key: "ads_eating_margin",
          category: "Ads",
          severity: "critical",
          title: "Publicidade zerando o lucro do produto",
          body: `O produto tem lucro operacional de ${(item.lucro_pct ?? 0).toFixed(1)}%, mas a publicidade está consumindo R$ ${fmt(erosao)} — a margem cai de ${(item.lucro_pct ?? 0).toFixed(1)}% para ${(item.lucro_pct_pos_ads ?? 0).toFixed(1)}%.`,
          action_label: "Ver anúncio",
          action_href: "/anuncios?items=" + item.item_id,
          impact_brl: Math.round(erosao),
          status: "active",
          updated_at: nowIso,
        });
      }

      for (const item of alertAdsItems) {
        const erosao = item.lucro - item.lucro_pos_ads;
        candidates.push({
          organization_id: orgId,
          ml_user_id: null,
          ml_user_id_key: item.item_id,
          rule_key: "ads_eating_margin",
          category: "Ads",
          severity: "high",
          title: "Publicidade reduzindo muito a margem do produto",
          body: `O produto tem lucro operacional de ${(item.lucro_pct ?? 0).toFixed(1)}%, mas a publicidade está consumindo R$ ${fmt(erosao)} — a margem cai de ${(item.lucro_pct ?? 0).toFixed(1)}% para ${(item.lucro_pct_pos_ads ?? 0).toFixed(1)}% (abaixo da meta de ${adsEatingAlertPct}%).`,
          action_label: "Ver anúncio",
          action_href: "/anuncios?items=" + item.item_id,
          impact_brl: Math.round(erosao),
          status: "active",
          updated_at: nowIso,
        });
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // RULE 3: ads_no_sale — spend > 0 AND attributed_orders = 0 por PRODUTO (MCO-05)
  // Upgrade: org-level (ml_ads_daily_cache) → item-level (ml_ads_products_cache)
  // D-10: substituir, não complementar. rule_key permanece "ads_no_sale" para
  // auto-resolver insights históricos org-level (ml_user_id_key="") via auto-resolver.
  // O índice único (organization_id, rule_key, ml_user_id_key) diferencia:
  //   - org-level antigo: ml_user_id_key=""  (será resolvido — não mais gerado)
  //   - item-level novo:  ml_user_id_key=item_id (gerado por produto)
  // Pitfall 6: ml_ads_products_cache pode ter ~6000 linhas/30 dias → paginação .range()
  // ────────────────────────────────────────────────────────────────────────────

  const adsNoSaleDays = cfg.ads_no_sale_days;
  const adsNoSaleFrom = new Date(now.getTime() - adsNoSaleDays * 86400000).toISOString().slice(0, 10);

  // Paginar ml_ads_products_cache para evitar truncamento PostgREST (1000 linhas)
  type AdsProductRow = { item_id: string; spend: number; attributed_orders: number; title: string | null };
  const allAdsProductRows: AdsProductRow[] = [];
  let apsOffset = 0;
  const PAGE = 1000;
  while (true) {
    const { data: page } = await sb
      .from("ml_ads_products_cache")
      .select("item_id, spend, attributed_orders, title")
      .eq("organization_id", orgId)
      .gte("date", adsNoSaleFrom)
      .lte("date", today)
      .range(apsOffset, apsOffset + PAGE - 1);
    const rows = (page ?? []) as AdsProductRow[];
    allAdsProductRows.push(...rows);
    if (rows.length < PAGE) break;
    apsOffset += PAGE;
  }

  if (allAdsProductRows.length > 0) {
    // Agregar no cliente por item_id
    const itemMap = new Map<string, { spend: number; attributed_orders: number; title: string }>();
    for (const r of allAdsProductRows) {
      const cur = itemMap.get(r.item_id) ?? { spend: 0, attributed_orders: 0, title: r.title ?? r.item_id };
      cur.spend += r.spend ?? 0;
      cur.attributed_orders += r.attributed_orders ?? 0;
      if (!cur.title && (r.title ?? "")) cur.title = r.title ?? r.item_id;
      itemMap.set(r.item_id, cur);
    }

    // Filtrar itens com gasto > 0 e zero vendas atribuídas
    const noSaleItems = [...itemMap.entries()].filter(([, v]) => v.spend > 0 && v.attributed_orders === 0);

    if (noSaleItems.length > 0) {
      activeRuleKeys.push("ads_no_sale");
      for (const [itemId, agg] of noSaleItems) {
        candidates.push({
          organization_id: orgId,
          ml_user_id: null,
          ml_user_id_key: itemId,
          rule_key: "ads_no_sale",
          category: "Ads",
          severity: "high",
          title: "Publicidade sem venda no produto",
          body: `O produto ${agg.title || itemId} gastou R$ ${fmt(agg.spend)} em publicidade nos últimos ${adsNoSaleDays} dias sem nenhuma venda atribuída. Revise as campanhas deste item.`,
          action_label: "Ver anúncio",
          action_href: "/anuncios?items=" + itemId,
          impact_brl: Math.round(agg.spend),
          status: "active",
          updated_at: nowIso,
        });
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // RULE 4: tacos_high — SUM(spend) / SUM(orders.receita_bruta) × 100 > threshold
  // Revenue is org-scoped: orders.receita_bruta (NOT ml_daily_cache.approved_revenue)
  // ────────────────────────────────────────────────────────────────────────────

  const { data: adsSpendRows } = await sb
    .from("ml_ads_daily_cache")
    .select("spend")
    .eq("organization_id", orgId)
    .gte("date", monthStart)
    .lte("date", today);

  const { data: ordersRevenueRows } = await sb
    .from("orders")
    .select("receita_bruta")
    .eq("organization_id", orgId)
    .in("status", ["paid", "shipped", "delivered"])
    .gte("data_pedido", monthStart + "T00:00:00Z")
    .lte("data_pedido", today + "T23:59:59Z");

  if (adsSpendRows && ordersRevenueRows) {
    const totalAdsSpend = (adsSpendRows as Array<{ spend: number }>).reduce((s, r) => s + (r.spend ?? 0), 0);
    const totalRevenue = (ordersRevenueRows as Array<{ receita_bruta: number }>).reduce((s, r) => s + (r.receita_bruta ?? 0), 0);

    if (totalAdsSpend > 0 && totalRevenue > 0) {
      const tacos = (totalAdsSpend / totalRevenue) * 100;
      if (tacos > cfg.tacos_alert_pct) {
        const daysSinceMonthStart = Math.max(1, Math.ceil((now.getTime() - new Date(monthStart).getTime()) / 86400000));
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const monthlyAdsSpendEstimate = totalAdsSpend * (daysInMonth / daysSinceMonthStart);
        const monthlyRevenueEstimate = totalRevenue * (daysInMonth / daysSinceMonthStart);
        const targetSpend = monthlyRevenueEstimate * cfg.tacos_alert_pct / 100;
        const excessSpend = Math.max(0, monthlyAdsSpendEstimate - targetSpend);
        activeRuleKeys.push("tacos_high");
        candidates.push({
          organization_id: orgId,
          ml_user_id: null,
          ml_user_id_key: "",
          rule_key: "tacos_high",
          category: "Ads",
          severity: "medium",
          title: `TACoS acima de ${cfg.tacos_alert_pct}% (está em ${tacos.toFixed(1)}%)`,
          body: `Para cada R$ ${fmt(totalRevenue)} vendido, R$ ${fmt(totalAdsSpend)} foi gasto em publicidade — acima do limite saudável de ${cfg.tacos_alert_pct}%. Risco de ~R$ ${fmt(excessSpend)}/mês.`,
          action_label: "Ver publicidade",
          action_href: "/publicidade",
          impact_brl: Math.round(excessSpend),
          status: "active",
          updated_at: nowIso,
        });
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // RULE 5: ads_efficiency — ACoS > threshold OR ROAS < minimum
  // Uses ml_ads_daily_cache aggregated for the current month
  // ────────────────────────────────────────────────────────────────────────────

  const { data: adsEffRows } = await sb
    .from("ml_ads_daily_cache")
    .select("spend, attributed_revenue")
    .eq("organization_id", orgId)
    .gte("date", monthStart)
    .lte("date", today);

  if (adsEffRows && adsEffRows.length > 0) {
    const effSpend = (adsEffRows as Array<{ spend: number; attributed_revenue: number }>)
      .reduce((s, r) => s + (r.spend ?? 0), 0);
    const effRev = (adsEffRows as Array<{ spend: number; attributed_revenue: number }>)
      .reduce((s, r) => s + (r.attributed_revenue ?? 0), 0);

    if (effSpend > 0 && effRev > 0) {
      const acos = (effSpend / effRev) * 100;
      const roas = effRev / effSpend;

      if (acos > cfg.acos_alert_pct || roas < cfg.roas_min) {
        activeRuleKeys.push("ads_efficiency");
        candidates.push({
          organization_id: orgId,
          ml_user_id: null,
          ml_user_id_key: "",
          rule_key: "ads_efficiency",
          category: "Ads",
          severity: "medium",
          title: `ROAS baixo (${roas.toFixed(1)}x) / ACoS alto (${acos.toFixed(1)}%)`,
          body: `Seu retorno sobre gasto com publicidade está abaixo do esperado este mês (ACoS ${acos.toFixed(1)}% vs meta ${cfg.acos_alert_pct}%; ROAS ${roas.toFixed(1)}x vs meta ${cfg.roas_min}x). Otimize suas campanhas.`,
          action_label: "Ver publicidade",
          action_href: "/publicidade",
          impact_brl: null,
          status: "active",
          updated_at: nowIso,
        });
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // RULES 6 & 7: stock_critical / stock_alert
  // Via RPC get_consultor_coverage (avoids PostgREST 1000-line truncation, D-05)
  // ────────────────────────────────────────────────────────────────────────────

  const { data: coverageRows, error: coverageErr } = await sb.rpc("get_consultor_coverage", {
    p_org_id: orgId,
    p_from: thirtyDaysAgo,
  });

  if (!coverageErr && coverageRows) {
    type CoverageRow = { item_id: string; title: string; price: number; coverage_days: number | null; avg_daily: number };
    const typedCoverage = coverageRows as CoverageRow[];

    // Rule 6: stock_critical (coverage_days < stock_critical_days AND avg_daily > 0)
    const criticalItems = typedCoverage.filter(
      r => r.coverage_days !== null && r.coverage_days < cfg.stock_critical_days && r.avg_daily > 0
    );

    if (criticalItems.length > 0) {
      const totalImpact = criticalItems.reduce((s, r) => {
        const daysToRupture = Math.max(0, (r.coverage_days ?? 0));
        const dailyRevenue = (r.avg_daily ?? 0) * (r.price ?? 0);
        // Impact = revenue at risk during the critical period until rupture
        return s + dailyRevenue * Math.max(1, cfg.stock_critical_days - daysToRupture);
      }, 0);

      const critTitles = criticalItems.slice(0, 3).map(r => r.title || r.item_id);
      activeRuleKeys.push("stock_critical");
      candidates.push({
        organization_id: orgId,
        ml_user_id: null,
        ml_user_id_key: "",
        rule_key: "stock_critical",
        category: "Estoque",
        severity: "critical",
        title: `${criticalItems.length} produto(s) com ruptura em ≤${cfg.stock_critical_days} dias`,
        body: `Os produtos ${listHead(critTitles)} têm estoque para menos de ${cfg.stock_critical_days} dias de vendas. Risco de ~R$ ${fmt(totalImpact)} em vendas perdidas.`,
        action_label: "Ver estoque",
        action_href: "/estoque?items=" + criticalItems.map(r => r.item_id).slice(0, 100).join(","),
        impact_brl: Math.round(totalImpact),
        status: "active",
        updated_at: nowIso,
      });
    }

    // Rule 7: stock_alert (coverage_days < stock_alert_days AND ≥ stock_critical_days)
    const alertItems = typedCoverage.filter(
      r => r.coverage_days !== null
        && r.coverage_days >= cfg.stock_critical_days
        && r.coverage_days < cfg.stock_alert_days
        && r.avg_daily > 0
    );

    if (alertItems.length > 0) {
      const alertTitles = alertItems.slice(0, 3).map(r => r.title || r.item_id);
      activeRuleKeys.push("stock_alert");
      candidates.push({
        organization_id: orgId,
        ml_user_id: null,
        ml_user_id_key: "",
        rule_key: "stock_alert",
        category: "Estoque",
        severity: "high",
        title: `${alertItems.length} produto(s) com cobertura baixa (${cfg.stock_critical_days}-${cfg.stock_alert_days} dias)`,
        body: `Os produtos ${listHead(alertTitles)} têm cobertura de ${cfg.stock_critical_days} a ${cfg.stock_alert_days} dias. Reposição urgente recomendada para evitar ruptura.`,
        action_label: "Ver estoque",
        action_href: "/estoque?items=" + alertItems.map(r => r.item_id).slice(0, 100).join(","),
        impact_brl: null,
        status: "active",
        updated_at: nowIso,
      });
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // RULE 8: no_cost — products without registered cost (no CMV)
  // Via RPC get_consultor_no_cost_count
  // ────────────────────────────────────────────────────────────────────────────

  const { data: noCostCount, error: noCostErr } = await sb.rpc("get_consultor_no_cost_count", {
    p_org_id: orgId,
  });

  if (!noCostErr && noCostCount && noCostCount > 0) {
    activeRuleKeys.push("no_cost");
    candidates.push({
      organization_id: orgId,
      ml_user_id: null,
      ml_user_id_key: "",
      rule_key: "no_cost",
      category: "Config",
      severity: "medium",
      title: `${noCostCount} produto(s) sem custo cadastrado`,
      body: `Sem CMV cadastrado, a margem não pode ser calculada. Você pode estar vendendo no prejuízo sem saber.`,
      action_label: "Cadastrar custos",
      action_href: "/precificacao",
      impact_brl: null,
      status: "active",
      updated_at: nowIso,
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // RULE 9: no_fiscal — no fiscal regime configured
  // Source: ml_tax_config by organization_id
  // ────────────────────────────────────────────────────────────────────────────

  const { data: fiscalRows } = await sb
    .from("ml_tax_config")
    .select("id")
    .eq("organization_id", orgId)
    .limit(1);

  if (!fiscalRows || fiscalRows.length === 0) {
    activeRuleKeys.push("no_fiscal");
    candidates.push({
      organization_id: orgId,
      ml_user_id: null,
      ml_user_id_key: "",
      rule_key: "no_fiscal",
      category: "Config",
      severity: "high",
      title: "Regime fiscal não configurado",
      body: "Sem regime tributário configurado, os impostos podem estar sendo subestimados no relatório de margem.",
      action_label: "Configurar fiscal",
      action_href: "/fiscal",
      impact_brl: null,
      status: "active",
      updated_at: nowIso,
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // RULE 10: ticket_drop — ticket médio caindo mês × mês
  // Source: orders.receita_bruta (org-scoped, D-07)
  // ────────────────────────────────────────────────────────────────────────────

  const { data: ticketCurRows } = await sb
    .from("orders")
    .select("receita_bruta")
    .eq("organization_id", orgId)
    .in("status", ["paid", "shipped", "delivered"])
    .gte("data_pedido", monthStart + "T00:00:00Z")
    .lte("data_pedido", today + "T23:59:59Z");

  const { data: ticketPrevRows } = await sb
    .from("orders")
    .select("receita_bruta")
    .eq("organization_id", orgId)
    .in("status", ["paid", "shipped", "delivered"])
    .gte("data_pedido", prevMonthStart + "T00:00:00Z")
    .lte("data_pedido", prevMonthEnd + "T23:59:59Z");

  if (ticketCurRows && ticketPrevRows && ticketCurRows.length > 0 && ticketPrevRows.length > 0) {
    const curRevenue = (ticketCurRows as Array<{ receita_bruta: number }>).reduce((s, r) => s + (r.receita_bruta ?? 0), 0);
    const prevRevenue = (ticketPrevRows as Array<{ receita_bruta: number }>).reduce((s, r) => s + (r.receita_bruta ?? 0), 0);
    const curTicket = curRevenue / ticketCurRows.length;
    const prevTicket = prevRevenue / ticketPrevRows.length;

    if (prevTicket > 0 && curTicket < prevTicket * (1 - cfg.ticket_drop_pct / 100)) {
      const dropPct = ((prevTicket - curTicket) / prevTicket * 100).toFixed(1);
      const impact = (prevTicket - curTicket) * ticketCurRows.length;
      activeRuleKeys.push("ticket_drop");
      candidates.push({
        organization_id: orgId,
        ml_user_id: null,
        ml_user_id_key: "",
        rule_key: "ticket_drop",
        category: "Vendas",
        severity: "medium",
        title: "Ticket médio caindo mês a mês",
        body: `Seu ticket médio caiu de R$ ${fmt(prevTicket)} para R$ ${fmt(curTicket)} (-${dropPct}%). Impacto estimado de ~R$ ${fmt(impact)}/mês.`,
        action_label: "Ver vendas",
        action_href: "/",
        impact_brl: Math.round(impact),
        status: "active",
        updated_at: nowIso,
      });
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // RULE 11: claims_spike — cancelamentos aumentaram +20% mês × mês
  // Source: ml_claims by organization_id (D-07)
  // ────────────────────────────────────────────────────────────────────────────

  const { data: claimsCurRows } = await sb
    .from("ml_claims")
    .select("id")
    .eq("organization_id", orgId)
    .gte("data_abertura", monthStart)
    .lte("data_abertura", today);

  const { data: claimsPrevRows } = await sb
    .from("ml_claims")
    .select("id")
    .eq("organization_id", orgId)
    .gte("data_abertura", prevMonthStart)
    .lte("data_abertura", prevMonthEnd);

  if (claimsCurRows !== null && claimsPrevRows !== null) {
    const curCount = claimsCurRows.length;
    const prevCount = claimsPrevRows.length;

    if (prevCount > 0 && curCount > prevCount * (1 + cfg.claims_spike_pct / 100)) {
      const increasePct = ((curCount - prevCount) / prevCount * 100).toFixed(0);
      activeRuleKeys.push("claims_spike");
      candidates.push({
        organization_id: orgId,
        ml_user_id: null,
        ml_user_id_key: "",
        rule_key: "claims_spike",
        category: "Reputação",
        severity: "medium",
        title: `Cancelamentos aumentaram ${increasePct}% no mês`,
        body: `O número de cancelamentos subiu de ${prevCount} para ${curCount} este mês. Verifique as causas para proteger sua reputação.`,
        action_label: "Ver devoluções",
        action_href: "/devolucoes",
        impact_brl: null,
        status: "active",
        updated_at: nowIso,
      });
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // RULE 12: paused_with_sales — anúncios pausados com histórico de venda
  // Via RPC get_consultor_paused_with_sales (avoids PostgREST truncation, D-08)
  // ────────────────────────────────────────────────────────────────────────────

  const pausedFrom = new Date(now.getTime() - cfg.paused_ads_lookback_days * 86400000).toISOString().slice(0, 10);

  const { data: pausedRows, error: pausedErr } = await sb.rpc("get_consultor_paused_with_sales", {
    p_org_id: orgId,
    p_from: pausedFrom,
  });

  if (!pausedErr && pausedRows && (pausedRows as Array<unknown>).length > 0) {
    type PausedRow = { item_id: string; title: string; price: number; vendas_30d: number };
    const typedPaused = pausedRows as PausedRow[];
    const totalImpact = typedPaused.reduce((s, r) => s + (r.vendas_30d ?? 0) * (r.price ?? 0), 0);
    const pausedTitles = typedPaused.slice(0, 3).map(r => r.title || r.item_id);
    activeRuleKeys.push("paused_with_sales");
    candidates.push({
      organization_id: orgId,
      ml_user_id: null,
      ml_user_id_key: "",
      rule_key: "paused_with_sales",
      category: "Ads",
      severity: "high",
      title: `${typedPaused.length} anúncio(s) pausado(s) com histórico de venda`,
      body: `Os anúncios ${listHead(pausedTitles)} venderam nos últimos ${cfg.paused_ads_lookback_days} dias mas estão pausados. Receita em risco: ~R$ ${fmt(totalImpact)}/mês.`,
      action_label: "Ver anúncios",
      action_href: "/anuncios?items=" + typedPaused.map(r => r.item_id).slice(0, 100).join(","),
      impact_brl: Math.round(totalImpact),
      status: "active",
      updated_at: nowIso,
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // RULE 13: goal_at_risk — meta do mês em risco por run-rate
  // Source: orders.receita_bruta + ml_targets JOIN ml_tokens (Pitfall 6)
  // Fallback: skip if no target for this org
  // ────────────────────────────────────────────────────────────────────────────

  // Get user_ids for this org via ml_tokens (needed for ml_targets join)
  const { data: tokenRows } = await sb
    .from("ml_tokens")
    .select("ml_user_id, user_id")
    .eq("organization_id", orgId)
    .not("refresh_token", "is", null);

  if (tokenRows && tokenRows.length > 0) {
    const mlUserIdsForOrg = (tokenRows as Array<{ ml_user_id: string; user_id: string }>)
      .map(r => r.ml_user_id);
    const userIdsForOrg = [...new Set((tokenRows as Array<{ ml_user_id: string; user_id: string }>)
      .map(r => r.user_id))];

    const curYear = now.getFullYear();
    const curMonth = now.getMonth() + 1;

    // Fetch targets for this org (join via ml_user_id = seller_id and user_id)
    const { data: targetRows } = await sb
      .from("ml_targets")
      .select("target_value, seller_id, user_id")
      .in("seller_id", mlUserIdsForOrg)
      .in("user_id", userIdsForOrg)
      .eq("year", curYear)
      .eq("month", curMonth);

    if (targetRows && targetRows.length > 0) {
      const metaTotal = (targetRows as Array<{ target_value: number }>)
        .reduce((s, r) => s + (r.target_value ?? 0), 0);

      if (metaTotal > 0) {
        // Revenue accumulated this month (org-scoped via orders.receita_bruta)
        const { data: goalRevRows } = await sb
          .from("orders")
          .select("receita_bruta")
          .eq("organization_id", orgId)
          .in("status", ["paid", "shipped", "delivered"])
          .gte("data_pedido", monthStart + "T00:00:00Z")
          .lte("data_pedido", today + "T23:59:59Z");

        if (goalRevRows) {
          const receitaAcumulada = (goalRevRows as Array<{ receita_bruta: number }>)
            .reduce((s, r) => s + (r.receita_bruta ?? 0), 0);

          const diasDecorridos = Math.max(1, now.getDate());
          const diasDoMes = new Date(curYear, curMonth, 0).getDate();
          const projecao = (receitaAcumulada / diasDecorridos) * diasDoMes;
          const threshold = metaTotal * (1 - cfg.goal_risk_pct / 100);

          if (projecao < threshold) {
            const diasRestantes = diasDoMes - now.getDate();
            const deficit = metaTotal - projecao;
            activeRuleKeys.push("goal_at_risk");
            candidates.push({
              organization_id: orgId,
              ml_user_id: null,
              ml_user_id_key: "",
              rule_key: "goal_at_risk",
              category: "Vendas",
              severity: "high",
              title: "Meta do mês em risco",
              body: `No ritmo atual, a projeção é R$ ${fmt(projecao)} — ${((deficit / metaTotal) * 100).toFixed(0)}% abaixo da meta de R$ ${fmt(metaTotal)}. Faltam ${diasRestantes} dias.`,
              action_label: "Ver metas",
              action_href: "/metas",
              impact_brl: Math.round(deficit),
              status: "active",
              updated_at: nowIso,
            });
          }
        }
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // RULE 14: questions_old — perguntas sem resposta > 24h
  // Source: ml_questions (organization_id, status, data_pergunta)
  // ────────────────────────────────────────────────────────────────────────────

  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 3600000).toISOString();

  const { data: questionsRows } = await sb
    .from("ml_questions")
    .select("id")
    .eq("organization_id", orgId)
    .eq("status", "UNANSWERED")
    .lte("data_pergunta", twentyFourHoursAgo);

  if (questionsRows && questionsRows.length > 0) {
    const qCount = questionsRows.length;
    activeRuleKeys.push("questions_old");
    candidates.push({
      organization_id: orgId,
      ml_user_id: null,
      ml_user_id_key: "",
      rule_key: "questions_old",
      category: "Reputação",
      severity: qCount > 5 ? "critical" : "high",
      title: `${qCount} pergunta(s) sem resposta há mais de 24h`,
      body: "Perguntas sem resposta afetam sua reputação e as chances de venda. Responda agora.",
      action_label: "Ver perguntas",
      action_href: "/perguntas",
      impact_brl: null,
      status: "active",
      updated_at: nowIso,
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // (b) Calculate score 0-100 per pillar (D-09: Margem 30, Ads 25, Estoque 20, Reputação 15, Completude 10)
  // ────────────────────────────────────────────────────────────────────────────

  // Pilar Margem (30)
  let notaMargem = 100;
  if (marginRows && marginRows.length > 0) {
    type MarginRow = { lucro_pct: number };
    const typed = marginRows as MarginRow[];
    const total = typed.length;
    const emPrejuizo = typed.filter(r => r.lucro_pct !== null && r.lucro_pct <= 0).length;
    const mediaLucro = typed.reduce((s, r) => s + (r.lucro_pct ?? 0), 0) / total;
    notaMargem = clamp(Math.round(100 - (emPrejuizo / total) * 100 * 2 - Math.max(0, cfg.margin_alert_pct - mediaLucro) * 3));
  }

  // Pilar Ads (25)
  let notaAds = 100;
  if (adsSpendRows && adsSpendRows.length > 0 && ordersRevenueRows && ordersRevenueRows.length > 0) {
    const totalSpendAds = (adsSpendRows as Array<{ spend: number }>).reduce((s, r) => s + (r.spend ?? 0), 0);
    const totalRevAds = (ordersRevenueRows as Array<{ receita_bruta: number }>).reduce((s, r) => s + (r.receita_bruta ?? 0), 0);
    if (totalSpendAds > 0 && totalRevAds > 0) {
      const tacosVal = (totalSpendAds / totalRevAds) * 100;
      const tacosOver15 = Math.max(0, tacosVal - cfg.tacos_alert_pct);
      const hasCampanhaSemVenda = activeRuleKeys.includes("ads_no_sale");
      const hasErosaoAds = activeRuleKeys.includes("ads_eating_margin");
      notaAds = clamp(Math.round(
        100
        - tacosOver15 * 5
        - (hasCampanhaSemVenda ? 20 : 0)
        - (hasErosaoAds ? 15 : 0)
      ));
    }
  }

  // Pilar Estoque (20)
  let notaEstoque = 100;
  if (coverageRows && (coverageRows as Array<unknown>).length > 0) {
    type CovRow = { coverage_days: number | null; avg_daily: number };
    const typedCov = coverageRows as CovRow[];
    const totalItems = typedCov.length;
    const ruptura = typedCov.filter(r => r.coverage_days !== null && r.coverage_days <= 0 && r.avg_daily > 0).length;
    const critico = typedCov.filter(r => r.coverage_days !== null && r.coverage_days > 0 && r.coverage_days < cfg.stock_critical_days && r.avg_daily > 0).length;
    const alerta = typedCov.filter(r => r.coverage_days !== null && r.coverage_days >= cfg.stock_critical_days && r.coverage_days < cfg.stock_alert_days && r.avg_daily > 0).length;
    if (totalItems > 0) {
      notaEstoque = clamp(Math.round(100 - (ruptura / totalItems) * 100 - (critico / totalItems) * 50 - (alerta / totalItems) * 20));
    }
  }

  // Pilar Reputação (15) — proxy via ml_claims taxa de cancelamentos (sem chamada à API ML)
  let notaReputacao = 100;
  if (claimsCurRows !== null) {
    const { data: ordersCountRows } = await sb
      .from("orders")
      .select("id")
      .eq("organization_id", orgId)
      .not("status", "in", '("cancelled")')
      .gte("data_pedido", thirtyDaysAgo + "T00:00:00Z")
      .lte("data_pedido", today + "T23:59:59Z");

    const totalOrders30d = ordersCountRows ? ordersCountRows.length : 0;
    if (totalOrders30d > 0) {
      const cancRate = claimsCurRows.length / totalOrders30d;
      notaReputacao = clamp(Math.round(100 - cancRate * 500));
    }
    // Also penalize questions > 24h
    if (questionsRows && questionsRows.length > 0) {
      notaReputacao = clamp(notaReputacao - Math.min(20, questionsRows.length * 2));
    }
  }

  // Pilar Completude (10) — via onboarding_progress (D-11)
  let notaCompletude = 100;
  const { data: onboardingRow } = await sb
    .from("onboarding_progress")
    .select("completed_steps")
    .eq("organization_id", orgId)
    .maybeSingle();

  if (onboardingRow) {
    const completedSteps: string[] = (onboardingRow as { completed_steps: string[] }).completed_steps ?? [];
    const requiredSteps = ["connect_ml", "costs", "fiscal"];
    const completedRequired = requiredSteps.filter(s => completedSteps.includes(s)).length;
    notaCompletude = Math.round((completedRequired / requiredSteps.length) * 100);
  } else {
    notaCompletude = 0; // No progress tracked = 0%
  }

  // Score final ponderado (D-09)
  const scoreMargin  = clamp(notaMargem);
  const scoreAds     = clamp(notaAds);
  const scoreEstoque = clamp(notaEstoque);
  const scoreRep     = clamp(notaReputacao);
  const scoreComp    = clamp(notaCompletude);

  const score = Math.round(
    scoreMargin  * 0.30 +
    scoreAds     * 0.25 +
    scoreEstoque * 0.20 +
    scoreRep     * 0.15 +
    scoreComp    * 0.10
  );

  // ────────────────────────────────────────────────────────────────────────────
  // (e) Upsert insights idempotently — NEVER overwrite dismissed rows (T-45-08)
  // onConflict: organization_id, rule_key, ml_user_id_key
  // The insights table has a UNIQUE INDEX on these 3 columns (from Plan 01)
  // ────────────────────────────────────────────────────────────────────────────

  if (candidates.length > 0) {
    // Filter out dismissed insights before upserting (T-45-08: dismissed must never be re-activated)
    const { data: dismissedRows } = await sb
      .from("insights")
      .select("rule_key, ml_user_id_key")
      .eq("organization_id", orgId)
      .eq("status", "dismissed");

    const dismissedSet = new Set(
      (dismissedRows ?? []).map((r: { rule_key: string; ml_user_id_key: string }) =>
        `${r.rule_key}::${r.ml_user_id_key}`
      )
    );

    const upsertable = candidates.filter(
      c => !dismissedSet.has(`${c.rule_key}::${c.ml_user_id_key}`)
    );

    if (upsertable.length > 0) {
      const { error: upsertErr } = await sb
        .from("insights")
        .upsert(upsertable, {
          onConflict: "organization_id,rule_key,ml_user_id_key",
        });

      if (upsertErr) {
        console.error(`consultor-insights upsert error org=${orgId}:`, upsertErr.message);
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // (f) Auto-resolve: mark active insights as resolved if their rule did NOT fire
  // Never touch dismissed rows (T-45-08)
  // ────────────────────────────────────────────────────────────────────────────

  if (activeRuleKeys.length > 0) {
    await sb
      .from("insights")
      .update({ status: "resolved", resolved_at: nowIso })
      .eq("organization_id", orgId)
      .eq("status", "active")
      .not("rule_key", "in", `(${activeRuleKeys.map(k => `"${k}"`).join(",")})`);
  } else {
    // No rules fired: resolve all active insights
    await sb
      .from("insights")
      .update({ status: "resolved", resolved_at: nowIso })
      .eq("organization_id", orgId)
      .eq("status", "active");
  }

  // ────────────────────────────────────────────────────────────────────────────
  // (g) Upsert monthly snapshot in consultor_health_snapshots
  // One snapshot per (organization_id, snapshot_month) = YYYY-MM
  // ────────────────────────────────────────────────────────────────────────────

  const snapshotMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const insightsTotal = candidates.length;
  const insightsCritical = candidates.filter(c => c.severity === "critical").length;

  await sb
    .from("consultor_health_snapshots")
    .upsert({
      organization_id: orgId,
      score,
      score_margin: scoreMargin,
      score_ads: scoreAds,
      score_estoque: scoreEstoque,
      score_reputacao: scoreRep,
      score_completude: scoreComp,
      insights_total: insightsTotal,
      insights_critical: insightsCritical,
      snapshot_month: snapshotMonth,
      created_at: nowIso,
    }, {
      onConflict: "organization_id,snapshot_month",
    });

  return { insights_count: insightsTotal, score };
}

// ── Main server handler ────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const authResult = await authenticate(req);
  if ("error" in authResult) return authResult.error;

  let body: { mode?: string; org_id?: string } = {};
  try { body = await req.json(); } catch { body = {}; }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── Mode: all_orgs (service role / cron) ─────────────────────────────────

  if (authResult.userId === null) {
    // Cron mode: process all orgs with valid ml_tokens (P8: serialize, not parallel)
    const { data: orgRows, error: orgErr } = await sb
      .from("ml_tokens")
      .select("organization_id, ml_user_id")
      .not("refresh_token", "is", null);

    if (orgErr) {
      console.error("consultor-insights: failed to list orgs:", orgErr.message);
      return json({ ok: false, error: orgErr.message }, 500);
    }

    // Group ml_user_ids by organization_id
    const orgMap = new Map<string, string[]>();
    for (const row of (orgRows ?? []) as Array<{ organization_id: string; ml_user_id: string }>) {
      if (!row.organization_id) continue;
      const existing = orgMap.get(row.organization_id) ?? [];
      existing.push(row.ml_user_id);
      orgMap.set(row.organization_id, existing);
    }

    const results: Array<{ organization_id: string; insights_count?: number; score?: number; error?: string }> = [];

    // Serialize per org (T-45-10: timeout mitigation)
    for (const [orgId, mlUserIds] of orgMap) {
      try {
        const multiStore = mlUserIds.length > 1;
        const result = await runConsultorForOrg(sb, orgId, mlUserIds, multiStore);
        results.push({ organization_id: orgId, ...result });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`consultor-insights org=${orgId} error:`, msg);
        results.push({ organization_id: orgId, error: msg });
      }
    }

    return json({ ok: true, mode: "all_orgs", results });
  }

  // ── Mode: org_only (user JWT, on-demand) ──────────────────────────────────

  // Resolve the org for this user
  const { data: memberRows } = await sb
    .from("org_members")
    .select("organization_id")
    .eq("user_id", authResult.userId)
    .limit(1);

  const orgId = (memberRows as Array<{ organization_id: string }> | null)?.[0]?.organization_id ?? body.org_id;

  if (!orgId) {
    return json({ error: "Could not determine organization for user" }, 400);
  }

  // Validate org membership (T-45-07: prevent cross-org recalc)
  const { data: isMember } = await sb.rpc("is_org_member", {
    _user_id: authResult.userId,
    _org_id: orgId,
  });

  if (!isMember) {
    return json({ error: "Forbidden" }, 403);
  }

  // Get ml_user_ids for this org
  const { data: tokenRows } = await sb
    .from("ml_tokens")
    .select("ml_user_id")
    .eq("organization_id", orgId)
    .not("refresh_token", "is", null);

  const mlUserIds = (tokenRows as Array<{ ml_user_id: string }> | null)?.map(r => r.ml_user_id) ?? [];

  try {
    const multiStore = mlUserIds.length > 1;
    const result = await runConsultorForOrg(sb, orgId, mlUserIds, multiStore);
    return json({ ok: true, mode: "org_only", organization_id: orgId, ...result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`consultor-insights org_only org=${orgId} error:`, msg);
    return json({ ok: false, error: msg }, 500);
  }
});
