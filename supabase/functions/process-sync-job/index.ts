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

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").trim();
const SERVICE_KEY  = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();

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

// ── Auth guard: requires the exact service-role key ──────────────────────────
// verify_jwt = false in config.toml — the Supabase gateway does not validate the
// JWT (pg_cron Pattern B sends `Bearer <service_role_key>` from the vault). We
// MUST therefore authenticate in-code: only a Bearer that matches our own
// SUPABASE_SERVICE_ROLE_KEY may drain the queue. Length-then-equality keeps it
// constant-ish and avoids matching arbitrary tokens (CR-01).

function requireServiceRole(req: Request): Response | null {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${SERVICE_KEY}`;
  if (SERVICE_KEY.length > 0 && auth.length === expected.length && auth === expected) {
    return null;
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
  const guard = requireServiceRole(req);
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

  // ── TENANT-03: Quota gate — check_quota RPC antes de despachar ────────────
  // check_quota(_org_id) retorna true = dentro da quota, false = excedeu.
  // enterprise (-1) nunca bloqueia. Se a org não tem plano (NULL) → true (D-04).
  if (job.organization_id) {
    const { data: withinQuota, error: quotaErr } = await sb.rpc("check_quota", {
      _org_id: job.organization_id,
    });

    if (quotaErr) {
      // CR-03: fail-CLOSED. Enterprise já é tratado dentro da própria RPC (short-circuit -1),
      // então um fail-open aqui só serviria para BURLAR a quota de tiers limitados em falha
      // transitória. Não despachamos; devolvemos o job à fila (pending) para retry no próximo
      // tick do cron — não perde o job e não fura a quota.
      console.error(`process-sync-job quota check error org=${job.organization_id} — requeue:`, quotaErr.message);
      await sb
        .from("sync_jobs")
        .update({ status: "pending", started_at: null })
        .eq("id", job.id);
      return json({ ok: false, job_id: job.id, error: "quota_check_failed_requeued" }, 200);
    } else if (withinQuota === false) {
      console.warn(`process-sync-job quota EXCEEDED org=${job.organization_id} job_type=${job.job_type} — skipping dispatch`);
      await sb
        .from("sync_jobs")
        .update({
          status:      "failed",
          error_msg:   `quota exceeded for org ${job.organization_id} — sync blocked by check_quota`,
          finished_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      return json({ ok: false, job_id: job.id, job_type: job.job_type, error: "quota_exceeded" }, 200);
    }
  }

  // ── Dispatch and update status ─────────────────────────────────────────────
  try {
    if (job.job_type === "orders") {
      // Invoke sync-ml-orders with job parameters — null dates default to today (intraday sync)
      const today = new Date().toISOString().substring(0, 10);
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/sync-ml-orders`, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + SERVICE_KEY,
        },
        body: JSON.stringify({
          ml_user_id: job.ml_user_id,
          date_from:  job.date_from ?? today,
          date_to:    job.date_to   ?? today,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => String(resp.status));
        throw new Error(`sync-ml-orders responded ${resp.status}: ${errText}`);
      }

      // Checa o corpo: sync-ml-orders pode responder 200 mesmo em falha de storage.
      // Se success !== true, trata como falha (não mascarar — vide bug seller_id uuid).
      const orderBody = await resp.json().catch(() => ({} as any));
      if (orderBody?.success === false) {
        throw new Error(`sync-ml-orders falhou: ${orderBody?.error ?? "unknown"}`);
      }

      // Mark completed
      await sb
        .from("sync_jobs")
        .update({ status: "completed", finished_at: new Date().toISOString() })
        .eq("id", job.id);

      return json({ ok: true, job_id: job.id, job_type: job.job_type, status: "completed", orders_synced: orderBody?.orders_synced ?? null });

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
      // null dates default to today (intraday sync via dispatch_sync_jobs)
      const today = new Date().toISOString().substring(0, 10);
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/mercado-libre-integration`, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + SERVICE_KEY,
        },
        body: JSON.stringify({
          ml_user_id: job.ml_user_id,
          date_from:  job.date_from ?? today,
          date_to:    job.date_to   ?? today,
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

    } else if (job.job_type === "ads") {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/sync-ads`, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + SERVICE_KEY,
        },
        body: JSON.stringify({
          date_from: job.date_from ?? new Date().toISOString().substring(0, 10),
          date_to:   job.date_to   ?? new Date().toISOString().substring(0, 10),
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => String(resp.status));
        throw new Error(`sync-ads responded ${resp.status}: ${errText}`);
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
