# Phase 45: Consultor v1 - Research

**Researched:** 2026-06-14
**Domain:** Motor de regras determinístico por org + score de saúde 0-100 + UI no topo de /vendas
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 — Conjunto de regras:** Todas as ~12 regras entram no v1 (disparam quando há problema real).
Lista: margem < alvo por produto; ROAS/ACoS fora da meta; TACoS subindo; ruptura/cobertura crítica;
produto sem custo cadastrado; sem regime fiscal; ticket médio caindo; cancelamentos acima da média;
anúncio pausado com histórico de venda; campanha gastando sem venda; meta do mês em risco; pergunta > 24h.

**D-02 — Config:** Limiares em tabela `consultor_config` (scope org), com defaults. Editável via SQL no v1.

**D-03 — Margem:** Crítico ≤ 0%, Alerta ≤ 10% (default configurável). Fonte: RPCs de margem + `orders`.

**D-04 — Ads:** Campanha gastando sem venda = spend > 0 + 0 vendas em 7d. TACoS alto > 15% (default).

**D-05 — Estoque:** Crítico ≤ 7d de cobertura, Alerta ≤ 15d. Reusar lógica de `useMLCoverage`.

**D-06 — Meta do mês em risco:** run-rate = `(receita_acumulada / dias_decorridos) × dias_do_mês`.
RESSALVA: `ml_targets` é scoped por `user_id`/`seller_id` SEM `organization_id` — planner resolve.

**D-07 — Tendências:** mês atual vs mês anterior (ticket médio, cancelamentos).

**D-08 — Lookback:** anúncio pausado = 30d histórico; campanha sem venda = 7d.

**D-09 — Score ponderado:** Margem 30 + Ads 25 + Estoque 20 + Reputação 15 + Completude 10 = 100.

**D-10 — 3 faixas:** 0-49 Crítico (vermelho / `kpi.negative`), 50-74 Atenção (amarelo / `kpi.neutral`),
75-100 Saudável (verde / `kpi.positive`).

**D-11 — Completude:** Reusar `onboarding_progress` para o pilar. Zero infra nova.

**D-12 — Snapshot histórico do score:** nova tabela/coluna para tendência ▲/▼ vs mês anterior.

**D-13 — Impacto R$:** fórmula específica onde houver; qualitativo (só severidade) onde não houver.

**D-14 — Framing:** perda/desperdício atual estimado ("Você está perdendo ~R$ X").

**D-15 — Período base:** projeção mensal.

**D-16 — Card:** Top 3 insights; link "ver todos" → painel completo.

**D-17 — Priorização:** severidade primeiro, depois impacto R$.

**D-18 — Ciclo de vida:** auto-resolver (recalc) + dispensar manual (persiste `dismissed`). Sem snooze.

**D-19 — Painel:** texto leigo + link para página certa já filtrada. Sem ação automática.

**D-20 — Cadência:** cron diário (após sync manhã) + run on-demand no 1º acesso quando stale.

**D-21 — Severidade:** Crítico / Alto / Médio + categorias = 5 pilares (Margem, Ads, Estoque, Reputação, Config) + Vendas/Meta.

**D-22 — Texto:** templates por regra com variáveis. Determinístico, sem LLM.

**D-23 — Escopo:** por org consolidado; loja ML identificada no insight quando aplicável.

### Claude's Discretion (planner decide)

- Schema exato de `insights`, `consultor_config`, `consultor_health_snapshots`.
- Mapeamento pilar → nota 0-100 (como cada pilar converte dados em pontuação).
- Fórmulas finais de impacto R$ por regra e horizonte por regra.
- Onde computar (EF Deno vs RPC SQL vs híbrido).
- Texto-modelo final dos ~12 insights.
- Resolução do escopo org de `ml_targets` para a regra de meta (D-06).

### Deferred Ideas (OUT OF SCOPE)

- UI para lojista editar limiares (fase futura).
- Snooze/adiar insight (v2).
- Ação em 1 clique a partir do insight.
- Score/insights separados por loja ML (v1 consolida por org).
- Consultor com análises geradas por LLM (v8.0).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONSUL-01 | Engine de insights roda por org (EF + cron) avaliando ~12 regras e gravando em tabela `insights` (severidade, categoria, ação recomendada, impacto R$) | §Fontes de Dados por Regra + §Arquitetura Engine + §Schema Tabelas Novas |
| CONSUL-02 | Card "O que fazer agora" no topo de /vendas com top insights acionáveis | §Integração UI — seção do card + §Ciclo de Vida |
| CONSUL-03 | Painel de insights com explicação leiga por insight ("por que isso importa", "como resolver") | §Templates de Texto por Regra + §Integração UI — painel |
| CONSUL-04 | Score de saúde do negócio (0-100) composto por margem, ads, estoque, reputação e completude | §Score de Saúde 0-100 por Pilar |
| CONSUL-05 | Org Pé Vermeio gera ≥5 insights reais e acionáveis no primeiro run | §Garantia ≥5 Insights no 1º Run + §Cron + On-Demand |
</phase_requirements>

---

## Summary

O Consultor v1 é um motor de regras determinístico que roda **por org** (no contexto do service role) e grava insights + score em tabelas próprias. O planner tem liberdade total de escolher onde cada regra roda (SQL RPC vs Deno vs híbrido), mas deve respeitar dois invariantes: (1) o engine acessa apenas dados que já existem nas tabelas de produção (`orders`, `ml_ads_daily_cache`, `ml_ads_campaigns_cache`, `ml_ads_products_cache`, `ml_inventory_cache`, `ml_questions`, `ml_claims`, `ml_product_costs`, `ml_tax_config`, `onboarding_progress`), sem inventar novas fontes; (2) as ~12 regras são avaliadas contra esses dados reais, e o resultado é guardado em `insights` com upsert idempotente (sem duplicar por run).

A maior decisão de arquitetura do planner é onde computar: **recomendação desta pesquisa é EF Deno pura** (uma EF `consultor-insights` invocada pelo cron + on-demand), com cada regra implementada como uma query SQL parametrizada executada via service role. Evita infra extra, reutiliza o padrão já validado de `sync-ml-claims` / `sync-ml-questions`, e mantém toda a lógica em um único lugar versionado.

**Ressalva crítica — `ml_targets`:** A tabela de metas não tem `organization_id`. O engine não consegue ler a meta por org diretamente via service role de forma confiável sem saber os `user_id`s dos owners das orgs. A recomendação concreta: no v1, a regra "meta do mês em risco" é disparada apenas quando há pelo menos um `ml_targets` cujo `seller_id` bate com qualquer `ml_user_id` da org (join via `ml_tokens`). Fallback: se não houver meta cadastrada para a org, a regra simplesmente não dispara (sem insight de meta).

