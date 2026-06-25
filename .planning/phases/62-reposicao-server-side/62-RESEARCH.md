# Phase 62: Reposição Server-Side — Research

**Researched:** 2026-06-25
**Domain:** Supabase RPC (PostgreSQL SECURITY INVOKER) + React Query + Estoque ML
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Onde calcular:** Abordagem B — RPC `get_replenishment` no banco. `SECURITY INVOKER`, escopada por org (sem depender de `org_id` como único gate de segurança — anti-IDOR via RLS), paginável via `.range()`. Mesmo padrão validado nas Phases 59/60 (`get_cashflow`). NÃO calcular no front.
- **Estoque atual:** `ml_inventory_cache` (tudo no ML: Full + anúncios). Read-only da fonte; NÃO digitado pelo usuário. Sem sync novo necessário.
- **"A chegar" (OC/trânsito):** v1 NÃO desconta compras em trânsito. A tela exibe aviso explícito.
- **Venda/dia:** Média de vendas REAIS numa janela (default 30d) — NÃO a `priceCurve` simulada do snapshot.
- **Parâmetros:** Tabela `replenishment_params` com global + override por marca/fornecedor. Precedência: marca > fornecedor > global (fornecedor = v2 — hoje só global e marca).
- **Custo nulo:** sugere quantidade, marca `custo_ausente`, NÃO calcula valor R$.
- **Sem giro:** `venda_dia = 0` → compra 0 + flag `sem_giro` se houver estoque.
- **Tela:** `/estoque` → novo painel consumindo a RPC. Colunas read-only da fonte (substitui inputs digitados).
- **Fórmula (travada):**
  ```
  venda_dia        = SUM(qty_sold na janela) / window_days
  demanda_lead     = venda_dia × lead_time_dias
  estoque_seg      = venda_dia × safety_days
  ponto_reposicao  = demanda_lead + estoque_seg
  alvo             = venda_dia × meta_cobertura_dias + estoque_seg
  GATILHO: só sugere se estoque_atual ≤ ponto_reposicao
  necessidade      = max(0, alvo − estoque_atual)
  compra_sugerida  = ceil(necessidade / pack_multiple) × pack_multiple, respeitando MOQ
  valor_estimado   = compra_sugerida × custo_unit (ou custo_ausente=true)
  ```

### Claude's Discretion
- Esquema exato de colunas de `replenishment_params` e da assinatura da RPC.
- Fonte exata da agregação de venda real (confirmar `ml_product_daily_cache`).
- Como resolver "fornecedor" por item (v1: override só por MARCA; fornecedor é v2).
- Forma de aplicar MOQ vs pack_multiple quando ambos > 1.

### Deferred Ideas (OUT OF SCOPE)
- Reposição por tamanho/variação.
- Descontar "a chegar" (OC/trânsito).
- Snapshot materializado + histórico/auditoria da sugestão.
- Override por fornecedor (v1 só suporta global e marca).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REPL-01 | RPC `get_replenishment` SECURITY INVOKER, escopada por org, paginável | Pattern verificado em `get_cashflow` (20260659000000) e `get_margin_with_ads_by_product` (20260615120000) |
| REPL-02 | Estoque atual = `ml_inventory_cache` (Full + anúncios), read-only | Schema confirmado: `available_quantity INTEGER`, sem filtro por `logistic_type` |
| REPL-03 | Venda/dia = média de vendas reais na janela 30d | Fonte confirmada: `ml_product_daily_cache.qty_sold`; padrão em `get_consultor_coverage` |
| REPL-04 | Ponto de reposição com gatilho (só sugere se estoque ≤ ponto) | Fórmula travada na CONTEXT; lógica SQL mapeada |
| REPL-05 | Tabela `replenishment_params` global + override por marca | DDL proposto abaixo; precedência COALESCE na RPC |
| REPL-06 | MOQ + múltiplo de embalagem (arredonda pra cima) | `ceil(necessidade / pack_multiple) × pack_multiple, max(MOQ)` |
| REPL-07 | Custo nulo — marca `custo_ausente`, não calcula R$ | Join via `item_id` + fallback `seller_sku`; causa raiz conhecida |
| REPL-08 | Sem giro — `venda_dia = 0` → não sugere, flag `sem_giro` | Condição CASE no SQL |
| REPL-09 | NÃO desconta "a chegar"; exibe aviso explícito na UI | Sem join com OCs; aviso hardcoded no componente |
| REPL-10 | UI read-only: produto/marca, venda/dia, estoque, cobertura atual, ponto reposição, sugestão, valor, flags, params com origem | Novo componente em `/estoque` (NEW, não substitui painel atual em `/precos-custos`) |
| REPL-11 | Testes unitários da fórmula + casos da RPC | Vitest; espelhar estilo de `compraUtils.test.ts` |
</phase_requirements>

---

## Summary

A Phase 62 substitui o cálculo de "Compra Recomendada" feito hoje no front (`compraUtils.ts` + `CompraRecomendadaPanel` no `/precos-custos/analise`) por uma RPC PostgreSQL `get_replenishment` que lê dados reais: estoque de `ml_inventory_cache`, vendas de `ml_product_daily_cache`, custo de `ml_product_costs`, e parâmetros de uma nova tabela `replenishment_params`. A RPC implementa o modelo de ponto de reposição (lead time + estoque de segurança + gatilho) com MOQ e múltiplo de embalagem.

**Descoberta crítica:** O `CompraRecomendadaPanel.tsx` atual está em `/precos-custos` (via `AnaliseDashboard.tsx`), NÃO em `/estoque`. Phase 62 cria um NOVO componente para a aba `/estoque`, sem remover o painel antigo (que continua útil para análise de preços). As incógnitas do CONTEXT.md foram todas resolvidas por inspeção direta do schema e das migrations.

