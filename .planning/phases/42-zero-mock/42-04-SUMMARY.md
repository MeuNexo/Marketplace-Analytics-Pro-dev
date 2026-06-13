---
phase: 42-zero-mock
plan: "04"
subsystem: ui
tags: [react, supabase, sellers, ml_tokens, organization, multi-tenant]

# Dependency graph
requires:
  - phase: 42-zero-mock
    provides: "42-01 seller table schema with organization_id, logo_url, initials, is_active"
provides:
  - "/tv page reads sellers from sellers table filtered by organization_id and ML-connected via ml_tokens"
  - "Zero hardcoded UUIDs in TVModeVendas.tsx"
  - "Dynamic seller cycling alphabetical by name with logo/initials fallback"
affects:
  - 42-zero-mock
  - 43-multi-tenant-hardening

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Org-scoped sellers query: sellers WHERE organization_id + ml_tokens join for ML-connected filter"
    - "Cancelled async guard: let cancelled; effect cleanup () => { cancelled = true; }"
    - "sellerIdx reset on sellers.length change for Pitfall-2 protection"
    - "Guard render early-return when sellers[sellerIdx] is undefined"

key-files:
  created: []
  modified:
    - src/pages/TVModeVendas.tsx

key-decisions:
  - "Sellers loaded from sellers table scoped to currentOrg.id, filtered to ML-connected via ml_tokens.seller_id with access_token NOT NULL (D-11)"
  - "Logo/initials from sellers row; generateInitials fallback when initials IS NULL; logo null renders initials div (D-12)"
  - "Alphabetical sort via .order(name) in Supabase query (D-12)"
  - "sellerIdx reset via separate useEffect on sellers.length to fix Pitfall 2 (cycle effects depend on sellers.length)"
  - "Fetch re-triggers when sellers changes (org switch covered); loading guard when sellers.length=0"

patterns-established:
  - "Cancelled async guard pattern for multi-step async in useEffect"
  - "Dynamic seller list with ML-connected filter for TV mode"

requirements-completed: [MOCK-05]

# Metrics
duration: 3min
completed: 2026-06-13
---

# Phase 42 Plan 04: Zero Mock — TV Sellers Summary

**Dynamic org-scoped seller loading replacing hardcoded UUID array in TVModeVendas — /tv now multi-tenant via sellers table + ml_tokens join**

## Performance

- **Duration:** 3 min
- **Started:** 2026-06-13T16:46:55Z
- **Completed:** 2026-06-13T16:49:50Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Removed hardcoded SELLERS constant with two Pé Vermeio-specific UUIDs (8c57110c, 52a7ed04) — broken for any other tenant
- Added dynamic seller loading from sellers table filtered to currentOrg.id + is_active=true, ordered alphabetically by name (D-12)
- Filtered sellers to ML-connected only via ml_tokens.seller_id with access_token NOT NULL (D-11) — two-step async with cancelled guard
- Logo renders from sellers.logo_url; falls back to initials div using generateInitials(name) when logo_url is null (D-12)
- Fixed Pitfall 2: sellerIdx resets on sellers.length change; cycle effect depends on sellers.length
- Added loading/empty state guard: early return when sellers[sellerIdx] is undefined, showing "Carregando..." or "Nenhuma loja ML conectada" with Integrações call-to-action
- Build passes: npm run build green (TypeScript + bundle, TVModeVendas-C118ruy8.js generated)

## Task Commits

1. **Task 1: Replace SELLERS constant with dynamic org-scoped query** - `c2efcd43` (feat)

**Plan metadata:** (docs commit to follow via gsd-tools)

## Files Created/Modified

- `src/pages/TVModeVendas.tsx` - Removed SELLERS constant; added useOrganization, generateInitials imports; SellerEntry interface; sellers state + loading useEffect; sellerIdx reset effect; cycle effect with sellers.length dep; guard render; logo/initials fallback in JSX

## Decisions Made

- Two-step async for seller loading: first query sellers table, then query ml_tokens to build a connectedIds Set — avoids a Supabase join (not supported client-side) and keeps each step cancellable
- Fetch re-triggers whenever sellers state changes (covers initial load and org switch) rather than using hasFetchedRef once-only guard — simpler and correct for multi-org scenarios
- Empty state shows contextual message: "Carregando..." during initial load, "Nenhuma loja ML conectada" + link hint after load completes with 0 sellers

## Deviations from Plan

None — plan executed exactly as written. The implementation followed the pattern prescribed in 42-PATTERNS.md TVModeVendas section verbatim.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required. This is a pure frontend change reading from existing sellers + ml_tokens tables via RLS.

## Next Phase Readiness

- MOCK-05 complete: /tv is now multi-tenant correct
- Phase 42 Wave 3 complete (plans 03 and 04 both done in parallel — no file overlap)
- Phase 42 closure depends on plans 01-04 all merged — check 42-03 SUMMARY
- Phase 43 (Multi-Tenant Hardening): ME-04/05/06 deferred items (ml_tokens lookup, enumeração ml_user_id, RLS viewer) are the next relevant items

---
## Self-Check: PASSED

- src/pages/TVModeVendas.tsx: FOUND
- .planning/phases/42-zero-mock/42-04-SUMMARY.md: FOUND
- Task commit c2efcd43: FOUND
- grep "8c57110c|52a7ed04" TVModeVendas.tsx: 0 results (PASS)
- npm run build: green (PASS)

*Phase: 42-zero-mock*
*Completed: 2026-06-13*
