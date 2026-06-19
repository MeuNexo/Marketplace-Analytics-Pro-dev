# Phase 48: MCO com Ads — Research

**Pesquisado:** 2026-06-14
**Domínio:** Margem por produto com gasto real de publicidade; MCO agregado; engine Consultor v1
**Confiança:** HIGH (tudo verificado diretamente no codebase e migrations)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Margem operacional (sem ads) E margem pós-ads lado a lado por produto. "Prejuízo" permanece na operacional. Não é 1 número combinado.
- **D-02:** Atribuição direta por item via `ml_ads_products_cache` (tem `date` + `spend` + `attributed_revenue` + `attributed_orders` por `item_id` por dia). Sem rateio. `margem pós-ads = lucro operacional − ads_spend(item, janela)`.
- **D-03 (/anuncios):** MLAnuncios já tem visão de coluna "financeiro" (`columnView`). Adicionar margem operacional E pós-ads por produto nessa visão.
- **D-04 (Consultor):** Produtos com "ads comendo a margem" aparecem como insight acionável no Consultor / card "O que fazer agora". Linka para `/anuncios` ou `/publicidade` filtrado.
- **D-05 (card Custos/DRE em /vendas):** MCO agregado da operação = Σ margem de contribuição − ads total, visível no DRE mensal.
- **D-06:** Defaults vivem em `consultor_config` por org, ajustáveis via SQL. Crítico: operacional > 0 mas pós-ads ≤ 0%. Alerta: pós-ads abaixo de 10%.
- **D-07:** Alerta "ads_eating_margin" SEPARADO do alerta de prejuízo operacional (`margin_critical`).
- **D-08:** Nova regra `ads_eating_margin` por produto na EF `consultor-insights`. Segue o padrão de regra existente.
- **D-09:** Upgrade do `ads_no_sale` de org-level → por produto. RULE 3 atual usa `ml_ads_daily_cache` por causa do Pitfall 5. O `ml_ads_products_cache` tem `date` + `attributed_orders` por item → quebra por produto é viável.
- **D-10:** O planner decide se a nova regra por produto substitui ou complementa o `ads_no_sale` org-level existente.
- **D-11:** Produto com `spend > 0` E `attributed_orders = 0` na janela vira insight (MCO-05). Surgir esses itens exige LEFT/FULL join na RPC (não aparecem em `get_margin_by_product` que é orders-based).
- **D-12:** MCO agregado (D-05) usa gasto TOTAL de ads da conta via `ml_ads_daily_cache` (autoritativo) — não a soma do products_cache.
- **D-13:** MCO agregado (card DRE) segue DRE mês-calendário 01–31. Margem+ads por produto (/anuncios, Consultor) seguem a janela já usada nessas telas.
- **Supabase de produção:** `ckcdevcxgvueywivefgx` (SEMPRE).

### Claude's Discretion (planner decide)

- Forma exata da nova RPC (`get_margin_with_ads_by_product(org, user_ids, from, to)`): junta lógica de `get_margin_by_product` com agregação de `ml_ads_products_cache` por `item_id` na mesma janela; LEFT/FULL join para surgir produtos ads-only (D-11); paginação/agregação server-side para evitar truncamento PostgREST.
- Colunas novas em `consultor_config` (`ads_eating_critical_pct=0`, `ads_eating_alert_pct=10`) e templates de texto.
- Se `ads_eating_margin` afeta o pilar Ads do score de saúde (peso 25).
- Componentização: colunas operacional/pós-ads em MLAnuncios; linha "Publicidade / MCO" no MLCostCard/DRE.
- Como reusar `useMLProductMargins` / `useMLMarginAnalysis` / `useMLAdsDerivedMetrics` vs criar hook novo.

### Deferred Ideas (OUT OF SCOPE)

- UI para o lojista editar os limiares de erosão na tela → via SQL no v1.
- Atribuir campanhas de marca/display a itens específicos → fora do escopo.
- Score/insights separados por loja ML → fase futura.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MCO-01 | Fonte por produto de ads_spend/attributed_revenue por janela (RPC junta margem + ads por item_id sem truncamento PostgREST). Atribuição direta via `ml_ads_products_cache` | Verificado: `get_margin_by_product` é a base; nova RPC estende com LEFT JOIN em `ml_ads_products_cache` agrupado por item_id+range. SECURITY DEFINER + sem LIMIT evita truncamento. |
| MCO-02 | Margem por produto exibe margem operacional (sem ads) E margem pós-ads lado a lado | Verificado: MLAnuncios já tem `columnView === "financeiro"` com 5 colunas. Adicionar 2 colunas (operacional + pós-ads). Hook `useMLProductMargins` atual mistura os dois — precisa novo hook separado. |
| MCO-03 | MCO agregado da operação (Σ margem de contribuição − ads total) visível | Verificado: MLCostCard recebe props `cmvMes`, `impostosMes`, `gruposTarifas`; falta prop `adsTotalMes` e linha "Publicidade" no DRE. Fonte: `ml_ads_daily_cache` via `adsSpendMes` já calculado em MercadoLivre.tsx. |
| MCO-04 | Alerta separado por produto "ads comendo a margem", independente do alerta de prejuízo operacional | Verificado: engine `consultor-insights` tem RULE 1 (`margin_critical`) e RULE 2 (`margin_alert`) separados. Nova RULE `ads_eating_margin` segue o mesmo molde com `rule_key` diferente e `ml_user_id_key = item_id` para dedup por produto. |
| MCO-05 | ads_no_sale por produto — gasto de ads com zero venda no item | Verificado: RULE 3 atual usa `ml_ads_daily_cache` org-level (Pitfall 5 documentado no próprio EF). `ml_ads_products_cache` tem `attributed_orders` por `item_id` por `date` → upgrade para produto viável. |
</phase_requirements>

---

## Summary

A Phase 48 estende o modelo financeiro existente em três frentes simultâneas: (1) uma nova RPC PostgreSQL que junta a margem operacional por produto (já calculada) com o gasto de publicidade do produto na mesma janela temporal, expondo dois números distintos por anúncio; (2) exibição desses dois números nas três superfícies decididas pelo Wesley — coluna na visão "financeiro" de /anuncios, insight novo no Consultor, e linha de Publicidade/MCO agregado no card DRE de /vendas; (3) upgrade da RULE 3 do engine de insights (ads_no_sale) de nível de conta para nível de produto.

A base já existe e está sólida: `get_margin_by_product` (migration 20260527110000) agrega pedidos por `item_id` em todos os custos operacionais sem LIMIT; `ml_ads_products_cache` é série histórica diária por `(organization_id, ml_user_id, item_id, date)` desde a migration 20260522 (constraint final confirmada em 20260604). A diferença arquitetural central é que a RPC existente é orders-based — só produtos que venderam aparecem. A nova RPC precisa de LEFT/FULL JOIN com `ml_ads_products_cache` agrupado para surgir itens que gastaram em ads mas não venderam (D-11, MCO-05).

