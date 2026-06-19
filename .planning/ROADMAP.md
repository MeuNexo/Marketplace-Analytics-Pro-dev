# Roadmap — v7.0 SaaS Operacional End-to-End

## Overview

Sete fases transformam o dashboard (hoje mono-tenant, com mocks e sem pagamento) em SaaS vendável por assinatura: dados 100% verdadeiros (Phase 41), zero mocks (Phase 42), multi-tenant endurecido (Phase 43), monetização Stripe ativa (Phase 44), Consultor v1 como diferencial de venda (Phase 45), UX compreensível para lojista leigo (Phase 46) e QA end-to-end antes do go-live (Phase 47).

Supabase project: **ckcdevcxgvueywivefgx** (não o ID em CLAUDE.md). Deploy: push → Vercel auto.

## Phases

- [x] **Phase 41: Veracidade Total** — KPIs de /vendas, /financeiro e /anuncios com fontes reais e consistentes (CMV, billing, comissao real) (completed 2026-06-12)
- [x] **Phase 42: Zero Mock** — /perguntas, /devolucoes, /reputacao e /tv lendo dados reais da API ML (completed 2026-06-13)
- [x] **Phase 43: Multi-Tenant Hardening** — RLS org-first, backfill de orfaos, quota enforcement, wizard de onboarding guiado (isolamento 2-org PASS; pendente code-review/verify-phase + checkpoint visual)
- [~] **Phase 44: Monetizacao Stripe** — ADIADA (decisão Wesley 2026-06-14): versão de teste do dashboard não precisa de pagamento; integração Stripe (checkout/webhooks/secrets) fica para o desenvolvedor depois. Planos já existem (44-01/02/03-PLAN.md). Reativar antes da Phase 47 (go-live depende de PAY-*).
- [x] **Phase 45: Consultor v1** — Engine de ~12 regras, card "O que fazer agora", painel de insights e score de saude 0-100 (completed 2026-06-14)
- [ ] **Phase 46: UX para Leigos** — Glossario/tooltips em todo KPI, empty states acionaveis, mobile polish, consistencia visual
- [ ] **Phase 47: QA End-to-End + Go-Live** — Simulacao tenant novo, auditoria de seguranca, tsc + build + smoke de deploy Vercel
- [x] **Phase 48: MCO com Ads** — Margem por produto considerando publicidade: margem operacional + margem pos-ads lado a lado, alerta separado "ads comendo a margem" (TACoS/ACoS por produto), MCO agregado da operacao. Atribuicao direta via ml_ads_products_cache (reconcilia 100% com total da conta) (completed 2026-06-14)
- [x] **Phase 49: Fluxo de Caixa (Caixa Real)** — Nova pagina em "Operacoes" com o grafico "Como meu dinheiro vai evoluir?" (saldo real + projecao) e 3 cards (Caixa Hoje, Projecao Futura, Capacidade de Compra), alimentados por caixa REAL: entradas = liberacoes Mercado Pago, saidas = despesas/OCs. Portado do antigo SaaS nexointeligence. Dados validados centavo a centavo vs planilha DFC do Wesley + timezone BRT corrigido (completed 2026-06-19)
- [x] **Phase 50: Simulador de Cenarios ("E se...?")** — Aba "Simulador" no Fluxo de Caixa: sliders de recebimento/gasto extra/dia + ate 2 eventos pontuais + veredito folga/status ("posso gastar mais ou preciso receber mais?"). Modulo puro testavel + 3a linha no grafico. Calculo 100% frontend, zero backend. Verifier PASSED 6/6 (completed 2026-06-19)

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

**Plans**: 4 plans

**Wave 1**

- [x] 42-01-PLAN.md — Migration ml_questions + ml_claims (RLS, indices) + config.toml + test scaffolds + [BLOCKING] apply tables + vault service_role_key check

**Wave 2** *(blocked on Wave 1)*

- [x] 42-02-PLAN.md — EFs sync-ml-questions / sync-ml-claims / reply-ml-question + ml-reputation feedbacks[] + pg_cron Pattern B + [BLOCKING] deploy/smoke

**Wave 3** *(blocked on Wave 1 + Wave 2; 42-03 e 42-04 em paralelo — sem overlap de arquivos)*

