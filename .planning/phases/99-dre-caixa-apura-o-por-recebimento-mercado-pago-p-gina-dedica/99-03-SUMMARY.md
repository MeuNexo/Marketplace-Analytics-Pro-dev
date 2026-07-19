---
phase: 99-dre-caixa-apura-o-por-recebimento-mercado-pago-p-gina-dedica
plan: 03
subsystem: financeiro
tags: [react, recharts, tanstack-query, supabase, dre, caixa, mercado-pago, reconciliacao]

# Dependency graph
requires:
  - phase: 99-01
    provides: "RPCs get_dre_cash / get_dre_cash_items / get_dre_cash_history em prod"
  - phase: 99-02
    provides: "Lib pura dreCashCascade.ts + hooks useDreCash/Items/History/useCashFreshness"
provides:
  - "Página /dre-caixa em produção: header+badge-resposta, 4 KPI tiles, cascata com drill-down por categoria, gráfico+tabela de evolução 12m, banner dado-velho duplo"
  - "Wiring completo: rota lazy + RoleRoute, role OPERATIONAL, meta de header, item de menu desktop+mobile"
  - "4 fixes de reconciliação nascidos do checkpoint: fornecedores como saída, estorno como saída no mês da devolução (refund_date), bloco excluído por categoria com drill-down"
  - "Gates #4 (reconciliação mês fechado × extrato MP) e #5 (ok visual) do spec da phase 99 aprovados por Wesley"
affects: [100]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Página financeira autocontida (padrão MLFluxoCaixa): componentes internos no próprio arquivo até ~400 linhas"
    - "Reconciliação de caixa por refund_date (não pela data da venda original) — estorno pesa no mês em que o dinheiro efetivamente saiu"
    - "Bloco 'excluido' de uma cascata renderizado com drill-down por categoria em vez de single-line — reaproveitável em outras cascatas financeiras"

key-files:
  created:
    - src/pages/mercadolivre/MLDreCaixa.tsx
  modified:
    - src/App.tsx
    - src/config/roleAccess.ts
    - src/components/layout/routeMeta.ts
    - src/components/layout/ApiSidebar.tsx
    - src/components/layout/ApiMobileSidebar.tsx
    - src/lib/dreCashCascade.ts
    - supabase/functions/sync-mp-releases/index.ts
    - supabase/migrations/20260717010000_dre_cash_history_fornecedores.sql
    - supabase/migrations/20260717020000_dre_cash_estorno_como_saida.sql
    - supabase/migrations/20260717030000_cash_inflows_refund_date.sql

key-decisions:
  - "Fornecedores (bloco 'excluido' da cascata) somam como saída no total do mês — decisão do checkpoint, não estava no plano original"
  - "Estorno de Mercado Pago pesa no mês em que o dinheiro efetivamente saiu (refund_date), não no mês da venda original — exigiu nova coluna cash_inflows.refund_date + EF sync-mp-releases v6 + backfill days_back=170 (fev→jul completo, 90 estornos remapeados de mês)"
  - "Bloco 'excluido' exibido por categoria (Fornecedores / ADS ML / Envios Full) com drill-down filtrado, em vez de linha única opaca"
  - "Reconciliação aceita diferença de créditos não-ML no extrato MP (bruto 290.518,08 vs relatório MP 299.198,69) como esperada por design — não é bug"

patterns-established:
  - "Cascata de caixa: bloco excluído nunca é 'linha morta' — sempre expõe categorias + drill-down, mesmo quando fica fora do somatório operacional"

requirements-completed: [DREC-04, DREC-05, DREC-06]

# Metrics
duration: ~3h (23:12 16/07 → 02:15 17/07 UTC, incluindo checkpoint humano)
completed: 2026-07-17
status: complete
---

# Phase 99 Plan 03: Página /dre-caixa + Reconciliação Mercado Pago Summary

