// supabase/functions/ml-webhook/index.ts
//
// Webhook receiver do Mercado Livre (verify_jwt=false).
// ML faz POST em /functions/v1/ml-webhook/<secret> com { topic, resource, user_id, sent }.
// Fluxo: valida secret+seller → grava evento cru → responde 200 <500ms → processa em waitUntil.
// Confiabilidade: evento salvo antes de processar; nada se perde (T-42-04: nunca logar tokens).
//
// Modo reprocess (cron, Pattern B): POST com Bearer service_role_key repesca eventos presos.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL     = (Deno.env.get("SUPABASE_URL") ?? "").trim();
const SERVICE_KEY      = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
const ML_APP_ID        = Deno.env.get("ML_APP_ID") ?? "";
const ML_CLIENT_SECRET = Deno.env.get("ML_CLIENT_SECRET") ?? "";
const ML_API           = "https://api.mercadolibre.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function ok200() { return new Response("ok", { status: 200, headers: CORS }); }
function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// Timing-safe string compare (evita timing attack no secret).
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Extrai o secret do último segmento do path após "ml-webhook".
function secretFromPath(url: string): string {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  const idx = parts.lastIndexOf("ml-webhook");
  return idx >= 0 && parts.length > idx + 1 ? parts[idx + 1] : "";
}

// Secret do webhook vem do vault via RPC SECURITY DEFINER (vault não é exposto
// pelo PostgREST). Cache em memória por cold start.
let cachedSecret: string | null = null;
async function getWebhookSecret(sb: any): Promise<string> {
  if (cachedSecret !== null) return cachedSecret;
  const { data } = await sb.rpc("get_ml_webhook_secret");
  cachedSecret = (typeof data === "string" ? data : "") || "";
  return cachedSecret;
}

// ── ML token + GET (mesmo padrão de sync-ml-questions) ────────────────────────

async function getAccessToken(sb: any, mlUserId: string): Promise<string> {
  const { data: row } = await sb
    .from("ml_tokens").select("access_token,refresh_token,expires_at")
    .eq("ml_user_id", mlUserId).order("updated_at", { ascending: false })
    .limit(1).maybeSingle();
  if (!row) throw new Error("No ML token for ml_user_id=" + mlUserId);
  const expiresTs = row.expires_at ? new Date(row.expires_at).getTime() / 1000 : 0;
  if (row.access_token && expiresTs - Date.now() / 1000 > 300) return row.access_token;
  if (!row.refresh_token) throw new Error("No refresh token for ml_user_id=" + mlUserId);
  if (!ML_APP_ID || !ML_CLIENT_SECRET) throw new Error("ML_APP_ID/ML_CLIENT_SECRET not set");
  const resp = await fetch(ML_API + "/oauth/token", {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token", client_id: ML_APP_ID,
      client_secret: ML_CLIENT_SECRET, refresh_token: row.refresh_token }),
  });
  if (!resp.ok) throw new Error("Token refresh " + resp.status);
  const data = await resp.json();
  await sb.from("ml_tokens").update({
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? row.refresh_token,
    expires_at: new Date(Date.now() + (data.expires_in || 21600) * 1000).toISOString(),
  }).eq("ml_user_id", mlUserId);
  return data.access_token;
}

async function mlGet(url: string, token: string): Promise<any> {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, { headers: { Authorization: "Bearer " + token, "api-version": "2" } });
    if (res.ok) return res.json();
    if (res.status === 429) { await new Promise(r => setTimeout(r, 2000)); continue; }
    if (i < 2 && [500, 502, 503, 504].includes(res.status)) { await new Promise(r => setTimeout(r, 1000 * (i + 1))); continue; }
    throw new Error("ML " + res.status + " " + url.split("?")[0]);
  }
  throw new Error("ML retries exhausted");
}

// ── Normalização (mesmo shape dos syncs) ──────────────────────────────────────

function questionRow(q: any, orgId: string, mlUserId: string) {
  return {
    organization_id: orgId, ml_user_id: mlUserId, question_id: q.id,
    item_id: q.item_id ?? null, texto: q.text ?? "",
    status: String(q.status ?? "UNANSWERED").toUpperCase(),
    comprador_id: String(q.from?.id ?? ""), data_pergunta: q.date_created ?? null,
    resposta: q.answer?.text ?? null, data_resposta: q.answer?.date_created ?? null,
    synced_at: new Date().toISOString(),
  };
}
function claimRow(c: any, orgId: string, mlUserId: string) {
  return {
    organization_id: orgId, ml_user_id: mlUserId, claim_id: String(c.id ?? ""),
    order_id: c.resource_id != null ? String(c.resource_id) : null,
    tipo: c.type ?? "mediations", status: c.status ?? "opened",
    motivo: c.reason_id ?? null,
    data_abertura: (c.date_created ?? "").substring(0, 10) || null,
    data_limite: (c.resolution_due_date ?? "").substring(0, 10) || null,
    solucao: c.resolution?.type ?? null, synced_at: new Date().toISOString(),
  };
}

async function markEvent(sb: any, id: string, patch: Record<string, unknown>) {
  await sb.from("ml_webhook_events").update(patch).eq("id", id);
}
async function bumpAttempts(sb: any, id: string): Promise<number> {
  const { data } = await sb.from("ml_webhook_events").select("attempts").eq("id", id).maybeSingle();
  return ((data?.attempts as number) ?? 0) + 1;
}

// ── Processamento de 1 evento ─────────────────────────────────────────────────