- [x] 42-03-PLAN.md — Hooks useMLQuestions/useMLClaims + rewrite /perguntas (inline reply), /devolucoes (filtros), /reputacao (feedback real) + remocao de mocks
- [x] 42-04-PLAN.md — TVModeVendas sellers dinamicos por organization_id (MOCK-05)

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

**Plans**: 4 plans

**Wave 1**

- [x] 43-01-PLAN.md — TENANT-01 RLS org-first ml_product_costs + TENANT-02 backfill/orfaos + NOT NULL + ME-06 billing FOR SELECT + [BLOCKING] apply via MCP
- [x] 43-02-PLAN.md — ME-04 token lookup determinístico + ME-05 guard is_org_member + TENANT-03 check_quota RPC + gate process-sync-job + cron Pattern B + [BLOCKING] apply/deploy

**Wave 2** *(blocked on 43-01)*

- [x] 43-03-PLAN.md — TENANT-04 wizard de onboarding (tabela onboarding_progress + hook + banner/wizard rhf+shadcn + wiring dashboard/AcceptInvite) + [BLOCKING] apply migration

**Wave 3** *(blocked on 43-01, 43-02, 43-03)*

- [x] 43-04-PLAN.md — TENANT-05 teste de isolamento 2-org (ISOLATION-TEST.md + execucao RLS/ME-04/05/06/quota) — veredito PASS, 0 vazamentos cross-org

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

**Plans**: 3 plans

**Wave 1**

- [ ] 44-01-PLAN.md — DB foundation: subscriptions/billing_events + tier_prices + apply_subscription_tier RPC + history_days enforcement (org_history_floor) + types.ts; decisao tier limits/A4 + [BLOCKING] apply via MCP

**Wave 2** *(blocked on 44-01)*

- [ ] 44-02-PLAN.md — EFs stripe-checkout (verify_jwt=true, owner) + stripe-webhook (verify_jwt=false, HMAC) + config.toml + [BLOCKING] Stripe Dashboard/secrets/deploy/webhook

**Wave 3** *(blocked on 44-01 + 44-02)*

- [ ] 44-03-PLAN.md — useSubscription hook + /planos page (owner-only) + route + mlCacheService dateFrom clamp (PAY-04 client) + [checkpoint] verificacao E2E

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

**Plans**: 3 plans

**Wave 1**

- [x] 45-01-PLAN.md — Fundação de dados: 3 tabelas (insights, consultor_config, consultor_health_snapshots) RLS org-first + RPCs do engine (margem/cobertura/sem-custo) + types.ts + [BLOCKING] apply via MCP

**Wave 2** *(blocked on 45-01)*

- [x] 45-02-PLAN.md — EF consultor-insights (12 regras + score 0-100 ponderado + upsert/auto-resolve + snapshot + auth dual) + pg_cron Pattern B + config.toml + [BLOCKING] deploy/apply/smoke (CONSUL-05 ≥5 insights)

**Wave 3** *(blocked on 45-01 + 45-02)*

- [x] 45-03-PLAN.md — UI: hook useConsultorInsights + ConsultorCard no topo de /vendas + página /consultor (rota+sidebar+routeMeta) + deep-links + dismiss + [checkpoint] visual Wesley

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

**Plans**: 5 plans em 3 waves

Plans:

- [x] 46-01-primitivos-compartilhados-PLAN.md — Glossário central + KPICard hover+tap (Popover) + componente EmptyState (Wave 1)
- [x] 46-02-glossario-e-empty-states-componentes-PLAN.md — Glossário no MLKPIGrid + empty states em analytics/estoque (Wave 2)
- [x] 46-03-tabelas-mobile-e-tokens-PLAN.md — Tabelas→cards mobile + glossário + EmptyState + tokens kpi em /anuncios, /pedidos, /financeiro (Wave 2)
- [x] 46-05-cobertura-kpi-e-precificacao-PLAN.md — Cobertura UX-01 nos sites de KPICard fora do radar + auditoria UX-04 de /precificacao (Wave 2)
- [ ] 46-04-checkpoint-visual-PLAN.md — Enumeração de cobertura + checkpoint Wesley: redação do glossário + dark mode das 6 páginas (Wave 3)

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

