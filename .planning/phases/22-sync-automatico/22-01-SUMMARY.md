---
phase: 22-sync-automatico
plan: "01"
subsystem: mercadolivre-sync
tags: [sync, realtime, react-query, supabase, cron]
dependency_graph:
  requires: []
  provides:
    - useMLLastSync hook — reads synced_at from ml_sync_log
    - Realtime subscription on ml_daily_cache in MercadoLivre.tsx
    - Migration activating intraday sync every 2h via organization_plans
  affects:
    - src/pages/MercadoLivre.tsx — auto-sync removed, Realtime added
    - src/hooks/useMLSync.ts — shouldAutoSync removed
tech_stack:
  added: []
  patterns:
    - Supabase Realtime postgres_changes subscription
    - React Query polling (staleTime 2min, refetchInterval 5min)
    - Cache-first UI — no frontend-triggered edge functions on mount
key_files:
  created:
    - supabase/migrations/20260522_intraday_sync.sql
    - src/hooks/useMLLastSync.ts
  modified:
    - src/hooks/useMLSync.ts
    - src/pages/MercadoLivre.tsx
decisions:
  - "Use dispatch_sync_jobs() with sync_interval_minutes=120 — no new dispatcher needed"
  - "Realtime filter on organization_id=eq.{orgId} — reduces noise from other orgs"
  - "useMLLastSync polls every 5min as fallback if Realtime misses a cron event"
  - "Inventory effect runs on every connect (no autoSyncDoneRef) — correct on scope change"
metrics:
  duration: "~20min"
  completed: "2026-05-22"
  tasks_completed: 5
  files_modified: 4
---

# Phase 22 Plan 01: Sync Automático — Cache-First Summary

**One-liner:** Cache-first ML sync: removed frontend auto-sync on mount, activated cron intraday (2h) via migration, added Supabase Realtime subscription on ml_daily_cache, and wired useMLLastSync (reads ml_sync_log) to MLPageHeader.

---

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Migration — ativar sync intraday | 17700416 | supabase/migrations/20260522_intraday_sync.sql |
| 2 | Hook useMLLastSync | 6b0cd600 | src/hooks/useMLLastSync.ts |
| 3 | Limpar useMLSync | 5a14a287 | src/hooks/useMLSync.ts |
| 4 | MercadoLivre.tsx — Realtime + useMLLastSync | 371bdc64 | src/pages/MercadoLivre.tsx |
| 5 | Verificação final | — | (no files changed) |

---

## Files Modified

### supabase/migrations/20260522_intraday_sync.sql (created)
Idempotent migration: `INSERT INTO organization_plans (organization_id, sync_interval_minutes) SELECT DISTINCT organization_id, 120 FROM ml_tokens WHERE access_token IS NOT NULL ON CONFLICT ... DO UPDATE SET sync_interval_minutes = 120`. Enables `dispatch_sync_jobs()` (runs every 30min) to create jobs every 2h for all orgs with ML connected. **Status: created, not yet applied to Supabase** — apply via `supabase db push` or Supabase dashboard.

### src/hooks/useMLLastSync.ts (created)
New hook: reads `ml_sync_log.synced_at` (most recent, ordered DESC, limit 1) for the current org and resolvedMLUserIds. Returns `{ data: string | null, isLoading: boolean }`. staleTime: 2min, refetchInterval: 5min. Disabled when org or user IDs not ready.

### src/hooks/useMLSync.ts (modified)
Removed:
- `LAST_ML_SYNC_TS_KEY` constant
- `AUTO_SYNC_STALE_MS` export
- `autoSyncTriggeredRef` useRef
- `shouldAutoSync` useCallback
- `localStorage.setItem(LAST_ML_SYNC_TS_KEY, ...)` from syncFromAPI
- `shouldAutoSync` from return object

Kept intact: `LAST_ML_SYNC_KEY`, `syncFromAPI`, `resetSync`, `lastSyncedAt`.

### src/pages/MercadoLivre.tsx (modified)
- Added import `useMLLastSync` from `@/hooks/useMLLastSync`
- Added `useInvalidateMLQueries` to imports from `@/hooks/useMLQueries`
- Removed `shouldAutoSync` from `useMLSync` destructuring
- Added: `const { data: lastSyncTimestamp } = useMLLastSync()`
- Added: `const invalidate = useInvalidateMLQueries()`
- Removed `autoSyncDoneRef` and the combined auto-sync+inventory effect
- Added clean inventory-only effect (no shouldAutoSync, no ref guard)
- Added scope-change effect (`resetSync` + `setProductStockMap({})`) without `autoSyncDoneRef.current = false`
- Added Realtime subscription: `supabase.channel("ml_daily_cache_changes").on("postgres_changes", { filter: organization_id=eq.{orgId} }, () => invalidate.invalidateAll())`
- Updated `MLPageHeader`: `lastUpdated={lastSyncTimestamp ? new Date(lastSyncTimestamp) : null}` (was `lastSyncedAt` from localStorage)

---

## Verification Results

### TypeScript
```
npx tsc --noEmit → 0 errors
```

### Vitest
```
Test Files  4 passed (4)
     Tests  63 passed (63)
  Duration  2.49s
```

### Residue check (shouldAutoSync / AUTO_SYNC_STALE_MS / LAST_ML_SYNC_TS_KEY / autoSyncDoneRef)
```
grep → 0 results — clean
```

### Key patterns confirmed
```
grep -n "useMLLastSync|ml_daily_cache_changes" src/pages/MercadoLivre.tsx
17: import { useMLLastSync } from "@/hooks/useMLLastSync";
126: const { data: lastSyncTimestamp } = useMLLastSync();
226:       .channel("ml_daily_cache_changes")
```

---

## Deviations from Plan

None — plan executed exactly as written.

The plan-checker's pre-noted warning about `useInvalidateMLQueries` not being imported was applied definitively (not conditionally) as instructed.

---

## Known Stubs

None — all data flows are wired to real Supabase sources.

---

## Self-Check: PASSED

- supabase/migrations/20260522_intraday_sync.sql: FOUND
- src/hooks/useMLLastSync.ts: FOUND
- src/hooks/useMLSync.ts: FOUND (modified)
- src/pages/MercadoLivre.tsx: FOUND (modified)
- Commits 17700416, 6b0cd600, 5a14a287, 371bdc64: all present in git log