**Primary recommendation:** Criar a migration `replenishment_params` + RPC `get_replenishment` (SECURITY INVOKER, REVOKE/GRANT padrão get_cashflow), um hook `useReplenishment.ts` (React Query), e um novo componente `ReplenishmentPanel.tsx` montado como nova tab em `MLEstoque.tsx`. Aplicar migration via MCP `apply_migration` no projeto `ckcdevcxgvueywivefgx`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cálculo de ponto de reposição | Database (RPC) | — | Decisão travada (Abordagem B); dados reais vivem no banco |
| Estoque real | Database (ml_inventory_cache) | — | Fonte de verdade ML; já sincronizado |
| Venda/dia real | Database (ml_product_daily_cache) | — | Agregação de 30d barata em SQL vs N fetches no front |
| Parâmetros (lead time, MOQ, etc.) | Database (replenishment_params) | — | Config persistente por org/marca |
| Custo unitário | Database (ml_product_costs) | — | Já existe; null é causa conhecida (Tiny) |
| Exibição da sugestão | Browser / Client | — | Read-only; React Query + shadcn/ui |
| Aviso "não considera a chegar" | Browser / Client | — | Texto fixo no componente |
| Testes da fórmula | Client (Vitest) | — | Testa função TS pura equivalente à lógica da RPC |

---

## Incógnitas Resolvidas

### 1. Venda/dia real — fonte e query

**VERIFICADO por inspeção de `useMLCoverage.ts` e `get_consultor_coverage` (20260645010000)**

Fonte: `ml_product_daily_cache`
- Colunas relevantes: `item_id TEXT`, `qty_sold INTEGER`, `date DATE`, `organization_id UUID`, `ml_user_id TEXT`
- Unique constraint: `(organization_id, ml_user_id, date, item_id)` — uma linha por anúncio por dia por loja
- RLS: `is_org_member(auth.uid(), organization_id)` [VERIFIED: 20260423153544 migration]

**Query padrão (do `get_consultor_coverage`):**
```sql
SELECT item_id, COALESCE(SUM(qty_sold), 0) / 30.0 AS avg_daily
FROM ml_product_daily_cache
WHERE organization_id = p_org_id
  AND date >= (CURRENT_DATE - p_sales_window_days)
GROUP BY item_id
```

**Mapeamento "por anúncio":** `item_id` é o MLB... da listagem. O join com `ml_inventory_cache` é direto via `item_id`. Não usar `seller_sku` para a venda — a coluna `seller_sku` existe em `ml_product_daily_cache` (migration 20260604120000) mas NÃO está nos types.ts (stale); join por `item_id` é mais seguro.

**Multi-store:** `ml_product_daily_cache` tem `ml_user_id`. Para a Pé Vermeio (1 loja), filtrar por org_id é suficiente. Para multi-store orgs, a RPC deve somar across ALL ml_user_ids da org (não filtrar por ml_user_id), assim como `get_cashflow` não filtra por loja.

**Existência de RPC/hook agregador:** `useMLCoverage.ts` faz esse cálculo no front (linha 86–98). `get_consultor_coverage` (DEFINER, só para service_role) faz em SQL. A nova `get_replenishment` fará a mesma agregação embutida.

---

### 2. Estoque atual (Full + anúncios) — schema completo

**VERIFIED: `supabase/migrations/20260519150000_ml_inventory_cache.sql` + `src/integrations/supabase/types.ts`**

```
ml_inventory_cache (
  organization_id UUID NOT NULL,  -- FK organizations
  ml_user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,          -- MLB... (PK component)
  title TEXT,
  status TEXT,                    -- 'active', 'paused', etc.
  available_quantity INTEGER NOT NULL DEFAULT 0,  -- estoque total desta listagem
  sold_quantity INTEGER NOT NULL DEFAULT 0,
  price NUMERIC,
  thumbnail TEXT,
  brand TEXT,                     -- usado para override por marca
  seller_custom_field TEXT,       -- = seller_sku; ponte com ml_product_costs
  has_variations BOOLEAN NOT NULL DEFAULT false,
  variations JSONB NOT NULL DEFAULT '[]',
  logistic_type TEXT,             -- 'fulfillment'=Full, 'default', 'drop_off', etc.
  free_shipping BOOLEAN NOT NULL DEFAULT false,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, ml_user_id, item_id)
)
```

**Como somar "Full + anúncios":** Um item_id tem UMA linha em ml_inventory_cache independente do logistic_type. O `available_quantity` já é o total daquele anúncio. NÃO filtrar por `logistic_type` = "Full + anúncios" automaticamente.

**Phase 58 context:** O bug de VERAC era filtrar só `logistic_type='fulfillment'` no Nexo. Para `get_replenishment`, NÃO filtrar logistic_type corrige esse bug.

**Status filter:** Usar `status = 'active'` para v1 (consistente com `get_consultor_coverage`). Items paused não precisam de sugestão de compra imediata.

**Multi-store:** Um item_id pode aparecer em múltiplos ml_user_ids (se o mesmo produto é vendido por múltiplas lojas). Para somar estoque total da org: `SUM(available_quantity) GROUP BY item_id`. Para v1 (Pé Vermeio = 1 loja), isso é equivalente a não somar.

---

### 3. Custo unitário — tabela e por que fica nulo

**VERIFIED: `supabase/migrations/20260514120000_ml_product_costs.sql` + Phase 37 notes no STATE.md + `useMLProductCosts.ts`**

```
ml_product_costs (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,          -- auditoria (não é o scope de RLS)
  item_id TEXT NOT NULL,          -- "TINY_{sku}" para custos do Tiny; MLB... para edição manual
  cost NUMERIC(12,2),             -- custo unitário em R$
  tax_rate NUMERIC(6,4),
  seller_sku TEXT,                -- SKU do Tiny; bridge com inventory.seller_custom_field
  organization_id UUID,           -- RLS org-first (Phase 43)
  updated_at TIMESTAMPTZ
)
```

