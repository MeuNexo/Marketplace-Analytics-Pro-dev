# Phase 99: DRE Caixa — apuração por recebimento Mercado Pago - Research

**Researched:** 2026-07-16
**Domain:** Supabase RPC (SQL STABLE/SECURITY INVOKER) + React/TanStack Query frontend, apuração de caixa puro
**Confidence:** HIGH (schema e RPCs de origem lidos diretamente do repo/prod; nenhuma lib nova, nenhum pacote a instalar)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Base de entradas (LOCKED)**
- Entradas = recebimento **líquido** MP: `cash_inflows.net_amount` somado por **`release_date`** (data de liberação) dentro do mês; para o mês corrente, só `release_date <= hoje`.
- Recebimento bruto (`gross_amount`) e "descontos na fonte" (bruto − líquido) são linhas **informativas**.
- Refunds: `net_amount` já vem negativo — a base já desconta; linha informativa "dos quais devoluções" (Σ net onde `status_mp='refunded'`).
- "Ainda a liberar no mês" = Σ `net_amount` com `release_date > hoje` e ≤ fim do mês (informativo; o sync já traz 45 dias à frente).

**Tarifas ML (LOCKED)**
- **NÃO abater tarifas ML de novo** — já vêm retidas na fonte dentro do net do MP. `ml_billing_daily` NÃO entra nesta apuração.

**Régua de saídas (LOCKED)**
- Caixa puro: `cash_outflows` com `status='paid'`, pela data de pagamento (`outflow_date`), dentro do mês. `cancelled` sempre excluídas. `competence_date` NÃO é usada aqui.
- Blocos de categoria = reaproveitar o helper existente `dre_bloco_for_category(text)` (impostos_venda, pessoal, estrutura, servicos, operacional, financeiro, nao_classificado, excluido).
- `nao_classificado` > 0 → gate visual (mesmo aviso da DRE atual).

**Imposto (LOCKED)**
- Guia **paga no mês** entra como saída real (dentro do bloco impostos_venda).
- Linha **informativa** de previsão: para cada um dos 3 meses fechados anteriores, `taxa_m = guias pagas no mês ÷ faturamento do mês (orders paid/shipped/delivered por data_pedido)`; previsão = média(taxa_m) × faturamento do mês corrente. Menos de 3 meses com dados → usar os que existirem; nenhum → previsão null (frontend mostra "—"). Alerta visual de desvio previsão × guia real.

**Cascata (LOCKED)**
```
Recebimento bruto MP (informativo)
(−) Descontos na fonte (informativo)
    dos quais devoluções/refunds (informativo)
= RECEBIMENTO LÍQUIDO MP  ← base real
(−) Impostos (guias pagas) / Pessoal / Estrutura / Serviços / Operacional / Não classificado
= RESULTADO OPERACIONAL DE CAIXA
(−) Financeiro (empréstimos etc. pagos)
= RESULTADO DE CAIXA DO MÊS
```
- Badge-resposta no topo: verde "As entradas do mês pagaram as contas — sobrou R$ X" / vermelho "Faltou R$ X — esse dinheiro saiu de outro lugar". Mês corrente = selo "mês em andamento"; mês sem dados = badge neutro "sem movimentação".

**Backend (LOCKED)**
- 3 RPCs, padrão obrigatório do projeto: `LANGUAGE sql STABLE SECURITY INVOKER SET search_path='public'`, 1º arg `p_org_id uuid`, RLS decide acesso, `REVOKE FROM PUBLIC, anon; GRANT TO authenticated`. **Sem subquery correlacionada** (timeout 8s do role authenticated — pré-carregar lookups em CTE).
  1. `get_dre_cash(p_org_id uuid, p_month date)` → `(secao text, bloco text, categoria text, total numeric, n int)`; seções `entrada` / `saida` / `previsao`.
  2. `get_dre_cash_items(p_org_id uuid, p_month date, p_bloco text)` → lançamentos individuais (outflow_date, supplier, category, amount) para drill-down sob demanda.
  3. `get_dre_cash_history(p_org_id uuid, p_months int)` → por mês até 12: (mes, entradas, saidas, resultado).
- Zero tabela/EF/cron novos. Cascata e totais montados no frontend (lib pura).

**Frontend (LOCKED)**
- Página `src/pages/mercadolivre/MLDreCaixa.tsx`, rota lazy `/dre-caixa` + RoleRoute + item de menu (grupo financeiro).
- Hooks `useDreCash.ts`, `useDreCashItems.ts`, `useDreCashHistory.ts` (TanStack Query, padrão dos demais).
- Lib pura `src/lib/dreCashCascade.ts` (cascata + badge a partir das linhas da RPC) — testada com vitest, espelho de `dreCascade.ts`.
- Layout topo→baixo: header (seletor de mês + badge-resposta) → KPI row (4 tiles: Entradas líquidas · Saídas pagas · Resultado · Previsão imposto × guia) → cascata com drill-down (bloco → categorias → lançamentos) → gráfico evolução 12m (entradas × saídas × resultado) → tabela histórico 12m → banner dado-velho.
- Banner dado velho: `max(synced_at)` de `cash_inflows` > 6h → alerta; exibir também frescor de `cash_outflows` (token Tiny já morreu silenciosamente antes — lição 2026-07-13).

**Separações (LOCKED — crítico)**
- **DRE por faturamento (página Vendas) INTOCADA** — nenhum arquivo dela é modificado.
- **NÃO ler nem confrontar saldo/`initial_balance`/projeções do Fluxo de Caixa** (`/fluxo-de-caixa`, `financial_settings`, `get_cashflow`, `get_treasury_panel`) — só as tabelas-fonte `cash_inflows`/`cash_outflows`.

### Claude's Discretion
- Componentização visual da página (reutilizar padrões de `src/components/financial/` e do `MLCostCard`).
- Escolha do componente de gráfico (Recharts, padrão do projeto).
- Formato exato do seletor de mês e microcopy secundária (manter linguagem para leigos do projeto).
- Nomes internos de tipos/interfaces TS.

### Deferred Ideas (OUT OF SCOPE)
- Confronto automático DRE faturamento × DRE caixa (o "confere" — detectar ML cobrando diferente).
- Monitor de venda: tarifa configurada por anúncio × cobrada em cada venda.
- Entradas manuais (Bradesco, aportes) na DRE-caixa.
- Evolução da página para dashboard financeiro completo.
</user_constraints>

## Summary

Esta phase não introduz nenhuma tecnologia nova — é 100% recombinação de padrões já provados em produção neste mesmo projeto. As 3 tabelas-fonte (`cash_inflows`, `cash_outflows`, `orders`) já existem com o schema exato descrito abaixo; as 3 RPCs a criar devem clonar literalmente o cabeçalho de segurança e o mapa categoria→bloco de `get_dre_operational_by_competence` (Phase 87/96/97, migration `20260716210000_cancelled_payables_dre.sql`) e do helper `dre_bloco_for_category` (migration `20260715221559`). O frontend clona `dreCascade.ts`/`useDreOperational.ts`/`MLFluxoCaixa.tsx` como moldes diretos. Não há pacotes novos a auditar (Package Legitimacy Audit fica vazio).