async function processEvent(sb: any, ev: {
  id: string; topic: string; resource: string; ml_user_id: string; organization_id: string;
}): Promise<void> {
  try {
    if (ev.topic === "questions") {
      const token = await getAccessToken(sb, ev.ml_user_id);
      const q = await mlGet(ML_API + ev.resource, token);
      const { error } = await sb.from("ml_questions")
        .upsert([questionRow(q, ev.organization_id, ev.ml_user_id)],
          { onConflict: "organization_id,ml_user_id,question_id" });
      if (error) throw new Error(error.message);
    } else if (ev.topic === "claims") {
      const token = await getAccessToken(sb, ev.ml_user_id);
      // Notificação manda resource "/claims/{id}", mas o GET de 1 claim exige prefixo
      // /v1 (ou /post-purchase/v1 como fallback) — mesmo par de URLs do sync-ml-claims.
      const claimId = ev.resource.split("/").filter(Boolean).pop();
      let c: any;
      try { c = await mlGet(ML_API + "/v1/claims/" + claimId, token); }
      catch { c = await mlGet(ML_API + "/post-purchase/v1/claims/" + claimId, token); }
      const { error } = await sb.from("ml_claims")
        .upsert([claimRow(c, ev.organization_id, ev.ml_user_id)],
          { onConflict: "organization_id,ml_user_id,claim_id" });
      if (error) throw new Error(error.message);
    } else if (ev.topic === "orders" || ev.topic === "orders_v2") {
      // Debounce: se já houve order processado deste seller nos últimos 60s, não redispara.
      const since = new Date(Date.now() - 60_000).toISOString();
      const { count } = await sb.from("ml_webhook_events")
        .select("id", { count: "exact", head: true })
        .eq("ml_user_id", ev.ml_user_id).in("topic", ["orders", "orders_v2"])
        .eq("status", "processed").gte("processed_at", since);
      if ((count ?? 0) === 0) {
        const brtNow = new Date(Date.now() - 3 * 60 * 60 * 1000); // hoje em BRT (UTC-3)
        const today  = brtNow.toISOString().substring(0, 10);
        const resp = await fetch(SUPABASE_URL + "/functions/v1/sync-ml-orders", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + SERVICE_KEY },
          body: JSON.stringify({ ml_user_id: ev.ml_user_id, date_from: today, date_to: today }),
        });
        if (!resp.ok) throw new Error("sync-ml-orders " + resp.status);
      }
    } else {
      // Tópico desconhecido: deixa 'received' sem processar (aceita futuro sem quebrar).
      return;
    }
    await markEvent(sb, ev.id, { status: "processed", processed_at: new Date().toISOString(), error_msg: null });
  } catch (e: any) {
    const attempts = await bumpAttempts(sb, ev.id);
    await markEvent(sb, ev.id, { status: "error", error_msg: String(e?.message ?? e), attempts });
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const auth = req.headers.get("Authorization") ?? "";
  const isServiceCall = SERVICE_KEY.length > 0 && auth === "Bearer " + SERVICE_KEY;

  // Reprocess mode: cron (Pattern B) repesca eventos presos há >5min.
  if (isServiceCall) {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: stuck } = await sb.from("ml_webhook_events")
      .select("id,topic,resource,ml_user_id,organization_id")
      .in("status", ["received", "error"]).lt("attempts", 5)
      .not("organization_id", "is", null).lt("received_at", cutoff)
      .order("received_at", { ascending: true }).limit(50);
    let done = 0;
    for (const ev of (stuck ?? [])) { await processEvent(sb, ev as any); done++; }
    return jsonResp({ ok: true, reprocessed: done });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1. Valida secret no path.
  const provided = secretFromPath(req.url);
  const secret = await getWebhookSecret(sb);
  if (!secret || !safeEqual(provided, secret)) {
    console.warn("ml-webhook: secret inválido");
    return ok200(); // 200 mudo — não vira retry infinito nem revela nada.
  }

  let body: any = {};
  try { body = await req.json(); } catch { return ok200(); }

  const topic    = String(body.topic ?? "");
  const resource = String(body.resource ?? "");
  const mlUserId = body.user_id != null ? String(body.user_id) : null;
  const sentAt   = body.sent ?? null;
  if (!topic || !resource) return ok200();

  // 2. Resolve seller pelo user_id da notificação.
  let orgId: string | null = null;
  if (mlUserId) {
    const { data: tok } = await sb
      .from("ml_tokens").select("organization_id")
      .eq("ml_user_id", mlUserId).limit(1).maybeSingle();
    orgId = (tok?.organization_id as string | undefined) ?? null;
  }
  const rejected = !orgId; // seller desconhecido

  // 3. Grava evento cru (dedup por (topic,resource,sent_at)).
  const { data: inserted, error: insErr } = await sb
    .from("ml_webhook_events")
    .upsert(
      { topic, resource, ml_user_id: mlUserId, organization_id: orgId,
        status: rejected ? "rejected" : "received", raw: body, sent_at: sentAt },
      { onConflict: "topic,resource,sent_at", ignoreDuplicates: true },
    )
    .select("id").maybeSingle();
  if (insErr) console.error("ml-webhook insert:", insErr.message);

  // 4. Responde 200 já; processa em background (só se não rejeitado e não duplicado).
  if (!rejected && orgId && inserted?.id) {
    const ev = { id: inserted.id as string, topic, resource, ml_user_id: mlUserId!, organization_id: orgId };
    // @ts-ignore EdgeRuntime é global no Supabase Edge
    EdgeRuntime.waitUntil(processEvent(sb, ev));
  }
  return ok200();
});
