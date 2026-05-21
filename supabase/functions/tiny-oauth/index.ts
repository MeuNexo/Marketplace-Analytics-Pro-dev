import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const TINY_AUTH_URL = "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth";
const TINY_TOKEN_URL = "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const TINY_APP_ID = Deno.env.get("TINY_APP_ID");
    const TINY_APP_SECRET = Deno.env.get("TINY_APP_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!TINY_APP_ID || !TINY_APP_SECRET) {
      return json({ error: "TINY_APP_ID / TINY_APP_SECRET não configurados" }, 500);
    }

    const body = await req.json();
    const { action, code, redirect_uri, refresh_token, ml_user_id, organization_id } = body;

    // ── get_auth_url ──────────────────────────────────────────────────────────
    if (action === "get_auth_url") {
      // Gera state com prefixo "tiny-" para identificar o callback
      const stateBytes = new Uint8Array(8);
      crypto.getRandomValues(stateBytes);
      const state = "tiny-" + Array.from(stateBytes).map(b => b.toString(16).padStart(2, "0")).join("");

      const params = new URLSearchParams({
        response_type: "code",
        client_id: TINY_APP_ID,
        redirect_uri,
        state,
        scope: "openid",
      });

      return json({ success: true, auth_url: `${TINY_AUTH_URL}?${params}`, state });
    }

    // ── exchange_code ─────────────────────────────────────────────────────────
    if (action === "exchange_code") {
      if (!code || !redirect_uri || !ml_user_id) {
        return json({ error: "Parâmetros obrigatórios: code, redirect_uri, ml_user_id" }, 400);
      }

      const tokenResp = await fetch(TINY_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: TINY_APP_ID,
          client_secret: TINY_APP_SECRET,
          code,
          redirect_uri,
        }),
      });

      const tokenData = await tokenResp.json();
      if (!tokenResp.ok) {
        return json({ success: false, error: tokenData.error_description || "Token exchange failed" }, tokenResp.status);
      }

      const admin = createClient(SUPABASE_URL, SERVICE_KEY);

      // Resolve user_id do JWT
      let userId: string | null = null;
      const authHeader = req.headers.get("authorization") ?? "";
      if (authHeader.startsWith("Bearer ")) {
        const { data: { user } } = await admin.auth.getUser(authHeader.slice(7));
        userId = user?.id ?? null;
      }

      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + (tokenData.expires_in ?? 3600);

      const { error: upsertErr } = await admin
        .from("ml_tokens")
        .update({
          tiny_access_token: tokenData.access_token,
          tiny_refresh_token: tokenData.refresh_token ?? null,
          tiny_expires_at: expiresAt,
        })
        .eq("ml_user_id", ml_user_id);

      if (upsertErr) {
        // Se não existia linha para esse ml_user_id, tenta insert (caso edge: usuário sem ML conectado ainda)
        console.error("ml_tokens update failed:", upsertErr);
        return json({ success: false, error: `Erro ao salvar token Tiny: ${upsertErr.message}` }, 500);
      }

      return json({ success: true, expires_in: tokenData.expires_in });
    }

    // ── refresh_token ─────────────────────────────────────────────────────────
    if (action === "refresh_token") {
      if (!refresh_token || !ml_user_id) {
        return json({ error: "Parâmetros obrigatórios: refresh_token, ml_user_id" }, 400);
      }

      const tokenResp = await fetch(TINY_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: TINY_APP_ID,
          client_secret: TINY_APP_SECRET,
          refresh_token,
        }),
      });

      const tokenData = await tokenResp.json();
      if (!tokenResp.ok) {
        return json({ success: false, error: tokenData.error_description || "Token refresh failed" }, tokenResp.status);
      }

      const admin = createClient(SUPABASE_URL, SERVICE_KEY);
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + (tokenData.expires_in ?? 3600);

      await admin.from("ml_tokens").update({
        tiny_access_token: tokenData.access_token,
        tiny_refresh_token: tokenData.refresh_token ?? refresh_token,
        tiny_expires_at: expiresAt,
      }).eq("ml_user_id", ml_user_id);

      return json({
        success: true,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token ?? refresh_token,
        expires_in: tokenData.expires_in,
      });
    }

    // ── disconnect ────────────────────────────────────────────────────────────
    if (action === "disconnect") {
      if (!ml_user_id) return json({ error: "ml_user_id obrigatório" }, 400);
      const admin = createClient(SUPABASE_URL, SERVICE_KEY);
      await admin.from("ml_tokens").update({
        tiny_access_token: null,
        tiny_refresh_token: null,
        tiny_expires_at: null,
      }).eq("ml_user_id", ml_user_id);
      return json({ success: true });
    }

    return json({ error: "action inválida. Use: get_auth_url | exchange_code | refresh_token | disconnect" }, 400);
  } catch (err) {
    console.error("tiny-oauth error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
