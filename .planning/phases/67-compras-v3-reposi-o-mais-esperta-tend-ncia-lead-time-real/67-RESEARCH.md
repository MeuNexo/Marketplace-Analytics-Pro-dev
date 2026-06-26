# Phase 67: Compras v3 — Reposição mais esperta (tendência + lead time real) - Research

**Researched:** 2026-06-26
**Domain:** SQL analytics (EWMA + seasonal index + median lead time) + PostgreSQL RPC extension + React toggle pattern
**Confidence:** MEDIUM (SQL patterns from first principles; codebase verified from real files; PostgreSQL ordered-set aggregates are documented standard features [ASSUMED])

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Velocidade de venda (sinal central)**
- D-01: A velocidade deixa de ser média plana e passa a combinar **tendência + sazonalidade**.
- D-02: Tendência = **EWMA** (pesos maior nas vendas recentes). Parâmetros exatos definidos nesta pesquisa.
- D-03: Sazonalidade = **índice por mês no nível MARCA/CATEGORIA** (não por SKU). Agrega vendas no bucket marca/categoria, calcula o fator sazonal do mês corrente e aplica ao SKU.
- D-04: Combinação: base EWMA ajustada pelo fator sazonal **quando há índice sazonal confiável**; sem ele, usa só EWMA (D-09).

**Lead time real por fornecedor**
- D-05: Lead time usa a **mediana do intervalo `data_pedido`→`data_entrega` das OCs em trânsito, agrupadas por fornecedor**.
- D-06: **Fonte = OCs em trânsito atuais** (`purchase_orders`) — NÃO sincronizar OCs recebidas/históricas.
- D-07: Mapeamento SKU→fornecedor reusa o **predominante da Phase 66** (CTE `fornecedor_by_sku`). Fallback: sem fornecedor → lead time do param.

**Robustez / fallback (princípio inviolável)**
- D-08: **Fallback transparente por dimensão** — cada camada esperta (EWMA, sazonalidade, lead time real) liga independentemente e só quando tem base de dado suficiente.
- D-09: Limiares de suficiência: valores exatos definidos nesta pesquisa.

**UI / controle**
- D-10: **Toggle "Cálculo esperto"** na `/compras` (ON por padrão). OFF = volta ao cálculo simples atual.
- D-11: **Transparência por SKU** via badges/tooltip: tendência (↑/↓/~), ajuste sazonal, lead time real vs param, "modo simples".

### Claude's Discretion

- Fórmula exata da EWMA (nº de períodos, α/half-life), bucketização temporal das vendas (semanal/diária).
- Cálculo exato do índice sazonal e definição operacional de "tendência" para o badge.
- Toggle como `p_smart BOOLEAN` na RPC, espelhando `get_cashflow` `p_include_purchase_forecasts`.
- Limiares de fallback (D-09) concretos.

### Deferred Ideas (OUT OF SCOPE)

- Sincronizar OCs recebidas/históricas para lead time realizado.
- Índice sazonal por SKU individual.
- Gerar OC no Tiny / editor manual de custo.
- Custo por fornecedor (fallback de custo).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SMART-01 | EWMA + índice sazonal por mês (marca/categoria) substituem média plana em `sales_by_sku` | Seção EWMA SQL + Seasonal Index SQL abaixo |
| SMART-02 | Lead time real por fornecedor = mediana `data_pedido→data_entrega` das OCs em trânsito via `lead_time_by_fornecedor` CTE | Seção Lead Time SQL abaixo |
| SMART-03 | Fallback transparente: cada dimensão liga independentemente com limiar mínimo; RPC expõe `_origem` columns para badges | Seção Limiares + Novas Colunas abaixo |
| SMART-04 | Toggle `p_smart BOOLEAN DEFAULT TRUE` na RPC + propagação no hook + badges na tabela + espelho TS testável + sem regressão | Seção Frontend + Pitfall 1 abaixo |
</phase_requirements>

---

## Summary

Esta fase estende a RPC `get_replenishment_by_sku` trocando dois insumos "burros" por sinais mais espertos, cada um com fallback independente. O motor de ponto de reposição/alvo/compra_sugerida (fórmula, MOQ, pack, estoque + a caminho) permanece intocado — apenas `venda_dia` e `lead_time_dias` ficam mais espertos.

A abordagem preferida é adicionar `p_smart BOOLEAN DEFAULT TRUE` como 4º parâmetro da RPC (padrão ligado). Quando `p_smart = TRUE`, a RPC computará três CTEs novas: (1) `ewma_sales` para velocidade com decaimento exponencial; (2) `seasonal_index` para fator mensal por marca; (3) `lead_time_by_fornecedor` para mediana real. A CTE `sales_by_sku` existente é preservada para o fallback e para o modo simples (`p_smart = FALSE`). A RPC acrescenta 5 colunas de transparência para alimentar badges. O espelho TypeScript em `replenishmentUtils.ts` ganha funções puras testáveis para cada nova dimensão.

**Primary recommendation:** Implementar EWMA por offset real de semanas (não por rank), com alpha=0.3 (half-life ~2 semanas). Índice sazonal no nível marca, mês atual, com limiar de 12 meses de histórico no bucket. Lead time = mediana `percentile_cont(0.5)` com limiar K=2 OCs. Tudo em CTEs adicionadas à RPC existente sem mudar as colunas de saída — apenas acrescentar as 5 novas.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cálculo EWMA + seasonal factor | Database / RPC | — | Dados em PostgreSQL; evita serializar arrays para o frontend |
| Cálculo lead time por fornecedor | Database / RPC | — | Agregação de `purchase_orders` no banco |
| Espelho/validação das fórmulas | Frontend (replenishmentUtils.ts) | — | Pure functions testáveis via vitest — sem acesso ao banco |
| Toggle `p_smart` | Frontend (hook + página) | — | Estado local; propaga como parâmetro da chamada RPC |
| Badges de transparência | Frontend (ReplenishmentSkuTable) | — | Renderiza colunas `_origem` retornadas pelo RPC |
| Anti-IDOR / tenant isolation | Database (SECURITY INVOKER + org filter) | — | Todas as CTEs novas filtram `organization_id = p_org_id` |

---

## Standard Stack

### Core (sem novas dependências)

| Library/Feature | Version | Purpose | Status |
|---------|---------|---------|------|
| PostgreSQL ordered-set aggregate | built-in | `percentile_cont(0.5) WITHIN GROUP (ORDER BY ...)` para mediana | Presente no Supabase [ASSUMED] |
| PostgreSQL `POWER()` function | built-in | Decaimento exponencial dos pesos EWMA | Nativo PG [ASSUMED] |
| PostgreSQL `DATE_TRUNC('week', ...)` | built-in | Bucketing semanal de vendas | Nativo PG [ASSUMED] |
| shadcn/ui `Switch` | já instalado | Toggle "Cálculo esperto" na UI | Já em uso em `MLFluxoCaixa.tsx` [VERIFIED: codebase] |
| vitest | `3.2.4` | Testes do espelho TS | Já em uso [VERIFIED: codebase] |