O DRE já calcula `adsSpendMes` em `MercadoLivre.tsx` (linha 255-258) a partir de `adsDaily` filtrado pelo `billingMonthFrom/To`; a fonte autoritativa para MCO agregado (D-12) é `ml_ads_daily_cache` — o mesmo dado já disponível. A única mudança no DRE é adicionar uma prop/linha "Publicidade" antes da linha de Lucro, e incluir esse valor no cálculo de MCO operacional.

**Recomendação primária:** Nova RPC `get_margin_with_ads_by_product` como migration SECURITY DEFINER, consumida por hook `useMLMarginWithAds`, exibida em MLAnuncios (2 colunas novas em `columnView === "financeiro"`); novas colunas `ads_eating_critical_pct` e `ads_eating_alert_pct` em `consultor_config`; RULE 14 (ou nova numeração) `ads_eating_margin` + upgrade de RULE 3 `ads_no_sale` de org-level para item-level na EF `consultor-insights`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cálculo margem operacional por produto | Database (RPC SQL) | — | Agrega centenas de orders; truncamento PostgREST se feito no browser |
| Cálculo ads_spend por produto/janela | Database (RPC SQL) | — | Mesma janela que a margem; agregação segura server-side |
| LEFT JOIN orders + ads_products_cache | Database (RPC SQL) | — | Surgir itens ads-only exige SQL; não pode ser feito no cliente |
| Exibição 2 colunas operacional/pós-ads | Frontend (MLAnuncios) | hook novo | Resultado da RPC renderizado em `columnView === "financeiro"` |
| MCO agregado no DRE | Frontend (MLCostCard) | MercadoLivre.tsx | `adsSpendMes` já existe; adicionar prop + linha no componente |
| Insight ads_eating_margin | Edge Function (consultor-insights) | Database (insights table) | Segue padrão de regras existente; grava em `insights` |
| Upgrade ads_no_sale para item-level | Edge Function (consultor-insights) | ml_ads_products_cache | `ml_ads_products_cache` tem `attributed_orders` por item+date |
| Novas colunas em consultor_config | Database (migration DDL) | — | Schema change; sem UI no v1 |
| Score de saúde (pilar Ads peso 25) | Edge Function (consultor-insights) | — | Pode incluir erosão de ads na penalidade do pilar Ads |

---

## Standard Stack

### Core (sem mudanças — reusar exatamente)

| Componente | Versão/Local | Propósito |
|------------|-------------|-----------|
| PostgreSQL (Supabase) | ckcdevcxgvueywivefgx | Nova RPC via migration |
| Deno (Supabase Edge Functions) | std 0.168.0 | Upgrade `consultor-insights/index.ts` |
| React + TanStack Query v5 | 18.3.1 / 5.83.0 | Novo hook `useMLMarginWithAds` |
| shadcn/ui (TableHead/TableCell) | existente | Novas colunas em MLAnuncios |
| date-fns | 3.6.0 | Formatação de datas no hook |
| supabase-js | 2.98.0 | `.rpc()` para nova RPC |

### Sem novas dependências externas

Esta fase não requer nenhum pacote npm adicional. Toda a lógica nova é:
- SQL na nova RPC (migration)
- TypeScript na EF existente (nova regra injetada na função existente)
- TypeScript no hook novo (padrão idêntico ao `useMLMarginAnalysis`)
- TSX nas 3 superfícies (MLAnuncios, MLCostCard, MLConsultor)

---

## Package Legitimacy Audit

Não aplicável — nenhum pacote externo novo será instalado nesta fase.

---

## Architecture Patterns

### Diagrama de fluxo de dados — Phase 48

```
Browser (React)
   │
   ├── /anuncios (MLAnuncios.tsx)
   │     └── useMLMarginWithAds(from, to)
   │           └── supabase.rpc("get_margin_with_ads_by_product", {...})
   │                 └── [PostgreSQL: LEFT JOIN orders + ml_ads_products_cache]
   │                       → { item_id, lucro_operacional, lucro_pct_op,
   │                            ads_spend, lucro_pos_ads, lucro_pct_pos_ads,
   │                            ads_no_sale: boolean }
   │     Renderiza: 2 colunas novas em columnView==="financeiro"
   │
   ├── / (MercadoLivre.tsx → MLCostCard.tsx)
   │     adsSpendMes já calculado de adsDaily (ml_ads_daily_cache)
   │     Nova prop adsTotalMes → linha "Publicidade" no DRE
   │     Nova linha "MCO Operacional" = lucro − ads_total
   │
   └── /consultor (MLConsultor.tsx) — lê tabela insights
         ↑ gravada pela EF consultor-insights (cron diário)

Edge Function consultor-insights (Deno)
   ├── RULE 14 ads_eating_margin (nova):
   │     consultor_config.ads_eating_critical_pct / ads_eating_alert_pct
   │     RPC get_consultor_margin_by_product (existente)
   │     ml_ads_products_cache → SUM(spend) por item_id no período
   │     → grava insight por (org_id, "ads_eating_margin", item_id)
   │
   └── RULE 3 ads_no_sale (upgrade):
         ml_ads_products_cache WHERE spend > 0 AND attributed_orders = 0
         → grava insight por (org_id, "ads_no_sale_product", item_id)
         [item-level, não mais org-level]

Database
   ├── ml_ads_products_cache: (org_id, ml_user_id, item_id, date) → spend, attributed_orders
   ├── orders: (org_id, ml_user_id, item_id, data_pedido) → receita, custos
   ├── ml_ads_daily_cache: (org_id, ml_user_id, date) → spend total (autoritativo)
   ├── consultor_config: + ads_eating_critical_pct, ads_eating_alert_pct (novas colunas)
   └── insights: registro por (org_id, rule_key, ml_user_id_key=item_id)
```

### Estrutura de arquivos a criar/alterar

```
supabase/
├── migrations/
│   ├── YYYYMMDDHHMMSS_margin_with_ads_rpc.sql      (nova RPC SECURITY DEFINER)
│   └── YYYYMMDDHHMMSS_consultor_config_ads_cols.sql (2 colunas novas)
└── functions/
    └── consultor-insights/
        └── index.ts   (upgrade RULE 3 + nova RULE ads_eating_margin)

src/
├── hooks/
│   └── useMLMarginWithAds.ts   (novo hook; padrão idêntico a useMLMarginAnalysis)
├── pages/mercadolivre/
│   └── MLAnuncios.tsx          (2 colunas novas em columnView==="financeiro")
└── components/mercadolivre/
    └── MLCostCard.tsx          (prop adsTotalMes + linha Publicidade/MCO)
```

---

## Findings por Requisito

### MCO-01: Nova RPC get_margin_with_ads_by_product

**Assinatura exata de `get_margin_by_product` (base da nova RPC):**
[VERIFIED: /root/garment-glow-test/supabase/migrations/20260527110000_margin_aggregate_rpcs.sql]