**Por que fica nulo:** Custos do Tiny chegam via `sync-tiny-costs` com `item_id = "TINY_{seller_sku}"`. O join entre `ml_inventory_cache.item_id` (MLB...) e `ml_product_costs.item_id` (TINY_{sku}) nunca casa diretamente. A ponte é `ml_inventory_cache.seller_custom_field = ml_product_costs.seller_sku`. Marcas de revenda que não têm custo cadastrado no Tiny simplesmente não têm linha em `ml_product_costs`.

**Join na RPC:**
```sql
LEFT JOIN ml_product_costs c
  ON c.organization_id = p_org_id
  AND (
    c.item_id = i.item_id
    OR (c.seller_sku IS NOT NULL AND c.seller_sku = i.seller_custom_field)
  )
```

Se múltiplas linhas de custo casam (improvável mas possível se item_id E seller_sku ambos existem), usar `DISTINCT ON` ou subquery com `LIMIT 1` ordenada por `updated_at DESC`.

**Flag `custo_ausente`:** `cost IS NULL` → `custo_ausente = TRUE`, `valor_estimado = NULL`.

---

### 4. Fornecedor por item — resolução

**VERIFIED: `supabase/migrations/20260618100000_cash_flow_tables.sql` + Phase 60/61 STATE.md + schema de ml_inventory_cache**

`supplier` é coluna de `cash_outflows` (contas a pagar do Tiny), enriquecida por Phase 61. Não existe mapeamento `item_id → supplier` em nenhuma tabela do schema.

**Decisão para v1:** Override em `replenishment_params` apenas por `scope='marca'`. Override por fornecedor (scope='fornecedor') é evolução futura, não entra no v1.

**Implicação:** A coluna `scope` em `replenishment_params` aceita só `'global'` e `'marca'` por ora. O campo `scope_value` é o nome da marca (de `ml_inventory_cache.brand`).

---

### 5. Padrão RPC SECURITY INVOKER + RLS org-first

**VERIFIED: `20260659000000_cashflow_projection_7d_rule.sql` (get_cashflow) + `20260615120000_margin_with_ads_rpc.sql` (get_margin_with_ads_by_product)**

**Padrão canônico a espelhar (get_cashflow, Phase 59):**
```sql
CREATE OR REPLACE FUNCTION public.get_replenishment(
  p_org_id            UUID,
  p_sales_window_days INTEGER  DEFAULT 30,
  p_demand_multiplier NUMERIC  DEFAULT 1.0
)
RETURNS TABLE ( ... )
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$
  -- corpo
$$;

REVOKE EXECUTE ON FUNCTION public.get_replenishment(UUID, INTEGER, NUMERIC) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_replenishment(UUID, INTEGER, NUMERIC) TO authenticated;
```

**Por que SECURITY INVOKER (não DEFINER):**
- RLS de `ml_inventory_cache` e `ml_product_daily_cache` usam `is_org_member(auth.uid(), organization_id)`
- Com INVOKER, o caller roda como o usuário autenticado → RLS aplica
- Passar `p_org_id` de outra org não vaza dados porque RLS filtra → anti-IDOR por construção
- Padrão explicitado em STATE.md: "SECURITY INVOKER (não DEFINER) para RPCs de margem: RLS org-first enforça isolamento de tenant; DEFINER era IDOR CRITICAL"

**REVOKE/GRANT:** Sempre REVOKE PUBLIC + anon, GRANT authenticated. `get_margin_with_ads_by_product` só tem GRANT (sem REVOKE explícito); `get_cashflow` tem ambos. Usar o padrão get_cashflow com REVOKE explícito (mais seguro).

**Assinatura final recomendada:**
```sql
get_replenishment(
  p_org_id            UUID,
  p_sales_window_days INTEGER  DEFAULT 30,    -- janela de venda (default 30d)
  p_demand_multiplier NUMERIC  DEFAULT 1.0    -- multiplicador campanha (1.0/1.2/1.5/2.0)
)
```

**Paginação:** `supabase.rpc('get_replenishment', {...}).range(0, 49)` funciona com set-returning functions. Sem LIMIT na função.

**Frontend call pattern (de `useMLMarginWithAds.ts`):**
```typescript
const { data, error } = await supabase.rpc("get_replenishment", {
  p_org_id:            currentOrg.id,
  p_sales_window_days: 30,
  p_demand_multiplier: 1.0,
});
if (error) throw error;
return data ?? [];
```

---

### 6. Tabela replenishment_params — DDL proposto

**[ASSUMED] — não existe ainda; DDL proposto baseado em padrões do projeto**

```sql
CREATE TABLE public.replenishment_params (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id     UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  scope               TEXT        NOT NULL DEFAULT 'global'
                                  CHECK (scope IN ('global', 'marca')),
  scope_value         TEXT        NOT NULL DEFAULT '',
  -- '' para global; nome da marca para scope='marca' (case-sensitive, igual a ml_inventory_cache.brand)
  lead_time_dias      INTEGER     NOT NULL DEFAULT 30,
  meta_cobertura_dias INTEGER     NOT NULL DEFAULT 60,
  safety_days         INTEGER     NOT NULL DEFAULT 7,
  moq                 INTEGER     NOT NULL DEFAULT 1,
  pack_multiple       INTEGER     NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT replenishment_params_org_scope_unique
    UNIQUE (organization_id, scope, scope_value)
);

-- RLS
ALTER TABLE public.replenishment_params ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rp_select" ON public.replenishment_params
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- ESCRITA: somente owner/admin (NÃO member) — configuração de parâmetros é decisão de gestão.
-- (corrigido após plan-check WARNING 2: 62-01 Task 1 exige ausência de 'member' na write policy)
CREATE POLICY "rp_write" ON public.replenishment_params
  FOR ALL TO authenticated
  USING  (public.get_org_role(auth.uid(), organization_id) = ANY (ARRAY['owner','admin']::public.org_role[]))
  WITH CHECK (public.get_org_role(auth.uid(), organization_id) = ANY (ARRAY['owner','admin']::public.org_role[]));

-- Índice para lookup rápido
CREATE INDEX replenishment_params_org_idx ON public.replenishment_params (organization_id, scope, scope_value);
```

