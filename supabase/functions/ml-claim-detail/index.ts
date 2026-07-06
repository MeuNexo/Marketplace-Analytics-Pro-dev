/**
 * ml-claim-detail — user-invoked edge function (read-only)
 * verify_jwt = true (user JWT required via Supabase Auth)
 *
 * Busca o detalhe de uma reclamação/mediação + a thread de mensagens no ML,
 * para exibir tudo DENTRO do dashboard (sem sair para o ML).
 *
 * Gates: 1) JWT do usuário  2) validação do body  3) token por ml_user_id
 *        4) org membership (anti-IDOR)  5) GET detalhe + mensagens no ML.
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

const BodySchema = z.object({
  claim_id:   z.string().min(1),
  ml_user_id: z.string().min(1),
});

async function mlGetJson(url: string, token: string): Promise<any | null> {
  const res = await fetch(url, { headers: { Authorization: "Bearer " + token, "api-version": "2" } });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

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
    const { claim_id, ml_user_id } = parsed.data;

    const { data: tokenRow } = await supabase
      .from("ml_tokens").select("access_token, organization_id")
      .eq("ml_user_id", ml_user_id).not("access_token", "is", null).limit(1).maybeSingle();
    if (!tokenRow?.access_token) return jsonResponse({ error: "No ML token found for ml_user_id" }, 404);
    if (!tokenRow.organization_id) return jsonResponse({ error: "Forbidden" }, 403);

    const { data: isMember } = await supabase.rpc("is_org_member", { _user_id: userId, _org_id: tokenRow.organization_id });
    if (!isMember) return jsonResponse({ error: "Forbidden" }, 403);

    const at = tokenRow.access_token;
    // Detalhe (dual-URL, mesmo par do sync/webhook).
    const detail = (await mlGetJson(`${ML_API}/v1/claims/${claim_id}`, at))
                ?? (await mlGetJson(`${ML_API}/post-purchase/v1/claims/${claim_id}`, at));
    // Mensagens (endpoint post-purchase). Retorna [] se indisponível.
    const messagesRaw = (await mlGetJson(`${ML_API}/post-purchase/v1/claims/${claim_id}/messages`, at))
                     ?? (await mlGetJson(`${ML_API}/v1/claims/${claim_id}/messages`, at));

    const messages = Array.isArray(messagesRaw) ? messagesRaw
                   : (messagesRaw?.data ?? messagesRaw?.messages ?? []);

    return jsonResponse({
      ok: true,
      detail: detail ?? null,
      messages,
      available_actions: detail?.available_actions ?? detail?.actions_available ?? [],
    });
  } catch (err) {
    console.error("ml-claim-detail error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
