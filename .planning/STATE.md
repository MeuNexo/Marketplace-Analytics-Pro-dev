---
gsd_state_version: 1.0
milestone: v7.0
milestone_name: milestone
status: planning
stopped_at: "Roadmap escrito (Phases 41–47, 27/27 requirements mapeados). Próximo: `/gsd-plan-phase 41`."
last_updated: "2026-06-12T17:48:33.532Z"
last_activity: 2026-06-12 — Roadmap v7.0 criado (Phases 41–47) + DATA-01 executado e validado em produção
progress:
  total_phases: 7
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md

**Milestone:** v7.0 — SaaS Operacional End-to-End
**Core value:** Sistema 100% operacional e vendável como assinatura — dados verdadeiros em todas as páginas (zero mock), multi-tenant endurecido, monetização via Stripe ativa, onboarding guiado para lojista leigo, e Consultor v1 (motor de regras + score de saúde) como diferencial de venda.
**Current focus:** Roadmap criado — pronto para `/gsd-plan-phase 41`

## Current Position

Phase: 41 — Veracidade Total (DATA-01 já executado ad-hoc; restante aguarda `/gsd-plan-phase 41`)
Plan: —
Status: Ready to plan Phase 41
Last activity: 2026-06-12 — Roadmap v7.0 criado (Phases 41–47) + DATA-01 executado e validado em produção

### DATA-01 executado (2026-06-12, commit fc090c46)

- Migration `20260612120000_fix_cost_waterfall_fallback_and_upsert_preserve` aplicada em produção (ckcdevcxgvueywivefgx)
- **ATENÇÃO:** migration local `20260601000000` foi REMOVIDA do repo — nunca aplicada e continha batch_upsert_orders sem cast ::uuid (reverteria fix da Phase 38)
- Validado via SQL: get_cost_waterfall jun/01-12 → paid_revenue R$115.195, CMV R$46.165, tax R$23.667 não-nulos (402 orders); fallback + COALESCE + cast ::uuid confirmados via pg_get_functiondef
- Pendente: confirmação visual de Wesley no card "Custos" em /vendas (CMV e Impostos aparecendo)
- Descoberta: produção tinha 0 orders com receita_bruta NULL (backfill virou no-op idempotente); o bug ativo era só a definição das funções
- Supabase CLI local linkado no projeto ERRADO (gionpsuunfkkzzjdubfy) — não usar `db push`; aplicar migrations via MCP apply_migration no ckcdevcxgvueywivefgx

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 41. Veracidade Total | TBD | — | — |
| 42. Zero Mock | TBD | — | — |
| 43. Multi-Tenant Hardening | TBD | — | — |
| 44. Monetizacao Stripe | TBD | — | — |
| 45. Consultor v1 | TBD | — | — |
| 46. UX para Leigos | TBD | — | — |
| 47. QA End-to-End + Go-Live | TBD | — | — |

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
- Milestone anterior v6.0 completo — brand charts, sync de orders e ads spend reais funcionando
- **Supabase project correto: ckcdevcxgvueywivefgx** (CLAUDE.md menciona gionpsuunfkkzzjdubfy — desatualizado, sempre usar ckcdevcxgvueywivefgx)
- Gateway de pagamento: Stripe (checkout + webhook + customer portal)
- Entrada de clientes: convite controlado (self-service signup fica para v2)
- Consultor v1: motor de regras determinístico (~12 regras + score 0-100), sem LLM por usuário
- /perguntas e /devolucoes: integração real (ML Questions API + Claims API — portar padrão do Nexo MCP)

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

- Rodar `/gsd-plan-phase 41` — plans prontos para DATA-01 (32-01), DATA-02 (31-01), DATA-03 (21-01) devem ser referenciados e reaproveitados pelo planejador
- Testar sync Tiny ERP em /integracoes → clicar "Sincronizar Custos" → verificar `SELECT COUNT(*) FROM ml_product_costs WHERE cost > 0;`

### Blockers/Concerns

- A `mercado-libre-integration` usa Deno — cuidado com o tamanho da função ao adicionar upsert em `ml_orders`
- ML Billing API pode ter formato diferente de `/orders` — validar campos CFFE e CFONPN durante planejamento da Phase 41 (bloco DATA-04)
- ML Claims/Questions API: rate limits e formatos — mitigar portando lógica já validada do Nexo MCP (/root/nexo-mcp/)
- Stripe em 1 dia é apertado — escopo mínimo: checkout + webhook + portal (sem proration custom)
- Phases 28/29 (performance) ficam condicionais — só entram no dia 10 (Phase 47) se QA mostrar lentidão real

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v5.1 | Filtros por estado/cidade/SKU no dashboard | Deferred | Roadmap v5.0 |
| v5.1 | Billing para outras contas além da Pé Vermeio | Deferred | Roadmap v5.0 |
| v5.1 | DIFAL, CSHIA e outras cobranças menores do billing | Deferred | Roadmap v5.0 |
| v6.0 | Melhorias em outros menus (Publicidade, Estoque, Financeiro) | Deferred | Roadmap v5.0 |
| v8.0 | Self-service signup público | Deferred | Roadmap v7.0 |
| v8.0 | Consultor com análises geradas por LLM | Deferred | Roadmap v7.0 |
| v8.0 | Phase 23 dashboard granular (coluna Margem % em Top Anúncios, dual-axis) | Deferred | Roadmap v7.0 |
| v8.0 | Phases 28/29 performance — só entram se QA mostrar lentidão | Conditional | Roadmap v7.0 |
| v8.0 | Landing page pública de marketing/pricing | Deferred | Roadmap v7.0 |

## Session Continuity

Last session: 2026-06-12 — Roadmap v7.0 criado
Stopped at: Roadmap escrito (Phases 41–47, 27/27 requirements mapeados). Próximo: `/gsd-plan-phase 41`.

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

**Phase 38 (concluída)** — validar 5 páginas do dashboard

- Causa raiz: orders congelou em 2026-05-27 — batch_upsert_orders falhava e o erro era mascarado
- Fixes: cast ::uuid + JSON.stringify fix + throw em erros + mercado-libre-integration v13 service-role
- Commits: 0f31e710, f69a8bc1

**Phase 39 (concluída)** — /anuncios custo + /publicidade produtos

- /anuncios: costFor() com fallback por seller_sku (useMLProductCosts expõe costsBySku)
- /publicidade: sync-ads v18 com metrics params + constraint única dropeada
- Backfill 30 dias: spend real populado
- Commits: 57bbb9aa, cb0ec5c9

**Phase 40 (concluída)** — fix charts overlap brand row

- min-w-0 overflow-hidden nos 3 Card raízes de BrandRevenueChart, BrandMarkupChart, CustoOperacionalChart
- Commits: confirmados e deployados via Vercel

**Deploys confirmados (project ckcdevcxgvueywivefgx):**

- mercado-libre-integration v13 ACTIVE
- recalc-order-costs v13 ACTIVE
- sync-ads v18 ACTIVE
