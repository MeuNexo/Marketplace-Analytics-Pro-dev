import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// EdgeRuntime é global no runtime Supabase Edge — sem import necessário.
// Declaração de tipo para satisfazer deno check.
declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TINY_API     = "https://api.tiny.com.br/public-api/v3";
const RATE_MS      = 1100; // 60 req/min
const BATCH_SIZE   = 50;
const CAP_DETAIL         = 250;
const PHASE2_TIMEOUT_MS  = 120_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Token management ──────────────────────────────────────────────────────────

async function getTinyToken(mlUserId: string): Promise<string> {
  const { data: tok, error } = await sb
    .from("ml_tokens")
    .select("tiny_access_token, tiny_refresh_token, tiny_expires_at")
    .eq("ml_user_id", mlUserId)
    .maybeSingle();

  if (error || !tok) {
    throw new Error(`Conta ML ${mlUserId} não encontrada em ml_tokens`);
  }

  if (!tok.tiny_access_token) {
    throw new Error(`Tiny ERP não conectado para a loja ${mlUserId}. Conecte em /integracoes.`);
  }

  const now = Math.floor(Date.now() / 1000);
  if (tok.tiny_expires_at && tok.tiny_expires_at - now > 300) {
    return tok.tiny_access_token;
  }

  if (!tok.tiny_refresh_token) {
    throw new Error(`Token Tiny expirado e sem refresh_token para ${mlUserId}. Reconecte em /integracoes.`);
  }

  const refreshResp = await fetch(`${SUPABASE_URL}/functions/v1/tiny-oauth`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({
      action: "refresh_token",
      refresh_token: tok.tiny_refresh_token,
      ml_user_id: mlUserId,
    }),
  });

  const refreshData = await refreshResp.json();
  if (!refreshResp.ok || !refreshData.success) {
    throw new Error(`Falha ao renovar token Tiny: ${refreshData.error || "desconhecido"}`);
  }

  return refreshData.access_token;
}

// ── Tiny API helpers ──────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function tinyGet(token: string, path: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`${TINY_API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (resp.status === 429) throw new Error("Tiny 429 rate limit");
  if (!resp.ok) throw new Error(`Tiny ${path} ${resp.status}`);
  const res = await resp.json();
  return res.data ?? res;
}

// ── Fetch all active products with prices ─────────────────────────────────────
// Strategy: extract prices from the list endpoint first.
// Only fall back to individual detail calls for products missing prices.

interface ProductEntry {
  id: string;
  sku: string;
  nome: string;
  cost: number; // 0 = not resolved yet
}

async function fetchAllProducts(token: string): Promise<ProductEntry[]> {
  const products: ProductEntry[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = await tinyGet(token, "/produtos", { situacao: "A", limit: String(limit), offset: String(offset) });
    // deno-lint-ignore no-explicit-any
    const itens: any[] = Array.isArray(data) ? data : (data?.itens ?? []);
    if (!itens.length) break;

    // deno-lint-ignore no-explicit-any
    for (const p of itens) {
      if (p?.tipoVariacao === "P") continue;
      const id   = String(p?.id || "");
      const sku  = String(p?.sku || p?.codigo || "").trim();
      const nome = String(p?.nome || "").trim();
      if (!id || !sku) continue;

      // Try to extract price directly from list response
      const precos = p?.precos ?? {};
      const listCost = Number(precos.precoCustoMedio ?? 0) || Number(precos.precoCusto ?? 0);
      products.push({ id, sku, nome, cost: listCost });
    }

    const total: number = data?.paginacao?.total ?? 0;
    offset += itens.length;
    if (itens.length < limit || (total > 0 && offset >= total)) break;
    await sleep(RATE_MS);
  }
  return products;
}

// ── Background sync (toda a lógica de sync — Pitfall 4: try/catch obrigatório) ─

