---
phase: 51-painel-de-tesouraria-fluxo-de-caixa
reviewed: 2026-06-20T00:00:00Z
depth: deep
files_reviewed: 10
files_reviewed_list:
  - supabase/migrations/20260650000000_treasury_panel.sql
  - supabase/migrations/20260650000100_treasury_category_backfill.sql
  - src/hooks/useTreasuryPanel.ts
  - src/hooks/useCostByMonth.ts
  - src/hooks/useSupplierExposure.ts
  - src/hooks/useFinancialSettings.ts
  - src/components/financial/TreasuryPanel.tsx
  - src/components/financial/CostCompositionChart.tsx
  - src/components/financial/SupplierExposureChart.tsx
  - src/pages/mercadolivre/MLFluxoCaixa.tsx
  - src/components/layout/LayoutShell.tsx
findings:
  critical: 1
  high: 4
  warning: 5
  info: 3
  total: 13
status: issues_found
---

# Phase 51: Code Review Report

**Reviewed:** 2026-06-20
**Depth:** deep (cross-file: RPC ↔ hooks ↔ componentes)
**Files Reviewed:** 10 (+ 3 de contexto cruzado: `20260618120000_cash_flow_rpcs.sql`, `20260618100000_cash_flow_tables.sql`, `useProjectedBalance.ts`)
**Status:** issues_found

## Summary

O painel de tesouraria adiciona 3 RPCs (`get_treasury_panel`, `get_cost_by_month`, `get_supplier_exposure`) corretamente declaradas `SECURITY INVOKER` com `REVOKE FROM PUBLIC, anon` + `GRANT TO authenticated` — sem violação do padrão IDOR. A RLS de `cash_outflows`/`cash_inflows` é org-first (`is_org_member`), então o isolamento multi-tenant está enforçado a despeito de as RPCs não filtrarem `ml_user_id` (a tabela é org-only, sem coluna de loja no escopo das agregações — OK).

Os problemas de correção concentram-se em **inconsistência de modelo/timezone entre o painel e os cards já existentes** que ficam lado a lado na mesma tela, produzindo KPIs que não fecham entre si. Também há um **SECURITY DEFINER no backfill com `ml_user_id` hardcoded e token Tiny lido em DEFINER** que merece atenção (Critical) e um KPI que pode mostrar data e valor de modelos divergentes (High).

## Critical Issues

### CR-01: `enrich_drain` / `enrich_harvest` são SECURITY DEFINER e escrevem em `cash_outflows` de qualquer org sem checagem de tenant + token Tiny hardcoded a uma loja

**File:** `supabase/migrations/20260650000100_treasury_category_backfill.sql:30-99`
**Issue:**
- Ambas as procs/funções são `SECURITY DEFINER` (rodam como owner, ignorando RLS) e fazem `UPDATE public.cash_outflows SET category = ... WHERE tiny_payable_id = r.tiny_payable_id AND organization_id = r.organization_id` — o `organization_id`/`ml_user_id` vêm da fila `cat_backfill_queue`, que não tem RLS própria nem qualquer validação de que `r.tiny_payable_id` realmente pertence àquela `organization_id`. Se um `tiny_payable_id` colidir entre orgs (PK é só `tiny_payable_id`, global), a categoria de uma org pode ser gravada com o detalhe Tiny de outra. A PK única global sobre `tiny_payable_id` já assume que IDs Tiny nunca colidem entre contas — premissa não garantida em ambiente multi-loja (linha 20).
- `enrich_drain` (linha 40) lê `tiny_access_token` **hardcoded para `ml_user_id='1639558873'`** e usa esse token para buscar o detalhe de QUALQUER item na fila, independentemente de qual `ml_user_id` o item pertence (a fila tem coluna `ml_user_id` mas ela é ignorada no drain). Em multi-tenant isso (a) vaza dados de uma conta consultados com o token de outra e (b) quebra silenciosamente para qualquer org que não seja a 1639558873. Esse é exatamente o anti-padrão "seller hardcoded errado" já registrado como gate E2E bug na memória.
- O `enrich_harvest` é `REVOKE ... FROM ... authenticated` (bom), mas `enrich_drain` (PROCEDURE) **não tem REVOKE** — fica com EXECUTE para PUBLIC por padrão. Como é DEFINER, qualquer role com acesso ao schema poderia tentar `CALL public.enrich_drain(...)` disparando http_get com o token da loja principal.

