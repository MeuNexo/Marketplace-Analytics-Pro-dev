# Roadmap — v7.0 SaaS Operacional End-to-End

## Overview

Sete fases transformam o dashboard (hoje mono-tenant, com mocks e sem pagamento) em SaaS vendável por assinatura: dados 100% verdadeiros (Phase 41), zero mocks (Phase 42), multi-tenant endurecido (Phase 43), monetização Stripe ativa (Phase 44), Consultor v1 como diferencial de venda (Phase 45), UX compreensível para lojista leigo (Phase 46) e QA end-to-end antes do go-live (Phase 47).

Supabase project: **ckcdevcxgvueywivefgx** (não o ID em CLAUDE.md). Deploy: push → Vercel auto.

## Phases

- [x] **Phase 41: Veracidade Total** — KPIs de /vendas, /financeiro e /anuncios com fontes reais e consistentes (CMV, billing, comissao real) (completed 2026-06-12)
- [ ] **Phase 42: Zero Mock** — /perguntas, /devolucoes, /reputacao e /tv lendo dados reais da API ML
- [ ] **Phase 43: Multi-Tenant Hardening** — RLS org-first, backfill de orfaos, quota enforcement, wizard de onboarding guiado
- [ ] **Phase 44: Monetizacao Stripe** — Checkout + webhooks + /planos + enforcement de tier aplicado de verdade
- [ ] **Phase 45: Consultor v1** — Engine de ~12 regras, card "O que fazer agora", painel de insights e score de saude 0-100
- [ ] **Phase 46: UX para Leigos** — Glossario/tooltips em todo KPI, empty states acionaveis, mobile polish, consistencia visual
- [ ] **Phase 47: QA End-to-End + Go-Live** — Simulacao tenant novo, auditoria de seguranca, tsc + build + smoke de deploy Vercel

---

## Phase Details

### Phase 41: Veracidade Total

**Goal**: Usuarios veem KPIs financeiros corretos em /vendas, /financeiro e /anuncios — sem calculos hardcoded, com billing real e fonte unica consistente
**Depends on**: Nothing (executa plans prontos existentes + Phase 15 adiada)
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04, DATA-05, DATA-06
**Reuse existing plans**:

  - DATA-01 (CMV/Impostos nulos) → executar plan pronto `.planning/phases/32-fix-lucro-bruto-cmv-impostos/32-01-PLAN.md`
  - DATA-02 (auto-recalc "Hoje") → executar plan pronto `.planning/phases/31-auto-sync-cmv-impostos-pedidos-realtime/31-01-PLAN.md`
  - DATA-03 (Lucro Bruto mensal fonte unica) → executar plan pronto `.planning/phases/21-lucro-cache/21-01-PLAN.md`

**Success Criteria** (what must be TRUE):

  1. Card "Custos" em /vendas exibe CMV e Impostos com valores nao-nulos quando ha configuracao cadastrada
  2. Filtro "Hoje" em /vendas carrega KPI cards via auto-recalc silencioso com skeleton — nunca "—" estatico
  3. Lucro Bruto mensal vem de useMLCostWaterfall como fonte unica, excluindo pedidos cancelados
  4. Linha "Frete ML" exibe CFFE real da billing API; linha "Parcelamento (CFONPN)" existe e tem valor — com indicador "billing" vs "estimado"
  5. Comissao em /anuncios vem da API ML (sale_fee/listing_prices) — LISTING_TYPE_RATES removido
  6. KPIs de /vendas, /financeiro e /anuncios batem entre si e com referencia Nexo Abril/2026 (comissao R$39,2k, CFFE R$40k, CFONPN R$15,9k)

**Plans**: 3 plansPlans:
**Wave 1**

- [x] 41-01-PLAN.md — Consolidar DATA-01/02/03 (CMV/Impostos visiveis, auto-recalc Hoje, Lucro Bruto fonte unica)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 41-02-PLAN.md — DATA-04 billing real (tabela ml_billing_monthly + EF sync-ml-billing + useMLBilling + CFFE/CFONPN no MLCostCard)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 41-03-PLAN.md — DATA-05 comissao real /anuncios + DATA-06 auditoria de consistencia cruzada

**UI hint**: yes

---

### Phase 42: Zero Mock

**Goal**: Nenhuma pagina do produto exibe dados simulados — /perguntas, /devolucoes, /reputacao e /tv todos lendo de fontes reais
**Depends on**: Phase 41
**Requirements**: MOCK-01, MOCK-02, MOCK-03, MOCK-04, MOCK-05
**Success Criteria** (what must be TRUE):

  1. /perguntas lista perguntas reais do ML (tabela ml_questions + EF sync-ml-questions) e usuario responde direto pela UI
  2. /devolucoes lista reclamacoes e devolucoes reais (tabela ml_claims + EF sync-ml-claims)
  3. /reputacao exibe feedback real da API ML — todos os getMock* removidos do codebase
  4. /tv lê sellers da tabela sellers filtrada por organization_id — sem UUIDs hardcoded em TVModeVendas.tsx
  5. Zero badge "dados simulados" visivel em qualquer pagina do produto