### Sem novas dependências de runtime

Toda a lógica nova é SQL puro + TypeScript puro. Nenhum pacote npm novo é necessário.

---

## Package Legitimacy Audit

> SKIPPED — esta fase não instala pacotes npm novos. Toda a lógica é SQL puro + TypeScript puro com bibliotecas já instaladas no projeto.

---

## Architecture Patterns

### System Architecture Diagram

```
MLCompras.tsx
  └─ useState(smartMode=true)                     ← toggle local
       └─ useReplenishmentBySku(30, 1.0, smartMode)
            └─ supabase.rpc('get_replenishment_by_sku', { p_smart: smartMode })
                 └─ RPC (SECURITY INVOKER, org-scoped)
                      ├─ CTE inventory_by_sku          [intocada]
                      ├─ CTE sales_by_sku (média plana)[intocada — usada no fallback]
                      ├─ CTE incoming_by_sku           [intocada]
                      ├─ CTE fornecedor_by_sku         [intocada — Phase 66]
                      ├─ CTE ewma_sales                [NOVA — p_smart]
                      │    orders × 12 semanas × decaimento exponencial → ewma_daily/d
                      ├─ CTE seasonal_index            [NOVA — p_smart]
                      │    orders × 2 anos × brand_by_item → fator_sazonal por (brand, mês)
                      ├─ CTE lead_time_by_fornecedor   [NOVA — p_smart]
                      │    purchase_orders → mediana dias por fornecedor
                      ├─ CTE params                    [estendida — usa lead time real se disponível]
                      └─ CTE base → SELECT final
                           ├─ venda_dia  = CASE p_smart THEN ewma×sazonal ELSE avg_daily END
                           ├─ venda_dia_origem TEXT                     [NOVA]
                           ├─ lead_time_origem TEXT                     [NOVA]
                           ├─ tendencia TEXT                            [NOVA]
                           ├─ fator_sazonal NUMERIC                     [NOVA]
                           └─ lead_time_real INTEGER                    [NOVA]
                      ↓
            ReplenishmentSkuRow (+ 5 novos campos)
                 └─ ReplenishmentSkuTable.tsx
                      ├─ Switch toggle "Cálculo esperto"
                      ├─ Badges por SKU (tendência ↑/↓/~, sazonal, lead time)
                      └─ ParamsTooltip estendido
```

### Recommended Project Structure

```
supabase/migrations/
└── 20260667000100_get_replenishment_by_sku_smart.sql  ← RPC v7 com p_smart

src/
├── hooks/
│   └── useReplenishmentBySku.ts           ← adicionar p_smart param + novos campos
├── lib/analysis/
│   ├── replenishmentUtils.ts              ← adicionar calcEwmaDaily + calcSeasonalFactor
│   └── replenishmentUtils.test.ts         ← adicionar testes para as novas funções
└── components/mercadolivre/
    └── ReplenishmentSkuTable.tsx          ← toggle Switch + badges de transparência

src/pages/mercadolivre/
└── MLCompras.tsx                          ← useState(smartMode) + pass to hook
```

---

## Fórmulas Concretas (o que o planner precisa)

### Fórmula 1: EWMA com offset real de semana [ASSUMED — derivado de princípios EWMA padrão]

**Por que offset real (não rank):** Se o SKU não vendeu na semana 2 e vendeu nas semanas 1 e 3, o rank entre "semanas com venda" daria rn=1 e rn=2, tratando a semana 3 como se fosse a semana imediatamente anterior à semana 1. O offset real (`semanas atrás de hoje`) preserva o espaçamento temporal correto.

**CTE `ewma_sales` (SQL PostgreSQL):**
```sql
-- Parâmetro fixo: alpha = 0.3 (half-life ≈ 2 semanas; moderado)
-- Lookback: 12 semanas = 84 dias
ewma_sales AS (
  SELECT
    inv.item_id, inv.variation_id,
    -- ewma_daily = média ponderada por decaimento exponencial / 7 (weekly→daily)
    SUM(o.quantidade * POWER(0.7, week_offset)) 
      / NULLIF(SUM(POWER(0.7, week_offset)), 0)
      / 7.0                                                    AS ewma_daily,
    COUNT(*)                                                   AS weeks_with_sales,
    -- tendência: avg das 4 semanas mais recentes vs 5-12 (para badge ↑/↓/~)
    SUM(o.quantidade * POWER(0.7, week_offset))
      FILTER (WHERE week_offset < 4)
      / NULLIF(SUM(POWER(0.7, week_offset)) FILTER (WHERE week_offset < 4), 0)
      / 7.0                                                    AS ewma_recent_daily,
    SUM(o.quantidade * POWER(0.7, week_offset))
      FILTER (WHERE week_offset BETWEEN 4 AND 11)
      / NULLIF(SUM(POWER(0.7, week_offset)) FILTER (WHERE week_offset BETWEEN 4 AND 11), 0)
      / 7.0                                                    AS ewma_older_daily
  FROM inventory_by_sku inv
  LEFT JOIN (
    SELECT
      o2.item_id, o2.variation_id, o2.quantidade,
      -- offset = quantas semanas atrás esta semana está (0 = semana atual, 1 = semana passada, etc.)
      FLOOR(
        EXTRACT(EPOCH FROM (DATE_TRUNC('week', CURRENT_DATE::date) - DATE_TRUNC('week', o2.data_pedido::date)))
        / (7 * 86400)
      )::INTEGER AS week_offset
    FROM orders o2
    WHERE o2.organization_id = p_org_id
      AND o2.data_pedido::date >= CURRENT_DATE - 84   -- 12 semanas
      AND o2.status = 'paid'
  ) o ON o.item_id = inv.item_id
       AND (o.variation_id = inv.variation_id OR (inv.variation_id IS NULL AND o.variation_id = ''))
  GROUP BY inv.item_id, inv.variation_id
)
```

**Parâmetros EWMA recomendados:**
- `alpha = 0.3` → peso de decaimento `1 - alpha = 0.7`
- Lookback: 12 semanas (84 dias)
- Half-life efetivo: `ln(0.5)/ln(0.7) ≈ 1.94 semanas` (semana passada tem 70% do peso da semana atual; há 4 semanas tem `0.7^4 ≈ 24%` do peso)

**Por que alpha=0.3:** Valores mais altos (ex: 0.5) reagem rápido a picos mas produzem sugestões instáveis semana a semana. Alpha=0.3 é o "golden mean" para demand forecasting em retail: reage a tendências em 2-3 semanas, estável o suficiente para não gerar compras redundantes após um pico pontual. [ASSUMED — baseado em prática de forecasting de inventário]

