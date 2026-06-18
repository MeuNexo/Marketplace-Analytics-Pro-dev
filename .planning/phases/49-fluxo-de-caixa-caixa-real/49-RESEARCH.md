# Phase 49: Fluxo de Caixa (Caixa Real) — Research

**Pesquisado:** 2026-06-18
**Domínio:** Fluxo de caixa real (liberações Mercado Pago + despesas), projeção SMA, multi-tenant Supabase
**Confiança:** HIGH

---

<user_constraints>
## Restrições do Usuário (de 49-CONTEXT.md)

### Decisões Travadas

- **Fonte do caixa:** CAIXA REAL. Entradas = liberações reais do Mercado Pago. Saídas = despesas/ordens de compra. NÃO derivar de vendas (competência). NÃO lançamento manual como fonte primária.
- **Localização:** Nova página `/fluxo-de-caixa` sob novo grupo de menu "Operações" (criar o agrupamento se não existir). NÃO mexer no `/financeiro` atual (DRE/margem).
- **Escopo MVP:** Gráfico de evolução (120 dias) + 3 cards (Caixa Hoje, Projeção Futura, Capacidade de Compra).

### Discrição de Claude (resolver no plano)

- Forma exata de ingerir liberações MP: endpoint/scope correto. Reusar padrão das EFs `sync-*` com `ml_tokens`.
- Fonte das saídas (despesas/OCs): Tiny (OCs/pagáveis) vs tabela própria com seed manual — escolher menor esforço que ainda seja "real".
- Nomes das tabelas novas (ex: `cash_inflows`/`mp_releases`, `cash_outflows`/`expenses`, `financial_settings`).
- Estrutura do RPC `get_cashflow` (espelhar `get_financial_cashflow` do nexointeligence).
- Onde colocar "Operações" no shell e quais ícones.

### Ideias Deferidas (FORA DO ESCOPO)

- Cards: Análise de Despesas, Valor em Estoque, Estoque Parado, DRE Sintético, Previsão de Receita detalhado.
- Simulador de cenários (`ScenarioSimulator`).
- Tabela de lançamentos com CRUD + filtros + exportação.
- Âncora manual de saldo (`balance_adjustment_history`).
- Mascaramento de valores sensíveis (`hide_financial_values`).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Descrição | Suporte da Pesquisa |
|----|-----------|---------------------|
| CASH-01 | Ingestão de caixa REAL multi-tenant — entradas = liberações do Mercado Pago (nova EF + tabela, padrão `sync-*`), escopada por `organization_id` com RLS | API MP `/v1/payments/search` + `/v1/payments/{id}` confirmada em nexo-mcp. Padrão de EF extraído de `sync-ml-orders`. |
| CASH-02 | Saídas de caixa — despesas/OCs em tabela própria, escopada por `organization_id` com RLS | Recomendação: tabela `cash_outflows` com seed manual MVP. Tiny OC é fase posterior (requer OAuth Tiny + mapeamento). |
| CASH-03 | RPC `get_cashflow` SECURITY INVOKER, saldo diário acumulado real + projeção SMA 15d × (1 − 0.22), ativa após dia 8, sem truncamento PostgREST, boundary timestamptz | SQL completo extraído de `get_financial_cashflow` + `get_projected_balance_summary` do nexointeligence. Requer adaptação para tabelas garment. |
| CASH-04 | Nova página `/fluxo-de-caixa` em "Operações", guard de rota, gráfico ComposedChart (2 linhas), alerta de saldo negativo | Padrão `App.tsx` + `ApiSidebar.tsx` + `RoleRoute` + `roleAccess` completamente mapeado. |
| CASH-05 | 3 cards com dado real — Caixa Hoje, Projeção Futura (pessimista/realista + data crítica), Capacidade de Compra | Componentes do nexointeligence extraídos com fórmulas exatas. Adaptação: substituir `transactions` por `cash_inflows`/`cash_outflows`. |
| CASH-06 | Parâmetros por org (`financial_settings`): saldo inicial, taxa de custo operacional, margem de segurança | Tabela `financial_settings` mapeada do nexointeligence com `organization_id` UNIQUE constraint. |
</phase_requirements>

---

## Resumo

O objetivo desta fase é portar o módulo de fluxo de caixa do SaaS `nexointeligence` (`/tmp/nexointeligence`) para o `garment-glow-test`. A maior parte da lógica de frontend (componentes React, hooks, RPCs) foi completamente extraída do repositório de referência e é reutilizável com adaptações mínimas na camada de dados.

O ponto mais pesado e incerto é a **ingestão de entradas de caixa real**: o garment não possui nenhuma tabela de pagamentos/liberações MP. O nexo-mcp já implementa exatamente esse padrão via `fetch_mp_payments` em `ml_client.py` — o endpoint é `https://api.mercadopago.com/v1/payments/search` com query por `money_release_date`, seguido de detalhe por `/v1/payments/{id}` para obter `transaction_details.net_received_amount`. O **mesmo token OAuth** já armazenado em `ml_tokens` serve para autenticar contra a API Mercado Pago (token ML é o mesmo para ML+MP na conta do seller).

Para as **saídas de caixa**, a recomendação do MVP é uma tabela simples `cash_outflows` com lançamento manual (sem integração Tiny). A integração com Tiny OCs exige OAuth Tiny já configurado e mapeamento de `contas_pagar` — esforço desproporcional para o MVP cujo foco é validar a visão de caixa.

O garment **não tem nenhuma tabela financeira de caixa** — `financial_settings`, `cash_inflows`, `cash_outflows` e os RPCs são todos criação nova (zero conflito com estrutura existente). O grupo "Operações" **já existe** no sidebar (`ApiSidebar.tsx`) e já contém Anúncios, Estoque, Pedidos e Precificação — `/fluxo-de-caixa` entra como mais um item nesse grupo.

**Recomendação primária:** Seguir o modelo do nexointeligence quase 1:1 nos componentes React. A única diferença arquitetural é substituir a tabela `transactions` por `cash_inflows` (entradas MP reais) + `cash_outflows` (despesas manuais), mantendo a mesma assinatura dos RPCs.

---

## Mapa de Responsabilidade Arquitetural

| Capacidade | Tier Primário | Tier Secundário | Racional |
|------------|--------------|-----------------|----------|
| Ingestão de liberações MP | Edge Function (Deno) | pg_cron | Requer token OAuth, chamada à API externa — mesma camada das outras EFs sync-* |
| Ingestão de saídas (MVP) | Frontend (UI form) + Database | — | Lançamento manual via tabela `cash_outflows`; sem orquestração externa necessária |
| Cálculo de saldo acumulado + projeção SMA | Database (RPC) | Frontend (hook) | Cálculo pesado via window function PostgreSQL; hook React apenas consome |
| Gráfico 120 dias + 3 cards | Frontend (React) | — | Composição de dados já calculados pelo RPC |
| Parâmetros da org (`financial_settings`) | Database (tabela) | Frontend (form) | Persiste por org com UNIQUE constraint |
| Rota + guard + menu | Frontend (App.tsx + ApiSidebar) | — | Padrão já estabelecido; nenhuma camada externa |

---

## Stack Padrão

### Core (já presente no garment, sem nova instalação)

| Biblioteca | Versão | Propósito | Observação |
|------------|--------|-----------|------------|
| recharts | 2.15.4 | Gráfico ComposedChart (2 linhas) | `[VERIFIED: CLAUDE.md]` — já no package.json |
| @tanstack/react-query | 5.83.0 | Queries dos hooks | `[VERIFIED: CLAUDE.md]` |
| @supabase/supabase-js | 2.98.0 | Client SDK | `[VERIFIED: CLAUDE.md]` |
| date-fns | 3.6.0 | Formatação de datas, eachDayOfInterval, addDays | `[VERIFIED: CLAUDE.md]` |
| lucide-react | 1.7.0 | Ícones (TrendingUp, AlertTriangle, Shield) | `[VERIFIED: CLAUDE.md]` |

