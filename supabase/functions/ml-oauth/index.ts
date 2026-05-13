import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ML_APP_ID = Deno.env.get("ML_APP_ID");
    const ML_CLIENT_SECRET = Deno.env.get("ML_CLIENT_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!ML_APP_ID || !ML_CLIENT_SECRET) {
      return json({ error: "ML credentials not configured" }, 500);
    }

    const body = await req.json();
    const { action, code, redirect_uri, refresh_token, code_verifier, seller_id, organization_id } = body;

    // ── get_auth_url ────────────────────────────────────────────────────────────
    if (action === "get_auth_url") {
      const verifierBytes = new Uint8Array(32);
      crypto.getRandomValues(verifierBytes);
      const generatedCodeVerifier = base64UrlEncode(verifierBytes);

      const challengeBytes = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(generatedCodeVerifier)
      );
      const codeChallenge = base64UrlEncode(new Uint8Array(challengeBytes));

      const ML_SCOPES = [
        "offline_access",
        "read_orders",
        "write_orders",
        "read_products",
        "read_payments",
        "read_advertising",
      ].join(" ");

      const authUrl = `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=${ML_APP_ID}&redirect_uri=${redirect_uri}&code_challenge=${codeChallenge}&code_challenge_method=S256&scope=${encodeURIComponent(ML_SCOPES)}`;

      return json({ success: true, auth_url: authUrl, code_verifier: generatedCodeVerifier });
    }

    // ── exchange_code ───────────────────────────────────────────────────────────
    if (action === "exchange_code") {
      if (!code || !redirect_uri) {
        return json({ error: "Missing code or redirect_uri" }, 400);
      }

      const tokenBody: Record<string, string> = {
        grant_type: "authorization_code",
        client_id: ML_APP_ID,
        client_secret: ML_CLIENT_SECRET,
        code,
        redirect_uri,
      };
      if (code_verifier) tokenBody.code_verifier = code_verifier;

      const tokenResponse = await fetch("https://api.mercadolibre.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(tokenBody),
      });

      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok) {
        console.error("ML token exchange failed:", tokenData);
        return json({ success: false, error: tokenData.message || "Token exchange failed" }, tokenResponse.status);
      }

      // Resolve user_id a partir do JWT enviado pelo frontend (se houver)
      let userId: string | null = null;
      const authHeader = req.headers.get("authorization") ?? "";
      if (authHeader.startsWith("Bearer ") && SERVICE_KEY) {
        const userClient = createClient(SUPABASE_URL, authHeader.replace("Bearer ", ""), {
          auth: { persistSession: false },
        });
        const { data: { user } } = await userClient.auth.getUser();
        userId = user?.id ?? null;
      }

      // Salva tokens no DB via service role (contorna RLS)
      const admin = createClient(SUPABASE_URL, SERVICE_KEY);
      const mlUserId = String(tokenData.user_id);
      const expiresAt = new Date(Date.now() + (tokenData.expires_in || 21600) * 1000).toISOString();

      const { error: upsertErr } = await admin.from("ml_tokens").upsert(
        {
          user_id: userId,
          organization_id: organization_id ?? null,
          ml_access_token: tokenData.access_token,
          ml_refresh_token: tokenData.refresh_token,
          ml_expires_at: Math.floor(Date.now() / 1000) + (tokenData.expires_in || 21600),
          // Colunas legacy (mantidas para compatibilidade)
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_at: expiresAt,
          ml_user_id: mlUserId,
          token_type: "bearer",
          seller_id: seller_id ?? null,
        },
        { onConflict: "user_id,ml_user_id" },
      );

      if (upsertErr) {
        console.error("ml_tokens upsert failed:", upsertErr);
        return json({ success: false, error: `Erro ao salvar token: ${upsertErr.message}` }, 500);
      }

      // Sync seller_stores se seller_id fornecido
      if (seller_id && organization_id) {
        const { data: existing } = await admin
          .from("seller_stores")
          .select("id")
          .eq("seller_id", seller_id)
          .eq("marketplace", "ml")
          .eq("external_id", mlUserId)
          .maybeSingle();

        if (!existing) {
          const { data: unclaimed } = await admin
            .from("seller_stores")
            .select("id")
            .eq("seller_id", seller_id)
            .eq("marketplace", "ml")
            .is("external_id", null)
            .limit(1)
            .maybeSingle();

          if (unclaimed) {
            await admin.from("seller_stores").update({ external_id: mlUserId }).eq("id", unclaimed.id);
          } else {
            await admin.from("seller_stores").insert({
              seller_id,
              organization_id,
              marketplace: "ml",
              external_id: mlUserId,
              store_name: `Loja ML ${mlUserId}`,
              is_active: true,
            });
          }
        }
      }

      return json({
        success: true,
        ml_user_id: mlUserId,
        expires_in: tokenData.expires_in,
        user_id: tokenData.user_id,
      });
    }

    // ── refresh_token ───────────────────────────────────────────────────────────
    if (action === "refresh_token") {
      if (!refresh_token) {
        return json({ error: "Missing refresh_token" }, 400);
      }

      const tokenResponse = await fetch("https://api.mercadolibre.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          client_id: ML_APP_ID,
          client_secret: ML_CLIENT_SECRET,
          refresh_token,
        }),
      });

      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok) {
        console.error("ML token refresh failed:", tokenData);
        return json({ success: false, error: tokenData.message || "Token refresh failed" }, tokenResponse.status);
      }

      return json({
        success: true,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_in: tokenData.expires_in,
        user_id: tokenData.user_id,
      });
    }

    return json({ error: "Invalid action. Use: get_auth_url, exchange_code, refresh_token" }, 400);
  } catch (error) {
    console.error("ML OAuth error:", error);
    return json({ error: "Internal server error" }, 500);
  }
});

function base64UrlEncode(buffer: Uint8Array): string {
  let binary = "";
  for (const byte of buffer) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