**Fix:**
```sql
-- 1. REVOKE da procedure DEFINER:
REVOKE EXECUTE ON PROCEDURE public.enrich_drain(int, numeric) FROM PUBLIC, anon, authenticated;

-- 2. usar o token DA loja do item, não hardcoded:
FOR r IN SELECT q.tiny_payable_id, q.ml_user_id FROM public.cat_backfill_queue q
         WHERE q.status='todo' ORDER BY q.updated_at LIMIT p_limit LOOP
  SELECT tiny_access_token INTO v_token FROM public.ml_tokens WHERE ml_user_id = r.ml_user_id LIMIT 1;
  IF v_token IS NULL THEN CONTINUE; END IF;
  ...
END LOOP;

-- 3. no UPDATE de harvest, validar org+tiny_user juntos (a fila já tem ml_user_id):
UPDATE public.cash_outflows c SET category = v_cat
  FROM public.cat_backfill_queue q
  WHERE q.tiny_payable_id = r.tiny_payable_id
    AND c.tiny_payable_id = q.tiny_payable_id
    AND c.organization_id = q.organization_id;
```
Se IDs Tiny puderem colidir entre lojas, a PK da fila deve ser `(tiny_payable_id, organization_id)`.

## High

### HG-01: "Saldo Mín 90d" mostra valor de um modelo e data de outro — KPI não fecha

**File:** `src/components/financial/TreasuryPanel.tsx:102,105,150-158` + `supabase/migrations/20260650000000_treasury_panel.sql:185-210`
**Issue:** O valor `minBalance` vem de `projected.min_balance` (`get_projected_balance_summary`, saldo **realístico** que soma receita projetada via SMA das `orders`). Já o subtitle `minBalanceDate` vem de `treasury.min_balance_date`, calculado no loop de `get_treasury_panel` que **só considera entradas confirmadas** (`cash_inflows`), sem qualquer SMA de receita projetada. São dois modelos de projeção diferentes: o dia do mínimo no modelo confirmado-apenas raramente coincide com o valor mínimo do modelo com-SMA. O usuário vê um valor (ex.: R$ X) rotulado com uma data que corresponde a outro mínimo. Idem para a comparação `minBalance < alertThreshold` (linha 153) que pinta a cor, mas `alert_date` (linha 104) vem do loop confirmado-apenas — a cor e o alerta podem discordar.
**Fix:** Calcular `min_balance`, `min_balance_date` e `alert_date` no MESMO modelo. Ou (a) mover o cálculo do mínimo+data para dentro de `get_projected_balance_summary` (que já tem a SMA) e remover do `get_treasury_panel`, ou (b) adicionar a projeção SMA ao loop do `get_treasury_panel` para que valor e data saiam da mesma série. Não misturar as duas fontes no mesmo card.

### HG-02: Timezone divergente entre painel (BRT) e saldo atual exibido (UTC) gera saldo/runway inconsistentes na virada do dia

**File:** `supabase/migrations/20260650000000_treasury_panel.sql:74` vs `supabase/migrations/20260618120000_cash_flow_rpcs.sql:~`(`get_projected_balance_summary` usa `v_today := CURRENT_DATE`)
**Issue:** `get_treasury_panel` define `v_today := (now() AT TIME ZONE 'America/Sao_Paulo')::date` (BRT), mas o `currentBalance`/`minBalance` exibidos no painel vêm de `useProjectedBalance` → `get_projected_balance_summary`, que usa `CURRENT_DATE` (UTC no Supabase). Entre 21:00–24:00 BRT (00:00–03:00 UTC do dia seguinte) as duas RPCs estão em dias diferentes: o `burn_rate` (BRT) divide por uma janela 90d deslocada em relação à janela do saldo atual; entradas/saídas "de hoje" entram em uma RPC e não na outra. `runway = currentBalance / burnRate` mistura bases de dias distintas. Já existe `feedback_timestamptz_date_filter` registrando que o boundary de data zerava o último dia — mesma classe de bug.
**Fix:** Padronizar TODAS as RPCs de caixa em BRT. Trocar em `get_projected_balance_summary` e `get_daily_balance`: `v_today := (now() AT TIME ZONE 'America/Sao_Paulo')::date;` para alinhar com `get_treasury_panel`.

### HG-03: Burn rate soma `paid` + `pending` (run-rate "de obrigações") mas é dividido só por 3 e comparado a um saldo realizado — runway infla/desinfla conforme contas futuras já lançadas