```sql
CREATE OR REPLACE FUNCTION public.get_margin_by_product(
  p_org_id   UUID,
  p_user_ids TEXT[],
  p_from     DATE,
  p_to       DATE
)
RETURNS TABLE (
  item_id      TEXT,
  titulo       TEXT,
  sku          TEXT,
  listing_type TEXT,
  receita      NUMERIC,
  cmv          NUMERIC,
  comissao     NUMERIC,
  frete        NUMERIC,
  impostos     NUMERIC,
  lucro        NUMERIC,     -- = receita − cmv − comissao − frete − impostos
  lucro_pct    NUMERIC,
  pedidos      BIGINT,
  unidades     BIGINT,
  has_cmv      BOOLEAN
)
```

Filtro de status: `status IN ('paid', 'shipped', 'delivered')`.
Sem LIMIT (adequado para grande volume). Ordenado por `lucro DESC`. [VERIFIED]

**Nova RPC a criar: `get_margin_with_ads_by_product`**

Adiciona ao SELECT da RPC existente:
- `ads_spend NUMERIC` = `COALESCE(SUM(ads.spend), 0)` do LEFT JOIN com `ml_ads_products_cache`
- `ads_attributed_orders BIGINT` = `COALESCE(SUM(ads.attributed_orders), 0)`
- `lucro_pos_ads NUMERIC` = `lucro − ads_spend`
- `lucro_pct_pos_ads NUMERIC` = `CASE WHEN receita > 0 THEN ROUND((lucro_pos_ads / receita) * 100, 2) ELSE NULL END`
- `ads_no_sale BOOLEAN` = `ads_spend > 0 AND ads_attributed_orders = 0`

JOIN pattern correto (para surgir itens ads-only, D-11):

```sql
-- CTE com lados:
WITH orders_side AS (
  SELECT item_id, MAX(titulo) titulo, MAX(sku) sku, MAX(listing_type) listing_type,
    SUM(receita_bruta) receita, SUM(custo_unit * quantidade) cmv,
    SUM(comissao) comissao, SUM(frete) frete, SUM(tax_amount) impostos,
    COUNT(*) pedidos, SUM(quantidade) unidades, BOOL_OR(custo_unit IS NOT NULL) has_cmv
  FROM public.orders
  WHERE organization_id = p_org_id AND ml_user_id = ANY(p_user_ids)
    AND status IN ('paid','shipped','delivered')
    AND data_pedido::date BETWEEN p_from AND p_to
    AND item_id IS NOT NULL
  GROUP BY item_id
),
ads_side AS (
  SELECT item_id,
    SUM(spend) ads_spend,
    SUM(attributed_orders) ads_attributed_orders,
    MAX(title) ads_title  -- fallback de titulo para itens sem venda
  FROM public.ml_ads_products_cache
  WHERE organization_id = p_org_id AND ml_user_id = ANY(p_user_ids)
    AND date BETWEEN p_from AND p_to
  GROUP BY item_id
)
SELECT
  COALESCE(o.item_id, a.item_id)  AS item_id,
  COALESCE(o.titulo, a.ads_title) AS titulo,
  o.sku, o.listing_type,
  COALESCE(o.receita, 0)          AS receita,
  ...
  COALESCE(a.ads_spend, 0)        AS ads_spend,
  COALESCE(a.ads_attributed_orders, 0) AS ads_attributed_orders
FROM orders_side o
FULL OUTER JOIN ads_side a USING (item_id)
ORDER BY receita DESC NULLS LAST;
```

**Truncamento PostgREST:** A nova RPC deve ser SECURITY DEFINER como `get_consultor_margin_by_product` (Phase 45). RPCs SQL não têm o limite de 1000 linhas do PostgREST quando chamadas via `.rpc()`. [VERIFIED: padrão confirmado em 20260645010000_consultor_engine_rpcs.sql]

**GRANT:** `GRANT EXECUTE ON FUNCTION ... TO authenticated` (chamada pelo browser via JWT do usuário, como `get_margin_by_product`).

---

### MCO-02: Schema exato de ml_ads_products_cache

[VERIFIED: migrations 20260406143415, 20260423153544, 20260522_ads_products_daily.sql, 20260604140000]

**Colunas atuais (produção):**
```
id                  uuid         PK
user_id             uuid         NOT NULL  (auth.users — legado)
ml_user_id          text         NOT NULL
organization_id     uuid         NOT NULL  (adicionado em 20260423153544)
seller_id           uuid         REFERENCES sellers(id)
item_id             text         NOT NULL
title               text         NOT NULL DEFAULT ''
thumbnail           text
date                date         NOT NULL DEFAULT CURRENT_DATE  (adicionado em 20260522)
impressions         integer
clicks              integer
spend               numeric      NOT NULL DEFAULT 0
attributed_revenue  numeric      NOT NULL DEFAULT 0
attributed_orders   integer      NOT NULL DEFAULT 0
cpc                 numeric
ctr                 numeric
roas                numeric
synced_at           timestamptz
```

**onConflict atual:** `(organization_id, ml_user_id, item_id, date)` — constraint `ml_ads_products_org_user_item_date_key` (20260522). O constraint antigo `ml_ads_products_cache_unique (user_id, ml_user_id, item_id)` SEM date foi dropado em 20260604140000. [VERIFIED]

**Coluna `date` confirmada:** Existe desde a migration 20260522. O sync-ads popula sempre com `date = dateFrom` (o dia do job). É série histórica: uma linha por item por dia. [VERIFIED: sync-ads/index.ts linha 253-268]

**Índice para range query:** `idx_ads_products_org_user_date ON (organization_id, ml_user_id, date)` criado em 20260522. [VERIFIED]

---

### MCO-03: Schema de ml_ads_daily_cache (total autoritativo)

[VERIFIED: migration 20260406143415_a0ec5aee]

```
id                  uuid
user_id             uuid         NOT NULL
ml_user_id          text         NOT NULL DEFAULT ''
organization_id     uuid         (adicionado 20260423153544)
seller_id           uuid
date                date         NOT NULL
impressions         integer
clicks              integer
spend               numeric      NOT NULL DEFAULT 0
attributed_revenue  numeric      NOT NULL DEFAULT 0
attributed_orders   integer      NOT NULL DEFAULT 0
cpc                 numeric
ctr                 numeric
roas                numeric
synced_at           timestamptz
```

**Constraint única:** `(user_id, ml_user_id, date)` — granularidade por conta ML por dia.

**Como é populado:** sync-ads agrega todos os itens em `dailyAgg` e faz upsert por `(user_id, ml_user_id, date)`. É a fonte "autoritativa" porque captura 100% do spend incluindo campanhas sem item_id atribuído (marca/display). [VERIFIED: sync-ads/index.ts linhas 171-248]

**Confirmação da premissa de reconciliação (D-12):** O sync-ads deleta o período antes de inserir:
```typescript
await sb.from("ml_ads_products_cache").delete().eq("ml_user_id", mlUserId).gte("date", dateFrom).lte("date", dateTo);
await sb.from("ml_ads_daily_cache").delete().eq("ml_user_id", mlUserId).gte("date", dateFrom).lte("date", dateTo);
```
O `dailyAgg` é derivado da soma dos itens (`itemDayAgg`). Se a API ML retornar dados completos, `SUM(ml_ads_products_cache.spend)` = `ml_ads_daily_cache.spend` para o mesmo ml_user_id+date. Campanhas de marca/display sem `item_id` são **excluídas** do `itemDayAgg` (filtra `if (itemId)`) mas **incluídas** no `dailyAgg` via o mesmo loop. Portanto: Σ products_cache.spend ≤ daily_cache.spend — a diferença é exatamente o gasto de campanhas sem item_id. A premissa "~100%" do CONTEXT.md é um upper-bound ideal; na prática pode ter gap. [VERIFIED: sync-ads/index.ts linhas 210-225] — implicação: MCO agregado corretamente usa `ml_ads_daily_cache` (D-12) pois é a fonte completa.

