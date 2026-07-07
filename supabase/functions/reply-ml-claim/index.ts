/**
 * reply-ml-claim — user-invoked edge function
 * verify_jwt = true (user JWT required via Supabase Auth)
 *
 * Envia uma mensagem de texto em uma reclamação/mediação do ML em nome do
 * usuário autenticado (atendimento DENTRO do dashboard, sem sair para o ML).
 * O envio é irreversível (a mensagem vai ao comprador/mediador).
 *
 * Endpoint ML: POST /post-purchase/v1/claims/{claim_id}/actions/send-message
 * Body: { receiver_role, message }. O ML deriva a action send_message_to_{role}
 * a partir de receiver_role — sem esse campo retorna 400 "param action is null".
 * receiver_role é derivado das available_actions reais do player 'respondent'
 * (GET claim antes do POST), nunca hardcoded. Fail-closed se send_message_to_*
 * não estiver disponível no estágio atual da reclamação.
 *
 * Gates: 1) JWT do usuário  2) validação do body  3) token por ml_user_id
 *        4) org membership (anti-IDOR)  5) GET claim p/ derivar receiver_role
 *        (fail-closed)  6) POST send-message  7) log local.
 * Segurança (T-42-04): access_token nunca é logado nem retornado.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const ML_API = "https://api.mercadolibre.com";

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

// Mapeia a action send_message_to_{role} disponível para o receiver_role
// exigido pelo body do ML. Nunca hardcoded — vem das available_actions reais.
const SEND_MESSAGE_ROLE_BY_ACTION: Record<string, string> = {
  send_message_to_complainant: "complainant",
  send_message_to_mediator:    "mediator",
  send_message_to_respondent:  "respondent",
};

const BodySchema = z.object({
  claim_id:   z.string().min(1),
  text:       z.string().min(1).max(2000),
  ml_user_id: z.string().min(1),
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // 1. JWT do usuário
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) return jsonResponse({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    // 2. Body
    let rawBody: unknown;
    try { rawBody = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON body" }, 400); }
    const parsed = BodySchema.safeParse(rawBody);
    if (!parsed.success) return jsonResponse({ error: "Validation error", details: parsed.error.flatten() }, 400);
    const { claim_id, text, ml_user_id } = parsed.data;

    // 3. Token por ml_user_id
    const { data: tokenRow } = await supabase
      .from("ml_tokens").select("access_token, organization_id")
      .eq("ml_user_id", ml_user_id).not("access_token", "is", null).limit(1).maybeSingle();
    if (!tokenRow?.access_token) return jsonResponse({ error: "No ML token found for ml_user_id" }, 404);

    // 4. Org membership (anti-IDOR) — fail CLOSED antes do POST irreversível
    if (!tokenRow.organization_id) return jsonResponse({ error: "Forbidden" }, 403);
    const { data: isMember } = await supabase.rpc("is_org_member", { _user_id: userId, _org_id: tokenRow.organization_id });
    if (!isMember) return jsonResponse({ error: "Forbidden" }, 403);

    // 5. Deriva receiver_role das available_actions reais do respondent (fail-closed).
    const at = tokenRow.access_token;
    const detail = await mlGetJson(`${ML_API}/post-purchase/v1/claims/${claim_id}`, at);
    const respondent = Array.isArray(detail?.players)
      ? detail.players.find((p: any) => p?.role === "respondent")
      : null;
    const availableActions: string[] = Array.isArray(respondent?.available_actions)
      ? respondent.available_actions.map((a: any) => a?.action).filter(Boolean)
      : [];
    const sendMessageAction = availableActions.find((a) => a in SEND_MESSAGE_ROLE_BY_ACTION);
    const receiverRole = sendMessageAction ? SEND_MESSAGE_ROLE_BY_ACTION[sendMessageAction] : null;
    if (!receiverRole) {
      return jsonResponse({ error: "Envio de mensagem não disponível neste estágio da reclamação" }, 409);
    }

    // 6. Envia a mensagem no ML (não logar access_token)
    const mlRes = await fetch(`${ML_API}/post-purchase/v1/claims/${claim_id}/actions/send-message`, {
      method: "POST",
      headers: { Authorization: "Bearer " + at, "Content-Type": "application/json", Accept: "application/json", "api-version": "2" },
      body: JSON.stringify({ receiver_role: receiverRole, message: text }),
    });
    if (!mlRes.ok) {
      let mlMessage = "ML API error";
      try { const b = await mlRes.json(); mlMessage = b?.message ?? b?.cause ?? "ML API returned " + mlRes.status; } catch { /* */ }
      console.error("reply-ml-claim: ML send-message status=" + mlRes.status);
      return jsonResponse({ error: mlMessage, ml_status: mlRes.status }, mlRes.status >= 500 ? 502 : mlRes.status);
    }

    console.log("reply-ml-claim: sent claim_id=" + claim_id + " ml_user_id=" + ml_user_id);
    return jsonResponse({ ok: true });
  } catch (err) {
    console.error("reply-ml-claim error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