### Fórmula 2: Índice Sazonal por Marca/Mês [ASSUMED — derivado do método ratio-to-average padrão]

**CTE `seasonal_index`:**
```sql
seasonal_index AS (
  WITH brand_by_item AS (
    -- Mapeia item_id → brand usando ml_inventory_cache (já filtrado por org)
    SELECT DISTINCT item_id, brand
    FROM ml_inventory_cache
    WHERE organization_id = p_org_id AND brand IS NOT NULL AND brand <> ''
  ),
  monthly_sales_by_brand AS (
    -- Vendas mensais agregadas por (brand, mes)
    SELECT
      b.brand,
      EXTRACT(MONTH FROM o.data_pedido::date)::INTEGER AS mes,
      -- avg_month_qty = total do mês ÷ número de anos distintos em que o mês aparece
      -- Usa COUNT(DISTINCT year) para não confundir 1 mês com 2 anos de dados
      SUM(o.quantidade) / NULLIF(
        COUNT(DISTINCT EXTRACT(YEAR FROM o.data_pedido::date)::INTEGER), 0
      ) AS avg_qty_month
    FROM orders o
    INNER JOIN brand_by_item b ON b.item_id = o.item_id
    WHERE o.organization_id = p_org_id
      AND o.status = 'paid'
      AND o.data_pedido::date >= CURRENT_DATE - 730  -- 2 anos de lookback
    GROUP BY b.brand, EXTRACT(MONTH FROM o.data_pedido::date)::INTEGER
  ),
  brand_monthly_stats AS (
    SELECT
      brand, mes, avg_qty_month,
      AVG(avg_qty_month) OVER (PARTITION BY brand) AS brand_global_avg,
      COUNT(*) OVER (PARTITION BY brand) AS months_covered
    FROM monthly_sales_by_brand
  )
  SELECT
    brand,
    mes,
    -- fator = 1.0 se histórico insuficiente (< 12 meses no bucket)
    CASE WHEN months_covered >= 12
      THEN GREATEST(0.5, LEAST(2.5, avg_qty_month / NULLIF(brand_global_avg, 0)))
      ELSE 1.0
    END AS fator_sazonal,
    months_covered,
    CASE WHEN months_covered >= 12 THEN TRUE ELSE FALSE END AS sazonal_ativa
  FROM brand_monthly_stats
  -- Filtra: SÓ o mês atual (para aplicar no cálculo de hoje)
  WHERE mes = EXTRACT(MONTH FROM CURRENT_DATE)::INTEGER
)
```

**Detalhes críticos do índice sazonal:**
- **Granularidade**: `brand` (campo `ml_inventory_cache.brand`), não `categoria` — brand é o agrupador que captura "Chapéu Pralana em agosto" (Barretos)
- **Limiar mínimo**: `months_covered >= 12` — o bucket precisa ter dados de pelo menos 12 meses distintos (não necessariamente 12 meses contíguos) para o fator ser confiável
- **Clamp**: `GREATEST(0.5, LEAST(2.5, ...))` — factor nunca abaixo de 0.5x nem acima de 2.5x, evitando distorção extrema com dados irregulares
- **Mês corrente**: aplica o fator sazonal do mês atual (quando comprar agora). Se a RPC for chamada em junho, usa o índice de junho para projetar a velocidade de venda das próximas semanas.

**Atenção: potencial double-counting com EWMA:**
O EWMA captura a velocidade absoluta recente. Se vendemos muito em agosto (Barretos), o EWMA de agosto já estará alto. Aplicar um fator sazonal de 1.8× para agosto SOBRE um EWMA já alto de agosto pode superestimar. A mitigação: o EWMA é calculado sobre os últimos 12 semanas (lookback = 84 dias), então em agosto o lookback já incorpora os dados de agosto e reflete a alta. O fator sazonal então adiciona informação sobre "agosto histórico em relação ao ano todo" — que é o FORWARD LOOK necessário: se hoje é junho e precisamos comprar para agosto, o EWMA atual (junho) está baixo, mas o fator sazonal de agosto diria "agosto é 1.8× a média" — essa combinação é válida e não é double-counting. O problema seria apenas se chamássemos a RPC EM agosto e aplicássemos um fator sazonal de agosto baseado em dados de agosto — que é exatamente o que a CTE faz (mês atual). Neste caso, o EWMA já captura o pico real de agosto e o fator histórico de agosto confirma/amplifica a tendência. Para o Pé Vermeio (rodeios), esse comportamento é conservador (ligeiramente over-estimate em picos), o que é ACEITÁVEL — melhor sugerir a mais do que a menos em rodeios. [ASSUMED]

### Fórmula 3: Lead Time Real por Fornecedor [VERIFIED: PostgreSQL docs via search]

**CTE `lead_time_by_fornecedor`:**
```sql
lead_time_by_fornecedor AS (
  SELECT
    po.fornecedor,
    ROUND(
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY (po.data_entrega - po.data_pedido)   -- DATE subtraction → INTEGER (days)
      )
    )::INTEGER AS median_lead_days,
    COUNT(*) AS oc_count
  FROM purchase_orders po
  WHERE po.organization_id = p_org_id
    AND po.fornecedor IS NOT NULL
    AND po.fornecedor <> ''
    AND po.data_entrega IS NOT NULL
    AND po.data_pedido IS NOT NULL
    AND po.data_entrega >= po.data_pedido   -- sanity guard: lead time nao-negativo
  GROUP BY po.fornecedor
)
```

**Detalhes críticos:**
- `data_entrega - data_pedido` em PostgreSQL onde ambas são `DATE` retorna `INTEGER` (dias). [ASSUMED — comportamento padrão de subtração de datas em PG; verificável]
- `purchase_orders` já contém APENAS OCs em trânsito (o EF de sync faz delete+insert, sem acumular histórico) — não é necessário filtrar por `situacao`. [VERIFIED: codebase — comentário `20260665000000_purchase_orders.sql` linha 9: "Snapshot semantics: a EF faz delete-org + insert"]
- `percentile_cont(0.5)` retorna valor interpolado (pode não ser inteiro); `ROUND()::INTEGER` garante dias inteiros para a fórmula de ponto de reposição. [ASSUMED]
- Limiar mínimo: `oc_count >= 2` para usar o median (1 OC = sem distribuição real, apenas aquele valor planejado)

**Fallback chain para lead time (ordem de precedência):**
```
p_smart=TRUE AND lf.median_lead_days IS NOT NULL AND lf.oc_count >= 2
  → usa median_lead_days (lead_time_origem = 'fornecedor_real')
p_smart=FALSE OR dados insuficientes
  → usa precedência normal de params (SKU > fornecedor > marca > global > 30)
     (lead_time_origem = 'param')
```

