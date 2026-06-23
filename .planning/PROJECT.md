# Garment Glow — Plataforma de Gestão ML

## Current Milestone: v8.0 Consultor v2 (Inteligência)

**Goal:** Evoluir o Consultor v1 (motor determinístico de ~12 regras + score de saúde, já em prod) para uma camada de inteligência com LLM + ações acionáveis — de "alertas por regra" para "consultor que explica, prioriza e ajuda a agir".

**Decisões de produto (Wesley, 2026-06-23):**
- **Ação em 1 clique = preparar para aprovação** — o insight gera uma "ação proposta" que entra numa fila; Wesley aprova e só então executa via MCP/EF. Respeita a regra de plataforma "ações que alteram o ML exigem aprovação".
- **LLM sob demanda + cache** — análise gerada quando o lojista abre o painel / clica "explicar", resultado cacheado por org/dia. Controla custo de API. Modelo Claude (Haiku barato / Sonnet profundidade — definir na pesquisa).
- **Score/insights por loja ML** — v1 consolida tudo por org; v2 permite drill-down por loja mantendo a visão consolidada de COO.
- **Limiares editáveis na UI** — tirar a config do consultor do SQL e levar para a tela do lojista.

**Target features (âncora = Deferred Ideas da Phase 45):**
- Análises geradas por LLM por org — interpretação em linguagem natural sobre os insights determinísticos (o "porquê" e o "como" contextualizados)
- Ação em 1 clique a partir do insight — fila de ação proposta → aprovação → execução
- Snooze/adiar insight — "lembrar depois" (estado persistido por insight/org)
- UI para o lojista editar os limiares do consultor
- Score/insights separados por loja ML (drill-down) além do consolidado por org

**Base herdada do v1 (Phase 45, em prod):** motor de ~12 regras determinístico, tabela `insights`, score 0-100 (5 pilares: Margem 30 / Ads 25 / Estoque 20 / Reputação 15 / Completude 10), card "O que fazer agora" (Top 3), painel de insights, deep-links, cron diário + on-demand. `consultor_config` por org (editável só via SQL hoje).

---

## Previous Milestone: v7.0 SaaS Operacional End-to-End

**Goal:** Sistema 100% operacional e vendável como assinatura em 10 dias — dados verdadeiros em todas as páginas (zero mock), multi-tenant endurecido, monetização via Stripe ativa, onboarding guiado para lojista leigo, e Consultor v1 (motor de regras + score de saúde) como diferencial de venda.

**Resultado:** Concluído 10/11 (91%) em 2026-06-20. Phases 41-43, 45-51 entregues e em prod. Phase 44 (Stripe) adiada por decisão (Wesley não organiza assinatura nesta versão de testes). Phase 47 (QA/Go-Live) fechada em escopo técnico sem Stripe.

**Decisões de produto (Wesley, 2026-06-12):**
- Gateway de pagamento: **Stripe** (checkout + webhook + customer portal)
- Lançamento por **convite controlado** (self-service signup fica para v2)
- Consultor v1 = **motor de regras determinístico** (~12 regras + score 0-100), sem LLM por usuário
- /perguntas e /devolucoes: **integração real** (ML Questions API + Claims API)

**Target features:**
- Bloco A — Veracidade total: Phases 32+31+21 executadas, billing CFFE/CFONPN (ex-Phase 15), comissão real por anúncio (fim do LISTING_TYPE_RATES)
- Bloco B — Zero mock: /perguntas, /devolucoes e feedback de /reputacao com APIs reais; /tv lendo sellers do DB
- Bloco C — Multi-tenant hardening: RLS org-first em ml_product_costs, backfill órfãos, enforcement de quota, wizard de onboarding guiado
- Bloco D — Monetização: Stripe checkout + webhooks + UI /planos + enforcement por tier
- Bloco E — Consultor v1: engine de insights por regras + cards "O que fazer agora" + score de saúde
- Bloco F — UX para leigos: glossário/tooltips em todo KPI, empty states acionáveis, mobile polish
- Bloco G — QA end-to-end: simulação tenant novo do zero + auditoria de segurança + go-live

**Spec completa:** `.planning/MILESTONE-v7-SAAS.md`