---

### MCO-04: Engine consultor-insights — padrão de regra existente

[VERIFIED: /root/garment-glow-test/supabase/functions/consultor-insights/index.ts]

**Estrutura de uma regra:**

```typescript
// 1. Carregar dados (via RPC ou select direto)
const { data: rows } = await sb.rpc("get_consultor_xxx", { p_org_id: orgId, ... });

// 2. Calcular impacto
const impact = ...;

// 3. Adicionar ao array candidates e activeRuleKeys
activeRuleKeys.push("rule_key_aqui");
candidates.push({
  organization_id: orgId,
  ml_user_id: null,       // null para org-level; string para per-store
  ml_user_id_key: "",     // '' para org-level; item_id string para per-item (dedup)
  rule_key: "ads_eating_margin",
  category: "Ads",
  severity: "critical" | "high" | "medium",
  title: "...",
  body: "...",  // em linguagem leiga, com valores em R$
  action_label: "Ver anúncios",
  action_href: "/anuncios?items=" + item_ids.join(","),
  impact_brl: Math.round(impacto),
  status: "active",
  updated_at: nowIso,
});
```

**Upsert de dedup (T-45-08):** `onConflict: "organization_id,rule_key,ml_user_id_key"`. Para insights por item, `ml_user_id_key = item_id` (string) garante uma linha por produto. [VERIFIED: consultor-insights/index.ts linha 887]

**Interface `InsightCandidate`:** [VERIFIED]
```typescript
interface InsightCandidate {
  organization_id: string;
  ml_user_id: string | null;
  ml_user_id_key: string;    // '' para org; item_id para produto
  rule_key: string;
  category: string;
  severity: string;
  title: string;
  body: string;
  action_label: string;
  action_href: string;
  impact_brl: number | null;
  status: string;
  updated_at: string;
}
```

**Pilar Ads do score (peso 25):** [VERIFIED: linhas 779-788]
```typescript
let notaAds = 100;
// Penaliza por TACoS acima do limiar (+5 por ponto) e ads_no_sale (+20)
notaAds = clamp(Math.round(100 - tacosOver15 * 5 - (hasCampanhaSemVenda ? 20 : 0)));
```
Para incluir `ads_eating_margin` na penalidade: verificar `activeRuleKeys.includes("ads_eating_margin")` e adicionar penalidade (ex.: −15 por regra de erosão disparada).

**ConsultorConfig — colunas atuais em `consultor_config`:** [VERIFIED: 20260645000000_consultor_tables.sql]
```
margin_critical_pct      NUMERIC DEFAULT 0
margin_alert_pct         NUMERIC DEFAULT 10
tacos_alert_pct          NUMERIC DEFAULT 15
acos_alert_pct           NUMERIC DEFAULT 30
roas_min                 NUMERIC DEFAULT 3
ads_no_sale_days         INTEGER DEFAULT 7
stock_critical_days      INTEGER DEFAULT 7
stock_alert_days         INTEGER DEFAULT 15
ticket_drop_pct          NUMERIC DEFAULT 10
claims_spike_pct         NUMERIC DEFAULT 20
goal_risk_pct            NUMERIC DEFAULT 10
paused_ads_lookback_days INTEGER DEFAULT 30
```

**Novas colunas a adicionar (migration DDL):**
```sql
ALTER TABLE public.consultor_config
  ADD COLUMN IF NOT EXISTS ads_eating_critical_pct NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ads_eating_alert_pct    NUMERIC NOT NULL DEFAULT 10;
```

**DEFAULT_CONFIG em index.ts** também precisa receber as novas chaves.

**RULE 3 ads_no_sale atual (org-level):** [VERIFIED: consultor-insights/index.ts linhas 254-291]
```typescript
// Usa ml_ads_daily_cache (org-level, Pitfall 5)
const { data: adsNoSaleRows } = await sb
  .from("ml_ads_daily_cache")
  .select("spend, attributed_orders")
  .eq("organization_id", orgId)
  .gte("date", adsNoSaleFrom)
  .lte("date", today);
// Dispara se: Σspend > 0 E Σorders === 0 (CONTA INTEIRA)
```

**Upgrade da RULE 3 (ads_no_sale_product):** Trocar para `ml_ads_products_cache` agrupado por item_id:
```typescript
// Novo: per-product
const { data: productNoSaleRows } = await sb
  .from("ml_ads_products_cache")
  .select("item_id, spend, attributed_orders, title")
  .eq("organization_id", orgId)
  .gte("date", adsNoSaleFrom)
  .lte("date", today);
// Agrupar por item_id; filtrar spend > 0 AND attributed_orders === 0
```
**Decisão D-10 para o planner:** O RULE 3 org-level deve ser substituído (não complementado), pois o item-level é um superset mais informativo. O org-level só dispararia quando TODOS os itens têm zero venda — caso extremo coberto implicitamente pelo item-level. Manter os dois geraria insight duplicado. Recomendação: substituir por `ads_no_sale_product` e manter o `rule_key` = `"ads_no_sale"` (mesmo string) para que insights históricos de org-level sejam resolvidos automaticamente via auto-resolver.

---

### MCO-05: Frontend — superfícies e padrões atuais

**MLAnuncios.tsx — visão "financeiro" (columnView):** [VERIFIED: MLAnuncios.tsx linhas 87, 565, 1226-1247]

Colunas atuais em `columnView === "financeiro"`:
1. Custo (CMV por item — editable inline)
2. Impostos (taxa fiscal × preço)
3. Comissão ML
4. Mg. Bruta
5. Mg. Líq.

As colunas são calculadas "por listing price" (preço atual do anúncio, sem dados históricos de orders). Isso difere da nova exibição de margem+ads que precisa de dados históricos de pedidos (`orders.receita_bruta`).

**Ponto de integração correto:** A nova exibição operacional/pós-ads precisa de dados de pedidos da **mesma janela temporal** usada pelos dados de ranking (MLAnuncios usa `rankingPeriod` e `rankingRange` — últimos N dias ou range customizado). A visão "financeiro" atual não tem janela temporal por ser baseada no preço atual. Para exibir margem+ads histórica, MLAnuncios precisa consumir o hook `useMLMarginWithAds(from, to)` com o mesmo range do ranking.

**MLConsultor.tsx:** [VERIFIED: MLConsultor.tsx]
Renderização de insight via `InsightCard` — lê `insight.action_href` e faz `<Link to={insight.action_href}>`. O `action_href` já suporta `/anuncios?items=MLB...` (padrão estabelecido no Phase 45 para `margin_critical` e `stock_critical`). Novo insight `ads_eating_margin` segue exatamente o mesmo padrão.

