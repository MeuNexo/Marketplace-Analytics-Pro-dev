# Testing

## Summary

Testing is **minimal**. The project has a functioning test infrastructure set up but contains only a single placeholder test. No component, hook, service, or integration logic is covered by automated tests.

---

## Testing Infrastructure

### Tools
| Tool | Version | Role |
|---|---|---|
| `vitest` | ^3.2.4 | Test runner |
| `@testing-library/react` | ^16.0.0 | React component testing utilities |
| `@testing-library/jest-dom` | ^6.6.0 | DOM matchers (`toBeInTheDocument`, etc.) |
| `jsdom` | ^20.0.3 | Browser environment simulation |

### Configuration
`vitest.config.ts` at the repo root:
- Environment: `jsdom`
- Globals: `true` (no need to import `describe`/`it`/`expect` in test files)
- Setup file: `src/test/setup.ts`
- Include pattern: `src/**/*.{test,spec}.{ts,tsx}`
- Path alias `@/` → `src/` (mirrors Vite config)

### Setup File
`src/test/setup.ts` imports `@testing-library/jest-dom` and polyfills `window.matchMedia` (needed for components that use media queries). No other global mocks or providers are configured.

### NPM Scripts
- `npm test` / `bun test` → `vitest run` (single-run, CI mode)
- `npm run test:watch` / `bun run test:watch` → `vitest` (watch mode)

---

## Existing Test Files

### `src/test/example.test.ts`
The only test file in the project. It is a scaffold placeholder:
```ts
import { describe, it, expect } from "vitest";

describe("example", () => {
  it("should pass", () => {
    expect(true).toBe(true);
  });
});
```
This test asserts nothing meaningful about the application.

---

## What Is NOT Tested

### Hooks
None of the custom hooks have tests:
- `useMLQueries.ts` — React Query wrappers (`useMLDailyQuery`, `useMLHourlyQuery`, `useMLProductsQuery`, etc.)
- `useMLFilters.ts` — date range calculations (`getFilterDates`, `getComparisonRanges`, `useMLFilters`)
- `useMLSync.ts` — sync state machine with module-level singleton
- `useMLReputation.ts` — fetch + normalization logic
- `useMLAds.ts`, `useMLCoverage.ts`, `useMLPrecosCustos.ts`, `useMLProductCosts.ts`

### Services
- `src/services/mlCacheService.ts` — Supabase query functions (`fetchDailyCache`, `fetchHourlyCache`, `fetchUserCache`, `fetchStateDailyCache`, `fetchScopedRows`, `dedupeLatestRows`)

### Pure Utility Functions
These are pure functions that would be straightforward to unit test but have no tests:
- `mapDailyRow`, `mapHourlyRow` in `src/types/mlCache.ts`
- `getFilterDates`, `getComparisonRanges`, `cutoffDateStr`, `todayUTC` in `src/hooks/useMLFilters.ts`
- `cn` in `src/lib/utils.ts`
- `calcDelta` in `src/components/mercadolivre/MLKPIGrid.tsx`
- `normalizeReputation` in `src/hooks/useMLReputation.ts`
- `dedupeLatestRows` in `src/services/mlCacheService.ts`

### Components
No component tests exist. Components with non-trivial rendering logic that would benefit from tests:
- `KPICard` (`src/components/dashboard/KPICard.tsx`) — variant styles, loading/refreshing states, delta rendering
- `ErrorBoundary` (`src/components/ErrorBoundary.tsx`) — error capture and retry
- `ProtectedRoute` / `RoleRoute` / `AdminProtectedRoute` — auth redirect logic
- `MLKPIGrid` — conditional metric rendering

### Contexts
No tests for context providers:
- `AuthContext` — sign-in flow, role assignment, token refresh handling
- `OrganizationContext` — org loading, `switchOrg`, viewer permissions
- `MLStoreContext`, `SellerContext`

### Pages
No page-level integration or smoke tests.

### End-to-End (E2E)
No E2E test framework (Playwright, Cypress) is installed or configured.

---

## Coverage Level

**Effectively 0%.** The single existing test (`expect(true).toBe(true)`) covers no production code. There is no coverage reporting configured in `vitest.config.ts`.

---

## What Would Be Highest Value to Add

1. **Unit tests for pure utility functions** — `getFilterDates`, `getComparisonRanges`, `mapDailyRow`, `dedupeLatestRows`. No mocking required; pure input/output.
2. **Hook tests with `renderHook`** — `useMLFilters` and `useMLSync`'s `shouldAutoSync`/`resetSync` logic are good candidates; they depend only on local state or `localStorage`.
3. **Component snapshot/behavior tests** — `KPICard` loading state, `ErrorBoundary` retry button, `ProtectedRoute` redirect behavior (mock auth context).
4. **Context tests** — `OrganizationContext` `switchOrg` and `effectiveLoading` guard logic; these handle subtle race conditions worth protecting.