### Fórmula 4: Tendência para Badge (↑/↓/~) [ASSUMED]

Calculada a partir dos sub-componentes da `ewma_sales`:
```sql
-- No SELECT final, dado ewma_recent_daily e ewma_older_daily da CTE ewma_sales:
CASE
  WHEN es.ewma_recent_daily IS NULL OR es.ewma_older_daily IS NULL THEN '~'
  WHEN es.ewma_recent_daily > es.ewma_older_daily * 1.20 THEN '↑'   -- >20% crescimento
  WHEN es.ewma_recent_daily < es.ewma_older_daily * 0.80 THEN '↓'   -- >20% queda
  ELSE '~'
END AS tendencia
```

Threshold de 20% é uma escolha de design conservadora — evita "↑" para variação natural e reserva o sinal para mudanças reais de tendência. [ASSUMED]

---

## Ponto de Inserção na RPC Existente

### Assinatura nova (4 parâmetros)

```sql
CREATE OR REPLACE FUNCTION public.get_replenishment_by_sku(
  p_org_id            UUID,
  p_sales_window_days INTEGER DEFAULT 30,
  p_demand_multiplier NUMERIC  DEFAULT 1.0,
  p_smart             BOOLEAN  DEFAULT TRUE   -- NOVO Phase 67
)
```

### Ordem das CTEs na RPC v7

```
inventory_by_sku   [intocada]
sales_by_sku       [intocada — preservada para fallback e p_smart=FALSE]
incoming_by_sku    [intocada — Phase 65]
fornecedor_by_sku  [intocada — Phase 66]
ewma_sales         [NOVA — só computada se p_smart=TRUE, ou sempre e condicional no SELECT]
seasonal_index     [NOVA]
lead_time_by_fornecedor  [NOVA]
params             [estendida — usa lead time real quando p_smart e dados suficientes]
base               [estendida — venda_dia usa CASE p_smart]
SELECT final       [estendido — 5 novas colunas de transparência]
```

### Notas sobre avaliação condicional das CTEs novas

PostgreSQL avalia todas as CTEs independentemente do SELECT final — não há "lazy CTE". As 3 CTEs novas sempre serão executadas quando p_smart=TRUE. Para evitar custo quando p_smart=FALSE, usar `WHERE p_smart` dentro de cada CTE (fazendo-a retornar 0 linhas):

```sql
ewma_sales AS (
  SELECT ...
  FROM inventory_by_sku inv
  LEFT JOIN (
    SELECT ... FROM orders o2
    WHERE o2.organization_id = p_org_id
      AND p_smart = TRUE            -- short-circuit: retorna 0 linhas se p_smart=FALSE
      AND o2.data_pedido::date >= CURRENT_DATE - 84
      AND o2.status = 'paid'
  ) o ON ...
  GROUP BY inv.item_id, inv.variation_id
)
```

Com `p_smart = FALSE`, o JOIN retorna 0 linhas e o SUM/COUNT resultam em NULL → `COALESCE` fallback para `avg_daily` da CTE `sales_by_sku`. [ASSUMED — comportamento plausível; validar no checkpoint]

### Substituição em `venda_dia` (CTE `base`)

```sql
-- Antes (Phase 66):
COALESCE(s.avg_daily, 0) * p_demand_multiplier   AS venda_dia

-- Depois (Phase 67):
CASE
  WHEN p_smart AND es.ewma_daily IS NOT NULL AND es.weeks_with_sales >= 2
    AND si.fator_sazonal IS NOT NULL AND si.sazonal_ativa
    THEN (es.ewma_daily * si.fator_sazonal) * p_demand_multiplier
  WHEN p_smart AND es.ewma_daily IS NOT NULL AND es.weeks_with_sales >= 2
    THEN es.ewma_daily * p_demand_multiplier
  ELSE
    COALESCE(s.avg_daily, 0) * p_demand_multiplier
END   AS venda_dia
```

### Substituição em `lead_time_dias` (CTE `params`)

```sql
-- Antes (Phase 66): COALESCE(sku → fornecedor → marca → global → 30)
-- Depois: lead time real sobrepõe o COALESCE apenas se p_smart e dados suficientes

COALESCE(
  -- lead time real por fornecedor (NOVO, só quando p_smart e K≥2)
  CASE WHEN p_smart AND lf.median_lead_days IS NOT NULL AND lf.oc_count >= 2
    THEN lf.median_lead_days
    ELSE NULL
  END,
  -- precedência de params existente (intocada)
  (SELECT rp.lead_time_dias ... scope='sku' ...),
  (SELECT rp.lead_time_dias ... scope='fornecedor' ...),
  (SELECT rp.lead_time_dias ... scope='marca' ...),
  (SELECT rp.lead_time_dias ... scope='global' ...),
  30
) AS lead_time_dias
```

Para JOIN com `lead_time_by_fornecedor`, usar: `LEFT JOIN lead_time_by_fornecedor lf ON lf.fornecedor = forn.fornecedor`

### Novas colunas no RETURNS TABLE e SELECT final

```sql
-- Adicionar ao RETURNS TABLE:
venda_dia_origem      TEXT,     -- 'ewma_sazonal' | 'ewma' | 'simples'
lead_time_origem      TEXT,     -- 'fornecedor_real' | 'param'
tendencia             TEXT,     -- '↑' | '↓' | '~'
fator_sazonal         NUMERIC,  -- o fator aplicado (NULL se não aplicado)
lead_time_real        INTEGER   -- a mediana real calculada (NULL se não disponível)
```

```sql
-- No SELECT final:
CASE
  WHEN p_smart AND es.weeks_with_sales >= 2 AND si.sazonal_ativa THEN 'ewma_sazonal'
  WHEN p_smart AND es.weeks_with_sales >= 2 THEN 'ewma'
  ELSE 'simples'
END                                              AS venda_dia_origem,
CASE
  WHEN p_smart AND lf.median_lead_days IS NOT NULL AND lf.oc_count >= 2
    THEN 'fornecedor_real'
  ELSE 'param'
END                                              AS lead_time_origem,
CASE
  WHEN NOT p_smart OR es.ewma_recent_daily IS NULL THEN '~'
  WHEN es.ewma_recent_daily > es.ewma_older_daily * 1.20 THEN '↑'
  WHEN es.ewma_recent_daily < es.ewma_older_daily * 0.80 THEN '↓'
  ELSE '~'
END                                              AS tendencia,
CASE WHEN p_smart AND si.sazonal_ativa
  THEN si.fator_sazonal ELSE NULL
END                                              AS fator_sazonal,
CASE WHEN p_smart AND lf.oc_count >= 2
  THEN lf.median_lead_days ELSE NULL
END                                              AS lead_time_real
```