**Primary recommendation:** Implementar a EF `consultor-insights` (Deno, `verify_jwt=false`, auth service role) com todas as regras como queries SQL inline, pg_cron Pattern B diário às 08:30 (após sync principal das 07:03), e run on-demand disparado pelo frontend via `supabase.functions.invoke` com user JWT quando `/vendas` abrir e não houver run nas últimas 4h.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Avaliação das ~12 regras | API / Edge Function (service role) | DB (SQL aggregate) | Precisa de acesso cross-table sem restrição de RLS; queries SQL inline na EF são a forma padrão do projeto |
| Gravação de `insights` / score | API / Edge Function (service role) | — | Service role ignora RLS; padrão estabelecido por sync-ml-claims, sync-ml-orders |
| Leitura de `insights` no frontend | Browser / Client | Direct Supabase query | RLS org-first no `insights`; hook `useConsultorInsights` lê via `authenticated` |
| Score histórico (tendência) | API / Edge Function | DB snapshot | EF grava snapshot a cada run; frontend lê a linha mais recente e a anterior |
| Cron diário | DB / pg_cron | — | Pattern B validado (vault `service_role_key`); projeto `ckcdevcxgvueywivefgx` |
| Run on-demand | Browser / Client → API | — | Frontend invoca EF com user JWT (padrão `useMLBillingWithSync`) |
| Card "O que fazer agora" + Score | Frontend / SPA | — | Componentes React no topo de `src/pages/MercadoLivre.tsx` |
| Painel de insights | Frontend / SPA | — | Nova rota `/consultor` ou drawer inline em `/vendas` |
| Pilar Completude | DB (onboarding_progress) | Frontend hook | Reusar `useOnboardingProgress`; engine lê a tabela via SQL |

---

## Fontes de Dados por Regra (mapeamento completo)

### 1. Margem ≤ 0% (Crítico) / ≤ alvo (Alerta) — Regra de Margem por Produto

**Fonte:** Tabela `orders` diretamente (mesma lógica de `useMLProductMargins.ts`).
Engine calcula por `item_id`:
```sql
SELECT
  item_id,
  SUM(receita_bruta)                                      AS receita,
  SUM(receita_bruta - COALESCE(custo_unit*quantidade,0)
      - COALESCE(comissao,0) - COALESCE(frete,0)
      - COALESCE(tax_amount,0))                           AS lucro,
  ROUND(... / NULLIF(SUM(receita_bruta),0) * 100, 2)     AS lucro_pct
FROM orders
WHERE organization_id = $org_id
  AND ml_user_id = ANY($ml_user_ids)
  AND status IN ('paid','shipped','delivered')
  AND data_pedido >= NOW() - INTERVAL '30 days'
  AND custo_unit IS NOT NULL
GROUP BY item_id
HAVING SUM(receita_bruta) > 0
```
Ads spend desconta via `ml_ads_products_cache`. [VERIFIED: inspeção direta de useMLProductMargins.ts e 20260527110000_margin_aggregate_rpcs.sql]

**Impacto R$ (D-13):** `ABS(lucro_pct/100 * receita) * (30 / dias_no_período)` = perda mensal estimada por produto. Somar todos os produtos em prejuízo.

**Nota de portabilidade:** `useMLProductMargins.ts` implementa essa lógica no frontend. No engine (service role), replicar como SQL inline ou reutilizar `get_margin_by_product` RPC existente. [ASSUMED: RPC não pagina; se >1000 produtos, paginar com OFFSET — ver pitfall PostgREST abaixo. RPC é função SQL, não PostgREST, então não trunca.]

---

### 2. Campanha gastando sem venda nos últimos 7d — Regra Ads Desperdício

**Fonte:** `ml_ads_campaigns_cache` (spend + attributed_orders por campaign_id) — mas atenção: essa tabela armazena o **acumulado histórico**, não série diária por campanha. A série diária está em `ml_ads_daily_cache` (agregado do dia todo, não por campanha).

**Problema:** Não existe tabela com `(campaign_id, date, spend, attributed_orders)` no banco. A `ml_ads_campaigns_cache` tem o acumulado; não tem janela de 7d por campanha. [VERIFIED: inspeção de 20260406143415 — ml_ads_campaigns_cache não tem coluna `date`]

**Recomendação:** Para o v1, aproximar via `ml_ads_daily_cache` (série diária total por org/loja, com spend e attributed_orders) com janela 7d. Se `SUM(spend) > 0 AND SUM(attributed_orders) = 0` → dispara. Isso é org-level, não por campanha. Insight: "Você teve gasto com publicidade nos últimos 7 dias sem nenhuma venda atribuída."

Se quiser granularidade por campanha: o `sync-ads` atual não armazena série diária por campanha. Isso exigiria nova coluna/tabela — FORA DO ESCOPO do v1.

**Fonte SQL:** `ml_ads_daily_cache` (organization_id + ml_user_id + date).

---

### 3. TACoS global > 15% — Regra Ads Eficiência

**Fonte:** `ml_ads_daily_cache` (spend total período) + `orders` ou `ml_daily_cache` (receita total período).

TACoS = `SUM(ads_spend) / SUM(receita_total) × 100`.

`useMLAdsDerivedMetrics.ts` já calcula `tacos_global` no frontend usando `ml_daily_cache.approved_revenue` + `ml_ads_daily_cache.spend`. [VERIFIED: inspeção de useMLAdsDerivedMetrics.ts]

**Fonte SQL para engine:** Período = mês corrente (ou 30d).
```sql
-- Spend
SELECT COALESCE(SUM(spend),0) FROM ml_ads_daily_cache
WHERE organization_id=$org AND date >= DATE_TRUNC('month', NOW())

-- Receita (ml_daily_cache)
SELECT COALESCE(SUM(approved_revenue),0) FROM ml_daily_cache
WHERE organization_id=$org AND date >= DATE_TRUNC('month', NOW())
```

---

### 4. Ruptura / Cobertura crítica — Regra Estoque

**Fonte:** `ml_inventory_cache` (available_quantity por item) + `ml_product_daily_cache` (qty_sold por dia, últimos 30d).

Lógica de `useMLCoverage.ts`: `coverage_days = available_quantity / avg_daily_sales`. [VERIFIED: inspeção de useMLCoverage.ts]

**Engine SQL:**
```sql
WITH sales AS (
  SELECT item_id, SUM(qty_sold)/30.0 AS avg_daily
  FROM ml_product_daily_cache
  WHERE organization_id=$org AND date >= NOW()-INTERVAL '30 days'
  GROUP BY item_id
),
inventory AS (
  SELECT item_id, available_quantity, price, title
  FROM ml_inventory_cache
  WHERE organization_id=$org AND status='active'
)
SELECT i.item_id, i.title, i.price,
       CASE WHEN s.avg_daily > 0
            THEN FLOOR(i.available_quantity / s.avg_daily)
            ELSE NULL END AS coverage_days,
       s.avg_daily
FROM inventory i
LEFT JOIN sales s USING (item_id)
```
Crítico: `coverage_days < 7 AND avg_daily > 0`. Alerta: `coverage_days < 15`.

**Impacto R$:** `avg_daily × preço × (7 - coverage_days)` para o período até ruptura completa.

---

### 5. Produto sem custo cadastrado — Regra Completude Custos

**Fonte:** `ml_inventory_cache` (itens ativos) LEFT JOIN `ml_product_costs` (item_id ou seller_sku).

```sql
SELECT COUNT(*) FROM ml_inventory_cache i
LEFT JOIN ml_product_costs c ON (c.item_id = i.item_id OR c.seller_sku = i.seller_custom_field)
  AND c.organization_id = i.organization_id
WHERE i.organization_id = $org AND i.status = 'active'
  AND c.item_id IS NULL -- sem custo cadastrado
```
[VERIFIED: inspeção de useMLProductCosts.ts — dois índices: por item_id e por seller_sku]

**Impacto:** qualitativo (severidade Médio). Sem R$.

---

### 6. Sem regime fiscal configurado — Regra Completude Fiscal

