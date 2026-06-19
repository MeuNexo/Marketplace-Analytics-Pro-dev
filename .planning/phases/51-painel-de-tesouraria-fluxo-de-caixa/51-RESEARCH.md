# Phase 51: Painel de Tesouraria (Fluxo de Caixa) — Research

**Researched:** 2026-06-19
**Domain:** React 18 + TypeScript + Supabase RPC + recharts — treasury dashboard (cash health KPIs + charts)
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 Card removal:** Remove TodayBalanceCard, ProjectedBalanceCard, CapacityCard from MLFluxoCaixa.tsx. Replace with 12 KPIs in 3 bands.

**D-02 Saldo Atual:** `current_balance` from `get_projected_balance_summary` (already computed). Comes from `financial_settings.initial_balance` + inflows today - outflows today (BRT).

**D-03 Runway (meses):** `Saldo Atual / Burn Rate`. Reference: 19.155 / 124.942 = 0.15 meses.

**D-04 Saldo Mínimo (90d):** `min_balance` from `get_projected_balance_summary` called with `p_projection_days=90`.

**D-05 Data do Saldo Mínimo:** `critical_date` from same 90d call.

**D-06 Alerta:** "saldo vai abaixo de R$X em DD/MM/AAAA" when projected balance crosses `alert_threshold` (D-10).

**D-07 Entrada/Saída/Resultado Real:** Last 30 days. Entrada = SUM(cash_inflows.net_amount last 30d); Saída = SUM(cash_outflows.amount last 30d); Resultado = Entrada − Saída.

**D-08 Burn Rate:** Average monthly outflow over last 3 months (NOT 30d window from D-07 block — avoids duplication). Checkpoint: confirm with Wesley (if he prefers 30d, Burn Rate == Saída Real).

**D-09 Fornec 30/60/90d:** Cumulative supplier payables (cash_outflows WHERE supplier IS NOT NULL AND status='pending') with outflow_date <= today+30d, <= today+60d, <= today+90d. References: 133k / 226k / 311k.

**D-09b Total Exposição:** SUM of ALL pending supplier payables (supplier IS NOT NULL, status='pending'), any date. Reference: 671k.

**D-10 alert_threshold:** New column in `financial_settings`, numeric, default 30000. Not reusing safety_margin.

**D-11 Saldo Projetado chart:** Reuse existing CashFlowChart unchanged.

**D-12 Composição de Custos por Mês:** Stacked BarChart per month, segmented by cash_outflows.category. Multi-month horizon (past + near future, approx apr..dec).

**D-13 Exposição por Fornecedor:** Grouped BarChart by supplier, 3 series (30/60/90d), sorted by total exposure desc. Top N suppliers.

### Claude's Discretion