### GRANT/REVOKE — atualizar assinatura

A assinatura da função muda de 3 para 4 args. Supabase RPCS precisam ter o GRANT para a nova assinatura:
```sql
REVOKE EXECUTE ON FUNCTION public.get_replenishment_by_sku(UUID, INTEGER, NUMERIC) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_replenishment_by_sku(UUID, INTEGER, NUMERIC, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_replenishment_by_sku(UUID, INTEGER, NUMERIC, BOOLEAN) TO authenticated;
```

---

## Limiares de Fallback Concretos (D-09)

| Dimensão | Condição para usar o "esperto" | Fallback |
|----------|-------------------------------|----------|
| EWMA | `p_smart=TRUE AND weeks_with_sales >= 2` | `avg_daily` da CTE `sales_by_sku` (média plana) |
| Sazonal | `p_smart=TRUE AND ewma_usado AND months_covered >= 12` | `fator_sazonal = 1.0` (não aplica índice) |
| Lead time real | `p_smart=TRUE AND oc_count >= 2 AND median_lead_days > 0` | COALESCE de params existente |

**Justificativas:**
- EWMA mín. 2 semanas: com 1 semana, o "EWMA" é apenas a média daquela semana — não há nenhum benefício vs `avg_daily`. Com 2+ semanas, começa a mostrar recência real.
- Sazonal mín. 12 meses: menos que 12 meses no bucket não cobre um ciclo sazonal completo; o fator calculado seria enviesado pelo período de dados disponível.
- Lead time mín. 2 OCs: 1 OC = não há distribuição para calcular mediana; usar o param é mais conservador e confiável.

---

## Frontend

### 1. Hook `useReplenishmentBySku.ts` — adicionar `smartMode`

**Padrão do `useCashFlowData`:** [VERIFIED: codebase — `src/hooks/useCashFlowData.ts`]
```typescript
// Antes:
export function useReplenishmentBySku(
  salesWindowDays = 30,
  demandMultiplier = 1.0,
)

// Depois:
export function useReplenishmentBySku(
  salesWindowDays = 30,
  demandMultiplier = 1.0,
  smartMode = true,            // NOVO — p_smart
)
```

Query key deve incluir `smartMode` para invalidação correta:
```typescript
queryKey: ["get_replenishment_by_sku", currentOrg?.id, salesWindowDays, demandMultiplier, smartMode] as const,
```

Chamada RPC:
```typescript
const { data, error } = await supabase.rpc("get_replenishment_by_sku", {
  p_org_id:             currentOrg.id,
  p_sales_window_days:  salesWindowDays,
  p_demand_multiplier:  demandMultiplier,
  p_smart:              smartMode,   // NOVO
});
```

### 2. Interface `ReplenishmentSkuRow` — 5 novos campos

```typescript
export interface ReplenishmentSkuRow {
  // ... campos existentes ...
  /** 'ewma_sazonal' | 'ewma' | 'simples' — como venda_dia foi calculado */
  venda_dia_origem: 'ewma_sazonal' | 'ewma' | 'simples';
  /** 'fornecedor_real' | 'param' */
  lead_time_origem: 'fornecedor_real' | 'param';
  /** '↑' | '↓' | '~' */
  tendencia: '↑' | '↓' | '~';
  /** Fator sazonal aplicado (null se não aplicado) */
  fator_sazonal: number | null;
  /** Mediana real de lead time computada (null se não disponível) */
  lead_time_real: number | null;
}
```

### 3. Página `MLCompras.tsx` — toggle state e propagação

**Padrão do `MLFluxoCaixa.tsx` (Phase 60):** [VERIFIED: codebase — `src/pages/mercadolivre/MLFluxoCaixa.tsx` linha 175]
```typescript
const [smartMode, setSmartMode] = useState(true);  // ON por padrão (D-10)

const { data, isLoading, error } = useReplenishmentBySku(
  salesWindowDays,
  demandMultiplier,
  smartMode,
);
```

UI do toggle (padrão idêntico ao FluxoCaixa):
```tsx
<div className="flex items-center gap-2">
  <Switch
    id="smart-mode"
    checked={smartMode}
    onCheckedChange={setSmartMode}
  />
  <Label
    htmlFor="smart-mode"
    className="text-xs text-muted-foreground cursor-pointer"
    title="Usa tendência recente (EWMA) + sazonalidade histórica da marca para calcular a velocidade de venda, e o prazo real dos seus fornecedores como lead time."
  >
    Cálculo esperto
  </Label>
</div>
```

### 4. `ReplenishmentSkuTable.tsx` — badges de transparência (D-11)

**Padrão dos badges existentes:** Reusa o `ParamsTooltip` como referência para estilo.

Novos elementos a acrescentar por linha de SKU no tooltip (não na tabela principal para não poluir):
- Badge `venda_dia_origem`: se `'ewma_sazonal'` → "EWMA + saz."; se `'ewma'` → "EWMA"; se `'simples'` → "Simples"
- Badge `tendencia`: `↑` em verde, `↓` em vermelho, `~` em cinza
- Se `fator_sazonal` não é null: "Sazonal ×{fator_sazonal.toFixed(2)}"
- Badge `lead_time_origem`: se `'fornecedor_real'` → "Prazo real {lead_time_real}d"; se `'param'` → "Prazo fixo {param_lead_time}d"

### 5. `replenishmentUtils.ts` — espelho puro testável

Adicionar funções puras que espelham o SQL:

