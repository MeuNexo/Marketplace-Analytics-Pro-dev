/**
 * sync-ml-questions — scheduled edge function (cron-invoked)
 * verify_jwt = false (auth via Bearer service_role_key, enforced by requireServiceRole)
 *
 * Fetches ML questions for all active sellers (ml_tokens rows with refresh_token)
 * and upserts into ml_questions table.
 *
 * Backfill strategy (D-03): fetch status=unanswered first, then status=answered.
 * Pagination: limit=50, 200ms sleep between pages (ML rate limit).
 * Status is normalized to UPPERCASE before saving.
 *
 * Security (T-42-04): access_token and refresh_token are NEVER logged or returned.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL     = (Deno.env.get("SUPABASE_URL") ?? "").trim();
const SERVICE_KEY      = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
const ML_APP_ID        = Deno.env.get("ML_APP_ID") ?? "";
const ML_CLIENT_SECRET = Deno.env.get("ML_CLIENT_SECRET") ?? "";
const ML_API           = "https://api.mercadolibre.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Auth guard: only service role may invoke ──────────────────────────────────
// (T-42-06) cron passes Bearer service_role_key via vault — Pattern B.
// Anon key or X-Cron-Secret would be rejected here.

function requireServiceRole(req: Request): Response | null {
  if (!SERVICE_KEY) return null;
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== "Bearer " + SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  return null;
}

// ── Token refresh (same pattern as sync-ads) ──────────────────────────────────

async function getAccessToken(sb: ReturnType<typeof createClient>, mlUserId: string): Promise<string> {
  const { data: row } = await sb
    .from("ml_tokens")
    .select("access_token,refresh_token,expires_at")
    .eq("ml_user_id", mlUserId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) throw new Error("No ML token for ml_user_id=" + mlUserId);

  const expiresTs = row.expires_at ? new Date(row.expires_at).getTime() / 1000 : 0;
  const now       = Date.now() / 1000;
  if (row.access_token && expiresTs - now > 300) return row.access_token;

  if (!row.refresh_token) throw new Error("No refresh token for ml_user_id=" + mlUserId);
  if (!ML_APP_ID || !ML_CLIENT_SECRET) throw new Error("ML_APP_ID/ML_CLIENT_SECRET not set");

  const resp = await fetch(ML_API + "/oauth/token", {
    method:  "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type:    "refresh_token",
      client_id:     ML_APP_ID,
      client_secret: ML_CLIENT_SECRET,
      refresh_token: row.refresh_token,
    }),
  });
  if (!resp.ok) throw new Error("Token refresh " + resp.status + " for ml_user_id=" + mlUserId);

  const data         = await resp.json();
  const newExpiresAt = new Date(Date.now() + (data.expires_in || 21600) * 1000).toISOString();

  // Update token in DB — do NOT log access_token (T-42-04)
  await sb
    .from("ml_tokens")
    .update({
      access_token:  data.access_token,
      refresh_token: data.refresh_token ?? row.refresh_token,
      expires_at:    newExpiresAt,
    })
    .eq("ml_user_id", mlUserId);

  return data.access_token;
}

// ── ML GET with 429/5xx retry ─────────────────────────────────────────────────

async function mlGet(url: string, token: string): Promise<any> {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, {
      headers: { Authorization: "Bearer " + token, "api-version": "2" },
    });
    if (res.ok) return res.json();
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? "2");
      await new Promise(r => setTimeout(r, (wait || 2) * 1000));
      continue;
    }
    if (i < 2 && [500, 502, 503, 504].includes(res.status)) {
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      continue;
    }
    throw new Error("ML " + res.status + " " + url.split("?")[0]);
  }
  throw new Error("ML retries exhausted");
}

// ── Per-user question sync ────────────────────────────────────────────────────

async function syncUser(
  sb: ReturnType<typeof createClient>,
  row: { ml_user_id: string; user_id: string; organization_id: string; seller_id: string | null },
): Promise<{ questions: number }> {
  const { ml_user_id: mlUserId, organization_id: orgId } = row;
  const token = await getAccessToken(sb, mlUserId);

  // D-03: backfill — fetch unanswered first (urgent), then answered
  // RESEARCH.md open question 3: use lowercase in request (Nexo MCP pattern),
  // normalize to UPPERCASE on save
  const statusesToFetch = ["unanswered", "answered"];
  const allRows: Record<string, unknown>[] = [];

  for (const statusFilter of statusesToFetch) {
    let offset = 0;
    while (true) {
      const params = new URLSearchParams({
        seller_id: mlUserId,
        status: statusFilter,
        limit: "50",
        offset: String(offset),
      });
      const data = await mlGet(ML_API + "/questions/search?" + params, token);
      const questions: any[] = data?.questions ?? [];
      const total: number = data?.paging?.total ?? questions.length;

      for (const q of questions) {
        allRows.push({
          organization_id: orgId,
          ml_user_id:      mlUserId,
          question_id:     q.id,         // bigint
          item_id:         q.item_id ?? null,
          texto:           q.text ?? "",
          // Normalize status to UPPERCASE for consistent storage
          status:          String(q.status ?? "UNANSWERED").toUpperCase(),
          comprador_id:    String(q.from?.id ?? ""),
          data_pergunta:   q.date_created ?? null,
          resposta:        q.answer?.text ?? null,
          data_resposta:   q.answer?.date_created ?? null,
          synced_at:       new Date().toISOString(),
        });
      }

      offset += questions.length;
      if (questions.length === 0 || offset >= total) break;
      // T-42-07: 200ms sleep between pages (ML rate limit)
      await new Promise(r => setTimeout(r, 200));
    }
  }

  if (allRows.length > 0) {
    const { error } = await sb
      .from("ml_questions")
      .upsert(allRows, { onConflict: "organization_id,ml_user_id,question_id" });
    if (error) console.error("sync-ml-questions upsert ml_user_id=" + mlUserId + ":", error.message);
  }

  console.log("sync-ml-questions done ml_user_id=" + mlUserId + ": questions=" + allRows.length);
  return { questions: allRows.length };
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const guard = requireServiceRole(req);
  if (guard) return guard;

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    // Fetch all ml_users with refresh_token (active sellers)
    const { data: tokenRows, error: tokErr } = await sb
      .from("ml_tokens")
      .select("ml_user_id,user_id,organization_id,seller_id")
      .not("refresh_token", "is", null);

    if (tokErr) return json({ ok: false, error: tokErr.message }, 500);
    if (!tokenRows || tokenRows.length === 0) return json({ ok: true, msg: "no active users" });

    const results: any[] = [];
    for (const row of tokenRows) {
      try {
        const counts = await syncUser(sb, row);
        results.push({ ml_user_id: row.ml_user_id, ...counts });
      } catch (e: any) {
        console.error("sync-ml-questions ml_user_id=" + row.ml_user_id + " error:", e.message);
        results.push({ ml_user_id: row.ml_user_id, error: e.message });
      }
    }

    return json({ ok: true, results });

  } catch (err: any) {
    console.error("sync-ml-questions error:", err);
    return json({ ok: false, error: err.message }, 500);
  }
});
