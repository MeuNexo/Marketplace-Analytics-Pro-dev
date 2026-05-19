# Phase 9: Job Queue & Dispatcher — Research

## Summary

Phase 9 builds the automated sync infrastructure: a Postgres-backed job queue (`sync_jobs` table), a SQL dispatcher function (`dispatch_sync_jobs()`), and a Deno edge function (`process-sync-job`) that drains the queue. Two pg_cron jobs orchestrate everything.

---

## Existing Infrastructure

### pg_cron + pg_net — Already Enabled

Extensions installed in migration `20260311205329`:
```sql
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
```

**Project Supabase URL:** `https://gionpsuunfkkzzjdubfy.supabase.co/functions/v1/`  
**Anon key (used in existing cron jobs):**
`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdpb25wc3V1bmZra3p6amR1YmZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NTc2NDgsImV4cCI6MjA4ODEzMzY0OH0.mHbEEnXlynQopAd5j7A4B4emYwalXqvyVcvEh_G5gUk`

### pg_cron Scheduling Pattern (from `20260424181309`)

```sql
SELECT cron.schedule(
  'job-name',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://gionpsuunfkkzzjdubfy.supabase.co/functions/v1/function-name',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer {ANON_KEY}',
      'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1)
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```

To reschedule (idempotent):
```sql
SELECT cron.unschedule('job-name');  -- ignore error if doesn't exist
SELECT cron.schedule('job-name', '*/5 * * * *', $$ ... $$);
```

### CRON_SECRET in Vault

Secret already created in migration `20260424181309`:
```sql
-- Check/create (idempotent)
SELECT id INTO v_secret_id FROM vault.secrets WHERE name = 'CRON_SECRET';
IF v_secret_id IS NULL THEN
  v_new_value := encode(gen_random_bytes(32), 'hex');
  PERFORM vault.create_secret(v_new_value, 'CRON_SECRET', '...');
END IF;
```
Access in SQL: `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1)`

### Edge Function Auth: X-Cron-Secret Pattern (from `sync-ads/index.ts`)

```typescript
function requireServiceRole(req: Request): Response | null {
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!svcKey) return null; // local dev fallback
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== "Bearer " + svcKey) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, ... });
  }
  return null;
}
```

**Note:** `sync-ads` uses service role key for auth. `ml-token-refresh` and related cron functions use `X-Cron-Secret` header. For `process-sync-job`, use service role key pattern (same as `sync-ads`) since it's called by pg_cron with service role semantics.

### Edge Function Deno Imports

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
```

### supabase/config.toml — New Functions

Need to add entries with `verify_jwt = false` for cron-triggered functions:
```toml
[functions.process-sync-job]
verify_jwt = false
```

---

## dispatch_sync_jobs() Design

### Data Sources

```sql
-- Active ML stores with token (not null access_token)
SELECT ml_user_id, organization_id FROM public.ml_tokens WHERE access_token IS NOT NULL;

-- Plan config per org
SELECT organization_id, sync_interval_minutes FROM public.organization_plans;
```

### Algorithm (PL/pgSQL)

```sql
CREATE OR REPLACE FUNCTION public.dispatch_sync_jobs()
RETURNS integer  -- returns count of jobs inserted
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inserted integer := 0;
  r record;
  v_interval_minutes integer;
  v_last_finished timestamptz;
  v_has_open boolean;
  v_job_types text[] := ARRAY['daily_cache', 'orders', 'inventory'];
  v_jt text;
