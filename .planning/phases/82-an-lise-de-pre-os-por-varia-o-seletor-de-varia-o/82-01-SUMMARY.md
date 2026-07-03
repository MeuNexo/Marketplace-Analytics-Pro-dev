---
phase: 82-an-lise-de-pre-os-por-varia-o-seletor-de-varia-o
plan: 01
subsystem: database
tags: [postgresql, rpc, supabase, sql, orders, security-invoker]

# Dependency graph
requires:
  - phase: 79-an-lise-de-pre-os-com-mco
    provides: "RPC orders_price_timeseries com componentes de custo firmes por bucket (cmv, comissao, frete, impostos), SECURITY INVOKER, sem subquery correlacionada"
provides:
  - "Migration DROP+CREATE de orders_price_timeseries com 6º parâmetro opcional _sku text DEFAULT NULL"
  - "Predicado AND (_sku IS NULL OR o.sku = _sku) para filtrar a série por variação"
  - "Comportamento do pai (_sku nulo) preservado byte-a-byte"
affects: [82-02-apply-migration, 82-03-ui-variation-selector]

# Tech tracking
tech-stack:
  added: []
  patterns: ["RPC opcional por SKU (não variation_id) para filtrar séries de vendas por variação"]

key-files:
  created: [supabase/migrations/20260682000000_orders_price_timeseries_sku.sql]
  modified: []

key-decisions:
  - "Join por SKU (o.sku = _sku), NUNCA variation_id — validação manual mostrou variation_id casou 0/43 vendas reais vs sku 43/43"
  - "DROP FUNCTION explícito da assinatura antiga (5 args) antes do CREATE — CREATE OR REPLACE criaria sobrecarga ambígua ao acrescentar parâmetro, quebrando chamadas posicionais de 5 args existentes"
  - "_sku adicionado como ÚLTIMO parâmetro com DEFAULT NULL para preservar compatibilidade posicional com todos os chamadores atuais (Phase 79/81)"
  - "Sem GRANT extra, sem parâmetro de organização: SECURITY INVOKER + RLS de orders já isola por org; _sku só filtra dentro do escopo já visível"

patterns-established:
  - "Filtro opcional por SKU em RPCs de série temporal: parâmetro DEFAULT NULL no fim + predicado neutro (_x IS NULL OR col = _x) preserva comportamento default"

requirements-completed: ["APV-RPC-SKU"]

# Metrics
duration: ~15min
completed: 2026-07-03
status: complete
---

# Phase 82 Plan 01: RPC orders_price_timeseries com filtro opcional por SKU Summary

**Migration DROP+CREATE que adiciona `_sku text DEFAULT NULL` (último parâmetro) e o predicado `o.sku = _sku` à RPC `orders_price_timeseries`, sem alterar nenhuma outra linha de lógica — pronta para o orquestrador aplicar em produção no plano 82-02.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-03T00:55:45Z
- **Tasks:** 1/1 completo
- **Files modified:** 1 (novo)

## Accomplishments
- Migration `20260682000000_orders_price_timeseries_sku.sql` criada com `_sku text DEFAULT NULL` como 6º e último parâmetro (preserva chamadas posicionais de 5 args existentes).
- Predicado `AND (_sku IS NULL OR o.sku = _sku)` adicionado ao WHERE — join por SKU (não `variation_id`), per lição crítica da validação manual da Phase 82.
- DROP FUNCTION explícito da assinatura antiga (5 args) antes do CREATE, evitando sobrecarga ambígua ("function is not unique").
- Diff contra `20260679000000_orders_price_timeseries_mco.sql` confirmado: apenas comentários de topo, o novo parâmetro, a nova linha de predicado e o comentário de smoke no rodapé mudaram. 13 colunas de retorno, GROUP BY 1 / ORDER BY 1, `SECURITY INVOKER`, `SET search_path TO 'public'` e todos os filtros existentes (status, `_ml_user_ids`, `_from`, `_to`) permanecem intactos.
- `npx tsc --noEmit` executado (a migration não afeta TypeScript, mas rodado para registrar que nada quebrou no front) — saída limpa, sem erros.

## Task Commits

Each task was committed atomically:

1. **Task 1: Escrever a migration orders_price_timeseries com _sku opcional** - `986e9f78` (feat)

**Plan metadata:** commit final desta plan (SUMMARY.md) — orquestrador decide se atualiza STATE.md/ROADMAP.md (fora do escopo deste plano, conforme instrução explícita).

## Files Created/Modified
- `supabase/migrations/20260682000000_orders_price_timeseries_sku.sql` - DROP+CREATE de `orders_price_timeseries` com `_sku text DEFAULT NULL` (último parâmetro) e predicado `AND (_sku IS NULL OR o.sku = _sku)`; apenas escrito, NÃO aplicado (aplicação/smoke = plano 82-02).

## Decisions Made
- Nenhuma decisão nova além das já LOCKED no CONTEXT.md (join por SKU, DROP+CREATE, `_sku` no fim, sem GRANT extra). Plano executado exatamente como especificado.

## Deviations from Plan

None - plan executado exatamente como especificado. A única ajuste foi de formatação: o parâmetro `_sku text DEFAULT NULL` foi escrito com espaçamento single-space (em vez de alinhado em coluna como os demais parâmetros) para satisfazer literalmente o grep de verificação automatizada do plano (`grep -q '_sku text DEFAULT NULL'`), sem qualquer impacto semântico no SQL. Não é um deviation de Rule 1-4 — é conformidade com o critério de verificação do próprio plano.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. A aplicação da migration em produção (via MCP `apply_migration` no projeto `ckcdevcxgvueywivefgx`) e o smoke test pós-deploy são responsabilidade do orquestrador no plano 82-02, conforme escopo explícito deste plano (gsd-executor não tem token de CLI/MCP do Supabase).

## Next Phase Readiness
- Arquivo de migration pronto para ser aplicado pelo orquestrador (plano 82-02) via MCP `apply_migration`.
- Após aplicação, o plano 82-03 (seletor de variação na UI) pode chamar `orders_price_timeseries(_item_id, _ml_user_ids, _from, _to, _granularity, _sku)` com o SKU da variação selecionada.
- Nenhum bloqueio identificado.

---
*Phase: 82-an-lise-de-pre-os-por-varia-o-seletor-de-varia-o*
*Completed: 2026-07-03*

## Self-Check: PASSED
- FOUND: supabase/migrations/20260682000000_orders_price_timeseries_sku.sql
- FOUND: .planning/phases/82-an-lise-de-pre-os-por-varia-o-seletor-de-varia-o/82-01-SUMMARY.md
- FOUND commit: 986e9f78
