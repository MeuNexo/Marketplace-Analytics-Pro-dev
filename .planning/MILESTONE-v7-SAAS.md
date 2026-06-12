# Milestone v7.0 — SaaS Operacional End-to-End (10 dias)

**Criado:** 2026-06-12 — sessão de revisão completa com Wesley
**Objetivo:** Sistema 100% operacional e vendável como assinatura — dados verdadeiros em todas as páginas, multi-tenant pronto, monetização ativa, UX compreensível para lojista leigo, e Consultor v1 como diferencial.
**Prazo:** 10 dias corridos, múltiplas sessões.

## Decisões de produto (Wesley, 2026-06-12)

| Decisão | Escolha |
|---------|---------|
| Gateway de pagamento | **Stripe** (checkout pronto, Pix + cartão, assinaturas recorrentes) |
| Entrada de clientes no lançamento | **Convite controlado** (fluxo atual super-admin + convite; self-service fica para v2) |
| Consultor v1 | **Sim, motor de regras determinístico** (sem LLM por usuário; ~10-15 regras + score de saúde) |
| /perguntas e /devolucoes | **Integrar de verdade** (ML Questions API + Claims API; portar padrão do Nexo MCP) |

## Diagnóstico de partida (2026-06-12)

- ✅ Sólido: /vendas, /estoque, /pedidos, /publicidade, /financeiro, /metas, /precificacao, /fiscal (existe e está no menu), /relatorios, painel super-admin, fila de sync multi-org (sync_jobs + pg_cron descobre tenants novos via ml_tokens)
- ❌ Mock 100%: /perguntas, /devolucoes. Parcial: /reputacao (feedback + response time), comissão hardcoded em /anuncios (LISTING_TYPE_RATES), /tv com 2 sellers UUID hardcoded (TVModeVendas.tsx:16-18)
- 📋 Phases planejadas não executadas: 21 (lucro cache), 23 (dashboard granular), 26/27 (ads — parcialmente resolvidas via Phase 39), 28/29 (performance), 31 (auto-recalc Hoje), 32 (CMV/impostos nulos)
- ⏸ Phase 15 (billing CFFE/CFONPN) adiada — R$56k/mês de custos invisíveis
- 🔓 SaaS: sem pagamento, sem enforcement de quota (sync_quota_daily nunca consultada), RLS ml_product_costs híbrida user_id/org_id, dados órfãos organization_id NULL, sem UI de planos, sem onboarding guiado
- Auditoria multi-tenant: 5.5/10

## Fases propostas (mapear no /gsd-new-milestone)

### Dias 1–2 — Bloco A: Veracidade total dos números
- A1. Executar Phase 32 (migration receita_bruta fallback + backfill → CMV/Impostos no card Custos)
- A2. Executar Phase 31 (useAutoRecalc silencioso para "Hoje" + skeleton)
- A3. Executar Phase 21 (Lucro Bruto mensal sem cancelados — fonte única useMLCostWaterfall)
- A4. Phase 15 ml_billing_monthly: EF sync-ml-billing (ML /billing/periods) + CFFE real + linha CFONPN + indicador de fonte ("billing" vs "estimado")
- A5. Comissão real por anúncio em /anuncios (ML API sale_fee/listing_prices em vez de LISTING_TYPE_RATES)
- Critério: KPIs de /vendas, /financeiro e /anuncios batem entre si e com o Nexo (referência Abril/2026: comissão R$39,2k, CFFE R$40k, CFONPN R$15,9k)

### Dia 3 — Bloco B: Matar os mocks
- B1. /perguntas real: tabela ml_questions + EF sync-ml-questions (ML Questions API) + responder pergunta da UI (POST answer)
- B2. /devolucoes real: tabela ml_claims + EF sync-ml-claims (ML Claims API)
- B3. /reputacao: feedback real (ML feedback API), remover mocks de response time
- B4. /tv lendo sellers da tabela sellers filtrada por organization_id
- Critério: zero badge "dados simulados" no produto inteiro