BEGIN
  FOR r IN
    SELECT DISTINCT t.ml_user_id, t.organization_id
    FROM public.ml_tokens t
    WHERE t.access_token IS NOT NULL
  LOOP
    -- Get sync interval for this org (default 1440 if no plan)
    SELECT op.sync_interval_minutes INTO v_interval_minutes
    FROM public.organization_plans op
    WHERE op.organization_id = r.organization_id
    LIMIT 1;
    
    IF v_interval_minutes IS NULL THEN
      v_interval_minutes := 1440; -- default: daily
    END IF;
    
    IF v_interval_minutes = -1 THEN
      CONTINUE; -- unlimited plan: skip auto-dispatch (manual only)
    END IF;
    
    FOREACH v_jt IN ARRAY v_job_types LOOP
      -- SYNC-07: Check for open job (pending or running)
      SELECT EXISTS(
        SELECT 1 FROM public.sync_jobs
        WHERE organization_id = r.organization_id
          AND ml_user_id = r.ml_user_id
          AND job_type = v_jt
          AND status IN ('pending', 'running')
      ) INTO v_has_open;
      
      IF v_has_open THEN CONTINUE; END IF;
      
      -- Check if interval has elapsed since last completed job
      SELECT finished_at INTO v_last_finished
      FROM public.sync_jobs
      WHERE organization_id = r.organization_id
        AND ml_user_id = r.ml_user_id
        AND job_type = v_jt
        AND status = 'completed'
      ORDER BY finished_at DESC
      LIMIT 1;
      
      -- Insert if: no prior completed job OR elapsed time >= interval
      IF v_last_finished IS NULL
         OR v_last_finished + (v_interval_minutes || ' minutes')::interval <= now() THEN
        INSERT INTO public.sync_jobs
          (organization_id, ml_user_id, job_type, status, retries)
        VALUES
          (r.organization_id, r.ml_user_id, v_jt, 'pending', 0);
        v_inserted := v_inserted + 1;
      END IF;
      
    END LOOP;
  END LOOP;
  
  RETURN v_inserted;