### Sem novas dependências

Esta fase não instala nenhum pacote novo. Tudo reutiliza o que já existe no garment.

---

## Package Legitimacy Audit

> Nenhum pacote novo a instalar nesta fase.

---

## Arquitetura — Estrutura de Dados Nova

### Tabelas a criar

**`financial_settings`** — parâmetros por org (CASH-06)
```sql
CREATE TABLE public.financial_settings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  initial_balance       numeric NOT NULL DEFAULT 0,
  operational_cost_rate real    NOT NULL DEFAULT 0.22,
  safety_margin         numeric NOT NULL DEFAULT 10000,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  CONSTRAINT financial_settings_org_unique UNIQUE (organization_id)
);
-- RLS: org member pode ver, owner pode gravar
-- Fonte: nexointeligence migrations 20251201015323 + 20251213132000 [VERIFIED: /tmp/nexointeligence]
```

**`cash_inflows`** — liberações MP ingeridas pela EF (CASH-01)
```sql
CREATE TABLE public.cash_inflows (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ml_user_id       bigint NOT NULL,        -- seller_id (link com ml_tokens)
  payment_id       text NOT NULL,          -- ID do payment no MP
  release_date     date NOT NULL,          -- money_release_date[:10]
  net_amount       numeric NOT NULL,       -- transaction_details.net_received_amount
  gross_amount     numeric,               -- transaction_amount
  status_mp        text,                   -- approved / in_mediation / refunded
  payment_method   text,
  description      text,
  synced_at        timestamptz DEFAULT now(),
  CONSTRAINT cash_inflows_unique_payment UNIQUE (organization_id, payment_id)
);
-- RLS: escopado por organization_id
-- [ASSUMED] — nome escolhido por Claude com base no padrão do nexointeligence
```

**`cash_outflows`** — despesas manuais MVP (CASH-02)
```sql
CREATE TABLE public.cash_outflows (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  due_date         date NOT NULL,          -- data de vencimento/pagamento
  amount           numeric NOT NULL,       -- valor positivo (saída)
  description      text NOT NULL,
  category         text,                   -- fornecedor / operacional / logistica / outros
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);
-- RLS: escopado por organization_id
-- [ASSUMED] — MVP sem Tiny; lançamento manual via form (deferido) ou seed de dados
```

### Diagrama de fluxo

```
pg_cron (diário) ──► EF sync-mp-releases
                          │
                          ├── GET https://api.mercadopago.com/v1/payments/search
                          │   (range=money_release_date, token de ml_tokens)
                          │
                          └── UPSERT cash_inflows (organization_id, payment_id UNIQUE)

Browser ──► GET /fluxo-de-caixa
                │
                ├── useCashFlowData()
                │       └── supabase.rpc('get_cashflow', {p_org_id, p_start, p_end})
                │               ├── cash_inflows  (entradas por dia)
                │               ├── cash_outflows (saídas por dia)
                │               └── financial_settings (initial_balance)
                │                    → window function SUM OVER (acumulado)
                │
                ├── useTodayBalance()   → supabase.rpc('get_daily_balance', ...)
                ├── useProjectedBalance() → supabase.rpc('get_projected_balance_summary', ...)
                └── useFinancialHealth()  → client-side (sem RPC próprio)
```

---

## Fórmulas Exatas Extraídas do nexointeligence

> [VERIFIED: /tmp/nexointeligence] — extraído diretamente do código-fonte

### RPC `get_cashflow` (adaptar `get_financial_cashflow`)

```sql
-- Fonte: /tmp/nexointeligence/supabase/migrations/20251226205426_bbc9c3ec-...sql
-- Adaptação: trocar tabela 'transactions' por cash_inflows/cash_outflows

CREATE OR REPLACE FUNCTION public.get_cashflow(
  p_org_id    UUID,
  p_start_date DATE,
  p_end_date   DATE
)
RETURNS TABLE (
  date                DATE,
  daily_income        NUMERIC,
  daily_expense       NUMERIC,
  daily_balance       NUMERIC,
  accumulated_balance NUMERIC
)
LANGUAGE plpgsql
SECURITY INVOKER   -- OBRIGATÓRIO: não DEFINER (IDOR crítico)
SET search_path = 'public'
AS $$
DECLARE
  v_initial_balance NUMERIC := 0;
  v_previous_balance NUMERIC := 0;
BEGIN
  -- 1. Saldo inicial configurado pela org
  SELECT COALESCE(initial_balance, 0) INTO v_initial_balance
  FROM financial_settings
  WHERE organization_id = p_org_id
  LIMIT 1;

  -- 2. Entradas anteriores ao start_date
  SELECT COALESCE(SUM(net_amount), 0) INTO v_previous_balance
  FROM cash_inflows
  WHERE organization_id = p_org_id
    AND release_date < p_start_date;

  -- Subtrair saídas anteriores ao start_date
  v_previous_balance := v_previous_balance - (
    SELECT COALESCE(SUM(amount), 0)
    FROM cash_outflows
    WHERE organization_id = p_org_id
      AND due_date < p_start_date
  );

  -- 3. Série diária com acumulado (Window Function)
  RETURN QUERY
  WITH daily_data AS (
    SELECT
      d_date,
      COALESCE(SUM(d_income), 0)  AS d_income,
      COALESCE(SUM(d_expense), 0) AS d_expense,
      COALESCE(SUM(d_income), 0) - COALESCE(SUM(d_expense), 0) AS d_balance
    FROM (
      SELECT release_date AS d_date, net_amount AS d_income, 0 AS d_expense
      FROM cash_inflows
      WHERE organization_id = p_org_id
        AND release_date BETWEEN p_start_date AND p_end_date
      UNION ALL
      SELECT due_date AS d_date, 0 AS d_income, amount AS d_expense
      FROM cash_outflows
      WHERE organization_id = p_org_id
        AND due_date BETWEEN p_start_date AND p_end_date
    ) raw
    GROUP BY d_date
  )
  SELECT
    dd.d_date,
    dd.d_income,
    dd.d_expense,
    dd.d_balance,
    (v_initial_balance + v_previous_balance
     + SUM(dd.d_balance) OVER (ORDER BY dd.d_date ASC))::NUMERIC
  FROM daily_data dd
  ORDER BY dd.d_date ASC;
END;
$$;
```

**Notas críticas de adaptação:**
- `transactions` (nexointeligence) → separado em `cash_inflows` (entradas) + `cash_outflows` (saídas) no garment
- `transactions.amount` era positivo para entrada / negativo para saída; aqui são colunas separadas `net_amount` e `amount` — ajustar o cálculo do `d_balance`
- **SECURITY INVOKER** obrigatório (nunca DEFINER) — RLS por `organization_id` é o guard real

### RPC `get_daily_balance` (adaptar para garment)

