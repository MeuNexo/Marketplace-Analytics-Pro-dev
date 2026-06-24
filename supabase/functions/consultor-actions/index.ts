/**
 * consultor-actions — user-invoked edge function (verify_jwt = true)
 *
 * Executor das 5 mutações ML da fila de aprovação do Consultor v2 (Phase 54):
 *   update_price | pause_listing | activate_listing | pause_ads_campaign | update_ads_budget
 *
 * Dois modos:
 *   - dry_run=true  → computa o payload ML e grava proposed_actions.dry_run_preview
 *                     SEM tocar o ML, sem gate, sem pre-flight, sem audit (ACT-01).
 *   - dry_run=false → pipeline real: auth/owner → TTL → gate atômico → pre-flight →
 *                     token-por-org (+refresh) → write ML (retry) → audit + estado final.
 *
 * Gates de segurança, NESTA ordem (espelha 54-RESEARCH.md:154-168):
 *   1. JWT (Bearer → supabase.auth.getUser) → 401 (T-54-02)
 *   2. Fetch da ação por id (service_role); 404 se inexistente
 *   3. Owner-check via get_org_role na action.organization_id → 403 (anti-IDOR, T-54-02)
 *   4. dry_run=true: preview e encerra
 *   5. TTL/staleness: approved há >48h → expired/409 (ACT-07, D-A3, T-54-03)
 *   6. Gate atômico claim_approved_action: 0 linhas → 409 ANTES de tocar o ML (ACT-06, T-54-01)
 *   7. Pre-flight: re-lê o ML; no_op se no alvo, conflict/409 se divergiu (ACT-07, T-54-03)
 *   8. Token da org (lookup 2 colunas, anti-IDOR) + refresh inline (T-54-02/06)
 *   9. Write ML inline com retry 429/5xx (PUT idempotente) (T-54-07)
 *  10. Audit por transição (detail ML trimado ≤4KB) + estado final done/failed (ACT-05, T-54-04/05)
 *
 * Segurança (T-54-06): access_token NUNCA é logado nem retornado.
 * NÃO faz EF-to-EF: todas as chamadas ML são inline (molde reply-ml-question).
 *
 * Supabase project: ckcdevcxgvueywivefgx.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const ML_API = "https://api.mercadolibre.com";
const ML_ADV_API = "https://api.mercadolibre.com"; // base de Product Ads (nova API)
const TTL_MS = 48 * 60 * 60 * 1000; // D-A3: 48h de validade do approved
const AUDIT_DETAIL_CAP = 4096; // Pitfall 4 / T-54-05: cap do corpo ML no audit

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// dry_run default false: execução real exige opt-in explícito do dry_run.
const BodySchema = z.object({
  action_id: z.string().uuid(),
  dry_run: z.boolean().optional().default(false),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// T-54-05 / Pitfall 4: serializa e corta o corpo ML a ≤4KB. Nunca deixa o INSERT
// do audit falhar por payload grande. Guarda o corpo como string em detail.ml_body.
function trimDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...detail };
  if (out.ml_body !== undefined && typeof out.ml_body !== "string") {
    out.ml_body = JSON.stringify(out.ml_body);
  }
  if (typeof out.ml_body === "string" && out.ml_body.length > AUDIT_DETAIL_CAP) {
    out.ml_body = out.ml_body.slice(0, AUDIT_DETAIL_CAP);
  }
  return out;
}

// ── ML write helper: PUT idempotente com retry 429/5xx (T-54-07) ──────────────
// Nunca loga o token. Replica _ml_put/_adv_request do Nexo MCP.
async function mlPut(
  url: string,
  body: unknown,
  token: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const delays = [2000, 8000];
  let last: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    });
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "", 10);
      const wait = Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : delays[Math.min(attempt, 1)];
      console.warn("consultor-actions: ML 429 — aguardando " + wait + "ms");
      await sleep(wait);
      last = res;
      continue;
    }
    if ([500, 502, 503, 504].includes(res.status) && attempt < 2) {
      console.warn("consultor-actions: ML " + res.status + " — retry " + (attempt + 1) + "/3");
      await sleep(delays[attempt]);
      last = res;
      continue;
    }
    return res;
  }
  return last as Response;
}

async function mlGet(
  url: string,
  token: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return fetch(url, {
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/json",
      ...extraHeaders,
    },
  });
}

// Resolve o advertiser_id PADS do seller (obrigatório p/ writes de ads). Nexo MCP.
async function resolveAdvertiser(token: string): Promise<string> {
  const res = await mlGet(
    ML_ADV_API + "/advertising/advertisers?product_id=PADS",
    token,
    { "api-version": "2" },
  );
  if (!res.ok) {
    throw new Error("advertiser_unresolved:" + res.status);
  }
  const body = await res.json();
  const advertisers = body?.advertisers ?? [];
  if (!advertisers.length || !advertisers[0]?.advertiser_id) {
    throw new Error("advertiser_none");
  }
  return String(advertisers[0].advertiser_id);
}

// Monta { method, path, body, headers? } para um action_type. Usado tanto no
// dry_run (preview, sem chamar o ML) quanto na execução (Task 2).
async function buildPayload(
  action: any,
  token: string,
): Promise<{ url: string; body: unknown; headers: Record<string, string>; needsAdvertiser: boolean }> {
  const targetRef = String(action.target_ref);
  const proposed = action.proposed_value ?? {};
  switch (action.action_type) {
    case "update_price": {
      const url = proposed.variation_id
        ? ML_API + "/items/" + targetRef + "/variations/" + proposed.variation_id
        : ML_API + "/items/" + targetRef;
      return { url, body: { price: proposed.price }, headers: {}, needsAdvertiser: false };
    }
    case "pause_listing":
      return { url: ML_API + "/items/" + targetRef, body: { status: "paused" }, headers: {}, needsAdvertiser: false };
    case "activate_listing":
      return { url: ML_API + "/items/" + targetRef, body: { status: "active" }, headers: {}, needsAdvertiser: false };
    case "pause_ads_campaign": {
      const adv = await resolveAdvertiser(token);
      return {
        url: ML_ADV_API + "/advertising/product_ads/campaigns/" + targetRef + "?advertiser_id=" + adv,
        body: { status: "paused" },
        headers: { "api-version": "2" },
        needsAdvertiser: true,
      };
    }
    case "update_ads_budget": {
      const adv = await resolveAdvertiser(token);
      return {
        url: ML_ADV_API + "/advertising/product_ads/campaigns/" + targetRef + "?advertiser_id=" + adv,
        body: { budget: proposed.budget }, // D-A1: campo `budget`
        headers: { "api-version": "2" },
        needsAdvertiser: true,
      };
    }
    default:
      throw new Error("unsupported_action_type:" + action.action_type);
  }
}

// Pre-flight: lê o estado ATUAL do ML para o action_type e devolve o campo
// relevante (preço/status do item, ou status/budget da campanha).
async function readCurrentMlState(
  action: any,
  token: string,
): Promise<{ field: string; value: unknown }> {
  const targetRef = String(action.target_ref);
  switch (action.action_type) {
    case "update_price": {
      const res = await mlGet(ML_API + "/items/" + targetRef + "?attributes=price,status", token);
      if (!res.ok) throw new Error("preflight_get_failed:" + res.status);
      const item = await res.json();
      return { field: "price", value: item?.price };
    }
    case "pause_listing":
    case "activate_listing": {
      const res = await mlGet(ML_API + "/items/" + targetRef + "?attributes=status", token);
      if (!res.ok) throw new Error("preflight_get_failed:" + res.status);
      const item = await res.json();
      return { field: "status", value: item?.status };
    }
    case "pause_ads_campaign":
    case "update_ads_budget": {
      const adv = await resolveAdvertiser(token);
      const res = await mlGet(
        ML_ADV_API + "/advertising/advertisers/" + adv + "/product_ads/campaigns?limit=50&offset=0",
        token,
        { "api-version": "2" },
      );
      if (!res.ok) throw new Error("preflight_get_failed:" + res.status);
      const body = await res.json();
      const campaigns = body?.campaigns ?? body?.results ?? [];
      const match = campaigns.find(
        (c: any) => String(c.id ?? c.campaign_id) === targetRef,
      );
      if (action.action_type === "update_ads_budget") {
        return { field: "budget", value: match ? Number(match.budget ?? match.daily_budget ?? 0) : undefined };
      }
      return { field: "status", value: match?.status };
    }
    default:
      throw new Error("unsupported_action_type:" + action.action_type);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Helper local de audit (service_role; imutável por ausência de UPDATE/DELETE).
  async function insertAudit(
    action: any,
    fromStatus: string,
    toStatus: string,
    actorId: string | null,
    detail: Record<string, unknown>,
  ) {
    const { error } = await supabase.from("action_audit_log").insert({
      organization_id: action.organization_id,
      action_id: action.id,
      actor_id: actorId,
      from_status: fromStatus,
      to_status: toStatus,
      detail: trimDetail(detail),
    });
    if (error) {
      console.error("consultor-actions: audit insert failed:", error.message);
    }
  }

  try {
    // ── 1. JWT validation ─────────────────────────────────────────────────────
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const userToken = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await supabase.auth.getUser(userToken);
    if (claimsErr || !claimsData?.user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const userId = claimsData.user.id;

    // ── 2. Body validation ────────────────────────────────────────────────────
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }
    const parsed = BodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return jsonResponse({ error: "Validation error", details: parsed.error.flatten() }, 400);
    }
    const { action_id, dry_run } = parsed.data;

    // ── 3. Fetch da ação (service_role) ───────────────────────────────────────
    const { data: action, error: actionErr } = await supabase
      .from("proposed_actions")
      .select("*")
      .eq("id", action_id)
      .maybeSingle();
    if (actionErr || !action) {
      return jsonResponse({ error: "Action not found" }, 404);
    }

    // ── 4. Owner-check (anti-IDOR, T-54-02) ───────────────────────────────────
    // A ação carrega sua própria organization_id; o caller só prossegue se for
    // owner DELA. get_org_role retorna NULL se o caller não é membro da org.
    const { data: role } = await supabase.rpc("get_org_role", {
      _user_id: userId,
      _org_id: action.organization_id,
    });
    if (role !== "owner") {
      return jsonResponse({ error: "Forbidden" }, 403);
    }

    // ── 5. dry_run=true: preview sem tocar o ML (ACT-01) ──────────────────────
    if (dry_run) {
      // O preview precisa do token só p/ resolver advertiser nos casos de ads.
      const { data: tokenRow } = await supabase
        .from("ml_tokens")
        .select("access_token")
        .eq("ml_user_id", action.ml_user_id)
        .eq("organization_id", action.organization_id)
        .not("access_token", "is", null)
        .maybeSingle();

      let payloadPreview: unknown = null;
      try {
        if (tokenRow?.access_token) {
          const built = await buildPayload(action, tokenRow.access_token as string);
          payloadPreview = { url: built.url, method: "PUT", body: built.body };
        }
      } catch (e) {
        // No dry_run não falhamos por advertiser/token: preview parcial é aceitável.
        console.warn("consultor-actions: dry_run payload parcial:", String(e));
      }

      const preview = {
        current: action.current_value,
        proposed: action.proposed_value,
        payload: payloadPreview,
        estimated_impact_brl: action.estimated_impact_brl,
        computed_at: new Date().toISOString(),
      };
      await supabase
        .from("proposed_actions")
        .update({ dry_run_preview: preview, updated_at: new Date().toISOString() })
        .eq("id", action.id);

      return jsonResponse({ ok: true, dry_run: true, preview });
    }

    // ── 6. TTL/staleness (ACT-07, D-A3) ───────────────────────────────────────
    if (action.status === "approved" && action.approved_at) {
      const approvedMs = new Date(action.approved_at).getTime();
      if (Number.isFinite(approvedMs) && Date.now() - approvedMs > TTL_MS) {
        await supabase
          .from("proposed_actions")
          .update({ status: "failed", result_summary: "expired", updated_at: new Date().toISOString() })
          .eq("id", action.id);
        await insertAudit(action, "approved", "failed", userId, { reason: "ttl_expired" });
        return jsonResponse({ error: "expired" }, 409);
      }
    }

    // ── 7. Gate atômico (ACT-06, T-54-01) ─────────────────────────────────────
    // claim_approved_action move approved→executing atomicamente. 0 linhas =
    // ação já reivindicada/duplicada ou em estado errado → 409 ANTES do ML.
    const { data: claimed, error: claimErr } = await supabase.rpc(
      "claim_approved_action",
      { p_action_id: action_id },
    );
    if (claimErr) {
      console.error("consultor-actions: claim error:", claimErr.message);
      return jsonResponse({ error: "Internal server error" }, 500);
    }
    // RPC RETURNS proposed_actions (linha única) — null/vazio = nada casou.
    const claimedRow = Array.isArray(claimed) ? claimed[0] : claimed;
    if (!claimedRow) {
      await insertAudit(action, action.status, action.status, userId, { reason: "gate_not_approved" });
      return jsonResponse({ error: "conflict", detail: "action_not_claimable" }, 409);
    }
    // a partir daqui a ação está 'executing' no banco.

    // ── 8. Token da org (lookup 2 colunas, anti-IDOR) ─────────────────────────
    const { data: tokenRow, error: tokenErr } = await supabase
      .from("ml_tokens")
      .select("id, access_token, organization_id, expires_at, refresh_token")
      .eq("ml_user_id", action.ml_user_id)
      .eq("organization_id", action.organization_id)
      .not("access_token", "is", null)
      .maybeSingle();

    if (tokenErr || !tokenRow?.access_token) {
      await supabase
        .from("proposed_actions")
        .update({ status: "failed", result_summary: "no_token", updated_at: new Date().toISOString() })
        .eq("id", action.id);
      await insertAudit(action, "executing", "failed", userId, { reason: "no_token" });
      return jsonResponse({ error: "no_token" }, 409);
    }

    let accessToken = tokenRow.access_token as string;

    // Refresh inline se expirado ou a <5min de expirar (mesmo payload do
    // ml-token-refresh). ML_APP_ID/ML_CLIENT_SECRET no env (Pattern B).
    const expiresMs = tokenRow.expires_at ? new Date(tokenRow.expires_at).getTime() : 0;
    if (!expiresMs || expiresMs - Date.now() < 5 * 60 * 1000) {
      try {
        const refreshRes = await fetch(ML_API + "/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            grant_type: "refresh_token",
            client_id: Deno.env.get("ML_APP_ID"),
            client_secret: Deno.env.get("ML_CLIENT_SECRET"),
            refresh_token: tokenRow.refresh_token,
          }),
        });
        if (refreshRes.ok) {
          const refreshed = await refreshRes.json();
          accessToken = refreshed.access_token;
          await supabase
            .from("ml_tokens")
            .update({
              access_token: refreshed.access_token,
              refresh_token: refreshed.refresh_token,
              expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", tokenRow.id);
        } else {
          console.warn("consultor-actions: refresh falhou status=" + refreshRes.status);
        }
      } catch (e) {
        console.warn("consultor-actions: refresh exception:", String(e));
      }
    }

    // ── 9. Pre-flight (ACT-07, T-54-03) ───────────────────────────────────────
    // Compara o estado ATUAL do ML com current_value/proposed_value.
    const proposedVal = action.proposed_value ?? {};
    let stateBefore: { field: string; value: unknown };
    try {
      stateBefore = await readCurrentMlState(action, accessToken);
    } catch (e) {
      await supabase
        .from("proposed_actions")
        .update({ status: "failed", result_summary: "preflight_error", updated_at: new Date().toISOString() })
        .eq("id", action.id);
      await insertAudit(action, "executing", "failed", userId, { reason: "preflight_error", message: String(e) });
      return jsonResponse({ error: "preflight_error" }, 502);
    }

    // alvo (proposed) e baseline (current) do campo relevante
    const targetField = stateBefore.field;
    const targetValue =
      targetField === "price" ? proposedVal.price
      : targetField === "budget" ? proposedVal.budget
      : proposedVal.status ?? (action.action_type === "pause_listing" ? "paused" : action.action_type === "activate_listing" ? "active" : undefined);
    const baselineValue =
      targetField === "price" ? (action.current_value?.price)
      : targetField === "budget" ? (action.current_value?.budget)
      : (action.current_value?.status);

    const eq = (a: unknown, b: unknown) =>
      a !== undefined && b !== undefined && String(a) === String(b);

    // 9a. Já no alvo → no_op (D-A4), marca done sem write.
    if (eq(stateBefore.value, targetValue)) {
      await supabase
        .from("proposed_actions")
        .update({ status: "done", result_summary: "no_op", executed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", action.id);
      await insertAudit(action, "executing", "done", userId, { result: "no_op", state_before: stateBefore });
      return jsonResponse({ ok: true, result: "no_op" }, 200);
    }

    // 9b. Estado divergiu para algo inesperado (≠ current e ≠ proposed) → conflict.
    if (baselineValue !== undefined && !eq(stateBefore.value, baselineValue)) {
      await supabase
        .from("proposed_actions")
        .update({ status: "failed", result_summary: "conflict", updated_at: new Date().toISOString() })
        .eq("id", action.id);
      await insertAudit(action, "executing", "failed", userId, {
        result: "conflict",
        state_before: stateBefore,
        expected: baselineValue,
      });
      return jsonResponse({ error: "stale", detail: "ml_state_changed" }, 409);
    }

    // ── 10. Write ML inline (T-54-07) ─────────────────────────────────────────
    let built: { url: string; body: unknown; headers: Record<string, string> };
    try {
      built = await buildPayload(action, accessToken);
    } catch (e) {
      await supabase
        .from("proposed_actions")
        .update({ status: "failed", result_summary: "ml_error", updated_at: new Date().toISOString() })
        .eq("id", action.id);
      await insertAudit(action, "executing", "failed", userId, { reason: "build_payload", message: String(e) });
      return jsonResponse({ error: "ml_error", detail: String(e) }, 502);
    }

    const mlRes = await mlPut(built.url, built.body, accessToken, built.headers);
    let mlBody: unknown = null;
    try {
      mlBody = await mlRes.json();
    } catch { /* corpo vazio/não-json */ }

    if (!mlRes.ok) {
      const mlMessage =
        (mlBody as any)?.message ?? (mlBody as any)?.cause ?? "ML API returned " + mlRes.status;
      await supabase
        .from("proposed_actions")
        .update({ status: "failed", result_summary: "ml_error", updated_at: new Date().toISOString() })
        .eq("id", action.id);
      await insertAudit(action, "executing", "failed", userId, {
        ml_status: mlRes.status,
        ml_body: mlBody,
        state_before: stateBefore,
        action_type: action.action_type,
      });
      console.error("consultor-actions: ML write status=" + mlRes.status + " action=" + action.id);
      return jsonResponse(
        { error: mlMessage, ml_status: mlRes.status },
        mlRes.status >= 500 ? 502 : mlRes.status,
      );
    }

    // ── Sucesso: estado final done + audit ────────────────────────────────────
    await supabase
      .from("proposed_actions")
      .update({ status: "done", result_summary: "applied", executed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", action.id);
    await insertAudit(action, "executing", "done", userId, {
      ml_status: mlRes.status,
      ml_body: mlBody,
      state_before: stateBefore,
      action_type: action.action_type,
    });

    console.log("consultor-actions: applied action=" + action.id + " type=" + action.action_type);
    return jsonResponse({ ok: true, result: "applied" }, 200);

  } catch (err) {
    console.error("consultor-actions error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
