/**
 * sync-ml-claims — scheduled edge function (cron-invoked)
 * verify_jwt = false (auth via Bearer service_role_key, enforced by requireServiceRole)
 *
 * Fetches ML claims for all active sellers (ml_tokens rows with refresh_token)
 * and upserts into ml_claims table.
 *
 * Dual-URL fallback (Pitfall 5): tries /v1/claims/search first, falls back to
 * /post-purchase/v1/claims/search if non-200.
 *
 * Backfill strategy (D-03): fetches status=opened and status=closed; client-side
 * filter to last 90 days applied to date_created.
 *
 * Type mapping (D-09): ML `type` field ('mediations'|'returns') → `tipo` column.
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

// D-03: backfill window — 90 days
const BACKFILL_DAYS = 90;

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

function requireServiceRole(req: Request): Response | null {
  // Fail CLOSED: if the service key env is missing, reject rather than allow
  // unauthenticated access (a missing key must never bypass the guard).
  if (!SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
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
    // Return null for non-OK responses to allow fallback (dual-URL logic)
    return null;
  }
  return null;
}

// ── Claims page fetch with dual-URL fallback (Pitfall 5) ─────────────────────

async function fetchClaimsPage(
  token: string,
  status: string,
  offset: number,
): Promise<{ items: any[]; total: number } | null> {
  const params = new URLSearchParams({
    role:   "respondent",
    status: status,
    limit:  "50",
    offset: String(offset),
  });

  // Primary URL
  const primaryUrl  = ML_API + "/v1/claims/search?" + params;
  const fallbackUrl = ML_API + "/post-purchase/v1/claims/search?" + params;

  for (const url of [primaryUrl, fallbackUrl]) {
    const res = await fetch(url, {
      headers: { Authorization: "Bearer " + token, "api-version": "2" },
    });
    if (res.ok) {
      const d = await res.json();
      // Response shape varies: data | claims | results
      const items: any[] = d?.data ?? d?.claims ?? d?.results ?? [];
      const total: number = d?.paging?.total ?? items.length;
      return { items, total };
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? "2");
      await new Promise(r => setTimeout(r, (wait || 2) * 1000));
    }
  }

  // Both URLs failed — return null (per-user error handled by caller)
  return null;
}

// ── Per-user claims sync ──────────────────────────────────────────────────────

async function syncUser(
  sb: ReturnType<typeof createClient>,
  row: { ml_user_id: string; user_id: string; organization_id: string; seller_id: string | null },
): Promise<{ claims: number }> {
  const { ml_user_id: mlUserId, organization_id: orgId } = row;
  const token = await getAccessToken(sb, mlUserId);

  // D-03: fetch last 90 days — client-side filter since API may not support date params
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - BACKFILL_DAYS);
  const cutoffStr = cutoffDate.toISOString().substring(0, 10);

  const allRows: Record<string, unknown>[] = [];

  // Safety bound so the EF always finishes inside the 150s wall-clock limit:
  // claims search returns newest-first, so once a full page falls outside the
  // 90-day window the rest are older too — stop. MAX_PAGES is a hard backstop
  // for accounts with very high recent-claim volume (cron re-runs every 30min).
  const MAX_PAGES_PER_STATUS = 6;
  for (const statusFilter of ["opened", "closed"]) {
    let offset = 0;
    let pages = 0;
    while (pages < MAX_PAGES_PER_STATUS) {
      const result = await fetchClaimsPage(token, statusFilter, offset);
      if (!result) break; // Both URLs failed

      const { items, total } = result;
      pages++;
      let inWindow = 0;

      for (const c of items) {
        // D-03: client-side date filter — only include claims from last 90 days
        const dateCreated = (c.date_created ?? "").substring(0, 10);
        if (dateCreated && dateCreated < cutoffStr) continue;
        inWindow++;

        allRows.push({
          organization_id: orgId,
          ml_user_id:      mlUserId,
          claim_id:        String(c.id ?? ""),
          order_id:        c.resource_id != null ? String(c.resource_id) : null,
          // D-09: ML `type` discriminates mediations vs returns → stored in `tipo`
          tipo:            c.type ?? "mediations",
          status:          c.status ?? "opened",
          motivo:          c.reason_id ?? null,
          data_abertura:   dateCreated || null,
          data_limite:     (c.resolution_due_date ?? "").substring(0, 10) || null,
          solucao:         c.resolution?.type ?? null,
          synced_at:       new Date().toISOString(),
        });
      }

      offset += items.length;
      // Stop when: no more items, past the reported total, or an entire page is
      // already older than the cutoff (newest-first → rest are older too).
      if (items.length === 0 || offset >= total || inWindow === 0) break;
      // T-42-07: 200ms sleep between pages (ML rate limit)
      await new Promise(r => setTimeout(r, 200));
    }
  }

  // Dedupe by claim_id within this user's batch: the ML claims search can return
  // the same claim under both 'opened' and 'closed' iterations (or across pages),
  // and Postgres ON CONFLICT DO UPDATE rejects a batch that touches the same
  // conflict target row twice ("cannot affect row a second time"), which would
  // silently drop the ENTIRE seller's upsert. Keep the last occurrence per claim_id.
  const deduped = Array.from(
    new Map(allRows.map((r) => [r.claim_id, r])).values(),
  );

  let upsertError: string | null = null;
  if (deduped.length > 0) {
    // Blindagem contra defasagem do /claims/search (segue listando como 'opened'
    // claims já fechadas): 'closed' é terminal e sempre sobrescreve; abertas só
    // INSEREM (ignoreDuplicates) — o polling não reabre uma claim já fechada
    // (reabertura real é capturada pelo webhook via GET individual, autoritativo).
    const closed = deduped.filter((r) => r.status === "closed");
    const open   = deduped.filter((r) => r.status !== "closed");

    if (closed.length > 0) {
      const { error } = await sb
        .from("ml_claims")
        .upsert(closed, { onConflict: "organization_id,ml_user_id,claim_id" });
      if (error) { upsertError = error.message; console.error("sync-ml-claims upsert(closed) ml_user_id=" + mlUserId + ":", error.message); }
    }
    if (open.length > 0) {
      const { error } = await sb
        .from("ml_claims")
        .upsert(open, { onConflict: "organization_id,ml_user_id,claim_id", ignoreDuplicates: true });
      if (error) { upsertError = error.message; console.error("sync-ml-claims upsert(open) ml_user_id=" + mlUserId + ":", error.message); }
    }
  }

  console.log("sync-ml-claims done ml_user_id=" + mlUserId + ": fetched=" + allRows.length + " upserted=" + (upsertError ? 0 : deduped.length));
  // Report the count actually persisted (0 on error) so the caller/smoke is honest.
  return { claims: upsertError ? 0 : deduped.length, error: upsertError };
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
        console.error("sync-ml-claims ml_user_id=" + row.ml_user_id + " error:", e.message);
        results.push({ ml_user_id: row.ml_user_id, error: e.message });
      }
    }

    return json({ ok: true, results });

  } catch (err: any) {
    console.error("sync-ml-claims error:", err);
    return json({ ok: false, error: err.message }, 500);
  }
});