**Página `/dre-caixa` completa em produção (badge-resposta, 4 KPIs, cascata com drill-down, evolução 12m, banner de frescor duplo) — reconciliada ao centavo (~R$1 de diferença) contra a planilha manual do Wesley e aprovada por ele após 4 fixes de reconciliação (fornecedores como saída, estorno no mês da saída real via refund_date, drill-down por categoria no bloco excluído).**

## Performance

- **Duration:** ~3h corridas (Task 1+2 em minutos; Task 3 = checkpoint humano com 4 rodadas de fix)
- **Started:** 2026-07-16T23:12:02Z
- **Completed:** 2026-07-17T02:14:52Z
- **Tasks:** 3 (2 auto + 1 checkpoint humano com 4 fixes)
- **Files modified:** 15 (1 página nova + 5 wiring + 1 lib + 1 EF + 3 migrations + 2 docs + .gitignore)

## Accomplishments
- `MLDreCaixa.tsx`: layout LOCKED topo→baixo completo — seletor de mês + badge-resposta (verde/vermelho/neutro com selo "mês em andamento"), 4 KPICards (entradas líquidas, saídas pagas, resultado, previsão imposto × guia com alerta de desvio), cascata com Collapsible por bloco + drill-down de lançamentos individuais, gráfico ComposedChart 12m + tabela histórico, banner de dado-velho acusando cada fonte (MP/Tiny) separadamente.
- Wiring completo em rota (`/dre-caixa` lazy + RoleRoute), role (`OPERATIONAL`, fora de VIEWER_ELIGIBLE_ROUTES), meta de header, e paridade de menu desktop+mobile.
- **Reconciliação de junho/2026 fechou em ~R$ 1** contra a aba GERENCIAL/CAIXA da planilha manual do Wesley (maio fechou a R$ 133: −24.341,13 sistema vs −24.474,43 planilha).
- Entradas × app Mercado Pago: bruto 290.518,08 vs relatório MP 299.198,69 — diferença explicada por créditos não-ML (comportamento esperado, não é bug).
- Taxa de retenção ML consistente: 21,8-21,9% no sistema vs 22,1% na planilha.
- Preview validado por Wesley: https://marketplace-analytics-pro-q8wnwo112-xambrafios-projects.vercel.app (deploy CLI, commit `354d44e8`).
- Suíte final: 626/626 testes verdes, `tsc --noEmit` limpo, `npm run build` ok.

## Task Commits

Cada task foi commitada atomicamente:

1. **Task 1: Página MLDreCaixa.tsx completa** - `6c1e829d` (feat)
2. **Task 2: Wiring rota/role/meta/menus** - `48411d0b` (feat)
3. **Task 3: Reconciliação + ok visual (checkpoint humano, 4 fixes durante a validação):**
   - `ee99c1ba` / `61280d1e` (fix) — Fornecedores somam como saída no histórico e na cascata de caixa (+ `9dbdad1b` docs decisão do checkpoint)
   - `0f1abf7d` / `14742f72` (fix) — Entrada cheia + estorno como linha de saída nas RPCs e na cascata (+ `172824b3` docs reconciliação fecha a ~R$1)
   - `fa17c1d4` / `a9d8d75d` (fix) — Estorno pesa no mês da saída real (`refund_date`), migration `cash_inflows.refund_date` + EF `sync-mp-releases` v6, backfill days_back=170
   - `9274bf1d` / `354d44e8` (fix) — Bloco excluído dividido por categoria na cascata + drill-down filtrado por categoria na UI
   - `0fbc788c` (chore) — retrigger de build do preview Vercel

**Plan metadata:** (commit final de documentação, gerado a seguir)

_Nota: Task 3 é `checkpoint:human-verify`, não TDD — os 8 commits de fix nasceram das 4 rodadas de ajuste pedidas por Wesley durante a validação em preview, cada rodada com commit de migration/EF + commit de código consumidor._