```sql
-- Fonte: /tmp/nexointeligence/supabase/migrations/20251213132000 [VERIFIED]
-- Assinatura mantida; trocar 'transactions' pelas 2 tabelas

CREATE OR REPLACE FUNCTION public.get_daily_balance(
  p_org_id    UUID,
  p_target_date DATE
)
RETURNS TABLE (
  saldo_inicial         NUMERIC,
  entradas_hoje         NUMERIC,
  saidas_hoje           NUMERIC,
  saldo_final_previsto  NUMERIC
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = 'public'
AS $$
DECLARE
  v_initial_balance NUMERIC;
  v_saldo_inicial   NUMERIC;
  v_entradas        NUMERIC;
  v_saidas          NUMERIC;
BEGIN
  SELECT COALESCE(initial_balance, 0) INTO v_initial_balance
  FROM financial_settings WHERE organization_id = p_org_id LIMIT 1;

  -- Saldo acumulado até ontem (entradas - saídas)
  SELECT COALESCE(SUM(net_amount), 0) INTO v_saldo_inicial
  FROM cash_inflows WHERE organization_id = p_org_id AND release_date < p_target_date;

  v_saldo_inicial := v_initial_balance + v_saldo_inicial - (
    SELECT COALESCE(SUM(amount), 0) FROM cash_outflows
    WHERE organization_id = p_org_id AND due_date < p_target_date
  );

  SELECT COALESCE(SUM(net_amount), 0) INTO v_entradas
  FROM cash_inflows WHERE organization_id = p_org_id AND release_date = p_target_date;

  SELECT COALESCE(SUM(amount), 0) INTO v_saidas
  FROM cash_outflows WHERE organization_id = p_org_id AND due_date = p_target_date;

  RETURN QUERY SELECT v_saldo_inicial, v_entradas, v_saidas,
    v_saldo_inicial + v_entradas - v_saidas;
END;
$$;
```

### RPC `get_projected_balance_summary` (adaptar para garment)

```sql
-- Fonte: /tmp/nexointeligence/supabase/migrations/20251226205426 [VERIFIED]
-- Mesma lógica; SMA vem de ml_daily_cache (garment) em vez de sales_history (nexointeligence)
-- SMA = media de (receita_liquida / dias) dos últimos 15 dias de ml_daily_cache
-- Projeção SMA = daily_sma × (1 - operational_cost_rate) × max(0, p_projection_days - 8)
-- Retorno: current_balance, pessimistic_balance, realistic_balance,
--          critical_date, min_balance, confirmed_income,
--          confirmed_income_end_date, total_expenses, expenses_end_date
```

**Diferença chave:** o nexointeligence usa `sales_history.total_sales` para a SMA. No garment, a fonte equivalente é `ml_daily_cache.receita_liquida` ou `ml_daily_cache.receita_bruta`. O planner deve escolher `receita_liquida` se disponível (pós-taxas).

### Fórmula de Capacidade de Compra (useFinancialHealth — lado cliente)

```
// Fonte: /tmp/nexointeligence/src/hooks/useFinancialHealth.ts [VERIFIED]
capacidade = (saldo_atual + entradas_confirmadas_30d + sma_23d) - saidas_30d - safety_margin

Onde:
  saldo_atual        = initial_balance + Σ(entradas_até_hoje) - Σ(saídas_até_hoje)
  entradas_30d       = Σ cash_inflows.net_amount WHERE release_date BETWEEN today+1 AND today+30
  sma_23d            = (Σ ml_daily_cache.receita_liquida (últimos 15d) / 15) × (1 - 0.22) × 23
  saidas_30d         = Σ cash_outflows.amount WHERE due_date BETWEEN today+1 AND today+30
  safety_margin      = financial_settings.safety_margin (default R$10.000)

Status: SAFE se capacidade > 0, DANGER se <= 0
```

---

## Ingestão de Entradas de Caixa (CASH-01)

### API Mercado Pago — Liberações

> [VERIFIED: /root/nexo-mcp/ml_client.py linhas 1729–1950]

**Base URL:** `https://api.mercadopago.com`

**Passo 1 — Buscar payments por `money_release_date`:**

```
GET /v1/payments/search
  ?sort=money_release_date
  &criteria=asc
  &range=money_release_date
  &begin_date=YYYY-MM-DDT00:00:00.000-03:00
  &end_date=YYYY-MM-DDT23:59:59.000-03:00
  &limit=100
  &offset=N
Authorization: Bearer {access_token}

Resposta: { "results": [...], "paging": { "total": N, "offset": N, "limit": 100 } }
```

**Passo 2 — Detalhe do payment individual:**

```
GET /v1/payments/{payment_id}
Authorization: Bearer {access_token}

Campos relevantes:
  money_release_date      → data de liberação (ISO, truncar em [:10])
  money_release_status    → "released" | "pending" | "on_hold"
  status                  → "approved" | "in_mediation" | "refunded" | "cancelled"
  transaction_amount      → valor bruto da transação
  transaction_details
    .net_received_amount  → valor LÍQUIDO recebido pelo seller (pós-taxas MP)
  installments            → número de parcelas
  payment_method_id       → "pix" | "credit_card" | etc
```

**Fluxo para a EF `sync-mp-releases`:**

1. Filtrar `status IN ("approved", "authorized", "in_process", "in_mediation")` nos resultados do search
2. Descartar `money_release_status === "released"` (já liberado, não é projeção futura)
3. Gravar `net_received_amount` como `net_amount` em `cash_inflows`
4. Para `status === "refunded"`: `net_amount = -abs(net_received_amount)`
5. Upsert por `(organization_id, payment_id)` — idempotente

**Token:** Mesmo `access_token` de `ml_tokens` — o token OAuth do ML funciona para ambas as APIs (ML + MP) no mesmo seller. [VERIFIED: /root/nexo-mcp/ml_client.py `MP_BASE = "https://api.mercadopago.com"` com `_ml_get` que reutiliza o token ML]

**Janela recomendada:** 45 dias à frente (hoje → hoje+45) para capturar D14 de pagamentos parcelados. Janela histórica de 30 dias para sincronizar liberações já realizadas.

**Rate limits:** A API MP tolera paginação de 100 itens; usar `time.sleep(0.3)` entre páginas em volume alto. Para sellers pequenos-médios (< 500 payments/mês), 1 request de search + N de detalhe é suficiente.

**INCÓGNITA:** O scope OAuth do token ML inclui o endpoint `/v1/payments/search` do MP? No nexo-mcp funciona com o mesmo token. Para o garment, o token é gerado via fluxo OAuth ML padrão — o escopo `offline_access` inclui os endpoints MP. [ASSUMED — confirmar no primeiro teste de fumaça]

---

## Ingestão de Saídas de Caixa (CASH-02)

### Decisão Recomendada: Tabela Própria com Seed Manual (MVP)

**Opção A — Tiny OCs:** Requer OAuth Tiny ativo + mapping de `contas_pagar` + tratamento de status (aberto/pago/vencido). O garment tem o OAuth Tiny configurado mas a EF de sync Tiny é voltada para custos de produto, não contas a pagar. **Esforço alto, benefício pequeno para MVP.**

**Opção B — Tabela `cash_outflows` com lançamento manual:** Tabela simples com `due_date`, `amount`, `description`, `category`, `status`. Wesley lança despesas recorrentes (aluguel, folha, logística) manualmente uma vez. Sem UI de CRUD nesta fase (deferido) — apenas a tabela existe para que o RPC funcione com saldo correto.

**Recomendação: Opção B para MVP.** O Wesley pode fazer um seed inicial de despesas via SQL direto (ou UI básica em fase futura). O que importa para o MVP é que a estrutura exista e o RPC leia corretamente.

> [ASSUMED] — decisão de produto, confirmar com Wesley se ele quer seed manual ou já quer formulário básico

---

## Padrões do Garment a Reusar

### Padrão de EF sync-* (extraído de sync-ml-orders/sync-ml-billing)

```typescript
// Fonte: /root/garment-glow-test/supabase/functions/sync-ml-orders/index.ts [VERIFIED]
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!  // formato sb_secret_ (não JWT legacy)
);

// Lookup de token por org:
const { data: tokenRow } = await supabase
  .from("ml_tokens")
  .select("access_token, organization_id, seller_id")
  .eq("ml_user_id", mlUserId)
  .single();

// Upsert com conflito por chave única:
await supabase
  .from("cash_inflows")
  .upsert(records, { onConflict: "organization_id,payment_id" });
```

