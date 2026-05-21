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

## Progress

| Phase | Goal | Status | Plans |
|-------|------|--------|-------|
| 14 — ml_orders | KPIs comissão/frete/ticket reais | ⬜ Pendente | TBD |
| 15 — ml_billing_monthly | CFFE + CFONPN visíveis | ⬜ Pendente | TBD |