## Files Created/Modified
- `src/pages/mercadolivre/MLDreCaixa.tsx` - Página `/dre-caixa` completa (badge, KPIs, cascata drill-down, evolução 12m, histórico, banner)
- `src/App.tsx` - Rota lazy `/dre-caixa` com RoleRoute + ErrorBoundary
- `src/config/roleAccess.ts` - `"/dre-caixa": OPERATIONAL`
- `src/components/layout/routeMeta.ts` - Título/subtítulo do header
- `src/components/layout/ApiSidebar.tsx` / `ApiMobileSidebar.tsx` - Item de menu "DRE Caixa" (paridade desktop/mobile)
- `src/lib/dreCashCascade.ts` - Bloco "excluido" passa a expor categorias para drill-down (fix do checkpoint)
- `supabase/functions/sync-mp-releases/index.ts` - v6: grava `refund_date` no upsert de estornos
- `supabase/migrations/20260717010000_dre_cash_history_fornecedores.sql` - Fornecedores somam como saída no histórico
- `supabase/migrations/20260717020000_dre_cash_estorno_como_saida.sql` - Entrada cheia + estorno como linha de saída
- `supabase/migrations/20260717030000_cash_inflows_refund_date.sql` - Coluna `cash_inflows.refund_date`

## Decisions Made
- Fornecedores (bloco excluído da cascata) somam como saída no total do mês — travado com Wesley durante o checkpoint, documentado em `9dbdad1b`.
- Estorno pesa no mês em que o dinheiro efetivamente saiu do caixa (`refund_date`), não no mês da venda original que gerou o estorno — 90 estornos mudaram de mês no backfill (fev→jul, days_back=170, histórico completo).
- Bloco excluído exibido por categoria (Fornecedores / ADS ML / Envios Full) com drill-down filtrado, em vez de uma linha única sem detalhe — nenhum "número opaco" na tela.
- Diferença entre entradas líquidas do sistema (290.518,08) e o relatório bruto do app MP (299.198,69) é aceita como esperada (créditos não-ML fora do escopo desta DRE), não tratada como bug.

## Deviations from Plan

### Auto-fixed Issues (nascidas do checkpoint humano, Task 3)

**1. [Rule 2 - Missing Critical] Fornecedores (bloco excluído) não entravam no total de saídas**
- **Found during:** Task 3 (reconciliação junho × planilha manual)
- **Issue:** A cascata original excluía o bloco "Fornecedores" do somatório de saídas, subestimando o total pago no mês e quebrando a reconciliação com a planilha do Wesley.
- **Fix:** Fornecedores passam a somar como saída tanto no histórico (`get_dre_cash_history`) quanto na cascata do mês corrente.
- **Files modified:** migration `20260717010000_dre_cash_history_fornecedores.sql`, código consumidor da cascata
- **Verification:** Reconciliação junho recalculada, delta reduzido significativamente
- **Committed in:** `ee99c1ba`, `61280d1e`, `9dbdad1b` (docs da decisão)

**2. [Rule 1 - Bug] Estorno não aparecia como saída de caixa**
- **Found during:** Task 3, mesma reconciliação
- **Issue:** RPCs registravam a entrada líquida (já descontado o estorno), mascarando o movimento de saída real do estorno — impedindo auditar o "dos quais devoluções" corretamente.
- **Fix:** Entrada cheia (bruta) + estorno como linha de saída explícita, nas RPCs e na cascata.
- **Files modified:** RPCs `get_dre_cash`/`get_dre_cash_history` (migration `20260717020000`), `dreCashCascade.ts`
- **Verification:** Reconciliação junho recalculada, fecha a ~R$1 de diferença
- **Committed in:** `0f1abf7d`, `14742f72`, `172824b3` (docs)

**3. [Rule 1 - Bug] Estorno contabilizado no mês da venda original, não no mês em que o dinheiro saiu**
- **Found during:** Task 3, mesma reconciliação
- **Issue:** Sem uma data própria de estorno, o cálculo usava a data da venda original — distorcendo o resultado de caixa dos meses em que a venda ocorreu vs. o mês em que a devolução de fato impactou o saldo.
- **Fix:** Nova coluna `cash_inflows.refund_date`; EF `sync-mp-releases` v6 passa a gravá-la no upsert; backfill `days_back=170` reprocessou o histórico completo (fev→jul) — 90 estornos mudaram de mês.
- **Files modified:** migration `20260717030000_cash_inflows_refund_date.sql`, `supabase/functions/sync-mp-releases/index.ts`
- **Verification:** Backfill confirmado (90 registros remapeados), reconciliação junho e maio validadas
- **Committed in:** `fa17c1d4`, `a9d8d75d`

