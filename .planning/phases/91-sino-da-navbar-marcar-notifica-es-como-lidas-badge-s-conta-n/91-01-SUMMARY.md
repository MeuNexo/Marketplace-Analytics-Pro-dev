---
phase: 91-sino-da-navbar-marcar-notifica-es-como-lidas-badge-s-conta-n
plan: 01
subsystem: layout/atendimento
tags: [bell, notifications, localStorage, tdd, client-only]
requires: []
provides:
  - "src/lib/bellSeen.ts (computeUnread + mergeAndPruneSeen + shouldSeed)"
  - "src/hooks/useBellSeen.ts (unreadCount + markAllSeen, keyed bell-seen:{orgId})"
  - "useAtendimentoPendencias.isReady readiness signal"
affects:
  - "src/components/layout/AtendimentoBell.tsx (badge = unread, open = markAllSeen)"
tech-stack:
  added: []
  patterns: [pure-lib-tested, tdd-red-green, localStorage-per-org, tanstack-isFetched-readiness]
key-files:
  created:
    - src/lib/bellSeen.ts
    - src/lib/bellSeen.test.ts
    - src/hooks/useBellSeen.ts
  modified:
    - src/hooks/useAtendimentoPendencias.ts
    - src/components/layout/AtendimentoBell.tsx
decisions:
  - "Comparação por key estável (q-/c-), nunca por timestamp (data_abertura granularidade de dia)"
  - "Readiness = enabled && query.isFetched (TanStack v5: query desabilitada tem isLoading=false)"
  - "Semeadura gateada por shouldSeed → nunca semeia na janela fria com items=[]"
  - "mergeAndPruneSeen retorna keys vivas dedupadas (merge+prune = live set)"
metrics:
  duration: ~4min
  completed: 2026-07-07
  tasks: 3
  files: 5
status: complete
---

# Phase 91 Plan 01: Sino da navbar — badge só novidades Summary

Badge do sino de atendimento passou de "total de pendências vivas" para "novidades ainda não vistas": abrir o popover marca tudo como visto e zera o badge (persistido em `localStorage` por org), que só volta a subir quando chega algo genuinamente novo via o refetch de 45s. Header e lista continuam mostrando o TOTAL de pendências.

## What Was Built

- **`src/lib/bellSeen.ts`** — 3 funções puras React-free: `computeUnread(items, seenKeys)` (nº de keys não vistas), `mergeAndPruneSeen(seenKeys, items)` (novo set = keys vivas dedupadas = merge + prune), `shouldSeed(seen, orgId, isReady)` (`seen===null && !!orgId && isReady`).
- **`src/lib/bellSeen.test.ts`** — 11 testes cobrindo os 6 cenários A–F (semear zera, item novo, já-visto, abrir zera, prune de resolvidos, guard de prontidão cold-start).
- **`src/hooks/useAtendimentoPendencias.ts`** — mudança aditiva: retorna `isReady = enabled && query.isFetched` (queryFn/refetch/data intocados).
- **`src/hooks/useBellSeen.ts`** — hook `useBellSeen(items, isReady)` → `{ unreadCount, markAllSeen }`; lê orgId via `useOrganization()`; localStorage `bell-seen:{orgId}` com guarda SSR + try/catch (espelha `useDashboardLayout`); semeadura gateada por `shouldSeed`; deps estabilizadas via `itemsKey` memoizado.
- **`src/components/layout/AtendimentoBell.tsx`** — badge usa `unreadCount` ("9+" acima de 9, some em 0); `Popover onOpenChange(true) → markAllSeen()` (mantido não-controlado); header/lista seguem no `count`/`items`; aria-label reflete unread vs total.

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- `npx vitest run src/lib/bellSeen.test.ts` → 11 passed (1 file).
- `npx tsc --noEmit` → 0 erros.
- `npm run build` → built in 23.50s (sucesso).
- `npx vitest run` (suíte completa) → 493 passed (35 files), sem regressão.
- Grep de fiação: `useBellSeen(items, isReady)` e `onOpenChange` presentes em `AtendimentoBell.tsx`.

## Commits

- 96a17820 test(91-01): failing tests for bellSeen (RED)
- a2a1b136 feat(91-01): implement bellSeen pure functions (GREEN)
- ae300c0c feat(91-01): expose readiness + useBellSeen hook
- 6d61b506 feat(91-01): wire AtendimentoBell to unreadCount + markAllSeen

## TDD Gate Compliance

RED (`test(91-01)`) → GREEN (`feat(91-01)`) gate sequence present in git log. REFACTOR não necessário.

## Self-Check: PASSED

- FOUND: src/lib/bellSeen.ts
- FOUND: src/lib/bellSeen.test.ts
- FOUND: src/hooks/useBellSeen.ts
- FOUND: commits 96a17820, a2a1b136, ae300c0c, 6d61b506
