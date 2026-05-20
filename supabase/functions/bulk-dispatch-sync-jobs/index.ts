/**
 * bulk-dispatch-sync-jobs — creates multiple sync_jobs in one request
 * Accepts a date range + job_type + ml_user_ids, inserts one pending job
 * per (ml_user_id, date) pair idempotently, and returns immediately.
 * The pg_cron drain (process-sync-job every 5 min) handles processing.
 *
 * Auth: Bearer user JWT (validates org membership via is_org_member RPC).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  let cur = from;
  while (cur <= to) {
    dates.push(cur);
    cur = addDays(cur, 1);
  }
  return dates;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // ── Auth: require valid user JWT ──────────────────────────────────────────
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: authData, error: authErr } = await sb.auth.getUser(auth.replace("Bearer ", ""));
  if (authErr || !authData?.user?.id) {
    return json({ error: "Unauthorized" }, 401);
  }
  const userId = authData.user.id;

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { ml_user_ids?: string[]; date_from?: string; date_to?: string; job_type?: string };
  try { body = await req.json(); } catch { body = {}; }

  const { ml_user_ids, date_from, date_to, job_type } = body;

  if (!ml_user_ids?.length || !date_from || !date_to || !job_type) {
    return json({ error: "ml_user_ids, date_from, date_to, job_type are required" }, 400);
  }
  if (!["orders", "daily_cache"].includes(job_type)) {
    return json({ error: "job_type must be orders or daily_cache" }, 400);
  }
  if (date_from > date_to) {
    return json({ error: "date_from must be <= date_to" }, 400);
  }

  // Guard: max 365 days to prevent abuse
  const days = dateRange(date_from, date_to);
  if (days.length > 365) {
    return json({ error: "Date range exceeds 365 days" }, 400);
  }

  // ── Validate org membership for each ml_user_id ───────────────────────────
  for (const ml_user_id of ml_user_ids) {
    const { data: tokenRow } = await sb
      .from("ml_tokens")
      .select("organization_id")
      .eq("ml_user_id", ml_user_id)
      .maybeSingle();

    if (!tokenRow?.organization_id) continue;

    const { data: isMember } = await sb.rpc("is_org_member", {
      _user_id: userId,
      _org_id:  tokenRow.organization_id,
    });
    if (!isMember) {
      return json({ error: "Forbidden", ml_user_id }, 403);
    }
  }

  // ── Bulk insert jobs idempotently ─────────────────────────────────────────
  let dispatched = 0;
  let skipped    = 0;

  for (const ml_user_id of ml_user_ids) {
    const { data: tokenRow } = await sb
      .from("ml_tokens")
      .select("organization_id")
      .eq("ml_user_id", ml_user_id)
      .maybeSingle();

    if (!tokenRow?.organization_id) { skipped += days.length; continue; }
    const { organization_id } = tokenRow;

    for (const day of days) {
      // Skip if pending/running job already exists for this (ml_user_id, job_type, date_from)
      const { data: existing } = await sb
        .from("sync_jobs")
        .select("id")
        .eq("ml_user_id", ml_user_id)
        .eq("job_type", job_type)
        .eq("date_from", day)
        .in("status", ["pending", "running"])
        .maybeSingle();

      if (existing) { skipped++; continue; }

      const { error: insertErr } = await sb.from("sync_jobs").insert({
        organization_id,
        ml_user_id,
        job_type,
        status:    "pending",
        date_from: day,
        date_to:   day,
      });

      if (insertErr) {
        console.error("bulk-dispatch insert error:", insertErr.message);
        skipped++;
      } else {
        dispatched++;
      }
    }
  }

  return json({ ok: true, dispatched, skipped, job_type, date_from, date_to });
});