---

## Previous Milestone: v6.0 Dashboard de Vendas — KPIs de Marca

**Goal:** KPIs e gráficos por marca (markup, custo operacional, faturamento por marca) com dados reais.

**Resultado:** Concluído 2026-06-04 (Phases 16, 34-40). Brand charts funcionando com fallback de cache, pipeline de sync de orders corrigido, ads spend real.

---

## Previous Milestone: v5.0 Dashboard de Vendas — KPIs Reais

**Goal:** O dashboard de Vendas exibe KPIs financeiros corretos — comissão e frete reais calculados de orders individuais, CFONPN visível, ticket médio sem cancelados, e billing mensal integrado com CFFE real.

**Context técnico:**
- Hoje `ml_daily_cache` armazena apenas dados agregados por dia — impossível calcular comissão real, filtrar por SKU/estado, ou corrigir ticket médio
- Nexo MCP Supabase (`muesqdxnjlbaoiqylpjn`) tem `orders` (68k rows) com `comissao` e `frete` por pedido + `billing_monthly` com CFFE, CFONPN, bonificações
- Abordagem: adicionar `ml_orders` (orders individuais) + `ml_billing_monthly` ao garment-glow, alimentados pelo sync existente

**Target features:**
- Tabela `ml_orders` com orders individuais + `mercado-libre-integration` atualizado para salvar rows individuais
- costSummary usa comissão real (sum orders.comissao) e frete real (sum orders.frete) em vez de hardcoded 11%/5%
- Ticket médio correto: approved_revenue / pedidos pagos (sem cancelados)
- Tabela `ml_billing_monthly` + edge function `sync-ml-billing` + CFFE e CFONPN visíveis no dashboard
- Waterfall financeiro: receita → comissão → frete (CFFE) → parcelamento (CFONPN) → publicidade → líquido

---

## Previous Milestone: v4.0 ML Pé Vermeio — Integração Completa

**Goal:** Conectar a conta Pé Vermeio do Mercado Livre ao ambiente dev — OAuth funcionando, sync de vendas no dashboard, ads e estoque visíveis. Ambiente utilizável como dashboard real E isolado para desenvolvimento seguro.

**Resultado:** Concluído 2026-05-21. OAuth, sync de vendas, ads e estoque todos funcionando com dados reais da Pé Vermeio.

---

## Previous Milestone: v3.0 Sync Engine & Arquitetura DB-First

**Goal:** Eliminar todas as consultas diretas à API do ML durante a navegação — sync automático agendado via pg_cron abastece o banco, front-end lê apenas do DB, preparando a base para controle de planos e quotas por assinatura.

**Target features:**
- Tabela `sync_jobs` com fila de jobs, controle de status e retry automático
- pg_cron: sync automático diário de vendas (daily cache) e pedidos (orders)
- `ml_inventory_cache`: tabela + edge function de sync; Estoque e Anúncios leem do banco
- Remoção de live API calls do `MLInventoryContext` — sem invoke em cada navegação
- Infraestrutura de planos (tabelas sem UI): `organization_plans` + `sync_quota_daily`

---

# Módulo Fiscal — Tributação por Regime (v1.0)

## What This Is

Módulo de configuração tributária para a plataforma de gestão de vendedores do Mercado Livre. Permite que cada organização configure o regime tributário de cada loja ML (Simples Nacional, Lucro Presumido ou Lucro Real), e usa essa configuração para calcular automaticamente o valor e percentual de impostos exibidos na coluna Impostos do Catálogo de Anúncios.

## Core Value

Cada loja ML tem seu regime tributário configurado, e o imposto sobre cada anúncio é calculado corretamente — sem digitação manual por produto.

## Requirements

### Validated

- ✓ Plataforma multi-tenant com organizations e roles (owner/admin/member/viewer) — existing
- ✓ Roteamento protegido por role via `RoleRoute` — existing
- ✓ Coluna Impostos em Catálogo de Anúncios (`MLProdutos`) com % editável por produto — existing
- ✓ Tabela `ml_tokens` por loja ML com `ml_user_id` e `organization_id` — existing
- ✓ Supabase (PostgreSQL + Auth + Edge Functions) — existing

