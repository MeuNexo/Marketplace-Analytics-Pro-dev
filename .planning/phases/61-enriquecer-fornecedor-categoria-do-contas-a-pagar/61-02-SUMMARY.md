# 61-02 — SUMMARY (Go-live + A1 + Backfill)

**Plano:** 61-02 · **Wave:** 2 · **Status:** Tasks 1-2 ✅ concluídas; Task 3 🟡 drenando (server-side)
**Data:** 2026-06-25 · **Projeto:** ckcdevcxgvueywivefgx

## Task 1 — Deploy EF + apply migration (✅)
- Migration `enrich_supplier_category` aplicada via MCP `apply_migration`. Antes de aplicar, **conferido por md5/diff** que os 3 corpos em prod (`enrich_enqueue_new`, `enrich_payable_step`, `enrich_harvest`) eram supersets byte-a-byte das versões da migration — sem drift escondido.
- EF `sync-tiny-payables` deployada via MCP `deploy_edge_function` → **version 6**, `verify_jwt=false` (preservado; guard interno `requireServiceRole`). Conteúdo validado byte-idêntico ao `supabase/functions/sync-tiny-payables/index.ts` commitado (61-01).

## Task 2 — Prova do risco A1 (✅ — caminho: OMISSÃO DE CHAVE)
Teste empírico via `execute_sql` + sync real da EF deployada:
1. Sentinela gravada em `tiny_payable_id=909692874`: `category='A1_TEST_CAT'`, `supplier='A1_TEST_SUP'`.
2. Disparado sync real (`?debug=1`, `totalSynced=1991`, `errors=0`) → re-upsertou a linha via `ON CONFLICT DO UPDATE` (`synced_at` avançou para 19:06:22).
3. Releitura: **category e supplier mantiveram os valores-sentinela**.

**Conclusão:** omitir a chave no objeto do `.upsert()` (supabase-js) faz o PostgREST **excluir a coluna do `SET`** do `ON CONFLICT DO UPDATE` → valor existente preservado. **A1 CONFIRMADO. Não foi necessário o trigger de fallback.** (CASHFIX-07 provado em prod.)
Sentinela limpada ao fim (volta a ser re-enriquecida pelo backfill).

## Task 3 — Seed + drain (🟡 em progresso, server-side)
- Seed: `enrich_enqueue_new()` — a fila já estava populada pelo cron `treasury_cat_enqueue`; 1901 linhas null enfileiradas como `todo`.
- Drain: cron `treasury_cat_tick` (a cada 15s) **acelerado de `enrich_payable_step(4)` → `(10)`** = ~40/min (abaixo do rate limit Tiny ~100/min). Inócuo após drenar (fila vazia → tick não dispara nada).
- **Prova de que o supplier real é gravado** (não só category): já aparecem `Fornecedores`/ZEBU, `Impostos, taxas`/Receita Federal, `Salários`/Wesley Santos, `ADS Mercado Livre`/Mercado livre, `Empréstimo`/Bradesco, `Prestação Mercado Envios Full`/Mercado livre, etc.
- Progresso: 20 → 149 → 163 `ambos_ok` (category E supplier não-nulos), **0 errors** na fila.
- **GATE pendente:** pct ≥ 90% (≈1810/2011). ETA ~40-60min dependendo da latência Tiny. Resumível e server-side.

## Pendências
- Confirmar pct ≥ 90% (Task 3) → então rodar Wave 3 (61-03: estabilidade pós-sync + gráficos em prod + não-regressão Phase 60).
- (Opcional) restaurar `treasury_cat_tick` para batch 4 após o drain.
