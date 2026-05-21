import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TINY_API     = "https://api.tiny.com.br/public-api/v3";
const TINY_TOKEN_URL = "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token";
const TINY_CLIENT_ID     = Deno.env.get("TINY_CLIENT_ID") ?? "";
const TINY_CLIENT_SECRET = Deno.env.get("TINY_CLIENT_SECRET") ?? "";
const RATE_MS   = 1100; // 60 req/min → 1 req/s com margem
const BATCH_SIZE = 50;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Token management ──────────────────────────────────────────────────────────

async function getTinyToken(mlUserId: string): Promise<string> {
  // Tentar usar token em cache primeiro
  const { data: tok } = await sb
    .from("ml_tokens")
    .select("tiny_access_token, tiny_expires_at")
    .eq("ml_user_id", mlUserId)
    .single();

  const now = Math.floor(Date.now() / 1000);
  if (tok?.tiny_access_token && tok.tiny_expires_at && tok.tiny_expires_at - now > 300) {
    return tok.tiny_access_token;
  }

  // Gerar novo token via client_credentials
  if (!TINY_CLIENT_ID || !TINY_CLIENT_SECRET) {
    throw new Error("TINY_CLIENT_ID ou TINY_CLIENT_SECRET não configurados");
  }

  const resp = await fetch(TINY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "client_credentials",
      client_id:     TINY_CLIENT_ID,
      client_secret: TINY_CLIENT_SECRET,
    }),
  });

  if (!resp.ok) {
    throw new Error(`Tiny token error ${resp.status}: ${await resp.text()}`);
  }

  const data = await resp.json();
  const accessToken  = data.access_token as string;
  const expiresAt    = now + (data.expires_in ?? 3600);

  await sb
    .from("ml_tokens")
    .update({ tiny_access_token: accessToken, tiny_expires_at: expiresAt })
    .eq("ml_user_id", mlUserId);

  return accessToken;
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

// ── Fetch all active product IDs+SKUs ────────────────────────────────────────

async function fetchAllProducts(token: string): Promise<Array<{ id: string; sku: string; nome: string }>> {
  const products: Array<{ id: string; sku: string; nome: string }> = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = await tinyGet(token, "/produtos", { situacao: "A", limit: String(limit), offset: String(offset) });
    // deno-lint-ignore no-explicit-any
    const itens: any[] = Array.isArray(data) ? data : (data?.itens ?? []);
    if (!itens.length) break;

    // deno-lint-ignore no-explicit-any
    for (const p of itens) {
      if (p?.tipoVariacao === "P") continue; // pular produto pai
      const id  = String(p?.id || "");
      const sku = String(p?.sku || p?.codigo || "").trim();
      const nome = String(p?.nome || "").trim();
      if (id && sku) products.push({ id, sku, nome });
    }

    const total: number = data?.paginacao?.total ?? 0;
    offset += itens.length;
    if (itens.length < limit || (total > 0 && offset >= total)) break;
    await sleep(RATE_MS);
  }
  return products;
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  try {
    // Auth: aceitar user JWT ou service_role
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, authHeader.replace("Bearer ", ""));

    let userId: string | null = null;
    let mlUserId: string | null = null;

    // Tentar auth via JWT do usuário
    const { data: { user } } = await userClient.auth.getUser();
    if (user) {
      userId = user.id;
    } else if (authHeader.includes(SERVICE_KEY)) {
      // service_role: ml_user_id obrigatório no body
    } else {
      return json({ error: "Unauthorized" }, 401);
    }

    // Ler body
    // deno-lint-ignore no-explicit-any
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* ok */ }

    mlUserId = (body.ml_user_id as string) ?? null;
    if (!mlUserId) return json({ error: "ml_user_id obrigatório" }, 400);

    // Buscar user_id a partir de ml_user_id (para usar como scope em ml_product_costs)
    const { data: tokenRow } = await sb
      .from("ml_tokens")
      .select("user_id")
      .eq("ml_user_id", mlUserId)
      .single();

    const scopeUserId = userId ?? (tokenRow?.user_id as string ?? null);
    if (!scopeUserId) return json({ error: `ml_user_id ${mlUserId} não encontrado em ml_tokens` }, 404);

    // Obter token Tiny
    const tinyToken = await getTinyToken(mlUserId);

    // Buscar todos os produtos ativos no Tiny
    const allProducts = await fetchAllProducts(tinyToken);
    if (allProducts.length === 0) {
      return json({ ok: true, synced: 0, msg: "Nenhum produto ativo no Tiny" });
    }

    let synced = 0;
    let errors = 0;
    const syncAt = new Date().toISOString();

    // Processar em batches de BATCH_SIZE
    for (let i = 0; i < allProducts.length; i += BATCH_SIZE) {
      const batch = allProducts.slice(i, i + BATCH_SIZE);
      // deno-lint-ignore no-explicit-any
      const rows: any[] = [];

      for (const prod of batch) {
        try {
          const rawDetail = await tinyGet(tinyToken, `/produtos/${prod.id}`);
          const detail = rawDetail?.produto ?? rawDetail;
          const precos = detail?.precos ?? {};
          const precoCustoMedio = Number(precos.precoCustoMedio ?? 0);
          const precoCusto      = Number(precos.precoCusto ?? 0);
          const cost = precoCustoMedio || precoCusto; // preferir custo médio

          const sku  = String(detail?.codigo || detail?.sku || prod.sku || "").trim();

          if (sku && cost > 0) {
            rows.push({
              user_id:    scopeUserId,
              item_id:    `TINY_${sku}`, // placeholder — item_id real do ML é sobrescrito por sync-ml-orders
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

      if (rows.length > 0) {
        // Upsert por (user_id, seller_sku) — atualiza cost de produtos já mapeados
        const { error: upsertErr } = await sb
          .from("ml_product_costs")
          .upsert(rows, { onConflict: "user_id,seller_sku", ignoreDuplicates: false });

        if (!upsertErr) {
          synced += rows.length;
        } else {
          console.error("upsert error:", upsertErr.message);
          errors += rows.length;
        }
      }
    }

    return json({
      ok: true,
      synced,
      errors,
      total_products: allProducts.length,
      msg: `${synced} produtos sincronizados, ${errors} erros`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("sync-tiny-costs error:", message);
    return json({ error: message }, 500);
  }
});