**Fonte:** `ml_tax_config` por `organization_id`.

```sql
SELECT COUNT(*) = 0 FROM ml_tax_config WHERE organization_id = $org
```
[VERIFIED: inspeção de 20260515120000_ml_tax_config.sql — tem organization_id]

**Impacto:** qualitativo. Severidade Alto (imposto subestimado = perda silenciosa).

---

### 7. Ticket médio caindo mês × mês — Regra Tendência Vendas

**Fonte:** `orders` — comparar ticket médio do mês atual vs mês anterior.

```sql
SELECT
  DATE_TRUNC('month', data_pedido) AS mes,
  SUM(receita_bruta) / NULLIF(COUNT(*),0) AS ticket_medio
FROM orders
WHERE organization_id=$org AND status IN ('paid','shipped','delivered')
  AND data_pedido >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month'
GROUP BY 1 ORDER BY 1
```
Dispara se ticket_mes_atual < ticket_mes_anterior × 0.9 (queda >10%).

**Impacto R$:** `(ticket_anterior - ticket_atual) × volume_pedidos_mes_atual` = receita perdida projetada.

---

### 8. Cancelamentos acima da média — Regra Tendência Devoluções

**Fonte:** `ml_claims` (tipo = 'returns' ou 'mediations', `data_abertura` por mês).

```sql
SELECT
  DATE_TRUNC('month', data_abertura) AS mes,
  COUNT(*) AS claims_count
FROM ml_claims
WHERE organization_id=$org AND data_abertura >= NOW() - INTERVAL '2 months'
GROUP BY 1 ORDER BY 1
```
Compara mês atual vs anterior. Dispara se mês atual > mês anterior × 1.2 (+20%).

**Impacto:** qualitativo (reputação + custo operacional não quantificável direto).

---

### 9. Anúncio pausado com histórico de venda (30d) — Regra Ads Oportunidade

**Fonte:** `ml_inventory_cache` (status='paused') + `ml_product_daily_cache` (qty_sold nos últimos 30d).

```sql
SELECT i.item_id, i.title, i.price, SUM(s.qty_sold) AS vendas_30d
FROM ml_inventory_cache i
JOIN ml_product_daily_cache s ON s.item_id=i.item_id
  AND s.organization_id=i.organization_id
  AND s.date >= NOW() - INTERVAL '30 days'
WHERE i.organization_id=$org AND i.status='paused'
GROUP BY i.item_id, i.title, i.price
HAVING SUM(s.qty_sold) > 0
```
Dispara por produto pausado com vendas.

**Impacto R$:** `vendas_30d × preço` = receita mensal em risco.

---

### 10. Meta do mês em risco — Regra Metas

**Fonte:** `orders` (receita mês atual) + `ml_targets` (meta configurada).

**RESSALVA CRÍTICA:** `ml_targets` é scoped por `user_id` e `seller_id` — SEM `organization_id`. [VERIFIED: inspeção de 20260407120000_create_ml_targets.sql]

**Resolução recomendada para o engine:**
- O engine (service role) faz join `ml_targets` via `ml_tokens`: `ml_targets.seller_id = ml_tokens.ml_user_id AND ml_tokens.organization_id = $org_id`.
- Pega o `user_id` do owner da org para filtrar `ml_targets.user_id`.
- Se não houver `ml_targets` para a org (comum em orgs novas), a regra simplesmente não dispara.

```sql
WITH org_users AS (
  SELECT DISTINCT t.ml_user_id, t.user_id
  FROM ml_tokens t WHERE t.organization_id=$org_id
),
receita_mes AS (
  SELECT SUM(receita_bruta) AS total FROM orders
  WHERE organization_id=$org_id
    AND status IN ('paid','shipped','delivered')
    AND data_pedido >= DATE_TRUNC('month', NOW())
),
meta AS (
  SELECT SUM(target_value) AS meta_total
  FROM ml_targets mt
  JOIN org_users ou ON ou.ml_user_id=mt.seller_id AND ou.user_id=mt.user_id
  WHERE mt.year=EXTRACT(YEAR FROM NOW())::int
    AND mt.month=EXTRACT(MONTH FROM NOW())::int
)
SELECT r.total, m.meta_total,
       r.total / NULLIF(EXTRACT(DOY FROM NOW()) - EXTRACT(DOY FROM DATE_TRUNC('month',NOW())), 0)
         * EXTRACT(DAYS FROM DATE_TRUNC('month',NOW()+INTERVAL'1 month') - DATE_TRUNC('month',NOW()))
         AS projecao_mensal
FROM receita_mes r, meta m
WHERE m.meta_total > 0
```
Dispara se `projecao_mensal < meta_total × 0.9`.

**Impacto R$:** `meta_total - projecao_mensal`.

---

### 11. Pergunta sem resposta > 24h — Regra Reputação Atendimento

**Fonte:** `ml_questions` (status='UNANSWERED', data_pergunta).

```sql
SELECT COUNT(*) FROM ml_questions
WHERE organization_id=$org
  AND status='UNANSWERED'
  AND data_pergunta <= NOW() - INTERVAL '24 hours'
```
[VERIFIED: inspeção de useMLQuestions.ts — tabela `ml_questions` tem `organization_id`, `status`, `data_pergunta`]

**Impacto:** qualitativo (afeta reputação). Severidade: Crítico se > 5 perguntas.

---

### 12. ROAS/ACoS fora da meta — Regra Ads Retorno

**Fonte:** `ml_ads_daily_cache` (spend + attributed_revenue período).

ACoS global = `SUM(spend)/SUM(attributed_revenue) × 100`. Dispara se ACoS > threshold (default 30%).
ROAS global = `SUM(attributed_revenue)/SUM(spend)`. Dispara se ROAS < 3 (default).

`computeAdsSummary()` já calcula `acos_global` no frontend. [VERIFIED: inspeção de useMLAds.ts]

**Engine SQL:**
```sql
SELECT
  COALESCE(SUM(spend),0)               AS spend,
  COALESCE(SUM(attributed_revenue),0)  AS rev
FROM ml_ads_daily_cache
WHERE organization_id=$org
  AND date >= DATE_TRUNC('month', NOW())
```

---

## Arquitetura do Engine (EF Deno — Recomendação)

### Decisão: EF Deno pura — `consultor-insights`

**Por que EF Deno (não RPC SQL puro):**
- Lógica condicional entre regras (ex: não disparar regra de meta se não há target) é mais limpa em Deno do que em PL/pgSQL.
- Run on-demand do frontend precisa de uma EF invocável com user JWT + fallback para service role.
- Padrão já estabelecido por `sync-ml-claims`, `sync-ml-questions` — o projeto conhece bem esse pattern.
- Limites Deno: 150s wall-clock, 512MB RAM. O engine com ~12 queries SQL simples + upsert fica bem dentro do limite (estimativa: < 20s total). [ASSUMED: baseado em tempo observado de EFs similares no projeto]

**Por que não RPC SQL puro:**
- PL/pgSQL não acessa tabelas externas facilmente; lógica de template de texto fica difícil de manter.
- On-demand do frontend com user JWT não consegue chamar uma RPC que faz escrita (service role needed).

**Por que não híbrido (RPC + EF):**
- Adiciona uma camada de indireção desnecessária para o v1.

### Estrutura da EF `consultor-insights`

```
supabase/functions/consultor-insights/index.ts
```

