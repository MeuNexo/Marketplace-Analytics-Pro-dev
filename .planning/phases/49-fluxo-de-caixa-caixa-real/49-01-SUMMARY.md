---
phase: 49-fluxo-de-caixa-caixa-real
plan: "01"
subsystem: backend-caixa
tags: [cash-flow, mercado-pago, migrations, edge-functions, pg-cron, rls, multi-tenant]
dependency_graph:
  requires: []
  provides:
    - public.financial_settings
    - public.cash_inflows
    - public.cash_outflows
    - supabase/functions/sync-mp-releases
    - cron.sync-mp-releases-daily
  affects:
    - plan 49-02 (RPC get_cashflow consome cash_inflows + cash_outflows)
    - plan 49-03 (hooks React consomem RPCs)
    - plan 49-04 (página /fluxo-de-caixa consome hooks)
    - plan 49-05 (EF sync-tiny-payables grava em cash_outflows já criada aqui)
tech_stack:
  added: []
  patterns:
    - pg_cron Pattern B (vault.decrypted_secrets)
    - RLS org-first is_org_member(auth.uid(), organization_id)
    - EF requireServiceRole (service role only)
    - Upsert idempotente onConflict
key_files:
  created:
    - supabase/migrations/20260618100000_cash_flow_tables.sql
    - supabase/functions/sync-mp-releases/index.ts
    - supabase/migrations/20260618110000_cash_flow_cron.sql
  modified:
    - supabase/config.toml
decisions:
  - "cash_outflows com schema Tiny na migration desta fase (compartilhada por 49-01 e 49-05)"
  - "Dois modos de janela MP: histórica 30d (released) + futura 45d (projeção)"
  - "release_date e outflow_date como DATE, não timestamptz (cálculo de caixa por dia)"
  - "verify_jwt=false no sync-mp-releases (guard interno via requireServiceRole)"
metrics:
  duration: "~45 minutos"
  completed_date: "2026-06-18"
  tasks_completed: 3
  tasks_total: 4
  files_created: 3
  files_modified: 1
---

# Phase 49 Plan 01: Backend de Ingestão de Caixa Real — Tabelas + EF MP + pg_cron

## Uma Linha

DDL de 3 tabelas de caixa (financial_settings/cash_inflows/cash_outflows com schema Tiny) + EF sync-mp-releases que ingere liberações reais do Mercado Pago em dois modos de janela + pg_cron Pattern B diário às 07:00 UTC.

## Resumo

Esta fase constrói o backend de ingestão de entradas de caixa real da plataforma garment.
Antes deste plano, o projeto não tinha nenhuma tabela financeira de caixa.

As 3 tabelas criadas são escopadas por `organization_id` com RLS org-first e fornecem a base
de dados para os RPCs (49-02) e a página de fluxo de caixa (49-04). A tabela `cash_outflows`
foi criada já com o schema Tiny completo (conforme decisão de Wesley em 2026-06-18) para que
a EF `sync-tiny-payables` do plano 49-05 possa gravar nela imediatamente após deploy, sem
necessitar de nova migration de tabela.

## Tasks Executadas

| # | Nome | Status | Commit |
|---|------|--------|--------|
| 1 | Migration 3 tabelas + RLS org-first | Completo | f91110c4 |
| 2 | EF sync-mp-releases + config.toml | Completo | 2f2d4d89 |
| 3 | Migration pg_cron Pattern B | Completo | b92a76b7 |
| 4 | [BLOCKING] Apply/deploy/smoke em produção | **PENDENTE** | — |

## Arquivos Criados/Modificados

| Arquivo | Ação | Conteúdo |
|---------|------|----------|
| `supabase/migrations/20260618100000_cash_flow_tables.sql` | criado | DDL financial_settings + cash_inflows + cash_outflows + RLS + índices |
| `supabase/functions/sync-mp-releases/index.ts` | criado | EF ingestão liberações MP (dois modos + upsert idempotente) |
| `supabase/migrations/20260618110000_cash_flow_cron.sql` | criado | pg_cron Pattern B 07:00 UTC |
| `supabase/config.toml` | modificado | [functions.sync-mp-releases] verify_jwt=false |

## Detalhes por Artefato

### financial_settings (CASH-06)

- 1 linha por org, `UNIQUE (organization_id)`
- Defaults: `initial_balance=0`, `operational_cost_rate=0.22`, `safety_margin=10000`
- RLS: SELECT = membro org; ALL = owner somente (`get_org_role = 'owner'`)

### cash_inflows (CASH-01)

- `release_date DATE` (não timestamptz — Armadilha 3 do RESEARCH)
- `UNIQUE (organization_id, payment_id)` — upsert idempotente da EF
- Índice: `(organization_id, release_date)` para queries de período
- RLS: SELECT = membro org; escrita = service role only