### Phase 48: MCO com Ads

**Goal**: A margem por produto e o MCO da operacao consideram o gasto real de publicidade por anuncio, separando "unit economics ruim" de "ads comendo a margem"
**Depends on**: Phase 41 (custos/margem reais), Phase 45 (Consultor — alertas)
**Decisao travada (Wesley 2026-06-14)**: modelo de 2 numeros — margem operacional (sem ads) E margem pos-ads lado a lado; "prejuizo" permanece na operacional; novo alerta SEPARADO "ads comendo a margem" por produto (TACoS/ACoS alto). Atribuicao direta por item via `ml_ads_products_cache` (reconcilia 100% com `ml_ads_daily_cache` — sem rateio).
**Success Criteria** (what must be TRUE):

  1. Existe fonte por produto de ads_spend/attributed_revenue (RPC junta margem + ads por item_id, mesma janela), sem truncamento PostgREST
  2. Margem por produto exibe margem operacional E margem pos-ads (ex: em /anuncios coluna financeira e/ou painel do Consultor)
  3. MCO agregado da operacao = Σ margem de contribuicao − ads total, visivel (card Custos/DRE)
  4. Alerta separado por produto "ads comendo a margem" (TACoS/ACoS acima do limiar) — NAO mistura com o alerta de prejuizo operacional
  5. (a decidir no planejamento) ads_no_sale quebrado por produto (gasto com zero venda no item)

**Resolvido no discuss/plan (Wesley 2026-06-14)**: exibir nas 3 superficies (/anuncios coluna financeiro D-03, Consultor insight D-04, card Custos/DRE D-05); limiares pos-ads critico <= 0% / alerta <= 10% via consultor_config (D-06); estende o Consultor v1 (nova RULE ads_eating_margin + upgrade ads_no_sale item-level, D-08/D-09); ads_no_sale por produto no escopo (D-11, MCO-05).

**Requirements**: MCO-01, MCO-02, MCO-03, MCO-04, MCO-05

**Plans**: 3 plans (2 waves)

**Wave 1**

- [x] 48-01-PLAN.md — RPC get_margin_with_ads_by_product (FULL OUTER JOIN orders+ml_ads_products_cache, SECURITY DEFINER, sem truncamento) + colunas consultor_config + [BLOCKING] apply (MCO-01)

**Wave 2** *(blocked on 48-01; 48-02 e 48-03 em paralelo — sem overlap de arquivos)*

- [x] 48-02-PLAN.md — EF consultor-insights: RULE ads_eating_margin per-item + upgrade ads_no_sale item-level + pilar Ads do score + [BLOCKING] deploy/smoke (MCO-04, MCO-05)
- [x] 48-03-PLAN.md — Frontend: hook useMLMarginWithAds + 2 colunas em /anuncios + linha Publicidade/MCO agregado no DRE + [checkpoint] visual (MCO-02, MCO-03) — aprovado Wesley 2026-06-14

**UI hint**: yes

---

### Phase 49: Fluxo de Caixa (Caixa Real)