```typescript
/**
 * Calcula EWMA diária a partir de vendas semanais ordenadas do mais recente ao mais antigo.
 * Cada entry: { weekOffset: number, qty: number } onde weekOffset=0 é a semana mais recente.
 * Retorna null se weeks.length < 2 (fallback para avg_daily).
 */
export function calcEwmaDaily(
  weeklyObs: Array<{ weekOffset: number; qty: number }>,
  alpha: number = 0.3,
): number | null {
  if (weeklyObs.length < 2) return null;
  const decay = 1 - alpha;
  let numerator = 0;
  let denominator = 0;
  for (const { weekOffset, qty } of weeklyObs) {
    const w = Math.pow(decay, weekOffset);
    numerator += qty * w;
    denominator += w;
  }
  return denominator > 0 ? numerator / denominator / 7 : null;
}

/**
 * Calcula fator sazonal para um mês dado.
 * monthlyAvgs: Map<mesNumber(1-12), avgQtyMonth> para o bucket da marca.
 * Retorna 1.0 se histórico insuficiente (< 12 meses cobertos).
 */
export function calcSeasonalFactor(
  monthlyAvgs: Map<number, number>,
  targetMonth: number, // 1-12
  clampMin: number = 0.5,
  clampMax: number = 2.5,
): { factor: number; active: boolean } {
  if (monthlyAvgs.size < 12) return { factor: 1.0, active: false };
  const targetAvg = monthlyAvgs.get(targetMonth);
  if (targetAvg == null) return { factor: 1.0, active: false };
  const globalAvg = Array.from(monthlyAvgs.values()).reduce((s, v) => s + v, 0) / monthlyAvgs.size;
  if (globalAvg === 0) return { factor: 1.0, active: false };
  const raw = targetAvg / globalAvg;
  return {
    factor: Math.max(clampMin, Math.min(clampMax, raw)),
    active: true,
  };
}

/**
 * Determina tendência comparando EWMA recente (4 semanas) vs antiga (5-12 semanas).
 */
export function calcTrend(
  ewmaRecentDaily: number | null,
  ewmaOlderDaily: number | null,
  threshold: number = 0.20,
): '↑' | '↓' | '~' {
  if (ewmaRecentDaily == null || ewmaOlderDaily == null || ewmaOlderDaily === 0) return '~';
  const ratio = ewmaRecentDaily / ewmaOlderDaily;
  if (ratio > 1 + threshold) return '↑';
  if (ratio < 1 - threshold) return '↓';
  return '~';
}
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Mediana de lead time | Função de mediana manual em SQL | `percentile_cont(0.5) WITHIN GROUP (ORDER BY ...)` | Função ordenada-set nativa do PG; correta e eficiente |
| EWMA recursiva | Recursive CTE no PostgreSQL | Weighted sum com `POWER()` e offset temporal | Recursão em PG degrada com datasets maiores; o approach de offset real é equivalente e mais eficiente |
| Toggle state management | Redux/Zustand para `smartMode` | `useState` local em `MLCompras.tsx` | Estado puramente UI, sem necessidade de estado global; mesmo padrão do caixa |
| Formatação de badges | Componente de badge customizado do zero | Extensão do `ParamsTooltip` existente + shadcn `Badge` | Consistência com padrão já aprovado |

---

## Common Pitfalls

### Pitfall 1: Regressão com p_smart=FALSE (CRÍTICO)

**O que vai errado:** A RPC `p_smart=FALSE` produz um número diferente do que a versão Phase 66 produzia para o mesmo SKU.

**Por que acontece:** O `CREATE OR REPLACE` replace a função de 3 args com uma de 4 args. A chamada antiga `supabase.rpc("get_replenishment_by_sku", { p_smart: undefined })` pode passar NULL para `p_smart` em vez de TRUE.

**Como evitar:**
1. No hook, sempre passar `p_smart` explicitamente (não `undefined`).
2. Na RPC, usar `COALESCE(p_smart, TRUE)` para proteger contra NULL.
3. Teste de não-regressão obrigatório: chamar a RPC com `p_smart=FALSE` e verificar que `venda_dia` = `avg_daily` da CTE `sales_by_sku`.

**Warning signs:** `venda_dia` diferente entre a RPC Phase 66 e a RPC Phase 67 com `p_smart=FALSE`.

### Pitfall 2: GRANT/REVOKE na assinatura nova

**O que vai errado:** `supabase.rpc("get_replenishment_by_sku", {..., p_smart: true})` retorna `permission denied` ou `function does not exist` com 4 argumentos.

**Por que acontece:** O GRANT foi feito para a assinatura de 3 args. A nova assinatura de 4 args precisa de GRANT separado.

**Como evitar:** Incluir na migration:
```sql
REVOKE EXECUTE ON FUNCTION public.get_replenishment_by_sku(UUID, INTEGER, NUMERIC) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_replenishment_by_sku(UUID, INTEGER, NUMERIC, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_replenishment_by_sku(UUID, INTEGER, NUMERIC, BOOLEAN) TO authenticated;
```

### Pitfall 3: data_entrega - data_pedido produz intervalo inválido

**O que vai errado:** `lead_time_by_fornecedor` retorna valores negativos ou zero, distorcendo a mediana.

**Por que acontece:** O Tiny preenche `data_pedido` como `dataPrevista` (previsão de entrega ao cliente da OC) e `data_entrega` como `data` (data de faturamento/envio). Se a OC for mal preenchida, `data_pedido` pode ser posterior a `data_entrega`.

**Como evitar:** O filtro `AND po.data_entrega >= po.data_pedido` na CTE `lead_time_by_fornecedor` descarta OCs com lead time inválido antes do `percentile_cont`. Checar com `execute_sql` no checkpoint os valores reais de `(data_entrega - data_pedido)` por fornecedor antes de finalizar.

**Warning signs:** `median_lead_days IS NULL` para todos os fornecedores (OCs sem datas preenchidas ou todas com datas inválidas). Neste caso o fallback para param é silencioso e correto.

### Pitfall 4: CTEs novas sem filtro `organization_id`

**O que vai errado:** Vazamento de dados entre orgs (IDOR).

**Por que acontece:** Um erro de copypaste nas CTEs novas omite `WHERE po.organization_id = p_org_id` ou `WHERE o2.organization_id = p_org_id`.

**Como evitar:** Toda CTE nova que acessa `orders` ou `purchase_orders` DEVE incluir `organization_id = p_org_id`. SECURITY INVOKER não protege contra isso — só a RLS previne, mas a RLS filtra por `is_org_member(auth.uid(), organization_id)` e não pelo `p_org_id` parametrizado. O filtro explícito é necessário para anti-IDOR paramétrico. [VERIFIED: codebase — padrão já estabelecido em todas as CTEs existentes]

### Pitfall 5: Supabase RPC tipagem TypeScript — novos campos

**O que vai errado:** Os 5 novos campos retornados pela RPC são `unknown` ou causam erros de tipo no `mapRow()`.

**Por que acontece:** O tipo gerado do Supabase (`database.types.ts`) não reflete a nova assinatura até ser regenerado.

**Como evitar:** O `mapRow()` em `useReplenishmentBySku.ts` já usa `r: Record<string, unknown>` e acessa campos por string. Apenas adicionar os 5 novos campos ao mapeamento com fallbacks seguros:
```typescript
venda_dia_origem: (r.venda_dia_origem as string) ?? 'simples',
lead_time_origem: (r.lead_time_origem as string) ?? 'param',
tendencia: (r.tendencia as string) ?? '~',
fator_sazonal: r.fator_sazonal != null ? Number(r.fator_sazonal) : null,
lead_time_real: r.lead_time_real != null ? Number(r.lead_time_real) : null,
```

### Pitfall 6: `DATE_TRUNC('week', ...)` no PostgreSQL começa na segunda-feira

**O que vai errado:** O bucket semanal começa na segunda-feira (ISO week), não no domingo.

**Por que isso importa:** O offset de semanas é calculado como `DATE_TRUNC('week', CURRENT_DATE) - DATE_TRUNC('week', data_pedido)`. Se o dia atual for domingo, `DATE_TRUNC('week', CURRENT_DATE)` retorna a segunda-feira anterior (PG usa ISO 8601, semana começa na segunda). Um pedido de sábado estaria em uma semana diferente de um pedido de domingo na mesma semana ISO.

**Como evitar:** Usar `DATE_TRUNC('week', ... AT TIME ZONE 'America/Sao_Paulo')` para consistência com BRT, mas como a maioria dos orders usa datas de São Paulo na inserção, `DATE_TRUNC('week', o.data_pedido::date)` é suficiente. O erro máximo é 1 dia por semana — aceitável para EWMA de forecasting.

---

## Code Examples

### Integração das CTEs na ordem correta [ASSUMED — montagem das partes acima]

```sql
-- Estrutura completa da RPC Phase 67 (só as partes novas mostradas)
WITH
  inventory_by_sku AS (... /* intocada */),
  sales_by_sku     AS (... /* intocada — fallback */),
  incoming_by_sku  AS (... /* intocada — Phase 65 */),
  fornecedor_by_sku AS (... /* intocada — Phase 66 */),
  -- === NOVAS PHASE 67 ===
  ewma_sales AS (
    SELECT
      inv.item_id, inv.variation_id,
      SUM(o.quantidade * POWER(0.7, week_offset))
        / NULLIF(SUM(POWER(0.7, week_offset)), 0) / 7.0      AS ewma_daily,
      COUNT(*)                                                AS weeks_with_sales,
      SUM(o.quantidade * POWER(0.7, week_offset))
        FILTER (WHERE week_offset < 4)
        / NULLIF(SUM(POWER(0.7, week_offset)) FILTER (WHERE week_offset < 4), 0)
        / 7.0                                                 AS ewma_recent_daily,
      SUM(o.quantidade * POWER(0.7, week_offset))
        FILTER (WHERE week_offset BETWEEN 4 AND 11)
        / NULLIF(SUM(POWER(0.7, week_offset)) FILTER (WHERE week_offset BETWEEN 4 AND 11), 0)
        / 7.0                                                 AS ewma_older_daily
    FROM inventory_by_sku inv
    LEFT JOIN (
      SELECT
        o2.item_id, o2.variation_id, o2.quantidade,
        FLOOR(
          EXTRACT(EPOCH FROM (
            DATE_TRUNC('week', CURRENT_DATE::date)
            - DATE_TRUNC('week', o2.data_pedido::date)
          )) / (7 * 86400)
        )::INTEGER AS week_offset
      FROM orders o2
      WHERE o2.organization_id = p_org_id
        AND p_smart = TRUE
        AND o2.data_pedido::date >= CURRENT_DATE - 84
        AND o2.status = 'paid'
    ) o ON o.item_id = inv.item_id
         AND (o.variation_id = inv.variation_id
              OR (inv.variation_id IS NULL AND o.variation_id = ''))
    GROUP BY inv.item_id, inv.variation_id
  ),
  seasonal_index AS (
    WITH brand_by_item AS (
      SELECT DISTINCT item_id, brand
      FROM ml_inventory_cache
      WHERE organization_id = p_org_id
        AND brand IS NOT NULL AND brand <> ''
        AND p_smart = TRUE
    ),
    monthly_raw AS (
      SELECT
        b.brand,
        EXTRACT(MONTH FROM o.data_pedido::date)::INTEGER AS mes,
        SUM(o.quantidade) / NULLIF(
          COUNT(DISTINCT EXTRACT(YEAR FROM o.data_pedido::date)::INTEGER), 0
        ) AS avg_qty_month
      FROM orders o
      INNER JOIN brand_by_item b ON b.item_id = o.item_id
      WHERE o.organization_id = p_org_id
        AND o.status = 'paid'
        AND o.data_pedido::date >= CURRENT_DATE - 730
      GROUP BY b.brand, EXTRACT(MONTH FROM o.data_pedido::date)::INTEGER
    ),
    stats AS (
      SELECT brand, mes, avg_qty_month,
        AVG(avg_qty_month) OVER (PARTITION BY brand)  AS brand_global_avg,
        COUNT(*)           OVER (PARTITION BY brand)  AS months_covered
      FROM monthly_raw
    )
    SELECT
      brand,
      CASE WHEN months_covered >= 12
        THEN GREATEST(0.5, LEAST(2.5, avg_qty_month / NULLIF(brand_global_avg, 0)))
        ELSE 1.0
      END AS fator_sazonal,
      months_covered >= 12 AS sazonal_ativa
    FROM stats
    WHERE mes = EXTRACT(MONTH FROM CURRENT_DATE)::INTEGER
  ),
  lead_time_by_fornecedor AS (
    SELECT
      po.fornecedor,
      ROUND(
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY (po.data_entrega - po.data_pedido)
        )
      )::INTEGER AS median_lead_days,
      COUNT(*) AS oc_count
    FROM purchase_orders po
    WHERE po.organization_id = p_org_id
      AND p_smart = TRUE
      AND po.fornecedor IS NOT NULL AND po.fornecedor <> ''
      AND po.data_entrega IS NOT NULL AND po.data_pedido IS NOT NULL
      AND po.data_entrega >= po.data_pedido
    GROUP BY po.fornecedor
  ),
  -- params: igual à Phase 66 mas com JOIN extra p/ lead_time real
  params AS (
    SELECT inv.item_id, inv.variation_id,
      COALESCE(
        CASE WHEN p_smart AND lf.median_lead_days IS NOT NULL AND lf.oc_count >= 2
          THEN lf.median_lead_days ELSE NULL END,
        (SELECT rp.lead_time_dias FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'sku'
           AND rp.scope_value = COALESCE(inv.sku_code, '') LIMIT 1),
        -- [... demais níveis igual Phase 66 ...]
        30
      ) AS lead_time_dias,
      -- [... meta_cobertura, safety, moq, pack — intocados ...]
    FROM inventory_by_sku inv
    LEFT JOIN fornecedor_by_sku  forn ON forn.sku_code = inv.sku_code
    LEFT JOIN lead_time_by_fornecedor lf ON lf.fornecedor = forn.fornecedor
  )
  -- base + SELECT final: usar venda_dia e novas colunas de origem
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Velocidade = SUM(qty)/janela | Velocidade = EWMA semanal + índice sazonal | Phase 67 | Captura aceleração/desaceleração + sazonalidade de rodeios |
| Lead time = param fixo | Lead time = mediana real das OCs em trânsito por fornecedor | Phase 67 | Sugestão alinhada com prazo real praticado hoje pelo fornecedor |
| Cálculo = caixa preta | Cálculo = transparente (origem por SKU + badges) | Phase 67 | Wesley pode auditar por que cada SKU tem a sugestão que tem |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `alpha = 0.3` (half-life ~2 semanas) é adequado para moda/agro do Pé Vermeio | EWMA params | Sugestões instáveis (alpha muito alto) ou lentas demais (alpha muito baixo). Ajustável como constante na migration. |
| A2 | `DATE - DATE` em PostgreSQL retorna `INTEGER` (dias) | Lead time CTE | Se retornar `INTERVAL`, o `percentile_cont` falha. Mitigação: testar com `EXTRACT(DAY FROM ...)` como alternativa. |
| A3 | `p_smart = TRUE` dentro do WHERE de subqueries curto-circuita a scan | CTE performance | PG pode não short-circuit; avaliar no checkpoint de custo com EXPLAIN. |
| A4 | `purchase_orders` contém apenas OCs em trânsito (sem situacao filter necessário) | Lead time | O snap-shot semantics foi documentado no código. Risco: se o EF de sync incluir OCs recebidas, a mediana seria de OCs históricas. Verificar contagem no checkpoint. |
| A5 | Fator sazonal clampado em [0.5, 2.5] é suficiente para os picos do Pé Vermeio | Seasonal index | Se Barretos gera pico >2.5× a média, a sugestão seria subcalculada. Ajustável. |
| A6 | `months_covered >= 12` é satisfeito para pelo menos algumas marcas do Pé Vermeio | Seasonal threshold | Se todas as marcas têm < 12 meses de histórico, o sazonal nunca liga → apenas EWMA. Verificar com query no checkpoint. |
| A7 | Threshold de tendência 20% (±0.20) é adequado para distinguir tendência real de ruído | Tendência badge | Threshold muito baixo = badges ↑/↓ frequentes e sem significado; muito alto = badge sempre ~. Ajustável. |