**File:** `supabase/migrations/20260650000000_treasury_panel.sql:117-124`
**Issue:** O burn rate é `SUM(amount) WHERE outflow_date >= today-90 AND < today` de **todos os status**. O comentário (linha 47/117) chama de "run-rate de obrigações", mas a janela é estritamente passada (`< v_today`); contas `pending` com `outflow_date` no passado são contas vencidas/atrasadas, não run-rate futuro. Misturar `paid` (realizado) com `pending` vencido infla o burn rate de forma não-determinística (depende de quanto está atrasado no Tiny naquele momento), e isso entra direto no `runway` mostrado ao Wesley como "meses de caixa". Compare com `saida_real_30d` (linha 134-141) que usa `status='paid'` corretamente — incoerência interna do próprio painel.
**Fix:** Decidir o significado e ser consistente. Para "média mensal de saída realizada" (que casa com Saída Real): `AND co.status = 'paid'`. Se o objetivo é run-rate de obrigações, a janela deveria ser futura, não `< v_today`. Documentar a escolha no comentário e alinhar com o label do card ("Burn Rate / média mensal (3m)").

### HG-04: `get_cost_by_month` na migration A (20260650000000) não tem limite superior de data — meses-outlier (ex.: 2030) entram no gráfico

**File:** `supabase/migrations/20260650000000_treasury_panel.sql:248-263`
**Issue:** A versão de `get_cost_by_month` no Bloco C filtra apenas `outflow_date >= início`, sem cota superior. Contas `pending` futuras do Tiny (parcelamentos longos, lançamentos com data digitada errada como 2030) aparecem como colunas no gráfico de "Composição de Custos por Mês". A migration B (`20260650000100`, linhas 104-124) **redefine** a mesma função COM o bound superior (`< hoje + INTERVAL '4 months'`) justamente para corrigir isso. Como `CREATE OR REPLACE` é ordenado por nome de arquivo, a B vence — mas o arquivo A consolidado ainda contém a versão buggada. Se alguém reaplicar só a A, ou a ordem de aplicação mudar, o bug volta. Há duas definições conflitantes da mesma assinatura no mesmo PR (code smell + risco de regressão).
**Fix:** Remover a definição de `get_cost_by_month` do Bloco C da migration A (deixar só a versão bounded na B), ou já colocar o bound superior também na A. Não manter duas definições divergentes da mesma função no mesmo conjunto de migrations.

## Warnings

### WR-01: Pivot long→wide deixa categorias ausentes como `undefined` em vez de 0 — barras empilhadas podem renderizar buracos

**File:** `src/components/financial/CostCompositionChart.tsx:48-77`
**Issue:** O `monthMap` só seta `[row.category] = row.total` para as categorias presentes naquele mês. Meses que não têm uma dada categoria ficam sem a chave; o recharts recebe `undefined` para aquele `dataKey` naquele mês. Em `BarChart` empilhado, `undefined` é tratado como gap (não 0), podendo deslocar o empilhamento e o `radius` do "topo" (linha 146 assume que a última categoria de `allCategories` é sempre o topo visível, o que não é verdade quando ela está ausente naquele mês).
**Fix:** Após montar `allCategories`, preencher zeros: para cada linha de `wideData` e cada `cat` de `allCategories`, `if (row[cat] === undefined) row[cat] = 0;`.

### WR-02: `useFinancialSettings` retorna `FinancialSettings` mas o tipo do hook é `FinancialSettings | null` — inconsistência de contrato

**File:** `src/hooks/useFinancialSettings.ts:29,33,46`
**Issue:** `useQuery<FinancialSettings | null>` mas `queryFn` é tipado `Promise<FinancialSettings>` e sempre retorna `DEFAULTS` (nunca `null`). O `| null` no genérico é morto e induz consumidores a tratar um caso que não ocorre. Não é bug de runtime, mas mascara intenção.
**Fix:** Alinhar para `useQuery<FinancialSettings>` (remover `| null`), já que a função sempre resolve com defaults.

### WR-03: `AdjustBalanceDialog` tem dois caminhos de sincronização do valor inicial divergentes