O ponto mais delicado não é técnico, é de **modelo mental**: a "previsão de imposto" desta phase usa uma régua diferente da já existente em `dreRegime.ts`/`useImpostoGuiaReal.ts` (que aplica shift M+1 para a DRE de faturamento). Na DRE Caixa, a régua é caixa puro, mesmo mês, sem shift — `taxa_m = guias pagas no mês M (outflow_date em M, status='paid', bloco impostos_venda) ÷ faturamento do mês M (orders)`. O planner deve deixar isso explícito no plano para não reusar `useImpostoGuiaReal`/`monthPlusOne` por engano.

**Primary recommendation:** Clonar `20260716210000_cancelled_payables_dre.sql` (cabeçalho SQL STABLE SECURITY INVOKER + REVOKE/GRANT) e `dre_bloco_for_category` (já existe, reusar diretamente — não recriar) para as 3 RPCs novas; clonar `dreCascade.ts`+`useDreOperational.ts`+`MLFluxoCaixa.tsx` para os equivalentes de caixa; usar `KPICard` (`src/components/dashboard/KPICard.tsx`) para os 4 tiles e o padrão `useMLLastSync`/`useWebhookHealth` (`.order("synced_at",{ascending:false}).limit(1).maybeSingle()`) para o banner de dado velho — sem RPC nova para isso.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Apuração de entradas/saídas de caixa (agregação por bloco/categoria) | API/Backend (RPC SQL) | — | Precisa RLS org-first + evitar truncamento PostgREST 1000 linhas; agregação pesada não pode ir pro cliente |
| Cascata (recebimento bruto → resultado de caixa) + badge-resposta | Browser/Client (lib pura `dreCashCascade.ts`) | — | Puro cálculo sobre linhas já agregadas pela RPC — mesmo padrão de `dreCascade.ts`, sem chamada de rede |
| Drill-down de lançamentos individuais | API/Backend (RPC `get_dre_cash_items`) | Browser (render sob clique) | Lista crua de `cash_outflows`; RPC evita re-query client-side e mantém RLS |
| Histórico 12 meses (gráfico + tabela) | API/Backend (RPC `get_dre_cash_history`) | Browser (Recharts) | Agregação por mês em SQL; Recharts só renderiza |
| Previsão de imposto (média 3 meses × faturamento) | API/Backend (dentro de `get_dre_cash`) | — | Cruza `cash_outflows` + `orders`; precisa STABLE SQL sem subquery correlacionada (timeout 8s) |
| Frescura dos dados (banner "dado velho") | Browser/Client (hook direto RLS) | — | `max(synced_at)` é leitura trivial de 1 linha — não justifica RPC nova (ver `useMLLastSync`) |
| Rota, RoleRoute, item de menu | Frontend Server (SPA routing) | — | react-router-dom lazy route + `RoleRoute` já é o padrão de todas as páginas financeiras |

## Standard Stack

Nenhuma dependência nova. Stack 100% reaproveitado do projeto:

### Core (já instalado, sem alteração de versão)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | 2.98.0 | RPC calls + RLS reads | já é a fonte única de dados do projeto |
| `@tanstack/react-query` | 5.83.0 | Hooks `useDreCash`/`useDreCashItems`/`useDreCashHistory` | padrão de todos os hooks financeiros (`useDreOperational.ts`, `useCashFlowData`) |
| `recharts` | 2.15.4 | Gráfico de evolução 12m (entradas × saídas × resultado) | mesma lib de `CashFlowChart.tsx`; wrapper `ComposedChart`/`Line`/`Bar` já provado |
| `vitest` | 3.2.4 | Testes da lib pura `dreCashCascade.ts` | mesmo runner de `dreCascade.test.ts`; `vitest.config.ts` já inclui `src/**/*.test.{ts,tsx}` — nenhuma config nova necessária |
| `react-router-dom` | 6.30.1 | Rota lazy `/dre-caixa` | padrão idêntico às outras 20 rotas em `App.tsx` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `date-fns` | 3.6.0 | Formatação de mês / navegação prev-next | mesmo padrão usado em `MLFluxoCaixa.tsx` (`format`, `addDays`) |
| `lucide-react` | 1.7.0 | Ícones (Banknote já usado em Fluxo de Caixa; badge verde/vermelho) | consistente com o resto do menu financeiro |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| RPC nova de frescura (`get_dre_cash_freshness`) | Query direta RLS (`.from("cash_inflows").select("synced_at").order(...).limit(1)`) | A query direta é o padrão já usado em `useMLLastSync.ts`/`useWebhookHealth.ts` — nenhuma RPC nova se justifica para 1 coluna de 1 linha. **Recomendado: query direta.** |
| `dre_bloco_for_category` clonado de novo | Reusar a função já existente em produção | A função já existe (`public.dre_bloco_for_category(text)`, IMMUTABLE) — as RPCs novas devem CHAMAR essa função existente, não recriá-la. |

**Installation:** nenhuma — zero pacotes novos.

**Version verification:** não aplicável (nenhum pacote novo). Todas as libs acima já estão no `package.json` do projeto nas versões documentadas em `CLAUDE.md`/`STACK.md`.

## Package Legitimacy Audit

Não aplicável — esta phase **não instala nenhum pacote novo** (backend = 3 migrations SQL; frontend = arquivos novos usando libs já presentes no `package.json`).

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
[Cron 3h: sync-mp-releases]        [Cron 3h: sync-tiny-payables]
        │                                    │
        ▼                                    ▼
  cash_inflows                        cash_outflows
  (release_date, net_amount,          (outflow_date, amount, category,
   gross_amount, status_mp,            status, competence_date, synced_at)
   synced_at)
        │                                    │
        └──────────────┬─────────────────────┘
                        │
                        ▼
        ┌───────────────────────────────┐        orders
        │   get_dre_cash(org, month)    │◄───────(paid_revenue p/ previsão
        │   SECURITY INVOKER, STABLE    │         de imposto — mesmo WHERE
        │   → linhas entrada/saida/     │         de get_cost_waterfall)
        │     previsao                  │
        └───────────────┬───────────────┘
                         │ (linhas cruas)
                         ▼
        ┌───────────────────────────────┐
        │  dreCashCascade.ts (lib pura) │◄── espelho de dreCascade.ts
        │  → cascata + badge-resposta   │
        └───────────────┬───────────────┘
                         │
                         ▼
        ┌───────────────────────────────┐   clique num bloco
        │   MLDreCaixa.tsx (página)     │───────────────┐
        │  header+badge / KPI row /     │                ▼
        │  cascata / evolução 12m /     │   get_dre_cash_items(org, month, bloco)
        │  histórico / banner frescura  │   → drill-down de lançamentos
        └───────────────┬───────────────┘
                         │
                         ▼
        get_dre_cash_history(org, months) → gráfico + tabela 12m
```

### Recommended Project Structure
```
supabase/migrations/
└── 202607161XXXXX_dre_cash_rpcs.sql   # 3 RPCs novas (get_dre_cash, get_dre_cash_items, get_dre_cash_history)

src/lib/
├── dreCashCascade.ts        # lib pura: linhas RPC → cascata + badge (espelho de dreCascade.ts)
└── dreCashCascade.test.ts   # vitest (mesmo padrão de dreCascade.test.ts)

src/hooks/
├── useDreCash.ts             # RPC 1 (padrão useDreOperational.ts)
├── useDreCashItems.ts        # RPC 2, chamada só sob demanda (enabled: !!blocoSelecionado)
└── useDreCashHistory.ts      # RPC 3