### Navegação — Grupo "Operações" já existe no ApiSidebar

```typescript
// Fonte: /root/garment-glow-test/src/components/layout/ApiSidebar.tsx [VERIFIED]
// O grupo "Operações" JÁ EXISTE com: Anúncios, Estoque, Pedidos, Precificação
// Adicionar /fluxo-de-caixa como mais um item:
{
  icon: Layers,
  label: "Operações",
  path: "/estoque",
  noSelfLink: true,
  children: [
    { icon: ShoppingBag,   label: "Anúncios",        path: "/anuncios"         },
    { icon: Package,       label: "Estoque",          path: "/estoque"          },
    { icon: ClipboardList, label: "Pedidos",          path: "/pedidos"          },
    { icon: Calculator,    label: "Precificação",     path: "/precificacao"     },
    // NOVO:
    { icon: Banknote,      label: "Fluxo de Caixa",  path: "/fluxo-de-caixa"  },
  ],
}
// Ícone recomendado: Banknote (lucide-react) ou TrendingUp
```

### Rota em App.tsx (padrão lazy + RoleRoute)

```typescript
// Fonte: /root/garment-glow-test/src/App.tsx [VERIFIED]
const MLFluxoCaixa = React.lazy(() => import("./pages/mercadolivre/MLFluxoCaixa"));
// ...
<Route path="/fluxo-de-caixa" element={
  <RoleRoute>
    <ErrorBoundary fallbackTitle="Erro no Fluxo de Caixa">
      <MLFluxoCaixa />
    </ErrorBoundary>
  </RoleRoute>
} />
```

### roleAccess (roleAccess.ts)

```typescript
// Fonte: /root/garment-glow-test/src/config/roleAccess.ts [VERIFIED]
// Adicionar em roleAccess:
"/fluxo-de-caixa": OPERATIONAL,  // owner/admin/member (financeiro é operacional)
```

### routeMeta.ts

```typescript
// Adicionar:
"/fluxo-de-caixa": { title: "Fluxo de Caixa", subtitle: "Como meu dinheiro vai evoluir?" }
```

### RLS Pattern (org-first, SECURITY INVOKER)

```sql
-- Para cash_inflows e cash_outflows:
ALTER TABLE public.cash_inflows ENABLE ROW LEVEL SECURITY;

-- SELECT: qualquer membro da org
CREATE POLICY "cash_inflows_select_org_member"
  ON public.cash_inflows FOR SELECT
  USING (public.is_org_member(organization_id, auth.uid()));

-- INSERT/UPDATE/DELETE: apenas service role (EF usa service_role)
-- (sem policy de INSERT para usuários — só a EF grava)
```

---

## Componentes Frontend — Mapa de Portabilidade

### Componentes do nexointeligence a portar (quase 1:1)

| Arquivo Origem | Destino no Garment | Mudanças Necessárias |
|---|---|---|
| `CashFlowChart.tsx` | `src/components/financial/CashFlowChart.tsx` | Remover `useSensitiveData` (não existe no garment); adaptar formato dos dados |
| `TodayBalanceCard.tsx` | `src/components/financial/TodayBalanceCard.tsx` | Remover `BalanceAdjustmentModal` (deferido); adaptar hook |
| `ProjectedBalanceCard.tsx` | `src/components/financial/ProjectedBalanceCard.tsx` | Link do simulador → remover (deferido) |
| `CapacityCard.tsx` | `src/components/financial/CapacityCard.tsx` | Adaptar hook `useFinancialHealth` |
| `useCashFlowData.ts` | `src/hooks/useCashFlowData.ts` | Trocar `sales_history` por `ml_daily_cache`; trocar orgMember lookup pelo padrão do garment (`useOrganization`) |
| `useTodayBalance.ts` | `src/hooks/useTodayBalance.ts` | Trocar `p_user_id` por `p_org_id` (RPC garment é INVOKER, não resolve user→org) |
| `useProjectedBalance.ts` | `src/hooks/useProjectedBalance.ts` | Manter quase idêntico |
| `useFinancialHealth.ts` | `src/hooks/useFinancialHealth.ts` | Trocar `transactions` queries por `cash_inflows`/`cash_outflows`; usar `useOrganization()` em vez do lookup direto |

**Diferença importante:** O nexointeligence usa `useUserPermissions()` (hook próprio de permissões). No garment, o padrão é `useOrganization()` + `RoleRoute` — não há `canViewFinance`. Os hooks garment devem usar `useOrganization()` para obter `currentOrg.id`.

### Hook de org no garment

```typescript
// Fonte: /root/garment-glow-test/src/contexts/OrganizationContext.tsx [VERIFIED via CONVENTIONS.md]
const { currentOrg } = useOrganization();
const orgId = currentOrg?.id ?? null;
// (não usar organization_members query direta como no nexointeligence — já está no contexto)
```

---

## Armadilhas Conhecidas

### Armadilha 1: SECURITY DEFINER → IDOR em RPC de tenant

**O que vai errado:** Se a função RPC usar `SECURITY DEFINER`, o chamador pode passar qualquer `p_org_id` e ver dados de outra org (bypass do RLS).
**Prevenção:** Sempre `SECURITY INVOKER` para RPCs de dados de tenant. O RLS de `cash_inflows`/`cash_outflows` por `organization_id` + `is_org_member(organization_id, auth.uid())` é o guard real.
**Fonte:** `[VERIFIED: feedback_supabase_security_invoker.md]`

### Armadilha 2: PostgREST trunca selects diretos em 1000 linhas

**O que vai errado:** Um `supabase.from('cash_inflows').select(...)` retorna no máximo 1000 linhas. Com 3+ anos de histórico pode truncar.
**Prevenção:** Sempre usar `supabase.rpc('get_cashflow', ...)` para leitura de dados de volume. RPCs retornam o conjunto completo. Selects diretos de linhas individuais (ex: `financial_settings`) são seguros.
**Fonte:** `[VERIFIED: feedback_postgrest_pagination.md]`

### Armadilha 3: Boundary de data em colunas `timestamptz`

**O que vai errado:** Em `cash_inflows.release_date` é do tipo `date` (não `timestamptz`), então não há problema de timezone. Mas se alguma query usar `ml_daily_cache` para a SMA, a coluna `data` pode ser `timestamptz` — usar `.lt(nextDayUTC(to))` e nunca `.lte` com string de data.
**Prevenção:** Manter `release_date` e `due_date` como `date` (não `timestamptz`) nas tabelas novas — muito mais simples para cálculos de caixa por dia.
**Fonte:** `[VERIFIED: feedback_timestamptz_date_filter.md]`

### Armadilha 4: SUPABASE_SERVICE_ROLE_KEY no formato sb_secret_

**O que vai errado:** A EF usa `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`. Desde a rotação do Supabase, o valor correto começa com `sb_secret_` (não JWT legado `eyJ...`).
**Prevenção:** Verificar no Supabase Dashboard que o secret configurado na EF é o atual.
**Fonte:** `[VERIFIED: sessão 2026-06-13b]`

### Armadilha 5: Tabela `transactions` do nexointeligence tem `amount` signed (+ entrada, - saída)

**O que vai errado:** Copiar os RPCs diretamente sem adaptar o sinal. No nexointeligence `SUM(amount)` funciona porque entradas são positivas e saídas negativas na mesma coluna. No garment, serão tabelas separadas.
**Prevenção:** Na `get_cashflow` garment, calcular `d_balance = d_income - d_expense` explicitamente (ver SQL acima).

### Armadilha 6: Token ML × API Mercado Pago — escopo

