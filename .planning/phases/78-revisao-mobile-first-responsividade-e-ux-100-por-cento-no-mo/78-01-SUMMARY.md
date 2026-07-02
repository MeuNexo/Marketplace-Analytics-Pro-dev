---
phase: 78-revisao-mobile-first-responsividade-e-ux-100-por-cento-no-mo
plan: "01"
subsystem: mobile-ux / layout-shell
status: complete
tags: [mobile, responsive, ux, layout, period-picker, organization-switcher]
dependency_graph:
  requires: []
  provides:
    - MLPeriodPicker responsivo (useIsMobile, numberOfMonths condicional, popover contido, quick ranges wrap)
    - OrganizationSwitcher acessível em viewport <640px (sem hidden sm:block no wrapper)
  affects:
    - Todas as páginas que usam MLPeriodPicker (Vendas, Financeiro, Pedidos, Devoluções, Fluxo de Caixa…)
    - Header em todas as telas autenticadas
tech_stack:
  added: []
  patterns:
    - useIsMobile hook para numberOfMonths condicional no Calendar
    - max-w-[calc(100vw-1rem)] no PopoverContent para limitar ao viewport
    - flex-wrap nos quick ranges para quebra de linha
    - max-w-[140px] sm:max-w-none no wrapper do OrganizationSwitcher
key_files:
  created: []
  modified:
    - src/components/mercadolivre/MLPeriodPicker.tsx
    - src/components/layout/Header.tsx
decisions:
  - "Task 1: useIsMobile (breakpoint 768px, padrão do projeto) controla numberOfMonths — 1 no mobile, 2 no desktop"
  - "Task 1: PopoverContent recebe max-w-[calc(100vw-1rem)] para não estourar o viewport em 360px"
  - "Task 1: flex-wrap adicionado ao container dos quick ranges (QUICK_RANGES map)"
  - "Task 2: Abordagem inline no Header (max-w-[140px] sm:max-w-none) — sem necessidade de drawer; OrganizationSwitcher já exibe apenas ícone+chevron no mobile (span interno tem hidden sm:inline)"
  - "Task 2: LayoutShell.tsx não precisou ser alterado — switcher coube no header mesmo em 360px"
metrics:
  duration: "~2 min"
  completed_date: "2026-07-02"
  tasks_completed: 2
  files_modified: 2
---

# Phase 78 Plan 01: MLPeriodPicker e OrganizationSwitcher Responsivos — Summary

**One-liner:** Calendário duplo no MLPeriodPicker trocado por numberOfMonths condicional via useIsMobile + popover limitado ao viewport + OrganizationSwitcher desbloqueado no mobile removendo wrapper hidden sm:block.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | MLPeriodPicker responsivo (A-01/C-02/C-14) | 27b1e0bd | src/components/mercadolivre/MLPeriodPicker.tsx |
| 2 | OrganizationSwitcher acessível no mobile (C-01) | a9686b98 | src/components/layout/Header.tsx |

## What Was Built

### Task 1 — MLPeriodPicker responsivo

Três findings corrigidos no mesmo arquivo (`src/components/mercadolivre/MLPeriodPicker.tsx`):

**[A-01/C-02] BLOCKER — Calendário duplo estoura viewport mobile**
- Adicionado `import { useIsMobile } from "@/hooks/use-mobile"` no topo do arquivo
- `const isMobile = useIsMobile()` chamado no corpo do componente (antes do return)
- `numberOfMonths={2}` substituído por `numberOfMonths={isMobile ? 1 : 2}`
- `disabled` callback do Calendar preservado intacto (inclui a lógica de `maxDaysBack`)

**[C-02 deduplication] PopoverContent limitado ao viewport**
- `className="w-auto p-3"` → `className="w-auto max-w-[calc(100vw-1rem)] p-3"`
- Em 360px de viewport o popover nunca ultrapassa a borda da tela

**[C-14] MINOR — Quick ranges sem flex-wrap**
- `<div className="flex gap-1 mb-3">` → `<div className="flex flex-wrap gap-1 mb-3">`
- Botões 7d/30d/90d/"Este mês" etc. quebram em múltiplas linhas quando não cabem

### Task 2 — OrganizationSwitcher acessível no mobile

**[C-01] BLOCKER — OrganizationSwitcher invisível no mobile**

Abordagem escolhida: **inline no Header, sem drawer** (abordagem mínima preferida do plano).

Motivo: o `OrganizationSwitcher` já tem `hidden sm:inline` no span interno do texto — em mobile ele exibe apenas o ícone Building2 + chevron (~40px de largura), sem texto truncado. Com `max-w-[140px]` no wrapper o switcher cabe confortavelmente na esquerda do header sem empurrar os elementos da direita.

Mudança: em `src/components/layout/Header.tsx`:
```diff
- <div className="hidden sm:block shrink-0">
+ <div className="shrink-0 max-w-[140px] sm:max-w-none">
    <OrganizationSwitcher />
  </div>
```

`LayoutShell.tsx` não precisou ser alterado.

## Verification

- `grep` gates: GATES_OK (Task 1) + HEADER_OK + SWITCHER_MOUNTED (Task 2)
- `npx vitest run`: 318/318 testes verdes (exit 0) — após Task 1 e após Task 2
- `npx vite build`: saída limpa em 27.94s (exit 0) — após Task 2
- Nenhuma mudança na lógica de seleção de datas, range retornado, ou troca de organização — apenas layout/visibilidade

## Deviations from Plan

None — plan executed exactly as written.

A abordagem escolhida para Task 2 foi a preferida do plano (mínima, inline no Header), sem precisar recorrer ao fallback do drawer.

## Known Stubs

None.

## Threat Flags

None. As mudanças são exclusivamente de layout/CSS/visibilidade. O OrganizationSwitcher já existia e é gated pela mesma lógica de auth/org — torná-lo visível no mobile não amplia o conjunto de orgs acessíveis (backend RLS org-first inalterado, conforme T-78-01 do threat model).

## Self-Check: PASSED

- FOUND: src/components/mercadolivre/MLPeriodPicker.tsx
- FOUND: src/components/layout/Header.tsx
- FOUND: commit 27b1e0bd (Task 1)
- FOUND: commit a9686b98 (Task 2)