src/pages/mercadolivre/
└── MLDreCaixa.tsx             # página nova, rota /dre-caixa

src/components/financial/ (reaproveitar, não recriar)
└── (nenhum componente novo obrigatório — reusar KPICard, Card, Recharts direto)
```

### Pattern 1: Clonar o cabeçalho de segurança das RPCs DRE existentes

**What:** Toda RPC nova segue `LANGUAGE sql STABLE SECURITY INVOKER SET search_path = 'public'` + `REVOKE EXECUTE ... FROM PUBLIC, anon;` + `GRANT EXECUTE ... TO authenticated;` (sem listar `authenticated` no REVOKE).

**When to use:** As 3 RPCs desta phase, sem exceção — é o padrão obrigatório declarado no `99-CONTEXT.md` e o único usado em toda a família DRE (`get_dre_operational_by_competence`, `get_cost_waterfall`, `get_cancelled_revenue`, `get_dre_nao_classificado_items`, `get_inss_guia_by_competence`).

**Example (fonte real, `supabase/migrations/20260692000000_dre_operational_reconcile_context_map.sql:35-88`):**
```sql
CREATE FUNCTION public.get_dre_operational_by_competence(
  p_org_id uuid,
  p_month  date
)
RETURNS TABLE (bloco text, category text, total numeric, n integer, double_count_risk boolean)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT ...
  FROM public.cash_outflows co
  WHERE co.organization_id = p_org_id
    AND ...
$function$;

REVOKE EXECUTE ON FUNCTION public.get_dre_operational_by_competence(uuid, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_dre_operational_by_competence(uuid, date) TO authenticated;
```

Use `CREATE FUNCTION` (não `CREATE OR REPLACE`) pois as 3 funções são NOVAS — sem risco de `42P13` (mudança de forma de retorno). Se o planner precisar reaplicar/corrigir depois, use `DROP FUNCTION IF EXISTS` + `CREATE` (nunca `CREATE OR REPLACE` sozinho quando a forma pode mudar — ver comentário em `20260715223024_cmv_cheio_puro_and_gaps.sql:64-69`).

### Pattern 2: Reusar `dre_bloco_for_category` — NÃO recriar

**What:** A função `public.dre_bloco_for_category(p_category text) RETURNS text`, `LANGUAGE sql IMMUTABLE SET search_path TO 'public'`, já existe em produção (migration `20260715221559_dre_cancelled_revenue_and_nao_classificado.sql:95-123`). É pura (sem tabela, sem RLS) — pode ser chamada livremente dentro das 3 RPCs novas.

**Mapa completo (fonte real, mesmo arquivo):**
```sql
CASE
  WHEN p_category IN ('Imposto Venda - ICMS','Imposto Venda - PIS','Imposto Venda - COFINS')
    THEN 'impostos_venda'
  WHEN p_category IN ('Salários','Pró-labore','Pessoal - INSS')
    THEN 'pessoal'
  WHEN p_category IN ('Aluguéis e condomínio','Água, luz','Telecomunicação, internet')
    THEN 'estrutura'
  WHEN p_category IN ('Contabilidade','Serviços gerais')
    THEN 'servicos'
  WHEN p_category IN ('Insumos','Itens do CD','Impostos, taxas','Veículos, transportes','Cartão de crédito')
    THEN 'operacional'
  WHEN p_category = 'Empréstimo'
    THEN 'financeiro'
  WHEN p_category IN (
    'Fornecedores','Previsões de compra','Aporte',
    'ADS Mercado Livre','Prestação de serviço do Mercado Envios Full',
    'ADS Shopee','Ads Magazine Luiza','Vendas Mercado Livre','Vendas Magalu',
    'Reembolso cliente'
  ) THEN 'excluido'
  ELSE 'nao_classificado'
END
```

**When to use:** dentro do `get_dre_cash` para agregar `cash_outflows.category → bloco`. A categoria do bloco `impostos_venda` (as 3 categorias `Imposto Venda - *`) é exatamente o que a régua de "guia paga no mês" e a previsão de imposto (item 3 abaixo) precisam somar.

**IMPORTANTE:** `dre_bloco_for_category` NÃO filtra `status`. A RPC nova precisa aplicar `co.status = 'paid'` (não `<> 'cancelled'`) — a régua de caixa puro do CONTEXT é mais restritiva que a régua de competência da DRE de faturamento (que aceita `paid` e `pending`, só exclui `cancelled`).

### Pattern 3: CTE MATERIALIZED em vez de subquery correlacionada (timeout 8s)

**What:** RPCs `SECURITY INVOKER` chamadas pelo role `authenticated` estouram o `statement_timeout` de 8s quando usam subquery correlacionada (row-by-row). O padrão do projeto é pré-carregar em uma CTE `MATERIALIZED` e fazer `JOIN`.

**When to use:** `get_dre_cash` cruza `cash_outflows` (saídas) com `orders` (faturamento, para a previsão de imposto) em 4 meses diferentes (mês corrente + 3 anteriores). Monte isso como CTEs separadas (uma por métrica, `WITH mes_atual AS (...), guias_m1 AS (...), fat_m1 AS (...), ...`), nunca como `(SELECT ... FROM orders WHERE ...)` dentro do `SELECT` principal por linha.

**Example (nenhum exemplo local de CTE MATERIALIZED explícito nas migrations lidas — recomendação do research-verification-protocol/CONTEXT):**
```sql
WITH taxa_m1 AS MATERIALIZED (
  SELECT
    COALESCE(SUM(co.amount) FILTER (WHERE co.status = 'paid'), 0) AS guia_paga,
    (SELECT COALESCE(SUM(COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0)), 0)
       FROM public.orders o
      WHERE o.organization_id = p_org_id
        AND o.status IN ('paid','shipped','delivered')
        AND o.data_pedido::date BETWEEN (date_trunc('month', p_month) - interval '1 month')::date
                                     AND (date_trunc('month', p_month) - interval '1 day')::date
    ) AS faturamento
  FROM public.cash_outflows co
  WHERE co.organization_id = p_org_id
    AND public.dre_bloco_for_category(co.category) = 'impostos_venda'
    AND co.outflow_date >= (date_trunc('month', p_month) - interval '1 month')::date
    AND co.outflow_date <  date_trunc('month', p_month)::date
)
-- repetir para taxa_m2, taxa_m3 (ou usar um LATERAL/generate_series(1,3) com CTE MATERIALIZED
-- por mês, evitando repetir a subquery 3x sem materializar)
```

O planner deve decidir a forma exata (3 CTEs sequenciais vs. `generate_series` + `LATERAL... MATERIALIZED`), mas o requisito é: **nenhuma subquery correlacionada por linha da tabela principal**, e a prova de `<8s` como role `authenticated` é obrigatória (item 8.2 do spec).

## Schema exato das tabelas-fonte

### `cash_inflows` (migration `20260618100000_cash_flow_tables.sql:90-131`)
```sql
CREATE TABLE public.cash_inflows (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ml_user_id       bigint      NOT NULL,
  payment_id       text        NOT NULL,
  release_date     date        NOT NULL,   -- NÃO timestamptz
  net_amount       numeric     NOT NULL,   -- pode ser negativo (refund)
  gross_amount     numeric,
  status_mp        text,                   -- approved / authorized / in_process / in_mediation / refunded
  payment_method   text,
  description      text,
  synced_at        timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);