**Inserção de defaults globais na primeira org:** A RPC usa `COALESCE(..., hardcoded_default)` como terceiro nível de fallback — não é necessário inserir linha global automaticamente, mas pode-se fazer via trigger ou via frontend (settings UI em fase futura).

**Resolução de precedência na RPC:**
```sql
-- Para cada item i, resolver params:
COALESCE(
  (SELECT lead_time_dias FROM replenishment_params
   WHERE organization_id = p_org_id
     AND scope = 'marca'
     AND scope_value = COALESCE(i.brand, '')
   LIMIT 1),
  (SELECT lead_time_dias FROM replenishment_params
   WHERE organization_id = p_org_id AND scope = 'global'
   LIMIT 1),
  30  -- fallback hardcoded se nem global existe
) AS lead_time_dias
```

Usar subqueries LATERAL ou CTEs para resolver params uma vez por item_id.

---

### 7. Sistema antigo a substituir — mapeamento exato

**VERIFIED: inspeção de `src/components/mercadolivre/analise/AnaliseDashboard.tsx` + `src/pages/mercadolivre/MLPrecificacao.tsx` + `src/pages/mercadolivre/MLEstoque.tsx`**

**Localização atual do CompraRecomendadaPanel (SURPRESA):**
- `CompraRecomendadaPanel.tsx` está em `src/components/mercadolivre/analise/`
- É montado em `AnaliseDashboard.tsx` → importado em `MLPrecificacao.tsx` (rota `/precos-custos`, aba "Análise")
- **NÃO está em `MLEstoque.tsx`** — a página `/estoque` tem tabs "Estoque" e "Relatórios", sem painel de compra

**Implicação para a Phase 62:**
- Phase 62 cria um NOVO componente (ex: `ReplenishmentPanel.tsx`) e o monta como nova aba ou seção em `MLEstoque.tsx`
- O `CompraRecomendadaPanel.tsx` atual em `/precos-custos` pode ser **mantido** como estava (ainda útil no contexto de análise de preços) ou **depreciado** — decisão a confirmar com Wesley
- Recomendação: manter o antigo (evita regressão no `/precos-custos`) e criar o novo em `/estoque`

**Arquivos que mudam:**
| Arquivo | Ação |
|---------|------|
| `src/lib/analysis/compraUtils.ts` | NÃO alterar (usado pelo painel antigo) |
| `src/lib/analysis/compraUtils.test.ts` | NÃO alterar (testes do painel antigo) |
| `src/components/mercadolivre/analise/CompraRecomendadaPanel.tsx` | NÃO alterar |
| `src/components/mercadolivre/analise/AnaliseDashboard.tsx` | NÃO alterar |
| `src/pages/mercadolivre/MLEstoque.tsx` | ALTERAR — adicionar nova aba "Compra Recomendada" |
| `src/hooks/useMLCoverage.ts` | NÃO alterar (coverage alerts continuam funcionando) |
| **NOVO** `supabase/migrations/2026XX_replenishment_params.sql` | CRIAR |
| **NOVO** `supabase/migrations/2026XX_get_replenishment_rpc.sql` | CRIAR |
| **NOVO** `src/hooks/useReplenishment.ts` | CRIAR |
| **NOVO** `src/components/mercadolivre/ReplenishmentPanel.tsx` | CRIAR |
| **NOVO** `src/lib/analysis/replenishmentUtils.ts` | CRIAR (fórmula TS pura para testes) |
| **NOVO** `src/lib/analysis/replenishmentUtils.test.ts` | CRIAR (vitest, espelhar compraUtils.test.ts) |
| `src/integrations/supabase/types.ts` | ATUALIZAR manualmente (replenishment_params) |

**useMLCoverage.ts — coexistência:** O hook atual de cobertura lê `ml_product_daily_cache.qty_sold` e calcula `avg_daily_sales` no front. A nova RPC fará o mesmo em SQL. Não há conflito — são dois consumidores da mesma fonte para finalidades diferentes (cobertura de alertas vs. sugestão de compra).

---

### 8. Aplicação de migration e call frontend

**VERIFIED: STATE.md múltiplas referências**

- **NUNCA** usar `supabase db push` (CLI linkado no projeto errado `gionpsuunfkkzzjdubfy`)
- **SEMPRE** aplicar via MCP `apply_migration` no projeto **`ckcdevcxgvueywivefgx`**
- Commitir o arquivo SQL em `supabase/migrations/` antes de aplicar
- Convenção de timestamp: `2026XX000000_nome_descritivo.sql` (baseado na data da fase)

---

## Standard Stack

### Core (sem novas dependências)

| Component | Version/Pattern | Purpose |
|-----------|----------------|---------|
| PostgreSQL (Supabase) | 15.x (via ckcdevcxgvueywivefgx) | RPC `get_replenishment` + tabela `replenishment_params` |
| `@supabase/supabase-js` | 2.98.0 (já instalado) | `supabase.rpc('get_replenishment', ...)` |
| `@tanstack/react-query` | 5.83.0 (já instalado) | `useQuery` para o hook `useReplenishment` |
| `vitest` | 3.2.4 (já instalado) | Testes da fórmula em TS |

**Nenhum novo pacote npm necessário.** Esta phase é puramente SQL + hook + componente sobre a stack existente.

---

## Architecture Patterns

### System Architecture Diagram

