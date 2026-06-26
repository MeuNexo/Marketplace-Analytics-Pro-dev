import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// EdgeRuntime é global no runtime Supabase Edge.
declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TINY_API     = "https://api.tiny.com.br/public-api/v3";
const RATE_MS      = 1100; // ~60 req/min (chamadas de detalhe)
const PAGE_SLEEP_MS = 300;
const PAGE          = 100;
// "A caminho" = OC aguardando recebimento. Ajustável (ex: incluir '2' aprovada).
const SITUACOES_A_CAMINHO = ["3"];

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

// YYYY-MM-DD ou "" → DATE ou null
function toDate(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// ── Token Tiny (auto-refresh — mesmo padrão de sync-tiny-costs) ──────────────
async function getTinyToken(mlUserId: string): Promise<string> {
  const { data: tok, error } = await sb
    .from("ml_tokens")
    .select("tiny_access_token, tiny_refresh_token, tiny_expires_at")
    .eq("ml_user_id", mlUserId)
    .maybeSingle();

  if (error || !tok) throw new Error(`Conta ML ${mlUserId} não encontrada em ml_tokens`);
  if (!tok.tiny_access_token) throw new Error(`Tiny ERP não conectado para a loja ${mlUserId}.`);

  const now = Math.floor(Date.now() / 1000);
  if (tok.tiny_expires_at && tok.tiny_expires_at - now > 300) return tok.tiny_access_token;
  if (!tok.tiny_refresh_token) throw new Error(`Token Tiny expirado e sem refresh_token para ${mlUserId}.`);

  const refreshResp = await fetch(`${SUPABASE_URL}/functions/v1/tiny-oauth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ action: "refresh_token", refresh_token: tok.tiny_refresh_token, ml_user_id: mlUserId }),
  });
  const refreshData = await refreshResp.json();
  if (!refreshResp.ok || !refreshData.success) {
    throw new Error(`Falha ao renovar token Tiny: ${refreshData.error || "desconhecido"}`);
  }
  return refreshData.access_token;
}

// deno-lint-ignore no-explicit-any
async function tinyGet(token: string, path: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`${TINY_API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const resp = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (resp.status === 429) throw new Error("Tiny 429 rate limit");
  if (!resp.ok) throw new Error(`Tiny ${path} ${resp.status}`);
  return await resp.json();
}

// ── Background sync ─────────────────────────────────────────────────────────
async function runSync(mlUserId: string): Promise<void> {
  try {
    console.log(`[sync-tiny-po] runSync iniciando. mlUserId=${mlUserId}`);

    const { data: tokenRow } = await sb
      .from("ml_tokens").select("user_id, organization_id").eq("ml_user_id", mlUserId).single();
    const orgId = (tokenRow?.organization_id as string) ?? null;
    if (!orgId) { console.error(`[sync-tiny-po] ml_user_id ${mlUserId} sem organization_id — abortando`); return; }

    const tinyToken = await getTinyToken(mlUserId);
    const syncAt = new Date().toISOString();

    // 1) Listar headers de OC por situação "a caminho" (paginado)
    // deno-lint-ignore no-explicit-any
    const headers: any[] = [];
    for (const situacao of SITUACOES_A_CAMINHO) {
      let offset = 0;
      while (true) {
        const data = await tinyGet(tinyToken, "/ordem-compra", { situacao, limit: String(PAGE), offset: String(offset) });
        // deno-lint-ignore no-explicit-any
        const itens: any[] = data?.itens ?? [];
        if (!itens.length) break;
        for (const h of itens) headers.push({ ...h, _situacao: situacao });
        const total: number = data?.paginacao?.total ?? 0;
        offset += itens.length;
        console.log(`[sync-tiny-po] lista situacao=${situacao} offset=${offset}/${total}`);
        if (itens.length < PAGE || (total > 0 && offset >= total)) break;
        await sleep(PAGE_SLEEP_MS);
      }
    }
    console.log(`[sync-tiny-po] ${headers.length} OC(s) a detalhar`);

    // 2) Detalhe de cada OC → explode itens por SKU
    // deno-lint-ignore no-explicit-any
    const rows: any[] = [];
    for (const h of headers) {
      try {
        const det = await tinyGet(tinyToken, `/ordem-compra/${h.id}`);
        const dataEntrega = toDate(det?.data ?? h?.data);
        const dataPedido  = toDate(det?.dataPrevista ?? h?.dataPrevista);
        const numero = String(det?.numeroPedido ?? h?.numero ?? "");
        const situacao = String(det?.situacao ?? h?._situacao ?? "");
        const fornecedor = (String(det?.contato?.nome ?? h?.contato?.nome ?? "").trim().slice(0, 200)) || null;
        // deno-lint-ignore no-explicit-any
        const itens: any[] = det?.itens ?? [];
        for (const it of itens) {
          const sku = String(it?.produto?.sku ?? "").trim();
          const qtd = Number(it?.quantidade ?? 0) || 0;
          if (!sku || qtd <= 0) continue;
          rows.push({
            organization_id: orgId,
            ml_user_id: mlUserId,
            id_ordem_compra: String(h.id),
            numero_pedido: numero,
            sku,
            descricao: String(it?.produto?.descricao ?? "").slice(0, 500),
            quantidade: qtd,
            data_entrega: dataEntrega,
            data_pedido: dataPedido,
            situacao,
            fornecedor,
            preco_unitario: Number(it?.preco ?? 0) || null,
            synced_at: syncAt,
          });
        }
      } catch (e) {
        console.warn(`[sync-tiny-po] detalhe OC ${h.id} falhou:`, e instanceof Error ? e.message : String(e));
      }
      await sleep(RATE_MS);
    }
    console.log(`[sync-tiny-po] ${rows.length} linha(s) SKU montadas`);

    // 3) Snapshot: limpa as OCs da org e regrava as atuais (OC recebida some).
    //    Só apaga DEPOIS de buscar tudo com sucesso (não zera em caso de erro de fetch).
    const { error: delErr } = await sb.from("purchase_orders").delete().eq("organization_id", orgId);
    if (delErr) { console.error("[sync-tiny-po] delete org:", delErr.message); return; }

    let inserted = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200);
      const { error: insErr } = await sb.from("purchase_orders").insert(batch);
      if (insErr) console.error("[sync-tiny-po] insert batch:", insErr.message);
      else inserted += batch.length;
    }
    console.log(`[sync-tiny-po] runSync concluído. inserted=${inserted}, OCs=${headers.length}`);
  } catch (err: unknown) {
    console.error("[sync-tiny-po] runSync ERRO:", err instanceof Error ? err.message : String(err));
  }
}

// ── Main handler ────────────────────────────────────────────────────────────
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
    if (!userId && jwt !== SERVICE_KEY) return json({ error: "Unauthorized" }, 401);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* ok */ }
    const mlUserId = (body.ml_user_id as string) ?? null;
    if (!mlUserId) return json({ error: "ml_user_id obrigatório" }, 400);

    EdgeRuntime.waitUntil(runSync(mlUserId));
    return json({ ok: true, msg: "purchase-orders sync enqueued" }, 202);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("sync-tiny-purchase-orders error:", message);
    return json({ error: message }, 500);
  }
});