### cash_outflows (CASH-02 com schema Tiny)

- `outflow_date DATE` (renomeado de due_date — decisão Wesley 2026-06-18)
- Colunas Tiny: `supplier`, `source`, `tiny_payable_id`, `document_number`, `synced_at`
- `UNIQUE (organization_id, tiny_payable_id)` — aceita múltiplos NULLs (source='manual')
- CHECKs: `status IN ('pending','paid')`, `source IN ('manual','tiny')`
- Índice: `(organization_id, outflow_date)` para queries de período
- RLS: SELECT = membro org; escrita = service role only (EF sync-tiny-payables do 49-05)

### EF sync-mp-releases

- **Dois modos de janela:** histórica 30d (captura `released`) + futura 45d (projeção)
- **Token MP:** mesmo `access_token` de `ml_tokens` — OAuth ML serve para ML+MP
- **Retry 429:** backoff via `retry-after` header
- **Retry 401:** refresh de token via `getAccessToken()` + 1 re-tentativa
- **Paginação:** offset/total até `results.length < 100 || offset >= paging.total`
- **Detalhe por payment:** GET `/v1/payments/{id}` para `net_received_amount`
- **Estornos:** `status=refunded` → `net_amount = -abs(net_received_amount)`
- **Validação Zod:** schema `MpPaymentSchema` por payment
- **Smoke log:** status HTTP + total de resultados na 1ª chamada por org/janela (A1)
- **Upsert:** `cash_inflows` onConflict `organization_id,payment_id`

### pg_cron Pattern B

- Job: `sync-mp-releases-daily` às `0 7 * * *` (07:00 UTC = 04:00 BRT)
- Horário escolhido: ANTES do relatório das 07:03 UTC, dados frescos disponíveis
- Authorization via `vault.decrypted_secrets WHERE name = 'service_role_key'`
- Pré-requisito: vault deve ter `service_role_key = sb_secret_*` (não JWT legado)

## Desvios do Plano

Nenhum — plano executado exatamente como escrito. As 3 tasks de escrita de arquivos foram
concluídas seguindo os analogs canônicos (consultor_tables.sql, pg_cron_consultor.sql,
sync-ads/index.ts) e as restrições do RESEARCH.md.

## Checkpoint Pendente (Task 4)

A Task 4 é um checkpoint `blocking-human` que exige execução pelo orquestrador com Supabase
MCP, após aprovação do Wesley. Nenhuma escrita em produção foi realizada.

**O que o orquestrador deve executar em produção (ckcdevcxgvueywivefgx):**

1. Confirmar project ID real via `list_projects` → deve retornar `ckcdevcxgvueywivefgx`

2. PRÉ-REQUISITO vault:
   ```sql
   SELECT name FROM vault.secrets WHERE name = 'service_role_key';
   ```
   Se vazio, Wesley insere o `sb_secret_*` ANTES de aplicar a migration de cron.

3. Aplicar `20260618100000_cash_flow_tables.sql` via MCP `apply_migration`
   (cria as 3 tabelas, incl. `cash_outflows` com schema Tiny que o 49-05 alimenta)

4. Deploy da EF `sync-mp-releases` (supabase functions deploy sync-mp-releases)

5. SMOKE da EF: invocar a EF e verificar no log:
   - Status HTTP da 1ª chamada MP (deve ser 200; se 401 = escopo OAuth ausente)
   - `SELECT COUNT(*) FROM cash_inflows;` > 0 para a org Pé Vermeio

6. Aplicar `20260618110000_cash_flow_cron.sql` via MCP (somente após vault confirmado)

7. `get_advisors` (security) — confirmar RLS habilitado nas 3 tabelas novas

## Conhecidos Stubs

Nenhum — este plano é exclusivamente backend (migrations + EF). Nenhum componente de UI
foi criado neste plano.

## Threat Flags

Nenhum — todas as superfícies de segurança estavam no `<threat_model>` do plano:
- T-49-01-01: RLS org-first nas 3 tabelas (mitigado)
- T-49-01-02: Escrita de financial_settings restrita a owner (mitigado)
- T-49-01-03: requireServiceRole na EF (mitigado)
- T-49-01-04: Pattern B vault para cron (mitigado)
- T-49-01-05: Escopo OAuth MP assumido, smoke valida (accept + smoke gate)

## Self-Check: PASSED

| Item | Status |
|------|--------|
| `supabase/migrations/20260618100000_cash_flow_tables.sql` | FOUND |
| `supabase/functions/sync-mp-releases/index.ts` | FOUND |
| `supabase/migrations/20260618110000_cash_flow_cron.sql` | FOUND |
| Commit f91110c4 (migration tabelas) | FOUND |
| Commit 2f2d4d89 (EF + config.toml) | FOUND |
| Commit b92a76b7 (migration cron) | FOUND |