```
Browser (/estoque)
  └── ReplenishmentPanel.tsx
       └── useReplenishment.ts  (React Query)
            └── supabase.rpc('get_replenishment', { p_org_id, p_sales_window_days, p_demand_multiplier })
                 └── PostgreSQL: get_replenishment() SECURITY INVOKER
                      ├── ml_inventory_cache  (estoque real, RLS org)
                      ├── ml_product_daily_cache  (venda/dia, RLS org)
                      ├── ml_product_costs  (custo unitário, RLS org)
                      └── replenishment_params  (lead_time, MOQ, etc., RLS org)
                           ├── scope='global'    → fallback
                           └── scope='marca'     → override por brand
```

### Recommended Project Structure

```
supabase/migrations/
├── 20260662000000_replenishment_params.sql   # tabela + RLS
└── 20260662000100_get_replenishment_rpc.sql  # CREATE OR REPLACE FUNCTION

src/
├── hooks/
│   └── useReplenishment.ts                   # React Query hook
├── lib/analysis/
│   ├── replenishmentUtils.ts                 # fórmula TS pura (para testes)
│   └── replenishmentUtils.test.ts            # vitest
└── components/mercadolivre/
    └── ReplenishmentPanel.tsx                # novo componente em /estoque
```

### Pattern 1: RPC SECURITY INVOKER (padrão get_cashflow)

```sql
-- Source: supabase/migrations/20260659000000_cashflow_projection_7d_rule.sql
CREATE OR REPLACE FUNCTION public.get_replenishment(
  p_org_id            UUID,
  p_sales_window_days INTEGER DEFAULT 30,
  p_demand_multiplier NUMERIC DEFAULT 1.0
)
RETURNS TABLE (
  item_id           TEXT,
  title             TEXT,
  brand             TEXT,
  logistic_type     TEXT,
  estoque_atual     INTEGER,
  venda_dia         NUMERIC,
  cobertura_atual   NUMERIC,  -- dias; NULL se sem giro
  ponto_reposicao   NUMERIC,
  alvo              NUMERIC,
  compra_sugerida   INTEGER,
  valor_estimado    NUMERIC,  -- NULL se custo_ausente
  custo_ausente     BOOLEAN,
  sem_giro          BOOLEAN,
  gatilho_ativo     BOOLEAN,  -- estoque_atual <= ponto_reposicao
  param_lead_time   INTEGER,  -- valor usado (para exibir origem)
  param_cobertura   INTEGER,
  param_safety      INTEGER,
  param_moq         INTEGER,
  param_pack        INTEGER,
  param_origem      TEXT      -- 'global' ou 'marca'
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
  v_cutoff DATE := CURRENT_DATE - p_sales_window_days;
BEGIN
  RETURN QUERY
  WITH sales AS (
    SELECT s.item_id, COALESCE(SUM(s.qty_sold), 0)::NUMERIC / p_sales_window_days AS avg_daily
    FROM ml_product_daily_cache s
    WHERE s.organization_id = p_org_id AND s.date >= v_cutoff
    GROUP BY s.item_id
  ),
  inventory AS (
    SELECT DISTINCT ON (i.item_id)
           i.item_id, i.title, i.brand,
           i.logistic_type, i.seller_custom_field, i.available_quantity
    FROM ml_inventory_cache i
    WHERE i.organization_id = p_org_id AND i.status = 'active'
    ORDER BY i.item_id, i.ml_user_id
  ),
  costs AS (
    SELECT DISTINCT ON (c.item_id)
           c.item_id AS c_item_id, c.seller_sku AS c_seller_sku, c.cost
    FROM ml_product_costs c
    WHERE c.organization_id = p_org_id
    ORDER BY c.item_id, c.updated_at DESC
  ),
  params AS (
    SELECT
      inv.item_id,
      COALESCE(
        (SELECT rp.lead_time_dias FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope='marca'
           AND rp.scope_value = COALESCE(inv.brand,'') LIMIT 1),
        (SELECT rp.lead_time_dias FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope='global' LIMIT 1),
        30
      ) AS lead_time_dias,
      -- idem para meta_cobertura_dias, safety_days, moq, pack_multiple
      -- (ver migration completa)
      CASE
        WHEN EXISTS (SELECT 1 FROM replenishment_params rp
                     WHERE rp.organization_id = p_org_id AND rp.scope='marca'
                       AND rp.scope_value = COALESCE(inv.brand,''))
        THEN 'marca' ELSE 'global'
      END AS param_origem
    FROM inventory inv
  )
  SELECT
    inv.item_id,
    inv.title,
    inv.brand,
    inv.logistic_type,
    inv.available_quantity                                         AS estoque_atual,
    COALESCE(s.avg_daily, 0) * p_demand_multiplier                AS venda_dia,
    CASE WHEN COALESCE(s.avg_daily,0) > 0
      THEN inv.available_quantity / (COALESCE(s.avg_daily,0) * p_demand_multiplier)
      ELSE NULL END                                               AS cobertura_atual,
    -- ponto_reposicao = venda_dia * lead_time + venda_dia * safety
    COALESCE(s.avg_daily,0)*p_demand_multiplier*(p.lead_time_dias+p.safety_days) AS ponto_reposicao,
    -- alvo = venda_dia * meta_cobertura + venda_dia * safety
    COALESCE(s.avg_daily,0)*p_demand_multiplier*(p.meta_cobertura_dias+p.safety_days) AS alvo,
    -- compra_sugerida: MOQ + pack arredondamento
    CASE
      WHEN inv.available_quantity > COALESCE(s.avg_daily,0)*p_demand_multiplier*(p.lead_time_dias+p.safety_days)
        THEN 0
      WHEN COALESCE(s.avg_daily,0) = 0 THEN 0
      ELSE GREATEST(
        CEIL(
          GREATEST(0,
            COALESCE(s.avg_daily,0)*p_demand_multiplier*(p.meta_cobertura_dias+p.safety_days)
            - inv.available_quantity
          ) / NULLIF(p.pack_multiple,0)
        ) * p.pack_multiple,
        p.moq
      )::INTEGER
    END                                                           AS compra_sugerida,
    -- valor_estimado
    CASE WHEN c.cost IS NULL THEN NULL
      ELSE GREATEST(0, ...) * c.cost
    END                                                           AS valor_estimado,
    (c.cost IS NULL)                                             AS custo_ausente,
    (COALESCE(s.avg_daily,0) = 0 AND inv.available_quantity > 0) AS sem_giro,
    (inv.available_quantity <= COALESCE(s.avg_daily,0)*p_demand_multiplier*(p.lead_time_dias+p.safety_days)) AS gatilho_ativo,
    p.lead_time_dias, p.meta_cobertura_dias, p.safety_days, p.moq, p.pack_multiple, p.param_origem
  FROM inventory inv
  LEFT JOIN sales s ON s.item_id = inv.item_id
  LEFT JOIN costs c ON c.c_item_id = inv.item_id
                    OR (c.c_seller_sku IS NOT NULL AND c.c_seller_sku = inv.seller_custom_field)
  JOIN  params p ON p.item_id = inv.item_id
  ORDER BY compra_sugerida DESC NULLS LAST, inv.item_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_replenishment(UUID, INTEGER, NUMERIC) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_replenishment(UUID, INTEGER, NUMERIC) TO authenticated;
```