**4. [Rule 2 - Missing Critical] Bloco excluído exibido como linha única sem detalhe**
- **Found during:** Task 3, revisão visual do Wesley
- **Issue:** O bloco "excluido" da cascata (Fornecedores/ADS ML/Envios Full) aparecia como um total agregado sem permitir auditar de onde vinha cada valor — contrariando o princípio "nada de número opaco" do plano.
- **Fix:** Cascata passa a expor categorias dentro do bloco excluído; UI ganha drill-down filtrado por categoria, igual aos demais blocos.
- **Files modified:** `src/lib/dreCashCascade.ts`, `src/pages/mercadolivre/MLDreCaixa.tsx`
- **Verification:** Drill-down testado clicando em cada categoria do bloco excluído em preview
- **Committed in:** `9274bf1d`, `354d44e8`

---

**Total deviations:** 4 auto-fixed (2 Rule 1 - bugs de reconciliação, 2 Rule 2 - completude/auditabilidade), todas nascidas do checkpoint humano `Task 3` como ajustes pedidos por Wesley durante a validação, não como desvios silenciosos do executor.
**Impact on plan:** Todos os 4 fixes eram necessários para os gates #4 (reconciliação) e #5 (ok visual) do spec da phase — sem eles a reconciliação não fechava e o bloco excluído violava o princípio de "nada de número opaco". Sem scope creep: nenhuma funcionalidade fora do escopo da DRE Caixa foi adicionada.

## Issues Encountered
None além dos 4 ajustes documentados acima — todos resolvidos dentro do próprio checkpoint, sem reabrir Task 1/2 como plano separado.

## User Setup Required
None - nenhuma configuração de serviço externo necessária. Migrations e EF já aplicadas em produção (`ckcdevcxgvueywivefgx`) durante o checkpoint.

## Pendências registradas FORA da phase (não bloqueiam o fechamento)
- Wesley precisa excluir parcelas recorrentes fantasma no Tiny (ago/2026→jun/2027, ~17k/mês pendente lançados incorretamente).
- Janeiro/fevereiro sem dados de ads/full (o Mercado Livre apagou o histórico desse período — sem fonte para backfill).
- 3 contas ainda na fila de enriquecimento de categoria (não afeta Pé Vermeio/Thales, as contas validadas nesta reconciliação).

## Next Phase Readiness
- Gates #4 e #5 do spec da phase 99 (`docs/superpowers/specs/2026-07-16-dre-caixa-design.md`) aprovados por Wesley — phase 99 pode ser fechada.
- Página `/dre-caixa` em produção, sem acoplamento com Fluxo de Caixa ou DRE de faturamento (confirmado por grep + `git diff --name-only`).
- Próxima frente candidata (ROADMAP): Phase 100 — extensão do gate de fechamento (`canApurarInss`) para bloquear com INSS ausente, pendência registrada desde a Phase 98.

---
*Phase: 99-dre-caixa-apura-o-por-recebimento-mercado-pago-p-gina-dedica*
*Completed: 2026-07-17*

## Self-Check: PASSED

`src/pages/mercadolivre/MLDreCaixa.tsx` presente no disco. Todos os commits de Task 1/2/3 (6c1e829d, 48411d0b, ee99c1ba, 61280d1e, 9dbdad1b, 0f1abf7d, 14742f72, 172824b3, fa17c1d4, a9d8d75d, 9274bf1d, 354d44e8, 0fbc788c) verificados presentes em `git log`. Suíte 626/626 testes verdes confirmada por execução direta (`npx vitest run`) nesta sessão.
