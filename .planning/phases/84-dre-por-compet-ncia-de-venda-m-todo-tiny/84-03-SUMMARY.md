---
phase: 84-dre-por-compet-ncia-de-venda-m-todo-tiny
plan: 03
subsystem: ui
tags: [react, typescript, tanstack-query, shadcn, dre, mercado-livre]

requires:
  - phase: 84-dre-por-compet-ncia-de-venda-m-todo-tiny
    provides: "ml_billing_daily.competence_date column typed (migration, plan 84-01) + EF writes competence_date (plan 84-02)"
provides:
  - "useMLBillingDaily filtra e computa coverageTo por competence_date (não mais charge_date)"
  - "MLCostCard: props months/selectedMonth/onSelectMonth + dropdown <Select> shadcn no cabeçalho"
  - "MercadoLivre.tsx: dreMonths (2026-01 → mês corrente) ligado ao dreMonthOverride existente"
affects: [84-04, 84-05, 84-06]

tech-stack:
  added: []
  patterns:
    - "Dropdown de mês opcional/retrocompatível: MLCostCard só renderiza <Select> quando months+onSelectMonth são passados, senão mantém o span textual mesLabel — permite adicionar a feature sem quebrar outros callers do componente"

key-files:
  created: []
  modified:
    - src/hooks/useMLBilling.ts
    - src/components/mercadolivre/MLCostCard.tsx
    - src/pages/MercadoLivre.tsx

key-decisions:
  - "onSelectMonth espelha exatamente a regra de colapso de shiftDreMonth: selecionar o mês igual a filterMonth volta a seguir o filtro (dreMonthOverride=null) em vez de fixar um override redundante"
  - "dreMonths gerado com loop decrescente mês-a-mês a partir de currentCalendarMonth até 2026-01 (inclusive) — a trava no futuro é estrutural (a lista nunca contém meses > corrente), não uma validação separada"

patterns-established: []

requirements-completed: []

duration: 8min
completed: 2026-07-03
status: complete
---

# Phase 84 Plan 03: DRE por competência de venda + dropdown de mês no MLCostCard Summary

**`useMLBillingDaily` passa a filtrar e computar `coverageTo` por `competence_date` (era `charge_date`), e `MLCostCard` ganha um dropdown de mês (shadcn `<Select>`, 2026-01→corrente) ao lado das setas ◄ ►, ligado ao mesmo estado `dreMonthOverride` que a navegação por setas já usava.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-07-03T17:44:00Z
- **Completed:** 2026-07-03T17:47:08Z
- **Tasks:** 3/3
- **Files modified:** 3

## Accomplishments
- `useMLBillingDaily` (`src/hooks/useMLBilling.ts`) troca `.gte/.lte("charge_date", ...)` por `.gte/.lte("competence_date", ...)` no range mensal 01→fim-do-mês, inclui `competence_date` no `.select(...)`, e o `coverageTo` (usado pelo guard de mês fechado de `useMLBillingDailyWithSync`) agora deriva de `MAX(r.competence_date)` em vez de `charge_date` — evita a quebra silenciosa descrita no Pitfall 2 do research (charge_date e competence_date divergem exatamente por causa desta fase).
- `MLCostCard` ganha três props opcionais (`months`, `selectedMonth`, `onSelectMonth`) e renderiza um `<Select>` shadcn compacto (`h-6 text-[10px] w-[104px]`) no cabeçalho, entre a badge de fonte e as setas — só quando `months`+`onSelectMonth` são fornecidos (fallback retrocompatível: continua mostrando o `mesLabel` textual). Desabilita durante `syncing`, exatamente como as setas. Setas `ChevronLeft`/`ChevronRight` preservadas sem alteração de comportamento.
- `MercadoLivre.tsx` monta `dreMonths` via `useMemo` (2026-01 → `currentCalendarMonth`, mais recente primeiro, label pt-BR reaproveitando o mesmo formato de `mesLabel`) e `handleDreSelectMonth`, que chama `setDreMonthOverride` com a mesma regra de colapso (`m === filterMonth ? null : m`) já usada por `shiftDreMonth`. `MLCostCard` recebe `months={dreMonths}`, `selectedMonth={billingMonth}`, `onSelectMonth={handleDreSelectMonth}`.
- `npx tsc --noEmit` limpo, `npm run build` limpo, `npx vitest run` → 414/414 testes passando (28 arquivos), incluindo os testes de `aggregate.test.ts` (plano 84-02) que continuam intactos.

## Task Commits

Each task was committed atomically:

1. **Task 1: useMLBillingDaily — filtro e coverageTo por competence_date** - `966b9468` (feat)
2. **Task 2: MLCostCard — dropdown de mês (Select shadcn) + prop onSelectMonth** - `02b8e27d` (feat)
3. **Task 3: MercadoLivre.tsx — lista de meses + wiring do onSelectMonth** - `4ae0b6b0` (feat)

_Nenhuma tarefa era TDD — sem ciclo RED/GREEN aplicável a este plano._

## Files Created/Modified
- `src/hooks/useMLBilling.ts` - `useMLBillingDaily`: select/filtro/coverageTo por `competence_date`; comentário do bloco atualizado. `useMLBilling`/`useMLBillingWithSync` (trilha `ml_billing_monthly`) e `groupBillingCharges` intactos.
- `src/components/mercadolivre/MLCostCard.tsx` - Novas props `months`/`selectedMonth`/`onSelectMonth`; `<Select>` shadcn condicional no cabeçalho, fallback para `mesLabel` textual quando as novas props não são passadas.
- `src/pages/MercadoLivre.tsx` - `dreMonths` (useMemo, 2026-01→corrente) e `handleDreSelectMonth` (useCallback); wiring das 3 novas props no uso de `MLCostCard`.

## Decisions Made
- `onSelectMonth` reutiliza a mesma regra de colapso de `shiftDreMonth` (mês selecionado == `filterMonth` → `dreMonthOverride=null`) em vez de sempre fixar um override, para manter o comportamento "segue o filtro" quando o usuário volta ao mês do filtro via dropdown.
- Trava no futuro do dropdown é estrutural: a lista `dreMonths` nunca contém meses posteriores a `currentCalendarMonth`, sem necessidade de lógica de disable adicional no `<SelectItem>`.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - autoria pura de frontend, sem deploy (merge/deploy é o plano 84-06, após backfill + smoke conforme o objetivo do plano).

## Next Phase Readiness
- `useMLBillingDaily`/`useMLBillingDailyWithSync` já operam sobre `competence_date` — dependem do backfill (fora deste plano) para que meses anteriores ao deploy da EF v-competência tenham dados reais de competência (hoje o valor é `charge_date` por causa do backfill de migração da coluna, plano 84-01).
- Dropdown de mês pronto para uso assim que este branch for mergeado/deployado; nenhuma mudança adicional de UI necessária para os planos seguintes desta fase.
- `ml_billing_monthly`/"fonte=billing" (fatura ML) permanece intacto — nenhum risco de regressão nessa trilha.
- Pendente (fora deste plano): backfill sequencial 2026-01→corrente (Pitfalls 2 e 3 do research) e o merge/go-live visual final (plano 84-06).

---
*Phase: 84-dre-por-compet-ncia-de-venda-m-todo-tiny*
*Completed: 2026-07-03*

## Self-Check: PASSED
All modified files found on disk (useMLBilling.ts, MLCostCard.tsx, MercadoLivre.tsx, 84-03-SUMMARY.md). All task commit hashes (966b9468, 02b8e27d, 4ae0b6b0) found in git log.
