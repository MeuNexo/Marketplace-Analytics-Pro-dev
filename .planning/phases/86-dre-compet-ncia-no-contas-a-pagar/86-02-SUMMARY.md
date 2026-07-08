# 86-02 SUMMARY — Backfill competence_date (2026) + prova de não-regressão

**Executado:** 2026-07-08
**Status:** ✅ Complete (critérios batidos em prod `ckcdevcxgvueywivefgx`)

## Achado-chave

Ao aplicar a migration do 86-01 via MCP, descobriu-se que **o schema + as 3 funções já estavam em prod via drift** (aplicadas em sessão anterior direto no banco), e **os crons de enriquecimento (`treasury_cat_enqueue` */30, `treasury_cat_tick` 15s → `enrich_payable_step(6)`) já vinham backfillando `competence_date`**. Portanto o backfill do 86-02 já estava efetivamente concluído.

A migration do 86-01 (idempotente: `IF NOT EXISTS` / `CREATE OR REPLACE`) foi aplicada via `apply_migration` para **codificar o drift numa migration rastreada** (`supabase_migrations`) — alinhado à regra do projeto de não deixar drift solto. `enrich_enqueue_new` em prod era byte-idêntica à da migration; `enrich_payable_step`/`enrich_harvest` já gravavam `competence_date`.

## Critérios de sucesso (verificados por SQL em prod)

- **SC-3 (≥90% backfill 2026):** 575/630 linhas 2026 tiny-sourced com `competence_date` = **91,3%** ✅
- **SC-4 (zero regressão DFC/Phase 60):** `get_cashflow` NÃO referencia `competence_date`; `outflow_date` + seu índice intactos ✅
- **Single-writer preservado:** `enrich_*` grava `competence_date` na MESMA UPDATE de `category`/`supplier` ✅
- **Segurança:** advisors sem regressão nova; as 3 funções NÃO executáveis por anon/authenticated (REVOKEs ativos, 0 grants indevidos) ✅
- **`competence_date` = primeiro dia do mês** (`to_date(dataCompetencia || '-01')`, nunca `::date` direto) ✅

## Observação p/ Phase 87

- 55 linhas 2026 tiny sem `competence_date` (~8,7%) — `dataCompetencia` ausente no Tiny para lançamentos antigos; dentro da tolerância (86-CONTEXT aceita NULL residual). A RPC da DRE (Phase 87) deve tratar `competence_date IS NULL` (excluir ou classificar) sem quebrar.
- Cron mapping em prod: `treasury_cat_enqueue` (*/30 → `enrich_enqueue_new()`), `treasury_cat_tick` (15s → `enrich_payable_step(6)`). `enrich_harvest` sem cron (atualizada por consistência).

## Artefatos
- `supabase/migrations/20260686000000_cash_outflows_competence_date.sql` (86-01, aplicada+rastreada)