**MLCostCard.tsx — props atuais:** [VERIFIED: MLCostCard.tsx]
```typescript
interface MLCostCardProps {
  mesLabel: string;
  receitaMes: number;
  gruposTarifas: BillingGroup[];   // inclui "Campanhas de publicidade" no fallback estimado
  totalTarifas: number;
  cmvMes: number | null;
  impostosMes: number | null;
  fonte: "competencia" | "billing" | "estimado";
  // + controles de navegação e sync
}
```

Cálculo atual de `lucro`:
```typescript
const lucro = receitaMes - totalTarifas - (cmvMes ?? 0) - (impostosMes ?? 0);
```

Para D-05 (MCO agregado), o `totalTarifas` calculado a partir de `gruposTarifas` JÁ inclui a linha "Campanhas de publicidade" no fallback estimado (quando não há billing real). Porém, quando `fonte === "competencia"` (ml_billing_daily), as tarifas ML são do billing real — e o gasto de publicidade não está nas tarifas ML (PADS é um débito separado do faturamento ML). Portanto, a linha de Publicidade/MCO deve ser **uma linha separada** no DRE, abaixo das tarifas ML, e não incorporada em `gruposTarifas`.

**`adsSpendMes` em MercadoLivre.tsx:** [VERIFIED: MercadoLivre.tsx linhas 255-258]
```typescript
const adsSpendMes = useMemo(
  () => adsDaily.filter((d) => d.date >= billingMonthFrom && d.date <= billingMonthTo)
    .reduce((s, d) => s + d.spend, 0),
  [adsDaily, billingMonthFrom, billingMonthTo],
);
```
`adsDaily` já é filtrado de `ml_ads_daily_cache` via `useMLAds`. Este valor é exatamente o `ads_total` do MCO agregado (D-12). Basta passá-lo como nova prop `adsTotalMes` para `MLCostCard`.

**Como MercadoLivre.tsx chama MLCostCard:** [VERIFIED: MercadoLivre.tsx linhas 714-731]
```typescript
<MLCostCard
  mesLabel={mesLabel}
  receitaMes={receitaMes}
  gruposTarifas={gruposTarifasEfetivos}
  totalTarifas={totalTarifasEfetivo}
  cmvMes={cmvMes}
  impostosMes={impostosMes}
  fonte={dreFonte}
  loading={dreWaterfallLoading}
  ...
/>
```

---

### MCO-06: Janela temporal por superfície (D-13)

**MLAnuncios:** usa `rankingPeriod` e `rankingRange` para dados de vendas. O hook novo `useMLMarginWithAds` deve receber o mesmo `from/to` do ranking. Não há um `dateFrom/dateTo` "global" na página — é específico do ranking. A nova exibição de margem+ads em MLAnuncios deve usar os mesmos filtros de data do ranking (últimos N dias ou range customizado).

**Consultor:** usa `thirtyDaysAgo` a `today` como janela fixa de 30 dias para a regra de margem (RULE 1/2). A nova regra `ads_eating_margin` deve usar a mesma janela (30 dias) para consistência.

**DRE/MCO agregado:** segue `billingMonthFrom/billingMonthTo` (primeiro e último dia do `billingMonth`, mês-calendário). O `adsSpendMes` já é calculado nessa janela. [VERIFIED: MercadoLivre.tsx linhas 216-222, 255-258]

**Alinhamento de critério de data (D-13):** `orders.data_pedido::date` vs `ml_ads_products_cache.date`. O campo `date` em `ml_ads_products_cache` é a data do job de sync (diário), não a data da venda atribuída. Isso é intencional — o gasto de publicidade ocorre no dia, independentemente de quando a venda é processada. Para alinhar: usar o mesmo range `p_from/p_to` nos dois lados da RPC. Não há descasamento estrutural que precise ser corrigido — é a mesma janela de datas em tabelas diferentes.

---

## Don't Hand-Roll

| Problema | Não construir | Usar em vez disso | Por quê |
|----------|--------------|-------------------|---------|
| Agregação de margem + ads por produto | Loop no browser/hook | RPC SQL com FULL OUTER JOIN | Truncamento PostgREST (1000 linhas), performance, atomicidade |
| Dedup de insights por produto | Lógica de dedup no EF | `ml_user_id_key = item_id` + índice único existente `(org, rule_key, ml_user_id_key)` | Padrão Phase 45 já implementado |
| Cálculo de MCO agregado no browser | Reducer sobre orders | `adsSpendMes` já calculado em MercadoLivre.tsx | Já existe o valor correto |
| Paginação de ads_products_cache | limit/offset no browser | Agregação SQL via CTE | Range query com índice `idx_ads_products_org_user_date` é O(range) |
| Cache de consultor_config | Estado local | Select + spread sobre `DEFAULT_CONFIG` | Padrão existente na EF (linha 173) |

---

## Common Pitfalls

### Pitfall 1: Produtos ads-only não aparecem na nova RPC sem FULL OUTER JOIN
**O que dá errado:** Se usar `get_margin_by_product` como base com apenas um JOIN adicional (INNER ou LEFT de orders), itens que gastaram em ads mas não venderam não aparecem na RPC.
**Por quê acontece:** `get_margin_by_product` é orders-based; sem venda, o item não existe no resultado.
**Como evitar:** Usar FULL OUTER JOIN (ou UNION com CTE separada) entre `orders_side` e `ads_side`. Campo `ads_no_sale` sinaliza este caso. (D-11)
**Sinais de alerta:** Teste: inserir item em `ml_ads_products_cache` sem orders correspondentes e verificar se aparece na RPC.

### Pitfall 2: Pilar Ads do score ignora nova regra ads_eating_margin
**O que dá errado:** Score de saúde não penaliza quando há erosão de ads por produto, mesmo que TACoS esteja OK no agregado.
**Por quê acontece:** O cálculo do `notaAds` em Phase 45 usa apenas `hasCampanhaSemVenda` (ads_no_sale) e TACoS. Não considera erosão por produto.
**Como evitar:** Após calcular `ads_eating_margin`, incluir `activeRuleKeys.includes("ads_eating_margin")` na fórmula do `notaAds` com penalidade adicional.

### Pitfall 3: Dismissed org-level ads_no_sale não é resolvido ao upgrade para item-level
**O que dá errado:** Se o `rule_key` mudar de `"ads_no_sale"` para `"ads_no_sale_product"`, insights antigos com `rule_key="ads_no_sale"` nunca serão auto-resolvidos.
**Por quê acontece:** O auto-resolver filtra por `NOT IN (activeRuleKeys)` — se o `rule_key` antigo não está mais em `activeRuleKeys`, ele fica ativo mas nunca é gerado novamente.
**Como evitar:** Manter `rule_key = "ads_no_sale"` mas mudar `ml_user_id_key` de `""` para `item_id`. O índice único `(org, rule_key, ml_user_id_key)` diferencia org-level (`""`) de item-level (`"MLB123"`). Insights antigos org-level com `ml_user_id_key=""` serão resolvidos quando a regra org-level parar de disparar.

