# 86-01 SUMMARY — Migration competence_date (aplicada em prod)

**Status:** ✅ COMPLETE — migration aplicada e verificada em produção (ckcdevcxgvueywivefgx), 2026-07-06.

## O que foi feito
- Arquivo `supabase/migrations/20260686000000_cash_outflows_competence_date.sql` (188 linhas).
- Aplicado via MCP `apply_migration` (name: cash_outflows_competence_date) → `{success:true}`.

## Desvio do plano (documentado)
O plano mandava transcrever os corpos das 3 funções do arquivo do repo (Phase 61, `20260661000000`). Em vez disso, o **orquestrador** puxou os corpos REAIS de produção via `pg_get_functiondef` e transcreveu a partir deles (drift-safe) — o executor não tem acesso ao MCP Supabase e usaria o repo, que poderia divergir da prod. Resultado idêntico ao pretendido, com garantia de não reverter drift.

## Verificação pós-apply (todas ✓)
- `competence_date` existe, tipo `date`.
- Índice `cash_outflows_org_competence_category_idx (organization_id, competence_date, category)` criado; índice de `outflow_date` (DFC) intacto (1).
- As 3 funções (`enrich_enqueue_new`/`enrich_harvest`/`enrich_payable_step`) contêm competência.
- `anon`/`authenticated` **sem** EXECUTE nas 3 (REVOKEs efetivos; não aparecem no advisor de exec-por-anon).
- Advisors de segurança: só issues pré-existentes; **nenhum novo** atribuível a esta migration.
- Invariante: competências gravadas caem no dia 1 (spot-check: 2024-08-01, 2025-05-01…).

## Baseline (hand-off p/ 86-02)
- `n2026_tiny` = **622** (linhas 2026 com tiny_payable_id) → meta ≥90% = ≥560.
- Cron: `treasury_cat_enqueue` (*/30) → `enrich_enqueue_new()`; `treasury_cat_tick` (15s) → `enrich_payable_step(6)`.

## SC
- SC-1 (coluna + funções gravam): ✅ estrutural + provado (3+ linhas já preenchidas em prod).
- SC-2 (single-writer/não sobrescreve): ✅ mesmo padrão da Phase 61 (sync-tiny-payables não escreve category/supplier/competence).
- SC-5 (índice aditivo): ✅.
