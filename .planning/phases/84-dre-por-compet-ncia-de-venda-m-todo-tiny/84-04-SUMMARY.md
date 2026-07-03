# 84-04 SUMMARY — GATE de aplicação do schema (orquestrador via MCP)

**Status:** COMPLETE
**Executado por:** orquestrador (Nexo) via Supabase MCP `apply_migration` — checkpoint aprovado por Wesley (2026-07-03).
**Projeto:** `ckcdevcxgvueywivefgx` (prod).

## O que foi feito
Aplicada a migration `20260685000000_ml_billing_daily_competence_date.sql` (autorada em 84-01) em produção via `apply_migration` (name: `ml_billing_daily_competence_date`).

## Verificação pós-apply (prod)
Query de verificação retornou:
- `tem_coluna = 1` — `competence_date DATE` criada.
- `nulls = 0` — backfill `competence_date = charge_date` cobriu todas as 1.909 linhas na mesma migration.
- `divergentes_pos_backfill = 0` — todo `competence_date` == `charge_date` no estado inicial (esperado; só diverge após o re-sync do 84-05 trazer `sale_date_time`).
- `unique_now = ml_billing_daily_uniq` — UNIQUE alargada aplicada; nome antigo auto-gerado (`..._charge_date_cha_key`) removido pelo DO-block dinâmico. `organization_id`+`ml_user_id` seguem como colunas líderes (anti-IDOR estrutural preservado).
- `tem_indice = 1` — `idx_ml_billing_daily_competence` criado.
- `linhas = 1909` — nenhuma linha perdida.

## Observações
- Estado da constraint viva ANTES: `ml_billing_daily_organization_id_ml_user_id_charge_date_cha_key` (truncada, 1 única UNIQUE) — o DO-block a localizou e substituiu corretamente.
- Mudança 100% aditiva; nenhum número visível na DRE muda ainda (o frontend só filtra por `competence_date` quando for pro ar, gated no 84-06; a EF só grava `competence_date` real após deploy no 84-05).
- `ml_billing_monthly` e RLS intactos.

## Próximo
84-05: deploy da EF `sync-ml-billing` + backfill 2026 sequencial + smoke (reconciliação junho ao centavo, anti-IDOR, prova cross-month) — checkpoint BLOCKING, exige novo aval de Wesley (toca números da DRE).
