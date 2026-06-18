# Requirements — v7.0 SaaS Operacional End-to-End

## Contexto

Transformar o dashboard (hoje operando para a Pé Vermeio) em SaaS vendável por assinatura em 10 dias.
Diagnóstico completo e decisões de produto em `.planning/MILESTONE-v7-SAAS.md` (sessão 2026-06-12).

Decisões fixadas por Wesley: Stripe | convite controlado | Consultor v1 por regras | integrar perguntas/devoluções de verdade.

---

## Requisitos

### Bloco DATA — Veracidade total dos números

- [x] **DATA-01**: Card "Custos" em /vendas exibe CMV e Impostos não-nulos quando há configuração cadastrada — ✅ executado 2026-06-12 (migration 20260612120000, commit fc090c46; backend validado em produção, confirmação visual pendente)
- [x] **DATA-02**: Filtro "Hoje" em /vendas carrega os KPI cards via auto-recalc silencioso com skeleton — nunca "—" estático (executar plano pronto da Phase 31)
- [x] **DATA-03**: Lucro Bruto mensal calculado de fonte única (useMLCostWaterfall) sem pedidos cancelados (executar plano pronto da Phase 21)
- [x] **DATA-04**: Usuário vê CFFE real ("Frete ML") e linha "Parcelamento (CFONPN)" no breakdown de custos — tabela `ml_billing_monthly` + EF `sync-ml-billing` (ML `/billing/periods`) com indicador de fonte ("billing" vs "estimado")
- [x] **DATA-05**: Comissão em /anuncios vem da API real do ML (sale_fee/listing_prices) por anúncio — fim do `LISTING_TYPE_RATES` hardcoded
- [x] **DATA-06**: KPIs de /vendas, /financeiro e /anuncios batem entre si (mesma fonte) — validados contra referência Nexo Abril/2026 (comissão R$39,2k, CFFE R$40k, CFONPN R$15,9k)

### Bloco MOCK — Zero dados simulados

- [x] **MOCK-01**: /perguntas lista perguntas reais do ML (tabela `ml_questions` + EF de sync via ML Questions API)
- [x] **MOCK-02**: Usuário responde pergunta do comprador direto pela UI de /perguntas (POST answer na API ML)
- [x] **MOCK-03**: /devolucoes lista reclamações e devoluções reais (tabela `ml_claims` + EF de sync via ML Claims API)
- [x] **MOCK-04**: /reputacao exibe feedback real da API ML — remoção de todos os `getMock*`
- [x] **MOCK-05**: /tv lê sellers da tabela `sellers` filtrada por `organization_id` (sem UUIDs hardcoded em TVModeVendas.tsx)

### Bloco TENANT — Multi-tenant hardening

- [x] **TENANT-01**: RLS de `ml_product_costs` org-first — upserts via service role funcionam para qualquer org, sem dependência de `user_id = auth.uid()`
- [x] **TENANT-02**: Dados órfãos (`organization_id` NULL) backfillados ou removidos em todas as tabelas de cache
- [x] **TENANT-03**: Sync consulta quota por `plan_tier` (`check_quota` RPC em dispatch/process) e bloqueia excedente
- [x] **TENANT-04**: Owner novo passa por wizard de onboarding guiado (Conectar ML → Tiny opcional → Custos → Fiscal → Pronto) com progresso persistido e CTA no dashboard vazio
- [x] **TENANT-05**: Teste de isolamento: 2 orgs em paralelo sem vazamento (RLS + caches + queries)

### Bloco PAY — Monetização (Stripe)

- [ ] **PAY-01**: Owner assina plano via Stripe Checkout (tiers de `organization_plans`, trial configurável)
- [ ] **PAY-02**: Webhooks Stripe atualizam assinatura/tier (`checkout.session.completed`, `invoice.paid`, `customer.subscription.updated/deleted`) em tabelas `subscriptions`/`billing_events`
- [ ] **PAY-03**: Página /planos mostra plano atual, estado de pagamento e permite upgrade/downgrade via Stripe Customer Portal
- [ ] **PAY-04**: Limites do tier aplicados de verdade (`history_days`, `sync_interval_minutes`)

