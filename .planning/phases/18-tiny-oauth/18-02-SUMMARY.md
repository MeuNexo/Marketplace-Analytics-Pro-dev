---
phase: 18-tiny-oauth
plan: "02"
subsystem: integrations
tags: [oauth, tiny-erp, frontend, edge-function]
dependency_graph:
  requires: [18-01]
  provides: [tiny-oauth-connect-ui, sync-tiny-costs-oauth]
  affects: [src/pages/Integrations.tsx, supabase/functions/sync-tiny-costs]
tech_stack:
  added: []
  patterns: [oauth-authorization-code, state-validation, token-refresh-via-edge-function]
key_files:
  created: []
  modified:
    - src/pages/Integrations.tsx
    - supabase/functions/sync-tiny-costs/index.ts
    - src/integrations/supabase/types.ts
decisions:
  - Tiny OAuth state elevated to Integrations parent component (same pattern as ML)
  - tiny_access_token/tiny_refresh_token/tiny_expires_at added to generated types.ts
  - Deployment done via supabase CLI
metrics:
  duration: ~15min
  completed: 2026-05-21
  tasks_completed: 2
  files_changed: 3
---

# Phase 18 Plan 02: Tiny ERP OAuth UI + sync-tiny-costs Update Summary

Full OAuth connect flow for Tiny ERP integrated into Integrations.tsx, and sync-tiny-costs updated to use stored tokens with automatic refresh — eliminating client_credentials dependency.

---

## Tasks Completed

### Task 1: Atualizar TinyIntegrationSection em Integrations.tsx
**Commit:** 595f8b2a

**Changes:**
- `TinyIntegrationSection` transformed from "sync-only" to full OAuth connect/disconnect flow
- Connection state (`tinyConnected`, `tinyConnecting`) elevated to `Integrations` parent scope
- `handleTinyOAuthCallback()` added to `Integrations` scope — validates `state`, exchanges code, sets connection
- `useEffect` for `?code=` split: `state?.startsWith("tiny-")` routes to Tiny callback, else falls through to ML
- `handleTinyConnect()` calls `tiny-oauth get_auth_url`, saves state + ml_user_id to localStorage, redirects
- `handleTinyDisconnect()` calls `tiny-oauth disconnect`, clears state
- UI: "Conectar Tiny ERP" button when disconnected; "Sincronizar Custos" + "Desconectar" when connected
- Badge shows "Conectado" (default variant) or "OAuth 2.0" (secondary) based on connection state

### Task 2: Atualizar sync-tiny-costs para tokens OAuth
**Commit:** ea3aad2b

**Changes:**
- `getTinyToken()` now reads `tiny_access_token`, `tiny_refresh_token`, `tiny_expires_at` from `ml_tokens`
- Returns token directly if valid (>5min remaining)
- Calls `tiny-oauth refresh_token` action via HTTP when token expired
- Throws descriptive error if `tiny_access_token` is null (user needs to connect first)
- `TINY_CLIENT_ID` and `TINY_CLIENT_SECRET` constants removed from file
- Deployed to ckcdevcxgvueywivefgx via `npx supabase@2.100.1 functions deploy`

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Types] Added tiny token columns to ml_tokens generated types**
- **Found during:** Task 1 TypeScript check
- **Issue:** `src/integrations/supabase/types.ts` was missing `tiny_access_token`, `tiny_refresh_token`, `tiny_expires_at` columns on `ml_tokens` Row/Insert/Update interfaces — columns were added in Phase 17-02 but types weren't regenerated
- **Fix:** Added all three columns to ml_tokens Row, Insert, and Update types in types.ts
- **Files modified:** `src/integrations/supabase/types.ts`
- **Commit:** 595f8b2a (included in Task 1 commit)

---

## Verification Results

```
# TypeScript clean
npx tsc --noEmit → (no output = zero errors)

# client_credentials removed
grep "client_credentials" sync-tiny-costs/index.ts → OK: removed

# Tiny callback detection
state?.startsWith("tiny-") → present in Integrations.tsx

# tiny-oauth invoked
supabase.functions.invoke("tiny-oauth") → 3 call sites (get_auth_url, exchange_code, disconnect)
```

---

## Self-Check: PASSED

- `src/pages/Integrations.tsx` — exists and modified
- `supabase/functions/sync-tiny-costs/index.ts` — exists and modified
- `src/integrations/supabase/types.ts` — exists and modified
- Commit 595f8b2a — exists
- Commit ea3aad2b — exists
- Edge function deployed to ckcdevcxgvueywivefgx
