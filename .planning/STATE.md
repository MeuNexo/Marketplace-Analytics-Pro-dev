---
gsd_state_version: 1.0
milestone: v6.0
milestone_name: Dashboard de Vendas — KPIs de Marca
status: complete
stopped_at: "Sessao 2026-06-03 — Phase 34 concluída: fix KPI cards Markup/Custo/Impostos para filtro Hoje. Commit 61b028ff."
last_updated: "2026-06-03T00:00:00Z"
last_activity: "2026-06-03 -- Phase 34 concluída (fix-kpi-summary-hoje). Commit: 61b028ff."
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

- Phase 17-02: item_id placeholder "TINY_{sku}" used in ml_product_costs because sync-ml-orders keys costMap by item_id (not seller_sku) — follow-up needed to wire SKU-based cost lookup in sync-ml-orders
- Phase 18-02: Tiny OAuth state elevated to Integrations parent scope (same pattern as ML OAuth)
- Phase 18-02: sync-tiny-costs now uses stored tiny_access_token + refresh via tiny-oauth (no client_credentials)
- Phase 18-02: tiny token columns added to types.ts manually (not regenerated from Supabase schema)
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

- Testar sync Tiny ERP em /integracoes → clicar "Sincronizar Custos" → verificar `SELECT COUNT(*) FROM ml_product_costs WHERE cost > 0;`
- Phase 16 (KPIs de Marca): `/gsd:execute-phase 16` — 3 planos prontos
- ~~Phase 28 (Performance)~~ ✅ CONCLUÍDA (2026-05-27) — 3 commits: de06fdf8, 77591401, ff7369d0

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

Last session: 2026-05-21b
Stopped at: Todos os fixes Tiny ERP concluídos e deployados. Aguardando Wesley testar sync e confirmar ml_product_costs populada.

### Sessão 2026-05-21b — Fixes Tiny ERP (completo)

**Problema 1 — Timeout sync-tiny-costs (HTTP 546)**
- Root cause: 100+ produtos × 1.1s sleep = >110s → timeout 150s
- Fix: `sync-tiny-costs` v6 — Phase 1 extrai preços da listagem `/produtos`, Phase 2 apenas para produtos sem preço (cap 80)
- Deploy: v6 ativo em produção

**Problema 2 — Estado conexão Tiny perdido ao navegar**
- Root cause real: migration `20260513174419` fez REVOKE SELECT em `ml_tokens`; `tiny_access_token` não estava no grant → query retornava null → useEffect limpava estado
- Fix: `Integrations.tsx` usa `localStorage` para inicializar `tinyConnected` (leitura imediata), background check usa `tiny_expires_at` (coluna permitida via migration `20260521230000`)
- Testado por Wesley: "funcionou"

**Problema 3 — Upsert retornava "0 sincronizados · 592 erros"**
- Root cause: índice parcial `ml_product_costs_user_sku` (`WHERE seller_sku IS NOT NULL`) incompatível com ON CONFLICT do PostgREST
- Erro: "there is no unique or exclusion constraint matching the ON CONFLICT specification"
- Fix: migration `20260521240000` — DROP INDEX + ADD CONSTRAINT UNIQUE (user_id, seller_sku)

**Problema 4 — Usuário thales@pevermeio.com**
- Root cause: INSERT em `auth.users` não cria `auth.identities` automaticamente → login falha
- Fix: inseriu registro manual em `auth.identities` com `provider='email'`, `provider_id=user_id`

**Problema 5 — Token Tiny não renovava automaticamente**
- Fix: `refresh_all` action adicionada em `tiny-oauth/index.ts`
- pg_cron `tiny-token-refresh-every-90min` criado e corrigido (sem dependência de vault — vault vazio)
- Deploy: `tiny-oauth` deployada via `npx supabase@2.100.1 functions deploy`

**Estado do DB:**
- `ml_product_costs`: 0 registros — aguardando primeiro sync
- Constraint `ml_product_costs_user_sku_unique` confirmada em produção
- Cron `tiny-token-refresh-every-90min` ativo

**Próxima sessão:**
1. Testar sync: /integracoes → "Sincronizar Custos"
2. Verificar: `SELECT COUNT(*) FROM ml_product_costs WHERE cost > 0;`
3. Partir para Phase 16: `/gsd:execute-phase 16`
