---
phase: 49-fluxo-de-caixa-caixa-real
plan: "05"
subsystem: backend/edge-functions
tags: [cash-flow, tiny-erp, edge-function, pg-cron, multi-tenant]
dependency_graph:
  requires: ["49-01"]
  provides: ["cash_outflows.source='tiny'", "sync-tiny-payables-6h cron"]
  affects: ["cash_outflows", "get_cashflow RPC (Wave 2)"]
tech_stack:
  added: []
  patterns:
    - "getTinyToken(mlUserId) com refresh via tiny-oauth (herdado de sync-tiny-costs)"
    - "Pattern B: pg_cron → vault.decrypted_secrets → EF via Bearer service_role_key"
    - "UPSERT onConflict (organization_id, tiny_payable_id) ignoreDuplicates:false"
    - "Normalização situacao client-side: nunca enviar param à API Tiny v3"
key_files:
  created:
    - supabase/functions/sync-tiny-payables/index.ts
    - supabase/migrations/20260618115000_cash_outflows_tiny_cron.sql
  modified:
    - supabase/config.toml
decisions:
  - "outflow_date = dataPagamento (quando status='paid' e campo disponível) ou dataVencimento[:10] como fallback (A7 do RESEARCH)"
  - "requireServiceRole() guard: verify_jwt=false + Bearer check interno — mesmo padrão de consultor-insights e sync-mp-releases"
  - "Janela de busca: 90 dias atrás + 90 dias à frente para capturar histórico pago + contas futuras"
metrics:
  duration: "~20 min"
  completed: "2026-06-18"
  tasks_completed: 2
  tasks_total: 3
  files_created: 2
  files_modified: 1
---

# Phase 49 Plan 05: sync-tiny-payables (Saídas de Caixa via Tiny ERP) Summary

**One-liner:** EF Deno multi-tenant que ingere contas a pagar do Tiny ERP via `/contas-pagar` em `cash_outflows` (source='tiny'), idempotente por (organization_id, tiny_payable_id), com pg_cron Pattern B a cada 6h.

---

## O Que Foi Construído

### Task 1 — Edge Function sync-tiny-payables + config.toml (commit `c0a965d6`)

Criada a EF `supabase/functions/sync-tiny-payables/index.ts` que:

1. Guard `requireServiceRole()` — rejeita com 401 qualquer chamada sem o service_role_key
2. Busca todas as lojas com Tiny conectado: `SELECT ml_user_id, organization_id FROM ml_tokens WHERE tiny_access_token IS NOT NULL`
3. Para cada loja: chama `getTinyToken(mlUserId)` — idêntico ao `sync-tiny-costs` — com refresh automático via `tiny-oauth` se expirado
4. `fetchPayables()`: GET `/contas-pagar` com `dataVencimentoInicial` (hoje-90d) e `dataVencimentoFinal` (hoje+90d), paginando enquanto `itens.length === 100`. **Crítico: sem parâmetro `situacao`** (A5 do RESEARCH — Tiny v3 rejeita o enum)
5. Normaliza situação client-side: `["pago","quitado","2"]` → `'paid'`; resto → `'pending'`
6. `outflow_date`: usa `dataPagamento[:10]` se status='paid' e campo disponível, senão `dataVencimento[:10]`
7. UPSERT em `cash_outflows` com `onConflict: "organization_id,tiny_payable_id"` e `ignoreDuplicates: false` — permite atualizar status `pending→paid` entre syncs

Log de smoke na 1ª chamada: quantidade de itens por loja logada no console (premissa A3).

Adicionado ao `supabase/config.toml`:
```toml
[functions.sync-tiny-payables]
verify_jwt = false
```

### Task 2 — Migration pg_cron Pattern B (commit `290956a8`)

Criada a migration `supabase/migrations/20260618115000_cash_outflows_tiny_cron.sql`:

- Job: `sync-tiny-payables-6h` com schedule `0 */6 * * *`
- Pattern B: `Authorization` derivado de `vault.decrypted_secrets WHERE name = 'service_role_key'`
- URL: `https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/sync-tiny-payables`
- Unschedule idempotente (EXCEPTION WHEN OTHERS THEN NULL) antes de agendar
- Pré-requisito documentado no cabeçalho: vault deve ter `service_role_key` com valor `sb_secret_*`

### Task 3 — [BLOCKING] Deploy em produção

Checkpoint bloqueante — aguardando orquestrador/Wesley. Ver seção abaixo.

---

## Deviations from Plan

None — plano executado exatamente como especificado.

---

## Known Stubs

Nenhum stub. A EF grava dados reais do Tiny quando deployada e executada.

---

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| T-49-05-01 (mitigado) | sync-tiny-payables/index.ts | verify_jwt=false com requireServiceRole() interno — Bearer guard presente |
| T-49-05-02 (mitigado) | migration cron | Pattern B: secret em vault, não hardcoded |
| T-49-05-03 (mitigado) | sync-tiny-payables/index.ts | organization_id da linha ml_tokens — não injetado pelo caller |
| T-49-05-04 (mitigado) | sync-tiny-payables/index.ts | UNIQUE + ignoreDuplicates:false — idempotente |

---

## Self-Check

### Arquivos criados existem:
- `supabase/functions/sync-tiny-payables/index.ts` — criado
- `supabase/migrations/20260618115000_cash_outflows_tiny_cron.sql` — criado

### Commits existem:
- `c0a965d6` — feat(49-05): Edge Function sync-tiny-payables + config.toml
- `290956a8` — feat(49-05): migration pg_cron sync-tiny-payables a cada 6h

### Greps de verificação (todos passaram OK):
- `api.tiny.com.br/public-api/v3` ✓
- `contas-pagar` ✓
- `getTinyToken` ✓
- `tiny_access_token` ✓
- `onConflict.*organization_id.*tiny_payable_id` ✓
- `ignoreDuplicates` ✓
- ausência de `[?&]situacao=` ✓
- `[functions.sync-tiny-payables]` no config.toml ✓
- `sync-tiny-payables-6h` na migration ✓
- `vault.decrypted_secrets` na migration ✓
- URL `ckcdevcxgvueywivefgx` na migration ✓
- `0 */6 * * *` na migration ✓

## Self-Check: PASSED