async function runSync(mlUserId: string, userId: string | null): Promise<void> {
  try {
    console.log(`[sync-tiny-costs] runSync iniciando. mlUserId=${mlUserId}`);

    // Derivar scopeUserId: mesma query que serve() fazia antes do refactor
    const { data: tokenRow } = await sb
      .from("ml_tokens")
      .select("user_id")
      .eq("ml_user_id", mlUserId)
      .single();

    const scopeUserId = userId ?? ((tokenRow?.user_id as string) ?? null);
    if (!scopeUserId) {
      console.error(`[sync-tiny-costs] ml_user_id ${mlUserId} não encontrado em ml_tokens — abortando runSync`);
      return;
    }

    const tinyToken = await getTinyToken(mlUserId);

    // Fetch all products — prices extracted from list when available
    const allProducts = await fetchAllProducts(tinyToken);
    if (allProducts.length === 0) {
      console.log("[sync-tiny-costs] Nenhum produto ativo no Tiny");
      return;
    }

    // Separate products: those with price from list vs those needing detail call
    const withPrice    = allProducts.filter(p => p.cost > 0);
    const withoutPrice = allProducts.filter(p => p.cost === 0);

    let synced = 0;
    let errors = 0;
    const syncAt = new Date().toISOString();

    // ── Phase 1: upsert products whose price came from the list ──────────────
    for (let i = 0; i < withPrice.length; i += BATCH_SIZE) {
      const batch = withPrice.slice(i, i + BATCH_SIZE);
      // deno-lint-ignore no-explicit-any
      const rows: any[] = batch.map(p => ({
        user_id:    scopeUserId,
        item_id:    `TINY_${p.sku}`,
        seller_sku: p.sku,
        cost:       p.cost,
        updated_at: syncAt,
      }));

      const { error: upsertErr } = await sb
        .from("ml_product_costs")
        .upsert(rows, { onConflict: "user_id,seller_sku", ignoreDuplicates: false });

      if (!upsertErr) synced += rows.length;
      else { console.error("upsert error:", upsertErr.message); errors += rows.length; }
    }

    // ── Priorização de faltantes (COSTS-02) ──────────────────────────────────
    // Carregar SKUs já presentes em ml_product_costs para este user.
    // Ordenar withoutPrice: SKUs ainda ausentes na base primeiro.
    let existingSkus = new Set<string>();
    try {
      const { data: existingRows, error: existingErr } = await sb
        .from("ml_product_costs")
        .select("seller_sku")
        .eq("user_id", scopeUserId);

      if (existingErr) {
        console.warn("[sync-tiny-costs] Aviso: não foi possível carregar SKUs existentes — usando ordem original.", existingErr.message);
      } else {
        // deno-lint-ignore no-explicit-any
        existingSkus = new Set<string>((existingRows ?? []).map((r: any) => String(r.seller_sku ?? "")).filter(Boolean));
      }
    } catch (existingQueryErr: unknown) {
      const msg = existingQueryErr instanceof Error ? existingQueryErr.message : String(existingQueryErr);
      console.warn("[sync-tiny-costs] Aviso: exceção ao carregar SKUs existentes — usando ordem original.", msg);
    }

    // Ordenar in-place: faltantes (não no Set) na frente
    withoutPrice.sort((a, b) => (existingSkus.has(a.sku) ? 1 : 0) - (existingSkus.has(b.sku) ? 1 : 0));

    // ── Phase 2: fetch detail only for products missing price ─────────────────
    // Cap elevado (CAP_DETAIL=250) + guarda de tempo (PHASE2_TIMEOUT_MS=120s).
    // Cada chamada de detalhe custa 1 req — sleep entre chamadas para respeitar RATE_MS.
    const detailQueue    = withoutPrice.slice(0, CAP_DETAIL);
    const phase2Skipped  = withoutPrice.length - detailQueue.length;
    let phase2Processed  = 0;
    const t0             = Date.now();

    for (let i = 0; i < detailQueue.length; i += BATCH_SIZE) {
      // Guarda de tempo: interromper se orçamento de 120s se esgotou
      if (Date.now() - t0 > PHASE2_TIMEOUT_MS) {
        console.log("[sync-tiny-costs] Phase 2 time guard triggered");
        break;
      }

      const batch = detailQueue.slice(i, i + BATCH_SIZE);
      // deno-lint-ignore no-explicit-any
      const rows: any[] = [];

      for (const prod of batch) {
        try {
          const rawDetail = await tinyGet(tinyToken, `/produtos/${prod.id}`);
          const detail = rawDetail?.produto ?? rawDetail;
          const precos = detail?.precos ?? {};
          const cost = Number(precos.precoCustoMedio ?? 0) || Number(precos.precoCusto ?? 0);
          const sku  = String(detail?.codigo || detail?.sku || prod.sku || "").trim();

          if (sku && cost > 0) {
            rows.push({
              user_id:    scopeUserId,
              item_id:    `TINY_${sku}`,
              seller_sku: sku,
              cost,
              updated_at: syncAt,
            });
          }
        } catch (_err) {
          errors++;
        }
        await sleep(RATE_MS);
      }

      phase2Processed += batch.length;

      if (rows.length > 0) {
        const { error: upsertErr } = await sb
          .from("ml_product_costs")
          .upsert(rows, { onConflict: "user_id,seller_sku", ignoreDuplicates: false });

        if (!upsertErr) synced += rows.length;
        else { console.error("upsert error:", upsertErr.message); errors += rows.length; }
      }
    }

    console.log(`[sync-tiny-costs] runSync concluído. synced=${synced}, errors=${errors}, phase2Processed=${phase2Processed}, phase2Skipped=${phase2Skipped}`);
  } catch (err: unknown) {
    // Pitfall 4: capturar TODA exceção do background — sem try/catch o processo
    // morre silenciosamente (sem log) quando chamado via EdgeRuntime.waitUntil
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync-tiny-costs] runSync ERRO não capturado:", message);
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
// serve() autentica inline e delega todo o processamento para runSync() via
// EdgeRuntime.waitUntil — retorna 202 imediatamente para o cron (pg_net não
// encerra a conexão antes da Fase 2 completar).

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    let userId: string | null = null;

    if (jwt && jwt !== SERVICE_KEY) {
      const { data: { user } } = await sb.auth.getUser(jwt);
      if (user) userId = user.id;
    }

    if (!userId && jwt !== SERVICE_KEY) {
      return json({ error: "Unauthorized" }, 401);
    }

    // deno-lint-ignore no-explicit-any
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* ok */ }

    const mlUserId = (body.ml_user_id as string) ?? null;
    if (!mlUserId) return json({ error: "ml_user_id obrigatório" }, 400);

    EdgeRuntime.waitUntil(runSync(mlUserId, userId));
    return json({ ok: true, msg: "sync enqueued" }, 202);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("sync-tiny-costs error:", message);
    return json({ error: message }, 500);
  }
});
