---
phase: 18-tiny-oauth
plan: "01"
subsystem: tiny-erp-oauth
tags: [migration, edge-function, oauth, tiny-erp, supabase, typescript]
dependency_graph:
  requires: []
  provides:
    - ml_tokens.tiny_refresh_token
    - edge function tiny-oauth (get_auth_url, exchange_code, refresh_token, disconnect)
    - OAuthCodeRedirect state= preservation
  affects:
    - Tiny OAuth Authorization Code flow (Phase 18-02 UI)
    - sync-tiny-costs (can now use refresh_token instead of client_credentials)
tech_stack:
  added: []
  patterns:
    - Deno edge function mirroring ml-oauth structure
    - Keycloak OAuth2 Authorization Code (no PKCE)
    - state=tiny-{randomHex16} for ML vs Tiny callback disambiguation
    - URLSearchParams redirect preserving state param
key_files:
  created:
    - supabase/migrations/20260521220000_ml_tokens_add_tiny_refresh.sql
    - supabase/functions/tiny-oauth/index.ts
  modified:
    - src/components/auth/OAuthCodeRedirect.tsx
    - supabase/config.toml
decisions:
  - "tiny-oauth uses update (not upsert) on ml_tokens since Tiny tokens are added to existing ML token rows"
  - "verify_jwt = false mirrors ml-oauth — frontend calls edge function with its own auth header"
  - "state param uses 8 random bytes (16 hex chars) — sufficient entropy for CSRF protection"
metrics:
  duration_seconds: 360
  completed_at: "2026-05-21T20:01:28Z"
  tasks_completed: 3
  files_changed: 4
---

# Phase 18 Plan 01: Tiny OAuth Backend Infrastructure Summary

Tiny OAuth2 Authorization Code backend: migration adds `tiny_refresh_token` column, new `tiny-oauth` edge function handles 4 actions (get_auth_url with state=tiny-{hex}, exchange_code, refresh_token, disconnect), and OAuthCodeRedirect now forwards `state=` param to /integracoes for ML vs Tiny callback disambiguation.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Migration — tiny_refresh_token column | `d6d0136d` | `supabase/migrations/20260521220000_ml_tokens_add_tiny_refresh.sql` |
| 2 | Edge function tiny-oauth | `fae3d580` | `supabase/functions/tiny-oauth/index.ts`, `supabase/config.toml` |
| 3 | OAuthCodeRedirect preserve state= | `74797205` | `src/components/auth/OAuthCodeRedirect.tsx` |

## Verification Results

```
TypeScript: 0 errors
Migration file: EXISTS ✓
Edge function: EXISTS ✓ (deployed to ckcdevcxgvueywivefgx)
state= in OAuthCodeRedirect: ✓
```

## Deviations from Plan

**1. [Rule 3 - Blocking] Supabase MCP not available in Claude Code CLI context**
- **Found during:** Task 1
- **Issue:** `mcp__claude_ai_Supabase__apply_migration` is a Claude.ai web UI MCP tool, not available in Claude Code CLI execution
- **Fix:** Used `SUPABASE_ACCESS_TOKEN=[REDACTED] npx supabase@2.100.1 db push --linked` to apply migration, and `supabase functions deploy` for edge function deployment
- **Files modified:** none (same files, different deployment method)

**2. [Rule 2 - Enhancement] Added tiny-oauth to supabase/config.toml**
- **Found during:** Task 2
- **Issue:** All edge functions need verify_jwt config in config.toml; plan didn't mention this file
- **Fix:** Added `[functions.tiny-oauth] verify_jwt = false` (same as ml-oauth)
- **Files modified:** `supabase/config.toml`

## Known Stubs

None — all task goals fully implemented.

## Self-Check: PASSED

- `/root/garment-glow-test/supabase/migrations/20260521220000_ml_tokens_add_tiny_refresh.sql` — FOUND
- `/root/garment-glow-test/supabase/functions/tiny-oauth/index.ts` — FOUND
- Commits `d6d0136d`, `fae3d580`, `74797205` — FOUND
- TypeScript: 0 errors — CONFIRMED
