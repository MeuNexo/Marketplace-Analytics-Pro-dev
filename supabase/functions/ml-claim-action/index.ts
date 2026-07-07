/**
 * ml-claim-action — user-invoked edge function
 * verify_jwt = true (user JWT required via Supabase Auth)
 *
 * Executa uma AÇÃO do vendedor em uma reclamação do ML (reembolso, autorizar
 * devolução, abrir disputa) DENTRO do dashboard, sem sair para o ML.
 * Ações são IRREVERSÍVEIS.
 *
 * Whitelist estrita: 'refund' | 'allow_return' | 'open_dispute' (mensagem = reply-ml-claim).
 * Endpoints ML (doc oficial — NÃO é /actions/{action} genérico):
 *   - refund       -> POST /post-purchase/v1/claims/{claim_id}/expected-resolutions/refund
 *   - allow_return -> POST /post-purchase/v1/claims/{claim_id}/expected-resolutions/allow-return
 *   - open_dispute -> POST /post-purchase/v1/claims/{claim_id}/actions/open-dispute
 *
 * Gates: JWT do usuário → validação (whitelist) → token por ml_user_id →
 *        org membership (anti-IDOR, fail-closed) → GET claim p/ revalidar
 *        action ∈ available_actions do respondent (fail-closed) → POST da ação.
 * Segurança (T-42-04): access_token nunca é logado nem retornado.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const ML_API = "https://api.mercadolibre.com";

// Whitelist — nunca aceitar ação arbitrária vinda do cliente.
const ALLOWED_ACTIONS = ["refund", "open_dispute", "allow_return"] as const;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function mlGetJson(url: string, token: string): Promise<any | null> {
  const res = await fetch(url, { headers: { Authorization: "Bearer " + token, "api-version": "2" } });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

// Path correto por ação — doc oficial ML (gerenciar-resolucao-de-reclamacoes).
// NUNCA /actions/{action} genérico: refund/allow_return usam /expected-resolutions/*.
const ACTION_PATH: Record<(typeof ALLOWED_ACTIONS)[number], string> = {
  refund:       "expected-resolutions/refund",
  allow_return: "expected-resolutions/allow-return",
  open_dispute: "actions/open-dispute",
};

const BodySchema = z.object({
  claim_id:   z.string().min(1),
  ml_user_id: z.string().min(1),
  action:     z.enum(ALLOWED_ACTIONS),
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) return jsonResponse({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    let rawBody: unknown;
    try { rawBody = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON body" }, 400); }
    const parsed = BodySchema.safeParse(rawBody);
    if (!parsed.success) return jsonResponse({ error: "Validation error", details: parsed.error.flatten() }, 400);
    const { claim_id, ml_user_id, action } = parsed.data;

    const { data: tokenRow } = await supabase
      .from("ml_tokens").select("access_token, organization_id")
      .eq("ml_user_id", ml_user_id).not("access_token", "is", null).limit(1).maybeSingle();
    if (!tokenRow?.access_token) return jsonResponse({ error: "No ML token found for ml_user_id" }, 404);

    // anti-IDOR — fail CLOSED antes da ação irreversível
    if (!tokenRow.organization_id) return jsonResponse({ error: "Forbidden" }, 403);
    const { data: isMember } = await supabase.rpc("is_org_member", { _user_id: userId, _org_id: tokenRow.organization_id });
    if (!isMember) return jsonResponse({ error: "Forbidden" }, 403);

    // Revalida a ação contra as available_actions reais do respondent (fail-closed)
    // antes de disparar a ação irreversível.
    const at = tokenRow.access_token;
    const detail = await mlGetJson(`${ML_API}/post-purchase/v1/claims/${claim_id}`, at);
    const respondent = Array.isArray(detail?.players)
      ? detail.players.find((p: any) => p?.role === "respondent")
      : null;
    const availableActions: string[] = Array.isArray(respondent?.available_actions)
      ? respondent.available_actions.map((a: any) => a?.action).filter(Boolean)
      : [];
    if (!availableActions.includes(action)) {
      return jsonResponse({ error: "Ação '" + action + "' não disponível neste estágio da reclamação" }, 409);
    }

    const mlRes = await fetch(`${ML_API}/post-purchase/v1/claims/${claim_id}/${ACTION_PATH[action]}`, {
      method: "POST",
      headers: { Authorization: "Bearer " + at, "Content-Type": "application/json", Accept: "application/json", "api-version": "2" },
      body: JSON.stringify({}),
    });
    if (!mlRes.ok) {
      let mlMessage = "ML API error";
      try { const b = await mlRes.json(); mlMessage = b?.message ?? b?.cause ?? "ML API returned " + mlRes.status; } catch { /* */ }
      console.error("ml-claim-action: action=" + action + " status=" + mlRes.status);
      return jsonResponse({ error: mlMessage, ml_status: mlRes.status }, mlRes.status >= 500 ? 502 : mlRes.status);
    }

    console.log("ml-claim-action: action=" + action + " claim_id=" + claim_id + " ml_user_id=" + ml_user_id);
    return jsonResponse({ ok: true });
  } catch (err) {
    console.error("ml-claim-action error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
