---
phase: 67-compras-v3-reposi-o-mais-esperta-tend-ncia-lead-time-real
plan: 03
subsystem: ui
tags: [react, typescript, tanstack-query, shadcn-ui, supabase-rpc, replenishment]

# Dependency graph
requires:
  - phase: 67-compras-v3-reposi-o-mais-esperta-tend-ncia-lead-time-real
    provides: "Plan 67-01 (RPC get_replenishment_by_sku v7 com p_smart + 5 colunas de transparência) e Plan 67-02 (utils espertos: EWMA/sazonal/lead-time real)"
provides:
  - "Hook useReplenishmentBySku com 3o param smartMode, queryKey atualizada e p_smart explícito na chamada RPC"
  - "Interface ReplenishmentSkuRow estendida com 5 campos: venda_dia_origem, lead_time_origem, tendencia, fator_sazonal, lead_time_real"
  - "Toggle Cálculo esperto (ON por padrão) no header da /compras, controlando p_smart"
  - "Badges de transparência no ParamsTooltip por SKU: origem da velocidade (EWMA+saz/EWMA/Simples), tendência (↑↓~), fator sazonal, lead time real vs param, marcador modo simples"
affects: [phase-68, phase-69, compras, reposicao, ux-leigos]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Toggle boolean em useState(true) propagado explicitamente para hook RPC (espelha MLFluxoCaixa.tsx)"
    - "Badges de transparência no ParamsTooltip sem poluir colunas da tabela principal"
    - "p_smart nunca undefined — sempre passado explicitamente para evitar regressão ao default SQL"

key-files:
  created: []
  modified:
    - src/hooks/useReplenishmentBySku.ts
    - src/pages/mercadolivre/MLCompras.tsx
    - src/components/mercadolivre/ReplenishmentSkuTable.tsx

key-decisions:
  - "p_smart sempre passado explicitamente (nunca undefined) — mitiga T-67-06 (Tampering via undefined)"
  - "Toggle ON por padrão: a experiência padrão é o modo esperto; simples é comparativo/auditoria"
  - "Badges no ParamsTooltip (não em colunas novas): mantém a tabela compacta e não quebra layout"
  - "5 campos mapeados com fallback seguro no mapRow: origens com defaults simples/param, tendencia com estavel, numericos null-safe"

patterns-established:
  - "Pattern toggle RPC: useState(true) + passagem explícita como 3o arg do hook (padrão MLFluxoCaixa)"
  - "Pattern transparência: dados extras da RPC expostos via tooltip/badge, não em colunas adicionais"

requirements-completed: [SMART-03, SMART-04]

# Metrics
duration: 45min
completed: 2026-06-26
status: complete
---

# Phase 67 Plan 03: Toggle Cálculo esperto + Badges de transparência na /compras

**Toggle Cálculo esperto (ON por padrão) ligado à RPC via p_smart explícito + badges EWMA/sazonal/lead-time por SKU no ParamsTooltip, cobrindo SMART-03 e SMART-04 sem regressão**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-06-26
- **Completed:** 2026-06-26
- **Tasks:** 2 auto concluídas / 1 visual pendente (ok Wesley pós-PR)
- **Files modified:** 3

## Accomplishments

- Hook `useReplenishmentBySku` ganhou 3o parâmetro `smartMode` (default `true`), incluído na `queryKey` e enviado como `p_smart: smartMode` EXPLICITAMENTE na chamada `supabase.rpc` — nunca `undefined`
- Interface `ReplenishmentSkuRow` e `mapRow` estendidos com 5 campos de transparência: `venda_dia_origem` (`'ewma_sazonal' | 'ewma' | 'simples'`), `lead_time_origem` (`'real' | 'param'`), `tendencia` (`'alta' | 'baixa' | 'estavel'`), `fator_sazonal` (`number | null`), `lead_time_real` (`number | null`)
- Toggle "Cálculo esperto" visível no header sticky de `/compras` (ON por padrão), espelhando o padrão aprovado do `MLFluxoCaixa.tsx`; ao desligar, reconsulta a RPC com `p_smart=false` e retorna ao cálculo simples — comparação direta sem reload de página
- Badges no `ParamsTooltip` por SKU: seta de tendência colorida (verde/vermelho/cinza), rótulo da origem da velocidade, fator sazonal quando aplicado, lead time real vs param, marcador discreto "modo simples" quando `venda_dia_origem='simples'`
- tsc `--noEmit` limpo, 246 testes vitest verdes, `npm run build` limpo — zero regressão das Phases 62–66