### Bloco CONSUL — Consultor v1 (motor de regras)

- [x] **CONSUL-01**: Engine de insights roda por org (EF + cron) avaliando ~12 regras e gravando em tabela `insights` (severidade, categoria, ação recomendada, impacto estimado em R$)
- [x] **CONSUL-02**: Card "O que fazer agora" no topo de /vendas com os top insights acionáveis
- [x] **CONSUL-03**: Painel de insights com explicação leiga por insight ("por que isso importa", "como resolver")
- [x] **CONSUL-04**: Score de saúde do negócio (0-100) composto por margem, ads, estoque, reputação e completude de configuração
- [x] **CONSUL-05**: Org Pé Vermeio gera ≥5 insights reais e acionáveis no primeiro run

Regras iniciais candidatas: margem < alvo por produto; ROAS/ACoS fora da meta; TACoS subindo; ruptura/cobertura crítica; produto sem custo cadastrado; sem regime fiscal; ticket médio caindo; cancelamentos acima da média; anúncio pausado com histórico de venda; campanha gastando sem venda; meta do mês em risco (projeção); pergunta sem resposta > 24h.

### Bloco UX — Compreensível para lojista leigo

- [x] **UX-01**: Todo KPI tem tooltip/glossário em linguagem leiga (ex.: "CFFE = o frete que o ML te cobra")
- [x] **UX-02**: Toda página tem empty state que orienta ação ("o que fazer para ter dados aqui")
- [ ] **UX-03**: Tabelas de /anuncios, /pedidos e /financeiro sem overflow quebrado em mobile
- [x] **UX-04**: Consistência visual revisada (tokens kpi.positive/negative, espaçamentos, dark mode) nas páginas principais

### Bloco MCO com Ads (Phase 48)

- [x] **MCO-01**: Fonte por produto de ads_spend/attributed_revenue por janela (RPC junta margem + ads por item_id sem truncamento PostgREST). Atribuição direta via `ml_ads_products_cache`
- [ ] **MCO-02**: Margem por produto exibe margem operacional (sem ads) E margem pós-ads lado a lado
- [ ] **MCO-03**: MCO agregado da operação (Σ margem de contribuição − ads total) visível
- [x] **MCO-04**: Alerta separado por produto "ads comendo a margem" (TACoS/ACoS acima do limiar), independente do alerta de prejuízo operacional
- [x] **MCO-05**: (a confirmar no plano) ads_no_sale por produto — gasto de ads com zero venda no item

Decisão travada (Wesley 2026-06-14): modelo de 2 números (operacional + pós-ads), não 1 número combinado. "Prejuízo" fica na operacional.

### Bloco CASH — Fluxo de Caixa (Caixa Real) (Phase 49)

- [x] **CASH-01**: Ingestão de caixa REAL multi-tenant — entradas = liberações do Mercado Pago (nova EF + tabela, padrão das EFs `sync-*`), escopada por `organization_id` com RLS
- [x] **CASH-02**: Saídas de caixa — despesas / ordens de compra em tabela própria, escopada por `organization_id` com RLS (fonte inicial a definir no plano: OC Tiny e/ou lançamento)
- [ ] **CASH-03**: RPC de fluxo de caixa `SECURITY INVOKER` retorna saldo diário acumulado real + projeção (SMA de vendas dos últimos 15d × (1 − custo operacional), ativa após dia 8), sem truncamento PostgREST, boundary de data timestamptz correto (`.lt` nextDay)
- [x] **CASH-04**: Nova página `/fluxo-de-caixa` sob grupo de menu "Operações" no shell, com guard de rota e isolamento por org; gráfico "Como meu dinheiro vai evoluir?" (ComposedChart, linha real + linha projetada, alerta de saldo negativo)
- [x] **CASH-05**: 3 cards com dado real — Caixa Hoje, Projeção Futura (pessimista/realista + data crítica), Capacidade de Compra ("posso comprar mais estoque?" = saldo projetado − margem de segurança)
- [x] **CASH-06**: Parâmetros por org configuráveis (`financial_settings`): saldo inicial, taxa de custo operacional, margem de segurança