### Dias 4–5 — Bloco C: Multi-tenant hardening
- C1. RLS ml_product_costs: política org-first (INSERT via service role org-scoped), remover dependência user_id-only
- C2. Backfill de dados órfãos (organization_id NULL) em todas as caches
- C3. Enforcement de quota: check_quota RPC consultada em dispatch_sync_jobs/process-sync-job por plan_tier
- C4. Wizard de onboarding guiado pós-convite: passos Conectar ML → (opcional Tiny) → Custos → Fiscal → Pronto, com progresso persistido e CTA no dashboard vazio
- C5. Teste de isolamento: 2 orgs em paralelo sem vazamento (queries + RLS + caches)
- Critério: tenant novo entra por convite e chega a dashboard com dados reais sem nenhum passo manual de super-admin além de criar org+convite

### Dia 6 — Bloco D: Monetização (Stripe)
- D1. Tabelas subscriptions/billing_events + webhook EF (checkout.session.completed, invoice.paid, customer.subscription.updated/deleted)
- D2. Stripe Checkout para os tiers existentes (free/starter/pro/enterprise de organization_plans), trial configurável
- D3. UI /planos: plano atual, upgrade/downgrade (Stripe Customer Portal), estado de inadimplência
- D4. Enforcement por tier: history_days e sync_interval_minutes aplicados de verdade
- Critério: assinar plano com cartão de teste → org muda de tier → quota/história refletem

### Dias 7–8 — Bloco E: Consultor v1 (motor de regras)
- E1. Engine: EF/cron consultor-insights que avalia regras por org e grava em tabela insights (severidade, categoria, ação recomendada, valor estimado de impacto)
- E2. Regras iniciais (~12): margem < X% por produto; ROAS/ACoS fora da meta; TACoS subindo; ruptura/cobertura crítica de estoque; produto sem custo cadastrado; sem regime fiscal configurado; ticket médio caindo vs período anterior; pedidos cancelados acima da média; anúncio pausado com histórico de venda; campanha sem venda gastando; meta do mês em risco (projeção); pergunta sem resposta > 24h
- E3. UI: card "O que fazer agora" no topo de /vendas + página/painel de insights com explicação leiga ("por que isso importa", "como resolver")
- E4. Score de saúde do negócio (0-100) composto por margem, ads, estoque, reputação, configuração
- Critério: org da Pé Vermeio gera ≥5 insights reais e acionáveis no primeiro run

### Dia 9 — Bloco F: UX para leigos + polish
- F1. Tooltip/glossário em todo KPI (linguagem leiga, sem jargão: "CFFE = o frete que o ML te cobra")
- F2. Empty states orientados a ação em todas as páginas (o que fazer para ter dados aqui)
- F3. Mobile: tabelas com overflow corrigido (/anuncios, /pedidos, /financeiro), gráficos responsivos
- F4. Revisão visual completa (consistência de cores kpi.positive/negative, espaçamentos, dark mode)

### Dia 10 — Bloco G: QA end-to-end + go-live
- G1. Simulação tenant novo do zero: convite → onboarding → OAuth ML → sync → dados reais → assinar plano → insights
- G2. Auditoria de segurança: Supabase advisors + RLS em todas as tabelas de dados + verify_jwt nas EFs
- G3. Carga: 2+ contas ML simultâneas, sync sem N+1 crítico (avaliar se Phase 28/29 precisa entrar aqui)
- G4. Smoke final + tsc + build + deploy Vercel

## Riscos conhecidos
- ML Claims/Questions API: rate limits e formatos — mitigar portando lógica já validada do Nexo MCP (/root/nexo-mcp/)
- Stripe em 1 dia é apertado — escopo mínimo: checkout + webhook + portal (sem proration custom)
- Phases 28/29 (performance) ficam condicionais — só entram no dia 10 se QA mostrar lentidão real
- Supabase project do garment-glow: **ckcdevcxgvueywivefgx** (CLAUDE.md menciona gionpsuunfkkzzjdubfy — desatualizado, confirmar antes de migrations)

## Próximo passo
Rodar `/gsd-new-milestone` usando este documento como insumo para gerar ROADMAP/REQUIREMENTS formais do v7.0, então `/gsd-plan-phase` bloco a bloco.