- Layout of KPI grid (4-col × 3-row as in Wesley's reference)
- Exact shadcn/recharts components to use
- Whether to use 1 new RPC `get_treasury_panel` or multiple targeted queries
- Exact Top N count for supplier exposure chart
- Exact month horizon for cost composition chart

### Deferred Ideas (OUT OF SCOPE)

- Drill-down by supplier (click bar → see individual payables)
- Configurable projection horizon (90/120/180d) via UI
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TESO-01 | 12 KPIs in 3 bands rendered in "Caixa Real" tab replacing the 3 cards | Formulas for all 12 KPIs documented in §4 below; RPC shape confirmed |
| TESO-02 | 3 charts: Saldo Projetado (reuse), Composição de Custos (stacked bar), Exposição por Fornecedor (grouped bar) | Chart data shapes and recharts pattern documented in §5 |
| TESO-03 | alert_threshold column in financial_settings (configurable, default 30000) | Migration convention confirmed; useFinancialSettings extension pattern in §6 |
| TESO-04 | Single RPC `get_treasury_panel` SECURITY INVOKER aggregates treasury KPI data | Full SQL derivation documented in §4; RPC conventions confirmed in §3 |
| TESO-05 | Simulador tab preserved untouched | Touch-point analysis in §7 confirms exact scope of changes |
</phase_requirements>

---

## Summary

Phase 51 replaces the 3 cash-flow cards (TodayBalanceCard, ProjectedBalanceCard, CapacityCard) in the "Caixa Real" tab with a treasury panel: 12 KPIs in 3 labeled bands + 3 charts below. The Simulador tab and CashFlowChart are not touched.

All data lives in `cash_inflows`, `cash_outflows`, and `financial_settings` on the **`ckcdevcxgvueywivefgx`** Supabase project (confirmed — see §1). The existing `get_projected_balance_summary(p_org_id, 90)` already delivers Saldo Atual, Saldo Mínimo 90d, and critical_date. A new RPC `get_treasury_panel` covers the remaining 9 KPI values (Realizado block + Exposição block + Burn Rate + Alerta). Two new chart components are needed: `CostCompositionChart` (stacked BarChart) and `SupplierExposureChart` (grouped BarChart).

The migration touch is minimal: one `ADD COLUMN alert_threshold numeric DEFAULT 30000` to `financial_settings`, plus the new RPC function. Frontend work: (1) remove 3 cards from page, (2) add KPI grid container `TreasuryPanel`, (3) add 2 new chart components, (4) extend `useFinancialSettings` with the new field.

**Primary recommendation:** Create one new RPC `get_treasury_panel` (SECURITY INVOKER) that returns all treasury aggregates in a single round-trip. Call it from a new hook `useTreasuryPanel`. Reuse `useProjectedBalance(90)` for the Saúde de Caixa band (Saldo Atual, Saldo Min 90d, critical_date already there).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| KPI aggregation (Realizado, Burn Rate, Exposição) | Database / RPC | — | Multi-row aggregations belong in SQL; frontend should receive pre-aggregated scalars |
| Saldo Atual + Saldo Mínimo 90d | Database / RPC (`get_projected_balance_summary`) | — | Already implemented; call with p_projection_days=90 |
| alert_threshold config | Database / `financial_settings` | Frontend / `useFinancialSettings` | Persisted per-org; frontend reads and displays |
| Chart data (cost by month, supplier exposure) | Database / RPC (`get_treasury_panel`) | Frontend / recharts | SQL GROUP BY is more efficient than client-side grouping |
| KPI grid rendering (3 bands × 4 KPIs) | Frontend / React | — | Pure presentation — data comes from hooks |
| Saldo Projetado chart | Frontend / `CashFlowChart` (REUSE) | — | D-11: no changes to existing component |
| Simulador tab | Frontend / `CashFlowSimulator` (UNTOUCHED) | — | Phase 50 scope; MUST NOT change |

---

## 1. Supabase Project ID — Definitive Answer

**Authoritative source:** `supabase/config.toml` line 1 [VERIFIED: file:supabase/config.toml:1]

```
project_id = "ckcdevcxgvueywivefgx"
```

The client file `src/integrations/supabase/client.ts` lines 4–5 hardcodes the **wrong** project as fallback default (`gionpsuunfkkzzjdubfy`) — that is the old Lovable-generated project ID. However, the app is configured via `VITE_SUPABASE_URL` at runtime and the supabase CLI + all migrations target `ckcdevcxgvueywivefgx`. The STATE.md accumulated context confirms: "Supabase project correto: ckcdevcxgvueywivefgx (CLAUDE.md menciona gionpsuunfkkzzjdubfy — desatualizado, sempre usar ckcdevcxgvueywivefgx)". [VERIFIED: file:.planning/STATE.md]

**Rule:** All migrations and RPC deployments go to `ckcdevcxgvueywivefgx`. Never use `db push` (links to wrong project); apply via MCP `apply_migration` on `ckcdevcxgvueywivefgx`.

---

## 2. Schema of Cash Tables

Source: `supabase/migrations/20260618100000_cash_flow_tables.sql` [VERIFIED: file:supabase/migrations/20260618100000_cash_flow_tables.sql]

### `financial_settings`

```
id                    uuid        PK, gen_random_uuid()
organization_id       uuid        NOT NULL, UNIQUE (financial_settings_org_unique)
initial_balance       numeric     NOT NULL DEFAULT 0
operational_cost_rate real        NOT NULL DEFAULT 0.22
safety_margin         numeric     NOT NULL DEFAULT 10000
created_at            timestamptz NOT NULL DEFAULT now()
updated_at            timestamptz NOT NULL DEFAULT now()
```

RLS: SELECT = any org member; ALL (write) = owner only.

**Extension needed for Phase 51 (D-10):**

```sql
ALTER TABLE public.financial_settings
  ADD COLUMN IF NOT EXISTS alert_threshold numeric NOT NULL DEFAULT 30000;
```

No policy change needed (alert_threshold follows the same read-all / write-owner pattern).

### `cash_inflows`

```
id               uuid        PK
organization_id  uuid        NOT NULL, FK organizations
ml_user_id       bigint      NOT NULL
payment_id       text        NOT NULL
release_date     date        NOT NULL   ← DATE (not timestamptz) — simple = comparisons safe
net_amount       numeric     NOT NULL
gross_amount     numeric
status_mp        text
payment_method   text
description      text
synced_at        timestamptz
created_at       timestamptz
```

UNIQUE: (organization_id, payment_id). Index: (organization_id, release_date).
RLS: SELECT = org member; write = service role only.

### `cash_outflows`

```
id               uuid        PK
organization_id  uuid        NOT NULL, FK organizations
outflow_date     date        NOT NULL   ← DATE — simple = comparisons safe
amount           numeric     NOT NULL   ← always positive
description      text        NOT NULL
supplier         text                   ← fornecedor (nullable; NULL = non-supplier expense)
category         text                   ← tipo/tipoOrdem from Tiny (nullable)
status           text        DEFAULT 'pending'  ← CHECK ('pending','paid')
document_number  text
source           text        DEFAULT 'manual'   ← CHECK ('manual','tiny')
tiny_payable_id  text
synced_at        timestamptz
created_at       timestamptz
updated_at       timestamptz
```

UNIQUE: (organization_id, tiny_payable_id) — accepts multiple NULLs (manual entries).
Index: (organization_id, outflow_date).
RLS: SELECT = org member; write = service role only.

**Status values:** only `'pending'` and `'paid'` (CHECK constraint). [VERIFIED: migration]

**Category values:** come from Tiny `item.tipo ?? item.tipoOrdem` — free-form text from Tiny ERP. [VERIFIED: file:supabase/functions/sync-tiny-payables/index.ts]. Expected values from the CONTEXT.md D-12 list: Fornecedores, Salários, Impostos/taxas, Aluguéis/condomínio, Contabilidade, Cartão de crédito, Água/luz, Serviços gerais, Empréstimo. These are the labels from Wesley's panel reference. **There is no CHECK constraint on category** — it's free text from Tiny. The chart must handle NULL category (show as "Outros") and unexpected values gracefully.

**Supplier values:** free text from `contato.nome ?? nomeFornecedor`. NULL means the expense is not from a supplier. The D-09 / D-09b KPIs filter `WHERE supplier IS NOT NULL`.

---

## 3. Existing RPC Patterns

### `get_projected_balance_summary(p_org_id UUID, p_projection_days INT)` [VERIFIED: file:supabase/migrations/20260619020000_cashflow_brt_timezone.sql]

Return shape (1 row):

```
current_balance     NUMERIC   — saldo hoje (initial_balance + inflows_today − outflows_today), BRT
pessimistic_balance NUMERIC   — saldo final sem projeção SMA
realistic_balance   NUMERIC   — saldo final com projeção SMA
critical_date       DATE      — primeiro dia saldo realístico < 0 (NULL se não ocorrer)
min_balance         NUMERIC   — menor saldo realístico no horizonte
confirmed_income    NUMERIC   — entradas confirmadas no período (> hoje ≤ hoje+p_projection_days)
total_expenses      NUMERIC   — saídas no período (> hoje ≤ hoje+p_projection_days)
```

**For Phase 51:** Call with `p_projection_days=90` to get Saldo Mínimo 90d (min_balance) + Data do Saldo Mínimo (critical_date) + Saldo Atual (current_balance). The hook `useProjectedBalance` already accepts `projectionDays` as parameter.

**Key BRT timezone fix:** Both `get_cashflow` and `get_projected_balance_summary` use `(now() AT TIME ZONE 'America/Sao_Paulo')::date` instead of `CURRENT_DATE` (UTC). New RPCs MUST follow the same pattern. [VERIFIED: migration 20260619020000]

**SECURITY INVOKER pattern:** All RPCs are `SECURITY INVOKER` with `SET search_path = 'public'`. NEVER use `SECURITY DEFINER` — it bypasses RLS and creates IDOR when org_id is passed as parameter. [VERIFIED: all existing RPCs; feedback_supabase_security_invoker.md]

**REVOKE PUBLIC / GRANT authenticated pattern:** Every RPC creation ends with:

```sql
REVOKE EXECUTE ON FUNCTION public.fn_name(...) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_name(...) TO authenticated;
```

[VERIFIED: migration 20260618120000_cash_flow_rpcs.sql lines 398–415]

**Pagination / no truncation:** `supabase.rpc()` returns the full result set (no PostgREST 1000-row limit). SELECT direct from tables IS subject to 1000-row truncation. Always use RPCs for multi-row cash aggregations. [ASSUMED — documented in STATE.md accumulated context, consistent with project-wide pattern]

---

## 4. KPI Derivations — Concrete SQL/Formula

All 12 KPIs, mapped to tables/columns and proposed SQL. These formulas drive the new `get_treasury_panel` RPC.

### Band 1: Saúde de Caixa

**KPI 1 — Saldo Atual**
Source: `get_projected_balance_summary(p_org_id, 90).current_balance`
No new SQL needed — already returned by existing RPC.
Formula: `financial_settings.initial_balance + SUM(cash_inflows WHERE release_date = today_brt) − SUM(cash_outflows WHERE outflow_date = today_brt)`

**KPI 2 — Runway (meses)**
Formula: `current_balance / burn_rate`
Where burn_rate = avg monthly outflow (see KPI 5).
Frontend derivation: `kpis.current_balance / kpis.burn_rate` (divide by zero guard → null/0 if burn_rate=0).

**KPI 3 — Saldo Mínimo 90d**
Source: `get_projected_balance_summary(p_org_id, 90).min_balance`
Already returned.

**KPI 4 — Data do Saldo Mínimo**
Source: `get_projected_balance_summary(p_org_id, 90).critical_date`
Note: `critical_date` in the current RPC = first day balance < 0. For Saldo Mínimo 90d we need the date of the minimum balance, which may not be negative. The existing RPC tracks `v_critical` (first negative day) and `v_min` separately. When the balance never goes negative, `critical_date` is NULL but `min_balance` exists. **For this phase:** reuse the pair (min_balance, critical_date) as "Data do Saldo Mínimo" = critical_date (first risk day). If critical_date IS NULL, show "Sem data crítica em 90d". Reference data shows min 11.715,85 on 23/06 — which is a positive balance, so critical_date in the reference is the threshold-crossing date (via Alerta), NOT first-negative. **Clarification needed:** The reference values show saldo min 11.715,85 (positive) at 23/06. This means the RPC's `critical_date` (first negative) is NULL for Pé Vermeio, but the "Alerta" KPI shows 23/06. This date is the first day balance crosses `alert_threshold=30000`. The `critical_date` field needs to be used for Alerta (threshold crossing), while "Data do Saldo Mínimo" should come from a new loop tracking the minimum date. [ASSUMED — inference from reference values vs RPC logic]

**Proposed approach:** `get_treasury_panel` returns an additional `min_balance_date` (date of minimum balance in 90d horizon) and `alert_date` (first day balance < alert_threshold).

**KPI 5 — Alerta**
Message: "Saldo vai abaixo de R$30.000 em 23/06/2026"
Source: `get_treasury_panel.alert_date` — first day in 90d horizon where projected balance < `financial_settings.alert_threshold` (default 30000).
SQL (loop over 90 days in get_projected_balance_summary style, checking `v_realistic < alert_threshold`):

```sql
-- Inside treasury panel loop:
IF v_alert_date IS NULL AND v_realistic < v_alert_threshold THEN
  v_alert_date := v_day_date;
END IF;
```

### Band 2: Realizado (last 30 days)

**KPI 6 — Entrada Real (30d)**

```sql
SELECT COALESCE(SUM(ci.net_amount), 0)
FROM cash_inflows ci
WHERE ci.organization_id = p_org_id
  AND ci.release_date >= v_today_brt - 30
  AND ci.release_date <= v_today_brt;
```

Reference: 363.839,39 (note: CONTEXT.md says reference image shows ~3m window; with 30d window values will differ — that's expected per D-07).

**KPI 7 — Saída Real (30d)**

```sql
SELECT COALESCE(SUM(co.amount), 0)
FROM cash_outflows co
WHERE co.organization_id = p_org_id
  AND co.outflow_date >= v_today_brt - 30
  AND co.outflow_date <= v_today_brt;
```

Note: includes ALL statuses (paid + pending) within the 30d window per D-07. Only past outflows are counted (outflow_date <= today).

**KPI 8 — Resultado Real (30d)**
Frontend derivation: `entrada_real - saida_real` — simple subtraction. Reference: −10.987,34 (negative = red).

**KPI 9 — Burn Rate (média 3 meses)**

```sql
-- Average monthly outflow over the past 3 months
-- "3 months" = last 90 days of outflows / 3
SELECT COALESCE(SUM(co.amount), 0) / 3.0
FROM cash_outflows co
WHERE co.organization_id = p_org_id
  AND co.outflow_date >= v_today_brt - 90
  AND co.outflow_date <  v_today_brt;
```

Reference: 124.942,24. This matches ≈ (3 months of ~374k outflows / 3). Note: includes both paid + pending outflows in the past window (actual and expected historical). [ASSUMED — divides 90-day total by 3 to get monthly average; verify matches reference]

Burn Rate is consumed by KPI 2 (Runway = current_balance / burn_rate).

### Band 3: Exposição a Fornecedor

**KPI 10 — Fornec 30d (cumulative, pending, supplier, ≤ today+30)**

```sql
SELECT COALESCE(SUM(co.amount), 0)
FROM cash_outflows co
WHERE co.organization_id = p_org_id
  AND co.supplier IS NOT NULL
  AND co.status = 'pending'
  AND co.outflow_date <= v_today_brt + 30;
```

Reference: 133.026,48

**KPI 11 — Fornec 60d (cumulative, pending, supplier, ≤ today+60)**

```sql
... AND co.outflow_date <= v_today_brt + 60
```

Reference: 226.591,77

**KPI 12 — Fornec 90d (cumulative, pending, supplier, ≤ today+90)**

```sql
... AND co.outflow_date <= v_today_brt + 90
```

Reference: 311.477,86

**KPI — Total Exposição (all pending supplier payables, any date)**

```sql
SELECT COALESCE(SUM(co.amount), 0)
FROM cash_outflows co
WHERE co.organization_id = p_org_id
  AND co.supplier IS NOT NULL
  AND co.status = 'pending';
```

Reference: 671.096,11 (> Fornec 90d, meaning significant payables beyond 90d)

**Data insufficiency flag:** The Fornec 30/60/90d KPIs only count `status='pending'`. If a supplier payable was marked 'paid' in the 30d window, it does NOT appear here. This is the intended behavior (these are obligations still due, not yet paid). [ASSUMED — derived from D-09 intent "contas a pagar a fornecedores"]

---

## 5. New RPC: `get_treasury_panel`

**Proposed signature and return shape:**

```sql
CREATE OR REPLACE FUNCTION public.get_treasury_panel(
  p_org_id UUID
)
RETURNS TABLE (
  -- Band 1: Saúde de Caixa (current_balance comes from get_projected_balance_summary)
  burn_rate              NUMERIC,   -- avg monthly outflow last 3m
  alert_threshold        NUMERIC,   -- from financial_settings
  alert_date             DATE,      -- first day in 90d projection where balance < alert_threshold
  -- Band 2: Realizado (30d)
  entrada_real_30d       NUMERIC,
  saida_real_30d         NUMERIC,
  -- Band 3: Exposição
  fornec_30d             NUMERIC,
  fornec_60d             NUMERIC,
  fornec_90d             NUMERIC,
  total_exposicao        NUMERIC,
  -- Chart data (serialized as JSON or separate RPCs)
  -- cost_by_month and supplier_exposure are better as separate RPCs due to shape
)
```

**Important:** Chart data (cost by month, supplier exposure) returns multi-row sets with different shapes. They cannot be returned from the same single-row RPC. **Recommendation:** 3 RPCs total:

1. `get_treasury_panel` — scalar KPIs (1 row, as above)
2. `get_cost_by_month` — cost composition data (multi-row: month × category)
3. `get_supplier_exposure` — exposure data (multi-row: supplier × amount at 30/60/90d)

Or alternatively, use 1 RPC returning scalars + 2 direct supabase.rpc() calls for chart data.

**Full SQL for `get_treasury_panel`:**

```sql
CREATE OR REPLACE FUNCTION public.get_treasury_panel(p_org_id UUID)
RETURNS TABLE (
  burn_rate        NUMERIC,
  alert_threshold  NUMERIC,
  alert_date       DATE,
  entrada_real_30d NUMERIC,
  saida_real_30d   NUMERIC,
  fornec_30d       NUMERIC,
  fornec_60d       NUMERIC,
  fornec_90d       NUMERIC,
  total_exposicao  NUMERIC
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
  v_today        DATE    := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_alert_thresh NUMERIC := 30000;
  v_burn         NUMERIC := 0;
  v_entrada      NUMERIC := 0;
  v_saida        NUMERIC := 0;
  v_f30          NUMERIC := 0;
  v_f60          NUMERIC := 0;
  v_f90          NUMERIC := 0;
  v_total        NUMERIC := 0;
  v_alert_date   DATE    := NULL;
  -- For alert_date detection: need to iterate 90d projection
  v_current      NUMERIC := 0;
  v_bal          NUMERIC := 0;
  v_day_inc      NUMERIC;
  v_day_exp      NUMERIC;
  v_day          INT;
BEGIN
  -- alert_threshold from settings
  SELECT COALESCE(fs.alert_threshold, 30000), COALESCE(fs.initial_balance, 0)
  INTO v_alert_thresh, v_current
  FROM financial_settings fs
  WHERE fs.organization_id = p_org_id LIMIT 1;

  -- Add today's flows to get current balance
  v_current := v_current
    + COALESCE((SELECT SUM(net_amount) FROM cash_inflows
                WHERE organization_id=p_org_id AND release_date=v_today), 0)
    - COALESCE((SELECT SUM(amount) FROM cash_outflows
                WHERE organization_id=p_org_id AND outflow_date=v_today), 0);

  -- Burn rate: avg monthly outflow last 3 months (90d / 3)
  SELECT COALESCE(SUM(co.amount), 0) / 3.0 INTO v_burn
  FROM cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.outflow_date >= v_today - 90
    AND co.outflow_date < v_today;

  -- Realizado 30d
  SELECT COALESCE(SUM(net_amount), 0) INTO v_entrada
  FROM cash_inflows WHERE organization_id=p_org_id
    AND release_date >= v_today - 30 AND release_date <= v_today;

  SELECT COALESCE(SUM(amount), 0) INTO v_saida
  FROM cash_outflows WHERE organization_id=p_org_id
    AND outflow_date >= v_today - 30 AND outflow_date <= v_today;

  -- Exposição fornecedor (pending + supplier IS NOT NULL)
  SELECT COALESCE(SUM(amount), 0) INTO v_f30
  FROM cash_outflows WHERE organization_id=p_org_id
    AND supplier IS NOT NULL AND status='pending' AND outflow_date <= v_today + 30;
  SELECT COALESCE(SUM(amount), 0) INTO v_f60
  FROM cash_outflows WHERE organization_id=p_org_id
    AND supplier IS NOT NULL AND status='pending' AND outflow_date <= v_today + 60;
  SELECT COALESCE(SUM(amount), 0) INTO v_f90
  FROM cash_outflows WHERE organization_id=p_org_id
    AND supplier IS NOT NULL AND status='pending' AND outflow_date <= v_today + 90;
  SELECT COALESCE(SUM(amount), 0) INTO v_total
  FROM cash_outflows WHERE organization_id=p_org_id
    AND supplier IS NOT NULL AND status='pending';

  -- Alert date: walk 90d projection (cash_inflows future + cash_outflows pending)
  v_bal := v_current;
  FOR v_day IN 1..90 LOOP
    SELECT COALESCE(SUM(net_amount), 0) INTO v_day_inc
    FROM cash_inflows WHERE organization_id=p_org_id AND release_date = v_today + v_day;
    SELECT COALESCE(SUM(amount), 0) INTO v_day_exp
    FROM cash_outflows WHERE organization_id=p_org_id AND outflow_date = v_today + v_day;
    v_bal := v_bal + v_day_inc - v_day_exp;
    IF v_alert_date IS NULL AND v_bal < v_alert_thresh THEN
      v_alert_date := v_today + v_day;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_burn, v_alert_thresh, v_alert_date,
    v_entrada, v_saida, v_f30, v_f60, v_f90, v_total;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_treasury_panel(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_treasury_panel(UUID) TO authenticated;
```

**Chart RPCs:**

```sql
-- get_cost_by_month: stacked cost composition by month+category
CREATE OR REPLACE FUNCTION public.get_cost_by_month(
  p_org_id UUID, p_months INT DEFAULT 9
)
RETURNS TABLE (month TEXT, category TEXT, total NUMERIC)
LANGUAGE sql SECURITY INVOKER SET search_path = 'public'
AS $$
  SELECT
    TO_CHAR(co.outflow_date, 'YYYY-MM') AS month,
    COALESCE(NULLIF(TRIM(co.category), ''), 'Outros') AS category,
    SUM(co.amount) AS total
  FROM cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.outflow_date >= (DATE_TRUNC('month',
          (now() AT TIME ZONE 'America/Sao_Paulo')::date) - ((p_months - 1) || ' months')::INTERVAL)::date
  GROUP BY 1, 2
  ORDER BY 1, 3 DESC;
$$;

-- get_supplier_exposure: grouped exposure by supplier for chart
CREATE OR REPLACE FUNCTION public.get_supplier_exposure(
  p_org_id UUID, p_top_n INT DEFAULT 10
)
RETURNS TABLE (supplier TEXT, amount_30d NUMERIC, amount_60d NUMERIC, amount_90d NUMERIC)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = 'public'
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  RETURN QUERY
  SELECT
    co.supplier,
    COALESCE(SUM(co.amount) FILTER (WHERE co.outflow_date <= v_today + 30), 0) AS amount_30d,
    COALESCE(SUM(co.amount) FILTER (WHERE co.outflow_date <= v_today + 60), 0) AS amount_60d,
    COALESCE(SUM(co.amount) FILTER (WHERE co.outflow_date <= v_today + 90), 0) AS amount_90d
  FROM cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.supplier IS NOT NULL
    AND co.status = 'pending'
    AND co.outflow_date <= v_today + 90
  GROUP BY co.supplier
  ORDER BY COALESCE(SUM(co.amount) FILTER (WHERE co.outflow_date <= v_today + 90), 0) DESC
  LIMIT p_top_n;
END;
$$;
```

All three RPCs follow SECURITY INVOKER + REVOKE PUBLIC + GRANT authenticated pattern.

---

## 6. Chart Data Shapes (recharts)

### Chart 1: Saldo Projetado

**REUSE `CashFlowChart` unchanged.** Already accepts `data: CashFlowDataPoint[]` and optional `simulatedSeries`. No prop changes. [VERIFIED: file:src/components/financial/CashFlowChart.tsx]

### Chart 2: Composição de Custos por Mês (Stacked BarChart)

**Established project pattern for stacked bars:** `MLFinanceiro.tsx` lines 523–565 uses `ComposedChart` + multiple `<Bar stackId="a" />` components, one per category. [VERIFIED: file:src/pages/mercadolivre/MLFinanceiro.tsx]

Data row shape needed from `get_cost_by_month`:

```typescript
// Raw from RPC: { month: "2026-04", category: "Fornecedores", total: 120000 }
// Transform to wide format for recharts:
interface CostByMonthRow {
  month: string;            // "Abr/26" (display label)
  fullMonth: string;        // "2026-04" (sort key)
  [category: string]: number | string;  // dynamic keys per category
}
// Example: { month: "Abr/26", fullMonth: "2026-04", "Fornecedores": 120000, "Salários": 25000, ... }
```

Transform logic (pivot): Group rows by month, then for each row set `row[category] = total`.

**recharts implementation pattern:**

```tsx
// Source: MLFinanceiro.tsx stacked ComposedChart pattern
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const CATEGORY_COLORS: Record<string, string> = {
  "Fornecedores":         "#64748b",
  "Salários":             "#10b981",
  "Impostos/taxas":       "#8b5cf6",
  "Aluguéis/condomínio":  "#f59e0b",
  "Contabilidade":        "#3b82f6",
  "Cartão de crédito":    "#f43f5e",
  "Água/luz":             "#06b6d4",
  "Serviços gerais":      "#f97316",
  "Empréstimo":           "#a855f7",
  "Outros":               "hsl(220, 10%, 60%)",
};

<ResponsiveContainer width="100%" height={300}>
  <BarChart data={wideData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false}
           tickFormatter={(v) => `R$${(v/1000).toFixed(0)}k`} width={56} />
    <Tooltip contentStyle={{ ... }} formatter={(v) => currFmt(Number(v))} />
    <Legend wrapperStyle={{ fontSize: 11 }} />
    {allCategories.map((cat, i) => (
      <Bar key={cat} dataKey={cat} stackId="stack" fill={CATEGORY_COLORS[cat] ?? "#94a3b8"}
           maxBarSize={40} radius={i === lastIdx ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
    ))}
  </BarChart>
</ResponsiveContainer>
```

Note: `radius` on only the top bar (last in stack) to round top corners, mirroring the MLFinanceiro pattern.

### Chart 3: Exposição por Fornecedor (Grouped BarChart)

Data row shape from `get_supplier_exposure`:

```typescript
interface SupplierExposureRow {
  supplier: string;   // truncated to ~15 chars if long
  amount_30d: number; // cumulative to +30d
  amount_60d: number; // cumulative to +60d
  amount_90d: number; // cumulative to +90d
}
```

**Grouped BarChart pattern:** Multiple `<Bar>` components WITHOUT `stackId` — recharts automatically groups them side-by-side. No exact project example found (existing bars are either single or stacked), but this is standard recharts API.

```tsx
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

<ResponsiveContainer width="100%" height={300}>
  <BarChart data={exposureData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="20%">
    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
    <XAxis dataKey="supplier" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
           tickLine={false} axisLine={false}
           tickFormatter={(s) => s.length > 12 ? s.slice(0, 11) + "…" : s} />
    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
           tickFormatter={(v) => `R$${(v/1000).toFixed(0)}k`} width={56} />
    <Tooltip formatter={(v, name) => [currFmt(Number(v)), name]} />
    <Legend wrapperStyle={{ fontSize: 11 }} />
    <Bar dataKey="amount_30d" name="≤ 30d" fill="#3b82f6" maxBarSize={20} radius={[3,3,0,0]} />
    <Bar dataKey="amount_60d" name="≤ 60d" fill="#f59e0b" maxBarSize={20} radius={[3,3,0,0]} />
    <Bar dataKey="amount_90d" name="≤ 90d" fill="#ef4444" maxBarSize={20} radius={[3,3,0,0]} />
  </BarChart>
</ResponsiveContainer>
```

Top N = 10 suppliers (reasonable default given screen width; can be tuned).

---

## 7. `financial_settings` Extension

**Migration convention:** New file named `20260619XXXXXX_treasury_panel.sql` (timestamp > last migration 20260645020000, so use `20260650000000_treasury_panel.sql` — this project uses synthetic timestamps). Follow the idempotent pattern:

```sql
DO $$ BEGIN
  ALTER TABLE public.financial_settings
    ADD COLUMN alert_threshold numeric NOT NULL DEFAULT 30000;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;
```

No new RLS policy needed — the column falls under the existing SELECT/ALL policies.

**`useFinancialSettings` extension:** [VERIFIED: file:src/hooks/useFinancialSettings.ts]

Current interface:

```typescript
export interface FinancialSettings {
  initial_balance: number;
  operational_cost_rate: number;
  safety_margin: number;
}
```

Add:

```typescript
export interface FinancialSettings {
  initial_balance: number;
  operational_cost_rate: number;
  safety_margin: number;
  alert_threshold: number;  // NEW — default 30000
}
```

Update the select query to include `alert_threshold`:

```typescript
.select("initial_balance, operational_cost_rate, safety_margin, alert_threshold")
```

Update DEFAULTS:

```typescript
const DEFAULTS: FinancialSettings = {
  initial_balance: 0,
  operational_cost_rate: 0.22,
  safety_margin: 10000,
  alert_threshold: 30000,  // NEW
};
```

Update the return mapping:

```typescript
return {
  ...existing,
  alert_threshold: Number(data.alert_threshold ?? 30000),
};
```

---

## 8. Page / Component Touch Points

### Files to REMOVE references from (surgical edit to `MLFluxoCaixa.tsx`): [VERIFIED: file:src/pages/mercadolivre/MLFluxoCaixa.tsx]

1. `import { TodayBalanceCard } from "@/components/financial/TodayBalanceCard";` — remove
2. `import { ProjectedBalanceCard } from "@/components/financial/ProjectedBalanceCard";` — remove
3. `import { CapacityCard } from "@/components/financial/CapacityCard";` — remove
4. The entire grid JSX block (lines 229–248):
   ```tsx
   <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
     <TodayBalanceCard />
     <ProjectedBalanceCard />
     <CapacityCard />
   </div>
   ```
   Replace with `<TreasuryPanel />` (new component).

5. The `AdjustBalanceDialog` component and its button remain — the "Ajustar saldo de hoje" button is still relevant (initial_balance persists). Keep as-is.

### Files to KEEP UNCHANGED:

- `src/components/financial/CashFlowChart.tsx` — reused for Saldo Projetado (D-11)
- `src/components/financial/CashFlowSimulator.tsx` — Simulador tab unchanged (D-TESO-05)
- `src/components/financial/SimulatorVerdictCard.tsx` — same
- `src/hooks/useCashFlowData.ts` — unchanged (CashFlowChart still uses it)
- The `AdjustBalanceDialog` function inside MLFluxoCaixa.tsx — unchanged (keep the button)

### Files to EDIT:

- `src/hooks/useFinancialSettings.ts` — add `alert_threshold` field
- `src/pages/mercadolivre/MLFluxoCaixa.tsx` — remove 3 card imports, swap grid for TreasuryPanel

### Files to CREATE (new):

- `supabase/migrations/XXXXXXXXX_treasury_panel.sql` — migration: alert_threshold column + 3 RPCs
- `src/hooks/useTreasuryPanel.ts` — TanStack Query v5 hook consuming get_treasury_panel
- `src/hooks/useCostByMonth.ts` — hook for get_cost_by_month
- `src/hooks/useSupplierExposure.ts` — hook for get_supplier_exposure
- `src/components/financial/TreasuryPanel.tsx` — container with 3-band KPI grid
- `src/components/financial/CostCompositionChart.tsx` — stacked BarChart
- `src/components/financial/SupplierExposureChart.tsx` — grouped BarChart

### Component structure for `TreasuryPanel`:

```
TreasuryPanel.tsx
  ├── Band: "Saúde de Caixa" header (4 KPIs: Saldo Atual, Runway, Saldo Mín 90d, Alerta)
  ├── Band: "Realizado" header (4 KPIs: Entrada Real, Saída Real, Resultado, Burn Rate)
  └── Band: "Exposição a Fornecedor" header (4 KPIs: Fornec 30d, 60d, 90d, Total Expo)
```

Grid: `grid grid-cols-2 md:grid-cols-4 gap-3` per band. 3 bands stacked.

---

## 9. KPI Coloring — Design Tokens

From CLAUDE.md and Tailwind config: [VERIFIED: file:CLAUDE.md and tailwind.config.ts]

- `text-kpi-positive` = `hsl(var(--kpi-positive))` — green (positive balances, income)
- `text-kpi-negative` = `hsl(var(--kpi-negative))` — red (negative balances, expenses, alerts)
- `text-kpi-neutral`  = `hsl(var(--kpi-neutral))`  — neutral/blue (informational)

**Coloring rules per KPI:**

| KPI | Color rule |
|-----|-----------|
| Saldo Atual | positive if > 0, negative if ≤ 0 |
| Runway | warning (kpi-neutral) if < 1 month, positive if > 3 months |
| Saldo Mín 90d | negative if < alert_threshold, neutral otherwise |
| Alerta | kpi-negative + warning icon (AlertTriangle) if alert_date IS NOT NULL |
| Entrada Real | always kpi-positive |
| Saída Real | always kpi-negative |
| Resultado | positive if > 0, negative if ≤ 0 |
| Burn Rate | always kpi-neutral (informational) |
| Fornec 30/60/90d | kpi-negative (obligation amounts) |
| Total Exposição | kpi-negative |

Existing components use `className={v >= 0 ? "text-kpi-positive" : "text-kpi-negative"}` pattern — mirror that exactly. [VERIFIED: TodayBalanceCard.tsx]

---

## 10. Standard Stack

No new packages required. All needed libraries are already in the project.

### Core (already installed)
| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| recharts | 2.15.4 | Charts (stacked bar, grouped bar) | Installed [VERIFIED: CLAUDE.md] |
| @tanstack/react-query | 5.83.0 | Data fetching hooks | Installed [VERIFIED: CLAUDE.md] |
| @supabase/supabase-js | 2.98.0 | RPC calls | Installed [VERIFIED: CLAUDE.md] |
| lucide-react | 1.7.0 | Icons (AlertTriangle, etc.) | Installed [VERIFIED: CLAUDE.md] |
| shadcn/ui (Card, Skeleton, Badge) | present | UI primitives | Installed [VERIFIED: CLAUDE.md] |

### Package Legitimacy Audit

No new packages to install. All libraries already present in the project.

---

## Architecture Patterns

### System Architecture Diagram

```
MLFluxoCaixa.tsx
├── Tabs: "Caixa Real" ──────────────────────────────────────────┐
│   ├── TreasuryPanel (NEW)                                      │
│   │   ├── useTreasuryPanel() ──► get_treasury_panel RPC        │
│   │   │                          (burn_rate, alert, realizado,  │
│   │   │                           fornec 30/60/90d, total expo) │
│   │   ├── useProjectedBalance(90) ► get_projected_balance_summary│
│   │   │                             (current_balance, min_balance│
│   │   │                              critical_date)             │
│   │   └── useFinancialSettings() ► financial_settings table     │
│   │       (alert_threshold extended)                            │
│   ├── CashFlowChart (REUSE, unchanged)                         │
│   │   └── useCashFlowData() ──────► get_cashflow RPC           │
│   ├── CostCompositionChart (NEW)                               │
│   │   └── useCostByMonth() ─────► get_cost_by_month RPC        │
│   └── SupplierExposureChart (NEW)                              │
│       └── useSupplierExposure() ──► get_supplier_exposure RPC  │
│                                                                 │
└── Tabs: "Simulador" ────────────────────────────────────────────┘
    └── CashFlowSimulator (UNTOUCHED — Phase 50)
```

### Recommended Project Structure

```
src/
├── components/financial/
│   ├── TreasuryPanel.tsx          [NEW] — 3-band KPI container
│   ├── CostCompositionChart.tsx   [NEW] — stacked BarChart
│   ├── SupplierExposureChart.tsx  [NEW] — grouped BarChart
│   ├── CashFlowChart.tsx          [REUSE, unchanged]
│   ├── CashFlowSimulator.tsx      [UNTOUCHED]
│   ├── TodayBalanceCard.tsx       [KEEP FILE, just remove from page]
│   ├── ProjectedBalanceCard.tsx   [KEEP FILE, just remove from page]
│   └── CapacityCard.tsx           [KEEP FILE, just remove from page]
├── hooks/
│   ├── useTreasuryPanel.ts        [NEW]
│   ├── useCostByMonth.ts          [NEW]
│   ├── useSupplierExposure.ts     [NEW]
│   ├── useProjectedBalance.ts     [EDIT — call with 90d]
│   └── useFinancialSettings.ts    [EDIT — add alert_threshold]
supabase/migrations/
│   └── 20260650000000_treasury_panel.sql  [NEW]
```

### Hook Pattern (TanStack Query v5) [VERIFIED: file:src/hooks/useProjectedBalance.ts]

```typescript
// Follows established pattern exactly:
export function useTreasuryPanel() {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery({
    queryKey: ["cashflow", "treasury_panel", orgId] as const,
    enabled: !!orgId,
    staleTime: 3 * 60 * 1000,
    queryFn: async () => {
      if (!orgId) return null;
      const { data, error } = await supabase.rpc("get_treasury_panel", { p_org_id: orgId });
      if (error) throw error;
      const r = data?.[0];
      if (!r) return null;
      return { /* map fields */ };
    },
  });
}
```

### Anti-Patterns to Avoid

- **Direct SELECT from cash_outflows/cash_inflows in frontend:** Multi-row tables; use RPCs to avoid PostgREST 1000-row truncation.
- **SECURITY DEFINER with p_org_id param:** IDOR risk — always SECURITY INVOKER.
- **Using `CURRENT_DATE` in SQL:** Must use `(now() AT TIME ZONE 'America/Sao_Paulo')::date` (BRT timezone fix from Phase 49/50).
- **Forgetting REVOKE PUBLIC + GRANT authenticated:** All RPCs must revoke public execute.
- **Editing CashFlowChart or CashFlowSimulator:** These are explicitly out of scope for this phase.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| KPI card with value/label/color | Custom card div | `text-kpi-positive/negative/neutral` tokens + Card + CardContent | Design system consistency |
| Stacked bar chart | Custom SVG stacking | recharts `<Bar stackId="stack" />` | SVG stacking complexity; recharts handles animations, tooltips, legends |
| Grouped bar chart | Custom SVG groups | recharts `<Bar>` without stackId | Same as above |
| Monthly period grouping | JS date manipulation | SQL `TO_CHAR(date, 'YYYY-MM')` GROUP BY | Date edge cases (timezone, month boundaries) |
| Currency formatting | Custom formatter | `v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })` | Locale-correct format established project-wide |
| BRT today | `new Date()` | `brToday()` from `src/lib/brDate.ts` | UTC mismatch bug documented in Phase 49 |

---

## Common Pitfalls

### Pitfall 1: alert_date vs critical_date Confusion
**What goes wrong:** Using `critical_date` (first day balance < 0) as the "Alerta" date (first day balance < alert_threshold=30000). For Pé Vermeio's reference data, balance never goes negative but crosses 30k on 23/06 — so `critical_date` from the existing RPC would return NULL while Alerta should show 23/06.
**Why it happens:** The existing `get_projected_balance_summary` only detects negative balance. Phase 51 requires a separate threshold check.
**How to avoid:** `get_treasury_panel` runs its own 90d loop detecting `v_bal < alert_threshold` separately from the `< 0` detection.
**Warning signs:** Alerta always shows NULL even when Saldo Mín < alert_threshold.

### Pitfall 2: BRT Timezone in RPC
**What goes wrong:** Using `CURRENT_DATE` (UTC) causes the "today" cutoff to be off by 3h in Brazilian evening hours. The Phase 49 fix already addressed this for existing RPCs.
**How to avoid:** Every new RPC MUST use `(now() AT TIME ZONE 'America/Sao_Paulo')::date` for `v_today`.
**Warning signs:** KPIs show wrong values after 21h BRT.

### Pitfall 3: Stacked vs Cumulative in Fornec 30/60/90d
**What goes wrong:** Fornec 60d showing only the additional 30–60d amount (incremental), not cumulative.
**Why it happens:** D-09 says "somatorio CUMULATIVO". Fornec 60d includes all pending supplier payables with outflow_date <= today+60 (which already includes the <= today+30 bucket).
**How to avoid:** The SQL uses `outflow_date <= v_today + 60` not `BETWEEN today+30 AND today+60`.
**Validation:** Reference shows 133k → 226k → 311k — these are cumulative (226k > 133k, 311k > 226k).

### Pitfall 4: category NULL in Cost Composition Chart
**What goes wrong:** NULL category rows are dropped from the chart, causing totals to not match.
**Why it happens:** `cash_outflows.category` is nullable; Tiny sometimes doesn't send the field.
**How to avoid:** SQL uses `COALESCE(NULLIF(TRIM(co.category), ''), 'Outros')` to assign uncategorized to "Outros" bucket.
**Warning signs:** Chart totals don't match Saída Real KPI.

### Pitfall 5: Pivot Transform on Chart Data
**What goes wrong:** Leaving the `get_cost_by_month` long-format data as-is (month, category, total) and passing it to recharts, which expects wide format.
**Why it happens:** recharts BarChart needs one row per X-axis point with category amounts as columns.
**How to avoid:** Frontend transform: `rows.reduce((acc, r) => { acc[r.month][r.category] = r.total; return acc; }, {})` before rendering.
**Warning signs:** Chart renders with only 1 bar instead of stacked bars.

### Pitfall 6: Burn Rate Division by Zero
**What goes wrong:** `Runway = Saldo Atual / Burn Rate` throws runtime error or shows Infinity when no outflows in past 90d.
**How to avoid:** Guard: `const runway = burnRate > 0 ? currentBalance / burnRate : null`.

### Pitfall 7: Supabase Project ID Mismatch
**What goes wrong:** Running `supabase db push` or linking to wrong project; migration goes to `gionpsuunfkkzzjdubfy` (unused).
**How to avoid:** Always apply migrations via MCP `apply_migration` on `ckcdevcxgvueywivefgx`. Never use CLI push (STATE.md: "Supabase CLI local linkado no projeto ERRADO").

---

## Reference Values for Validation

From Wesley's panel image (2026-06-19):

| KPI | Reference Value | Notes |
|-----|----------------|-------|
| Saldo Atual | R$ 19.155,15 | From get_projected_balance_summary(90) |
| Runway | 0,15 meses | 19.155 / 124.942 |
| Saldo Mín 90d | R$ 11.715,85 | From get_projected_balance_summary(90).min_balance |
| Data Mín | 23/06/2026 | Date of min balance (not necessarily first-negative) |
| Alerta | < R$30k em 23/06/2026 | First crossing of 30k threshold |
| Entrada Real | R$ 363.839,39 | CONTEXT says this may reflect ~3m window; with 30d window the number differs |
| Saída Real | R$ 374.826,73 | Same caveat |
| Resultado | R$ −10.987,34 | Entrada − Saída |
| Burn Rate | R$ 124.942,24 | 3-month monthly average |
| Fornec 30d | R$ 133.026,48 | Cumulative |
| Fornec 60d | R$ 226.591,77 | Cumulative |
| Fornec 90d | R$ 311.477,86 | Cumulative |
| Total Expo | R$ 671.096,11 | All pending supplier payables |

**Verification protocol:** After deploying the RPC, call `SELECT * FROM get_treasury_panel('<pe-vermeio-org-id>')` and compare each field against the reference values (within reasonable delta for the few days since reference was captured).

---

## Environment Availability

Step 2.6: SKIPPED — this phase is purely code/SQL changes with no new external dependencies. All runtime dependencies (Supabase, Tiny ERP sync already running) are already in production.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Burn Rate = SUM(outflows last 90d) / 3 matches Wesley's 124.942 reference | §4 KPI 9 | If wrong formula, Runway and Burn Rate KPIs show wrong values at checkpoint |
| A2 | The "Data do Saldo Mínimo" KPI = date of minimum balance (not necessarily first-negative); existing RPC's `critical_date` field is the Alerta date (threshold crossing), not min-balance date | §4 KPI 4 | If wrong, Saldo Mínimo date and Alerta date show the same value instead of distinct values |
| A3 | Entrada/Saída Real 30d in D-07 includes ALL cash_outflows (paid + pending) with outflow_date in the 30d past window | §4 KPI 7 | If only 'paid' should count, Saída Real 30d will be lower than reference expects |
| A4 | get_treasury_panel's 90d projection for alert_date uses cash_inflows.release_date (confirmed future releases from MP) + cash_outflows.outflow_date (all statuses, pending = expected payment) | §5 SQL | If outflow filter should be 'pending' only in projection loop, alert_date will shift |
| A5 | Top N = 10 suppliers is appropriate for SupplierExposureChart without horizontal scroll | §6 Chart 3 | If Pé Vermeio has many suppliers, chart becomes too narrow; may need to reduce N |

---

## Open Questions (RESOLVED)

1. **Data do Saldo Mínimo vs critical_date semantics** — ✅ RESOLVED
   - existing RPC's `critical_date` = first day balance < 0. Reference shows Saldo Mín = 11.715 (positive) on 23/06.
   - Resolution: `get_treasury_panel` tracks BOTH `min_balance_date` (arg-min of projected balance, D-05) AND `alert_date` (first day < alert_threshold, D-06) as DISTINCT fields. When they coincide (as in reference) both show 23/06. Plan 51-01 Task 1 adds `min_balance_date` to the RETURNS TABLE/RETURN QUERY (the "AJUSTE SOBRE O §5" note). No ambiguity remains.

2. **Saída Real 30d: paid-only or all statuses?** — ✅ RESOLVED (paid-only)
   - D-07 says "cash_outflows PAGOS nos ultimos 30d". "Saída REAL/realizada" = effectively paid.
   - Resolution: **`status = 'paid'`** for Saída Real 30d. Verified empirically against the live DB (project ckcdevcxgvueywivefgx, 2026-06-19): in the last 30d window, paid == all-statuses (R$208.127,35 identical) because pending payables (Tiny contas a pagar) carry future `outflow_date` and don't fall in [today-30, today]. So paid-only is both semantically correct AND loses no data. Plan 51-01 Bloco B updated to add `AND status='paid'`. Burn Rate (3m, D-08) intentionally keeps all-statuses over the 90d window as an obligation run-rate — different metric, not a contradiction.

3. **Burn Rate 30d vs 3m checkpoint with Wesley** — ✅ RESOLVED (3-month, confirm at checkpoint)
   - CONTEXT.md D-08 flags this explicitly.
   - Resolution: Implement 3-month monthly average (avoids duplicating Saída Real). The 3m-vs-30d confirmation is embedded as Task 4 of Plan 51-03 (visual checkpoint with Wesley on the Vercel preview). Not a blocker for execution.

---

## Sources

### Primary (HIGH confidence)
- `supabase/migrations/20260618100000_cash_flow_tables.sql` — schema of cash_inflows, cash_outflows, financial_settings (verified exact columns and constraints)
- `supabase/migrations/20260618120000_cash_flow_rpcs.sql` — RPC signatures, SECURITY INVOKER pattern, REVOKE/GRANT pattern
- `supabase/migrations/20260619020000_cashflow_brt_timezone.sql` — BRT timezone fix, latest RPC versions
- `supabase/config.toml` — project ID ckcdevcxgvueywivefgx confirmed
- `src/pages/mercadolivre/MLFluxoCaixa.tsx` — exact imports and JSX to remove
- `src/hooks/useProjectedBalance.ts` — hook pattern to mirror; RPC return shape
- `src/hooks/useFinancialSettings.ts` — extension point
- `src/components/financial/CashFlowChart.tsx` — REUSE candidate confirmed
- `src/pages/mercadolivre/MLFinanceiro.tsx` — stacked BarChart stackId pattern
- `supabase/functions/sync-tiny-payables/index.ts` — category/supplier/status value normalization

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` accumulated context — Supabase project ID clarification, PostgREST patterns
- `.planning/phases/51-painel-de-tesouraria-fluxo-de-caixa/51-CONTEXT.md` — all 13 decisions

### Tertiary (LOW confidence)
- Reference values from Wesley's image (via CONTEXT.md) — used for validation targets; actual values depend on data at time of execution

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages, all existing
- Supabase project ID: HIGH — confirmed from config.toml
- Schema: HIGH — read directly from migration SQL
- RPC patterns (SECURITY INVOKER, BRT, REVOKE/GRANT): HIGH — verified in existing RPCs
- KPI formulas: MEDIUM/HIGH — derived from decisions + schema; A1/A3 assumptions flagged
- Chart patterns: HIGH for stacked (MLFinanceiro.tsx evidence); MEDIUM for grouped (standard recharts but no project example found)
- Reference value alignment: MEDIUM — values captured on a specific date, exact match depends on run timing

**Research date:** 2026-06-19
**Valid until:** 2026-07-19 (30 days — stable SQL/React domain)
