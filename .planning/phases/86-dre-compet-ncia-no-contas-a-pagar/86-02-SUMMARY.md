# 86-02 SUMMARY — Backfill de competence_date (2026) + não-regressão

**Status:** ✅ COMPLETE — 2026-07-06. **Phase 86 FECHADA.**

## Backfill
- `enrich_enqueue_new()` enfileirou 2050 linhas (Pé Vermeio); cron `treasury_cat_tick` (15s/batch6) drenou via detalhe `/contas-pagar/{id}`.
- Tiny throttlou (~⅓ 429, retry automático, 0 perda). Prioridade dada às linhas de 2026 (bump `updated_at` na fila) em 3 levas p/ acelerar.
- **Cobertura final 2026: 91,2%** (567/622) — meta ≥90% ✅. Irrecuperáveis: 6 (2 sem `dataCompetencia` no Tiny + 4 que esgotaram retry).
- Invariante: competências gravadas caem no dia 1 (primeiro-do-mês).

## Não-regressão (SC-4 / DFC Phase 60)
- `get_cashflow` não referencia competência (intocada); 0 linhas perderam `outflow_date`.
- `sync-tiny-payables` não sobrescreve competence_date (mesmo padrão single-writer da Phase 61).

## SC
- SC-1/SC-2/SC-3/SC-5 ✅ (86-01). SC (backfill ≥90%) ✅ (91,2%). Não-regressão ✅.
