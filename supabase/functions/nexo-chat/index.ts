/**
 * nexo-chat — EF do chat conversacional "Nexo" (Phase 57). Provedor: Gemini 2.5 Pro.
 *
 * Esqueleto de segurança clonado da `consultor-llm`:
 *   auth (Bearer JWT → getUser) → is_org_member (anti-IDOR) → kill-switch
 *   (consultor_config.llm_enabled) → vault get_app_secret('GEMINI_API_KEY') →
 *   chamada Gemini 2.5 Pro non-streaming.
 *
 * Plan 57-02: a chamada única do Gemini foi SUBSTITUÍDA pelo loop server-side de
 * function-calling read-only (runChat). mlUserIds é resolvido server-side de
 * ml_tokens WHERE organization_id (NEXO-03: nunca do modelo). Read-only: nenhuma
 * mutação no ML.
 *
 * CRÍTICO (Gemini 2.5 Pro): thinkingConfig.thinkingBudget = -1 (dinâmico). NUNCA 0
 * no 2.5-pro (retorna HTTP 400). O modelo é configurável via consultor_config.llm_model
 * (fallback gemini-2.5-pro).
 *
 * verify_jwt=true: auth por JWT do usuário + is_org_member (anti-IDOR por org).
 * GEMINI_API_KEY só do vault (service_role). Logs registram apenas status — nunca
 * JWT, API key nem corpo sensível.
 *
 * Supabase project: ckcdevcxgvueywivefgx.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildSystemPrompt } from "./prompt.ts";
import { runChat } from "./loop.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const j = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// histórico efêmero do cliente, no formato Gemini contents
type GeminiPart = { text?: string };
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

function isValidMessages(m: unknown): m is GeminiContent[] {
  if (!Array.isArray(m) || m.length === 0) return false;
  return m.every(
    (c) =>
      c &&
      (c.role === "user" || c.role === "model") &&
      Array.isArray(c.parts),
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, key);

  try {
    const body = await req.json().catch(() => ({}));
    const orgId: string | undefined = body.org_id;
    const messages: unknown = body.messages;

    // ── auth: JWT do usuário + membership na org (anti-IDOR) ────────────────
    const auth = req.headers.get("authorization");
    if (!auth?.startsWith("Bearer ")) return j({ error: "Unauthorized" }, 401);
    const { data: u, error: ue } = await sb.auth.getUser(auth.replace("Bearer ", ""));
    if (ue || !u?.user) return j({ error: "Unauthorized" }, 401);
    if (!orgId) return j({ error: "org_id required" }, 400);
    const { data: member } = await sb.rpc("is_org_member", { _user_id: u.user.id, _org_id: orgId });
    if (!member) return j({ error: "Forbidden" }, 403);

    // ── body válido: messages não-vazio no formato Gemini contents ──────────
    if (!isValidMessages(messages)) return j({ error: "messages required" }, 400);

    // ── kill-switch (NEXO-06) ───────────────────────────────────────────────
    const { data: cfg } = await sb.from("consultor_config")
      .select("llm_enabled, llm_model").eq("organization_id", orgId).maybeSingle();
    if (cfg && cfg.llm_enabled === false) return j({ disabled: true });

    // ── vault: GEMINI_API_KEY (nunca env hardcoded) ─────────────────────────
    const gkey = await sb.rpc("get_app_secret", { p_name: "GEMINI_API_KEY" }).then((r) => r.data);
    if (!gkey) return j({ error: "gemini_key_missing" }, 500);

    // ── mlUserIds resolvido SERVER-SIDE (NEXO-03: nunca do modelo) ───────────
    // ml_tokens WHERE organization_id (com refresh_token) — mesmo padrão da
    // consultor-insights. O modelo nunca fornece seller/loja; o dispatcher de
    // tools só recebe estes ids do servidor.
    const { data: tokenRows } = await sb
      .from("ml_tokens")
      .select("ml_user_id")
      .eq("organization_id", orgId)
      .not("refresh_token", "is", null);
    const mlUserIds = ((tokenRows ?? []) as Array<{ ml_user_id: string }>).map((r) => r.ml_user_id);

    // só honra llm_model se for um modelo Gemini; senão usa o default (gemini-2.5-pro
    // em loop.ts). Protege contra o default legado da coluna ('claude-haiku-4-5'),
    // que apontaria a URL do Gemini para um modelo inexistente → 404.
    const cfgModel = cfg?.llm_model as string | null | undefined;
    const model = cfgModel && cfgModel.startsWith("gemini") ? cfgModel : undefined;

    // ── loop server-side de function-calling read-only (Plan 57-02) ─────────
    // userJwt = JWT real do usuário — reutiliza o mesmo valor já lido para getUser
    // acima. É repassado ao runChat → loop → dispatchTool apenas para tools que
    // invocam EFs que exigem JWT do usuário (ex.: get_reputation → ml-reputation).
    // NUNCA logado, NUNCA exposto ao modelo.
    const userJwt = auth.replace("Bearer ", "");
    const { reply, usedTools, fallback } = await runChat(
      sb,
      gkey,
      orgId,
      mlUserIds,
      buildSystemPrompt(),
      messages,
      { model, userJwt },
    );
    // observabilidade: só metadados (nunca conteúdo das mensagens nem segredos)
    console.log(`nexo-chat: tools=${usedTools.length} fallback=${fallback}`);
    return j({ reply, used_tools: usedTools, fallback });
  } catch (e) {
    console.error("nexo-chat error:", e instanceof Error ? e.message : "unknown");
    return j({ error: "Internal server error" }, 500);
  }
});
