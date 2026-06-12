---
gsd_state_version: 1.0
milestone: v7.0
milestone_name: SaaS Operacional End-to-End
status: planning
last_updated: "2026-06-12T16:59:58.214Z"
last_activity: 2026-06-12
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md

**Milestone:** v5.0 — Dashboard de Vendas — KPIs Reais
**Core value:** O dashboard de Vendas exibe valores reais de comissão, frete (CFFE) e CFONPN — não estimativas hardcoded. R$38k/mês de custos hoje invisíveis passam a ser mostrados.
**Current focus:** Próximo milestone a definir

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-06-12 — Milestone v7.0 started

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

---

## Sessão 2026-06-04 — Phases 36/37/38

**Phase 36 (concluída, deployada)** — brand charts via ml_product_daily_cache fallback

- Migration `marca` em ml_product_daily_cache + mercado-libre-integration busca BRAND
- useMLOrdersByBrand: fallback para cache quando orders vazio

**Phase 37 (deployada)** — markup por marca via seller_sku

- Root cause: ml_product_costs.item_id = `TINY_<sku>` mas cache.item_id = `MLB...` → join nunca casava
- Ponte correta: seller_sku (`seller_custom_field` no ML)
- Migration `seller_sku` em ml_product_daily_cache (20260604120000)
- mercado-libre-integration v12: popula seller_sku
- recalc-order-costs v13: usa orders.sku → costs.seller_sku (prioridade Tiny) + fallback item_id legado
- useMLOrdersByBrand: join por seller_sku
- PENDENTE: aguardar próximo sync para popular seller_sku no cache; validar markup carregando

**Phase 38 (criada, pendente execução)** — validar 5 páginas do dashboard

- Wesley reportou: dados zerados / pedindo sync em publicidade, margem, anúncios, estoque, pedidos
- Investigação: backend saudável (200s), caches param em 2026-06-03, orders parado em 2026-05-27
- Ver `.planning/phases/38-validar-paginas-dashboard/38-CONTEXT.md` para hipóteses
- Hipótese principal: auto-sync frontend não dispara sync principal para "hoje"
- PRÓXIMO PASSO: reproduzir cada página com DevTools → confirmar hipótese → fix causa raiz

**Deploys confirmados (project ckcdevcxgvueywivefgx):**

- mercado-libre-integration v12 ACTIVE
- recalc-order-costs v13 ACTIVE

---

## Sessão 2026-06-04b — Phase 38 RESOLVIDA (pipeline de sync de orders)

**Sintoma:** dashboard com dados zerados pedindo sync (pedidos/margem/anúncios).
**Causa raiz:** orders congelou em 2026-05-27 — batch_upsert_orders falhava e o erro
era mascarado (sync-ml-orders retornava 200 orders_synced=0; process-sync-job marcava
completed). DOIS bugs: (1) seller_id virou uuid sem cast no RPC; (2) sync-ml-orders
passava JSON.stringify(records) → escalar em vez de array jsonb.

**Fixes deployados:**

- migration 20260604130000: batch_upsert_orders cast ::uuid (seller_id/user_id/org)
- sync-ml-orders v19: records direto (sem stringify) + throw em vez de engolir erro
- process-sync-job v14: checa success/orders_synced
- mercado-libre-integration v13: service-role + verify_jwt=false (corrige 401 do
  cron daily_cache — key sb_secret rejeitada pelo gateway verify_jwt=true)

**Backfill:** 14.694 linhas em orders (28/05→03/06, 2 contas). Jobs de 1 dia
(8 dias estouravam WORKER_RESOURCE_LIMIT). Disparo via net.http_post→process-sync-job.

**Aprendizado:** falha silenciosa (retornar 200 mascarando erro de storage) escondeu
o bug por ~1 semana. Sempre propagar erro de RPC + checar count no caller.

**Commits:** 0f31e710 (RPC+EFs), f69a8bc1 (stringify fix). Phase 38 ✅.

---

## Sessão 2026-06-04c — Phase 39 RESOLVIDA (/anuncios custo + /publicidade produtos)

**/anuncios custo/margem:** costs.get(item.id) buscava por MLB item_id; ml_product_costs
é keyado por seller_sku (TINY_). Fix: costFor() com fallback por seller_sku
(useMLProductCosts expõe costsBySku). Frontend, commit 57bbb9aa.

**/publicidade produtos patrocinados (zerado, parado 05-23):** DUAS causas:

1. sync-ads buscava /product_ads/items SEM metrics params → spend=0.
2. Constraint única obsoleta ml_ads_products_cache_unique (user_id,ml_user_id,item_id)
   SEM date conflitava com modelo série-por-dia → upsert falhava silenciosamente
   (logado, não lançado) → travado na 1ª data de cada item.
Fixes: sync-ads passa metrics+metrics_summary+date (v18); migration dropa a constraint
(20260604140000). Backfill 30 dias: 1639558873 spend R$6.112, 427063369 spend R$188k.

**Deploys:** sync-ads v18. Commits 57bbb9aa, cb0ec5c9. Phase 39 ✅.
