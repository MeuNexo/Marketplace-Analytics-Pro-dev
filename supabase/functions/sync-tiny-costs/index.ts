import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// EdgeRuntime é global no runtime Supabase Edge — sem import necessário.
// Declaração de tipo para satisfazer deno check.
declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TINY_API     = "https://api.tiny.com.br/public-api/v3";
const RATE_MS      = 1100; // 60 req/min (chamadas de detalhe — Fase 2)
const PAGE_SLEEP_MS = 300; // entre páginas da listagem (poucas req — bem abaixo do limite)
const BATCH_SIZE   = 50;
const CAP_DETAIL         = 250;
const PHASE2_TIMEOUT_MS  = 90_000;

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

// Produto coletado da listagem do Tiny (custo 0 = sem custo na listagem → Fase 2)
interface ProductEntry {
  id: string;
  sku: string;
  nome: string;
  cost: number;
}

// ── Background sync (toda a lógica de sync — Pitfall 4: try/catch obrigatório) ─

async function runSync(mlUserId: string, userId: string | null): Promise<void> {
  try {
    console.log(`[sync-tiny-costs] runSync iniciando. mlUserId=${mlUserId}`);

    // Derivar scopeUserId + organizationId (organization_id é NOT NULL em
    // ml_product_costs — SEM ele o upsert falha silenciosamente).
    const { data: tokenRow } = await sb
      .from("ml_tokens")
      .select("user_id, organization_id")
      .eq("ml_user_id", mlUserId)
      .single();

    const scopeUserId = userId ?? ((tokenRow?.user_id as string) ?? null);
    const orgId = (tokenRow?.organization_id as string) ?? null;
    if (!scopeUserId || !orgId) {
      console.error(`[sync-tiny-costs] ml_user_id ${mlUserId} sem user_id/organization_id em ml_tokens — abortando runSync`);
      return;
    }

    const tinyToken = await getTinyToken(mlUserId);

    // SKUs já com custo (priorização da Fase 2 + economia de detalhe)
    let existingSkus = new Set<string>();
    try {
      const { data: existingRows } = await sb
        .from("ml_product_costs").select("seller_sku").eq("user_id", scopeUserId);
      // deno-lint-ignore no-explicit-any
      existingSkus = new Set<string>((existingRows ?? []).map((r: any) => String(r.seller_sku ?? "")).filter(Boolean));
    } catch (_e) { /* segue com Set vazio */ }

    let synced = 0;
    let errors = 0;
    const syncAt = new Date().toISOString();
    const withoutPrice: ProductEntry[] = [];

    // ── Fase 1: paginar e GRAVAR INCREMENTALMENTE por página ──────────────────
    // O custo vem na listagem (precoCustoMedio) para a maioria. Upsert a cada
    // página garante persistência mesmo que o worker do waitUntil seja curto
    // (antes, paginava tudo ~17s ANTES de gravar → 0 linhas se o worker morria).
    let offset = 0;
    const PAGE = 100;
    while (true) {
      const data = await tinyGet(tinyToken, "/produtos", { situacao: "A", limit: String(PAGE), offset: String(offset) });
      // deno-lint-ignore no-explicit-any
      const itens: any[] = Array.isArray(data) ? data : (data?.itens ?? []);
      if (!itens.length) break;

      // deno-lint-ignore no-explicit-any
      const pageRows: any[] = [];
      for (const p of itens) {
        if (p?.tipoVariacao === "P") continue; // pula produto pai
        const id   = String(p?.id || "");
        const sku  = String(p?.sku || p?.codigo || "").trim();
        const nome = String(p?.nome || "").trim();
        if (!id || !sku) continue;
        const precos = p?.precos ?? {};
        const cost = Number(precos.precoCustoMedio ?? 0) || Number(precos.precoCusto ?? 0);
        if (cost > 0) {
          pageRows.push({ user_id: scopeUserId, organization_id: orgId, item_id: `TINY_${sku}`, seller_sku: sku, cost, updated_at: syncAt });
        } else {
          withoutPrice.push({ id, sku, nome, cost: 0 });
        }
      }

      if (pageRows.length > 0) {
        const { error: upsertErr } = await sb
          .from("ml_product_costs")
          .upsert(pageRows, { onConflict: "user_id,seller_sku", ignoreDuplicates: false });
        if (!upsertErr) synced += pageRows.length;
        else { console.error("[sync-tiny-costs] upsert página:", upsertErr.message); errors += pageRows.length; }
      }

      const total: number = data?.paginacao?.total ?? 0;
      offset += itens.length;
      console.log(`[sync-tiny-costs] página offset=${offset} synced=${synced} semCustoLista=${withoutPrice.length}`);
      if (itens.length < PAGE || (total > 0 && offset >= total)) break;
      await sleep(PAGE_SLEEP_MS);
    }

    // ── Fase 2: detalhe só dos sem custo na listagem (faltantes primeiro) ─────
    withoutPrice.sort((a, b) => (existingSkus.has(a.sku) ? 1 : 0) - (existingSkus.has(b.sku) ? 1 : 0));
    const detailQueue = withoutPrice.slice(0, CAP_DETAIL);
    const t0 = Date.now();
    for (let i = 0; i < detailQueue.length; i += BATCH_SIZE) {
      if (Date.now() - t0 > PHASE2_TIMEOUT_MS) { console.log("[sync-tiny-costs] Fase 2 time guard"); break; }
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
            rows.push({ user_id: scopeUserId, organization_id: orgId, item_id: `TINY_${sku}`, seller_sku: sku, cost, updated_at: syncAt });
          }
        } catch (_err) { errors++; }
        await sleep(RATE_MS);
      }
      if (rows.length > 0) {
        const { error: upsertErr } = await sb
          .from("ml_product_costs")
          .upsert(rows, { onConflict: "user_id,seller_sku", ignoreDuplicates: false });
        if (!upsertErr) synced += rows.length;
        else { console.error("[sync-tiny-costs] upsert detalhe:", upsertErr.message); errors += rows.length; }
      }
    }

    console.log(`[sync-tiny-costs] runSync concluído. synced=${synced}, errors=${errors}, semCustoLista=${withoutPrice.length}`);
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
