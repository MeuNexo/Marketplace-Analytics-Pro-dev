# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-15)

**Milestone:** v2.0 — Análise Comercial de Marketplace
**Core value:** Ferramenta que transforma relatórios de pedidos em recomendações de preço GMV/Neutro/Margem, elasticidade e sugestões de compra/FULL.
**Current focus:** Phase 5 — Dashboard de Análise (DASH-01..03)

## Current Position

Phase: Phase 5 (next)
Plan: 05-01 (a planejar)
Status: Phase 4 COMPLETE ✅ — iniciando Phase 5
Last activity: 2026-05-15 — Phase 4 completa: motor + migration + hook (46 testes GREEN, VERIFICATION PASSED)

Progress: [██░░░░░░░░] 25% (Phase 4/7 complete)

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 4. Motor de Análise + Snapshots | 3 plans ✅ | ~40 min | ~13 min |
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
- roundUpTo99 implementado como `Math.ceil(raw - 0.99) + 0.99` — fórmula compacta e correta para arredondamento comercial
- Guard clause T-04-01: periodDays <= 0 ou orders vazio retornam ZERO_RESULT (sem exceção)
- Fallback de priceNeutral (.99/.90) inacessível com spec atual — priceGmv sempre é candidato real no range
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
Stopped at: Phase 4 COMPLETE — todos os 3 planos executados e VERIFICATION PASSED
Resume file: None
