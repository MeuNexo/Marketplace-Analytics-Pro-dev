# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-15)

**Milestone:** v2.0 — Análise Comercial de Marketplace
**Core value:** Ferramenta que transforma relatórios de pedidos em recomendações de preço GMV/Neutro/Margem, elasticidade e sugestões de compra/FULL.
**Current focus:** Roadmap v2.0 criado — pronto para iniciar Phase 4

## Current Position

Phase: Phase 4 (not started)
Plan: —
Status: Roadmap defined, ready to plan Phase 4
Last activity: 2026-05-15 — Roadmap v2.0 criado (Phases 4–7)

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 4. Motor de Análise + Snapshots | - | - | - |
| 5. Dashboard de Análise | - | - | - |
| 6. Recomendações de Compra & FULL | - | - | - |
| 7. Histórico Comparativo | - | - | - |

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
- HIST-01 (snapshot save) alocado na Phase 4 junto ao motor — a tabela Supabase e a lógica de save são infraestrutura consumida por todas as fases seguintes
- Fonte de dados: MLPedidos já sincronizados no Supabase; sem upload de CSV no v2.0
- UI do módulo vive na seção "Precificação" existente do app

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

## Session Continuity

Last session: 2026-05-15
Stopped at: Roadmap v2.0 criado (Phases 4–7), aguardando início da Phase 4
Resume file: None
