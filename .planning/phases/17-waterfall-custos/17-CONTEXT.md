# Phase 17: Waterfall de Custos Completo + Tiny CMV + Consolidação de Relatórios

**Created:** 2026-05-21
**Milestone:** v6.0 — Dashboard de Vendas — KPIs de Marca
**Status:** Planning

---

## Goal

Três objetivos em paralelo que tornam o painel de Vendas completo e consolidado:

1. **Waterfall financeiro real**: `MLCostCard` passa a exibir a cascata completa — receita bruta → comissão → frete → ads → CMV → impostos = **lucro bruto** — usando dados reais da tabela `orders` e configuração fiscal de `ml_tax_config`.

2. **Pipeline CMV via Tiny ERP**: Edge function `sync-tiny-costs` que lê `precoCustoMedio` do Tiny ERP v3 e atualiza `ml_product_costs.cost` por SKU, eliminando a necessidade de entrada manual de custo por produto. Requer OAuth Tiny (tokens em `ml_tokens`).

3. **Consolidação da aba Relatórios**: As 4 seções analíticas (Venda por Hora, Ticket Médio, Por Estado, Funil de Conversão) são movidas como seções nativas da tab Vendas — a aba "Relatórios" é removida.

---

## KPIs do Waterfall (Plano 17-01)

```
Receita Bruta            R$ XXX.XXX
(-) Cancelamentos        R$ XXX.XXX   (de orders.status cancelled/returned — 0 se não há)
(-) Comissão ML          R$ XXX.XXX   11.2%   ← de SUM(orders.comissao)
(-) Frete                R$ XXX.XXX    5.1%   ← de SUM(orders.frete)
(-) Publicidade          R$ XXX.XXX    3.5%   ← de ml_ads_daily_cache
(-) CMV                  R$ XXX.XXX   22.0%   ← de SUM(custo_unit × quantidade)
(-) Impostos             R$ XXX.XXX    8.0%   ← de effective_rate × receita_bruta por loja
══════════════════════════════════════════
Lucro Bruto              R$ XXX.XXX   50.2%
```

- **CMV**: `SUM(orders.custo_unit * orders.quantidade)` para pedidos pagos. Exibe "s/ custo" se nenhum produto tem `custo_unit` preenchido.
- **Impostos**: `SUM(receita_bruta_por_loja × ml_tax_config.effective_rate / 100)`. Exibe "s/ config" se loja não tem regime fiscal cadastrado.
- **Cancelamentos**: Opcional — mostra se > 0, oculta se zero (evitar noise).

---

## Pipeline CMV via Tiny (Plano 17-02)

### Fluxo
```
Tiny ERP (produto.precos.precoCustoMedio)
  → sync-tiny-costs edge function
  → ml_product_costs.cost WHERE seller_sku = tiny_sku
  → sync-ml-orders v6 usa costMap → orders.custo_unit
  → dashboard exibe CMV real
```

### OAuth Tiny
- Tiny usa OAuth2 Authorization Code com `client_id`/`client_secret`
- Token URL: `https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token`
- Autorização: `https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth`
- Tokens armazenados em novas colunas de `ml_tokens`:
  `tiny_access_token TEXT, tiny_refresh_token TEXT, tiny_expires_at BIGINT`
- Scope por `ml_user_id`: cada loja ML pode ter sua própria conta Tiny

### Edge function `sync-tiny-costs`
- Chamada com `{ ml_user_id }` via supabase.functions.invoke
- Faz token refresh se necessário (padrão idêntico ao nexo-mcp)
- Busca todos produtos ativos: `GET /produtos?situacao=A`
- Para cada produto (batch de 50): `GET /produtos/{id}` → `precos.precoCustoMedio || precos.precoCusto`
- Upsert em `ml_product_costs` ON CONFLICT `(user_id, seller_sku)` — novo unique index
- Rate limit: 1.1s entre requests (60 req/min)
- Resultado: `ml_product_costs.cost` populado automaticamente por SKU

### UI
- Botão "Conectar Tiny ERP" na página `/integracoes` (abaixo do bloco ML)
- Após conectar: botão "Sincronizar Custos" que invoca `sync-tiny-costs`
- Status: mostra data da última sync e quantos produtos com custo

---

## Consolidação da Aba Relatórios (Plano 17-03)

### Estado atual
- Aba "Relatórios" separada com 4 sub-tabs: Venda por Hora, Ticket Médio, Por Estado, Funil
- Dados já disponíveis em memória via `salesCache` (sem fetch extra)
- MLRelatorios.tsx tem 4 sub-componentes internos não exportados

### Estado alvo
- Aba "Relatórios" **removida** do `<Tabs>` em MercadoLivre.tsx
- As 4 seções movidas para a tab "Vendas" como seções accordion-style abaixo dos gráficos de marca
- `MLRelatorios.tsx` → renomear/substituir por componentes individuais exportáveis
- Cada seção tem header clicável (expansível) para não poluir a tela toda de uma vez

---

## Data Sources

### Já existentes
- `public.orders`: comissao, frete, custo_unit, quantidade, receita_bruta, status, ml_user_id
- `ml_ads_daily_cache`: spend por dia por ml_user_id
- `ml_tax_config`: regime + effective_rate por (ml_user_id, organization_id)
- `ml_product_costs`: item_id, cost, seller_sku, user_id

### Novos (Plano 17-02)
- `ml_tokens`: colunas tiny_access_token, tiny_refresh_token, tiny_expires_at
- Edge function `sync-tiny-costs`
- UI de conexão Tiny na página Integrações

---

## Supabase Project
- ID: `ckcdevcxgvueywivefgx`
- Projeto: garment-glow-test

## Current State

```
src/
  hooks/
    useMLOrders.ts          ← retorna total_comissao, total_frete, paid_revenue
    useMLKPISummary.ts      ← markup + custo_operacional (Fase 16)
    useMLTaxConfig.ts       ← Map<ml_user_id, {effective_rate, ...}>
    useMLProductCosts.ts    ← Map<item_id, {cost, seller_sku}>
  components/mercadolivre/
    MLCostCard.tsx          ← mostra custo_produto e impostos como "a informar"
  pages/
    MercadoLivre.tsx        ← tab "vendas" + tab "relatorios"
    mercadolivre/
      MLRelatorios.tsx      ← 4 sub-tabs analíticas
supabase/
  functions/
    sync-ml-orders/         ← v6, já popula custo_unit e marca
  migrations/
    20260521200000_orders_add_marca.sql  ← última migration
```

## Success Criteria

1. Card "Lucro Bruto" exibe valor correto = receita bruta - comissão - frete - ads - CMV - impostos
2. CMV exibe "s/ custo" quando nenhum produto tem custo cadastrado, e valor real quando tem
3. Impostos exibe "s/ config" quando loja sem regime fiscal, e valor real quando configurado
4. Botão "Conectar Tiny" aparece na página /integracoes e inicia OAuth Tiny
5. Após conexão + sync, `ml_product_costs` tem `cost` preenchido via Tiny (sem entrada manual)
6. A aba "Relatórios" não existe mais — os 4 relatórios são seções expansíveis na tab Vendas
7. KPIs existentes (Receita, Pedidos, Ticket, etc.) não regridem

## Constraints
- Recharts já instalado — sem novas libs de chart
- Tiny API v3: `https://api.tiny.com.br/public-api/v3`
- Rate limit Tiny: 60 req/min → 1.1s entre requests
- Edge functions em Deno — usar fetch nativo
- `ml_product_costs` usa `user_id` (não organization_id) — manter padrão existente
- Tiny OAuth: `client_id`/`client_secret` configurados via Supabase Vault ou env vars
