# Phase 86: DRE — Competência no Contas a Pagar - Research

**Researched:** 2026-07-06
**Domain:** Postgres/pg_cron/pg_net enrichment pipeline extension (Supabase edge functions + SQL functions), no frontend
**Confidence:** HIGH — all claims verified by reading the actual migrations/edge-function source in this repo (not training-data assumptions). No web research was needed; this is a pure in-repo extension of an existing, already-shipped pipeline.

## Summary

This phase adds one nullable `date` column (`competence_date`) to `cash_outflows` and teaches the **existing** Postgres-native enrichment pipeline (Phase 61: `enrich_enqueue_new` / `enrich_payable_step` / `enrich_harvest`, all `SECURITY DEFINER` SQL functions living in migrations — **not** Deno edge functions) to also parse `dataCompetencia` from the Tiny detail response it already fetches, and write it to the new column. `sync-tiny-payables` (the Deno EF, Phase 59) must keep NOT writing this column at all, exactly like it already does for `category`/`supplier` — this is a de facto pattern already proven correct in prod (comment in the EF literally says "supplier e category removidos: enriquecimento-detalhe é a fonte única").

The single most important, non-obvious finding: **the backfill enqueue logic (`enrich_enqueue_new`) only re-selects rows where `category IS NULL OR supplier IS NULL`.** Since most 2026 rows in `cash_outflows` were already enriched by Phase 61 (category+supplier populated), those rows will **never** be re-selected for competence backfill unless the `WHERE` clause in `enrich_enqueue_new` is also extended with `OR co.competence_date IS NULL`. Skipping this means the ≥90% backfill goal silently fails for every row enriched before this phase ships — a plan that only adds the column and updates the harvest functions, without touching the enqueue predicate, will not backfill anything for already-enriched rows.

**Primary recommendation:** One migration, applied via Supabase MCP `apply_migration` to project `ckcdevcxgvueywivefgx`, that (1) adds `competence_date date` to `cash_outflows` + the 3-column index, (2) `CREATE OR REPLACE` all three SQL functions (`enrich_enqueue_new`, `enrich_payable_step`, `enrich_harvest`) to also parse/write `competence_date`, with `enrich_enqueue_new`'s WHERE extended to include `co.competence_date IS NULL`, and (3) confirms `sync-tiny-payables/index.ts` needs **zero code changes** (it already omits category/supplier from the upsert payload — same treatment automatically applies to a column it never mentions). No new edge function, no new cron job, no new package.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Fetch Tiny detail `/contas-pagar/{id}` | Database (pg_net via SQL function) | — | Already implemented as `enrich_payable_step`/`enrich_harvest` — Postgres functions call `net.http_get` directly; there is no edge function in this loop |
| Parse `dataCompetencia` → `competence_date` | Database (SQL function, same UPDATE statement that writes category/supplier) | — | Single source of truth is the enrichment step; extending it in-place avoids a second pipeline |
| Backfill enqueue (which rows need enrichment) | Database (`enrich_enqueue_new`, pg_cron `treasury_cat_enqueue` */30min) | — | Existing queue table `cat_backfill_queue`; must widen its WHERE predicate |
| Preserve `outflow_date`/upsert of new payables | API/Backend (Deno EF `sync-tiny-payables`) | — | Owns vencimento/caixa data; must NOT touch category/supplier/competence_date (enrichment owns those) |
| DFC / cashflow projection (`get_cashflow`) | Database (RPC, `SECURITY INVOKER`) | — | Reads only `outflow_date`/`amount`/`status`/`supplier`; verified it never references `competence_date` — purely additive, zero regression risk |
| Migration / deploy execution | Database (Supabase MCP `apply_migration`) | — | No CLI token for this project; orchestrator-only step (checkpoint) |

## Standard Stack

No new libraries. This phase touches only:
- PostgreSQL/plpgsql (`SECURITY DEFINER` functions, already in use)
- `pg_net` (`net.http_get`, already in use for the Tiny detail calls)
- `pg_cron` (existing jobs `treasury_cat_enqueue`, `treasury_cat_tick`; no new job needed)
- Supabase MCP tools (`apply_migration`) for deployment

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Extending existing `enrich_harvest`/`enrich_payable_step` | New standalone edge function / cron to fetch `dataCompetencia` | Explicitly rejected by CONTEXT.md — duplicates a rate-limited (Tiny ~1–2 req/s) fetch of the same detail endpoint the existing pipeline already calls; wastes API budget and risks double-enrichment races |
| SQL `to_date('YYYY-MM'||'-01','YYYY-MM-DD')` string parsing | Application-level parsing in a Deno EF | Would require a new/changed edge function; the enrichment already happens 100% in Postgres, so parsing belongs there too (no round-trip) |

**Installation:** none — no new dependencies.

## Package Legitimacy Audit

Not applicable — this phase installs no new packages (npm, PyPI, or otherwise). No `package.json`/`deno.json` changes.

## Architecture Patterns

### System Architecture Diagram