---

## Open Questions

1. **Quantas marcas têm >= 12 meses de histórico no bucket?**
   - O que sabemos: o Pé Vermeio começou a sincronizar `orders` em ~março 2026; 12 meses de histórico requereria dados desde março 2025
   - O que está claro: o sazonal provavelmente NÃO vai ligar para a maioria das marcas em junho 2026 (< 12 meses). O EWMA vai ligar normalmente.
   - Recomendação: no checkpoint do plano, executar `SELECT brand, COUNT(DISTINCT EXTRACT(YEAR FROM data_pedido::date)::text || '-' || EXTRACT(MONTH FROM data_pedido::date)::text) FROM orders WHERE organization_id='7f615df7-7bac-45e5-8a93-827fb9ddeec7' AND status='paid' GROUP BY brand ORDER BY 2 DESC LIMIT 20` para confirmar. Se < 12 meses para todas as marcas, o sazonal é um "dead feature" nesta fase (mas correto implementar agora para o futuro).
   
2. **`data_entrega - data_pedido` retorna INTEGER ou INTERVAL?**
   - O que sabemos: ambas são colunas `DATE` na `purchase_orders`. Em PostgreSQL, `DATE - DATE = INTEGER` (número de dias). Mas verificar com `SELECT typeof(data_entrega - data_pedido) FROM purchase_orders LIMIT 1` no MCP antes de finalizar a migration.
   - Recomendação: se retornar INTERVAL, usar `EXTRACT(DAY FROM (data_entrega - data_pedido))`.

