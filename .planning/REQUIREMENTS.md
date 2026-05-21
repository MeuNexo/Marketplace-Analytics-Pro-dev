# Requirements — v5.0 Dashboard de Vendas — KPIs Reais

## Contexto

O dashboard de Vendas (`/`) exibe KPIs financeiros calculados de dados agregados em `ml_daily_cache`.
Problemas identificados via análise do Nexo MCP Supabase (Abril/2026, Pé Vermeio):
- **Comissão hardcoded 11%** — real: ~11.15% (varia por categoria)
- **Frete hardcoded 5%** (R$17k/mês) — real CFFE: R$40k/mês (2.3x a mais)
- **CFONPN (parcelamento)** R$15,9k/mês — completamente invisível no dashboard
- **Ticket médio** usa total_revenue incluindo cancelados — subestima valor real
- Sem granularidade: impossível filtrar por SKU, estado, cidade, comprador

Solução: dois novos pilares de dados — `ml_orders` (individual) + `ml_billing_monthly`.

---

## Requisitos

### Bloco ORDERS — Orders Individuais

**ORDERS-01** — Tabela `ml_orders` existe no banco com colunas: `id`, `organization_id`, `ml_user_id`, `ml_order_id` (unique por org+user), `item_id`, `sku`, `titulo`, `quantidade`, `preco_unit`, `comissao`, `frete`, `status`, `data_pedido`, `estado`, `cidade`, `comprador`, `synced_at`

**ORDERS-02** — A edge function `mercado-libre-integration` faz upsert em `ml_orders` durante o sync, salvando cada order individual com os campos acima (além de continuar salvando em `ml_daily_cache`)

**ORDERS-03** — RLS em `ml_orders`: usuário autenticado vê apenas rows de sua `organization_id`

**ORDERS-04** — O hook `useMLOrders(from, to)` lê `ml_orders` filtrado por período e `ml_user_id` do contexto de loja

### Bloco KPIS — KPIs Corretos no Dashboard

**KPIS-01** — `costSummary.comissao` em `MercadoLivre.tsx` usa `SUM(comissao)` de `ml_orders` no período selecionado (não hardcoded 11%)

**KPIS-02** — `costSummary.frete` em `MercadoLivre.tsx` usa `SUM(frete)` de `ml_orders` no período selecionado quando disponível (fallback para CFFE do billing quando orders não cobrem o período)

**KPIS-03** — Ticket médio usa `approved_revenue / COUNT(pedidos com status=paid)` de `ml_orders` (não total_revenue / total_orders)

**KPIS-04** — Taxa de conversão mantém cálculo atual (`unique_buyers / unique_visits`) — sem regressão

### Bloco BILLING — Billing Mensal Integrado

**BILLING-01** — Tabela `ml_billing_monthly` existe com colunas: `id`, `organization_id`, `ml_user_id`, `period_month` (YYYY-MM), `charges` (JSONB array com tipo+valor), `resumo` (JSONB com totais), `synced_at`

**BILLING-02** — Nova edge function `sync-ml-billing` busca ML Billing API (`/billing/periods`) para um `ml_user_id` e `period_month`, faz upsert em `ml_billing_monthly`

**BILLING-03** — Botão de sync no dashboard dispara `sync-ml-billing` para o mês atual junto com o sync normal

**BILLING-04** — O dashboard de Vendas exibe CFFE real (linha "Frete ML") vindo de `ml_billing_monthly` quando disponível para o período, com indicador visual de fonte ("billing" vs "estimado")

**BILLING-05** — Nova linha "Parcelamento (CFONPN)" visível no breakdown de custos — valor de `ml_billing_monthly.charges` onde tipo=CFONPN

**BILLING-06** — Waterfall financeiro visível: Receita Bruta → (−) Comissão → (−) Frete → (−) CFONPN → (−) Publicidade → = Receita Líquida

---

## Out of Scope (v5.0)

- Melhorias em outros menus (Publicidade, Estoque, Financeiro) — próximos milestones
- Filtros por estado/cidade/SKU no dashboard — infra criada neste milestone, UI fica para v5.1
- Backfill de orders históricos para períodos antes da data de deploy — migração incremental
- Billing de contas além da Pé Vermeio — mesmo mecanismo, expandir em v5.1
- DIFAL, CSHIA e outras cobranças menores do billing — mostrar apenas CFFE + CFONPN neste milestone

---

## Dados de Referência (Nexo MCP, Abril 2026 — Pé Vermeio)

| KPI | Valor Atual (garment-glow) | Valor Real (Nexo) | Delta |
|-----|---------------------------|-------------------|-------|
| Comissão | ~R$38,6k (11% fixo) | R$39,2k (sum orders) | +R$534 |
| Frete | ~R$17,6k (5% fixo) | R$40,1k (CFFE billing) | −R$22,4k |
| CFONPN | R$0 | R$15,9k | −R$15,9k |
| Ticket médio | inclui cancelados | apenas pagos | depende do período |