**O que vai errado:** O endpoint `https://api.mercadopago.com/v1/payments/search` pode retornar 401 se o token não tiver o escopo `read_payments`.
**Prevenção:** O nexo-mcp usa o mesmo token ML para chamar a API MP há meses sem 401 (`[VERIFIED: /root/nexo-mcp/ml_client.py]`). O scopo padrão do fluxo OAuth ML inclui acesso ao MP da mesma conta. Porém, adicionar tratamento de 401 na EF (retry com token refresh via `ml-token-refresh`) como nas outras EFs.

### Armadilha 7: EF sync-mp-releases pode ser lenta em sellers de alto volume

**O que vai errado:** Volume alto (>500 payments) + detalhes individuais (1 req/payment) pode causar timeout da EF (Supabase Edge Functions têm limite de 2-3 min).
**Prevenção:** Para o MVP (Pé Vermeio, volume moderado), não é problema. Implementar idempotência por `payment_id` para que re-execuções não dupliquem dados. Processar apenas janela de 45 dias (não histórico todo).

---

## Não Construir Manualmente

| Problema | Não Construir | Usar em Vez | Por Quê |
|----------|--------------|-------------|---------|
| Gráfico de linha dupla com área | Componente SVG custom | Recharts `ComposedChart` + `Area` + `Line` | Já no stack; CashFlowChart.tsx do nexointeligence é cópia quase direta |
| Cálculo de acumulado por dia | Loop JS no frontend | `get_cashflow` RPC com `SUM() OVER (ORDER BY date ASC)` | Window function em SQL é 10-100x mais rápida que loop sobre array |
| Paginação de payments MP | Lógica manual no frontend | Loop `while offset < total` na EF (back-end) | O padrão já existe em `fetch_mp_payments` do nexo-mcp |
| Detecção de data crítica (saldo vai zerar) | Loop frontend | `get_projected_balance_summary` RPC — loop de `FOR rec IN ...` já implementado | Lógica complexa testada e encapsulada no nexointeligence |

---

## Inventário de Estado em Runtime

> Seção obrigatória para fase com ingestão/novas tabelas.

| Categoria | Itens Encontrados | Ação Necessária |
|-----------|------------------|-----------------|
| Dados armazenados | Nenhum — `cash_inflows`, `cash_outflows`, `financial_settings` não existem (confirmado via grep das migrations do garment) | Criar via migration |
| Config de serviço live | `pg_cron` precisa de nova entry para `sync-mp-releases` diário | Adicionar na migration |
| Estado de OS | Nenhum | N/A |
| Secrets/env vars | `SUPABASE_SERVICE_ROLE_KEY` já existe nas EFs; `ML_API` não muda | Nenhum novo secret necessário |
| Artefatos de build | Nenhum | N/A |

**Nada encontrado nas categorias OS-registered e secrets** — verificado.

---

## Disponibilidade do Ambiente

| Dependência | Requerida por | Disponível | Versão | Fallback |
|-------------|---------------|-----------|--------|----------|
| Supabase projeto `ckcdevcxgvueywivefgx` | Todas as EFs e RPCs | Sim | — | — |
| Token ML na tabela `ml_tokens` | EF sync-mp-releases | Sim (org Pé Vermeio ativa) | — | — |
| API `api.mercadopago.com` | EF sync-mp-releases | Sim (nexo-mcp usa há meses) | — | — |
| `pg_cron` extension | Agendamento da EF | Sim (já usado em outras EFs) | — | — |
| Recharts 2.15.4 | CashFlowChart.tsx | Sim (no package.json) | 2.15.4 | — |
| date-fns 3.6.0 | Hooks de data | Sim | 3.6.0 | — |

**Sem dependências bloqueantes.**

---

## Questões Abertas (RESOLVED)

> **RESOLVIDAS (Wesley 2026-06-18):** As 4 questões abaixo foram endereçadas no planejamento. (1) escopo OAuth MP — smoke de 401 no deploy da EF (Task 4 do 49-01); (2) fonte da SMA — `orders` agregado por `organization_id` (49-02, corrige A3/A5); (3) saídas — NÃO é mais seed manual: integração Tiny `/contas-pagar` via EF `sync-tiny-payables` (49-05); (4) janela histórica/futura — EF com dois modos (days_back/days_ahead) no 49-01. Mantidas abaixo como registro histórico.

1. **Escopo OAuth do token ML para API Mercado Pago**
   - O que sabemos: o nexo-mcp usa o mesmo token ML para `/v1/payments/search` há meses sem problemas.
   - O que é incerto: se o garment usa o mesmo fluxo OAuth (deveria — ambos usam ML OAuth padrão), mas não testado neste ambiente ainda.
   - Recomendação: primeiro task da EF deve incluir um teste de fumaça com log do status HTTP da chamada MP. Adicionar tratamento de 401 com retry via `ml-token-refresh`.

2. **Fonte da SMA no RPC garment**
   - O que sabemos: nexointeligence usa `sales_history.total_sales`. O garment usa `ml_daily_cache` para dados de vendas diárias.
   - O que é incerto: qual campo exato de `ml_daily_cache` usar (receita_bruta, receita_liquida, gmv).
   - Recomendação: usar `receita_liquida` (pós-comissões) se disponível, ou `gmv` com multiplicador `(1 - custo_operacional)`. Verificar schema de `ml_daily_cache` no plano.

3. **Seed inicial de `cash_outflows`**
   - O que sabemos: Wesley precisará lançar despesas para que o MVP tenha saídas reais no gráfico.
   - O que é incerto: se ele quer um formulário mínimo (1 tela) ou aceita lançar via SQL para o MVP.
   - Recomendação: MVP sem UI de CRUD (deferido); documentar como Wesley pode fazer seed via Supabase Table Editor. Se ele quiser UI, é uma task separada de baixa prioridade.

4. **`money_release_status === "released"` — dados históricos**
   - O que sabemos: o nexo-mcp ignora pagamentos com status `released` (já caiu na conta, não é projeção futura).
   - O que é incerto: para o gráfico de **saldo passado** (dias que já passaram), precisamos exatamente dos pagamentos `released`. A EF precisa de dois modos: janela futura (projeção) e janela histórica (real).
   - Recomendação: A EF deve ter dois parâmetros opcionais `days_back` e `days_ahead`. Na janela histórica, buscar `money_release_status === "released"` sem o filtro de descarte.

---

## Log de Premissas

| # | Premissa | Seção | Risco se Errado |
|---|----------|-------|-----------------|
| A1 | Token OAuth ML garante acesso à API Mercado Pago `/v1/payments/search` | Ingestão MP | A EF vai retornar 401 no primeiro run; precisaria de fluxo OAuth MP separado (alto esforço) |
| A2 | `cash_outflows` com lançamento manual é aceitável como fonte de saídas para o MVP | CASH-02 | Wesley pode querer uma tela de CRUD, adicionando esforço à fase |
| A3 | `ml_daily_cache.receita_liquida` ou similar existe e pode ser usado para SMA | Fórmula de projeção | O RPC precisaria de fonte diferente para a SMA |
| A4 | O grupo "Operações" no sidebar é o local correto (já existe, não criar um novo "Financeiro") | Navegação | Pode ser que Wesley queira grupo separado "Caixa" |

---

## Arquitetura Padrão — Estrutura de Arquivos Recomendada