3. **Quantos fornecedores existem com >= 2 OCs e datas preenchidas?**
   - O que sabemos: `purchase_orders` sincroniza apenas OCs em trânsito. O Pé Vermeio tinha 22 OCs em trânsito quando a Phase 65 foi executada.
   - Recomendação: com 22 OCs totais, provavelmente poucos fornecedores têm >= 2 OCs cada. O lead time real pode também ser um "dead feature" inicialmente, mas a infraestrutura fica pronta.

---

## Environment Availability

> SKIPPED — fase é de mudança de código/SQL. Sem novas dependências de runtime.
> Supabase MCP disponível para deploy de migrations e validação.

---

## Validation Architecture

> SKIPPED — `workflow.nyquist_validation: false` em `.planning/config.json`.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V4 Access Control | sim | SECURITY INVOKER + `organization_id = p_org_id` em todas as CTEs novas |
| V5 Input Validation | sim | `p_smart BOOLEAN` — sem SQL injection; `COALESCE(p_smart, TRUE)` protege NULL |
| V6 Cryptography | não | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| IDOR via `p_org_id` parametrizado | Elevation of privilege | SECURITY INVOKER + filtro explícito `organization_id = p_org_id` em cada CTE nova (não apenas na CTE raiz) |
| Injection via `p_smart` | Tampering | Parâmetro BOOLEAN tipado nativamente; sem concatenação de string SQL |

---

## Sources

### Primary (MEDIUM confidence)
- Codebase `/root/garment-glow-test/supabase/migrations/20260666000100_get_replenishment_by_sku_fornecedor.sql` — RPC atual com todas as CTEs mapeadas [VERIFIED: codebase]
- Codebase `src/hooks/useReplenishmentBySku.ts` — hook atual com padrão de query key e mapRow [VERIFIED: codebase]
- Codebase `src/pages/mercadolivre/MLFluxoCaixa.tsx` + `src/hooks/useCashFlowData.ts` — padrão do toggle `p_include_purchase_forecasts` [VERIFIED: codebase]
- Codebase `src/components/mercadolivre/ReplenishmentSkuTable.tsx` — ParamsTooltip e badges existentes [VERIFIED: codebase]
- Codebase `supabase/migrations/20260665000000_purchase_orders.sql` — schema da tabela `purchase_orders` com comentários sobre semantics [VERIFIED: codebase]
- Codebase `src/lib/analysis/replenishmentUtils.ts` + `.test.ts` — padrão do espelho puro testável [VERIFIED: codebase]

### Secondary (LOW confidence — web search)
- PostgreSQL `percentile_cont(0.5) WITHIN GROUP (ORDER BY ...)` — agregação de mediana nativa [low confidence search result confirming standard PG feature]
- EWMA não-recursivo via `POWER()` e offset temporal — princípio de média ponderada exponencial por decaimento [low confidence search result]
- Seasonal index via ratio-to-average — princípio clássico de decomposição de série temporal [low confidence search result]

---

## Metadata

**Confidence breakdown:**
- Mapeamento da RPC atual: HIGH — leitura direta do arquivo de migration
- Fórmulas SQL (EWMA, seasonal): MEDIUM/LOW — princípios matemáticos corretos; SQL precisa ser testado no checkpoint MCP
- Padrão do toggle (frontend): HIGH — leitura direta dos arquivos de hook e página
- Limiares de fallback (α, 12 meses, K=2): MEDIUM — valores defensáveis mas ajustáveis

**Research date:** 2026-06-26
**Valid until:** 30 days (SQL padrão estável)