-- UNIQUE (organization_id, payment_id)
-- INDEX cash_inflows_org_date_idx (organization_id, release_date)
-- RLS: SELECT = is_org_member(); escrita = service role only (sem policy authenticated)
```
`status_mp` values confirmados via `supabase/functions/sync-mp-releases/index.ts:53`: `VALID_STATUSES = ["approved", "authorized", "in_process", "in_mediation", "refunded"]`. Refund: `net = -Math.abs(net)` quando `status === "refunded"` (linha 217) — confirma a regra do CONTEXT ("net_amount já vem negativo"). Janela futura: `days_ahead = 45` (linha 356) — confirma "o sync já traz 45 dias à frente".

### `cash_outflows` (migration `20260618100000_cash_flow_tables.sql:143-190`, + ALTER `20260686000000` + CHECK ampliado `20260716210000`)
```sql
CREATE TABLE public.cash_outflows (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  outflow_date     date        NOT NULL,   -- NÃO timestamptz — data de pagamento/vencimento
  amount           numeric     NOT NULL,   -- sempre positivo
  description      text        NOT NULL,
  supplier         text,
  category         text,
  status           text        NOT NULL DEFAULT 'pending',  -- CHECK: 'pending' | 'paid' | 'cancelled'
  document_number  text,
  source           text        NOT NULL DEFAULT 'manual',   -- CHECK: 'manual' | 'tiny'
  tiny_payable_id  text,
  competence_date  date,       -- ALTER Phase 86 — NULLABLE, "YYYY-MM" do Tiny → primeiro dia do mês
  synced_at        timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- UNIQUE (organization_id, tiny_payable_id) — aceita múltiplos NULL
-- INDEX cash_outflows_org_date_idx (organization_id, outflow_date)
-- INDEX cash_outflows_org_competence_category_idx (organization_id, competence_date, category)  -- Phase 86
-- RLS: SELECT = is_org_member(); escrita = service role only
```

**CRÍTICO para esta phase:** `competence_date` **NÃO É USADA** — o CONTEXT trava explicitamente `outflow_date` (data de pagamento) como régua, e `status='paid'` como filtro (não `status <> 'cancelled'`, que é o padrão da DRE de faturamento). O índice `cash_outflows_org_date_idx (organization_id, outflow_date)` já cobre esta phase perfeitamente — nenhum índice novo é necessário.

### `orders` (fonte do denominador da previsão de imposto)
Colunas confirmadas via `get_cost_waterfall`/`get_cancelled_revenue`/`get_cmv_cheio_gaps` (migrations `20260715223024` e `20260715221559`):
- `organization_id uuid`, `ml_user_id text[]` (comparado via `= ANY(p_user_ids)`, então a coluna real é `text`, não `bigint` — atenção ao tipo)
- `data_pedido` — **TEXT**, nunca timestamptz. Cast `o.data_pedido::date BETWEEN p_from AND p_to` é o padrão usado por TODAS as RPCs de faturamento (não usar comparação de string direta aqui — é o padrão do `get_cost_waterfall`, que já é consumido por 6 telas em prod).
- `status` — union `"paid" | "shipped" | "delivered" | "cancelled" | "returned" | "pending" | "partially_refunded"` (STACK.md + migrations). O filtro padrão de faturamento é `status IN ('paid', 'shipped', 'delivered')`.
- `receita_bruta numeric` (nullable) — fallback `COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0)`.
- `preco_unit`, `quantidade`, `custo_unit`, `custo_unit_cheio`, `comissao`, `frete`, `tax_amount`, `sku`, `marca`, `item_id`.

**Índice existente relevante:** `idx_orders_status_data_pedido ON orders (status, data_pedido DESC) WHERE status IN ('paid','shipped','delivered')` (migration `20260527120000_orders_perf_indexes.sql:4-6`) — cobre exatamente o `status IN (...) AND data_pedido::date BETWEEN ...` que `get_cost_waterfall` já usa. **Não existe** um índice funcional sobre `data_pedido::date` (a Phase 80 documentou que `data_pedido` é TEXT e o cast `::date` não é sargable — `20260680000001_orders_sold_products_agg_perf.sql:15`), mas `get_cost_waterfall` já roda em produção com esse exato padrão (`WHERE status IN (...) AND data_pedido::date BETWEEN p_from AND p_to`, sem truque de superset) e é consumido por 6 telas — **a recomendação é replicar literalmente o WHERE do `get_cost_waterfall` para o denominador da previsão de imposto**, sem reinventar otimização (o volume por mês é pequeno o bastante para não estourar 8s, como já provado pela própria `get_cost_waterfall`).

## Padrão exato de RPC DRE a clonar (assinaturas)

| RPC | Assinatura | Retorno | Fonte |
|---|---|---|---|
| `get_dre_operational_by_competence` | `(p_org_id uuid, p_month date)` | `(bloco text, category text, total numeric, n integer, double_count_risk boolean)` | `20260716210000_cancelled_payables_dre.sql:31-82` (versão viva; usa `status <> 'cancelled'` e `COALESCE(competence_date, ...)` — **não copiar esse WHERE**, só o cabeçalho SQL/REVOKE/GRANT) |
| `dre_bloco_for_category` | `(p_category text) RETURNS text` | escalar `text` | `20260715221559_dre_cancelled_revenue_and_nao_classificado.sql:95-123`; `LANGUAGE sql IMMUTABLE SET search_path TO 'public'` — **sem SECURITY clause** (não acessa tabela) |
| `get_cost_waterfall` | `(p_org_id uuid, p_user_ids text[], p_from date, p_to date)` | `(paid_revenue, cmv, total_comissao, total_frete, total_tax, orders_count, cmv_cheio)` | `20260715223024_cmv_cheio_puro_and_gaps.sql:74-113` — molde do WHERE de `orders` a replicar no denominador da previsão |
| `get_inss_guia_by_competence` | `(p_org_id uuid, p_competence date)` | `(category text, total numeric, status text, n integer)` | `20260716230000_get_inss_guia_by_competence.sql:32-59` — exemplo mais recente (2026-07-16) do cabeçalho exato a clonar |

**Cabeçalho canônico a copiar literalmente para as 3 RPCs novas:**
```sql
CREATE FUNCTION public.get_dre_cash(...)
RETURNS TABLE (...)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  ...
$function$;

REVOKE EXECUTE ON FUNCTION public.get_dre_cash(...) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_dre_cash(...) TO authenticated;
```

## Fonte do faturamento para a previsão de imposto

`get_cost_waterfall` soma `paid_revenue` com:
```sql
COALESCE(SUM(COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0)), 0) AS paid_revenue
FROM public.orders o
WHERE o.organization_id = p_org_id
  AND o.ml_user_id   = ANY(p_user_ids)
  AND o.status       IN ('paid', 'shipped', 'delivered')
  AND o.data_pedido::date BETWEEN p_from AND p_to
