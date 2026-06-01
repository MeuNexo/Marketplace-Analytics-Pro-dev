# Roadmap — v5.0 Dashboard de Vendas — KPIs Reais

## Overview

Dois pilares transformam o dashboard de Vendas de estimativas hardcoded para dados reais:
orders individuais (Phase 14) expõem comissão, frete e ticket médio corretos por pedido;
billing mensal (Phase 15) traz CFFE real e CFONPN — custos hoje invisíveis que somam R$56k/mês.

## Phases

- [ ] **Phase 14: ml_orders — Orders Individuais** — Tabela + sync + KPIs de comissão/frete/ticket médio corretos
- [ ] **Phase 15: ml_billing_monthly — Billing Integration** — CFFE real, CFONPN, waterfall financeiro

---

## Phase Details

### Phase 14: ml_orders — Orders Individuais
**Goal**: Dashboard de Vendas exibe comissão real, frete real e ticket médio correto — calculados de orders individuais, não de percentuais hardcoded
**Mode:** mvp
**Depends on**: Nothing (infrastructure phase)
**Requirements**: ORDERS-01, ORDERS-02, ORDERS-03, ORDERS-04, KPIS-01, KPIS-02, KPIS-03, KPIS-04
**Success Criteria** (what must be TRUE):
  1. Tabela `ml_orders` existe e RLS restringe por `organization_id`
  2. Após executar sync (`mercado-libre-integration`) para qualquer período, rows aparecem em `ml_orders` com `comissao` e `frete` preenchidos (não nulos)
  3. O dashboard de Vendas mostra comissão e frete calculados de `SUM(ml_orders.comissao)` e `SUM(ml_orders.frete)` — não mais os valores derivados de 11% e 5% hardcoded
  4. Ticket médio = `approved_revenue / COUNT(orders WHERE status='paid')` — cancela os orders cancelados do divisor
  5. KPIs de visitas e conversão não regridem (mesmos valores de antes)
**Plans**: TBD

---

### Phase 15: ml_billing_monthly — Billing Integration
**Goal**: Dashboard exibe CFFE real e CFONPN — os dois maiores custos invisíveis hoje (R$40k + R$15,9k/mês em Abril/2026)
**Mode:** mvp
**Depends on**: Nothing (independent of Phase 14, podem rodar em paralelo)
**Requirements**: BILLING-01, BILLING-02, BILLING-03, BILLING-04, BILLING-05, BILLING-06
**Success Criteria** (what must be TRUE):
  1. Tabela `ml_billing_monthly` existe e tem registro para o mês corrente após sync
  2. Edge function `sync-ml-billing` invocada manualmente retorna HTTP 200 e salva CFFE + CFONPN em `ml_billing_monthly`
  3. O dashboard de Vendas exibe linha "Frete ML" com valor real de CFFE (não 5% da receita)
  4. O dashboard de Vendas exibe linha "Parcelamento" com valor de CFONPN — onde hoje não existe nenhuma linha
  5. Waterfall financeiro (Receita → Comissão → Frete → CFONPN → Publicidade → Líquido) é visível no breakdown de custos
**Plans**: TBD

---

---

### Phase 28: Performance & Escalabilidade Multi-Conta
**Goal**: Sistema responsivo com múltiplas contas ML — eliminar N+1 no sync, mover agregações para o Postgres, fixar dual-scope query
**Mode:** mvp
**Depends on**: Nothing
**Success Criteria** (what must be TRUE):
  1. `sync-ml-orders` executa 1 RPC batch por lote, não 1 RPC por pedido
  2. `/financeiro` não faz mais SELECT * de orders no browser — usa RPCs de agregação Postgres
  3. `/anuncios` executa 1 query por paginação, não 2
  4. Indexes `(status, data_pedido)` e `(ml_user_id, data_pedido)` existem em `orders`
  5. `npx tsc --noEmit` e `npm run build` sem erros
**Plans**: 28-01 (batch upsert), 28-02 (RPCs agregação), 28-03 (dual-scope + indexes + limits)

---

---

### Phase 30: fix-pedidos-lucro-bruto
**Goal**: Lucro Bruto em `/vendas` calculado com fonte consistente; página `/pedidos` carrega pedidos corretamente
**Mode:** bugfix
**Depends on**: Nothing
**Success Criteria** (what must be TRUE):
  1. `useMLCostWaterfall` retorna `null` quando `paid_revenue = 0` — evita mistura de `ml_daily_cache` + `orders` no MLCostCard
  2. Página `/pedidos` exibe pedidos após sync manual para qualquer período com dados
  3. Edge functions `sync-ml-orders` e `process-sync-job` deployadas com fixes do commit `9ba8d630`
  4. `data_pedido` armazenado em BRT (UTC-3) OU query compensada com `dateTo + 1 dia`
  5. Lucro Bruto no card bate com cálculo manual: Receita Paga − (Comissão + Frete + Publicidade + CMV + Impostos)
**Plans**: 30-01 (diagnóstico + 4 fixes + deploy)

---

---

### Phase 32: fix-lucro-bruto-cmv-impostos
**Goal**: CMV e Impostos corretamente descontados no Lucro Bruto do card "Custos" em /vendas
**Mode:** bugfix
**Depends on**: Nothing
**Success Criteria** (what must be TRUE):
  1. Card "Custos" exibe CMV e Impostos com valores não-nulos quando há configuração cadastrada
  2. `get_cost_waterfall` RPC retorna `paid_revenue > 0` quando há orders no período
  3. Lucro Bruto = Receita Paga − Comissão − Frete − Publicidade − CMV − Impostos
  4. `batch_upsert_orders` preserva `receita_bruta` e `receita_liquida` existentes em re-sync
  5. Orders históricos com `preco_unit` preenchido têm `receita_bruta` populado após backfill
**Plans**: 32-01 (migration + backfill)

---

## Progress

| Phase | Goal | Status | Plans |
|-------|------|--------|-------|
| 14 — ml_orders | KPIs comissão/frete/ticket reais | ✅ Concluído | — |
| 15 — ml_billing_monthly | CFFE + CFONPN visíveis | ⏸ Adiado | — |
| 16 — kpis-marca | KPIs e gráficos por marca | ⬜ Pendente | 3 planos prontos |
| 28 — performance-scalability | Sistema responsivo multi-conta | ⬜ Pendente | 28-01, 28-02, 28-03 |
| 30 — fix-pedidos-lucro-bruto | Lucro Bruto + Pedidos corrigidos | 🔧 Em progresso | 30-01 |
| 31 — auto-sync-cmv-impostos | Auto-recalc CMV/impostos + /pedidos real-time | ⬜ Pendente | 31-01 |
| 32 — fix-lucro-bruto-cmv-impostos | CMV e Impostos no Lucro Bruto (DB fix) | 🔧 Em progresso | 32-01 |