Decisão travada (Wesley 2026-06-18): fonte = caixa REAL (liberações MP + despesas), não derivado de vendas; nova página em "Operações" (não mexer no /financeiro de competência); MVP = gráfico + 3 cards. Portado do nexointeligence.

### Bloco QA — Go-live

- [ ] **QA-01**: Tenant novo via convite chega a dashboard com dados reais sem nenhum passo manual de super-admin além de criar org+convite
- [ ] **QA-02**: Auditoria de segurança limpa — Supabase advisors sem erro crítico, RLS em todas as tabelas de dados, verify_jwt correto nas EFs
- [ ] **QA-03**: `tsc --noEmit` + `npm run build` + smoke de deploy Vercel limpos

---

## Future Requirements (deferidas para v8+)

- Self-service signup público com proteção anti-abuso (decisão: lançamento por convite)
- Consultor com análises geradas por LLM (v1 é determinístico)
- Phases 28/29 (performance N+1, RPCs de agregação) — entram no dia 10 SOMENTE se QA mostrar lentidão real
- Phase 23 (dashboard granular — coluna Margem % em Top Anúncios, dual-axis)
- DIFAL, CSHIA e cobranças menores do billing
- Landing page pública de marketing/pricing

## Out of Scope

- NCM/CFOP por produto, geração de guias/SPED — plataforma é analytics, não fiscal
- Múltiplos marketplaces além do ML — foco total no ML neste milestone
- App mobile nativo — web responsivo cobre
- Proration custom no Stripe — usar comportamento padrão do Customer Portal

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| DATA-01 | Phase 41 | Complete |
| DATA-02 | Phase 41 | Complete |
| DATA-03 | Phase 41 | Complete |
| DATA-04 | Phase 41 | Complete |
| DATA-05 | Phase 41 | Complete |
| DATA-06 | Phase 41 | Complete |
| MOCK-01 | Phase 42 | Complete |
| MOCK-02 | Phase 42 | Complete |
| MOCK-03 | Phase 42 | Complete |
| MOCK-04 | Phase 42 | Complete |
| MOCK-05 | Phase 42 | Complete |
| TENANT-01 | Phase 43 | Complete |
| TENANT-02 | Phase 43 | Complete |
| TENANT-03 | Phase 43 | Complete |
| TENANT-04 | Phase 43 | Complete |
| TENANT-05 | Phase 43 | Complete |
| PAY-01 | Phase 44 | Pending |
| PAY-02 | Phase 44 | Pending |
| PAY-03 | Phase 44 | Pending |
| PAY-04 | Phase 44 | Pending |
| CONSUL-01 | Phase 45 | Complete |
| CONSUL-02 | Phase 45 | Complete |
| CONSUL-03 | Phase 45 | Complete |
| CONSUL-04 | Phase 45 | Complete |
| CONSUL-05 | Phase 45 | Complete |
| UX-01 | Phase 46 | Complete |
| UX-02 | Phase 46 | Complete |
| UX-03 | Phase 46 | Pending |
| UX-04 | Phase 46 | Complete |
| QA-01 | Phase 47 | Pending |
| QA-02 | Phase 47 | Pending |
| QA-03 | Phase 47 | Pending |
| MCO-01 | Phase 48 | Complete |
| MCO-02 | Phase 48 | Pending |
| MCO-03 | Phase 48 | Pending |
| MCO-04 | Phase 48 | Complete |
| MCO-05 | Phase 48 | Complete |
| CASH-01 | Phase 49 | Complete |
| CASH-02 | Phase 49 | Complete |
| CASH-03 | Phase 49 | Pending |
| CASH-04 | Phase 49 | Complete |
| CASH-05 | Phase 49 | Complete |
| CASH-06 | Phase 49 | Complete |

---
*Criado: 2026-06-12 — milestone v7.0*