### Pitfall 4: MLAnuncios exibe margem+ads por "preço atual" em vez de por pedidos históricos
**O que dá errado:** A visão "financeiro" atual calcula `marginBruta` e `marginLiq` a partir do `effectivePrice` (preço do anúncio hoje), não de dados históricos de orders. As novas colunas operacional/pós-ads precisam de dados de orders.
**Por quê acontece:** A página não tem hook de margem por produto — apenas custos estáticos.
**Como evitar:** As 2 novas colunas usam `useMLMarginWithAds(from, to)` com o range do ranking. As colunas existentes (Mg. Bruta/Mg. Líq.) permanecem inalteradas (baseadas em preço atual). São conceitualmente diferentes: as existentes são "se eu vender 1 unidade hoje a esse preço", as novas são "margem real dos pedidos no período".

### Pitfall 5: Campo `date` em ml_ads_products_cache não é data de atribuição de venda
**O que dá errado:** Assumir que `date` em `ml_ads_products_cache` é a data em que a venda atribuída ocorreu.
**Por quê acontece:** É a data do job de sync (um dia por run do sync-ads). O campo `attributed_orders` é acumulado do dia.
**Como evitar:** Usar sempre como "gasto de ads no dia X", não "venda atribuída no dia X". O alinhamento com `orders.data_pedido` é por convenção de janela, não por causalidade.

### Pitfall 6: PostgREST 1000 linhas em queries no EF para ads_eating_margin
**O que dá errado:** Se o EF usar `.from("ml_ads_products_cache").select(...)` sem RPC para buscar dados de spend por produto, trunca em 1000 itens para orgs grandes.
**Por quê acontece:** `feedback_postgrest_pagination` — PostgREST tem limite de 1000 linhas sem `Range` header.
**Como evitar:** Dois padrões possíveis: (a) criar RPC `get_consultor_ads_spend_by_product` SECURITY DEFINER; (b) inline no EF com paginação via `.range()` loop. Dado que `ml_ads_products_cache` para 30 dias com ~200 itens = ~6000 linhas, usar RPC ou paginação. O padrão Phase 45 para margens usa RPC (RULE 1/2 usa `get_consultor_margin_by_product`). Para o caso dos ads no engine, uma query paginada com `.range()` ou uma RPC nova são ambas aceitáveis.

### Pitfall 7: linha "Publicidade" no DRE duplicando o valor já nas tarifas ML (fallback)
**O que dá errado:** No fallback estimado (sem billing real), `gruposTarifasEfetivos` já inclui linha "Campanhas de publicidade" com `adsSpendMes`. Se MLCostCard também exibir linha separada "Publicidade", o valor aparece duas vezes.
**Por quê acontece:** `gruposTarifasEfetivos` no modo fallback usa `ads = adsSpendMes` (linha 271 em MercadoLivre.tsx).
**Como evitar:** A linha separada de "Publicidade" no DRE deve ser exibida APENAS quando `fonte === "competencia"` ou `"billing"` (billing real). Quando `fonte === "estimado"`, o valor já está em `gruposTarifasEfetivos`. Ou: remover "Campanhas de publicidade" do fallback estimado e sempre usar a linha separada.

---

## Code Examples

### Padrão da nova RPC (migration)

```sql
-- Source: padrão verificado em 20260527110000_margin_aggregate_rpcs.sql e
--         20260645010000_consultor_engine_rpcs.sql
CREATE OR REPLACE FUNCTION public.get_margin_with_ads_by_product(
  p_org_id   UUID,
  p_user_ids TEXT[],
  p_from     DATE,
  p_to       DATE
)
RETURNS TABLE (
  item_id               TEXT,
  titulo                TEXT,
  sku                   TEXT,
  listing_type          TEXT,
  receita               NUMERIC,
  cmv                   NUMERIC,
  comissao              NUMERIC,
  frete                 NUMERIC,
  impostos              NUMERIC,
  lucro                 NUMERIC,
  lucro_pct             NUMERIC,
  pedidos               BIGINT,
  unidades              BIGINT,
  has_cmv               BOOLEAN,
  ads_spend             NUMERIC,
  ads_attributed_orders BIGINT,
  lucro_pos_ads         NUMERIC,
  lucro_pct_pos_ads     NUMERIC,
  ads_no_sale           BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH orders_side AS (
    SELECT
      o.item_id,
      MAX(o.titulo) titulo, MAX(o.sku) sku, MAX(o.listing_type) listing_type,
      COALESCE(SUM(o.receita_bruta), 0)                         AS receita,
      COALESCE(SUM(o.custo_unit * o.quantidade), 0)             AS cmv,
      COALESCE(SUM(o.comissao), 0)                              AS comissao,
      COALESCE(SUM(o.frete), 0)                                 AS frete,
      COALESCE(SUM(o.tax_amount), 0)                            AS impostos,
      COALESCE(SUM(o.receita_bruta - COALESCE(o.custo_unit * o.quantidade, 0)
        - COALESCE(o.comissao, 0) - COALESCE(o.frete, 0) - COALESCE(o.tax_amount, 0)), 0) AS lucro,
      COUNT(*)                                                   AS pedidos,
      COALESCE(SUM(o.quantidade), 0)                            AS unidades,
      BOOL_OR(o.custo_unit IS NOT NULL)                         AS has_cmv
    FROM public.orders o
    WHERE o.organization_id = p_org_id
      AND o.ml_user_id = ANY(p_user_ids)
      AND o.status IN ('paid', 'shipped', 'delivered')
      AND o.data_pedido::date BETWEEN p_from AND p_to
      AND o.item_id IS NOT NULL
    GROUP BY o.item_id
  ),
  ads_side AS (
    SELECT
      a.item_id,
      MAX(a.title)                   AS ads_title,
      COALESCE(SUM(a.spend), 0)      AS ads_spend,
      COALESCE(SUM(a.attributed_orders), 0) AS ads_attributed_orders
    FROM public.ml_ads_products_cache a
    WHERE a.organization_id = p_org_id
      AND a.ml_user_id = ANY(p_user_ids)
      AND a.date BETWEEN p_from AND p_to
    GROUP BY a.item_id
  )
  SELECT
    COALESCE(o.item_id, a.item_id)     AS item_id,
    COALESCE(o.titulo, a.ads_title)    AS titulo,
    o.sku,
    o.listing_type,
    COALESCE(o.receita, 0)             AS receita,
    COALESCE(o.cmv, 0)                 AS cmv,
    COALESCE(o.comissao, 0)            AS comissao,
    COALESCE(o.frete, 0)               AS frete,
    COALESCE(o.impostos, 0)            AS impostos,
    COALESCE(o.lucro, 0)               AS lucro,
    CASE WHEN COALESCE(o.receita, 0) > 0
      THEN ROUND(COALESCE(o.lucro, 0) / o.receita * 100, 2)
      ELSE NULL END                    AS lucro_pct,
    COALESCE(o.pedidos, 0)             AS pedidos,
    COALESCE(o.unidades, 0)            AS unidades,
    COALESCE(o.has_cmv, false)         AS has_cmv,
    COALESCE(a.ads_spend, 0)           AS ads_spend,
    COALESCE(a.ads_attributed_orders, 0) AS ads_attributed_orders,
    COALESCE(o.lucro, 0) - COALESCE(a.ads_spend, 0) AS lucro_pos_ads,
    CASE WHEN COALESCE(o.receita, 0) > 0
      THEN ROUND((COALESCE(o.lucro, 0) - COALESCE(a.ads_spend, 0)) / o.receita * 100, 2)
      ELSE NULL END                    AS lucro_pct_pos_ads,
    (COALESCE(a.ads_spend, 0) > 0 AND COALESCE(a.ads_attributed_orders, 0) = 0) AS ads_no_sale
  FROM orders_side o
  FULL OUTER JOIN ads_side a USING (item_id)
  ORDER BY COALESCE(o.receita, 0) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_margin_with_ads_by_product(UUID, TEXT[], DATE, DATE) TO authenticated;
```