**File:** `src/pages/mercadolivre/MLFluxoCaixa.tsx:76,80-83`
**Issue:** O estado inicial é `useState(String(currentBalance))` e `handleOpenChange` também faz `if (isOpen) setValue(...)`. Mas o `Dialog` recebe `onOpenChange={handleOpenChange}` enquanto os botões internos chamam `onOpenChange(false)` (a prop crua, linha 110/151), não `handleOpenChange`. Resultado: se o dialog reabrir sem desmontar (componente persistente), `currentBalance` pode ter mudado e o `setValue` no `handleOpenChange` cobre isso — mas o valor inicial via `useState` só roda na montagem. O fluxo funciona por acaso porque o componente remonta, mas a lógica de "sincronizar ao abrir" depende de o trigger passar por `handleOpenChange`, e o `setAdjustOpen(true)` externo (linha 237) abre via `open` prop sem disparar `onOpenChange`. Logo o `setValue(currentBalance)` na abertura externa NÃO roda — o input pode mostrar valor velho.
**Fix:** Usar um `useEffect(() => { if (open) setValue(String(currentBalance)); }, [open, currentBalance])` em vez de depender do `handleOpenChange`, que não é chamado quando `open` é controlado externamente.

### WR-04: `parseFloat(value.replace(",", "."))` só troca a PRIMEIRA vírgula — entrada "1.234,56" vira NaN/valor errado

**File:** `src/pages/mercadolivre/MLFluxoCaixa.tsx:86`
**Issue:** O input é `type="number"` (linha 138), que em locale pt-BR pode entregar string já normalizada, mas o código defensivo `value.replace(",", ".")` troca só a primeira ocorrência e não remove separador de milhar. Se o navegador/colagem entregar "1.234,56", `parseFloat("1.234.56")` → `1.234`. Para um campo de saldo de caixa isso grava silenciosamente um valor errado (perda de dados financeiros).
**Fix:** Normalizar de forma robusta: remover separador de milhar e usar replace global — `const norm = value.replace(/\./g, "").replace(",", "."); const parsed = parseFloat(norm);` (assumindo formato pt-BR), ou confiar só no `valueAsNumber` do input number.

### WR-05: Loop diário do `get_treasury_panel` executa 2 subqueries por dia × 90 dias = 180 queries por chamada da RPC

**File:** `supabase/migrations/20260650000000_treasury_panel.sql:185-210`
**Issue:** Correção/manutenção (não performance pura): o loop faz `SELECT SUM ... WHERE release_date = v_today + v_day` dia a dia. Além de 180 round-trips internos, qualquer dia sem índice em `(organization_id, release_date)` faz seq scan repetido. Como já existe `get_projected_balance_summary` que faz a mesma projeção em um único loop, há duplicação de lógica de projeção entre as duas RPCs — fonte de divergência (ver HG-01/HG-02).
**Fix:** Pré-agregar entradas e saídas por dia em CTEs (`GROUP BY outflow_date`/`release_date`) e iterar sobre o resultado em memória, ou consolidar a projeção em uma única RPC reutilizada pelo painel.

## Info

### IN-01: Comentário do header da migration A menciona "9 escalares" mas a RPC retorna 10 colunas

**File:** `supabase/migrations/20260650000000_treasury_panel.sql:7,35`
**Issue:** Documentação desatualizada (9 vs 10: burn_rate, alert_threshold, alert_date, min_balance_date, entrada, saida, f30, f60, f90, total). O hook `useTreasuryPanel.ts:3` corretamente diz "10 escalares".
**Fix:** Atualizar comentário para 10.

### IN-02: `truncate` no eixo X de fornecedores pode colidir nomes distintos em "…"

**File:** `src/components/financial/SupplierExposureChart.tsx:26-27`
**Issue:** Dois fornecedores com os mesmos 11 primeiros caracteres viram o mesmo rótulo truncado, ambíguo no gráfico. Apenas cosmético.
**Fix:** Manter nome completo no tooltip (já há) e/ou usar `label` rotacionado.

### IN-03: `radius` da última categoria no stacked bar assume ordenação estável de `allCategories`

**File:** `src/components/financial/CostCompositionChart.tsx:74,146`
**Issue:** `allCategories` é derivado da ordem de aparição em `rawData` (que vem `ORDER BY 1, 3 DESC` da RPC — ordem por mês, depois por total). A "última" categoria do array não é necessariamente a do topo da pilha em todos os meses, então o arredondamento de canto `[3,3,0,0]` pode cair na barra errada. Cosmético; relacionado a WR-01.
**Fix:** Aplicar radius condicional por barra é frágil em stacked; aceitar cantos retos ou usar um overlay.

---

_Reviewed: 2026-06-20_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