```typescript
// Auth: aceita Bearer service_role_key (cron) OU Bearer user JWT (on-demand frontend)
// config.toml: verify_jwt = false  (auth interna distingue os dois)
// Fluxo:
// 1. Determinar org_id: se cron (service role), iterar todas as orgs com ml_tokens;
//    se user JWT, usar a org do usuário autenticado.
// 2. Para cada org: executar as ~12 queries SQL via service role client.
// 3. Avaliar cada regra → gerar array de insight candidates.
// 4. Calcular score 0-100 por pilar.
// 5. Upsert em `insights` (ON CONFLICT rule_key+org = update).
// 6. Resolver insights cujas condições cessaram (status → 'resolved').
// 7. Inserir snapshot em `consultor_health_snapshots`.
// 8. Retornar { ok: true, org_id, insights_count, score }.
```

**Padrão de auth dual (cron + frontend):** Igual ao `sync-ml-inventory` que aceita Bearer service-role-key OU Bearer user JWT.

**config.toml entry:**
```toml
[functions.consultor-insights]
verify_jwt = false
```

---

## Schema das Tabelas Novas

### `insights` — tabela principal do engine

```sql
CREATE TABLE public.insights (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ml_user_id       text        NULL,          -- loja ML específica, ou NULL = org inteira
  rule_key         text        NOT NULL,      -- identificador da regra, ex: 'margin_critical'
  category         text        NOT NULL,      -- 'Margem'|'Ads'|'Estoque'|'Reputação'|'Config'|'Vendas'
  severity         text        NOT NULL,      -- 'critical'|'high'|'medium'
  title            text        NOT NULL,      -- texto leigo curto
  body             text        NOT NULL,      -- explicação completa leiga
  action_label     text        NOT NULL,      -- ex: "Ver anúncios"
  action_href      text        NOT NULL,      -- ex: "/anuncios"
  impact_brl       numeric     NULL,          -- impacto estimado em R$ (mensal)
  status           text        NOT NULL DEFAULT 'active',  -- 'active'|'resolved'|'dismissed'
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz NULL,
  dismissed_at     timestamptz NULL,
  -- Dedup: uma linha por regra+org (ou regra+org+ml_user_id para insights por loja)
  CONSTRAINT insights_dedup UNIQUE (organization_id, rule_key, COALESCE(ml_user_id, ''))
);

CREATE INDEX insights_org_status_idx ON public.insights (organization_id, status, severity);

ALTER TABLE public.insights ENABLE ROW LEVEL SECURITY;

-- SELECT: qualquer membro da org lê
CREATE POLICY "insights_select" ON public.insights FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- UPDATE (dismiss): owner/admin/member pode dispensar
CREATE POLICY "insights_dismiss" ON public.insights FOR UPDATE TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

-- INSERT/DELETE: service role only (engine escreve)
```

**Nota sobre `UNIQUE COALESCE`:** PostgreSQL não suporta `UNIQUE` com `COALESCE` diretamente — usar índice único funcional:
```sql
CREATE UNIQUE INDEX insights_dedup_idx
  ON public.insights (organization_id, rule_key, COALESCE(ml_user_id, ''));
```

---

### `consultor_config` — limiares por org

```sql
CREATE TABLE public.consultor_config (
  organization_id       uuid    NOT NULL PRIMARY KEY
                                REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Margem
  margin_critical_pct   numeric NOT NULL DEFAULT 0,    -- ≤ 0% = prejuízo
  margin_alert_pct      numeric NOT NULL DEFAULT 10,   -- ≤ 10% = alerta
  -- Ads
  tacos_alert_pct       numeric NOT NULL DEFAULT 15,
  acos_alert_pct        numeric NOT NULL DEFAULT 30,
  roas_min              numeric NOT NULL DEFAULT 3,
  ads_no_sale_days      integer NOT NULL DEFAULT 7,
  -- Estoque
  stock_critical_days   integer NOT NULL DEFAULT 7,
  stock_alert_days      integer NOT NULL DEFAULT 15,
  -- Tendências
  ticket_drop_pct       numeric NOT NULL DEFAULT 10,   -- queda % no ticket médio
  claims_spike_pct      numeric NOT NULL DEFAULT 20,   -- aumento % em cancelamentos
  -- Meta
  goal_risk_pct         numeric NOT NULL DEFAULT 10,   -- run-rate abaixo de x% da meta
  -- Paused ads lookback
  paused_ads_lookback_days integer NOT NULL DEFAULT 30,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.consultor_config ENABLE ROW LEVEL SECURITY;

-- SELECT: membros da org leem config
CREATE POLICY "consultor_config_select" ON public.consultor_config FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- WRITE: owner only
CREATE POLICY "consultor_config_write" ON public.consultor_config FOR ALL TO authenticated
  USING (public.get_org_role(auth.uid(), organization_id) = 'owner')
  WITH CHECK (public.get_org_role(auth.uid(), organization_id) = 'owner');
```

**Lógica de defaults:** o engine primeiro tenta ler `consultor_config` para a org; se não existir (nova org), usa os defaults hardcoded acima. Não cria a row automaticamente (evitar ruído de migration em cada run).

---

### `consultor_health_snapshots` — histórico de score para tendência

```sql
CREATE TABLE public.consultor_health_snapshots (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  score            integer     NOT NULL,          -- 0-100
  score_margin     integer     NOT NULL DEFAULT 0,
  score_ads        integer     NOT NULL DEFAULT 0,
  score_estoque    integer     NOT NULL DEFAULT 0,
  score_reputacao  integer     NOT NULL DEFAULT 0,
  score_completude integer     NOT NULL DEFAULT 0,
  insights_total   integer     NOT NULL DEFAULT 0,
  insights_critical integer   NOT NULL DEFAULT 0,
  snapshot_month   char(7)     NOT NULL,          -- 'YYYY-MM' — um snapshot por mês
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT snapshots_org_month UNIQUE (organization_id, snapshot_month)
);

CREATE INDEX snapshots_org_month_idx ON public.consultor_health_snapshots (organization_id, snapshot_month DESC);

ALTER TABLE public.consultor_health_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "snapshots_select" ON public.consultor_health_snapshots FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));
-- INSERT/UPDATE: service role only
```

**Estratégia de snapshot:** um registro por mês (upsert). Cada run do engine sobrescreve o snapshot do mês atual. Para obter tendência: ler os últimos 2 meses, comparar `score`.

---

## Score de Saúde 0-100 por Pilar

**Pesos totais:** Margem 30 + Ads 25 + Estoque 20 + Reputação 15 + Completude 10 = 100.

Cada pilar tem uma nota de 0-100 internamente; o score final é `Σ (nota_pilar × peso_pilar / 100)`.

### Pilar Margem (peso 30)

```
nota_margem = MAX(0, MIN(100,
  IF nenhum produto em prejuízo E margem_media >= 20% → 100
  IF nenhum produto em prejuízo E margem_media >= meta (10%) → 75
  IF < 20% produtos em prejuízo → 50
  IF >= 20% produtos em prejuízo → 25
  IF > 50% produtos em prejuízo → 0
))
```

Regra simplificada: `nota_margem = CLAMP(0, 100, 100 - (pct_produtos_prejuizo * 2) - (MAX(0, meta_pct - margem_media) * 3))`

### Pilar Ads (peso 25)