> **Nota:** O SQL acima é pseudo-código condensado para ilustrar a estrutura. A migration real deve expandir o COALESCE para todos os campos de params (lead_time, meta_cobertura, safety, moq, pack). Usar LATERAL ou CTE dedicada para params é mais legível que inline subqueries repetidas.

### Pattern 2: React Query hook (padrão `useMLMarginWithAds.ts`)

```typescript
// Source: src/hooks/useMLMarginWithAds.ts
export function useReplenishment(salesWindowDays = 30, demandMultiplier = 1.0) {
  const { resolvedMLUserIds } = useMLStore(); // para queryKey; não passa para RPC
  const { currentOrg } = useOrganization();

  return useQuery({
    queryKey: ["get_replenishment", currentOrg?.id, salesWindowDays, demandMultiplier] as const,
    queryFn: async (): Promise<ReplenishmentRow[]> => {
      if (!currentOrg?.id) return [];
      const { data, error } = await supabase.rpc("get_replenishment", {
        p_org_id:            currentOrg.id,
        p_sales_window_days: salesWindowDays,
        p_demand_multiplier: demandMultiplier,
      });
      if (error) throw error;
      return (data ?? []).map(mapReplenishmentRow);
    },
    enabled: !!currentOrg?.id,
    staleTime: 5 * 60 * 1000, // 5 min (estoque não muda a cada segundo)
  });
}
```

### Pattern 3: fórmula TS pura (para vitest)

```typescript
// src/lib/analysis/replenishmentUtils.ts
export interface ReplenishmentParams {
  leadTimeDias: number;
  metaCoberturaDias: number;
  safetyDays: number;
  moq: number;
  packMultiple: number;
}

export function calcReplenishment(
  estoque: number,
  vendaDia: number,
  params: ReplenishmentParams,
): { compraSugerida: number; gatilhoAtivo: boolean; semGiro: boolean } {
  const semGiro = vendaDia === 0 && estoque > 0;
  if (vendaDia === 0) return { compraSugerida: 0, gatilhoAtivo: false, semGiro };

  const pontoReposicao = vendaDia * (params.leadTimeDias + params.safetyDays);
  const gatilhoAtivo = estoque <= pontoReposicao;
  if (!gatilhoAtivo) return { compraSugerida: 0, gatilhoAtivo, semGiro: false };

  const alvo = vendaDia * (params.metaCoberturaDias + params.safetyDays);
  const necessidade = Math.max(0, alvo - estoque);
  const rounded = Math.ceil(necessidade / params.packMultiple) * params.packMultiple;
  const compraSugerida = Math.max(rounded, params.moq);
  return { compraSugerida, gatilhoAtivo: true, semGiro: false };
}
```

### Anti-Patterns to Avoid

- **Calcular no front:** Bug original — manter toda a lógica de reposição na RPC.
- **SECURITY DEFINER + p_org_id sem RLS:** IDOR CRITICAL (histórico da Phase 43). Sempre INVOKER.
- **Filtrar `logistic_type='fulfillment'`:** Bug do Nexo (VERAC-01). Para estoque total, sem filtro.
- **JOIN ml_product_costs só por item_id:** Majority dos custos Tiny têm item_id="TINY_{sku}". Sempre fazer fallback por seller_sku.
- **REVOKE omitido:** Postgres concede EXECUTE a PUBLIC por default. Sempre REVOKE explícito.
- **`supabase db push`:** CLI linkado no projeto errado. Sempre apply_migration via MCP.
- **Criar novo CompraRecomendadaPanel conflitando com o existente:** O componente atual vive em `/precos-custos/analise`; criar o novo em `/estoque` com nome diferente.
- **types.ts regenerado:** Manter atualização manual (convenção do projeto desde Phase 18).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Cálculo de arredondamento MOQ+pack | Lógica custom frágil | `CEIL(necessidade / pack) × pack, GREATEST(result, moq)` em SQL |
| Agregação de vendas por produto | Loop no front | SQL `SUM(qty_sold) GROUP BY item_id` em RPC |
| Anti-IDOR em RPC | Validação manual de org no código | SECURITY INVOKER + RLS `is_org_member` nas tabelas base |
| Paginação de >1000 resultados | LIMIT na RPC | `supabase.rpc().range()` no frontend (PostgREST passa paginação a set-returning functions) |
| Resolver params com herança global→marca | Switch case / Map | COALESCE aninhado com subqueries (padrão do projeto) |

---

## Common Pitfalls

