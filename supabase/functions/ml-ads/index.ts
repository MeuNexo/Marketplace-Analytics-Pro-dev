// ml-ads — leitura das caches de publicidade para a tela /publicidade.
//
// Phase 221: esta função virou SOMENTE-LEITURA. Achado do planejamento: ela
// era um SEGUNDO escritor de ml_ads_daily_cache e ml_ads_products_cache,
// somando linha a linha a rota legada /product_ads/items — a régua ERRADA em
// dois sentidos ao mesmo tempo (soma duplicada, o bug da Fase 219; nível de
// anúncio em vez de campanha, o bug da Fase 221). Se essa rota ainda
// respondesse, sobrescreveria o total corrigido pelo sync-ads — mesma forma
// do problema que a Fase 220 levou 58 dias para achar (um segundo escritor
// regravando o campo já consertado).
//
// O escritor único destas duas tabelas é `sync-ads` (product_ads/campaigns/search
// para o total diário, product_ads/ads/search para a quebra por produto — ver
// supabase/functions/sync-ads/aggregate.ts). Uma tabela que alimenta o MCO
// precisa de escritor único, com a régua provada contra o painel do ML.
//
// Efeitos práticos desta mudança, registrados aqui e no SUMMARY do plano
// 221-01:
// - O botão de sincronizar da tela `/publicidade` (useMLAds.syncNow) passa a
//   ser uma RELEITURA do cache, não mais um gatilho de sync. Isso não é perda
//   de função: a sincronização em background já não refletia na mesma
//   requisição (a resposta saía antes do `EdgeRuntime.waitUntil` terminar) —
//   quem de fato alimenta as duas tabelas é o cron de `sync-ads`, 4x ao dia.
// - `ml_ads_campaigns_cache` continua sendo escrito só pelo `sync-ads`, com
//   métricas zeradas (é metadado: nome, status, orçamento — o endpoint de
//   campanhas usado por `sync-ads` para metadado não pede `metrics_summary`).
//   Isso já era o estado de hoje: `sync-ads` apaga e reescreve essa tabela a
//   cada rodada e sempre venceria a disputa com `ml-ads`, mesmo antes desta
//   fase.
// - O contrato de resposta com `useMLAds` (`adsAvailable`, `daily`,
//   `campaigns`, `products`, `syncing`) é preservado byte a byte; `syncing`
//   passa a ser sempre `false` porque não há mais sync disparado por esta
//   função.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;

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

function subDaysStr(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().substring(0, 10);
}