```
nota_ads =
  IF sem gastos com ads → 100 (neutro — não penaliza)
  IF TACoS <= 10% E sem campanha sem venda → 100
  IF TACoS <= 15% E sem campanha sem venda → 80
  IF TACoS <= 20% → 60
  IF TACoS > 20% → 30
  IF campanha sem venda E TACoS > 20% → 10
```

Simplificado: `nota_ads = CLAMP(0, 100, 100 - (tacos_over_15 * 5) - (has_campanha_sem_venda ? 20 : 0))`

### Pilar Estoque (peso 20)

```
nota_estoque = 100 - (pct_itens_ruptura * 100) - (pct_itens_critico * 50) - (pct_itens_alerta * 20)
(clampado em 0-100)
```

### Pilar Reputação (peso 15)

Reputação ML tem 5 níveis (1_red → 5_green). Score numérico em `useMLReputation.ts`: red=10, orange=30, yellow=50, light_green=70, green=90. [VERIFIED: inspeção de useMLReputation.ts]

**Problema:** a reputação não está em tabela própria no banco — a EF `ml-reputation` chama a API ML diretamente e retorna ao frontend. **Para o engine (server-side), precisaria chamar a API ML.**

**Recomendação:** no v1 do engine, incluir chamada à API ML de reputação dentro da EF `consultor-insights` usando o access_token da org (via `ml_tokens`). Retorna `level_id` → mapear para score (red=0, orange=25, yellow=50, light_green=75, green=100).

Alternativamente: ler `claims_rate` e `cancellation_rate` de `ml_claims` como proxy (sem chamar API ML). Mais simples e sem dependência de API externa síncrona.

**Recomendação concreta:** usar proxy via `ml_claims` no v1 — evita latência de API ML no engine.

```sql
-- proxy de reputação: taxa de cancelamentos últimos 30d
SELECT COUNT(*)::float /
  NULLIF((SELECT COUNT(*) FROM orders WHERE organization_id=$org AND status NOT IN ('cancelled')
    AND data_pedido >= NOW() - INTERVAL '30 days'), 0) AS cancellation_rate
FROM ml_claims
WHERE organization_id=$org AND data_abertura >= NOW() - INTERVAL '30 days'
```
`nota_reputacao = CLAMP(0, 100, 100 - (cancellation_rate * 500))` — 0% = 100pts, 20% = 0pts.

Também considerar perguntas sem resposta > 24h como penalizador parcial.

### Pilar Completude (peso 10)

Reusar `onboarding_progress`. Os 3 passos obrigatórios são `connect_ml`, `costs`, `fiscal`. [VERIFIED: inspeção de useOnboardingProgress.ts — REQUIRED_STEPS]

No engine:
```sql
SELECT completed_steps FROM onboarding_progress WHERE organization_id=$org
```
`passos_concluidos` = intersecção com ['connect_ml', 'costs', 'fiscal'].

`nota_completude = (passos_concluidos / 3) × 100`.

---

## Ciclo de Vida dos Insights

### Dedup e Upsert Idempotente

Chave única: `(organization_id, rule_key, COALESCE(ml_user_id, ''))`.

**Comportamento por run:**
1. Engine avalia cada regra → gera lista de "insights candidatos" (condição disparada).
2. Para cada candidato: `INSERT ... ON CONFLICT DO UPDATE SET title=..., body=..., impact_brl=..., severity=..., status='active', updated_at=NOW()` — **preserva** `dismissed_at` (não sobrescreve dismiss manual).
3. Para insights ativos cujas condições NÃO dispararam: `UPDATE SET status='resolved', resolved_at=NOW()` — auto-resolver.
4. Insights `dismissed` NÃO são auto-resolvidos nem re-ativados (usuário dispensou explicitamente). São ignorados nas condições de re-ativação.

**Estado `dismissed`:** persistido pelo frontend via `UPDATE insights SET status='dismissed', dismissed_at=NOW()`. O engine nunca re-ativa um insight dismissed (condição de upsert: `WHERE status != 'dismissed'`).

**Re-ativação de dismissed:** se a condição reaparecer após o usuário ter dispensado, o v1 NÃO re-ativa. O dismissed é permanente até que o usuário recarregue/reset — decisão de UX para o v1 (simples).

---

## Cron + On-Demand (D-20)

### pg_cron diário — Pattern B

```sql
-- Migration: 20260645_pg_cron_consultor_insights.sql
SELECT cron.schedule(
  'consultor-insights-daily',
  '30 8 * * *',   -- 08:30 UTC = após sync principal 07:03 + scores 07:30
  $cmd$
    SELECT net.http_post(
      url     := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/consultor-insights',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'service_role_key' LIMIT 1
        )
      ),
      body    := '{"mode":"all_orgs"}'::jsonb
    );
  $cmd$
);
```

### Run On-Demand do Frontend

Padrão: `useMLBillingWithSync` em `useMLBilling.ts`. [VERIFIED: inspeção de useMLBilling.ts linha 213-254]

Hook `useConsultorInsights`:
```typescript
// 1. Lê insights da tabela (React Query, staleTime: 4h)
// 2. Se data.length === 0 e !isLoading e !attempted:
//    - Invoca EF com user JWT: supabase.functions.invoke('consultor-insights', {body:{mode:'org_only'}})
//    - Após resolve, refetch()
// 3. Expõe: { insights, score, loading, syncing, dismiss(id) }
```

**auth dual na EF:** cron envia `Bearer service_role_key` → `mode: 'all_orgs'` (itera todas as orgs). Frontend envia `Bearer user_jwt` → `mode: 'org_only'` (só a org do usuário autenticado).

Para distinguir: a EF verifica se o Bearer token é o service role key; caso contrário, valida o JWT e extrai `organization_id` do claim `org_id`.

---

## Integração UI (pontos de encaixe)

### Card "O que fazer agora" — topo de `/vendas`

**Arquivo:** `src/pages/MercadoLivre.tsx` — inserir logo abaixo do `OnboardingBanner` (linha ~98-99), antes do `MLPeriodPicker`. [VERIFIED: inspeção de MercadoLivre.tsx]

```tsx
{/* Após OnboardingBanner, antes de MLPeriodPicker */}
{onboardingComplete && <ConsultorCard insights={topInsights} score={healthScore} />}
```

**Componente:** `src/components/mercadolivre/ConsultorCard.tsx`
- Mostra score com cor (`kpi.positive/neutral/negative`) + label (Saudável/Atenção/Crítico).
- Lista Top 3 insights com ícone de severidade, título, impacto R$ e link.
- Link "Ver todos →" → `/consultor` ou abre drawer.

### Painel de Insights

**Opção A (recomendada):** nova rota `/consultor` em `src/pages/mercadolivre/MLConsultor.tsx`. Registrar em `App.tsx` + sidebar.

**Opção B:** Sheet/drawer embutido em `/vendas` (sem nova rota). Mais simples, mas dificulta deep-links.

**Recomendação do planner:** `/consultor` como nova página — permite bookmarking e deep-links limpos (D-19: links filtrados para `/publicidade`, `/anuncios`, `/estoque`, `/perguntas`).

### Deep-Links por Categoria

| Categoria | Link |
|-----------|------|
| Margem | `/anuncios?filter=margin_critical` (ou `/precos-custos`) |
| Ads | `/publicidade` |
| Estoque | `/estoque` |
| Reputação / Perguntas | `/perguntas` |
| Config / Completude | `/organizacao` ou `/integracoes` |

---

## Templates de Texto por Regra (D-22)

