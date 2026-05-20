---
gsd_state_version: 1.0
milestone: v3.0
milestone_name: Sync Engine & Arquitetura DB-First
status: executing
stopped_at: Phase 9 planned — 3 plans ready to execute
last_updated: "2026-05-20T01:23:10.463Z"
last_activity: 2026-05-20 -- Phase 9 execution started
progress:
  total_phases: 4
  completed_phases: 1
  total_plans: 5
  completed_plans: 2
  percent: 25
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-19)

**Milestone:** v3.0 — Sync Engine & Arquitetura DB-First
**Core value:** Eliminar live API calls durante navegação; sync automático abastece o banco, front lê só do DB.
**Current focus:** Phase 9 — Job Queue & Dispatcher

## Current Position

Phase: 9 (Job Queue & Dispatcher) — EXECUTING
Plan: 1 of 3
Status: Executing Phase 9
Last activity: 2026-05-20 -- Phase 9 execution started

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 4. Motor de Análise + Snapshots | 3 plans ✅ | ~40 min | ~13 min |
| 5. Dashboard de Análise | 1 plan ✅ | ~8 min | ~8 min |
| 6. Recomendações de Compra & FULL | - | - | - |
| 7. Histórico Comparativo | - | - | - |
| 8. Infraestrutura de Planos | - | - | - |
| 9. Job Queue & Dispatcher | - | - | - |
| 10. Inventory Cache | - | - | - |
| 11. Frontend DB-First | - | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Configuração por loja ML (não por organização) — empresas podem ter contas ML em regimes diferentes
- Alíquota efetiva como denominador comum — reduz Lucro Real/Presumido a um único % para o catálogo
- Nova tabela `ml_tax_config` — não poluir `ml_tokens` com dados fiscais
- Owner only para configuração fiscal — dado sensível
- Motor de análise v2.0 como módulo TypeScript puro em `src/lib/analysis/` (testável independentemente da UI)
- roundUpTo99 implementado como `Math.ceil(raw - 0.99) + 0.99` — fórmula compacta e correta para arredondamento comercial
- Guard clause T-04-01: periodDays <= 0 ou orders vazio retornam ZERO_RESULT (sem exceção)
- Fallback de priceNeutral (.99/.90) inacessível com spec atual — priceGmv sempre é candidato real no range
- HIST-01 (snapshot save) alocado na Phase 4 junto ao motor — a tabela Supabase e a lógica de save são infraestrutura consumida por todas as fases seguintes
- Fonte de dados: MLPedidos já sincronizados no Supabase; sem upload de CSV no v2.0
- UI do módulo vive na seção "Precificação" existente do app
- v3.0: Postgres como fila de jobs (sem Redis/BullMQ) — volume < 100 orgs não justifica infra adicional
- v3.0: pg_cron como scheduler — ML não oferece webhooks confiáveis para BR
- v3.0: dispatch_sync_jobs() previne duplicatas com guard em pending/running — idempotência por design
- v3.0: PLANS-04 seed usa INSERT ... ON CONFLICT DO NOTHING para ser idempotente
- v3.0 Phase 9: claim atômico two-step em process-sync-job (SELECT id + UPDATE WHERE status='pending') — FOR UPDATE SKIP LOCKED não disponível via supabase-js v2 direto; tradeoff documentado no código
- v3.0 Phase 9: daily_cache e inventory job_types marcados como failed (not yet supported) na Phase 9 — apenas orders fully wired; Phase 10 implementa inventory

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v2.0 | Upload CSV/Excel como fonte alternativa | Deferred | Roadmap v2.0 |
| v2.0 | Análise automática agendada (snapshot semanal) | Deferred | Roadmap v2.0 |
| v2.0 | Exportação da tabela para XLSX | Deferred | Roadmap v2.0 |
| v2.0 | Pré-preencher campo de preço de venda na Precificação | Deferred | Roadmap v2.0 |
| v3.0 | Painel de status de sync no app | Deferred | Roadmap v3.0 |
| v3.0 | Sync de Publicidade (ML Ads) automático | Deferred | Roadmap v3.0 |
| v3.0 | Sync de Reputação e Perguntas | Deferred | Roadmap v3.0 |
| v3.0 | UI de gerenciamento de planos e limites | Deferred | Roadmap v3.0 |
| v3.0 | Notificação quando sync falha 3x consecutivas | Deferred | Roadmap v3.0 |
| v3.0 Phase 9 | daily_cache job_type fully wired | Deferred to Phase 10+ | Phase 9 planning |
| v3.0 Phase 9 | FOR UPDATE SKIP LOCKED via supabase-js | Deferred | Phase 9 planning (two-step used instead) |

## Session Continuity

Last session: 2026-05-19T00:00:00.000Z
Stopped at: Phase 9 planned — 3 plans ready to execute
Resume file: None