```
pg_cron "treasury_cat_enqueue" (*/30 min)
        │
        ▼
enrich_enqueue_new()  ── INSERT rows into cat_backfill_queue
        │  WHERE (category IS NULL OR supplier IS NULL   <- EXTEND: OR competence_date IS NULL)
        │  ON CONFLICT (tiny_payable_id) DO UPDATE status='todo' (re-enqueue done/error)
        ▼
cat_backfill_queue (status: todo → sent → done/error)
        │
        ▼  pg_cron "treasury_cat_tick" (~15s)
enrich_payable_step(batch=12)
        │
        ├─ harvest phase: for status='sent' rows, read net._http_response by req_id
        │     status=200 → parse categoria.descricao / contato.nome / dataCompetencia
        │                → UPDATE cash_outflows SET category=.., supplier=.., competence_date=..
        │                → mark queue row 'done'
        │     status=429 → requeue 'todo' (retry)
        │     other      → requeue 'todo' (attempts<N) or 'error'
        │
        └─ dispatch phase: for status='todo' rows (LIMIT batch), fire
              net.http_get('https://api.tiny.com.br/public-api/v3/contas-pagar/'||id,
                            Bearer <token from ml_tokens by ml_user_id>)
              mark queue row 'sent', store req_id

Separately, on its own cadence (pg_cron "sync-tiny-payables-6h", every 6h):
sync-tiny-payables (Deno EF)
        │  GET /contas-pagar (LIST endpoint — no dataCompetencia field, no category, no supplier)
        ▼
  UPSERT cash_outflows ON CONFLICT (organization_id, tiny_payable_id)
     writes: outflow_date, amount, description, status, document_number, source, synced_at
     DOES NOT write: category, supplier, competence_date  <- stays untouched on conflict
```

A reader can trace: new payable → sync writes vencimento row (no competence) → enqueue notices missing category/supplier/competence_date → tick fetches detail → harvest parses all three → row is fully enriched → a later sync-tiny-payables run cannot erase it because it never mentions those three columns in its upsert payload.

### Recommended Project Structure

No new files/directories. Single new migration file, e.g.:
```
supabase/migrations/20260686000000_cash_outflows_competence_date.sql   # column + index + 3 function CREATE OR REPLACE
```
(Follow the numbering convention already in use: `2026` + `<MM>` + `<phase-number>` + `<seq>`, matching sibling files `20260661000000_enrich_supplier_category.sql` for Phase 61, `20260685000000_ml_billing_daily_competence_date.sql` for Phase 84.)

### Pattern 1: Extend the SAME UPDATE that writes category/supplier