Exemplos concretos — planner/Wesley podem revisar antes de checkpoint:

| rule_key | title | body | action_label | action_href |
|----------|-------|------|--------------|-------------|
| `margin_critical` | "{{N}} produto(s) vendendo no prejuízo" | "Os produtos {{lista}} estão gerando lucro negativo. Você está perdendo ~R$ {{impact}}/mês. Reveja o preço ou o custo cadastrado." | "Ver anúncios" | `/anuncios` |
| `margin_alert` | "{{N}} produto(s) com margem abaixo de {{meta}}%" | "Margem média de {{margem}}% está abaixo da meta de {{meta}}%. Potencial perda de ~R$ {{impact}}/mês." | "Ver custos" | `/precos-custos` |
| `ads_no_sale` | "Publicidade com gasto e zero vendas (últimos 7d)" | "Você gastou R$ {{spend}} em publicidade nos últimos 7 dias sem nenhuma venda atribuída. Revise suas campanhas." | "Ver publicidade" | `/publicidade` |
| `tacos_high` | "TACoS acima de {{meta}}% (está em {{atual}}%)" | "Para cada R$ {{receita}} vendido, R$ {{spend}} foi gasto em publicidade — acima do limite saudável. Risco de ~R$ {{impact}}/mês." | "Ver publicidade" | `/publicidade` |
| `stock_critical` | "{{N}} produto(s) com ruptura em ≤7 dias" | "Os produtos {{lista}} têm estoque para menos de 7 dias de vendas. Risco de ~R$ {{impact}} em vendas perdidas." | "Ver estoque" | `/estoque` |
| `stock_alert` | "{{N}} produto(s) com cobertura baixa (7-15 dias)" | "Reposição urgente recomendada para evitar ruptura." | "Ver estoque" | `/estoque` |
| `no_cost` | "{{N}} produto(s) sem custo cadastrado" | "Sem CMV cadastrado, a margem não pode ser calculada. Você pode estar vendendo no prejuízo sem saber." | "Cadastrar custos" | `/precos-custos` |
| `no_fiscal` | "Regime fiscal não configurado" | "Sem regime tributário configurado, os impostos podem estar sendo subestimados no relatório." | "Configurar fiscal" | `/organizacao` |
| `ticket_drop` | "Ticket médio caindo mês a mês" | "Seu ticket médio caiu de R$ {{anterior}} para R$ {{atual}} (-{{pct}}%). Impacto estimado de ~R$ {{impact}}/mês." | "Ver vendas" | `/` |
| `claims_spike` | "Cancelamentos aumentaram {{pct}}% no mês" | "O número de cancelamentos subiu de {{anterior}} para {{atual}} este mês. Verifique as causas." | "Ver devoluções" | `/devolucoes` |
| `paused_with_sales` | "{{N}} anúncio(s) pausado(s) com histórico de venda" | "Esses anúncios venderam nos últimos 30 dias mas estão pausados. Receita em risco: ~R$ {{impact}}/mês." | "Ver anúncios" | `/anuncios` |
| `goal_at_risk` | "Meta do mês em risco" | "No ritmo atual, a projeção é R$ {{projecao}} — {{pct}}% abaixo da meta de R$ {{meta}}. Faltam {{dias}} dias." | "Ver metas" | `/metas` |
| `questions_old` | "{{N}} pergunta(s) sem resposta há mais de 24h" | "Perguntas sem resposta afetam sua reputação e as chances de venda. Responda agora." | "Ver perguntas" | `/perguntas` |

---

## Cálculo de Impacto R$ Detalhado (D-13/D-14/D-15)

| Regra | Fórmula de impacto | Horizonte |
|-------|-------------------|-----------|
| `margin_critical` | `SUM(ABS(lucro)) × (30 / dias_período)` | mensal |
| `margin_alert` | `SUM((meta_pct - lucro_pct) × receita / 100) × (30 / dias_período)` | mensal |
| `ads_no_sale` | `SUM(spend) × (30 / 7)` (extrapola 7d para 30d) | mensal |
| `tacos_high` | `SUM(spend - receita × tacos_meta/100) × (30 / dias_período)` — excesso de spend vs meta | mensal |
| `stock_critical` | `avg_daily × preço × (7 - coverage_days)` para o período até zerar | até ruptura |
| `paused_with_sales` | `vendas_30d × preço` | mensal |
| `ticket_drop` | `(ticket_anterior - ticket_atual) × pedidos_mes` | mensal |
| `goal_at_risk` | `meta_total - projecao_mensal` | fim do mês |
| demais | `NULL` (qualitativo) | — |

---

## Pitfalls Críticos

### Pitfall 1: PostgREST trunca em 1000 linhas [VERIFIED]

Todo `SELECT` via PostgREST (`supabase.from(...)`) trunca em 1000 linhas sem `Range` header.
**Na EF Deno**, como o engine usa o `createClient` com service role e executa queries Postgres diretamente (não via PostgREST), as queries SQL não sofrem esse truncamento. As queries SQL via `supabase.rpc()` ou `supabase.from().select()` dentro de uma EF usam PostgREST e truncam.

**Solução:** dentro da EF, usar `supabase.rpc()` com funções SQL que retornam agregados (não linhas brutas) OU paginar com `.range(0, 999)` e iterar. Para as regras de margem e estoque (potencialmente muitos produtos), usar `get_margin_by_product` RPC (que já existe e não tem paginação interna — atenção se org tem >1000 produtos).

**Ação:** para orgs com muitos produtos, o planner deve adicionar paginação explícita nas queries de margem/estoque dentro da EF, ou garantir que as RPCs agregam em SQL sem limite de linhas. [CITED: feedback_postgrest_pagination.md na memória do projeto]

### Pitfall 2: pg_cron Pattern B — vault `service_role_key` = `sb_secret_`

A chave de service role correta é a `sb_secret_*` nova — **não** o JWT legacy. O vault já tem a chave com name `service_role_key` (validado na Phase 42/43). Toda nova cron job DEVE seguir o padrão de `20260614110000_pg_cron_questions_claims.sql`. [VERIFIED: inspeção de 20260614110000]

### Pitfall 3: Migrations via MCP `apply_migration`, não `db push`

CLI local está linkado no projeto errado (`gionpsuunfkkzzjdubfy`). Todas as migrations de tabelas novas (`insights`, `consultor_config`, `consultor_health_snapshots`) e pg_cron DEVEM ser aplicadas via `mcp__supabase__apply_migration` no projeto `ckcdevcxgvueywivefgx`. [VERIFIED: STATE.md + CONTEXT.md]

### Pitfall 4: EF Deno — `verify_jwt=false` não significa sem auth

A EF precisa de auth interna dual: verificar se o token é o service role key (para o cron) OU validar o JWT de usuário (para on-demand do frontend). Seguir o padrão de `sync-ml-inventory/authenticate()`. [VERIFIED: inspeção de sync-ml-inventory/index.ts linha 60+]

### Pitfall 5: ml_ads_campaigns_cache não tem série temporal

Sem coluna `date` em `ml_ads_campaigns_cache`. A regra "campanha gastando sem venda" no v1 opera em nível de org/dia via `ml_ads_daily_cache`, não por campanha individual. Planner deve documentar essa limitação no insight text.

### Pitfall 6: `ml_targets` sem `organization_id`

