---
phase: 04-motor-de-analise-snapshots
plan: "02"
subsystem: database
status: PARTIAL
tags: [migration, supabase, rls, snapshots]
dependency_graph:
  requires: [ml_tokens, organizations]
  provides: [commercial_analysis_snapshots table]
  affects: [04-03-PLAN.md hook, all downstream analysis plans]
tech_stack:
  added: []
  patterns: [supabase-migration, rls-is_org_member]
key_files:
  created:
    - supabase/migrations/20260515200000_commercial_analysis_snapshots.sql
  modified: []
decisions:
  - "Used public.is_org_member(auth.uid(), organization_id) — exact same pattern as ml_tax_config.sql"
  - "strategy column is nullable (no NOT NULL) to allow deferred strategy selection after initial snapshot"
  - "UPDATE policy added to allow members to set strategy on an existing snapshot"
metrics:
  duration: "5m"
  completed: "2026-05-15"
  tasks_completed: 1
  tasks_total: 2
---

# Phase 04 Plan 02: Commercial Analysis Snapshots Migration Summary

Migration SQL criada para a tabela `commercial_analysis_snapshots` no Supabase com RLS via is_org_member e dois índices compostos.

## Status: PARTIAL — Awaiting Human Checkpoint

Task 1 (migration file creation) is complete and committed.
Task 2 requires the user to run `supabase db push` and confirm "aprovado".

## What Was Built

### Task 1: Migration SQL (COMPLETE)

File `supabase/migrations/20260515200000_commercial_analysis_snapshots.sql` created with:

**Table Schema:**

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PRIMARY KEY | DEFAULT gen_random_uuid() |
| created_at | TIMESTAMPTZ NOT NULL | DEFAULT now() |
| ml_user_id | TEXT NOT NULL | REFERENCES ml_tokens(ml_user_id) ON DELETE CASCADE |
| organization_id | UUID NOT NULL | REFERENCES organizations(id) ON DELETE CASCADE |
| item_id | TEXT NOT NULL | |
| product_title | TEXT NOT NULL | |
| brand | TEXT | nullable |
| period_start | DATE NOT NULL | |
| period_end | DATE NOT NULL | |
| price_curve | JSONB NOT NULL | array of PriceBucket |
| price_gmv | NUMERIC(10,2) NOT NULL | |
| price_neutral | NUMERIC(10,2) NOT NULL | |
| price_margin | NUMERIC(10,2) NOT NULL | |
| elasticity_pct | NUMERIC(8,4) NOT NULL | |
| elasticity_class | TEXT NOT NULL | CHECK IN ('baixa','media','alta','extrema') |
| strategy | TEXT | nullable, CHECK IN ('gmv','neutral','margin') |

**Indexes:**
- `commercial_analysis_snapshots_org_item_created_idx` on (organization_id, item_id, created_at DESC)
- `commercial_analysis_snapshots_ml_user_item_idx` on (ml_user_id, item_id)

**RLS Policies:**
- SELECT: "Members can view own org snapshots" USING (public.is_org_member(auth.uid(), organization_id))
- INSERT: "Members can insert own org snapshots" WITH CHECK (public.is_org_member(auth.uid(), organization_id))
- UPDATE: "Members can update strategy on own org snapshots" USING + WITH CHECK (public.is_org_member(auth.uid(), organization_id))

### Task 2: supabase db push (PENDING — Human Checkpoint)

The user must run `supabase db push` in the project root to apply this migration to the remote Supabase database. After running, they confirm with "aprovado" if successful, or describe any error.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | e7163e6 | feat(04-02): add commercial_analysis_snapshots migration |

## Deviations from Plan

None — plan executed exactly as written. RLS pattern matches ml_tax_config.sql exactly using `public.is_org_member(auth.uid(), organization_id)`.

## Known Stubs

None — this is a migration-only plan. No UI or application code was created.

## Threat Surface Scan

RLS policies cover T-04-04 (Elevation of Privilege) and T-04-06 (Information Disclosure) from the plan's threat model. No new surface was introduced beyond what the plan specifies.

## Self-Check: PASSED

- [x] supabase/migrations/20260515200000_commercial_analysis_snapshots.sql exists
- [x] Contains CREATE TABLE commercial_analysis_snapshots with all required columns
- [x] Contains ALTER TABLE ENABLE ROW LEVEL SECURITY
- [x] Contains 3 RLS policies (SELECT, INSERT, UPDATE)
- [x] Contains 2 CREATE INDEX statements
- [x] Commit e7163e6 exists in git log
