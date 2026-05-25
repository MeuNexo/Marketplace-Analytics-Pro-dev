import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ML_APP_ID = Deno.env.get("ML_APP_ID");
    const ML_CLIENT_SECRET = Deno.env.get("ML_CLIENT_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!ML_APP_ID || !ML_CLIENT_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing required environment variables" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // verify_jwt=false — called by pg_cron (no JWT).
    // Only refreshes ML OAuth tokens — no sensitive data exposed.

    const thresholdDate = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const { data: expiringTokens, error: queryError } = await supabase
      .from("ml_tokens")
      .select("*")
      .not("refresh_token", "is", null)
      .lt("expires_at", thresholdDate);

    if (queryError) {
      console.error("Error querying tokens:", queryError);
      return new Response(
        JSON.stringify({ error: "Failed to query tokens" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!expiringTokens || expiringTokens.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No tokens need refreshing", refreshed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let refreshed = 0;
    let failed = 0;
    const results: Array<{ user_id: string; status: string; error?: string }> = [];

    for (const token of expiringTokens) {
      try {
        const tokenResponse = await fetch("https://api.mercadolibre.com/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            grant_type: "refresh_token",
            client_id: ML_APP_ID,
            client_secret: ML_CLIENT_SECRET,
            refresh_token: token.refresh_token,
          }),
        });

        const tokenData = await tokenResponse.json();

        if (!tokenResponse.ok) {
          console.error(`Refresh failed for user ${token.ml_user_id}:`, tokenData);
          failed++;
          results.push({ user_id: token.ml_user_id || "unknown", status: "failed", error: tokenData.message });
          continue;
        }

        const newExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

        const { error: updateError } = await supabase
          .from("ml_tokens")
          .update({
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_at: newExpiresAt,
            updated_at: new Date().toISOString(),
          })
          .eq("id", token.id);

        if (updateError) {
          console.error(`DB update failed for token ${token.id}:`, updateError);
          failed++;
          results.push({ user_id: token.ml_user_id || "unknown", status: "db_error" });
        } else {
          refreshed++;
          results.push({ user_id: token.ml_user_id || "unknown", status: "refreshed" });
          console.log(`Token refreshed for user ${token.ml_user_id}, expires at ${newExpiresAt}`);
        }
      } catch (err) {
        console.error(`Error refreshing token for user ${token.ml_user_id}:`, err);
        failed++;
        results.push({ user_id: token.ml_user_id || "unknown", status: "error" });
      }
    }

    return new Response(
      JSON.stringify({ success: true, refreshed, failed, total: expiringTokens.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Token refresh error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
