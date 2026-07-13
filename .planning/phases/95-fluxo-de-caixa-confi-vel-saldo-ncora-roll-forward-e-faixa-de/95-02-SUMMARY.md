---
phase: 95-fluxo-de-caixa-confiavel
plan: 02
subsystem: ui
tags: [react, tanstack-query, supabase-rpc, vitest, tdd, financeiro, fluxo-de-caixa]

# Dependency graph
requires:
  - phase: 95-01
    provides: "get_cashflow_data_health e set_financial_balance RPCs (authored in migrations, not yet applied to live DB)"
provides:
  - "useCashflowDataHealth hook (TanStack Query) mapeando 6 flags de saúde dos dados"
  - "CashflowHealthBanner — faixa condicional acionável no topo de /fluxo-de-caixa"
  - "MLFluxoCaixa.tsx: AdjustBalanceDialog grava via set_financial_balance (upsert direto removido)"
affects: [95-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hook de RPC escalar única com TanStack Query, molde useTreasuryPanel.ts (queryKey com orgId, enabled !!orgId, staleTime 3min)"
    - "Teste de hook mockando supabase.rpc = vi.fn() diretamente (não a chain from/select/eq), molde useDreOperational.test.ts"
    - "Banner condicional que retorna null quando nada stale, com uma linha por gatilho ativo"

key-files:
  created:
    - src/hooks/useCashflowDataHealth.ts
    - src/hooks/useCashflowDataHealth.test.ts
    - src/components/financial/CashflowHealthBanner.tsx
  modified:
    - src/pages/mercadolivre/MLFluxoCaixa.tsx

key-decisions:
  - "Coerção de *_stale via comparação explícita (=== true || === 'true') em vez de Boolean() puro, para não confundir com string 'false' (que é truthy em JS)"
  - "Banner inserido entre o header sticky e as Tabs (fora do <Tabs>), garantindo visibilidade em Caixa Real E Simulador"
  - "invalidateQueries de ['cashflow','data_health',orgId] adicionado ao handleSave para o banner reavaliar a âncora imediatamente após reancorar"

patterns-established:
  - "Toda nova RPC de leitura escalar única deve seguir o molde useTreasuryPanel.ts"
  - "Todo teste de hook que usa supabase.rpc deve mockar rpc: vi.fn() diretamente, nunca a chain from/select/eq"

requirements-completed: [CASH-95-05, CASH-95-06]

# Metrics
duration: 25min
completed: 2026-07-13
status: complete
---

# Phase 95 Plan 02: Faixa de Saúde dos Dados (Frontend) Summary

**Hook + banner condicional que expõem staleness de Tiny/MP/âncora no topo de /fluxo-de-caixa, e AdjustBalanceDialog agora grava a âncora atomicamente via RPC set_financial_balance em vez de upsert parcial.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-13T13:02:38Z
- **Tasks:** 3/3
- **Files modified:** 4 (3 criados, 1 editado)

## Accomplishments
- `useCashflowDataHealth` criado com TDD (testes escritos antes da implementação, RED→GREEN): chama `supabase.rpc('get_cashflow_data_health', { p_org_id })`, mapeia `tinyHoursAgo/tinyStale`, `mpHoursAgo/mpStale`, `anchorDaysAgo/anchorStale`, trata erro (`isError`), fica `disabled` sem org, e coage tipos que o Postgres pode devolver como string.
- `CashflowHealthBanner` criado: retorna `null` durante loading, quando não há dado, ou quando nenhuma flag stale é `true`; caso contrário renderiza uma linha por gatilho ativo (Tiny com `<Link to="/integracoes">`, MP e âncora sem link), seguindo o molde de `Alert`/`AlertDescription` já usado em `MLPedidos.tsx`.
- `MLFluxoCaixa.tsx`: banner inserido entre o header sticky e as `<Tabs>` (visível em Caixa Real e Simulador); `AdjustBalanceDialog.handleSave` trocou o `.from("financial_settings").upsert(...)` (que nunca gravava `balance_anchor_date`) por `supabase.rpc("set_financial_balance", { p_org_id, p_amount })`, e a invalidação de queries passou a incluir `["cashflow","data_health",orgId]`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Hook useCashflowDataHealth + testes (TDD)** - `c4bdb0a2` (feat)
2. **Task 2: Componente CashflowHealthBanner** - `48e94716` (feat)
3. **Task 3: Wire em MLFluxoCaixa.tsx** - `05ad302b` (feat)

**Plan metadata:** (this commit)

_Note: Task 1 is TDD — tests were authored first against the not-yet-existing hook (confirmed RED via
"Failed to resolve import" error), then the hook was implemented (GREEN, 5/5 tests passing). Both files
landed in a single commit per this plan's task granularity (task-level, not RED/GREEN-split commits)._

## Files Created/Modified
- `src/hooks/useCashflowDataHealth.ts` - Hook TanStack Query da RPC `get_cashflow_data_health`, mapeia 6 flags
- `src/hooks/useCashflowDataHealth.test.ts` - 5 testes (chamada+mapeamento, coerção de tipos, error path, disabled sem org, data vazio)
- `src/components/financial/CashflowHealthBanner.tsx` - Faixa de alerta condicional acionável por gatilho
- `src/pages/mercadolivre/MLFluxoCaixa.tsx` - Banner inserido acima das Tabs; handleSave usa `set_financial_balance`

## Decisions Made
- Coerção de `*_stale`: usei `r.tiny_stale === true || r.tiny_stale === "true"` em vez de `Boolean(r.tiny_stale)` puro, porque `Boolean("false")` é `true` em JS — o teste de coerção (Test 2) capturou esse detalhe exatamente como o padrão de `double_count_risk` em `useDreOperational.test.ts` sugeria.
- Arredondamento de horas/dias feito no componente (`Math.round`) e não no hook, mantendo o hook fiel aos números crus da RPC (sem lógica de apresentação no data layer).

## Deviations from Plan

None - plan executado exatamente como escrito. O único ajuste foi um erro de digitação na minha própria expectativa de teste (Test 2: eu havia escrito `mp_stale: "false"` esperando `mpStale: true`, o que estava invertido) — corrigido antes do commit, não é um deviation de código de produção, é uma correção do próprio arquivo de teste durante o ciclo RED→GREEN.

## Issues Encountered

None além do já descrito acima (erro de digitação no meu próprio teste, corrigido no mesmo ciclo TDD antes de qualquer commit).

## User Setup Required

None - nenhuma configuração de serviço externo necessária. As migrations de `get_cashflow_data_health`/`set_financial_balance` (Plan 95-01) ainda não estão aplicadas no banco vivo — isso é responsabilidade do Plan 95-03 (deploy via MCP pelo orquestrador). Até lá, os componentes desta plan funcionam corretamente em runtime só depois que 95-03 aplicar as migrations; localmente (vitest) tudo roda mockado, sem tocar o banco real.

## Next Phase Readiness
- Hook, componente e wiring prontos para o deploy de 95-03 (aplicar migrations via MCP + smoke test visual: banner aparece/some por flag, reancoragem atualiza `balance_anchor_date`).
- tsc limpo e suíte vitest completa (40 arquivos / 542 testes) verde, sem regressão em nenhum teste pré-existente.
- Validação visual do banner (aparece com flag stale real, some quando saudável) e da reancoragem via UI são checkpoints explícitos do Plan 95-03, conforme a seção `<verification>` deste plano já apontava.

## Self-Check: PASSED

All created files found on disk; all 3 task commit hashes (c4bdb0a2, 48e94716, 05ad302b) confirmed in git log.

---
*Phase: 95-fluxo-de-caixa-confiavel*
*Completed: 2026-07-13*