**What:** Every place that currently does
```sql
UPDATE public.cash_outflows
  SET category = v_cat, supplier = v_supplier
  WHERE tiny_payable_id = r.tiny_payable_id AND organization_id = r.organization_id;
```
must become
```sql
UPDATE public.cash_outflows
  SET category = v_cat, supplier = v_supplier, competence_date = v_competence
  WHERE tiny_payable_id = r.tiny_payable_id AND organization_id = r.organization_id;
```
**When to use:** In both `enrich_payable_step` (the function actually driven by cron in prod per Phase 61's drift notes) and `enrich_harvest` (kept "in sync" for consistency even if not currently scheduled — Phase 61 migration explicitly updated both for this reason; do the same here).

**Example (exact source, `supabase/migrations/20260661000000_enrich_supplier_category.sql` lines 151-156):**
```sql
-- Source: supabase/migrations/20260661000000_enrich_supplier_category.sql
ELSIF v_status = 200 THEN
  v_cat      := COALESCE(NULLIF(TRIM(v_content->'categoria'->>'descricao'), ''), 'Outros');
  v_supplier := NULLIF(TRIM(COALESCE(v_content->'contato'->>'nome', '')), '');
  UPDATE public.cash_outflows
    SET category = v_cat, supplier = v_supplier
    WHERE tiny_payable_id = r.tiny_payable_id AND organization_id = r.organization_id;
```

**Add a new local variable and parse line (put with the `v_cat`/`v_supplier` declarations):**
```sql
DECLARE
  v_cat         text;
  v_supplier    text;
  v_competence  date;
...
v_competence := NULLIF(TRIM(COALESCE(v_content->>'dataCompetencia', '')), '')::text;
v_competence := CASE
  WHEN v_competence IS NULL THEN NULL
  ELSE to_date(v_competence || '-01', 'YYYY-MM-DD')
END;
```
`dataCompetencia` is `"YYYY-MM"` (e.g. `"2026-06"`); `to_date('2026-06-01','YYYY-MM-DD')` materializes the first-of-month `date` the CONTEXT decision requires. Wrap in `NULLIF(TRIM(...),'')` first so an absent/blank field yields `NULL` (some old lançamentos may lack it — CONTEXT explicitly accepts this, targeting ≥90% not 100%).

### Pattern 2: Widen the enqueue predicate (the actual backfill trigger)

**What:** `enrich_enqueue_new`'s `WHERE` clause decides which `cash_outflows` rows get a queue entry at all. Its `ON CONFLICT (tiny_payable_id) DO UPDATE ... WHERE cat_backfill_queue.status IN ('done','error')` only fires for rows that MATCH the outer WHERE and ALREADY exist in the queue table.

**Current (Phase 61, `20260661000000` lines 36-40):**
```sql
-- Source: supabase/migrations/20260661000000_enrich_supplier_category.sql
WHERE (co.category IS NULL OR TRIM(co.category) = '' OR co.supplier IS NULL)
  AND co.tiny_payable_id IS NOT NULL
ON CONFLICT (tiny_payable_id) DO UPDATE
  SET status = 'todo', updated_at = now()
  WHERE cat_backfill_queue.status IN ('done', 'error');
```

**Required change for Phase 86:**
```sql
WHERE (co.category IS NULL OR TRIM(co.category) = '' OR co.supplier IS NULL OR co.competence_date IS NULL)
  AND co.tiny_payable_id IS NOT NULL
ON CONFLICT (tiny_payable_id) DO UPDATE
  SET status = 'todo', updated_at = now()
  WHERE cat_backfill_queue.status IN ('done', 'error');
```
**Why this matters (this is the landmine):** without this, rows that already have `category`/`supplier` populated (i.e., most of the ~2011+ rows enriched since Phase 61 shipped) will NEVER be selected by the outer `SELECT ... WHERE`, so they never even reach the `ON CONFLICT` re-enqueue branch. The ≥90% backfill success criterion (ROADMAP Phase 86, criterion 3) requires this exact edit — it is the mechanism, not an optional nicety.

### Anti-Patterns to Avoid
- **Writing `competence_date` from `sync-tiny-payables`:** the LIST endpoint (`/contas-pagar`) does not return `dataCompetencia` at all (only the DETAIL endpoint does — confirmed in CONTEXT.md and consistent with how `category`/`supplier` were removed from that EF's upsert in Phase 61). Do not add it to the `rows.push({...})` object in `supabase/functions/sync-tiny-payables/index.ts` — leaving a column entirely absent from the Supabase JS `.upsert()` payload is exactly how `category`/`supplier` preservation works today (PostgREST upsert only sets columns present in the row object; absent columns are left untouched on conflict, and take their column default — here `NULL`, harmless — on fresh insert).
- **Creating a new cron job or edge function for this fetch:** the phase and CONTEXT are explicit — reuse `enrich_harvest`/`enrich_payable_step`, do not build a parallel sync.
- **Casting `"YYYY-MM"` directly to `date`:** `'2026-06'::date` raises a Postgres error (invalid input syntax) — it is NOT ISO-8601 and does not implicitly cast. Always go through `to_date(text || '-01', 'YYYY-MM-DD')` or equivalent explicit parsing.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Fetching Tiny payable detail | New EF/script that calls `/contas-pagar/{id}` | Extend `enrich_payable_step`/`enrich_harvest` (existing pg_net calls, existing token lookup by `ml_user_id`, existing 429/retry handling) | Tiny rate-limits ~1-2 req/s; a second independent fetcher would double the call volume against the same endpoint and risk 429 storms |
| Backfill re-run mechanism | New backfill script/table | Re-widen `enrich_enqueue_new`'s WHERE + let the existing `treasury_cat_enqueue`/`treasury_cat_tick` crons drain naturally | `cat_backfill_queue` + throttled dispatch/harvest already handles idempotency, retries, and rate-limiting; a bespoke script would re-solve a solved problem |
| YYYY-MM → date parsing | Custom string-splitting logic in TypeScript | `to_date(v || '-01', 'YYYY-MM-DD')` in the same plpgsql function that already parses the JSON response | Keeps parsing atomic with the UPDATE that writes category/supplier; no cross-service round trip |

**Key insight:** everything this phase needs already exists in the Phase 59/61 pipeline. The work is a targeted `ALTER TABLE` + three `CREATE OR REPLACE FUNCTION` edits, not new infrastructure.

## Common Pitfalls

### Pitfall 1: Backfill silently no-ops for already-enriched rows
**What goes wrong:** Column is added and harvest functions are updated to write it, but `enrich_enqueue_new`'s WHERE isn't touched. New payables that haven't been category/supplier-enriched yet DO get `competence_date` (bundled in the same fetch), but the bulk of already-enriched 2026 rows are never re-queued — backfill coverage stays near 0% for historical data.
**Why it happens:** The enqueue predicate was written for a category/supplier-only world; it's easy to assume "the pipeline already re-enriches everything" without checking the actual `WHERE`.
**How to avoid:** Explicitly add `OR co.competence_date IS NULL` to the outer SELECT's WHERE (see Pattern 2). Verify post-deploy: `SELECT count(*) FROM cat_backfill_queue WHERE status='todo'` should jump to roughly the count of 2026 rows with `competence_date IS NULL` right after the migration + one `enrich_enqueue_new()` manual call.
**Warning signs:** `SELECT count(*) FILTER (WHERE competence_date IS NOT NULL) FROM cash_outflows WHERE outflow_date >= '2026-01-01'` stays flat across multiple `treasury_cat_enqueue` cycles.

### Pitfall 2: `'YYYY-MM'::date` cast failure kills the whole harvest batch
**What goes wrong:** A raw cast like `(v_content->>'dataCompetencia')::date` throws `invalid input syntax for type date` inside the harvest loop, which — depending on where it's placed — could abort the entire `FOR r IN ... LOOP` for that invocation (plpgsql exceptions inside a loop iteration are not automatically caught per-row).
**Why it happens:** `"2026-06"` is not a valid ISO date string; Postgres's implicit date cast expects a day component.
**How to avoid:** Always go through explicit `to_date(text || '-01', 'YYYY-MM-DD')`, and guard with `NULLIF(TRIM(...), '')` BEFORE the `to_date` call so an empty/absent `dataCompetencia` produces `NULL` instead of attempting `to_date('' || '-01', ...)`.
**Warning signs:** `enrich_payable_step`/`enrich_harvest` return `err` count spiking and `remaining` stuck (rows silently failing and looping in `sent`→retry without ever reaching `done`).

### Pitfall 3: Confusing which function is actually cron-driven in prod
**What goes wrong:** Editing only `enrich_harvest` (the one with the clean linear migration history) while the function actually invoked by the live `treasury_cat_tick` cron job is `enrich_payable_step` (per the drift note in `20260650000300_cr01_backfill_pipeline_multitenant.sql`) — the fix appears deployed but production keeps writing `NULL` competence_date.
**Why it happens:** Two near-duplicate functions exist (`enrich_harvest` and `enrich_payable_step`) because of a documented prod/repo drift event from Phase 51→61. Phase 61 correctly updated both "for consistency," but a future editor could miss one.
**How to avoid:** Update BOTH functions identically in the same migration (as Phase 61 did) so it doesn't matter which one prod's cron actually calls. Optionally, verify live cron job definitions via Supabase MCP (`execute_sql: SELECT jobname, schedule, command FROM cron.job WHERE jobname LIKE 'treasury_cat%'`) before/after deploy to confirm which function name appears in `command`.
**Warning signs:** `competence_date` populates for some newly-fetched rows but not others with no discernible pattern.

### Pitfall 4: Index churn / picking the wrong index shape
**What goes wrong:** CONTEXT specifies index `(organization_id, competence_date, category)` for Phase 87's DRE aggregation reads. Adding it as a *separate* index from the existing `cash_outflows_org_date_idx (organization_id, outflow_date)` is correct — do not try to merge/replace the existing index, since `outflow_date` queries (DFC/Phase 60) and `competence_date` queries (future DRE/Phase 87) have different leading-column needs and both must stay fast.
**How to avoid:** `CREATE INDEX IF NOT EXISTS cash_outflows_org_competence_category_idx ON public.cash_outflows (organization_id, competence_date, category);` as an ADDITIONAL index, leaving `cash_outflows_org_date_idx` untouched.

## Code Examples

### Migration skeleton (new file, e.g. `20260686000000_cash_outflows_competence_date.sql`)
```sql
-- Source: pattern from supabase/migrations/20260661000000_enrich_supplier_category.sql
--         and supabase/migrations/20260685000000_ml_billing_daily_competence_date.sql
-- Phase 86 — competence_date em cash_outflows (DRE de Resultado, fase 1/3)
-- Apply via MCP apply_migration no ckcdevcxgvueywivefgx (NUNCA supabase db push).

-- 1) Coluna nova, nullable (dataCompetencia pode faltar em lançamentos antigos — meta é
--    >=90%, não 100%; CONTEXT.md aceita NULL residual).
ALTER TABLE public.cash_outflows ADD COLUMN IF NOT EXISTS competence_date date;

-- 2) Índice de suporte para a leitura da DRE por mês+categoria (Phase 87) — ADITIVO,
--    não substitui cash_outflows_org_date_idx (que serve outflow_date/DFC).
CREATE INDEX IF NOT EXISTS cash_outflows_org_competence_category_idx
  ON public.cash_outflows (organization_id, competence_date, category);

-- 3) enrich_enqueue_new: adiciona `OR co.competence_date IS NULL` ao WHERE — sem isto,
--    linhas ja enriquecidas (category/supplier preenchidos) nunca reentram na fila.
CREATE OR REPLACE FUNCTION public.enrich_enqueue_new()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_added int := 0;
BEGIN
  INSERT INTO public.cat_backfill_queue (tiny_payable_id, organization_id, ml_user_id, status)
  SELECT DISTINCT co.tiny_payable_id, co.organization_id, t.ml_user_id, 'todo'
  FROM public.cash_outflows co
  JOIN LATERAL (
    SELECT ml.ml_user_id FROM public.ml_tokens ml
    WHERE ml.organization_id = co.organization_id
      AND ml.tiny_access_token IS NOT NULL
    LIMIT 1
  ) t ON true
  WHERE (co.category IS NULL OR TRIM(co.category) = '' OR co.supplier IS NULL
         OR co.competence_date IS NULL)
    AND co.tiny_payable_id IS NOT NULL
  ON CONFLICT (tiny_payable_id) DO UPDATE
    SET status = 'todo', updated_at = now()
    WHERE cat_backfill_queue.status IN ('done', 'error');
  GET DIAGNOSTICS v_added = ROW_COUNT;

  RETURN jsonb_build_object(
    'enqueued_now', v_added,
    'queue_open',  (SELECT count(*) FROM public.cat_backfill_queue WHERE status IN ('todo','sent')),
    'done_total',  (SELECT count(*) FROM public.cat_backfill_queue WHERE status='done')
  );
END $function$;

REVOKE EXECUTE ON FUNCTION public.enrich_enqueue_new() FROM PUBLIC, anon, authenticated;

-- 4) enrich_payable_step + enrich_harvest: parse dataCompetencia -> primeiro dia do mês;
--    grava competence_date junto de category/supplier no mesmo UPDATE. Repita a mudança
--    identicamente nas DUAS funções (Pitfall 3 — não se sabe com certeza qual delas o
--    cron treasury_cat_tick chama em prod hoje).
CREATE OR REPLACE FUNCTION public.enrich_payable_step(p_batch integer DEFAULT 12)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_token      text;
  r            record;
  v_cat        text;
  v_supplier   text;
  v_competence date;
  v_status     int;
  v_content    jsonb;
  v_done int := 0; v_retry int := 0; v_err int := 0; v_fired int := 0;
BEGIN
  FOR r IN SELECT * FROM public.cat_backfill_queue WHERE status='sent' AND req_id IS NOT NULL LOOP
    SELECT resp.status_code, resp.content::jsonb INTO v_status, v_content
    FROM net._http_response resp WHERE resp.id = r.req_id;

    IF v_status IS NULL THEN
      CONTINUE;
    ELSIF v_status = 200 THEN
      v_cat        := COALESCE(NULLIF(TRIM(v_content->'categoria'->>'descricao'), ''), 'Outros');
      v_supplier   := NULLIF(TRIM(COALESCE(v_content->'contato'->>'nome', '')), '');
      v_competence := NULL;
      IF NULLIF(TRIM(COALESCE(v_content->>'dataCompetencia', '')), '') IS NOT NULL THEN
        v_competence := to_date(TRIM(v_content->>'dataCompetencia') || '-01', 'YYYY-MM-DD');
      END IF;
      UPDATE public.cash_outflows
        SET category = v_cat, supplier = v_supplier, competence_date = v_competence
        WHERE tiny_payable_id = r.tiny_payable_id AND organization_id = r.organization_id;
      UPDATE public.cat_backfill_queue SET status='done', updated_at=now()
        WHERE tiny_payable_id = r.tiny_payable_id;
      v_done := v_done + 1;
    ELSIF v_status = 429 THEN
      UPDATE public.cat_backfill_queue SET status='todo', req_id=NULL, attempts=attempts+1, updated_at=now()
        WHERE tiny_payable_id = r.tiny_payable_id;
      v_retry := v_retry + 1;
    ELSE
      UPDATE public.cat_backfill_queue
        SET status=CASE WHEN attempts >= 4 THEN 'error' ELSE 'todo' END,
            req_id=NULL, attempts=attempts+1, updated_at=now()
        WHERE tiny_payable_id = r.tiny_payable_id;
      v_err := v_err + 1;
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM public.cat_backfill_queue WHERE status='todo' ORDER BY updated_at LIMIT p_batch LOOP
    SELECT tiny_access_token INTO v_token FROM public.ml_tokens WHERE ml_user_id = r.ml_user_id LIMIT 1;
    IF v_token IS NULL THEN
      UPDATE public.cat_backfill_queue SET status='error', updated_at=now()
        WHERE tiny_payable_id = r.tiny_payable_id;
      CONTINUE;
    END IF;
    UPDATE public.cat_backfill_queue
      SET status='sent', updated_at=now(),
          req_id = net.http_get(
            url := 'https://api.tiny.com.br/public-api/v3/contas-pagar/' || r.tiny_payable_id,
            headers := jsonb_build_object('Authorization','Bearer '||v_token,'Accept','application/json'))
      WHERE tiny_payable_id = r.tiny_payable_id;
    v_fired := v_fired + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'harvested_done', v_done, 'retry_429', v_retry, 'errors', v_err, 'fired', v_fired,
    'remaining', (SELECT count(*) FROM public.cat_backfill_queue WHERE status IN ('todo','sent')),
    'done_total', (SELECT count(*) FROM public.cat_backfill_queue WHERE status='done')
  );
END $function$;

REVOKE EXECUTE ON FUNCTION public.enrich_payable_step(integer) FROM PUBLIC, anon, authenticated;

-- enrich_harvest: mesma alteração de v_competence + UPDATE, mantida "por consistência"
-- (mesmo padrão da migration 20260661000000). Assinatura/REVOKE inalterados.
CREATE OR REPLACE FUNCTION public.enrich_harvest()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  r            record;
  v_status     int;
  v_content    jsonb;
  v_cat        text;
  v_supplier   text;
  v_competence date;
  v_done int := 0; v_retry int := 0; v_err int := 0; v_pending int := 0;
BEGIN
  FOR r IN SELECT * FROM public.cat_backfill_queue WHERE status='sent' AND req_id IS NOT NULL LOOP
    SELECT resp.status_code, resp.content::jsonb INTO v_status, v_content
    FROM net._http_response resp WHERE resp.id = r.req_id;

    IF v_status IS NULL THEN
      v_pending := v_pending + 1; CONTINUE;
    ELSIF v_status = 200 THEN
      v_cat        := COALESCE(NULLIF(TRIM(v_content->'categoria'->>'descricao'), ''), 'Outros');
      v_supplier   := NULLIF(TRIM(COALESCE(v_content->'contato'->>'nome', '')), '');
      v_competence := NULL;
      IF NULLIF(TRIM(COALESCE(v_content->>'dataCompetencia', '')), '') IS NOT NULL THEN
        v_competence := to_date(TRIM(v_content->>'dataCompetencia') || '-01', 'YYYY-MM-DD');
      END IF;
      UPDATE public.cash_outflows
        SET category = v_cat, supplier = v_supplier, competence_date = v_competence
        WHERE tiny_payable_id = r.tiny_payable_id AND organization_id = r.organization_id;
      UPDATE public.cat_backfill_queue SET status='done', updated_at=now()
        WHERE tiny_payable_id = r.tiny_payable_id;
      v_done := v_done + 1;
    ELSIF v_status = 429 THEN
      UPDATE public.cat_backfill_queue SET status='todo', req_id=NULL, updated_at=now()
        WHERE tiny_payable_id = r.tiny_payable_id;
      v_retry := v_retry + 1;
    ELSE
      UPDATE public.cat_backfill_queue
        SET status=CASE WHEN attempts >= 5 THEN 'error' ELSE 'todo' END, req_id=NULL, updated_at=now()
        WHERE tiny_payable_id = r.tiny_payable_id;
      v_err := v_err + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('done',v_done,'retry_429',v_retry,'err',v_err,'still_pending',v_pending,
    'remaining',(SELECT count(*) FROM public.cat_backfill_queue WHERE status IN ('todo','sent')),
    'done_total',(SELECT count(*) FROM public.cat_backfill_queue WHERE status='done'));
END $$;

REVOKE EXECUTE ON FUNCTION public.enrich_harvest() FROM PUBLIC, anon, authenticated;
```

### sync-tiny-payables: NO code change required
```typescript
// Source: supabase/functions/sync-tiny-payables/index.ts lines 272-284 (current, unchanged)
rows.push({
  organization_id: organizationId,
  outflow_date:    outflowDate,
  amount:          Number(item.valor ?? 0),
  description:     String(item.historico ?? item.descricao ?? "").trim() || `Conta #${tinyPayableId}`,
  // supplier e category removidos: enriquecimento-detalhe é a fonte única (opção A, CASHFIX-07)
  // competence_date: MESMO tratamento — NÃO adicionar aqui. A LIST /contas-pagar não traz
  // dataCompetencia de qualquer forma; só o DETALHE traz, e o detalhe é responsabilidade do
  // pipeline de enriquecimento (enrich_payable_step/enrich_harvest), não desta EF.
  status:          statusNorm,
  document_number: String(item.numeroDocumento ?? item.numero ?? "").trim() || null,
  source:          "tiny",
  tiny_payable_id: tinyPayableId,
  synced_at:       syncAt,
  updated_at:      syncAt,
});
```
This EF's `.upsert(rows, { onConflict: "organization_id,tiny_payable_id", ignoreDuplicates: false })` only sets columns present in each row object; since `competence_date` is never in that object, PostgREST's generated `ON CONFLICT DO UPDATE SET ...` never touches it. On a brand-new payable (INSERT branch), the column simply takes its default (`NULL`), which is correct — enrichment fills it in on the next tick.

## Runtime State Inventory

> Included because this phase touches production data (`cash_outflows`, `cat_backfill_queue`) and an active pg_cron pipeline, though it is additive rather than a rename/refactor. Answered explicitly per category:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `cash_outflows` in prod (`ckcdevcxgvueywivefgx`) has ~2011+ rows already enriched with `category`/`supplier` (Phase 61); none have `competence_date` today (column doesn't exist yet) | Migration (ADD COLUMN) + widened enqueue predicate to re-enrich these rows (see Pitfall 1) — this IS the backfill, not a separate data migration script |
| Live service config | `cat_backfill_queue` rows currently `status='done'` for all Phase 61-enriched payables | The `ON CONFLICT ... WHERE status IN ('done','error')` branch of `enrich_enqueue_new` will flip these back to `'todo'` once the WHERE predicate change ships — expected and desired, not a bug |
| OS-registered state | pg_cron jobs `treasury_cat_enqueue` (*/30min) and `treasury_cat_tick` (~15s, per drift notes in `20260650000300`) already exist in prod and are NOT recreated by this phase's migration (same rule Phase 61 followed: "NÃO recria os crons... eles existem em prod via DRIFT") | None — verify live job definitions with `SELECT jobname, schedule, command FROM cron.job WHERE jobname LIKE 'treasury_cat%'` before/after, but do not `cron.schedule`/`cron.unschedule` them in the migration |
| Secrets/env vars | None referenced by this change (Tiny tokens come from `ml_tokens`, unchanged) | None |
| Build artifacts | `src/integrations/supabase/types.ts` has NO entry for `cash_outflows` at all today (confirmed by grep — same gap Phase 84 found for `ml_billing_daily`) | No action required for THIS phase (frontend is out of scope / deferred to Phase 87/88); if the planner wants to add the table's type definition for hygiene, it's optional since TS already falls through loosely for unregistered tables (zero `tsc` errors either way) |

**Nothing found in category:** none — every category above returned a concrete answer.

## Common Pitfalls
(see full list above under "Common Pitfalls" — Pitfalls 1–4)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `sync-tiny-payables` wrote `category`/`supplier` directly from the LIST endpoint (always NULL/empty) | Enrichment pipeline (`enrich_harvest`/`enrich_payable_step`) is the sole writer of `category`/`supplier`, fetched from the DETAIL endpoint | Phase 61 (2026-06-25) | This phase (86) extends the SAME single-writer pattern to `competence_date` — no new architecture, just a third column riding the same rails |
| `enqueue`/`harvest` were two separate functions (`enrich_drain` PROCEDURE + `enrich_harvest` FUNCTION), org-agnostic token (`1639558873` hardcoded) | Multi-tenant `enrich_enqueue_new`/`enrich_payable_step`, token resolved per-row via `ml_user_id` join | Phase 51 → CR-01 fix (documented in `20260650000300`) | Multi-tenant safety already solved; Phase 86 just adds a column to the same multi-tenant-safe functions |

**Deprecated/outdated:**
- `enrich_drain` (PROCEDURE) / original single-tenant `enrich_harvest` from `20260650000100` — superseded by `20260650000300`'s `enrich_enqueue_new`/`enrich_payable_step`. Do not resurrect the old procedure-based drain pattern.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The live prod cron `treasury_cat_tick` currently invokes `enrich_payable_step`, not `enrich_harvest` (per the drift-note comment in `20260650000300`, which itself says the actual cron.schedule calls were made outside the repo) | Pitfall 3 / Code Examples | If wrong (e.g. prod actually calls `enrich_harvest`), the mitigation (update both functions identically) still protects the plan either way — low risk even if the assumption about WHICH one is active is incorrect |
| A2 | `dataCompetencia` is always exactly `"YYYY-MM"` with no variation (e.g. never `"YYYY-MM-DD"` or empty object) | Pattern 1, Code Examples | If Tiny sometimes returns a different format, `to_date(v||'-01','YYYY-MM-DD')` could throw or silently mis-parse; the `NULLIF(TRIM(...),'')` guard prevents crashes on empty values but not on malformed non-empty ones — recommend the executor sample a handful of real detail responses (e.g. via the debug harness pattern from `sync-tiny-payables?debug=1`, or a one-off `net.http_get` in SQL) before locking the parse logic, per CONTEXT's own note to validate against junho/2026 Pé Vermeio data |
| A3 | No live-DB query was run in this research session (no Supabase MCP tool was available to this research agent) — all findings are from static analysis of migration files in the repo, assumed to reflect the deployed state modulo the documented "DRIFT" episodes already called out in Phase 51/61 migration comments | Whole document | Repo migrations are the executor's own documented source of truth per CLAUDE.md conventions ("apply via MCP apply_migration", "não recriar via SQL Editor"), and Phase 61's migration explicitly states what in prod differs from earlier repo files (the drift) — so this is a known, bounded risk, not an unknown one. The planner should still have the executor run a schema/row-count sanity check via MCP (`list_tables`, `execute_sql` on `cash_outflows`/`cat_backfill_queue`) as a first executor task before writing the real migration, to catch any further undocumented drift |

## Open Questions

1. **Exact row count of `cash_outflows` rows dated in 2026 today, and how many already have non-null `competence_date`-worthy detail (i.e., current queue depth once the predicate widens)**
   - What we know: ~2011+ rows existed as of Phase 61 (mid-2026-06); Tiny detail rate limit is ~1-2 req/s, and the Phase 61 backfill of a similar-sized batch took "~20-30 min" per the migration's own comment.
   - What's unclear: exact current count for 2026 specifically, and whether the ~90% backfill target is achievable within one `treasury_cat_enqueue` cycle or needs multiple.
   - Recommendation: executor runs `SELECT count(*) FROM cash_outflows WHERE outflow_date >= '2026-01-01'` and `SELECT count(*) FROM cash_outflows WHERE outflow_date >= '2026-01-01' AND competence_date IS NULL` via MCP immediately after migration apply, to set expectations and confirm the ≥90% criterion is being tracked against the right denominator (rows WITH a `tiny_payable_id`, since manual/source='manual' rows have no detail endpoint to enrich from and should probably be excluded from the ≥90% denominator — CONTEXT doesn't explicitly address manual rows).
2. **Should the ≥90% backfill target be measured over ALL 2026 `cash_outflows` rows or only `source='tiny'` rows?**
   - What we know: `source='manual'` rows have `tiny_payable_id IS NULL` and can never be enriched (no detail endpoint to call).
   - What's unclear: CONTEXT.md says "≥90% das linhas com competência em 2026" without excluding manual rows explicitly.
   - Recommendation: planner should scope the success-criteria SQL check to `WHERE source = 'tiny'` (or `tiny_payable_id IS NOT NULL`) to avoid an unreachable target — manual entries have no Tiny competência to fetch.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase MCP (`apply_migration`, `execute_sql`) | Deploying the migration to `ckcdevcxgvueywivefgx` | Not directly available to this research agent's toolset (no `mcp__supabase__*` tools were exposed in this session) | — | The orchestrator/executor session (per project convention, CLAUDE.md + all recent phase history) always deploys via MCP as a `[BLOCKING]`/checkpoint task — this is the established pattern for every prior phase (58, 59, 61, 84), not a gap introduced by this phase |
| pg_net / pg_cron extensions | Existing `enrich_*` functions, `treasury_cat_*` jobs | Already active in prod (confirmed by migration history and by Phase 51/61's successful backfills) | — | — |
| Tiny API `/contas-pagar/{id}` | Detail fetch that returns `dataCompetencia` | Assumed available (same endpoint the pipeline already calls successfully for category/supplier) | Tiny API v3 | — |

**Missing dependencies with no fallback:** none — this phase's only external dependency (Supabase MCP for deploy) is handled by the existing checkpoint/orchestrator pattern used in every recent phase.

**Missing dependencies with fallback:** none applicable.

## Security Domain

`security_enforcement` is not set to `false` in config — included, scoped to what's relevant (pure backend/DB change, no new user-facing surface).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | No new auth surface; Tiny token handling unchanged (reads existing `ml_tokens.tiny_access_token`) |
| V3 Session Management | No | N/A |
| V4 Access Control | Yes | `cash_outflows` RLS policy `cash_outflows_select` (org-member SELECT only) is untouched by adding a column; no new write path for `authenticated` role — writes remain `SECURITY DEFINER` functions (`REVOKE ... FROM PUBLIC, anon, authenticated` already in place and must be preserved on every `CREATE OR REPLACE`) |
| V5 Input Validation | Yes | `dataCompetencia` is external, Tiny-controlled text — parse defensively with `NULLIF(TRIM(...),'')` before `to_date()` (a malformed value should degrade to `NULL`, not crash the harvest loop or inject via string concatenation; `to_date` with a fixed format mask is not vulnerable to SQL injection since it's a typed function call, not dynamic SQL) |
| V6 Cryptography | No | No secrets/tokens touched by this change |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| `SECURITY DEFINER` function privilege leakage (function callable by `anon`/`authenticated` and used to bypass RLS) | Elevation of Privilege | Every `CREATE OR REPLACE FUNCTION` in the migration MUST be followed by the same `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` already present for `enrich_enqueue_new`/`enrich_payable_step`/`enrich_harvest` — `CREATE OR REPLACE` does NOT preserve prior REVOKEs automatically in all cases; re-issue them explicitly in the new migration to be safe |
| Cross-tenant data leak via `cat_backfill_queue` | Information Disclosure | Already mitigated (Phase 51 CR-01 fix): token lookup joins on `ml_user_id` per-row, not a hardcoded org's token; unchanged by this phase — do not regress by reintroducing a hardcoded `ml_user_id` |

## Sources

### Primary (HIGH confidence — read directly this session)
- `/root/garment-glow-test/.planning/phases/86-dre-compet-ncia-no-contas-a-pagar/86-CONTEXT.md` — locked decisions
- `/root/garment-glow-test/.planning/ROADMAP.md` (Phase 59, 60, 61, 84, 86, 87, 88 sections) — success criteria, dependency chain
- `/root/garment-glow-test/supabase/migrations/20260618100000_cash_flow_tables.sql` — `cash_outflows` table definition, constraints, current index
- `/root/garment-glow-test/supabase/migrations/20260618115000_cash_outflows_tiny_cron.sql` — `sync-tiny-payables-6h` cron (Pattern B, `EdgeRuntime.waitUntil`)
- `/root/garment-glow-test/supabase/migrations/20260650000100_treasury_category_backfill.sql` — original (superseded) `enrich_drain`/`enrich_harvest`
- `/root/garment-glow-test/supabase/migrations/20260650000300_cr01_backfill_pipeline_multitenant.sql` — multi-tenant `enrich_enqueue_new`/`enrich_payable_step`, drift notes
- `/root/garment-glow-test/supabase/migrations/20260661000000_enrich_supplier_category.sql` — Phase 61's exact pattern for adding a column to the enrichment write (category+supplier), the direct template for this phase
- `/root/garment-glow-test/supabase/migrations/20260659000000_cashflow_projection_7d_rule.sql`, `20260659000300_cashflow_outflows_pending_only.sql`, `20260660000000_cashflow_dfc_alignment.sql`, `20260660000200_cashflow_saldo_indicators_forecasts.sql`, `20260618120000_cash_flow_rpcs.sql` and other `get_cashflow` revisions — confirmed only `outflow_date`/`amount`/`status`/`supplier` are referenced, never a competence column; zero regression risk verified by grep across all `get_cashflow`/cashflow RPC migrations
- `/root/garment-glow-test/supabase/functions/sync-tiny-payables/index.ts` — full file; confirms category/supplier already omitted from upsert payload (proves the "no code change needed" claim)
- `/root/garment-glow-test/supabase/migrations/20260685000000_ml_billing_daily_competence_date.sql` — Phase 84's sibling precedent for a `competence_date` column + widened UNIQUE + supporting index (naming convention cross-check)
- `/root/garment-glow-test/.planning/phases/84-dre-por-compet-ncia-de-venda-m-todo-tiny/84-RESEARCH.md` — confirms `types.ts` gap pattern (table not registered, zero `tsc` impact)
- `/root/garment-glow-test/src/integrations/supabase/types.ts` — grep confirmed no `cash_outflows` entry exists
- `/root/garment-glow-test/.planning/phases/59-fluxo-caixa-correcoes/59-CONTEXT.md` — `sync-tiny-payables` background/history, `EdgeRuntime.waitUntil` pattern, DFC reconciliation constraint
- `/root/garment-glow-test/CLAUDE.md` — project stack/conventions (React 18 SPA, Deno edge functions, MCP-only deploy)
- `/root/garment-glow-test/.planning/config.json` — `nyquist_validation: false` (Validation Architecture section omitted), no `security_enforcement: false` override (Security Domain section included)

### Secondary / Tertiary
None used — no web research was necessary; the entire domain (Postgres enrichment pipeline extension) is fully documented in-repo with high-confidence, directly-inspected source.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; existing stack only
- Architecture: HIGH — read the actual live pipeline source (migrations + EF) end to end
- Pitfalls: HIGH — Pitfall 1 (enqueue predicate) derived directly from reading the exact WHERE clause; Pitfall 2/3 derived from documented drift history in the repo's own migration comments
- DFC non-regression: HIGH — grepped every `get_cashflow`/cashflow-adjacent migration for `cash_outflows` column references; none touch a competence column

**Research date:** 2026-07-06
**Valid until:** 30 days (stable in-repo domain; re-verify if Phase 87 work reveals additional drift between repo and prod cron definitions)

## RESEARCH COMPLETE
