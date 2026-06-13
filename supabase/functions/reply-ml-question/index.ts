/**
 * reply-ml-question — user-invoked edge function
 * verify_jwt = true (user JWT required via Supabase Auth)
 *
 * Posts an answer to a ML question on behalf of the authenticated user.
 * The answer is irreversible (ML API has no edit/delete for answers).
 *
 * Security gates (in order):
 *   1. User JWT validation (401 if invalid)
 *   2. Zod body validation: question_id (int), text (max 2000 chars), ml_user_id (T-42-05, D-05/D-06)
 *   3. ML token lookup by ml_user_id (404 if no token)
 *   4. Org membership check: user must belong to the org owning the token (403) (T-42-05)
 *   5. POST /answers to ML API (ML status forwarded on error)
 *   6. Local ml_questions row updated to ANSWERED
 *
 * Security (T-42-04): access_token is NEVER logged or returned in responses.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const ML_API = "https://api.mercadolibre.com";

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

// D-05/D-06: server-side enforcement of 2000-char limit (same limit as ML API)
const BodySchema = z.object({
  question_id: z.number().int().positive(),
  text:        z.string().min(1).max(2000),
  ml_user_id:  z.string().min(1),
});

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── 1. User JWT validation ────────────────────────────────────────────────
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase    = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await supabase.auth.getUser(token);
    if (claimsErr || !claimsData?.user) return jsonResponse({ error: "Unauthorized" }, 401);
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
    const { question_id, text, ml_user_id } = parsed.data;

    // ── 3. ML token lookup ────────────────────────────────────────────────────
    const { data: tokenRow, error: tokenErr } = await supabase
      .from("ml_tokens")
      .select("access_token, organization_id")
      .eq("ml_user_id", ml_user_id)
      .not("access_token", "is", null)
      .limit(1)
      .maybeSingle();

    if (tokenErr || !tokenRow?.access_token) {
      return jsonResponse({ error: "No ML token found for ml_user_id" }, 404);
    }

    // ── 4. Org membership check (T-42-05) ────────────────────────────────────
    // User must belong to the org that owns the ml_token to prevent cross-org replies.
    // Fail CLOSED: a token row without organization_id is unowned/ambiguous → deny
    // (never skip the check, which would be a fail-open IDOR before the irreversible POST).
    if (!tokenRow.organization_id) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }
    const { data: isMember } = await supabase.rpc("is_org_member", {
      _user_id: userId,
      _org_id:  tokenRow.organization_id,
    });
    if (!isMember) return jsonResponse({ error: "Forbidden" }, 403);

    // ── 5. POST answer to ML API ──────────────────────────────────────────────
    // Do NOT log access_token (T-42-04)
    const mlRes = await fetch(ML_API + "/answers", {
      method:  "POST",
      headers: {
        Authorization:  "Bearer " + tokenRow.access_token,
        "Content-Type": "application/json",
        Accept:         "application/json",
      },
      body: JSON.stringify({ question_id, text }),
    });

    if (!mlRes.ok) {
      let mlMessage = "ML API error";
      try {
        const mlBody = await mlRes.json();
        // Forward ML error message but sanitize — do not expose token or internal data
        mlMessage = mlBody?.message ?? mlBody?.cause ?? "ML API returned " + mlRes.status;
      } catch { /* ignore parse errors */ }
      console.error("reply-ml-question: ML POST /answers status=" + mlRes.status);
      return jsonResponse({ error: mlMessage, ml_status: mlRes.status }, mlRes.status >= 500 ? 502 : mlRes.status);
    }

    // ── 6. Update local ml_questions cache ────────────────────────────────────
    // Optimistic local update so the UI reflects the answer without waiting for next cron
    const { error: updateErr } = await supabase
      .from("ml_questions")
      .update({
        status:       "ANSWERED",
        resposta:     text,
        data_resposta: new Date().toISOString(),
        synced_at:    new Date().toISOString(),
      })
      .eq("question_id", question_id)
      .eq("ml_user_id", ml_user_id);

    if (updateErr) {
      // Non-fatal: the answer was already sent to ML. Log and continue.
      console.error("reply-ml-question: local cache update failed:", updateErr.message);
    }

    console.log("reply-ml-question: answered question_id=" + question_id + " ml_user_id=" + ml_user_id);
    return jsonResponse({ ok: true });

  } catch (err) {
    console.error("reply-ml-question error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