### Active

- [ ] Aba "Fiscal" em Minha Conta acessível somente a owners
- [ ] Seleção de regime tributário por loja ML (Simples Nacional, Lucro Presumido, Lucro Real)
- [ ] Formulário Simples Nacional: alíquota efetiva (%) — campo único
- [ ] Formulário Lucro Presumido: PIS (%), COFINS (%), IRPJ (%), CSLL (%) — alíquota efetiva resultante = soma
- [ ] Formulário Lucro Real: créditos e débitos de ICMS, PIS e COFINS — alíquota efetiva = (débitos − créditos) / base de cálculo
- [ ] Persistência das configurações por loja ML no banco de dados (tabela `ml_tax_config`)
- [ ] Coluna Impostos em Catálogo de Anúncios exibe valor em R$ e % calculados a partir do regime configurado (base = preço de venda)
- [ ] Fallback para valor manual quando loja não tem regime configurado

### Out of Scope

- NCM / CFOP por produto — complexidade elevada, não necessário para v1
- Cálculo de ICMS por estado de destino (diferencial de alíquota) — fora do v1
- Geração de guias ou SPED fiscal — plataforma é analytics, não fiscal
- Regime por produto individual — configuração é sempre por loja ML
- Múltiplos regimes por organização num mesmo período — uma loja = um regime ativo

## Context

A plataforma é um SPA React 18 + TypeScript com Supabase como backend. A tela de Catálogo de Anúncios (`src/pages/mercadolivre/MLProdutos.tsx`) já tem uma coluna Impostos com % editável inline por produto via `ml_product_costs`. O novo módulo substituirá (ou complementará) essa entrada manual com valores derivados do regime tributário da loja.

O menu de Minha Conta já inclui `/organizacao` (owner/admin) e `/integracoes` (owner only). A nova rota `/fiscal` seguirá o mesmo padrão: `owner only`.

A tabela `ml_tokens` relaciona loja ML → organização. A nova tabela `ml_tax_config` relacionará loja ML → configuração tributária, com os campos variando por regime.

**Convenções do codebase:**
- Páginas em `src/pages/mercadolivre/`
- Rota nova em `src/App.tsx` com `RoleRoute`
- Supabase migration para nova tabela
- Edge function ou query direta via `supabase-js` para leitura

## Constraints

- **Role**: Configuração restrita a `owner` — usar `RoleRoute` existente ou verificação inline
- **Scope**: Configuração é por `ml_user_id` (loja ML), não por organização inteira
- **Cálculo**: Imposto sempre sobre preço de venda (receita bruta), não sobre margem
- **Stack**: React + TypeScript + shadcn/ui + Supabase — sem novas dependências de cálculo fiscal externas
- **Display**: Coluna Impostos mostra `R$ X,XX (Y,Y%)` — ambos

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Configuração por loja ML, não por organização | Empresas podem ter contas ML em regimes diferentes | — Pending |
| Alíquota efetiva como denominador comum | Lucro Real e Presumido têm múltiplos tributos — reduzir a % efetivo simplifica o cálculo na coluna | — Pending |
| Nova tabela `ml_tax_config` | Não poluir `ml_tokens` com dados fiscais; schema separado e versionável | — Pending |
| Owner only para configuração fiscal | Dado sensível e consequente — não delegar a membros comuns | — Pending |

---
*Last updated: 2026-06-23 — início do milestone v8.0 Consultor v2 (Inteligência)*

## Evolution

Este documento evolui a cada transição de fase e milestone.

**Após cada transição de fase** (via `/gsd-transition`):
1. Requirements invalidados? → Mover para Out of Scope com motivo
2. Requirements validados? → Mover para Validated com referência de fase
3. Novos requirements emergiram? → Adicionar em Active
4. Decisões a registrar? → Adicionar em Key Decisions
5. "What This Is" ainda preciso? → Atualizar se derivou

**Após cada milestone** (via `/gsd-complete-milestone`):
1. Revisão completa de todas as seções
2. Core Value ainda é a prioridade certa?
3. Auditar Out of Scope — motivos ainda válidos?
4. Atualizar Context com estado atual