## Task Commits

1. **Task 1: Hook smartMode + 5 campos novos na interface e mapRow** — `4a783fcb` (feat)
2. **Task 2: Toggle Cálculo esperto na página + badges de transparência na tabela** — `e3cffb0d` (feat)
3. **Task 3: Checkpoint visual do Wesley em preview (/compras)** — pendência conhecida (ok visual pós-PR, padrão Phases 62/63/65/66)

## Files Created/Modified

- `src/hooks/useReplenishmentBySku.ts` — 3o param `smartMode`, `queryKey` atualizada, `p_smart` explícito, interface + `mapRow` com 5 campos
- `src/pages/mercadolivre/MLCompras.tsx` — `useState(true)` para `smartMode`, toggle Switch + Label no header sticky, propagação ao hook
- `src/components/mercadolivre/ReplenishmentSkuTable.tsx` — `ParamsTooltip` com badges de transparência (tendência, origem, sazonal, lead time, modo simples)

## Decisions Made

- **p_smart sempre explícito:** a RPC tem `COALESCE(p_smart, TRUE)` como segurança, mas o hook nunca envia `undefined` — mitiga o Pitfall 1 / T-67-06 documentado no 67-RESEARCH.md
- **Toggle ON por padrão:** a experiência primária é o modo esperto; simples é para comparação/auditoria, não para uso diário
- **Badges no tooltip, não em colunas:** mantém a tabela compacta para UX leigos e não exige quebra de layout responsivo

## Deviations from Plan

None - plano executado exatamente como especificado. Tasks 1 e 2 concluídas com tsc/build/vitest verdes. Task 3 é checkpoint visual (não código), documentada como pendência conhecida abaixo.

## Known Pending Items

**Task 3 — Ok visual do Wesley em preview (padrão Phases 62/63/65/66):**
- O checkpoint visual da `/compras` com o toggle e os badges é pendência do Wesley pós-PR
- Branch: `gsd/phase-67-calculo-esperto` — preview Vercel apontando para Supabase prod `ckcdevcxgvueywivefgx`
- O que validar: toggle aparece no header e inicia LIGADO; badges por SKU mostram tendência/origem/sazonal/lead time; desligar retorna ao simples; ligar restaura o esperto
- Não é falha de execução — mesmo padrão de validação adotado nas Phases 62, 63, 65 e 66

## Issues Encountered

None - tsc, vitest e build passaram na primeira execução em ambas as tasks.

## User Setup Required

None - sem novas dependências externas. Switch e Badge já estavam instalados (shadcn/ui).

## Next Phase Readiness

- SMART-03 (sinal modo simples) e SMART-04 (toggle + badges) estão cobertos e commitados
- Restam SMART-01 (EWMA) e SMART-02 (sazonal/lead-time) implementados em 67-02; integração RPC em 67-01 — a cadeia Phase 67 está completa no lado código
- Próximo passo: ok visual do Wesley + merge do PR `gsd/phase-67-calculo-esperto`
- Após merge: Phase 68 (override de fornecedor) pode prosseguir sem bloqueadores de código

---
*Phase: 67-compras-v3-reposi-o-mais-esperta-tend-ncia-lead-time-real*
*Completed: 2026-06-26*