**Goal**: O lojista acessa uma pagina dedicada de Fluxo de Caixa (sob o grupo de menu "Operacoes") e enxerga, com dados REAIS de caixa, como seu dinheiro vai evoluir no tempo (saldo real + projecao) e responde 3 perguntas: "quanto tenho hoje?", "quanto vou ter?" e "posso comprar mais estoque?"
**Depends on**: Phase 41 (dados/custos reais), Phase 43 (RLS multi-tenant org-first)
**Decisao travada (Wesley 2026-06-18)**: (1) FONTE = CAIXA REAL — entradas = liberacoes reais do Mercado Pago; saidas = contas a pagar do Tiny ERP (integracao /contas-pagar via EF sync-tiny-payables, decisao atualizada Wesley 2026-06-18); NAO derivar de vendas nem usar lancamento manual. (2) LOCALIZACAO = nova pagina sob novo grupo de menu "Operacoes" (criar o agrupamento); NAO mexer no /financeiro atual (DRE de competencia/margem, conceito diferente). (3) MVP = grafico de evolucao + 3 cards (Caixa Hoje, Projecao Futura pessimista/realista, Capacidade de Compra). Demais cards do nexointeligence (despesas, valor em estoque, estoque parado, DRE sintetico, previsao de receita) = fase posterior.
**Referencia**: SaaS antigo nexointeligence (clonado em /tmp/nexointeligence) — grafico src/components/financial/CashFlowChart.tsx (Recharts ComposedChart, 2 linhas real/projetado, RPC get_financial_cashflow, 120 dias); cards TodayBalanceCard/ProjectedBalanceCard/CapacityCard; tabelas-fonte transactions + financial_settings (initial_balance, operational_cost_rate=0.22, safety_margin=10000) + sales_history. Logica de projecao: SMA de vendas dos ultimos 15 dias x (1 - custo_operacional), ativa apos o dia 8. MCP da API ML p/ liberacoes Mercado Pago: https://developers.mercadolivre.com.br/pt_br/server-mcp
**Success Criteria** (what must be TRUE):

  1. Existe ingestao de caixa REAL multi-tenant: entradas = liberacoes do Mercado Pago (nova EF + tabela, padrao das EFs sync-* existentes) e saidas = despesas/OCs (tabela), ambas escopadas por organization_id com RLS
  2. RPC de fluxo de caixa SECURITY INVOKER (nao DEFINER+param — evita IDOR) retorna saldo diario acumulado REAL + projecao (SMA de vendas x (1 - custo operacional), ativa apos dia 8), sem truncamento PostgREST e respeitando boundary de data timestamptz (.lt nextDay, nao .lte string)
  3. Nova pagina /fluxo-de-caixa sob grupo de menu "Operacoes" no shell, com guard de rota (RoleRoute) e isolamento por org
  4. Grafico "Como meu dinheiro vai evoluir?" (ComposedChart, linha real pessimista + linha projetada realista) com periodo, tooltip com breakdown e alerta visual de saldo negativo
  5. 3 cards com dado real: Caixa Hoje (saldo inicial + entradas - saidas do dia), Projecao Futura (pessimista vs realista + data critica de saldo < 0), Capacidade de Compra (saldo projetado - margem de seguranca; "posso comprar mais estoque?")
  6. Parametros configuraveis por org (financial_settings): saldo inicial, taxa de custo operacional, margem de seguranca

**Requirements**: CASH-01, CASH-02, CASH-03, CASH-04, CASH-05, CASH-06

**Pontos que exigem aprovacao do Wesley** (sinalizar nos planos): deploy de Edge Function nova, migrations em producao (ckcdevcxgvueywivefgx), e checkpoint visual no preview Vercel antes de qualquer merge para main/producao.

**Plans**: 5 plans em 4 waves

**Wave 1 — Backend de ingestao de caixa real** *(2 planos paralelos; 49-05 deploya apos a tabela do 49-01)*

- [x] 49-01-PLAN.md — Tabelas (financial_settings/cash_inflows/cash_outflows com schema Tiny + RLS) + EF sync-mp-releases (ENTRADAS = liberacoes MP) + pg_cron Pattern B + [BLOCKING] apply/deploy/smoke (CASH-01, CASH-02, CASH-06)
- [x] 49-05-PLAN.md — EF sync-tiny-payables (SAIDAS = contas a pagar do Tiny /contas-pagar -> cash_outflows, multi-tenant, idempotente) + pg_cron Pattern B 6h + [BLOCKING] deploy/smoke (depends_on 49-01) (CASH-02)

**Wave 2 — RPCs de fluxo de caixa** *(blocked on 49-01)*

- [x] 49-02-PLAN.md — get_cashflow + get_daily_balance + get_projected_balance_summary (SECURITY INVOKER, SMA via orders por org, sem truncamento) + REVOKE/GRANT + [BLOCKING] apply (CASH-03)

**Wave 3 — Frontend: hooks + grafico** *(blocked on 49-02)*

- [x] 49-03-PLAN.md — 5 hooks (useFinancialSettings/useCashFlowData/useTodayBalance/useProjectedBalance/useFinancialHealth) + CashFlowChart (ComposedChart 2 linhas + alerta saldo<0) (CASH-04, CASH-05, CASH-06)