```
supabase/
  functions/
    sync-mp-releases/
      index.ts           -- EF de ingestão de liberações MP
  migrations/
    20260618_cash_flow_tables.sql  -- financial_settings + cash_inflows + cash_outflows + RLS
    20260618_cash_flow_rpcs.sql    -- get_cashflow + get_daily_balance + get_projected_balance_summary
    20260618_cash_flow_cron.sql    -- pg_cron sync-mp-releases (diário)

src/
  pages/mercadolivre/
    MLFluxoCaixa.tsx     -- Página principal /fluxo-de-caixa
  components/financial/
    CashFlowChart.tsx    -- Gráfico ComposedChart 120 dias (portado do nexointeligence)
    TodayBalanceCard.tsx -- Card "Quanto tenho hoje?"
    ProjectedBalanceCard.tsx  -- Card "Vou ter dinheiro no futuro?"
    CapacityCard.tsx     -- Card "Posso comprar mais estoque?"
  hooks/
    useCashFlowData.ts         -- Hook do gráfico (chama get_cashflow RPC)
    useTodayBalance.ts         -- Hook do card Caixa Hoje
    useProjectedBalance.ts     -- Hook do card Projeção Futura
    useFinancialHealth.ts      -- Hook do card Capacidade (client-side)
    useFinancialSettings.ts    -- Hook para ler/gravar financial_settings
```

---

## Segurança (ASVS)

| Categoria ASVS | Aplica | Controle Padrão |
|----------------|--------|-----------------|
| V4 Controle de Acesso | Sim | RLS `is_org_member(organization_id, auth.uid())` em todas as tabelas novas |
| V5 Validação de Entrada | Sim | EF valida tipos com Zod; RPC usa tipos PostgreSQL |
| V6 Criptografia | Não | Dados financeiros em repouso no Supabase (criptografia gerenciada) |

**Ameaças conhecidas:**

| Padrão | STRIDE | Mitigação |
|--------|--------|-----------|
| RPC com SECURITY DEFINER + p_org_id = IDOR | Elevation of Privilege | SECURITY INVOKER obrigatório |
| Acesso cross-org via cash_inflows sem RLS | Information Disclosure | RLS `is_org_member` + policy FOR SELECT |
| EF sem verify_jwt | Spoofing | Todas as EFs do garment usam `verify_jwt=true` (padrão) |

---

## Arquitetura de Validação

> `workflow.nyquist_validation = false` em `.planning/config.json` — seção omitida conforme instrução.

---

## Fontes

### Primárias (HIGH)

- `/tmp/nexointeligence/src/hooks/useCashFlowData.ts` — lógica completa do hook de gráfico
- `/tmp/nexointeligence/src/hooks/useFinancialHealth.ts` — fórmula de capacidade de compra
- `/tmp/nexointeligence/supabase/migrations/20251226205426_bbc9c3ec-...sql` — SQL de `get_financial_cashflow` e `get_projected_balance_summary`
- `/tmp/nexointeligence/supabase/migrations/20251129030331_baf6ca6f-...sql` — SQL de `get_daily_balance` v1
- `/root/nexo-mcp/ml_client.py` linhas 1725–1950 — `fetch_mp_payments`: endpoint MP, campos, filtros

### Secundárias (MEDIUM)

- `/root/garment-glow-test/src/components/layout/ApiSidebar.tsx` — estrutura de navegação existente
- `/root/garment-glow-test/src/config/roleAccess.ts` — mapa de permissões existente
- `/root/garment-glow-test/src/App.tsx` — padrão de rota lazy + RoleRoute

### Confirmadas via Codebase (VERIFIED)

- `SUPABASE_SERVICE_ROLE_KEY` formato `sb_secret_` — confirmado em sessão 2026-06-13b
- SECURITY INVOKER obrigatório — confirmado em `feedback_supabase_security_invoker.md`
- PostgREST trunca em 1000 — confirmado em `feedback_postgrest_pagination.md`
- Boundary timestamptz — confirmado em `feedback_timestamptz_date_filter.md`

---

## Metadados

**Breakdown de confiança:**

- Stack padrão: HIGH — todos os pacotes já no garment, sem instalação nova
- Arquitetura (tabelas + RPCs): HIGH — lógica extraída 1:1 do nexointeligence com adaptação documentada
- Ingestão de liberações MP: MEDIUM — endpoint validado no nexo-mcp; escopo OAuth assumido
- Fonte de SMA no garment: MEDIUM — ml_daily_cache existe, campo exato a confirmar no plano
- Saídas MVP (lançamento manual): ASSUMED — decisão de produto pendente confirmação do Wesley

**Data da pesquisa:** 2026-06-18
**Válido até:** 2026-07-18 (stack estável)

---

---

## Ingestão de Saídas via Tiny (CASH-02 atualizado — Wesley 2026-06-18)

> Pesquisa complementar adicionada em 2026-06-18.
> Contexto: Wesley decidiu integrar contas a pagar do Tiny já na Wave 1 (em vez de lançamento manual).
> Esta seção documenta o endpoint, campos, estado da conexão Tiny no garment e o padrão da EF nova.

---

### 1. Recurso e Endpoint Recomendado

**Fonte primária das saídas: `GET /contas-pagar`** (contas a pagar do Tiny ERP)

`[VERIFIED: /root/nexo-mcp/tiny_client.py linhas 1214–1294]`

```
Base URL: https://api.tiny.com.br/public-api/v3
Endpoint: GET /contas-pagar
Parâmetros:
  dataVencimentoInicial  YYYY-MM-DD  — data de vencimento inicial
  dataVencimentoFinal    YYYY-MM-DD  — data de vencimento final
  pagina                 int         — paginação (default 1)
  limit                  int         — itens por página (máx 100)

NOTA CRÍTICA: NÃO enviar o parâmetro "situacao" para a API — Tiny v3 rejeita/ignora
o enum "em_aberto". O filtro por situação deve ser feito client-side após normalização.
```

**Por que `/contas-pagar` e não `/ordem-compra`:**

| Recurso | O que representa | Data relevante | Tem valor de desembolso? |
|---------|-----------------|----------------|--------------------------|
| `/contas-pagar` | Conta a pagar criada (boleto, fatura fornecedor, despesa) | `dataVencimento` (vencimento) + eventual `dataPagamento` (pagamento efetivo) | Sim — campo `valor` é o valor exato da saída |
| `/ordem-compra` | Pedido de compra ao fornecedor (intenção de compra) | `dataPrevista` (entrega prevista) | Parcial — `preco_unitario × quantidade` mas sem data de desembolso definida |

**Conclusão:** `/contas-pagar` é a fonte certa para saídas de caixa. A ordem de compra representa uma intenção, não um pagamento; a conta a pagar representa o compromisso financeiro com data e valor confirmados.

---

### 2. Campos da Resposta e Campo de Data da Saída de Caixa

Trecho extraído de `fetch_payables_tiny` em `/root/nexo-mcp/tiny_client.py` (linhas 1258–1282):

```python
# [VERIFIED: /root/nexo-mcp/tiny_client.py]
for item in itens:
    contato = item.get("contato") or {}
    raw_sit = str(item.get("situacao") or "").lower().strip()
    if raw_sit in ("aberto", "em_aberto", "em aberto", "pendente", "1"):
        sit_normalized = "em_aberto"
    elif raw_sit in ("pago", "quitado", "2"):
        sit_normalized = "pago"
    else:
        sit_normalized = raw_sit
    records.append(
        {
            "id": str(item.get("id") or ""),
            "descricao": item.get("historico") or item.get("descricao") or "",
            "fornecedor": contato.get("nome") or item.get("nomeFornecedor") or "",
            "valor": float(item.get("valor") or 0),
            "data_vencimento": (
                item.get("dataVencimento") or item.get("data_vencimento") or ""
            )[:10],
            "situacao": sit_normalized,
            "tipo": item.get("tipo") or item.get("tipoOrdem") or "",
            "numero_documento": item.get("numeroDocumento") or item.get("numero") or "",
        }
    )
```

**Campos relevantes para `cash_outflows`:**

