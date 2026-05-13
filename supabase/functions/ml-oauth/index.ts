import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ML_APP_ID = Deno.env.get("ML_APP_ID");
    const ML_CLIENT_SECRET = Deno.env.get("ML_CLIENT_SECRET");

    if (!ML_APP_ID || !ML_CLIENT_SECRET) {
      return new Response(
        JSON.stringify({ error: "ML credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { action, code, redirect_uri, refresh_token, code_verifier } = await req.json();

    if (action === "get_auth_url") {
      // Generate PKCE code_verifier and code_challenge
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

      return new Response(
        JSON.stringify({ success: true, auth_url: authUrl, code_verifier: generatedCodeVerifier }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "exchange_code") {
      if (!code || !redirect_uri) {
        return new Response(
          JSON.stringify({ error: "Missing code or redirect_uri" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const tokenBody: Record<string, string> = {
        grant_type: "authorization_code",
        client_id: ML_APP_ID,
        client_secret: ML_CLIENT_SECRET,
        code,
        redirect_uri,
      };

      if (code_verifier) {
        tokenBody.code_verifier = code_verifier;
      }

      const tokenResponse = await fetch("https://api.mercadolibre.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(tokenBody),
      });

      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok) {
        console.error("ML token exchange failed:", tokenData);
        return new Response(
          JSON.stringify({ success: false, error: tokenData.message || "Token exchange failed" }),
          { status: tokenResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_in: tokenData.expires_in,
          user_id: tokenData.user_id,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "refresh_token") {
      if (!refresh_token) {
        return new Response(
          JSON.stringify({ error: "Missing refresh_token" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
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
        return new Response(
          JSON.stringify({ success: false, error: tokenData.message || "Token refresh failed" }),
          { status: tokenResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_in: tokenData.expires_in,
          user_id: tokenData.user_id,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action. Use: get_auth_url, exchange_code, refresh_token" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("ML OAuth error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function base64UrlEncode(buffer: Uint8Array): string {
  let binary = "";
  for (const byte of buffer) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