### Padrão do hook useMLMarginWithAds

```typescript
// Source: padrão verificado em src/hooks/useMLMarginAnalysis.ts
export interface ProductMarginWithAds {
  item_id: string;
  titulo: string;
  sku: string | null;
  receita: number;
  lucro: number;             // operacional (sem ads)
  lucro_pct: number | null;  // operacional
  ads_spend: number;
  ads_attributed_orders: number;
  lucro_pos_ads: number;
  lucro_pct_pos_ads: number | null;
  ads_no_sale: boolean;
  pedidos: number;
  has_cmv: boolean;
}

export function useMLMarginWithAds(dateFrom: string, dateTo: string) {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();

  return useQuery({
    queryKey: ["ml_margin_with_ads", currentOrg?.id, resolvedMLUserIds, dateFrom, dateTo],
    queryFn: async (): Promise<ProductMarginWithAds[]> => {
      if (!currentOrg?.id || !resolvedMLUserIds.length) return [];
      const { data, error } = await supabase.rpc("get_margin_with_ads_by_product", {
        p_org_id: currentOrg.id,
        p_user_ids: resolvedMLUserIds,
        p_from: dateFrom.substring(0, 10),
        p_to: dateTo.substring(0, 10),
      });
      if (error) throw error;
      return (data ?? []).map(r => ({
        item_id: String(r.item_id),
        titulo: String(r.titulo ?? ""),
        sku: r.sku ? String(r.sku) : null,
        receita: Number(r.receita),
        lucro: Number(r.lucro),
        lucro_pct: r.lucro_pct != null ? Number(r.lucro_pct) : null,
        ads_spend: Number(r.ads_spend),
        ads_attributed_orders: Number(r.ads_attributed_orders),
        lucro_pos_ads: Number(r.lucro_pos_ads),
        lucro_pct_pos_ads: r.lucro_pct_pos_ads != null ? Number(r.lucro_pct_pos_ads) : null,
        ads_no_sale: Boolean(r.ads_no_sale),
        pedidos: Number(r.pedidos),
        has_cmv: Boolean(r.has_cmv),
      }));
    },
    enabled: !!currentOrg?.id && resolvedMLUserIds.length > 0,
    staleTime: 2 * 60 * 1000,
  });
}
```

### Padrão da RULE ads_eating_margin no engine (index.ts)

```typescript
// Source: padrão verificado em consultor-insights/index.ts RULE 1/2
// Inserir após RULE 2 (margin_alert), antes de RULE 3 (ads_no_sale)

// RULE ads_eating_margin: lucro operacional > 0 mas pós-ads ≤ limiar
// Usa mesma janela que RULE 1/2 (30 dias)
// Source de dados: RPC get_margin_with_ads_by_product ou query inline paginada
const adsEatingCriticalPct = (cfg as any).ads_eating_critical_pct ?? 0;
const adsEatingAlertPct    = (cfg as any).ads_eating_alert_pct ?? 10;

const { data: marginWithAdsRows } = await sb.rpc("get_margin_with_ads_by_product", {
  p_org_id: orgId,
  p_user_ids: mlUserIds,
  p_from: marginFrom,
  p_to: marginTo,
});

if (marginWithAdsRows && (marginWithAdsRows as any[]).length > 0) {
  type MWARow = { item_id: string; receita: number; lucro: number; lucro_pct: number;
                  ads_spend: number; lucro_pos_ads: number; lucro_pct_pos_ads: number | null };
  const rows = marginWithAdsRows as MWARow[];

  // Crítico: operacional > 0 mas pós-ads ≤ 0%
  const criticalAdsItems = rows.filter(
    r => r.lucro > 0 && r.lucro_pct_pos_ads !== null && r.lucro_pct_pos_ads <= adsEatingCriticalPct
  );
  if (criticalAdsItems.length > 0) {
    // Um insight por item (ml_user_id_key = item_id)
    for (const item of criticalAdsItems) {
      const erosao = item.lucro - item.lucro_pos_ads;
      activeRuleKeys.push("ads_eating_margin");
      candidates.push({
        organization_id: orgId,
        ml_user_id: null,
        ml_user_id_key: item.item_id,  // dedup por produto
        rule_key: "ads_eating_margin",
        category: "Ads",
        severity: "critical",
        title: `Publicidade zerando o lucro do produto`,
        body: `O produto tem lucro operacional positivo de ${item.lucro_pct?.toFixed(1)}%, mas a publicidade está consumindo R$ ${fmt(erosao)} — a margem cai de ${item.lucro_pct?.toFixed(1)}% para ${item.lucro_pct_pos_ads?.toFixed(1)}%.`,
        action_label: "Ver anúncio",
        action_href: "/anuncios?items=" + item.item_id,
        impact_brl: Math.round(erosao * (30 / 30)), // janela = 30 dias
        status: "active",
        updated_at: nowIso,
      });
    }
  }
}
```

### Prop adsTotalMes no MLCostCard

```typescript
// Source: padrão verificado em MLCostCard.tsx + MercadoLivre.tsx
// Adicionar prop adsTotalMes: number | null ao MLCostCardProps
// Exibir linha APÓS impostos e ANTES do separador de Lucro:

{/* ── Publicidade (MCO) ── */}
{adsTotalMes != null && adsTotalMes > 0 && (
  <div className="flex items-center justify-between text-xs py-1">
    <span className="text-muted-foreground flex items-center gap-1">
      <span className="text-muted-foreground/50">(−)</span>
      Publicidade (ads ML)
    </span>
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
        {pct(adsTotalMes, receitaMes)}
      </span>
      <span className="font-semibold tabular-nums w-24 text-right text-foreground">
        {fmt(adsTotalMes)}
      </span>
    </div>
  </div>
)}
```

Lucro do mês deve então incluir ads:
```typescript
const lucro = receitaMes - totalTarifas - (cmvMes ?? 0) - (impostosMes ?? 0) - (adsTotalMes ?? 0);
```

---

## Validation Architecture

### Verificações obrigatórias (padrão da plataforma)