| Campo Tiny | Campo em cash_outflows | Observação |
|-----------|----------------------|------------|
| `id` | `tiny_payable_id` (chave idempotência) | ID único do Tiny — usar na UNIQUE constraint |
| `valor` | `amount` | Valor positivo da saída |
| `dataVencimento` [:10] | `due_date` (DATE) | Vencimento — usar como `outflow_date` quando não há pagamento |
| `historico` / `descricao` | `description` | Descrição da conta |
| `contato.nome` / `nomeFornecedor` | `supplier` | Fornecedor (nova coluna recomendada) |
| `situacao` normalizada | `status` | `em_aberto` ou `pago` |
| `tipo` | `category` | Tipo da conta (fornecedor, despesa operacional etc.) |
| `numeroDocumento` | `document_number` | Número do documento (boleto, NF etc.) |

**Campo de data da saída de caixa:**

- **Preferencial:** `data_pagamento` (data efetiva do pagamento) — indica o dia em que o dinheiro saiu de fato.
- **Fallback:** `dataVencimento` (vencimento) — quando não há pagamento registrado ainda (situacao = em_aberto).
- **Atenção:** A API Tiny v3 pode não retornar `data_pagamento` no endpoint de listagem `/contas-pagar`. Se estiver ausente, usar `data_vencimento` como data da saída. `[ASSUMED — verificar no primeiro teste de fumaça da EF]`
- Formato vindo do Tiny: string `YYYY-MM-DD` (já truncado em `[:10]` no nexo-mcp). Não há conversão de timezone necessária — data pura, compatível com coluna `DATE` no PostgreSQL.

---

### 3. Estado da Conexão Tiny no Garment (ckcdevcxgvueywivefgx)

**Tokens do Tiny — onde ficam:** `[VERIFIED: /root/garment-glow-test/supabase/functions/sync-tiny-costs/index.ts e migrations 20260521*]`

Os tokens Tiny são armazenados **na mesma tabela `ml_tokens`** do garment, em colunas adicionadas pela migration `20260521210000_ml_tokens_add_tiny.sql`:

```sql
-- [VERIFIED: /root/garment-glow-test/supabase/migrations/20260521210000_ml_tokens_add_tiny.sql]
ALTER TABLE public.ml_tokens
  ADD COLUMN IF NOT EXISTS tiny_access_token  TEXT,
  ADD COLUMN IF NOT EXISTS tiny_expires_at    BIGINT;  -- Unix timestamp

-- [VERIFIED: /root/garment-glow-test/supabase/migrations/20260521220000_ml_tokens_add_tiny_refresh.sql]
ALTER TABLE public.ml_tokens
  ADD COLUMN IF NOT EXISTS tiny_refresh_token TEXT;
```

**Padrão de autenticação Tiny no garment** (extraído de `sync-tiny-costs/index.ts`):

```typescript
// [VERIFIED: /root/garment-glow-test/supabase/functions/sync-tiny-costs/index.ts linhas 28–71]
async function getTinyToken(mlUserId: string): Promise<string> {
  const { data: tok } = await sb
    .from("ml_tokens")
    .select("tiny_access_token, tiny_refresh_token, tiny_expires_at")
    .eq("ml_user_id", mlUserId)
    .maybeSingle();

  // Se token expira em menos de 5 minutos, faz refresh
  const now = Math.floor(Date.now() / 1000);
  if (tok.tiny_expires_at && tok.tiny_expires_at - now > 300) {
    return tok.tiny_access_token;  // token ainda válido
  }

  // Refresh via EF tiny-oauth (action=refresh_token)
  const refreshResp = await fetch(`${SUPABASE_URL}/functions/v1/tiny-oauth`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({
      action: "refresh_token",
      refresh_token: tok.tiny_refresh_token,
      ml_user_id: mlUserId,
    }),
  });
  return refreshData.access_token;
}
```

**EFs Tiny existentes no garment:**

| EF | Propósito | Padrão reutilizável |
|----|-----------|---------------------|
| `tiny-oauth` | Troca código OAuth, persiste tokens em `ml_tokens`, refresh_all via pg_cron | Sim — a nova EF chama `action=refresh_token` da mesma forma |
| `sync-tiny-costs` | Sync de custos de produtos Tiny → `ml_product_costs` | Sim — padrão `getTinyToken(mlUserId)` + `tinyGet(token, path)` idêntico ao que a nova EF usará |

**A EF `tiny-oauth` já tem `action=refresh_all`** (pg_cron a cada 90min) que renova todos os tokens próximos de expirar. A nova EF `sync-tiny-payables` não precisa gerenciar refresh — apenas chamar `getTinyToken(mlUserId)` e o refresh acontece automaticamente se necessário.

**Tabelas que já vêm do Tiny no garment:**

| Tabela | Alimentada por | Campos Tiny |
|--------|---------------|-------------|
| `ml_product_costs` | `sync-tiny-costs` | `cost` (precoCustoMedio), `seller_sku` |

Nenhuma tabela de contas a pagar ou pagáveis existe ainda — `cash_outflows` será a primeira.

---

### 4. Mapeamento Multi-tenant

**Relação org ↔ conta Tiny no garment:** `[VERIFIED: /root/garment-glow-test/supabase/migrations/20260513174419_01a9d737-764b-4fb5-8839-b0497f1adc0e.sql]`

```
organization_id  ──►  ml_tokens (organization_id NOT NULL)
                           │
                           ├── ml_user_id   (ID da loja ML)
                           ├── tiny_access_token
                           ├── tiny_refresh_token
                           └── tiny_expires_at
```

O vínculo é por `ml_user_id` (ID da loja no ML). Cada linha de `ml_tokens` representa **uma loja ML + sua conta Tiny associada**. Uma org pode ter múltiplas lojas (múltiplas linhas em `ml_tokens`).

**Como a EF `sync-tiny-payables` deve iterar para multi-tenant:**

```typescript
// Padrão: buscar todos os ml_user_ids com Tiny conectado para a org
const { data: tokenRows } = await sb
  .from("ml_tokens")
  .select("ml_user_id, organization_id")
  .not("tiny_access_token", "is", null);   // apenas lojas com Tiny ativo

// Para cada loja:
for (const row of tokenRows) {
  const tinyToken = await getTinyToken(row.ml_user_id);
  // fetch /contas-pagar + upsert em cash_outflows com organization_id = row.organization_id
}
```

**Chave de idempotência para upsert:**

```sql
CONSTRAINT cash_outflows_tiny_unique UNIQUE (organization_id, tiny_payable_id)
```

Onde `tiny_payable_id` é o `id` retornado pelo Tiny. Isso garante que re-execuções da EF não dupliquem registros.

**Nota:** O Tiny é single-tenant no nexo-mcp (só a conta Pé Vermeio), mas no garment é multi-tenant por `ml_user_id`. O padrão do `sync-tiny-costs` já demonstra o loop por `ml_user_id` — a nova EF segue o mesmo padrão.

---

### 5. Schema Atualizado de `cash_outflows` (com coluna Tiny)

A tabela `cash_outflows` definida na pesquisa original deve ser estendida para suportar a ingestão Tiny:

```sql
-- [ASSUMED — adaptação da pesquisa original + campos Tiny identificados no nexo-mcp]
CREATE TABLE public.cash_outflows (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  outflow_date     date NOT NULL,          -- data efetiva da saída (pagamento) ou vencimento
  amount           numeric NOT NULL,       -- valor positivo (saída)
  description      text NOT NULL,          -- historico / descricao do Tiny
  supplier         text,                   -- contato.nome / nomeFornecedor
  category         text,                   -- tipo da conta no Tiny
  status           text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','paid')),
  document_number  text,                   -- numeroDocumento
  source           text NOT NULL DEFAULT 'manual'
                       CHECK (source IN ('manual', 'tiny')),
  tiny_payable_id  text,                   -- id do Tiny (para idempotência)
  synced_at        timestamptz DEFAULT now(),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  CONSTRAINT cash_outflows_tiny_unique UNIQUE (organization_id, tiny_payable_id)
);
-- tiny_payable_id é NULLABLE para registros manuais (source='manual')
-- A UNIQUE constraint aceita múltiplos NULLs (NULL != NULL no PostgreSQL)
```