Detalhado na seção de fontes da Regra 10. Join via `ml_tokens` é a solução; fallback = não dispara se sem meta. [VERIFIED: inspeção de 20260407120000_create_ml_targets.sql]

### Pitfall 7: UNIQUE com COALESCE em PostgreSQL

`CONSTRAINT UNIQUE (col1, COALESCE(col2,''))` não funciona inline — usar índice único funcional separado. [ASSUMED: comportamento padrão PostgreSQL constraints]

### Pitfall 8: Limite 150s da EF Deno

Se o engine rodar para muitas orgs em `mode:'all_orgs'` (cron), pode estourar o timeout de 150s.
**Solução:** serializar as orgs (não paralelo), com estimativa de 5-10s por org. Para até ~20 orgs, cabe em 150s. Para escala maior (futuro), usar fila de jobs (bulk-dispatch pattern). [ASSUMED: estimativa de tempo por org baseada em EFs similares]

---

## Don't Hand-Roll

| Problema | Não construir | Usar em vez | Por quê |
|----------|---------------|-------------|---------|
| Cálculo de margem por SKU | lógica custom no engine | `get_margin_by_product` RPC (já existe) | RPC já testa, retorna agregados, suporta org_id + ml_user_ids |
| Cobertura de estoque | fórmula custom | lógica de `useMLCoverage.ts` (portar para SQL) | Lógica de classificação ruptura/crítico/alerta já validada |
| Score de onboarding | nova detecção | `onboarding_progress` + `useOnboardingProgress.ts` | Pilar Completude já resolve automaticamente |
| Auth dual EF (service role + JWT) | lógica nova | padrão de `sync-ml-inventory/authenticate()` | Padrão já validado no projeto |
| pg_cron com vault | SQL custom | padrão de `20260614110000_pg_cron_questions_claims.sql` | Padrão Pattern B já validado |
| Tokens do ML no engine | buscar direto | `ml_tokens` com `ORDER BY updated_at DESC LIMIT 1` | Padrão ME-04 determinístico (43-02) |
| TACoS | calcular custom | `ml_ads_daily_cache.spend` / `ml_daily_cache.approved_revenue` | Mesmas fontes de `useMLAdsDerivedMetrics.ts` |

---

## Garantia de ≥5 Insights no 1º Run (CONSUL-05)

Para a org Pé Vermeio no primeiro run, as regras mais prováveis de disparar:

1. **Margem por produto** — há produtos com custo cadastrado; certamente haverá variação de margem (D-03).
2. **TACoS** — ads com spend real (confirmado: R$12k/mês em abril). TACoS de 15% é threshold baixo o suficiente.
3. **Perguntas > 24h** — 108 perguntas na tabela (Phase 42). Estatisticamente haverá algumas UNANSWERED antigas.
4. **Estoque cobertura** — 2191 unidades em múltiplos SKUs; é provável ter itens com cobertura <15d.
5. **Sem custo** — há SKUs sem CMV (mencionado em STATE.md: "35 SKUs sem CMV").
6. Potencialmente: ticket médio / campanhas sem venda / meta em risco.

A meta de ≥5 insights é realista para o primeiro run, dado o volume de dados da org.

---

## Arquitetura Diagram

```
Frontend (React SPA)
  │
  ├── /vendas (MercadoLivre.tsx)
  │     └── ConsultorCard [score + top 3 insights]
  │           └── link "ver todos" → /consultor
  │
  └── /consultor (MLConsultor.tsx) [nova rota]
        └── InsightsPanel [lista completa + explicações + dismiss]
              └── deep-links → /publicidade, /anuncios, /estoque, /perguntas
  │
  hooks/useConsultorInsights.ts
  │   ├── reads: supabase.from('insights').eq('organization_id', ...) [React Query]
  │   ├── reads: supabase.from('consultor_health_snapshots') [score atual + anterior]
  │   └── on-demand: supabase.functions.invoke('consultor-insights', {mode:'org_only'})
  │
Supabase Edge Function: consultor-insights (verify_jwt=false)
  │   ├── auth dual: service_role (cron) | user JWT (on-demand)
  │   ├── Queries SQL (~12 regras) via service role client
  │   ├── Calcula score 0-100 por pilar
  │   ├── Upsert em `insights` (ON CONFLICT rule_key+org → update, preserve dismissed)
  │   ├── Auto-resolve insights cujas condições cessaram
  │   └── Upsert em `consultor_health_snapshots` (snapshot_month = YYYY-MM)
  │
  ├── pg_cron (Pattern B) → diário 08:30 UTC → mode:'all_orgs'
  │
Supabase DB (ckcdevcxgvueywivefgx)
  ├── insights (RLS: is_org_member SELECT; owner dismiss UPDATE)
  ├── consultor_config (RLS: org read; owner write)
  ├── consultor_health_snapshots (RLS: is_org_member SELECT)
  │
  ── Fontes de dados lidas pelo engine:
  ├── orders (receita_bruta, custo_unit, comissao, frete, tax_amount, status, data_pedido)
  ├── ml_ads_daily_cache (spend, attributed_revenue, attributed_orders, date)
  ├── ml_ads_campaigns_cache (spend, status — acumulado)
  ├── ml_ads_products_cache (item_id, spend — série com date)
  ├── ml_inventory_cache (item_id, available_quantity, price, status)
  ├── ml_product_daily_cache (item_id, qty_sold, date)
  ├── ml_questions (status, data_pergunta)
  ├── ml_claims (tipo, data_abertura)
  ├── ml_product_costs (item_id, seller_sku, cost)
  ├── ml_tax_config (organization_id, regime)
  ├── onboarding_progress (organization_id, completed_steps)
  ├── ml_targets (seller_id, user_id, target_value, year, month) ← join via ml_tokens
  └── ml_tokens (organization_id, ml_user_id, user_id) ← bridge para ml_targets
```

---

## Stack Padrão (Phase 45)

Nenhuma dependência nova. Reutilizar:

| Componente | Versão/Padrão | Purpose |
|------------|--------------|---------|
| Deno EF (`https://deno.land/std@0.168.0`) | existente | Runtime da EF `consultor-insights` |
| `@supabase/supabase-js@2.49.1` via esm.sh | existente | Service role client na EF |
| TanStack React Query v5 | existente | `useConsultorInsights` hook |
| shadcn/ui (Card, Badge, Button) | existente | ConsultorCard + InsightsPanel |
| lucide-react | existente | Ícones de severidade (AlertTriangle, XCircle, Info) |
| Tokens CSS `kpi.positive/negative/neutral` | existente | Cores das faixas do score |
| `is_org_member` / `get_org_role` SQL functions | existente | RLS das tabelas novas |

---

## Estrutura de Arquivos Recomendada

```
supabase/
├── functions/
│   └── consultor-insights/
│       └── index.ts            # EF principal (auth dual, ~12 regras, score, upsert)
├── migrations/
│   ├── 20260645_consultor_tables.sql         # insights + consultor_config + snapshots
│   └── 20260645_pg_cron_consultor.sql        # cron diário Pattern B

src/
├── hooks/
│   └── useConsultorInsights.ts  # lê insights + score + on-demand invoke
├── components/mercadolivre/
│   └── ConsultorCard.tsx        # card top-3 + score de saúde para /vendas
├── pages/mercadolivre/
│   └── MLConsultor.tsx          # painel completo /consultor
```

---

## Validation Architecture

