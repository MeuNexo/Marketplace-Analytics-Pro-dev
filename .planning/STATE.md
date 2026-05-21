---
gsd_state_version: 1.0
milestone: v5.0
milestone_name: Dashboard de Vendas — KPIs Reais
status: complete
stopped_at: Milestone v5.0 encerrado — Phase 15 adiada (financeiro, outro menu)
last_updated: "2026-05-21T19:45:00.000Z"
last_activity: 2026-05-21 -- Milestone v5.0 concluído. Phase 15 (billing/CFFE) adiada por decisão de produto
progress:
  total_phases: 2
  completed_phases: 1
  total_plans: 3
  completed_plans: 3
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md

**Milestone:** v5.0 — Dashboard de Vendas — KPIs Reais
**Core value:** O dashboard de Vendas exibe valores reais de comissão, frete (CFFE) e CFONPN — não estimativas hardcoded. R$38k/mês de custos hoje invisíveis passam a ser mostrados.
**Current focus:** Próximo milestone a definir

## Current Position

Phase: — (milestone completo)
Status: Milestone v5.0 ✅ ENCERRADO
Last activity: 2026-05-21 -- Phase 14 validada. Phase 15 adiada por decisão de produto (CFFE/billing pertence a menu financeiro futuro, não ao painel de vendas)

Progress: [█████░░░░░] 50%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 14. ml_orders | TBD | — | — |
| 15. ml_billing_monthly | TBD | — | — |

## Accumulated Context

### Decisions

- Fonte primária de comissão/frete: `ml_orders` (orders individuais via ML API)
- Fonte primária de CFFE/CFONPN: `ml_billing_monthly` (ML Billing API `/billing/periods`)
- Phase 14 e Phase 15 são independentes entre si (podem ser executadas em paralelo)
- Nexo MCP Supabase: `muesqdxnjlbaoiqylpjn` — estrutura de referência para schemas
- Scope garment-glow: sempre `organization_id` + `ml_user_id` (não apenas `seller_id`)
- Milestone anterior v4.0 completo — dados reais Pé Vermeio funcionando no dev

### Nexo MCP Data Reference (análise 2026-05-21)

Abril/2026 — Pé Vermeio (seller_id=1639558873):
- Receita bruta orders: R$351.236
- Comissão real (sum orders.comissao): R$39.170 (11.15%)
- Frete real (sum orders.frete): R$37.555 — mas CFFE billing R$40.065 (inclui extras)
- CFONPN (parcelamento): R$15.902 — INVISÍVEL hoje
- PADS (publicidade): R$12.341
- Bonificações BVVML: −R$3.004

Dashboard atual mostra:
- Frete: ~R$17.561 (5% hardcoded) → erro de R$22.504
- CFONPN: R$0 → erro de R$15.902
- Total custos subestimados: ~R$38.406/mês

### Pending Todos

None yet.

### Blockers/Concerns

- A `mercado-libre-integration` usa Deno — cuidado com o tamanho da função ao adicionar upsert em `ml_orders`
- ML Billing API pode ter formato diferente de `/orders` — validar campos CFFE e CFONPN durante planejamento da Phase 15
- Backfill de orders históricos não está no escopo — dados reais só para períodos após deploy

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v5.1 | Filtros por estado/cidade/SKU no dashboard | Deferred | Roadmap v5.0 |
| v5.1 | Billing para outras contas além da Pé Vermeio | Deferred | Roadmap v5.0 |
| v5.1 | DIFAL, CSHIA e outras cobranças menores do billing | Deferred | Roadmap v5.0 |
| v6.0 | Melhorias em outros menus (Publicidade, Estoque, Financeiro) | Deferred | Roadmap v5.0 |

## Session Continuity

Last session: 2026-05-21
Stopped at: Roadmap criado — pronto para executar Phase 14
Resume file: None
