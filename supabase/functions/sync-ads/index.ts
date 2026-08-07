/**
 * sync-ads — scheduled edge function
 * Runs via queue (process-sync-job) to sync ML Ads (PADS) data for all active sellers.
 * Writes to: ml_ads_daily_cache, ml_ads_products_cache (por dia), ml_ads_campaigns_cache
 *
 * Schema deste projeto: ml_tokens com access_token/refresh_token diretos.
 * Credenciais ML: env vars ML_APP_ID + ML_CLIENT_SECRET.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  normalizeMetrics,
  parseMetricsSummary,
  dedupeProductMetrics,
  sumCampaignPages,
  buildDailyTotals,
  type ItemMetricRow,
  type CampaignPage,
  type PartialTotals,
} from "./aggregate.ts";

const SUPABASE_URL      = (Deno.env.get("SUPABASE_URL") ?? "").trim();
const SERVICE_KEY       = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
const ML_APP_ID         = Deno.env.get("ML_APP_ID") ?? "";
const ML_CLIENT_SECRET  = Deno.env.get("ML_CLIENT_SECRET") ?? "";
const ML_API            = "https://api.mercadolibre.com";
const METRICS           = "prints,clicks,ctr,cvr,acos,roas,cpc,cost,units_quantity,direct_amount,indirect_amount,total_amount";

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

function todayStr(): string { return new Date().toISOString().substring(0, 10); }
function round2(n: number)  { return Math.round(n * 100) / 100; }

function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  const cur = new Date(from + "T00:00:00Z");
  const end = new Date(to   + "T00:00:00Z");
  while (cur <= end) {
    days.push(cur.toISOString().substring(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

// ── Auth guard: only service role may invoke ──────────────────────────────────

function requireServiceRole(req: Request): Response | null {
  if (!SERVICE_KEY) return null;
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== "Bearer " + SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  return null;
}

// ── Token helpers (same pattern as ml-ads) ────────────────────────────────────

async function getAccessToken(sb: any, mlUserId: string): Promise<string> {
  const { data: row } = await sb
    .from("ml_tokens")
    .select("access_token,refresh_token,expires_at")
    .eq("ml_user_id", mlUserId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) throw new Error("No ML token for ml_user_id=" + mlUserId);

  const expiresTs = row.expires_at ? new Date(row.expires_at).getTime() / 1000 : 0;
  const now       = Date.now() / 1000;
  if (row.access_token && expiresTs - now > 300) return row.access_token;

  if (!row.refresh_token) throw new Error("No refresh token for ml_user_id=" + mlUserId);
  if (!ML_APP_ID || !ML_CLIENT_SECRET) throw new Error("ML_APP_ID/ML_CLIENT_SECRET not set");

  const resp = await fetch(ML_API + "/oauth/token", {
    method:  "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type:    "refresh_token",
      client_id:     ML_APP_ID,
      client_secret: ML_CLIENT_SECRET,
      refresh_token: row.refresh_token,
    }),
  });
  if (!resp.ok) throw new Error("Token refresh " + resp.status + " for ml_user_id=" + mlUserId);

  const data         = await resp.json();
  const newExpiresAt = new Date(Date.now() + (data.expires_in || 21600) * 1000).toISOString();

  await sb
    .from("ml_tokens")
    .update({
      access_token:  data.access_token,
      refresh_token: data.refresh_token ?? row.refresh_token,
      expires_at:    newExpiresAt,
    })
    .eq("ml_user_id", mlUserId);

  return data.access_token;
}

// ── ML API fetch with retry ───────────────────────────────────────────────────

async function mlGet(url: string, token: string): Promise<any> {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, {
      headers: { Authorization: "Bearer " + token, "api-version": "2" },
    });
    if (res.ok) return res.json();
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? "2");
      await new Promise(r => setTimeout(r, (wait || 2) * 1000));
      continue;
    }
    if (i < 2 && [500, 502, 503, 504].includes(res.status)) {
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      continue;
    }
    throw new Error("ML " + res.status + " " + url.split("?")[0]);
  }
  throw new Error("ML retries exhausted");
}

// ── Total diário do endpoint de campanhas (Phase 221) ─────────────────────────
//
// product_ads/campaigns/search é o que o painel do ML mostra no card
// Investimento (medido 06/08/2026: 220,65 contra os 172,95 do endpoint de
// anúncios). ATENÇÃO: nesse endpoint o `metrics_summary` resume SÓ A PÁGINA
// — com limit=1 a 1ª de 6 campanhas devolveu 18,67. sumCampaignPages()
// recusa cobertura incompleta contra `paging.total`, então a paginação aqui
// PRECISA cobrir o total antes de compor a resposta.

async function fetchCampaignDayTotals(
  siteId: string,
  advertiserId: string,
  token: string,
  dia: string,
): Promise<PartialTotals | null> {
  // Lista de métricas: tenta METRICS (a mesma da chamada de anúncios) primeiro;
  // se mlGet lançar, tenta UMA vez com a lista mínima já provada ao vivo. É essa
  // segunda tentativa que torna source:"campaigns+ads" de buildDailyTotals
  // alcançável — quando só a lista curta responde, receita/unidades ficam sem
  // vir das campanhas e caem no fallback do resumo de anúncios.
  const metricsAttempts = [METRICS, "clicks,prints,cost"];
  let lastError: unknown = null;

  for (let attempt = 0; attempt < metricsAttempts.length; attempt++) {
    const metricsParam = metricsAttempts[attempt];
    try {
      const pages: CampaignPage[] = [];
      let pagingTotal = 0;
      let offset = 0;
      while (true) {
        const qs = new URLSearchParams({
          date_from: dia, date_to: dia,
          metrics_summary: "true", metrics: metricsParam,
          limit: "100", offset: String(offset),
        });
        const data = await mlGet(
          ML_API + "/advertising/" + siteId + "/advertisers/" + advertiserId + "/product_ads/campaigns/search?" + qs,
          token,
        );
        const campanhasPagina = data?.results ?? data?.campaigns ?? [];
        if (offset === 0) {
          pagingTotal = data?.paging?.total ?? campanhasPagina.length;
        }
        pages.push({ metricsSummary: data?.metrics_summary, campaigns: campanhasPagina.length });
        offset += campanhasPagina.length;
        if (campanhasPagina.length === 0 || offset >= pagingTotal) break;
      }
      console.log(
        "sync-ads fetchCampaignDayTotals dia=" + dia + " metrics='" + metricsParam +
        "' (tentativa " + (attempt + 1) + "/" + metricsAttempts.length + ") pages=" + pages.length +
        " pagingTotal=" + pagingTotal,
      );
      return sumCampaignPages(pages, pagingTotal);
    } catch (e) {
      lastError = e;
      if (attempt < metricsAttempts.length - 1) {
        console.log(
          "sync-ads fetchCampaignDayTotals dia=" + dia + " metrics='" + metricsParam +
          "' falhou, tentando lista mínima:", String(e).slice(0, 150),
        );
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// ── Per-user sync ─────────────────────────────────────────────────────────────

async function syncUser(
  sb: any,
  row: { ml_user_id: string; user_id: string; organization_id: string; seller_id: string | null },
  dateFrom: string,
  dateTo:   string,
): Promise<{ days: number; items: number; camps: number; dias_sem_total: string[]; dias_falhos: { dia: string; erro: string }[] }> {
  const { ml_user_id: mlUserId, user_id: userId, organization_id: orgId, seller_id: sellerId } = row;

  const token       = await getAccessToken(sb, mlUserId);
  const advData     = await mlGet(ML_API + "/advertising/advertisers?product_id=PADS", token);
  const advertiserId = advData?.advertisers?.[0]?.advertiser_id;
  if (!advertiserId) throw new Error("No advertiser_id for ml_user_id=" + mlUserId);
  const siteId = advData?.advertisers?.[0]?.site_id;
  if (!siteId) throw new Error("No site_id for ml_user_id=" + mlUserId);

  const syncedAt = new Date().toISOString();
  const dias = daysBetween(dateFrom, dateTo);

  let totalDaysWritten = 0;
  let totalItemsWritten = 0;
  const diasSemTotal: string[] = [];
  const diasFalhos: { dia: string; erro: string }[] = [];

  // Laço por dia: cada dia é buscado, agregado e gravado isoladamente. Um dia
  // fora da retenção (~90d, HTTP 400 do ML) ou qualquer outra falha entra em
  // diasFalhos e o laço segue para o próximo dia — não derruba a rodada
  // inteira (219-PROVA.md: dia fora da retenção falha ANTES do delete,
  // preservando o cache existente; aqui isso vale por dia, não pelo range).
  for (const dia of dias) {
    try {
      // itemRows do dia: linhas cruas por produto (uma por ocorrência na
      // página), que dedupeProductMetrics agrega por (date|item_id).
      const itemRows: ItemMetricRow[] = [];
      // resumoAnuncios: metrics_summary de product_ads/ads/search — usado
      // como FALLBACK de receita/unidades em buildDailyTotals (D-219-01
      // provou que os dois endpoints medem o mesmo valor para essas duas
      // métricas), nunca mais como fonte do total diário (Phase 221).
      let resumoAnuncios: ReturnType<typeof parseMetricsSummary> = null;

      let offset = 0;
      let fetchError: string | null = null;
      while (true) {
        let items: any[] = [], total = 0;
        try {
          // IMPORTANTE: passar metrics + metrics_summary + date, senão a API retorna itens
          // SEM métricas (spend/cliques = 0) e ml_ads_products_cache fica zerado.
          const itemsQs = new URLSearchParams({
            date_from: dia, date_to: dia,
            metrics: METRICS, metrics_summary: "true",
            limit: "50", offset: String(offset),
          });
          const data = await mlGet(
            ML_API + "/advertising/" + siteId + "/advertisers/" + advertiserId + "/product_ads/ads/search?" + itemsQs,
            token,
          );
          if (resumoAnuncios === null && data?.metrics_summary) {
            resumoAnuncios = parseMetricsSummary(data.metrics_summary);
          }
          items = data?.results ?? data?.ads ?? data?.items ?? [];
          total = data?.paging?.total ?? items.length;
        } catch (e) {
          fetchError = String(e).slice(0, 200);
          console.warn("sync-ads ml_user_id=" + mlUserId + " dia=" + dia, String(e).slice(0, 120));
          break;
        }

        for (const it of items) {
          const m = normalizeMetrics(it as Record<string, unknown>);
          const p   = Number(m.prints        ?? m.impressions    ?? 0);
          const cl  = Number(m.clicks        ?? 0);
          const sp  = Number(m.cost          ?? m.spend          ?? 0);
          const rev = Number(m.total_amount  ?? m.direct_amount  ?? m.attributed_revenue ?? 0);
          const ord = Number(m.units_quantity ?? m.direct_units_quantity ?? m.orders ?? 0);
          const itemId = (it as any).item_id ?? (it as any).ad_id ?? (it as any).id;

          if (itemId) {
            itemRows.push({
              key: dia + "|" + String(itemId),
              title: it.title ?? "", thumbnail: it.thumbnail ?? null,
              impressions: p, clicks: cl, spend: sp, revenue: rev, orders: ord,
            });
          }
        }
        offset += items.length;
        if (items.length === 0 || offset >= total) break;
      }

      if (fetchError) {
        throw new Error("sync-ads fetch items falhou para ml_user_id=" + mlUserId + " dia=" + dia + ": " + fetchError);
      }

      // product_ads/campaigns/search é REDE DE SEGURANÇA, não fonte primária
      // (Fase 221, premissa invertida — ver 221-REFUTACAO.md). O agregado de
      // campanha publica valor PROVISÓRIO mais alto no dia recente e depois
      // assenta no valor do agregado de anúncio; medido em 07/08/2026, o mesmo
      // dia 06/08 saiu de 220,65 para 172,95 em 36 minutos, virando exatamente
      // o número de anúncios. Por isso só se paga essa chamada quando o resumo
      // de anúncios não veio — evita custo de quota em toda rodada.
      const campanhasDoDia = resumoAnuncios === null
        ? await fetchCampaignDayTotals(siteId, advertiserId, token, dia)
        : null;

      // Cache por produto: dedup por (date|item_id), sobrescrevendo em vez de
      // somar — corrige a duplicação da API (Frente 1, Phase 219).
      const itemDayAgg = dedupeProductMetrics(itemRows);
      const productRows = Array.from(itemDayAgg.entries()).map(([key, d]) => {
        const [date, itemId] = key.split("|");
        return {
          user_id: userId, organization_id: orgId, ml_user_id: mlUserId, seller_id: sellerId,
          item_id: itemId, date, title: d.title, thumbnail: d.thumbnail,
          impressions: d.impressions, clicks: d.clicks,
          spend: round2(d.spend), attributed_revenue: round2(d.revenue), attributed_orders: d.orders,
          ctr:  d.impressions > 0 ? round2(d.clicks  / d.impressions * 100) : 0,
          cpc:  d.clicks      > 0 ? round2(d.spend   / d.clicks)            : 0,
          roas: d.spend       > 0 ? round2(d.revenue / d.spend)             : 0,
          synced_at: syncedAt,
        };
      });

      // Delete restrito ao dia da iteração — a mesma iteração reescreve
      // exatamente o que apaga.
      await sb.from("ml_ads_products_cache").delete().eq("ml_user_id", mlUserId).eq("date", dia);
      if (productRows.length > 0) {
        const { error } = await sb
          .from("ml_ads_products_cache")
          .upsert(productRows, { onConflict: "organization_id,ml_user_id,item_id,date" });
        if (error) console.error("sync-ads products upsert dia=" + dia + ":", error.message);
      }
      totalItemsWritten += productRows.length;

      // Total diário: o resumo de ANÚNCIOS manda (é o valor assentado);
      // campanhas só entra se aquele faltar. null aqui significa "não sabemos
      // o total do dia" — a linha antiga que já existia em ml_ads_daily_cache
      // fica intocada, porque resolveAdsSpend (D-219-01) escolhe fonte por
      // PERÍODO: apagar sem gravar subtrairia esse dia do gasto em silêncio.
      const totalDoDia = buildDailyTotals(campanhasDoDia, resumoAnuncios);
      if (totalDoDia === null) {
        diasSemTotal.push(dia);
        console.warn("sync-ads ml_user_id=" + mlUserId + " dia=" + dia + ": total diário indisponível (campanhas sem cobertura ou sem receita/unidades resolvida) — linha existente preservada");
      } else {
        const d = totalDoDia.totals;
        await sb.from("ml_ads_daily_cache").delete().eq("ml_user_id", mlUserId).eq("date", dia);
        const { error } = await sb
          .from("ml_ads_daily_cache")
          .upsert([{
            user_id: userId, organization_id: orgId, ml_user_id: mlUserId, seller_id: sellerId, date: dia,
            impressions: d.impressions, clicks: d.clicks,
            spend: round2(d.spend), attributed_revenue: round2(d.revenue), attributed_orders: d.orders,
            ctr:  d.impressions > 0 ? round2(d.clicks  / d.impressions * 100) : 0,
            cpc:  d.clicks      > 0 ? round2(d.spend   / d.clicks)            : 0,
            roas: d.spend       > 0 ? round2(d.revenue / d.spend)             : 0,
            synced_at: syncedAt,
          }], { onConflict: "user_id,ml_user_id,date" });
        if (error) console.error("sync-ads daily upsert dia=" + dia + ":", error.message);
        else totalDaysWritten++;
      }
    } catch (e) {
      diasFalhos.push({ dia, erro: String(e).slice(0, 200) });
      console.warn("sync-ads ml_user_id=" + mlUserId + " dia=" + dia + " falhou, seguindo para o próximo dia:", String(e).slice(0, 150));
      continue;
    }
  }

  if (diasFalhos.length === dias.length && dias.length > 0) {
    throw new Error(
      "sync-ads: todos os " + dias.length + " dias falharam para ml_user_id=" + mlUserId +
      " — " + diasFalhos.map(d => d.dia + ":" + d.erro).join("; "),
    );
  }

  // Campaigns (metadados: nome, status, orçamento) — roda UMA vez por conta,
  // fora do laço de dias. Não tem recorte de data e não muda nesta fase;
  // sync-ads apaga e reescreve a tabela inteira a cada rodada.
  const allCamps: any[] = [];
  let campOff = 0;
  while (true) {
    let camps: any[] = [], total = 0;
    try {
      const data = await mlGet(
        ML_API + "/advertising/" + siteId + "/advertisers/" + advertiserId + "/product_ads/campaigns/search?limit=50&offset=" + campOff,
        token,
      );
      camps = data?.campaigns ?? data?.results ?? [];
      total = data?.paging?.total ?? camps.length;
    } catch { break; }
    allCamps.push(...camps);
    campOff += camps.length;
    if (camps.length === 0 || campOff >= total) break;
  }
  if (allCamps.length > 0) {
    const campRows = allCamps.map((c: any) => ({
      user_id: userId, organization_id: orgId, ml_user_id: mlUserId, seller_id: sellerId,
      campaign_id:  String(c.id ?? c.campaign_id ?? ""),
      name:         c.name ?? "",
      status:       (c.status ?? "unknown").toLowerCase(),
      daily_budget: Number(c.budget ?? c.budget_amount ?? c.daily_budget ?? 0),
      impressions: 0, clicks: 0, spend: 0, attributed_revenue: 0, attributed_orders: 0,
      ctr: 0, cpc: 0, roas: 0,
      synced_at: syncedAt,
    }));
    await sb.from("ml_ads_campaigns_cache").delete().eq("ml_user_id", mlUserId);
    await sb.from("ml_ads_campaigns_cache").insert(campRows);
  }

  console.log(
    "sync-ads done ml_user_id=" + mlUserId + ": days=" + totalDaysWritten + " items=" + totalItemsWritten +
    " camps=" + allCamps.length + " dias_sem_total=" + diasSemTotal.length + " dias_falhos=" + diasFalhos.length,
  );
  return { days: totalDaysWritten, items: totalItemsWritten, camps: allCamps.length, dias_sem_total: diasSemTotal, dias_falhos: diasFalhos };
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const guard = requireServiceRole(req);
  if (guard) return guard;

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    let body: any = {};
    try { body = await req.json(); } catch { /* no body */ }
    const dateFrom = body.date_from ?? todayStr();
    const dateTo   = body.date_to   ?? todayStr();
    // Filtro opcional: restringe a rodada a um subconjunto de contas (a prova
    // do plano 221-02 e reprocessos manuais rodam só nas contas ativas, sem
    // varrer a conta Thales — fora de escopo por decisão do Wesley e a mais
    // pesada da API, 679 anúncios). Omitido, comportamento igual ao de hoje.
    const mlUserIdsFilter: string[] | null = Array.isArray(body.ml_user_ids) && body.ml_user_ids.length > 0
      ? body.ml_user_ids.map((id: unknown) => String(id))
      : null;

    // Contas ativas: refresh_token presente E sync_enabled. O filtro por
    // sync_enabled fecha, na própria função, a porta que o despacho deixava
    // aberta — dispatch_ads_jobs varria TODO ml_tokens com access_token e vinha
    // sincronizando a conta Thales (427063369, sync_enabled=false) 4x ao dia,
    // fora de escopo por decisão do Wesley e a mais pesada da API.
    const { data: tokenRows, error: tokErr } = await sb
      .from("ml_tokens")
      .select("ml_user_id,user_id,organization_id,seller_id")
      .not("refresh_token", "is", null)
      .eq("sync_enabled", true);

    if (tokErr) return json({ ok: false, error: tokErr.message }, 500);
    if (!tokenRows || tokenRows.length === 0) return json({ ok: true, msg: "no active users" });

    const filteredRows = mlUserIdsFilter
      ? tokenRows.filter((r: any) => mlUserIdsFilter.includes(String(r.ml_user_id)))
      : tokenRows;

    const results: any[] = [];
    for (const row of filteredRows) {
      try {
        const counts = await syncUser(sb, row, dateFrom, dateTo);
        results.push({ ml_user_id: row.ml_user_id, ...counts });
      } catch (e: any) {
        console.error("sync-ads ml_user_id=" + row.ml_user_id + " error:", e.message);
        results.push({ ml_user_id: row.ml_user_id, error: e.message });
      }
    }

    return json({
      ok: true, date_from: dateFrom, date_to: dateTo,
      ...(mlUserIdsFilter ? { ml_user_ids: mlUserIdsFilter } : {}),
      results,
    });

  } catch (err: any) {
    console.error("sync-ads error:", err);
    return json({ ok: false, error: err.message }, 500);
  }
});