**Diferença da versão original:** adicionadas colunas `supplier`, `source`, `tiny_payable_id`, `synced_at`, `document_number`. O campo `due_date` foi renomeado para `outflow_date` para melhor semântica (representa a data do desembolso, que pode ser vencimento ou pagamento efetivo).

---

### 6. Estrutura da EF `sync-tiny-payables`

A EF deve seguir o padrão de `sync-tiny-costs/index.ts`:

```typescript
// [ASSUMED — estrutura proposta, baseada em sync-tiny-costs VERIFIED]

const TINY_API = "https://api.tiny.com.br/public-api/v3";
const DAYS_BACK    = 90;   // histórico de contas pagas
const DAYS_FORWARD = 90;   // contas a vencer no futuro

async function fetchPayables(token: string, dateFrom: string, dateTo: string) {
  let page = 1;
  const allItems: TinyPayable[] = [];
  while (true) {
    const data = await tinyGet(token, "/contas-pagar", {
      dataVencimentoInicial: dateFrom,
      dataVencimentoFinal:   dateTo,
      pagina: String(page),
      limit:  "100",
      // NÃO enviar situacao — filtrar client-side
    });
    const itens = data?.itens ?? data?.data ?? (Array.isArray(data) ? data : []);
    if (!itens.length) break;
    allItems.push(...itens);
    if (itens.length < 100) break;
    page++;
    await sleep(600);  // ~100 req/min rate limit Tiny
  }
  return allItems;
}

// Normalização client-side da situação
function normalizeSituacao(raw: string): "pending" | "paid" {
  const s = raw.toLowerCase().trim();
  if (["pago", "quitado", "2"].includes(s)) return "paid";
  return "pending";  // em_aberto, aberto, pendente, 1, etc.
}

// Upsert idempotente
await sb.from("cash_outflows").upsert(rows, {
  onConflict: "organization_id,tiny_payable_id",
  ignoreDuplicates: false,  // atualiza status (pode ter sido pago desde último sync)
});
```

**Agendamento pg_cron recomendado:** `0 */6 * * *` (a cada 6 horas) — contas a pagar mudam com menos frequência que liberações MP; 4x ao dia é suficiente.

---

### 7. Diagrama de Fluxo Atualizado (CASH-02 integrado)

```
pg_cron (*/6h) ──► EF sync-tiny-payables
                          │
                          ├── SELECT ml_tokens WHERE tiny_access_token IS NOT NULL
                          │
                          └── Para cada loja (ml_user_id):
                                │
                                ├── getTinyToken(ml_user_id)
                                │   └── refresh via EF tiny-oauth se necessário
                                │
                                ├── GET https://api.tiny.com.br/public-api/v3/contas-pagar
                                │   ?dataVencimentoInicial=hoje-90d
                                │   &dataVencimentoFinal=hoje+90d
                                │   &pagina=1&limit=100
                                │
                                └── UPSERT cash_outflows
                                    (organization_id, tiny_payable_id UNIQUE)
                                    source='tiny'
```

---

### 8. Riscos e Incógnitas

| # | Risco | Probabilidade | Mitigação |
|---|-------|---------------|-----------|
| R1 | Campo `data_pagamento` ausente no endpoint `/contas-pagar` | MÉDIA — a API do nexo-mcp não captura esse campo (usa apenas `dataVencimento`) | Usar `dataVencimento` como `outflow_date` por padrão; adicionar `data_pagamento` como coluna opcional se a API retornar |
| R2 | `TINY_APP_ID` / `TINY_APP_SECRET` não configurados como secrets na EF `sync-tiny-payables` | BAIXA — já existem nas EFs `tiny-oauth` e `sync-tiny-costs` | Reusar os mesmos secrets; documentar no Wave 0 que secrets já existem |
| R3 | Tiny não ter contas a pagar cadastradas para orgs de teste | BAIXA para Pé Vermeio (conta real) | Smoke test com um período amplo (90d passado) — pelo menos contas pagas devem existir |
| R4 | `tiny_payable_id` null duplicado na UNIQUE constraint | BAIXA — PostgreSQL aceita múltiplos NULLs em UNIQUE (NULL != NULL) | Garantir `source='tiny'` → `tiny_payable_id` preenchido; `source='manual'` → `tiny_payable_id` NULL |
| R5 | Conta Tiny com múltiplas lojas (multi-ml_user_id por org) criando contas duplicadas | BAIXA para Pé Vermeio (1 loja) | A UNIQUE constraint é `(organization_id, tiny_payable_id)` — o mesmo `tiny_payable_id` vindo de duas lojas distintas seria inserido duas vezes. Se o Tiny for compartilhado entre lojas, adicionar `ml_user_id` à UNIQUE constraint |
| R6 | Rate limit Tiny atingido em orgs com muitas contas a pagar (>500 registros/sync) | BAIXA para MVP | Paginação com `sleep(600ms)` entre páginas; `limit=100` por página |

**Incógnita principal:** confirmar se a API Tiny v3 `/contas-pagar` retorna `dataPagamento` (data efetiva do pagamento) além de `dataVencimento`. O nexo-mcp não captura esse campo. Se disponível, é o campo preferencial para `outflow_date` em registros com `status='paid'`.

---

### 9. Comparação com Pesquisa Original (CASH-02)

| Aspecto | Pesquisa Original (lançamento manual) | Pesquisa Atualizada (Tiny integrado) |
|---------|--------------------------------------|---------------------------------------|
| Fonte das saídas | Tabela `cash_outflows` com seed manual | Tabela `cash_outflows` alimentada por EF `sync-tiny-payables` |
| Esforço | Baixo (tabela + seed SQL) | Médio (EF nova, tokens já existem) |
| Dado | Wesley lança uma vez, não atualiza | Atualizado a cada 6h automaticamente |
| Wave | Tabela criada na Wave 1, UI deferida | EF + tabela + pg_cron tudo na Wave 1 |
| Risk | Dado desatualizado / esquecido | Depende de conexão Tiny ativa por loja |
| EF base | N/A | `sync-tiny-costs` — padrão idêntico |

**Impacto no plano:** A Wave 1 (49-01) fica mais pesada: inclui tanto `sync-mp-releases` (entradas) quanto `sync-tiny-payables` (saídas). Ambas as EFs têm padrão quase idêntico — a segunda é substancialmente mais simples pois o endpoint do Tiny é mais direto que o do MP (não precisa de detalhe por ID).

---

### Assumptions Log (seção Tiny)

| # | Premissa | Risco se Errado |
|---|----------|-----------------|
| A5 | `/contas-pagar` não exige `situacao` como parâmetro (filtrar client-side) | EF pode retornar 400 se enviar enum; já documentado no nexo-mcp como "não enviar" |
| A6 | `tiny_payable_id` é estável (não muda após criação da conta no Tiny) | Duplicação de registros em re-syncs; correção: DELETE + re-insert ou alterar chave |
| A7 | `dataPagamento` pode ser capturado do endpoint `/contas-pagar` para contas pagas | Se ausente, `outflow_date` usa `dataVencimento` — saída refletida na data de vencimento, não de pagamento |
| A8 | O `TINY_APP_ID` e `TINY_APP_SECRET` já configurados para `sync-tiny-costs` servem para `sync-tiny-payables` | São as mesmas credenciais de app Tiny — compartilhar secrets é o padrão correto |

---

## RESEARCH COMPLETE