### Pitfall 1: Custo nulo silencioso
**O que vai errado:** JOIN direto `ml_product_costs.item_id = ml_inventory_cache.item_id` nunca casa para produtos Tiny (item_id = "TINY_{sku}").
**Raiz:** Tiny sync keya por SKU; ML inventory usa MLB...
**Como evitar:** `c.item_id = i.item_id OR c.seller_sku = i.seller_custom_field`; confirmar que `seller_custom_field` está preenchido.
**Warning signs:** `custo_ausente = TRUE` em todos os itens da org (exceto os editados manualmente no dashboard).

### Pitfall 2: DISTINCT ON necessário para inventory multi-store
**O que vai errado:** `ml_inventory_cache` tem PK (org, ml_user_id, item_id). Para orgs com múltiplas lojas e mesmo item_id em lojas diferentes, a RPC pode retornar linhas duplicadas por item.
**Como evitar:** `SELECT DISTINCT ON (item_id)` no CTE de inventory, ordenado por ml_user_id (deterministicamente escolhe uma loja) OU usar `SUM(available_quantity) GROUP BY item_id` se a intenção for somar estoque de todas as lojas.
**Decision:** Para v1, usar SUM para totalizar estoque do item no org.

### Pitfall 3: `replenishment_params` sem linha global
**O que vai errado:** Se a org não tem linha `scope='global'`, todos os `COALESCE` caem no hardcoded default. A UI não mostra os parâmetros reais usados.
**Como evitar:** Inserir linha global default na migration de seed ou via UI de configuração. Alternativa: o frontend faz upsert de defaults ao montar o painel pela primeira vez.

### Pitfall 4: `sem_giro` e `gatilho_ativo` mutuamente exclusivos
**O que vai errado:** `sem_giro = TRUE` quando venda_dia = 0 E estoque > 0. Nesse caso, `gatilho_ativo` é indefinido (ponto_reposicao = 0). Tentar calcular `cobertura_atual` resulta em divisão por zero.
**Como evitar:** CASE WHEN venda_dia = 0 → cobertura_atual = NULL (não infinito). `gatilho_ativo = FALSE` quando sem_giro.

### Pitfall 5: pack_multiple = 0
**O que vai errado:** `CEIL(necessidade / 0)` → divisão por zero.
**Como evitar:** `NULLIF(pack_multiple, 0)` no divisor, ou CHECK constraint `pack_multiple >= 1` na tabela.

### Pitfall 6: types.ts desatualizado
**O que vai errado:** `supabase.rpc('get_replenishment', ...)` retorna `any` sem type checking se a RPC não está em types.ts.
**Como evitar:** Atualizar `src/integrations/supabase/types.ts` manualmente após criar a migration — adicionar a entry para `replenishment_params` em Tables e a RPC em Functions. Convenção do projeto desde Phase 18.

### Pitfall 7: CompraRecomendadaPanel vs ReplenishmentPanel — conflito de nomes
**O que vai errado:** Criar um arquivo `CompraRecomendadaPanel.tsx` em outro diretório gera confusão sobre qual versão usar.
**Como evitar:** Nomear o novo componente `ReplenishmentPanel.tsx` (ou `CompraRecomendadaServerPanel.tsx`). O antigo continua em `src/components/mercadolivre/analise/`.

---

## Runtime State Inventory

> Esta é uma phase de adição (nova tabela + RPC + componente). Não é rename/refactor.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | Nenhum dado existente afetado | — |
| Live service config | `replenishment_params` não existe ainda | CREATE TABLE via migration |
| OS-registered state | None — apenas pg_cron existentes não afetados | — |
| Secrets/env vars | Nenhuma chave nova necessária | — |
| Build artifacts | types.ts desatualizado após migration | Atualização manual |

---

## Package Legitimacy Audit

Nenhum pacote npm novo é necessário para esta phase. Toda a stack já está instalada.

**Packages removed due to SLOP verdict:** none
**Packages flagged as suspicious:** none

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase MCP (apply_migration) | Aplicar migration | ✓ | — | — |
| Supabase projeto ckcdevcxgvueywivefgx | Banco de produção | ✓ | PostgreSQL 15 | — |
| vitest | Testes | ✓ | 3.2.4 | — |