Nyquist validation ativa (workflow.nyquist_validation não está como false em config.json).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 3.2.4 |
| Config file | `vitest.config.ts` (padrão Vite) |
| Quick run | `npm run test -- --run` |
| Full suite | `npm run test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONSUL-01 | Engine grava insights corretos no banco | Smoke manual (MCP SQL verify) | `SELECT COUNT(*) FROM insights WHERE organization_id='...'` | ❌ Wave 0 |
| CONSUL-02 | Card aparece no topo de /vendas com dados reais | Manual visual | — | ❌ Wave 0 |
| CONSUL-03 | Painel exibe explicação por insight | Manual visual | — | ❌ Wave 0 |
| CONSUL-04 | Score 0-100 calculado e exibido | Manual visual + SQL check | `SELECT score FROM consultor_health_snapshots ORDER BY created_at DESC LIMIT 1` | ❌ Wave 0 |
| CONSUL-05 | Pé Vermeio gera ≥5 insights no 1º run | Smoke manual (contar rows) | `SELECT COUNT(*) FROM insights WHERE status='active'` | ❌ Wave 0 |

### Wave 0 Gaps

- [ ] Smoke script: invocar `consultor-insights` via MCP e contar insights gerados
- [ ] SQL verifier: queries para validar score + insight count (inline no VERIFICATION.md)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | sim | auth dual na EF (service role key check + JWT validation) |
| V3 Session Management | não | cron não tem sessão |
| V4 Access Control | sim | RLS `is_org_member` nas 3 tabelas novas; dismiss gate org-member |
| V5 Input Validation | sim | `organization_id` validado como UUID; `rule_key` enum constante |
| V6 Cryptography | não | sem crypto custom |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-org read de insights | Information Disclosure | RLS `is_org_member` na tabela `insights` |
| Dismiss de insight de outra org | Tampering | Policy UPDATE com `is_org_member` check |
| Invocação não-autorizada da EF | Elevation of Privilege | `requireServiceRole` guard + JWT validate |
| Re-ativação indevida de insight dismissed | Tampering | Condição `WHERE status != 'dismissed'` no upsert do engine |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|---------|
| Supabase MCP (apply_migration) | Deploy das 3 tabelas novas | ✓ | — | Sem fallback — obrigatório |
| vault.secrets `service_role_key` | pg_cron Pattern B | ✓ | sb_secret_ (validado Phase 42/43) | Verificar antes de aplicar cron migration |
| `ml_inventory_cache` populado | Regra de estoque | ✓ | — | Regra não dispara se cache vazio |
| `ml_questions` / `ml_claims` populados | Regras perguntas/cancelamentos | ✓ | — | Regras não disparam se tabelas vazias |
| `onboarding_progress` tabela | Pilar Completude | ✓ | (Phase 43) | — |

---

## Assumptions Log

| # | Claim | Section | Risk se Errado |
|---|-------|---------|----------------|
| A1 | EF Deno executa ~12 queries em < 150s por org | §Arquitetura Engine | Timeout no cron — mitigar com timeout por org e serialização |
| A2 | `ml_ads_campaigns_cache` não tem coluna `date` (acumulado) | §Fonte Regra 2 | Se tiver `date`, regra por campanha é possível sem nova tabela |
| A3 | Reputação ML não está em tabela própria no banco | §Score Pilar Reputação | Se existir uma tabela de reputação cacheada, usar diretamente |
| A4 | Unique index funcional `(org_id, rule_key, COALESCE(ml_user_id,''))` funciona em Supabase | §Schema insights | Se não funcionar, usar coluna `ml_user_id_key text DEFAULT ''` |
| A5 | `ml_daily_cache` tem coluna `approved_revenue` | §Fonte Regra 3 (TACoS) | useMLAdsDerivedMetrics usa essa coluna — verificar nome exato |

---

## Open Questions

1. **Reputação em tabela própria?**
   - O que sabemos: `ml-reputation` EF chama a API ML diretamente; não cacheia em banco próprio
   - O que não está claro: se há alguma tabela cacheada de reputação criada em phases anteriores
   - Recomendação: planner verifica via MCP `list_tables` antes de finalizar o pilar Reputação

2. **`ml_daily_cache` tem coluna `approved_revenue` ou similar?**
   - `useMLAdsDerivedMetrics.ts` usa `approved_revenue` — confirmar nome exato
   - Recomendação: planner verifica schema via MCP antes de codificar a regra TACoS

3. **Supabase index único funcional com COALESCE é suportado?**
   - PostgreSQL suporta; Supabase/pg 14+ também. Mas algumas versões têm limitações.
   - Recomendação: alternativa é usar coluna `ml_user_id_key text NOT NULL DEFAULT ''` (preenchida pelo engine) e UNIQUE constraint normal.

---

## Sources

### Primary (HIGH confidence)
- Inspeção direta de `src/hooks/useMLProductMargins.ts` — lógica de margem por SKU
- Inspeção direta de `src/hooks/useMLCoverage.ts` — lógica de cobertura de estoque
- Inspeção direta de `src/hooks/useMLAds.ts` + `useMLAdsDerivedMetrics.ts` — TACoS/ACoS/ROAS
- Inspeção direta de `src/hooks/useMLQuestions.ts` e `useMLClaims.ts` — tabelas ml_questions/ml_claims
- Inspeção direta de `src/hooks/useMLProductCosts.ts` — ml_product_costs schema
- Inspeção direta de `supabase/migrations/20260614110000_pg_cron_questions_claims.sql` — Pattern B
- Inspeção direta de `supabase/migrations/20260614123000_tenant04_onboarding_progress.sql` — onboarding_progress
- Inspeção direta de `supabase/migrations/20260407120000_create_ml_targets.sql` — ressalva ml_targets
- Inspeção direta de `supabase/migrations/20260515120000_ml_tax_config.sql` — ml_tax_config
- Inspeção direta de `supabase/migrations/20260406143415_*.sql` — ml_ads_daily/campaigns/products tables
- Inspeção direta de `supabase/migrations/20260519150000_ml_inventory_cache.sql` — ml_inventory_cache
- Inspeção direta de `supabase/functions/sync-ml-claims/index.ts` — padrão EF + auth guard
- Inspeção direta de `supabase/functions/sync-ml-inventory/index.ts` — padrão auth dual
- Inspeção direta de `src/hooks/useMLBilling.ts` — padrão on-demand sync (useMLBillingWithSync)
- Inspeção direta de `src/hooks/useOnboardingProgress.ts` — pilar Completude
- Inspeção direta de `supabase/migrations/20260527110000_margin_aggregate_rpcs.sql` — RPCs de margem

### Secondary (MEDIUM confidence)
- `.planning/phases/45-consultor-v1/45-CONTEXT.md` — 23 decisões locked
- `.planning/STATE.md` — ressalva ml_targets, Supabase project ID correto, Pattern B
- `.planning/phases/43-multi-tenant-hardening/43-CONTEXT.md` — RLS org-first patterns

---

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — sem deps novas; tudo reutilizado do projeto existente
- Architecture: HIGH — baseada em inspeção direta de 15+ arquivos do codebase
- Fontes de dados por regra: HIGH para 10/12 regras; MEDIUM para pilar Reputação e ASSUMED para timeout EF
- Pitfalls: HIGH — todos baseados em erros documentados no projeto (STATE.md, CONTEXT.md, código real)

**Research date:** 2026-06-14
**Valid until:** 2026-07-14 (estável — sem APIs externas novas)
