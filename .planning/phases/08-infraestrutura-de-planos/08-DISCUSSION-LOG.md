# Phase 8: Infraestrutura de Planos - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-19
**Phase:** 8-infraestrutura-de-planos
**Areas discussed:** RLS das novas tabelas, Estrutura da migration, plan_tier como ENUM

---

## RLS das novas tabelas

### organization_plans — leitura

| Option | Description | Selected |
|--------|-------------|----------|
| Sim, membros podem ler | RLS com SELECT aberto para membros da org. Permite futuras telas de status de sync. | ✓ |
| Não, somente service_role | Edge functions leem via service_role. Frontend não acessa diretamente. | |

**User's choice:** Sim, membros podem ler

### organization_plans — escrita

| Option | Description | Selected |
|--------|-------------|----------|
| Somente service_role | Apenas migrations e edge functions criam/alteram planos. | |
| Owner pode escrever via frontend | Owner pode mudar o próprio plano via UI futura. | ✓ |

**User's choice:** Owner pode escrever via frontend

### sync_quota_daily — acesso

| Option | Description | Selected |
|--------|-------------|----------|
| SELECT para membros, escrita service_role | Membros podem ver contador de quota. Útil para debug/status. | ✓ |
| Tudo via service_role, sem RLS exposta | Tabela interna, não exposta ao frontend. | |

**User's choice:** SELECT para membros, escrita service_role

---

## Estrutura da migration

### Schema + seed juntos ou separados

| Option | Description | Selected |
|--------|-------------|----------|
| 2 arquivos separados: schema + seed | Migration 1: DDL. Migration 2: INSERT...ON CONFLICT. Rollback granular. | ✓ |
| 1 único arquivo com tudo | Schema + seed juntos. Mais simples mas mistura DDL e DML. | |

**User's choice:** 2 arquivos separados

### DDL split: uma ou duas tables por migration

| Option | Description | Selected |
|--------|-------------|----------|
| Juntas em 1 migration de schema | Ambas as tabelas na mesma migration. Uma unidade lógica. | ✓ |
| Uma migration por tabela | Mais granular, facilita revert individual. | |

**User's choice:** Juntas em 1 migration

---

## plan_tier como ENUM

### Tipo de dado

| Option | Description | Selected |
|--------|-------------|----------|
| PG ENUM | CREATE TYPE public.plan_tier AS ENUM. Consistente com tax_regime. | ✓ |
| text + CHECK constraint | Mais fácil de estender. Menos intuitivo. | |

**User's choice:** PG ENUM

### Nome do tipo

| Option | Description | Selected |
|--------|-------------|----------|
| plan_tier | Nome direto. `public.plan_tier`. | ✓ |
| subscription_tier | Mais semântico para SaaS. Mais verboso que o padrão do projeto. | |

**User's choice:** plan_tier

---

## Claude's Discretion

- Nomes dos arquivos de migration (timestamp + slug descritivo)
- Índices adicionais em `organization_plans`
- DELETE policy para `organization_plans` e `sync_quota_daily`

## Deferred Ideas

- UI de gerenciamento de planos (upgrade/downgrade) — v3.1
- Hook React `useOrganizationPlan` — necessário na Fase 11, não na Fase 8
