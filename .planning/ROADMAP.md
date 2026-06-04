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

### Phase 34: fix-kpi-summary-hoje
**Goal**: Cards Markup das Vendas, Custo Operacional e Impostos exibem valores reais ao filtrar "Hoje" em /vendas
**Mode:** bugfix
**Depends on**: Nothing
**Success Criteria** (what must be TRUE):
  1. Após auto-sync (~12-15s), os 3 cards do `kpiSummary` atualizam com valores reais (não "—")
  2. Durante o auto-recalc, os 3 cards mostram skeleton loading — não "—" estático
  3. `useAutoRecalc` invalida `["ml", "kpi-summary"]` além de `["ml", "cost-waterfall"]`
  4. Para períodos históricos (7d, 30d), comportamento não muda
  5. `npx tsc --noEmit` sem erros
**Plans**: 34-01 (fix useAutoRecalc + useMLKPISummary + MercadoLivre.tsx)

---

### Phase 35: fix-brand-charts-hoje
**Goal**: Gráficos de marca e cards KPI carregam corretamente para o filtro "Hoje" — marca null não esvazia os charts, e auto-sync tem retry visível
**Mode:** bugfix
**Depends on**: Nothing
**Success Criteria** (what must be TRUE):
  1. Gráficos de marca (Faturamento por Marca, Markup por Marca) exibem dados para "Hoje" mesmo quando `marca = null` em alguns orders — agrupados em "Sem Marca" ou pela categoria disponível
  2. `useAutoRecalc` loga erros visíveis (toast ou console.error) quando `sync-ml-orders` retorna erro
  3. Ao terminar o auto-sync, `useMLOrdersByBrand` retorna `hasData = true` se há orders no período — independente de `marca`
  4. Cards Markup das Vendas, Custo Operacional e Impostos carregam após auto-sync (~15s) para "Hoje"
  5. `npx tsc --noEmit` sem erros
**Plans**: TBD

---

### Phase 36: fix-brand-from-product-cache
**Goal**: Brand charts carregam para "Hoje" usando `ml_product_daily_cache` como fallback quando `orders` está vazio — independente de `sync-ml-orders` retornar pedidos ou não
**Mode:** bugfix
**Depends on**: Nothing
**Success Criteria** (what must be TRUE):
  1. `ml_product_daily_cache` tem coluna `marca` populada após sync via `mercado-libre-integration`
  2. `useMLOrdersByBrand` usa `ml_product_daily_cache` quando `orders` está vazio para o período
  3. Gráficos de marca aparecem para "Hoje" mesmo com 0 orders em `orders` table
  4. Gráficos baseados em `orders` (quando disponível) continuam funcionando para períodos históricos
  5. `npx tsc --noEmit` sem erros
**Plans**: 36-01

---

### Phase 37: fix-markup-sem-custo
**Goal**: Gráfico "Markup por Marca" exibe dados quando custos estão cadastrados em `ml_product_costs` — diagnosticar por que `custo_unit` chega null mesmo com custo cadastrado
**Mode:** bugfix
**Depends on**: Phase 36
**Success Criteria** (what must be TRUE):
  1. Com custos cadastrados em `/precos-custos`, o gráfico "Markup por Marca" exibe linhas para "Hoje"
  2. A query em `ml_product_costs` retorna custo para os `item_id`s presentes em `ml_product_daily_cache`
  3. `custo_unit` é não-nulo nos rows do fallback quando custo existe na tabela
  4. `hasMarkupData = true` para períodos com dados de custo + cache
  5. `npx tsc --noEmit` sem erros
**Plans**: TBD

---

### Phase 38: validar-paginas-dashboard
**Goal**: As 5 páginas do dashboard (Publicidade, Margem, Anúncios, Estoque, Pedidos) carregam dados reais para o período atual — diagnosticar e corrigir a regressão que zerou os dados / forçou pedido de sync, comportamento que antes funcionava
**Mode:** bugfix
**Depends on**: Nothing
**Success Criteria** (what must be TRUE):
  1. `/publicidade` exibe métricas de ads (impressões, cliques, ROAS, ACoS, TACoS) reais — não zeradas — para o período padrão
  2. `/anuncios` (margem real + publicidade no Lucro) lista produtos com preço, custo e margem — não tela vazia pedindo sync
  3. `/estoque` exibe inventário vivo via ml-inventory — não zerado
  4. `/pedidos` lista pedidos do período (orders está parado em 2026-05-27 — investigar por que o sync de orders não avança)
  5. A página de margem/lucro (/vendas MLCostCard) exibe waterfall com valores reais para o período atual
  6. Identificada e corrigida a causa raiz da regressão (auto-sync frontend, hook compartilhado MLStore/Organization, ou crash TDZ) — com nota no SUMMARY de qual commit introduziu
  7. `npx tsc --noEmit` sem erros

**Diagnóstico inicial (2026-06-04)**:
  - Backend saudável: edge functions retornando 200 (mercado-libre-integration, sync-ml-orders, ml-inventory, ml-ads, ml-products-aggregated). 1x 500 process-sync-job + 1x 401 mercado-libre-integration isolados (transitórios, pós token-refresh).
  - Freshness DB: ml_daily_cache / ml_product_daily_cache / ml_hourly_cache param em 2026-06-03 (ontem). orders parado em 2026-05-27 (1 semana). ml_ads_daily_cache fresco em 2026-06-04 (cron próprio).
  - Hipótese principal: filtro padrão inclui "hoje" mas o auto-sync do frontend (useAutoRecalc / useMLSync) não dispara o sync principal (mercado-libre-integration) → dashboard zera e pede sync.
  - Hipótese secundária: regressão em hook compartilhado (resolvedMLUserIds / orgId) afeta todas as queries simultaneamente; ou crash TDZ (vide commit 7108053a) em página específica.
  - Suspeitos: commits 31, 33, 34, 35, 36 (mexeram em useAutoRecalc, invalidação ["ml"], MLCostCard).
**Plans**: TBD

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
| 34 — fix-kpi-summary-hoje | KPI cards Markup/Custo/Impostos carregam para "Hoje" | ✅ Concluído | 34-01 |
| 35 — fix-brand-charts-hoje | Brand charts + KPI cards carregam para "Hoje" sem depender de marca | ✅ Concluído | 35-01 |
| 36 — fix-brand-from-product-cache | Brand charts usando ml_product_daily_cache como fallback quando orders vazio | 🔧 Em progresso | — |
| 37 — fix-markup-sem-custo | Markup por Marca carrega quando custo está cadastrado | 🔧 Em progresso | TBD |
| 38 — validar-paginas-dashboard | 5 páginas (publicidade/margem/anúncios/estoque/pedidos) carregam dados reais | ✅ Concluído | — |