```
A RPC nova de previsão deve usar o **mesmo WHERE, byte-a-byte** (mesmo fallback de receita, mesmos status, mesmo cast) — se divergir, a "taxa histórica" (guia ÷ faturamento) calculada não bate com o número de faturamento mostrado em qualquer outra tela do sistema, e o Wesley vai notar a inconsistência na reconciliação (gate de fechamento #4 do spec).

**Diferença de escopo:** `get_cost_waterfall` recebe `p_user_ids text[]` (permite filtrar por loja específica). `get_dre_cash*` (por decisão do CONTEXT) só recebe `p_org_id` — **decidir no plano** se a previsão de imposto deve iterar por TODAS as lojas da org (equivalente a `p_user_ids = ANY(SELECT ml_user_id::text FROM ml_tokens WHERE organization_id = p_org_id)`, resolvido dentro da RPC, sem parâmetro extra) ou usar `ml_user_id IS NOT NULL` direto em `orders.organization_id = p_org_id` (mais simples, e como `orders` já tem RLS org-first, filtrar só por `organization_id` é suficiente — **recomendado**, evita reimplementar o array de lojas).

## Como identificar "guias de imposto pagas" em `cash_outflows`

Bloco `impostos_venda` do `dre_bloco_for_category` = 3 categorias exatas:
```
'Imposto Venda - ICMS', 'Imposto Venda - PIS', 'Imposto Venda - COFINS'
```
Confirmado também em `src/lib/dreRegime.ts:30-34` (`IMPOSTO_VENDA_CATEGORIES`, export já usado por `useImpostoGuiaReal`/`useImpostoGuiaNudge`) — **mas essas categorias são idênticas, a régua de mês é DIFERENTE nesta phase** (ver "Diferença crítica de régua" abaixo).

`get_imposto_guia_by_competence(p_org_id uuid, p_competence date)` e `get_inss_guia_by_competence` (esta última COM código local, a primeira só existe em produção/drift, sem migration local) seguem o mesmo padrão: retornam `(category, total, status, n)` agrupado por `category × status`, **sem** aplicar filtro de `status` — deixam o caller decidir o que soma. `get_inss_guia_by_competence` filtra só por `category = 'Pessoal - INSS'` e por `competence_date` (não `outflow_date`).

**Diferença crítica de régua (não confundir):**
- `useImpostoGuiaReal`/`dreRegime.ts` (DRE de faturamento, já existe): usa `get_imposto_guia_by_competence` com `p_competence = monthPlusOne(saleMonth)` — a guia do ICMS/PIS/COFINS da VENDA do mês M sai fisicamente em M+1, então a apuração de M lê a competência M+1 (shift para frente).
- **DRE Caixa (esta phase):** regime de caixa puro, **sem shift**. "Guia paga no mês" = `cash_outflows` com `category IN (as 3 categorias)`, `status = 'paid'`, `outflow_date` dentro do mês M sendo exibido — é literalmente "o que saiu do caixa em M", independente de a qual competência de venda aquela guia se refere. A previsão (item de comparação) também usa o MESMO mês M para guia paga e faturamento — não M+1.

## Padrões de frontend

### `src/lib/dreCascade.ts` (molde da lib pura)
- Sem imports de React/Supabase — módulo 100% puro, testável sem rede.
- Recebe linhas cruas da RPC (`bloco`, `category`, `total`, `n`, ...) e monta subtotais em ordem fixa.
- Guardrail: blocos que não devem entrar no subtotal principal são filtrados **na entrada**, antes de qualquer soma (equivalente para DRE Caixa: seções `entrada`/`previsao` não devem contaminar a soma de `saida`).
- `round2 = (v) => Math.round(v * 100) / 100` — usar o mesmo padrão de arredondamento.

`dreCashCascade.ts` deve espelhar essa estrutura: `buildDreCashCascade(rows: DreCashRow[]) → { entradas: {...}, saidas: DreCashBlocoLine[], resultadoOperacional, financeiro, resultadoCaixa, badge: {cor, texto} }`. Testes espelham `dreCascade.test.ts` (Test 1 guardrail, Test 2 matemática, mês vazio, previsão null).

### `src/hooks/useDreOperational.ts` (molde do hook RPC)
```ts
export function useDreOperational(pMonth: string) {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;
  return useQuery<DreOperationalRow[]>({
    queryKey: ["dre", "operational", orgId, pMonth] as const,
    enabled: !!orgId && !!pMonth,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_dre_operational_by_competence", {
        p_org_id: orgId, p_month: pMonth,
      });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ ... }));
    },
  });
}
```
`p_month` DEVE ser `"YYYY-MM-01"` (nunca `"YYYY-MM"` — o cast Postgres `date` falha). `useDreCash`/`useDreCashHistory` clonam esse hook 1:1; `useDreCashItems(month, bloco)` adiciona `enabled: !!orgId && !!month && !!bloco` (só dispara sob clique no drill-down, conforme spec seção 6.3).

### `src/App.tsx` — rota lazy + RoleRoute
```tsx
const MLDreCaixa = React.lazy(() => import("./pages/mercadolivre/MLDreCaixa"));
...
<Route path="/dre-caixa" element={<RoleRoute><ErrorBoundary fallbackTitle="Erro na DRE Caixa"><MLDreCaixa /></ErrorBoundary></RoleRoute>} />
```
Inserir dentro do mesmo bloco de rotas protegidas (`<Route element={<HeaderScopeProvider>...}>`) onde `/fluxo-de-caixa` já vive (`App.tsx:145`).

**Role de acesso:** `/fluxo-de-caixa` e `/compras` usam `OPERATIONAL = ["owner","admin","member"]` em `src/config/roleAccess.ts:26` — nenhuma dessas duas rotas está em `VIEWER_ELIGIBLE_ROUTES`. Recomendação: `/dre-caixa` deve seguir o mesmo padrão — adicionar `"/dre-caixa": OPERATIONAL` em `roleAccess.ts` (não ALL, é dado financeiro sensível como Fluxo de Caixa; não incluir em `VIEWER_ELIGIBLE_ROUTES` a menos que o Wesley peça explicitamente).

**routeMeta.ts** — adicionar entrada:
```ts
"/dre-caixa": { title: "DRE Caixa", subtitle: "O que entrou no mês pagou as contas do mês?" },
```

### Item de menu (sidebar)
`src/components/layout/ApiSidebar.tsx:45-58` — grupo "Operações" (ícone `Layers`, path `/estoque`) já contém "Fluxo de Caixa" (`Banknote`, `/fluxo-de-caixa`, linha 56). Adicionar `/dre-caixa` como filho desse mesmo grupo, logo após ou antes de "Fluxo de Caixa":
```tsx
{ icon: Banknote, label: "Fluxo de Caixa", path: "/fluxo-de-caixa" },
{ icon: <novo ícone, ex. Scale ou FileBarChart>, label: "DRE Caixa", path: "/dre-caixa" },
```
Replicar a MESMA mudança em `src/components/layout/ApiMobileSidebar.tsx:44` (sidebar mobile tem lista separada — **não esquecer**, é uma lição já documentada em memória do projeto: "MLAnuncios layout duplo mobile/desktop — interação por item precisa ser ligada nos DOIS ramos"; aqui o risco equivalente é esquecer o mobile sidebar).

### Componente de gráfico (Recharts)
`src/components/financial/CashFlowChart.tsx` é o wrapper de referência: `ComposedChart` + `Line` + `XAxis`/`YAxis`/`CartesianGrid`/`Tooltip`/`ResponsiveContainer`/`ReferenceLine`/`Legend`, com `currFmt`/`tickFmt` helpers locais e `CustomTooltip` customizado. Para "Evolução 12 meses" (entradas × saídas × resultado), o padrão recomendado é um `ComposedChart` com 2 `Bar` (entradas verde / saídas vermelho) + 1 `Line` (resultado) — mesmo espírito do gráfico já existente em Fluxo de Caixa, mas com granularidade mensal em vez de diária.

### KPI tiles (4 tiles do header)
`src/components/dashboard/KPICard.tsx` é o componente genérico reusável (não `MLKPIGrid`, que é acoplado ao domínio de /vendas). Props relevantes: `title`, `value`, `subtitle`/`subtitleNode`, `delta`, `icon`, `loading`, `variant` (`CardVariant`), `tooltip`. Usar 4x `<KPICard>` para: Entradas líquidas MP · Saídas pagas · Resultado do mês · Previsão imposto × guia.

### Banner de dado velho — recomendação de implementação
**Não existe hoje** nenhum banner de frescura de `cash_inflows`/`cash_outflows` no frontend (busca `grep -rl "synced_at"` em `src/components|pages` não retornou nenhum arquivo de UI). O padrão mais próximo e correto a clonar é `src/hooks/useMLLastSync.ts` e `src/hooks/useWebhookHealth.ts` — ambos fazem uma query RLS direta (não RPC) com `.order(coluna, {ascending:false}).limit(1).maybeSingle()`:
```ts
export function useCashInflowsFreshness() {
  const { currentOrg } = useOrganization();
  return useQuery({
    queryKey: ["cash_inflows_freshness", currentOrg?.id] as const,
    enabled: !!currentOrg?.id,
    queryFn: async (): Promise<string | null> => {
      const { data } = await supabase
        .from("cash_inflows")
        .select("synced_at")
        .eq("organization_id", currentOrg!.id)
        .order("synced_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.synced_at ?? null;
    },
    staleTime: 5 * 60 * 1000,
  });
}
```
Mesmo padrão para `cash_outflows`. **Nenhuma RPC nova necessária** — RLS já filtra por org (`is_org_member`), a query é de 1 coluna/1 linha, não há risco de truncamento PostgREST (LIMIT 1). Regra do banner: `> 6h` desde `now()` → alerta (conforme CONTEXT). Exibir os dois badges separadamente (inflows/outflows) — lição documentada em memória do projeto: o token Tiny já morreu silenciosamente antes (2026-07-13) e travou `cash_outflows` sem travar `cash_inflows`.

### Padrão de teste vitest
`vitest.config.ts` (raiz do projeto) já inclui `"src/**/*.{test,spec}.{ts,tsx}"` — `dreCashCascade.test.ts` roda automaticamente sem config adicional. `environment: "jsdom"`, `setupFiles: ["./src/test/setup.ts"]`. Nenhum hook precisa de `.test.ts` companion obrigatório (confirmado por `useInssGuiaReal.ts`, que não tem teste próprio — só hooks com mapeamento mais complexo, como `useDreOperational`, têm teste dedicado).

## Common Pitfalls

### Pitfall 1: Confundir a régua de imposto da DRE Caixa com a régua M+1 da DRE de faturamento
**What goes wrong:** Reusar `useImpostoGuiaReal`/`monthPlusOne` da DRE de faturamento para a previsão de imposto da DRE Caixa produziria números que não batem com o extrato MP nem com o caixa real do mês (a DRE Caixa não desloca competência).
**Why it happens:** `IMPOSTO_VENDA_CATEGORIES` e a RPC-irmã `get_imposto_guia_by_competence` parecem reusáveis à primeira vista — são as mesmas 3 categorias.
**How to avoid:** A RPC `get_dre_cash` deve calcular a previsão internamente com `outflow_date` no MESMO mês (sem shift), nunca chamando `get_imposto_guia_by_competence` (que já teria o shift embutido pelo caller). Reusar só a constante de categorias (ou copiá-la literalmente na RPC SQL), nunca o hook/RPC completos.
**Warning signs:** Se o número de "guia paga no mês" da DRE Caixa bater exatamente com o número mostrado na DRE de faturamento para o mês SEGUINTE, o shift foi acidentalmente herdado.

### Pitfall 2: Subquery correlacionada estoura timeout 8s do role `authenticated`
**What goes wrong:** RPC `SECURITY INVOKER` roda sob o role `authenticated`, que tem `statement_timeout` de 8s (diferente de `postgres`/`service_role`). Uma subquery correlacionada (executada linha a linha) sobre `orders` ou `cash_outflows` pode facilmente estourar isso.
**Why it happens:** É o padrão SQL mais "natural" de escrever quando se precisa cruzar 2 tabelas para 3 meses diferentes.
**How to avoid:** Pré-carregar cada métrica em uma CTE `MATERIALIZED` (ver Pattern 3 acima) e testar SEMPRE como role `authenticated` (via `SET LOCAL ROLE authenticated` + `set_config('request.jwt.claims', ..., true)` em transação `ROLLBACK` — método já documentado em `STATE.md` Phase 43-04), nunca como `postgres`/MCP direto (que bypassa RLS e não reflete o timeout real).
**Warning signs:** Query rápida via MCP `execute_sql` (roda como `postgres`) mas lenta/timeout quando chamada via `supabase.rpc()` autenticado pelo frontend.

### Pitfall 3: `status` de `cash_outflows` mudou de 2 para 3 valores — checar CHECK constraint atual
**What goes wrong:** Migrations antigas (`20260618100000`) documentam `CHECK (status IN ('pending', 'paid'))`; a migration `20260716210000_cancelled_payables_dre.sql:24-28` ampliou para `'pending' | 'paid' | 'cancelled'`. Qualquer código que assuma só 2 valores (ex. `status <> 'paid'` significando "pending") está desatualizado.
**Why it happens:** A tabela tem 5 migrations que a tocam, espalhadas de 2026-06-18 a 2026-07-16.
**How to avoid:** Sempre filtrar `status = 'paid'` explicitamente (nunca `status <> 'pending'` ou `status <> 'cancelled'` como proxy de "pago") — é isto que o CONTEXT já trava ("`status='paid'`... `cancelled` sempre excluídas").
**Warning signs:** Total de saídas maior do que o esperado (incluindo `pending` ou `cancelled` sem querer).

### Pitfall 4: `orders.data_pedido` é TEXT, não timestamptz
**What goes wrong:** Comparar `data_pedido >= '2026-07-01'` como string funciona por coincidência (formato ISO ordena lexicograficamente igual a data), mas `data_pedido::date BETWEEN p_from AND p_to` é o padrão usado por TODAS as RPCs de faturamento no projeto — divergir quebra a paridade de resultado com `get_cost_waterfall`.
**Why it happens:** É uma decisão de schema legada, documentada como "melhoria futura" pendente (migração para timestamptz) em `20260680000001_orders_sold_products_agg_perf.sql:16`.
**How to avoid:** Copiar o WHERE de `get_cost_waterfall` literalmente (cast `::date`, mesmos status).
**Warning signs:** Contagem de pedidos do faturamento divergindo entre a previsão de imposto desta phase e o card de Custos em `/vendas`.

### Pitfall 5: RLS write-scope de `cash_inflows`/`cash_outflows` — só `service_role` escreve
**What goes wrong:** Nenhuma policy `authenticated` existe para INSERT/UPDATE/DELETE nessas 2 tabelas — só SELECT. Se alguma RPC nova tentar escrever nelas via `SECURITY INVOKER`, falha silenciosamente ou por erro de RLS.
**Why it happens:** Design intencional (só as EFs `sync-mp-releases`/`sync-tiny-payables`, rodando com `service_role`, escrevem).
**How to avoid:** As 3 RPCs desta phase são 100% leitura (`STABLE`, sem `INSERT`/`UPDATE`) — não há risco real aqui, mas vale confirmar no plano que nenhuma RPC nova tenta gravar nessas tabelas.

### Pitfall 6: PostgREST trunca em 1000 linhas — não relevante para as RPCs, relevante se algum hook usar `.from()` direto
**What goes wrong:** `supabase.rpc()` retorna o set completo (sem truncamento); `supabase.from("cash_outflows").select(...)` (query direta REST) trunca em 1000 linhas.
**Why it happens:** Limitação conhecida do PostgREST, já documentada extensivamente no projeto (Phase 43/48/80).
**How to avoid:** O drill-down (`get_dre_cash_items`) e o histórico (`get_dre_cash_history`) DEVEM ser RPCs (não queries `.from()` diretas) — já é a decisão travada do CONTEXT. O único `.from()` direto recomendado nesta phase é o banner de frescura (`select("synced_at").limit(1)` — 1 linha, sem risco).

### Pitfall 7: Anti-IDOR — nunca completar UUID de cabeça
**What goes wrong:** Um teste anti-IDOR contra uma org "quase certa" mas inexistente também retorna 0 linhas — a prova sai falsa-positiva (quase aconteceu em 2026-07-15, documentado em memória do projeto).
**How to avoid:** Sempre `SELECT id, name FROM organizations` antes de rodar o teste cross-org. Orgs de referência já confirmadas: Pé Vermeio `7f615df7-7bac-45e5-8a93-827fb9ddeec7` (user impersonação `ce8c797c-f984-4abb-b5f1-3e2f2eecbb73`), Thales `e4150d57-1349-48c9-9a89-82b1774857b0`.

## Code Examples

### Cabeçalho de RPC nova (a ser adaptado pelo planner)
```sql
-- Fonte de padrão: supabase/migrations/20260716230000_get_inss_guia_by_competence.sql
CREATE FUNCTION public.get_dre_cash_items(
  p_org_id uuid,
  p_month  date,
  p_bloco  text
)
RETURNS TABLE (
  outflow_date    date,
  supplier        text,
  category        text,
  amount          numeric,
  document_number text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT
    co.outflow_date,
    co.supplier,
    co.category,
    co.amount,
    co.document_number
  FROM public.cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.status = 'paid'
    AND public.dre_bloco_for_category(co.category) = p_bloco
    AND co.outflow_date >= date_trunc('month', p_month)::date
    AND co.outflow_date <  (date_trunc('month', p_month) + interval '1 month')::date
  ORDER BY co.amount DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_dre_cash_items(uuid, date, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_dre_cash_items(uuid, date, text) TO authenticated;
```

### Entradas — bruto/líquido/refunds/a-liberar (fonte `cash_inflows`)
```sql
-- Dentro de get_dre_cash, "seção entrada":
SELECT
  'entrada'                                                          AS secao,
  NULL::text                                                         AS bloco,
  'bruto'                                                            AS categoria,
  COALESCE(SUM(ci.gross_amount) FILTER (WHERE ci.release_date <= v_hoje), 0) AS total,
  COUNT(*) FILTER (WHERE ci.release_date <= v_hoje)::int              AS n
FROM public.cash_inflows ci
WHERE ci.organization_id = p_org_id
  AND ci.release_date >= date_trunc('month', p_month)::date
  AND ci.release_date <  (date_trunc('month', p_month) + interval '1 month')::date
-- repetir para 'liquido' (SUM(net_amount)), 'refunds' (SUM(net_amount) WHERE status_mp='refunded'),
-- 'a_liberar' (SUM(net_amount) WHERE release_date > v_hoje AND release_date <= fim do mês)
```
`v_hoje` deve ser calculado em BRT (`(now() AT TIME ZONE 'America/Sao_Paulo')::date`), seguindo o padrão já usado em `get_cost_by_month` (`20260716210000_cancelled_payables_dre.sql:135`).

## Runtime State Inventory

> Não aplicável — esta phase não é rename/refactor/migração de dados. É feature nova (3 RPCs + página), sem alteração de nomenclatura ou estrutura de dados existente. **Nada encontrado nesta categoria** (verificado: nenhum campo/tabela/EF é renomeado; `cash_inflows`/`cash_outflows`/`orders` permanecem com os mesmos nomes e schemas — só leitura).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | O ícone lucide-react para o item de menu "DRE Caixa" não foi decidido — sugestão `FileBarChart`/`Scale`/`Receipt` (`Receipt` já usado por "Margem") | Padrões de frontend > Item de menu | Nenhum — puramente estético, "Claude's Discretion" no CONTEXT |
| A2 | RPC de previsão de imposto deve filtrar `orders` só por `organization_id` (sem `p_user_ids`), assumindo que a org tem no máximo 1 loja ML relevante para faturamento agregado; se a org tiver múltiplas lojas, a previsão soma todas | Fonte do faturamento para a previsão de imposto | Baixo — CONTEXT não menciona filtro por loja para DRE Caixa (diferente de `get_cost_waterfall`, que aceita `p_user_ids`); org "Pé Vermeio" tem só 1 loja ML no Tiny |
| A3 | `get_dre_cash` deve iterar os "3 meses fechados anteriores" contando meses corridos (M-1, M-2, M-3), não necessariamente meses com `dre_month_close` fechado — o conceito de "fechado" da DRE de faturamento (Phase 94) não existe na DRE Caixa | Fonte do faturamento para a previsão de imposto | Médio — se o planner confundir "mês fechado" com `dre_month_close`, a previsão pode ficar acoplada incorretamente ao regime de apuração da DRE de faturamento, violando a separação exigida pelo CONTEXT |

## Open Questions

1. **Formato exato do "mês corrente" na seção `previsao` quando faltam os 3 meses anteriores completos**
   - What we know: o spec diz "menos de 3 meses com dados → usar os que existirem; nenhum → previsão null".
   - What's unclear: o que conta como "mês com dados" — um mês onde `cash_outflows` tem pelo menos 1 guia paga (mesmo que R$0,01) vs. um mês onde há QUALQUER guia (paga ou não) vs. um mês onde há faturamento >0.
   - Recommendation: usar "mês com pelo menos 1 guia `status='paid'` no bloco `impostos_venda`" como critério — é o denominador natural da fórmula `taxa_m = guia/faturamento` (sem guia paga, `taxa_m` não é calculável).

2. **Ícone/rótulo do item de menu**
   - What we know: grupo "Operações", ao lado de "Fluxo de Caixa".
   - What's unclear: rótulo final ("DRE Caixa" vs "DRE de Caixa" vs "Caixa Real").
   - Recommendation: usar "DRE Caixa" (nome do arquivo/rota, consistente com o título da phase) — Claude's Discretion per CONTEXT, mas confirmar com Wesley no ok visual.

## Environment Availability

Não aplicável — nenhuma dependência externa nova (Supabase/Deno/React já rodam em produção; nenhum serviço/CLI adicional é necessário para esta phase).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.4 |
| Config file | `/root/garment-glow-test/vitest.config.ts` (já inclui `src/**/*.{test,spec}.{ts,tsx}` — nenhuma mudança necessária) |
| Quick run command | `npx vitest run src/lib/dreCashCascade.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| Cascata (badge, mês vazio, previsão null) | `buildDreCashCascade` monta cascata + badge a partir das linhas cruas | unit | `npx vitest run src/lib/dreCashCascade.test.ts` | ❌ Wave 0 — criar espelhando `dreCascade.test.ts` |
| RPC `get_dre_cash` <8s como `authenticated` | Prova SQL de performance + anti-correlação | manual (SQL via MCP, checkpoint do orquestrador) | `SET LOCAL ROLE authenticated; ... EXPLAIN ANALYZE ...` | ❌ Wave 0 — não é teste automatizado, é checkpoint |
| Anti-IDOR nas 3 RPCs | org alheia real → 0 linhas | manual (SQL via MCP, checkpoint) | impersonação JWT org B contra dados de org A | ❌ Wave 0 — checkpoint |
| Reconciliação mês fechado × extrato MP | total de entradas bate com o painel MP | manual (Wesley) | — | ❌ não automatizável — validação humana |

### Sampling Rate
- **Per task commit:** `npx vitest run src/lib/dreCashCascade.test.ts`
- **Per wave merge:** `npx vitest run` (suíte completa, ~500+ testes já existentes no projeto)
- **Phase gate:** suíte completa verde + `tsc --noEmit` + `npm run build` antes de `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/lib/dreCashCascade.test.ts` — cobre a cascata pura (espelho de `dreCascade.test.ts`)
- [ ] Nenhum framework/config novo — `vitest.config.ts` já cobre `src/**/*.test.{ts,tsx}`

*(Sem gaps de infraestrutura de teste — só falta escrever o arquivo de teste da lib nova.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | não (herdado do Supabase Auth já em produção) | — |
| V3 Session Management | não (herdado) | — |
| V4 Access Control | **sim** | RLS org-first (`is_org_member`) em `cash_inflows`/`cash_outflows`; `RoleRoute` com `OPERATIONAL` no frontend; RPCs `SECURITY INVOKER` (nunca `DEFINER`) |
| V5 Input Validation | sim | `p_month`/`p_competence` sempre `date` tipado (nunca string livre interpolada); `p_bloco` em `get_dre_cash_items` deve ser validado contra os 8 valores possíveis de `dre_bloco_for_category` (evitar SQL dinâmico) |
| V6 Cryptography | não aplicável | — |

### Known Threat Patterns for este stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| IDOR via `p_org_id` de outra org | Tampering/Elevation of Privilege | `SECURITY INVOKER` + RLS `is_org_member(auth.uid(), organization_id)` — já o padrão de TODAS as RPCs financeiras do projeto; nunca `SECURITY DEFINER` para RPCs escopadas por org (lição documentada: DEFINER + org param = IDOR CRITICAL) |
| `EXECUTE` default para `PUBLIC`/`anon` em função nova | Elevation of Privilege | `REVOKE EXECUTE ... FROM PUBLIC, anon;` + `GRANT ... TO authenticated;` explícito em toda função nova — Postgres concede `EXECUTE` a `PUBLIC` por padrão em `CREATE FUNCTION` |
| Timeout/DoS por subquery correlacionada | Denial of Service | CTE `MATERIALIZED` + teste de `<8s` como role `authenticated` (Pattern 3) |

## Sources

### Primary (HIGH confidence — lido diretamente do repo)
- `supabase/migrations/20260618100000_cash_flow_tables.sql` — schema `cash_inflows`/`cash_outflows` original
- `supabase/migrations/20260686000000_cash_outflows_competence_date.sql` — coluna `competence_date` (não usada nesta phase, mas confirma o schema atual)
- `supabase/migrations/20260716210000_cancelled_payables_dre.sql` — versão viva de `get_dre_operational_by_competence` + CHECK `status` ampliado
- `supabase/migrations/20260715221559_dre_cancelled_revenue_and_nao_classificado.sql` — `dre_bloco_for_category`, `get_cancelled_revenue`, `get_dre_nao_classificado_items`
- `supabase/migrations/20260715223024_cmv_cheio_puro_and_gaps.sql` — `get_cost_waterfall` (WHERE de `orders` a replicar), `get_cmv_cheio_gaps`
- `supabase/migrations/20260716230000_get_inss_guia_by_competence.sql` — RPC mais recente, exemplo canônico de cabeçalho
- `supabase/migrations/20260692000000_dre_operational_reconcile_context_map.sql` — REVOKE/GRANT completo de referência
- `supabase/migrations/20260527120000_orders_perf_indexes.sql` + `20260680000000_orders_item_status_date_index.sql` + `20260680000001_orders_sold_products_agg_perf.sql` — índices existentes em `orders`
- `supabase/functions/sync-mp-releases/index.ts` — `status_mp` values, regra de refund negativado, janela 45 dias
- `src/lib/dreCascade.ts` + `src/lib/dreCascade.test.ts` — molde da lib pura de cascata
- `src/hooks/useDreOperational.ts`, `src/hooks/useImpostoGuiaReal.ts`, `src/hooks/useInssGuiaReal.ts` — moldes de hook RPC
- `src/lib/dreRegime.ts` — confirma `IMPOSTO_VENDA_CATEGORIES` e o padrão M+1 (a NÃO reusar nesta phase)
- `src/App.tsx`, `src/config/roleAccess.ts`, `src/components/layout/ApiSidebar.tsx`, `src/components/layout/ApiMobileSidebar.tsx`, `src/components/layout/routeMeta.ts` — padrão de rota/role/menu
- `src/pages/mercadolivre/MLFluxoCaixa.tsx`, `src/components/financial/CashFlowChart.tsx` — molde de página/gráfico
- `src/hooks/useMLLastSync.ts`, `src/hooks/useWebhookHealth.ts` — padrão de leitura de frescura (recomendado para o banner)
- `src/components/dashboard/KPICard.tsx` — componente genérico de KPI tile
- `vitest.config.ts` — confirma que nenhuma config nova é necessária

### Secondary (MEDIUM confidence)
- `.planning/phases/99-.../99-CONTEXT.md` e `docs/superpowers/specs/2026-07-16-dre-caixa-design.md` — fonte da verdade das decisões travadas (não é código, mas é a spec aprovada pelo Wesley)
- `.planning/STATE.md` — histórico de lições do projeto (timeout 8s, PostgREST truncamento, anti-IDOR, token Tiny morto)

### Tertiary (LOW confidence)
- Nenhuma — toda a pesquisa foi feita sobre código real do repo, sem inferência de treinamento não verificada.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero pacotes novos, tudo já em produção
- Architecture (RPC pattern, dre_bloco_for_category reuse): HIGH — lido diretamente das migrations vivas mais recentes (2026-07-16)
- Frontend patterns (hooks/rota/menu): HIGH — lido diretamente do código atual
- Pitfalls: HIGH — 6 dos 7 pitfalls são lições já documentadas e provadas em produção neste mesmo projeto (não especulação)
- Previsão de imposto (denominador exato, tratamento de "3 meses fechados"): MEDIUM — a fórmula está no CONTEXT, mas o "melhor" agrupamento SQL (CTE única vs. 3 CTEs) é decisão de implementação do planner

**Research date:** 2026-07-16
**Valid until:** 2026-08-16 (schema estável há semanas; risco de mudança só se outra phase DRE tocar `cash_outflows`/`dre_bloco_for_category` antes da execução desta)
