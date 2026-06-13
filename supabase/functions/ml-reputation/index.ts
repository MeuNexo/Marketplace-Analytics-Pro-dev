import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ML_API = "https://api.mercadolibre.com";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await supabase.auth.getUser(token);
    if (claimsErr || !claimsData?.user) return jsonResponse({ error: "Unauthorized" }, 401);
    const userId = claimsData.user.id;

    const url = new URL(req.url);
    const mlUserIdRaw = url.searchParams.get("ml_user_id");
    const mlUserIdParsed = z.string().min(1, "ml_user_id required").safeParse(mlUserIdRaw);
    if (!mlUserIdParsed.success) return jsonResponse({ error: "ml_user_id required" }, 400);
    const mlUserId = mlUserIdParsed.data;

    // Get access token (lookup by ml_user_id, then validate org membership)
    const { data: tokenRow, error: tokenErr } = await supabase
      .from("ml_tokens")
      .select("access_token, organization_id")
      .eq("ml_user_id", mlUserId)
      .not("access_token", "is", null)
      .limit(1)
      .maybeSingle();

    if (tokenErr || !tokenRow?.access_token) {
      return jsonResponse({ error: "No ML token found" }, 404);
    }

    if (tokenRow.organization_id) {
      const { data: isMember } = await supabase.rpc("is_org_member", {
        _user_id: userId,
        _org_id: tokenRow.organization_id,
      });
      if (!isMember) return jsonResponse({ error: "Forbidden" }, 403);
    }

    // Fetch user data from ML API (includes seller_reputation)
    const res = await fetch(`${ML_API}/users/${mlUserId}`, {
      headers: {
        Authorization: `Bearer ${tokenRow.access_token}`,
        Accept: "application/json",
      },
    });

    const userData = await res.json();
    if (!res.ok) {
      console.error("ML API error:", userData);
      return jsonResponse({ error: "ML API error" }, 502);
    }

    const rep = userData.seller_reputation || null;
    const powerSeller = userData.power_seller_status || null;

    // ── Fetch feedbacks (Opção A from 42-RESEARCH.md) ────────────────────────
    // ML deprecated the public feedback endpoint (2023+). Try three URLs in sequence.
    // NEVER throw if all fail — return feedbacks: [] (Pitfall 7, D-07).
    // The hook derives the daily chart from these; [] renders an empty series (valid).
    let feedbacks: any[] = [];
    const fbUrls = [
      `${ML_API}/users/${mlUserId}/feedbacks/received`,
      `${ML_API}/users/${mlUserId}/feedbacks?as=seller`,
      `${ML_API}/users/${mlUserId}/feedback?as=seller`,
    ];
    for (const fbUrl of fbUrls) {
      try {
        const fbRes = await fetch(fbUrl, {
          headers: {
            Authorization: `Bearer ${tokenRow.access_token}`,
            Accept: "application/json",
          },
        });
        if (fbRes.ok) {
          const fbData = await fbRes.json();
          // Response shape varies: feedbacks | feedback | results
          feedbacks = fbData?.feedbacks ?? fbData?.feedback ?? fbData?.results ?? [];
          break;
        }
        // Non-200: try next URL (all failures → feedbacks stays [])
      } catch {
        // Network error on this URL: try next
      }
    }

    console.log(`ml-reputation: user=${userId} store=${mlUserId} level=${rep?.level_id ?? "none"} power=${powerSeller} feedbacks=${feedbacks.length}`);

    return jsonResponse({
      seller_reputation: rep,
      power_seller_status: powerSeller,
      nickname: userData.nickname,
      feedbacks,
    });
  } catch (err) {
    console.error("ml-reputation error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