**Missing dependencies with no fallback:** none
**Missing dependencies with fallback:** none

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.4 |
| Config file | `vitest.config.ts` (raiz do projeto) |
| Quick run command | `npx vitest run src/lib/analysis/replenishmentUtils.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REPL-04 | Gatilho: estoque > ponto → compra=0 | unit | `npx vitest run src/lib/analysis/replenishmentUtils.test.ts` | ❌ Wave 0 |
| REPL-04 | Gatilho: estoque ≤ ponto → compra>0 | unit | idem | ❌ Wave 0 |
| REPL-06 | MOQ: necessidade=7, moq=10 → compra=10 | unit | idem | ❌ Wave 0 |
| REPL-06 | Pack: necessidade=7, pack=5 → ceil(7/5)×5=10 | unit | idem | ❌ Wave 0 |
| REPL-07 | Custo nulo → custo_ausente=true, valor=null | unit | idem | ❌ Wave 0 |
| REPL-08 | Sem giro: venda_dia=0, estoque>0 → sem_giro=true | unit | idem | ❌ Wave 0 |
| REPL-05 | Override por marca: priority marca > global | unit | idem | ❌ Wave 0 |
| REPL-11 | Caso normal: parâmetros default, resultado esperado | unit | idem | ❌ Wave 0 |

### Wave 0 Gaps
- [ ] `src/lib/analysis/replenishmentUtils.ts` — fórmula TS pura
- [ ] `src/lib/analysis/replenishmentUtils.test.ts` — 8 casos mínimos acima

*(Framework já instalado — `vitest.config.ts` existe; sem novos gaps de infra)*

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | sim | JWT Supabase via `auth.uid()` já aplicado |
| V4 Access Control | sim (crítico) | SECURITY INVOKER + RLS `is_org_member` — padrão Phase 43+ |
| V5 Input Validation | sim | CHECK constraint em `replenishment_params.scope`; `pack_multiple >= 1` via CHECK ou NULLIF |
| V6 Cryptography | não | Sem dados sensíveis |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Passar `p_org_id` de outra org | Tampering/Information Disclosure | SECURITY INVOKER + RLS `is_org_member` nas tabelas base |
| `pack_multiple = 0` na tabela (divisão por zero) | Denial of Service | CHECK `pack_multiple >= 1` + NULLIF na RPC |
| `scope_value` injetando caracteres especiais | Tampering | Comparação de texto simples no SQL (não eval); sem injection |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `replenishment_params` DDL com `scope_value TEXT NOT NULL DEFAULT ''` para global | Incógnita 6 | Se Wesley preferir NULL para global, precisa de partial unique index — migration muda |
| A2 | Override de parâmetros apenas por MARCA em v1 (fornecedor deferred) | Incógnita 4 | Se Wesley quiser fornecedor já no v1, precisaria de nova tabela de mapeamento item→fornecedor |
| A3 | Componente novo nomeado `ReplenishmentPanel.tsx` (antigo mantido) | Incógnita 7 | Se Wesley quiser substituir o antigo em `/precos-custos`, escopo amplia |
| A4 | Agregar estoque cross-store com SUM por item_id (não por ml_user_id específico) | Incógnita 2 | Se Wesley quiser per-loja, precisa de `p_user_ids TEXT[]` como get_margin_with_ads |
| A5 | `status = 'active'` apenas no filtro de inventory | Incógnita 2 | Se Wesley quiser incluir itens pausados, mudar para `status IN ('active', 'paused')` |
| A6 | Multiplicador de campanha como parâmetro `p_demand_multiplier` na RPC | Incógnita 7 | Se Wesley preferir aplicar no front, a RPC não precisa do parâmetro |

---

## Open Questions (RESOLVED)

1. **CompraRecomendadaPanel em `/precos-custos` — substituir ou manter?**
   - O que sabemos: o componente atual está em `/precos-custos/analise` (não em `/estoque`). A CONTEXT diz para criar o novo em `/estoque`.
   - RESOLVED: manter o antigo intocado (não quebra features existentes) e criar o novo em `/estoque`. Refletido em 62-03 (prohibition + git diff vazio no arquivo antigo).

2. **Estoque multi-store: SUM ou escolher uma loja?**
   - Se a Pé Vermeio tiver apenas 1 loja (ml_user_id=1639558873), não importa.
   - RESOLVED: SUM por item_id agrega o estoque total na org, consistente com "tudo no ML". Refletido em 62-01 (Assumption A4).

3. **Defaults de `replenishment_params` — inserir na migration ou via UI?**
   - Se a tabela estiver vazia para a org, os `COALESCE` caem nos hardcoded defaults (30/60/7/1/1).
   - RESOLVED: hardcoded defaults na RPC suficientes para v1; UI de parâmetros fica para evolução. Refletido em 62-01 (Assumption A1).

---

## Sources

### Primary (HIGH confidence)
- `supabase/migrations/20260519150000_ml_inventory_cache.sql` — schema completo ml_inventory_cache verificado
- `supabase/migrations/20260318203522_ff4950d0-017a-44b3-b2f8-51627e0635e5.sql` — schema base ml_product_daily_cache
- `supabase/migrations/20260514130000_fix_ml_product_daily_cache_unique.sql` — unique constraint (org, ml_user_id, date, item_id)
- `supabase/migrations/20260659000000_cashflow_projection_7d_rule.sql` — padrão canônico get_cashflow (SECURITY INVOKER, REVOKE/GRANT)
- `supabase/migrations/20260615120000_margin_with_ads_rpc.sql` — padrão get_margin_with_ads_by_product (SECURITY INVOKER, comentário anti-IDOR)
- `supabase/migrations/20260645010000_consultor_engine_rpcs.sql` — padrão get_consultor_coverage (agregação venda/dia em SQL)
- `supabase/migrations/20260614120000_tenant01_ml_product_costs_rls_orgfirst.sql` — RLS org-first em ml_product_costs
- `src/hooks/useMLCoverage.ts` — padrão de agregação de venda/dia no front (a ser portado para SQL)
- `src/hooks/useMLProductCosts.ts` — join strategy (item_id + fallback seller_sku)
- `src/components/mercadolivre/analise/AnaliseDashboard.tsx` — localização real do CompraRecomendadaPanel (surpresa)
- `src/pages/mercadolivre/MLEstoque.tsx` — confirmação que `/estoque` NÃO tem painel de compra ainda
- `src/integrations/supabase/types.ts` — schema types verificado para ml_inventory_cache, ml_product_daily_cache, ml_product_costs

### Secondary (MEDIUM confidence)
- `src/lib/analysis/compraUtils.ts` — lógica do sistema antigo; referência para bugs a corrigir
- `.planning/STATE.md` — decisões acumuladas do projeto (padrões RLS, deploy, etc.)

### Tertiary (LOW confidence)
- DDL proposto para `replenishment_params` — baseado em padrões do projeto, não em tabela existente

---

## Metadata

**Confidence breakdown:**
- Schema das tabelas fonte: HIGH — verificado em migrations e types.ts
- Padrão RPC SECURITY INVOKER: HIGH — código real de 20260659000000 e 20260615120000
- DDL de replenishment_params: MEDIUM — proposto por analogia com consultor_config
- Localização de CompraRecomendadaPanel: HIGH — verificado em AnaliseDashboard.tsx
- Fornecedor inexistente em inventory: HIGH — verificado em todas as migrations

**Research date:** 2026-06-25
**Valid until:** 2026-07-25 (schema estável; válido por 30 dias)

---

## RESEARCH COMPLETE