**Wave 4 — Frontend: pagina + cards + nav** *(blocked on 49-03)*

- [x] 49-04-PLAN.md — 3 cards (Caixa Hoje/Projecao Futura/Capacidade) + pagina MLFluxoCaixa + sidebar Operacoes/rota/roleAccess/routeMeta + [checkpoint] visual Wesley no preview Vercel (CASH-04, CASH-05)

**UI hint**: yes

### Phase 50: Simulador de Cenarios de Caixa ("E se...?")

**Goal**: Na propria pagina de Fluxo de Caixa, uma aba "Simulador" permite ao lojista arrastar medias de recebimento e gasto extras (+ ate 2 eventos pontuais) e ver na hora como o caixa evolui, respondendo "posso gastar mais ou preciso receber mais?" via veredito de folga + status.
**Depends on**: Phase 49 (RPC get_cashflow, hook useCashFlowData, CashFlowChart, pagina MLFluxoCaixa)
**Decisao travada (Wesley 2026-06-19)**: (1) modelo hibrido — 2 sliders de media (delta "extra sobre o real") + ate 2 eventos pontuais; (2) veredito Folga + status (Saudavel/Risco, "pode gastar +R$X/dia" ou "precisa +R$Y/dia"); (3) margem = financial_settings.safety_margin (R$10k); (4) aba na pagina de Fluxo de Caixa (nao pagina separada); (5) SEM persistencia (rascunho de sessao); (6) calculo 100% frontend reusando get_cashflow — ZERO migration/tabela/RPC nova.
**Referencia**: ScenarioSimulator do nexointeligence (porte enxuto). Spec completo: docs/superpowers/specs/2026-06-19-simulador-fluxo-caixa-design.md
**Success Criteria** (what must be TRUE):

  1. Modulo puro testavel src/lib/cashflowSimulation.ts calcula serie simulada + veredito (folga/necessidade/status) a partir do baseline + deltas + eventos, com testes vitest cobrindo: sem-simulacao, gasto empurra risco, recebimento da folga, evento pontual entrada/saida na data certa
  2. Aba "Simulador" na pagina MLFluxoCaixa (Tabs shadcn "Caixa Real" | "Simulador"), aba Caixa Real intocada
  3. Controles: slider recebimento extra/dia (-5k..+5k step100), slider gasto extra/dia (0..+10k step100), ate 2 eventos pontuais (valor/data/tipo entrada-saida), botao Limpar
  4. CashFlowChart estendido com prop opcional simulatedSeries (3a linha tracejada azul kpi-neutral "Cenario simulado"), 100% compativel com uso atual (aba Caixa Real nao passa a prop)
  5. Painel de veredito (SimulatorVerdictCard): selo Saudavel/Risco + frase de folga/necessidade + menor saldo e data critica
  6. Sem mudanca de backend (nenhuma migration/EF/RPC nova); estado so de sessao (rascunho)

**Requirements**: SIM-01, SIM-02, SIM-03, SIM-04, SIM-05

**Pontos que exigem aprovacao do Wesley** (sinalizar nos planos): checkpoint visual no preview Vercel antes de qualquer merge para main.

**UI hint**: yes

**Plans**: 3 plans
Plans:

- [ ] 50-01-PLAN.md — Modulo puro cashflowSimulation.ts + testes vitest (TDD, SIM-01)
- [ ] 50-02-PLAN.md — CashFlowChart estendido (simulatedSeries) + SimulatorVerdictCard (SIM-04, SIM-05)
- [ ] 50-03-PLAN.md — CashFlowSimulator (controles/estado) + Tabs em MLFluxoCaixa + checkpoint visual (SIM-02, SIM-03)

---

### Phase 51: Painel de Tesouraria (Fluxo de Caixa)