| Req ID | Comportamento | Tipo | Comando | Arquivo |
|--------|--------------|------|---------|---------|
| MCO-01 | RPC retorna dados sem truncamento | smoke SQL | `SELECT COUNT(*) FROM get_margin_with_ads_by_product(...)` | migration |
| MCO-01 | FULL OUTER JOIN: itens ads-only aparecem | assertion SQL | Itens com ads_spend > 0 e receita = 0 presentes no resultado | migration |
| MCO-02 | Colunas operacional + pós-ads visíveis em /anuncios | visual | Ver 2 colunas novas na tabela com columnView=financeiro | MLAnuncios.tsx |
| MCO-03 | Linha "Publicidade" no DRE com valor não-nulo | visual | Card DRE em / mostra linha Publicidade com R$ real | MercadoLivre.tsx |
| MCO-04 | Insight ads_eating_margin gravado em insights | SQL | `SELECT * FROM insights WHERE rule_key='ads_eating_margin'` | EF |
| MCO-04 | Insight ads_eating_margin SEPARADO de margin_critical | SQL | Verificar que produto pode ter os dois ou só um | EF |
| MCO-05 | ads_no_sale por produto (não mais só org-level) | SQL | `SELECT * FROM insights WHERE rule_key='ads_no_sale' AND ml_user_id_key != ''` | EF |

### Smoke de deploy padrão da plataforma

```bash
# Verificar EF deployada
supabase functions list --project-ref ckcdevcxgvueywivefgx

# Verificar RPC aplicada
SELECT proname FROM pg_proc WHERE proname = 'get_margin_with_ads_by_product';

# Verificar novas colunas em consultor_config
SELECT ads_eating_critical_pct, ads_eating_alert_pct FROM consultor_config LIMIT 1;

# Invocar EF on-demand (modo org_only via JWT)
curl -X POST https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/consultor-insights \
  -H "Authorization: Bearer <user_jwt>" \
  -d '{}' | jq .insights_count
```

---

## Security Domain

### ASVS aplicável (sem mudanças — padrão da plataforma)

| Categoria ASVS | Aplica | Controle padrão |
|----------------|--------|-----------------|
| V4 Access Control | sim | RPC SECURITY DEFINER + GRANT apenas authenticated; EF dual-auth (service_role + JWT) |
| V5 Input Validation | sim | Parâmetros RPC tipados (UUID, TEXT[], DATE); EF rejeita sem auth (401) |
| V3 Session | sim | verify_jwt=false na EF, autenticação interna — padrão Phase 45 |

### Ameaças específicas desta fase

| Ameaça | Mitigação |
|--------|-----------|
| Insight por item com `ml_user_id_key=item_id` — vazamento cross-org | Filtro `organization_id = p_org_id` na RPC + `eq("organization_id", orgId)` na EF |
| Upsert de insights per-item gera explosion de linhas | `rule_key + ml_user_id_key` dedup; dismissed não re-ativado (T-45-08) |
| Score penalizado indevidamente por item de outra org | RPC escope por org + user_ids — sem vazamento |

---

## Environment Availability

Não aplicável — sem dependências externas além do stack existente (Supabase ckcdevcxgvueywivefgx já ativo, EF Deno já deployada, React SPA já rodando).

---

## Assumptions Log

| # | Claim | Seção | Risco se Errado |
|---|-------|-------|-----------------|
| A1 | Σ ml_ads_products_cache.spend ≤ ml_ads_daily_cache.spend para o mesmo período (gap = campanhas sem item_id) | MCO-03/D-12 | MCO agregado usando products_cache em vez de daily_cache subestimaria o gasto total — já mitigado por D-12 que usa daily_cache |
| A2 | `get_margin_with_ads_by_product` chamada com JWT authenticated (não service_role) tem performance aceitável para top 500 produtos | MCO-01 | Se lenta, pode precisar de RPC separada SECURITY DEFINER chamada pela EF; frontend usa versão paginada ou limitada |
| A3 | O ranking de MLAnuncios usa as variáveis `rankingPeriod/rankingRange` para definir from/to — confirmado pelo código mas a exposição de `rankingFrom/rankingTo` como strings ao hook é à discrição do planner | MCO-02 | Hook pode precisar de from/to calculados localmente em vez de receber da página |

**Todos os outros claims neste research foram verificados diretamente no codebase.** Nenhuma fonte externa consultada — codebase é a fonte de verdade.

---

## Sources

### PRIMARY (HIGH confidence — verificado diretamente no codebase)

- `supabase/migrations/20260527110000_margin_aggregate_rpcs.sql` — assinatura exata de `get_margin_by_product`, status filter, colunas retornadas
- `supabase/migrations/20260406143415_a0ec5aee-*.sql` — criação original de `ml_ads_products_cache` e `ml_ads_daily_cache`
- `supabase/migrations/20260423153544_*.sql` — adição de `organization_id` em todas as tabelas de ads
- `supabase/migrations/20260522_ads_products_daily.sql` — coluna `date`, constraint `(org, user, item, date)`, índice
- `supabase/migrations/20260604140000_drop_obsolete_ads_products_unique.sql` — constraint final atual confirmada
- `supabase/functions/sync-ads/index.ts` — como products_cache e daily_cache são populados (delete+upsert, granularidade, derivação de dailyAgg)
- `supabase/functions/consultor-insights/index.ts` — padrão de regra, ConsultorConfig, InsightCandidate, RULE 3 org-level, pilar Ads score (peso 25)
- `supabase/migrations/20260645000000_consultor_tables.sql` — schema de `insights`, `consultor_config` (todas as colunas), `consultor_health_snapshots`
- `supabase/migrations/20260645010000_consultor_engine_rpcs.sql` — padrão SECURITY DEFINER, `get_consultor_margin_by_product`
- `src/components/mercadolivre/MLCostCard.tsx` — props, cálculo de lucro, estrutura de linhas DRE
- `src/pages/MercadoLivre.tsx` — `adsSpendMes`, `dreWaterfall`, `billingMonthFrom/To`, chamada a MLCostCard
- `src/hooks/useMLMarginAnalysis.ts` — padrão de hook RPC, tipos `ProductMarginRow`, `MarginSummary`
- `src/hooks/useMLProductMargins.ts` — hook atual (combina operacional+ads — será substituído/complementado)
- `src/hooks/useMLAdsDerivedMetrics.ts` — padrão EnrichedAdsProduct, acesso a ml_product_costs
- `src/pages/mercadolivre/MLAnuncios.tsx` — `columnView === "financeiro"`, colunas atuais (Custo/Impostos/Comissão/Mg.Bruta/Mg.Líq.), ausência de hook de margem com orders

---

## Metadata

**Confiança por área:**
- Schema de tabelas: HIGH — verificado em migrations
- Padrão de regra EF: HIGH — código lido diretamente
- Nova RPC: HIGH — estrutura derivada de padrão verificado (get_margin_by_product + consultor engine_rpcs)
- Integração frontend: HIGH — hooks e componentes lidos diretamente
- Reconciliação ads_products vs ads_daily: MEDIUM — lógica derivada do código sync-ads; comportamento de campanhas sem item_id confirmado mas não testado em produção

**Data da pesquisa:** 2026-06-14
**Válido até:** 2026-07-14 (stack estável; migrations não mudam frequentemente)
