---
phase: 91-sino-da-navbar-marcar-notifica-es-como-lidas-badge-s-conta-n
verified: 2026-07-07T17:45:00Z
status: passed
score: 7/7 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 91: Sino da navbar — badge só novidades não vistas — Verification Report

**Phase Goal:** O badge do sino conta só novidades ainda não vistas (não o total de pendências); abrir o sino zera o badge e persiste por org em localStorage; o badge sobe de novo só quando chega algo novo; header/lista do popover seguem mostrando o TOTAL. Client-only, sem backend.
**Verified:** 2026-07-07
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | 1ª visita (sem localStorage) badge começa em 0, mesmo com pendências vivas | ✓ VERIFIED | `useBellSeen`: `seen` inicia `null`; `unreadCount = seen === null ? 0 : computeUnread(...)` (linha 75). Effect(1) `loadSeen`→`null` quando sem registro; badge fica 0 até semear. |
| 2 | Semeadura só DEPOIS que a query fica pronta (enabled + isFetched), nunca na janela fria | ✓ VERIFIED | `useAtendimentoPendencias` retorna `isReady = enabled && query.isFetched` (linha 100). `AtendimentoBell` passa `isReady` (NÃO `isLoading`) a `useBellSeen(items, isReady)` (linha 42). Effect de semeadura gateado por `shouldSeed(seen, orgId, isReady)` (linha 67). `shouldSeed` retorna false quando `isReady===false`. |
| 3 | Pendência nova via refetch → badge sobe para nº de não-vistos | ✓ VERIFIED | `computeUnread(items, seen)` filtra por `key` ausente do set visto (bellSeen.ts:18-21); testes B cobrem item novo. |
| 4 | Abrir o popover zera o badge (marca visto) e persiste em localStorage | ✓ VERIFIED | `<Popover onOpenChange={(open)=>{ if(open) markAllSeen(); }}>` (AtendimentoBell:53); `markAllSeen` → `mergeAndPruneSeen` + `saveSeen(orgId,next)` (useBellSeen:77-83). |
| 5 | Header ("X item(s)") e lista seguem no TOTAL, não nos não-vistos | ✓ VERIFIED | Header usa `{count} item(s)` (AtendimentoBell:72); lista `items.slice(0,30)` (linha 82); só o badge usa `unreadCount` (linhas 62-64). |
| 6 | Pendência resolvida tem key removida do set visto ao abrir (prune) | ✓ VERIFIED | `mergeAndPruneSeen` retorna `[...new Set(items.map(i=>i.key))]` = keys vivas dedupadas (prune implícito); teste E confirma `c-9` removido. |
| 7 | Estado visto chaveado por org (`bell-seen:{orgId}`) — não vaza entre orgs | ✓ VERIFIED | `KEY_PREFIX="bell-seen:"`; chave `${KEY_PREFIX}${orgId}` (useBellSeen:23,36); Effect(1) recarrega em `[orgId]`, orgId nulo → `setSeen(null)`. |

**Score:** 7/7 truths verified (0 present, behavior-unverified)

**Nota sobre truths behavior-dependent (1, 2, 4):** são transições de estado dentro do hook. Cada decisão pura que as governa (`computeUnread`, `mergeAndPruneSeen`, `shouldSeed`) é unit-testada (11 testes, cenários A–F) e a orquestração dos `useEffect`/`useState` que as compõe foi verificada por leitura direta — a cadeia de guardas é fechada (`seen===null` impede re-semeadura; `shouldSeed` impede semeadura fria). Não há teste React exercitando a sequência cold-start→semear→zerar; recomenda-se uma confirmação visual em browser (advisory, abaixo), mas as evidências de código são suficientes para VERIFIED.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/bellSeen.ts` | computeUnread + mergeAndPruneSeen + shouldSeed, React-free | ✓ VERIFIED | 3 named exports, sem import de React/Supabase; 53 linhas; comparação por `key`. |
| `src/lib/bellSeen.test.ts` | 6 cenários A–F | ✓ VERIFIED | 11 testes (inclui guard F de prontidão); todos verdes. |
| `src/hooks/useBellSeen.ts` | unreadCount + markAllSeen, keyed bell-seen:{orgId} | ✓ VERIFIED | 86 linhas; SSR guard + try/catch em loadSeen/saveSeen; deps estabilizadas por `itemsKey`. |
| `src/hooks/useAtendimentoPendencias.ts` | expõe isReady = enabled && query.isFetched | ✓ VERIFIED | linha 100-101; queryFn/refetch intocados (mudança aditiva). |
| `src/components/layout/AtendimentoBell.tsx` | badge=unreadCount; open→markAllSeen | ✓ VERIFIED | badge usa unreadCount c/ "9+"; onOpenChange dispara markAllSeen; header/lista no total. |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| AtendimentoBell.tsx | useBellSeen.ts | `useBellSeen(items, isReady)` (linha 42) | ✓ WIRED |
| useBellSeen.ts | bellSeen.ts | `computeUnread`/`mergeAndPruneSeen`/`shouldSeed` (import linha 3) | ✓ WIRED |
| AtendimentoBell.tsx | useBellSeen.ts | `Popover onOpenChange` → markAllSeen (linha 53) | ✓ WIRED |
| useAtendimentoPendencias.ts | AtendimentoBell.tsx | `isReady` consumido e repassado (não `isLoading`) | ✓ WIRED |
| Header.tsx | AtendimentoBell.tsx | `<AtendimentoBell />` montado (Header:135) | ✓ WIRED |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| BELL-01 | Badge = não-vistos (unreadCount), não total | ✓ SATISFIED | Badge renderiza `unreadCount`; header/lista no `count`. |
| BELL-02 | Abrir zera + persiste em `bell-seen:{orgId}` | ✓ SATISFIED | onOpenChange→markAllSeen→saveSeen. |
| BELL-03 | Prune de keys resolvidas | ✓ SATISFIED | mergeAndPruneSeen = live set; teste E. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| tsc typecheck | `npx tsc --noEmit` | exit 0, 0 erros | ✓ PASS |
| Suíte completa vitest | `npx vitest run` | 493 passed (35 files) | ✓ PASS |
| bellSeen unit tests | (incluído acima) | 11 passed | ✓ PASS |

### Anti-Patterns Found

Nenhum. Sem TODO/FIXME/XXX/TBD/HACK nos arquivos da phase. Os dois `eslint-disable react-hooks/exhaustive-deps` em useBellSeen.ts são documentados e intencionais (estabilização via `itemsKey` + guard `seen===null`), não são débito não-referenciado.

### Human Verification Required (advisory — não bloqueante)

1. **Confirmação visual do ciclo do badge** — abrir o app com pendências vivas: badge deve iniciar em 0 (1ª visita); simular chegada de nova pendência (refetch 45s) → badge sobe; abrir o sino → badge zera; header segue mostrando o total. **Por que humano:** a orquestração de `useEffect` no cold-start é verificada por leitura + funções puras testadas, mas nenhum teste React exercita a sequência de renders em browser. Baixa prioridade — evidência de código é forte.

### Gaps Summary

Nenhum gap. Os 7 truths estão satisfeitos no código, todos os artefatos existem/substantivos/fiados, os 5 key links estão conectados (incl. o crítico: `isReady`, não `isLoading`, é passado ao `useBellSeen`), BELL-01/02/03 cobertos, e ambos os gates passam (tsc 0, vitest 493/493). Feature client-only sem backend, conforme escopo.

---

_Verified: 2026-07-07T17:45:00Z_
_Verifier: Claude (gsd-verifier)_