function todayStr(): string { return new Date().toISOString().substring(0, 10); }
function round2(n: number)  { return Math.round(n * 100) / 100; }

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const url   = new URL(req.url);

    let body: Record<string, unknown> = {};
    if (req.method !== "GET") {
      try { body = await req.json(); } catch { /* ignore non-JSON */ }
    }
    const mlUserIdRaw = url.searchParams.get("ml_user_id") ?? (body.ml_user_id != null ? String(body.ml_user_id) : null);
    const mlUserId    = mlUserIdRaw || null;
    const dateFrom    = url.searchParams.get("date_from") ?? (body.date_from != null ? String(body.date_from) : subDaysStr(29));
    const dateTo      = url.searchParams.get("date_to")   ?? (body.date_to   != null ? String(body.date_to)   : todayStr());

    if (!mlUserId) return json({ error: "ml_user_id required" }, 400);

    const { data: tokenRow } = await admin
      .from("ml_tokens")
      .select("seller_id,organization_id,user_id")
      .eq("ml_user_id", mlUserId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!tokenRow) {
      return json({ adsAvailable: false, daily: [], campaigns: [], products: [] });
    }

    const { organization_id: orgId, user_id: tokenUserId } = tokenRow;

    // Verifica acesso: usuário deve ser membro da org
    if (orgId) {
      const { data: isMember } = await admin.rpc("is_org_member", { _user_id: user.id, _org_id: orgId });
      if (!isMember) return json({ error: "Forbidden" }, 403);
    } else if (user.id !== tokenUserId) {
      return json({ error: "Forbidden" }, 403);
    }

    // Lê dados do cache com filtro de período. Quem alimenta ml_ads_daily_cache
    // e ml_ads_products_cache é o cron de sync-ads (4x ao dia) — esta função não
    // dispara sync nenhum, só relê o que já está gravado.
    const [dailyRes, campaignsRes, productsRes] = await Promise.all([
      admin
        .from("ml_ads_daily_cache")
        .select("date,impressions,clicks,spend,attributed_revenue,attributed_orders,cpc,ctr,roas")
        .eq("ml_user_id", mlUserId)
        .gte("date", dateFrom)
        .lte("date", dateTo)
        .order("date", { ascending: true }),

      admin
        .from("ml_ads_campaigns_cache")
        .select("campaign_id,name,status,daily_budget,impressions,clicks,spend,attributed_revenue,attributed_orders,cpc,ctr,roas")
        .eq("ml_user_id", mlUserId)
        .order("spend", { ascending: false }),

      // Lê top produtos por spend — LIMIT defensivo evita carregar todo o período
      admin
        .from("ml_ads_products_cache")
        .select("item_id,title,thumbnail,impressions,clicks,spend,attributed_revenue,attributed_orders")
        .eq("ml_user_id", mlUserId)
        .gte("date", dateFrom)
        .lte("date", dateTo)
        .order("spend", { ascending: false })
        .limit(500),
    ]);

    const daily = (dailyRes.data ?? []).map((r: any) => ({
      date: r.date, impressions: r.impressions, clicks: r.clicks,
      spend: r.spend, attributed_revenue: r.attributed_revenue, attributed_orders: r.attributed_orders,
      cpc: r.cpc, ctr: r.ctr, roas: r.roas,
    }));

    const campaigns = (campaignsRes.data ?? []).map((r: any) => ({
      id: r.campaign_id, name: r.name, status: r.status, daily_budget: r.daily_budget,
      impressions: r.impressions, clicks: r.clicks, spend: r.spend,
      attributed_revenue: r.attributed_revenue, attributed_orders: r.attributed_orders,
      cpc: r.cpc, ctr: r.ctr, roas: r.roas,
    }));

    // Agrega produtos por item_id (múltiplas linhas/dia → um total por produto)
    const productAgg = new Map<string, any>();
    for (const r of productsRes.data ?? []) {
      const ex = productAgg.get(r.item_id);
      if (ex) {
        ex.impressions        += r.impressions        ?? 0;
        ex.clicks             += r.clicks             ?? 0;
        ex.spend              += r.spend              ?? 0;
        ex.attributed_revenue += r.attributed_revenue ?? 0;
        ex.attributed_orders  += r.attributed_orders  ?? 0;
      } else {
        productAgg.set(r.item_id, { ...r });
      }
    }
    const products = Array.from(productAgg.values())
      .map((p: any) => ({
        item_id: p.item_id, title: p.title, thumbnail: p.thumbnail,
        impressions: p.impressions, clicks: p.clicks,
        spend: round2(p.spend), attributed_revenue: round2(p.attributed_revenue), attributed_orders: p.attributed_orders,
        cpc:  p.clicks > 0      ? round2(p.spend / p.clicks)                  : 0,
        ctr:  p.impressions > 0 ? round2((p.clicks / p.impressions) * 100)    : 0,
        roas: p.spend > 0       ? round2(p.attributed_revenue / p.spend)      : 0,
      }))
      .sort((a: any, b: any) => b.spend - a.spend)
      .slice(0, 50);

    return json({
      adsAvailable: daily.length > 0 || campaigns.length > 0,
      syncing: false,   // Phase 221: nunca mais true — esta função não dispara sync, só lê o cache
      daily,
      campaigns,
      products,
    });

  } catch (err: any) {
    console.error("ml-ads error:", err);
    return json({ error: err.message }, 500);
  }
});