**Goal**: Substituir os cards atuais da aba "Caixa Real" da pagina de Fluxo de Caixa (que hoje respondem "quanto tenho/quanto vou ter/posso comprar estoque") por um painel de tesouraria orientado a saude de caixa e exposicao a fornecedores: 12 KPIs em 3 faixas (saude de caixa, realizado, exposicao a fornecedor) + 3 graficos (Saldo Projetado, Composicao de Custos por Mes por categoria, Exposicao por Fornecedor 30/60/90d). O card "Posso comprar mais estoque?" e considerado irrelevante por Wesley e sai.
**Depends on**: Phase 49 (tabelas cash_inflows/cash_outflows/financial_settings, RPCs get_cashflow/get_daily_balance/get_projected_balance_summary, CashFlowChart) e Phase 50 (aba Simulador — preservada).
**Dados**: Ja existem em cash_inflows (MP), cash_outflows (Tiny: amount/outflow_date/supplier/category/status) e orders. Os 2 graficos novos usam cash_outflows.category e cash_outflows.supplier (ja preenchidos). Provavel necessidade de 1 RPC nova de agregacao (KPIs de tesouraria + series de composicao/exposicao).
**Success Criteria** (what must be TRUE):

  1. Aba "Caixa Real" exibe 12 KPIs: [Saude] Saldo Atual, Runway (meses), Saldo Minimo projetado (90d), Data do Saldo Minimo, Alerta de saldo abaixo do limite; [Realizado] Entrada Real, Saida Real, Resultado, Burn Rate (D/O medio 3 meses); [Exposicao] Fornec 30d, Fornec 60d, Fornec 90d, Total Exposicao
  2. Card "Posso comprar mais estoque?" (CapacityCard) removido da pagina
  3. Grafico Saldo Projetado mantido (reuso do CashFlowChart existente)
  4. Grafico novo: Composicao de Custos por Mes (barras empilhadas por categoria de cash_outflows.category)
  5. Grafico novo: Exposicao por Fornecedor (barras 30/60/90d por supplier de cash_outflows)
  6. Aba "Simulador" (Phase 50) preservada e intocada
  7. Formulas/janelas de cada KPI travadas na discussao (CONTEXT.md) e implementadas conforme o painel de referencia de Wesley

**Requirements**: TESO-01, TESO-02, TESO-03, TESO-04, TESO-05

**Pontos que exigem aprovacao do Wesley**: checkpoint visual no preview Vercel antes de qualquer merge para main.

**Plans**: 3 plans em 3 waves

Plans:

**Wave 1 — Backend (RPCs + coluna)**

- [x] 51-01-PLAN.md — Migration alert_threshold + 3 RPCs (get_treasury_panel/get_cost_by_month/get_supplier_exposure) SECURITY INVOKER + [BLOCKING] apply via MCP em ckcdevcxgvueywivefgx (TESO-03, TESO-04)

**Wave 2 — Hooks** *(blocked on 51-01)*

- [x] 51-02-PLAN.md — 3 hooks (useTreasuryPanel/useCostByMonth/useSupplierExposure) + useFinancialSettings estendido com alert_threshold (TESO-01, TESO-02, TESO-03)

**Wave 3 — UI + wiring** *(blocked on 51-01 + 51-02)*

- [x] 51-03-PLAN.md — TreasuryPanel (12 KPIs/3 faixas) + CostCompositionChart + SupplierExposureChart + wiring MLFluxoCaixa (remove 3 cards, preserva Simulador) + [checkpoint] visual Wesley (TESO-01, TESO-02, TESO-05)

**UI hint**: yes

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 41. Veracidade Total | 4/4 | Complete    | 2026-06-13 |
| 42. Zero Mock | 4/4 | Complete   | 2026-06-13 |
| 43. Multi-Tenant Hardening | 4/4 | Complete | Isolamento 2-org PASS; pendente verify-phase + checkpoint visual |
| 44. Monetizacao Stripe | 0/? | Not started | - |
| 45. Consultor v1 | 3/3 | Complete   | 2026-06-14 |
| 46. UX para Leigos | 4/5 | In Progress|  |
| 47. QA End-to-End + Go-Live | 0/? | Not started | - |
| 48. MCO com Ads | 3/3 | Complete | 2026-06-14 |
| 49. Fluxo de Caixa (Caixa Real) | 5/5 | Complete   | 2026-06-18 |
| 50. Simulador de Cenarios de Caixa | 0/3 | Not started | - |
| 51. Painel de Tesouraria | 3/3 | Complete   | 2026-06-19 |