END;
$$;
```

---

## process-sync-job Edge Function Design

### Flow

1. Validate auth (service role key or X-Cron-Secret)
2. `SELECT ... FOR UPDATE SKIP LOCKED` — pick oldest pending job atomically
3. `UPDATE sync_jobs SET status = 'running', started_at = now() WHERE id = $1`
4. Dispatch to sub-function based on `job_type`
5. On success: `UPDATE sync_jobs SET status = 'completed', finished_at = now()`
6. On error: `UPDATE sync_jobs SET status = 'failed', error_msg = ..., finished_at = now()`

### Atomic Job Claim Pattern

```sql
UPDATE public.sync_jobs
SET status = 'running', started_at = now()
WHERE id = (
  SELECT id FROM public.sync_jobs
  WHERE status = 'pending'
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

`FOR UPDATE SKIP LOCKED` prevents two concurrent pg_cron runs from picking the same job.

### Dispatch Table (job_type → function)

| job_type | Edge Function | Status in Phase 9 |
|---|---|---|
| `orders` | `sync-ml-orders` | ✅ exists |
| `daily_cache` | `mercado-libre-integration` (needs date params) | ⚠️ needs dedicated sync function or parameterized call |
| `inventory` | `sync-ml-inventory` | ⏳ created in Phase 10 |

**Phase 9 scope decision**: For `daily_cache` and `inventory`, process-sync-job returns 404/unsupported gracefully and marks job as `failed` (will be retried by watchdog). Only `orders` dispatch is fully wired in Phase 9. This is sufficient to verify the queue/dispatcher infrastructure end-to-end.

### Invocation Pattern for Sub-functions

```typescript
const response = await fetch(
  `${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-ml-orders`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({
      ml_user_id: job.ml_user_id,
      date_from: job.date_from,
      date_to: job.date_to,
    }),
  }
);
```

---

## SYNC-03: Watchdog / Retry Logic

Two approaches:

**Option A** (pg_cron inline SQL — preferred, simpler):
```sql
-- pg_cron job: every 5 minutes, re-queue failed jobs with backoff
SELECT cron.schedule(
  'sync-job-retry-watchdog',
  '*/5 * * * *',
  $$
  INSERT INTO public.sync_jobs (organization_id, ml_user_id, job_type, status, retries, date_from, date_to)
  SELECT organization_id, ml_user_id, job_type, 'pending', retries + 1, date_from, date_to
  FROM public.sync_jobs
  WHERE status = 'failed'
    AND retries < 3
    AND finished_at + (
      CASE retries
        WHEN 0 THEN interval '5 minutes'
        WHEN 1 THEN interval '15 minutes'
        WHEN 2 THEN interval '30 minutes'
        ELSE interval '999 hours'
      END
    ) <= now()
    AND NOT EXISTS (
      SELECT 1 FROM public.sync_jobs j2
      WHERE j2.organization_id = sync_jobs.organization_id
        AND j2.ml_user_id = sync_jobs.ml_user_id
        AND j2.job_type = sync_jobs.job_type
        AND j2.status IN ('pending', 'running')
    );
  $$
);
```

**Option B** (inside `dispatch_sync_jobs()` — keeps logic consolidated).

**Recommendation:** Option A — separate pg_cron job makes each responsibility distinct and easier to debug.

---

## sync_jobs Table Schema

```sql
CREATE TYPE public.sync_job_type AS ENUM ('daily_cache', 'orders', 'inventory');
CREATE TYPE public.sync_job_status AS ENUM ('pending', 'running', 'completed', 'failed');

CREATE TABLE public.sync_jobs (
  id               uuid         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  uuid         NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ml_user_id       text         NOT NULL,
  job_type         public.sync_job_type NOT NULL,
  date_from        date         DEFAULT NULL,
  date_to          date         DEFAULT NULL,
  status           public.sync_job_status NOT NULL DEFAULT 'pending',
  retries          integer      NOT NULL DEFAULT 0,
  error_msg        text         DEFAULT NULL,
  started_at       timestamptz  DEFAULT NULL,
  finished_at      timestamptz  DEFAULT NULL,
  created_at       timestamptz  NOT NULL DEFAULT now()
);
```

**Index for queue drain (most critical):**
```sql
CREATE INDEX sync_jobs_pending_created_idx ON public.sync_jobs (status, created_at) WHERE status = 'pending';
```

**Index for dispatch dedup check:**
```sql
CREATE INDEX sync_jobs_open_lookup_idx ON public.sync_jobs (organization_id, ml_user_id, job_type, status) WHERE status IN ('pending', 'running');
```

---

## pg_cron Jobs for Phase 9

### SYNC-05: Dispatch every 30 minutes
```sql
SELECT cron.schedule(
  'sync-dispatch-every-30min',
  '*/30 * * * *',
  $$ SELECT public.dispatch_sync_jobs(); $$
);
```

### SYNC-06: Drain every 5 minutes
```sql
SELECT cron.schedule(
  'sync-process-job-every-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://gionpsuunfkkzzjdubfy.supabase.co/functions/v1/process-sync-job',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer {ANON_KEY}',
      'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1)
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```

---

## RLS for sync_jobs

`sync_jobs` is a backend-only table (written by service_role and SQL functions):
- **SELECT**: members of the org (read-only monitoring)
- **No INSERT/UPDATE/DELETE** for `authenticated` — only service_role and SQL functions

---

## Critical Constraints

1. **`FOR UPDATE SKIP LOCKED`** — mandatory for concurrent-safe job claim; prevents same job being picked by two simultaneous invocations
2. **dispatch dedup (SYNC-07)** — guard must check `status IN ('pending', 'running')` not just `pending`; a running job must also block new dispatch
3. **pg_net is fire-and-forget** — `net.http_post` returns a `bigint` request_id immediately; the edge function runs async. pg_cron does not wait for completion.
4. **Supabase edge function timeout = 150s** — `process-sync-job` must complete within 150s; for long syncs, it invokes the sub-function and doesn't wait (fire-and-forget pattern or sub-function handles its own timeout)
5. **`CRON_SECRET` already in vault** — do NOT recreate; just reference it in new pg_cron jobs
6. **`verify_jwt = false` in config.toml** — cron-triggered functions have no JWT from a real user; set this flag so Supabase doesn't reject the request

---

## Validation Architecture

### Test Scenarios

| Test | How to verify |
|---|---|
| Job insertion | INSERT pending job, confirm it appears in SELECT |
| Dispatch dedup (SYNC-07) | Call `dispatch_sync_jobs()` twice; assert only 1 pending job per triplet |
| process-sync-job picks oldest | Insert 3 jobs, invoke function, confirm oldest was claimed |
| Failed job retry (SYNC-03) | Insert failed job (retries=0, finished_at=6 min ago), run watchdog, confirm new pending job |
| Retry cap | Insert failed job (retries=3), run watchdog, confirm no new job |
| pg_cron schedules exist | `SELECT jobname FROM cron.job` returns both schedule names |