**Plans**: TBD
**UI hint**: yes

---

### Phase 43: Multi-Tenant Hardening

**Goal**: Qualquer org nova entra por convite e chega a dashboard com dados reais sem passo manual de super-admin alem de criar org+convite
**Depends on**: Phase 41
**Requirements**: TENANT-01, TENANT-02, TENANT-03, TENANT-04, TENANT-05
**Success Criteria** (what must be TRUE):

  1. Upserts em ml_product_costs via service role funcionam para qualquer org sem depender de user_id = auth.uid()
  2. Dados orfaos (organization_id NULL) backfillados ou removidos em todas as tabelas de cache
  3. Sync consulta quota por plan_tier (check_quota RPC) e bloqueia excedente — confirmado em logs
  4. Owner novo passa por wizard de onboarding passo a passo (Conectar ML → Tiny opcional → Custos → Fiscal → Pronto) com progresso persistido entre sessoes
  5. Com 2 orgs em paralelo, dados de uma nao aparecem na outra — isolamento confirmado via teste manual

**Plans**: TBD
**UI hint**: yes

---

### Phase 44: Monetizacao Stripe

**Goal**: Owner pode assinar plano com cartao de teste e a org muda de tier com quota e historico refletindo imediatamente
**Depends on**: Phase 43
**Requirements**: PAY-01, PAY-02, PAY-03, PAY-04
**Success Criteria** (what must be TRUE):

  1. Owner conclui Stripe Checkout e org passa do tier free para o tier escolhido — sem intervencao manual
  2. Webhooks Stripe (checkout.session.completed, invoice.paid, customer.subscription.updated/deleted) atualizam tabela subscriptions automaticamente
  3. Pagina /planos exibe plano atual, estado de pagamento e permite upgrade/downgrade via Stripe Customer Portal
  4. Limites do tier (history_days, sync_interval_minutes) aplicados de verdade — org no tier free nao acessa historico do tier pro

**Plans**: TBD

---

### Phase 45: Consultor v1

**Goal**: A Pé Vermeio ve ≥5 insights reais e acionaveis no primeiro run e tem score de saude visivel no topo de /vendas
**Depends on**: Phase 41, Phase 42
**Requirements**: CONSUL-01, CONSUL-02, CONSUL-03, CONSUL-04, CONSUL-05
**Success Criteria** (what must be TRUE):

  1. Engine consultor-insights roda por org, avalia ~12 regras e grava em tabela insights (severidade, categoria, acao recomendada, impacto estimado em R$)
  2. Card "O que fazer agora" aparece no topo de /vendas com os top insights acionaveis — com texto em linguagem leiga
  3. Painel de insights exibe explicacao por insight ("por que isso importa", "como resolver")
  4. Score de saude do negocio (0-100) visivel — composto por margem, ads, estoque, reputacao e completude de configuracao
  5. Org Pé Vermeio gera ≥5 insights reais e acionaveis no primeiro run do engine

**Plans**: TBD
**UI hint**: yes

---

### Phase 46: UX para Leigos

**Goal**: Qualquer lojista sem experiencia tecnica entende os KPIs e sabe o que fazer ao ver qualquer pagina — incluindo em mobile
**Depends on**: Phase 45
**Requirements**: UX-01, UX-02, UX-03, UX-04
**Success Criteria** (what must be TRUE):

  1. Todo KPI tem tooltip/glossario em linguagem leiga acessivel via hover (ex: "CFFE = o frete que o ML te cobra")
  2. Toda pagina sem dados exibe empty state com instrucao de acao especifica ("o que fazer para ter dados aqui")
  3. Tabelas de /anuncios, /pedidos e /financeiro renderizam sem overflow quebrado em viewport mobile (320–768px)
  4. Consistencia visual revisada nas paginas principais (tokens kpi.positive/negative, espacamentos, dark mode sem elementos quebrados)

**Plans**: TBD
**UI hint**: yes

---

### Phase 47: QA End-to-End + Go-Live

**Goal**: Sistema pronto para receber clientes reais — tenant novo funciona sem passo manual, seguranca auditada, build limpo
**Depends on**: Phase 44, Phase 46
**Requirements**: QA-01, QA-02, QA-03
**Success Criteria** (what must be TRUE):

  1. Simulacao completa tenant novo (convite → onboarding → OAuth ML → sync → dados reais → assinar plano → insights) sem nenhum passo manual de super-admin alem de criar org+convite
  2. Supabase advisors sem erro critico, RLS em todas as tabelas de dados, verify_jwt=true nas EFs de negocio
  3. tsc --noEmit + npm run build + smoke de deploy Vercel todos limpos sem erros

**Plans**: TBD

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 41. Veracidade Total | 4/4 | Complete    | 2026-06-13 |
| 42. Zero Mock | 0/? | Not started | - |
| 43. Multi-Tenant Hardening | 0/? | Not started | - |
| 44. Monetizacao Stripe | 0/? | Not started | - |
| 45. Consultor v1 | 0/? | Not started | - |
| 46. UX para Leigos | 0/? | Not started | - |
| 47. QA End-to-End + Go-Live | 0/? | Not started | - |
