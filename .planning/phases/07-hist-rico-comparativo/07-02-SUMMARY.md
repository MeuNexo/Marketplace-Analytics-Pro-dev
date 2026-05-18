---
phase: 07-hist-rico-comparativo
plan: "02"
subsystem: mercadolivre/analise
tags: [historico, comparativo, snapshots, elasticidade, precificacao]
dependency_graph:
  requires:
    - "07-01 (ELASTICITY_BADGE, elasticityConfig.ts)"
    - "useAnalysisSnapshots hook"
    - "useMLPrecosCustos hook"
    - "MLStoreContext, OrganizationContext"
  provides:
    - "HistoricoSnapshotTable component"
    - "HistoricoComparacaoPanel component"
    - "HistoricoComparativo container"
    - "Histórico tab in MLPrecificacao"
  affects:
    - "src/pages/mercadolivre/MLPrecificacao.tsx"
tech_stack:
  added: []
  patterns:
    - "React.lazy + Suspense for code-splitting"
    - "Radix Checkbox (shadcn) for max-2 selection"
    - "Intl-free date formatting via date-fns format()"
    - "Sorted tuple [older, newer] for comparison diff"
key_files:
  created:
    - src/components/mercadolivre/analise/HistoricoSnapshotTable.tsx
    - src/components/mercadolivre/analise/HistoricoComparacaoPanel.tsx
    - src/components/mercadolivre/analise/HistoricoComparativo.tsx
  modified:
    - src/pages/mercadolivre/MLPrecificacao.tsx
decisions:
  - "Used date-fns format() (already a project dependency in 23 files) rather than Intl.DateTimeFormat"
  - "Wrapped Suspense around the entire motion.div content block rather than just HistoricoComparativo, keeping SimuladorPrecificacao and AnaliseDashboard under the same Suspense boundary for consistency"
  - "HistoricoComparativo shows empty-state text when no product selected (outside the itemId guard) to guide users"
metrics:
  duration: "~10 minutes"
  completed: "2026-05-18"
  tasks_completed: 4
  files_changed: 4
---

# Phase 7 Plan 02: Histórico Comparativo Summary

One-liner: Tabela de snapshots com seleção dupla e painel de comparação lado a lado (preços GMV/Neutro/Margem, elasticidade, classificação) integrados à nova aba "Histórico" em MLPrecificacao.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | HistoricoSnapshotTable | 0c852a0 | HistoricoSnapshotTable.tsx |
| 2 | HistoricoComparacaoPanel | 0c852a0 | HistoricoComparacaoPanel.tsx |
| 3 | HistoricoComparativo (container) | 0c852a0 | HistoricoComparativo.tsx |
| 4 | Adicionar aba Histórico | 0c852a0 | MLPrecificacao.tsx |

## Acceptance Criteria (HIST-02)

1. **Usuário vê lista de análises salvas** — HistoricoSnapshotTable renderiza colunas Data, Período, Preço GMV, Preço Neutro, Preço Margem, Elasticidade com badge colorido. Dados vêm de `fetchSnapshots(itemId, orgId)`.

2. **Usuário seleciona duas análises e vê comparação** — HistoricoComparacaoPanel recebe tupla `[older, newer]` e exibe 6 linhas de comparação com diff colorido (verde/vermelho) para preços e elasticidade, badges para classificação.

3. **Restrição de seleção máxima (2)** — `disabled={selected.length >= 2 && !selected.includes(snapshot.id)}` no Checkbox.

4. **Seleção reseta ao trocar produto** — `setSelected([])` no início do `useEffect` que dispara quando `itemId` muda.

5. **Aba "Histórico"** visível ao lado de "Simulador" e "Análise" em MLPrecificacao.

## Verification Results

- `npx tsc --noEmit`: **0 errors**
- `npm test`: **63/63 tests passing**
- `grep -rn "const ELASTICITY_BADGE" src/components/mercadolivre/analise/Historico*.tsx`: zero lines (ELASTICITY_BADGE imported, never redefined)
- `grep -n "historico" src/pages/mercadolivre/MLPrecificacao.tsx`: entry in TABS + render conditional

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all data flows through real `fetchSnapshots` from Supabase.

## Threat Flags

None — no new trust boundaries introduced. `orgId` sourced from `useOrganization()` context (same as AnaliseDashboard), satisfying T-07-03 disposition.

## Self-Check: PASSED

- `src/components/mercadolivre/analise/HistoricoSnapshotTable.tsx` — FOUND
- `src/components/mercadolivre/analise/HistoricoComparacaoPanel.tsx` — FOUND
- `src/components/mercadolivre/analise/HistoricoComparativo.tsx` — FOUND
- `src/pages/mercadolivre/MLPrecificacao.tsx` (modified) — FOUND
- Commit `0c852a0` — FOUND
