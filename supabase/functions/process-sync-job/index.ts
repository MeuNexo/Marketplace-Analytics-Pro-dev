/**
 * process-sync-job — queue drain edge function
 * Claims the oldest pending sync_job atomically (FOR UPDATE SKIP LOCKED),
 * dispatches to the appropriate sub-function, and updates status.
 *
 * Auth: X-Cron-Secret (pg_cron automatic) OR Bearer service-role-key (manual invocation).
 * verify_jwt = false in config.toml — pg_cron has no real user JWT.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Auth guard: accepts X-Cron-Secret (pg_cron) OR service role key (manual) ──

async function requireCronOrServiceRole(req: Request): Promise<Response | null> {
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!svcKey) return null; // dev local — skip guard

  // Form 2: service role key in Authorization header (manual / server-to-server)
  const auth = req.headers.get("authorization") ?? "";
  if (auth === "Bearer " + svcKey) return null;

  // Form 1: X-Cron-Secret from vault (pg_cron automatic every 5 min)
  // Uses get_cron_secret() SECURITY DEFINER RPC — vault schema is not exposed via PostgREST REST API.
  const xCronSecret = req.headers.get("x-cron-secret") ?? "";
  if (xCronSecret) {
    try {
      const sb = createClient(SUPABASE_URL, svcKey);
      const { data: cronSecret } = await sb.rpc("get_cron_secret");
      if (cronSecret && xCronSecret === cronSecret) {
        return null; // authorized via cron secret
      }
    } catch (e) {
      console.error("process-sync-job vault lookup error:", e);
    }
  }

  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Auth guard (must happen before claim to protect the queue)
  const guard = await requireCronOrServiceRole(req);
  if (guard) return guard;

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── Atomic claim of the oldest pending job ──────────────────────────────────
  // claim_next_sync_job() uses FOR UPDATE SKIP LOCKED internally — safe for
  // concurrent pg_cron invocations.
  const { data: job, error: claimErr } = await sb.rpc("claim_next_sync_job");
  if (claimErr) {
    console.error("process-sync-job claim error:", claimErr.message);
    return json({ ok: false, error: claimErr.message }, 500);
  }
  if (!job) {
    return json({ ok: true, msg: "no pending jobs" });
  }

  // job is now status='running', started_at is set in the DB

  // ── Dispatch and update status ─────────────────────────────────────────────
  try {
    if (job.job_type === "orders") {
      // Invoke sync-ml-orders with job parameters
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/sync-ml-orders`, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + SERVICE_KEY,
        },
        body: JSON.stringify({
          ml_user_id: job.ml_user_id,
          date_from:  job.date_from,
          date_to:    job.date_to,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => String(resp.status));
        throw new Error(`sync-ml-orders responded ${resp.status}: ${errText}`);
      }

      // Mark completed
      await sb
        .from("sync_jobs")
        .update({ status: "completed", finished_at: new Date().toISOString() })
        .eq("id", job.id);

      return json({ ok: true, job_id: job.id, job_type: job.job_type, status: "completed" });

    } else if (job.job_type === "inventory") {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/sync-ml-inventory`, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + SERVICE_KEY,
        },
        body: JSON.stringify({ ml_user_id: job.ml_user_id }),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => String(resp.status));
        throw new Error(`sync-ml-inventory responded ${resp.status}: ${errText}`);
      }

      await sb
        .from("sync_jobs")
        .update({ status: "completed", finished_at: new Date().toISOString() })
        .eq("id", job.id);

      return json({ ok: true, job_id: job.id, job_type: job.job_type, status: "completed" });

    } else if (job.job_type === "daily_cache") {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/mercado-libre-integration`, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + SERVICE_KEY,
        },
        body: JSON.stringify({
          ml_user_id: job.ml_user_id,
          date_from:  job.date_from,
          date_to:    job.date_to,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => String(resp.status));
        throw new Error(`mercado-libre-integration responded ${resp.status}: ${errText}`);
      }

      await sb
        .from("sync_jobs")
        .update({ status: "completed", finished_at: new Date().toISOString() })
        .eq("id", job.id);

      return json({ ok: true, job_id: job.id, job_type: job.job_type, status: "completed" });

    } else {
      const errMsg = `job_type not supported: ${job.job_type}`;
      await sb
        .from("sync_jobs")
        .update({
          status:      "failed",
          error_msg:   errMsg,
          finished_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      return json({ ok: false, job_id: job.id, job_type: job.job_type, error: errMsg });
    }

  } catch (err: any) {
    console.error("process-sync-job dispatch error:", err);

    // Always update status so the job doesn't get stuck in 'running'
    await sb
      .from("sync_jobs")
      .update({
        status:      "failed",
        error_msg:   err.message ?? String(err),
        finished_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return json({ ok: false, job_id: job.id, error: err.message }, 500);
  }
});
