---
phase: 66-compras-v2-override-por-fornecedor
verified: 2026-06-26T17:51:47Z
status: human_needed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Abrir /compras logado como Wesley (owner), clicar em 'Parâmetros', selecionar escopo 'Por Fornecedor' no diálogo — confirmar que o dropdown carrega os 6 fornecedores (PRALANA, ZEBU, TEXTILE XTRA, R&S, Rossi, MGS). Criar um param de fornecedor com lead_time diferente do global/marca. Fechar o diálogo e confirmar que os SKUs daquele fornecedor mudam compra_sugerida."
    expected: "Dropdown lista os 6 fornecedores sem texto livre; param salvo com scope='fornecedor'; compra_sugerida dos SKUs do fornecedor reflete o novo lead_time."
    why_human: "Wiring RPC→hook→dropdown requer browser logado com JWT org. Badge no tooltip da tabela mostrará 'global' em vez de 'fornecedor' (gap cosmético — ver Anti-Patterns)."
  - test: "Confirmar que a branch gsd/phase-66-override-fornecedor está pronta para merge e aprovação do PR. O deploy na Vercel deve ocorrer após ok visual de Wesley."
    expected: "PR aprovado e mergeado; Vercel prod mostra o novo escopo 'Por Fornecedor' na página /compras."
    why_human: "Deploy na Vercel aguarda ok visual — padrão estabelecido nas Phases 62/63/65. Nao e gap; e pendencia conhecida de processo."
---

# Phase 66: Compras v2 — Override por Fornecedor Verification Report

**Phase Goal:** A reposicao da `/compras` passa a aceitar params e overrides por fornecedor, inserindo o nivel "fornecedor" na precedencia de `SKU > marca > global` para `SKU > fornecedor > marca > global`. OCs do Tiny gravam `contato.nome` em `purchase_orders.fornecedor`; `replenishment_params` aceita `scope='fornecedor'`; a RPC `get_replenishment_by_sku` resolve params pelo fornecedor de origem (predominante) do SKU; o frontend `/compras` ganha CRUD de params por fornecedor (owner/admin, dropdown).
**Verified:** 2026-06-26T17:51:47Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | OCs sincronizadas do Tiny gravam `fornecedor` (`contato.nome`) em `purchase_orders.fornecedor`; OCs existentes repovoadas via re-sync | VERIFIED | EF `sync-tiny-purchase-orders/index.ts` linha 118: `const fornecedor = (String(det?.contato?.nome ?? h?.contato?.nome ?? "").trim().slice(0,200)) \|\| null;` gravado no upsert. Prod: 200/200 OCs com fornecedor IS NOT NULL (6 fornecedores distintos). |
| SC-2 | `replenishment_params` aceita `scope='fornecedor'` e o CRUD da `/compras` permite criar/editar/remover params por fornecedor (write owner/admin) | VERIFIED | Migration `20260666000000`: constraint `replenishment_params_scope_check` recriada com `ARRAY['global','marca','sku','fornecedor']`. `ReplenishmentParamsDialog.tsx`: `type Scope = "global" \| "marca" \| "sku" \| "fornecedor"`, `z.enum([...,"fornecedor"])`, SelectItem value="fornecedor", guard `canEdit = orgRole === "owner" \|\| orgRole === "admin"`. |
| SC-3 | RPC `get_replenishment_by_sku` aplica precedencia SKU > fornecedor > marca > global: SKU sem param de SKU mas com param de fornecedor usa o do fornecedor | VERIFIED | Migration `20260666000100`: CTE `fornecedor_by_sku` (DISTINCT ON, SUM(quantidade) DESC, MAX(data) DESC), JOIN em `params`, COALESCE 4 niveis em todas as 5 colunas (lead_time, meta_cobertura, safety, moq, pack), ramo CASE `THEN 'fornecedor'`. Prod: 19 linhas com `param_origem='fornecedor'` ao ativar param de teste (ZEBU). |
| SC-4 | Mapeamento SKU→fornecedor definido: fornecedor predominante = maior `SUM(quantidade)` nas OCs do SKU; desempate = OC mais recente; SKU sem OC pula o nivel sem erro | VERIFIED | CTE `fornecedor_by_sku` implementa exatamente D-01/D-02: `ORDER BY sub.sku_code, sub.total_qty DESC, sub.ultima_data DESC NULLS LAST`. `forn.fornecedor` usado DIRETO (sem COALESCE para '') — NULL nao casa com nenhum scope_value, SKU sem OC pula o nivel silenciosamente. Prod: 0 SKUs com >1 fornecedor (mapeamento 1:1). |
| SC-5 | RPC permanece SECURITY INVOKER (anti-IDOR: org alheia = 0 linhas); testes da precedencia verdes; sem regressao de build/testes Phase 63/65 | VERIFIED | Ambas as RPCs: `SECURITY INVOKER` + `REVOKE EXECUTE FROM PUBLIC, anon` + `GRANT EXECUTE TO authenticated`. Testes: 213/213 passando (incluindo 5 novos FORN-05 em `replenishmentUtils.test.ts`). `npx tsc --noEmit`: 0 erros. `npm run build`: ok. Prod: anti-IDOR = 0 linhas para org alheia. |

**Score: 5/5 truths verified**

---

### Must-Have Truths (PLAN 66-03 frontmatter)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| T-1 | `resolveParamsBySku` reflete a precedencia de 4 niveis SKU > fornecedor > marca > global, com testes cobrindo todos os fallbacks | VERIFIED | `replenishmentUtils.ts` linha 126-159: assinatura `(skuRow, fornecedorRow, marcaRow, globalRow, defaults)` com ramo `else if (fornecedorRow != null)`. 5 casos FORN-05 passam. |
| T-2 | `param_origem` no TS inclui 'fornecedor' (hook nao descarta o valor) | VERIFIED | `useReplenishmentBySku.ts` linha 44: `param_origem: "sku" \| "fornecedor" \| "marca" \| "global"`. `mapRow` linha 129: cast inclui `"fornecedor"`. |
| T-3 | Dialogo de Regras de Compra permite escolher escopo 'Por Fornecedor' (owner/admin) com dropdown dos fornecedores distintos das OCs — nao texto livre | VERIFIED | `ReplenishmentParamsDialog.tsx`: quando `scope === "fornecedor"` renderiza `<Select>` (nunca `<Input>`) alimentado por `usePurchaseOrderSuppliers()`. Skeleton durante load; mensagem se lista vazia. |
| T-4 | Suite vitest passa inteira (208 existentes + novos casos), tsc 0 e build ok — sem regressao | VERIFIED | `npx vitest run`: 213/213 Tests passed. `npx tsc --noEmit`: 0 erros. `npm run build`: ok (18.84s). |

---

### Required Artifacts

| Artifact | Expected | Level 1 (Exists) | Level 2 (Substantive) | Level 3 (Wired) | Status |
|----------|----------|-------------------|----------------------|-----------------|--------|
| `supabase/migrations/20260666000000_fornecedor_scope.sql` | Coluna `purchase_orders.fornecedor` + constraint com 'fornecedor' | YES | YES — `ADD COLUMN IF NOT EXISTS fornecedor TEXT` + `CHECK (scope = ANY (ARRAY[...,'fornecedor']))` | YES — aplicada em prod (`ckcdevcxgvueywivefgx`) | VERIFIED |
| `supabase/migrations/20260666000100_get_replenishment_by_sku_fornecedor.sql` | RPC `get_replenishment_by_sku` com CTE fornecedor_by_sku e COALESCE 4 niveis | YES | YES — 338 linhas; CTE completa; COALESCE em 5 colunas; CASE param_origem | YES — aplicada em prod; RPC ativa e validada | VERIFIED |
| `supabase/migrations/20260666000200_get_purchase_order_suppliers_rpc.sql` | RPC `get_purchase_order_suppliers` SECURITY INVOKER | YES | YES — SELECT DISTINCT + REVOKE/GRANT | YES — aplicada em prod; retorna 6 fornecedores | VERIFIED |
| `supabase/functions/sync-tiny-purchase-orders/index.ts` | EF v2 gravando `fornecedor = contato.nome` | YES | YES — linha 118 deriva fornecedor com coerce + fallback + slice(0,200) | YES — deployada v2; campo incluido no insert/upsert | VERIFIED |
| `src/lib/analysis/replenishmentUtils.ts` | `resolveParamsBySku` com `fornecedorRow` como 2o argumento | YES | YES — 5-arg signature linha 126; ramo fornecedor linhas 139-142; tipo paramOrigem inclui 'fornecedor' | YES — importado e testado no .test.ts | VERIFIED |
| `src/hooks/usePurchaseOrderSuppliers.ts` | Hook chamando RPC `get_purchase_order_suppliers` | YES | YES — useQuery com `supabase.rpc("get_purchase_order_suppliers", { p_org_id })`, retorna `string[]` | YES — importado em `ReplenishmentParamsDialog.tsx` linha 31, usado linha 158 | VERIFIED |
| `src/hooks/useReplenishmentBySku.ts` | `param_origem` type inclui 'fornecedor' | YES | YES — interface linha 44, cast linha 129 | YES — usado em `MLCompras.tsx` linha 7 | VERIFIED |
| `src/components/mercadolivre/ReplenishmentParamsDialog.tsx` | CRUD com scope 'fornecedor' + dropdown | YES | YES — type Scope, z.enum, SCOPE_LABELS, scopeColor amber, SelectItem, condicional dropdown/Input | YES — importado em `MLCompras.tsx` linha 12, usado linha 163 | VERIFIED |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `ReplenishmentParamsDialog.tsx` | `usePurchaseOrderSuppliers.ts` | `import { usePurchaseOrderSuppliers }` + uso condicional quando `scope === "fornecedor"` | WIRED | Linha 31 (import), linha 158 (uso). Dropdown renderizado quando scope=fornecedor. |
| `usePurchaseOrderSuppliers.ts` | RPC `get_purchase_order_suppliers` | `supabase.rpc("get_purchase_order_suppliers", { p_org_id: currentOrg.id })` | WIRED | Linha 20-22. `queryKey` inclui `currentOrg.id` como cache-key. |
| `useReplenishmentBySku.ts` | RPC `get_replenishment_by_sku` | `supabase.rpc("get_replenishment_by_sku", { p_org_id, p_sales_window_days, p_demand_multiplier })` | WIRED | `param_origem` cast inclui 'fornecedor' — nao descarta o valor. |
| `MLCompras.tsx` | `ReplenishmentParamsDialog.tsx` | `import { ReplenishmentParamsDialog }` + `<ReplenishmentParamsDialog />` linha 163 | WIRED | Importado linha 12, instanciado linha 163. |
| EF `sync-tiny-purchase-orders` | `purchase_orders.fornecedor` | Campo `fornecedor` incluido no objeto de insert (linha 136 da EF) | WIRED | Linha 136: `fornecedor,` no objeto rows.push({}). |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `usePurchaseOrderSuppliers.ts` | `data: string[]` (nomes de fornecedor) | RPC `get_purchase_order_suppliers` → `SELECT DISTINCT po.fornecedor FROM purchase_orders WHERE org_id = p_org_id` | YES — query real em prod: 6 fornecedores distintos retornados | FLOWING |
| `ReplenishmentParamsDialog.tsx` | `suppliers: string[]` | `usePurchaseOrderSuppliers()` → RPC → `purchase_orders` real | YES — dropdown alimentado por dados reais de OCs | FLOWING |
| `useReplenishmentBySku.ts` | `param_origem: "fornecedor"` | RPC `get_replenishment_by_sku` → CTE `fornecedor_by_sku` → `purchase_orders` real | YES — 19 linhas com `param_origem='fornecedor'` validadas em prod | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `resolveParamsBySku` fornecedor precedence | `npx vitest run --reporter=verbose src/lib/analysis/replenishmentUtils.test.ts` | 20/20 passed (incluindo 5 FORN-05) | PASS |
| Suite completa sem regressao | `npx vitest run` | 213/213 Tests passed, 17 test files | PASS |
| TypeScript zero erros | `npx tsc --noEmit` | 0 erros, saida vazia | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| FORN-01 | 66-01 | EF grava `fornecedor=contato.nome` nas OCs; coluna em `purchase_orders` | SATISFIED | EF v2 + migration `20260666000000` + 200/200 OCs populadas |
| FORN-02 | 66-01 | `replenishment_params` aceita `scope='fornecedor'` | SATISFIED | Constraint recriada com 'fornecedor' na migration `20260666000000` |
| FORN-03 | 66-02 | RPC resolve precedencia SKU>fornecedor>marca>global; mapeamento predominante definido | SATISFIED | Migration `20260666000100` com CTE + COALESCE 4 niveis; validado em prod |
| FORN-04 | 66-03 | Frontend CRUD params por fornecedor, owner/admin, precedencia exibida | SATISFIED | `ReplenishmentParamsDialog` com scope 'fornecedor', dropdown, canEdit guard, precedence text em 2 locais |
| FORN-05 | 66-02/03 | Testes + anti-IDOR SECURITY INVOKER + sem regressao | SATISFIED | 213/213 testes; SECURITY INVOKER em ambas RPCs; REVOKE/GRANT; 0 linhas anti-IDOR; tsc 0; build ok |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/components/mercadolivre/ReplenishmentSkuTable.tsx` | 155-161 | `ParamsTooltip` trata `param_origem` com apenas `=== "sku"` e `=== "marca"` — o ramo `else` exibe badge "global" para qualquer outro valor, incluindo `"fornecedor"` | WARNING | Quando um param de fornecedor esta ativo para um SKU, o tooltip da tabela exibe "global" em vez de "fornecedor". Nao impede o calculo correto (a RPC aplica a precedencia normalmente). Apenas display. `ReplenishmentSkuTable.tsx` nao estava no escopo de `files_modified` do plan 66-03. |

**Notas sobre anti-padroes:**
- O gap de badge e COSMÉTICO: a RPC retorna `param_origem='fornecedor'` corretamente, o hook mapeia corretamente, mas o componente de tabela nao exibe a badge correspondente.
- `ReplenishmentParamsDialog` (o CRUD) exibe o badge ambar correto para scope 'fornecedor' via `scopeColor`.
- Recomendacao: corrigir `ParamsTooltip` em follow-up adicionando o ramo `row.param_origem === "fornecedor"` antes do `else` global.

---

### Human Verification Required

#### 1. Verificacao visual do CRUD por fornecedor no browser

**Test:** Logar como Wesley (owner) em /compras na branch `gsd/phase-66-override-fornecedor` (Vercel preview ou local). Clicar em "Parametros". No dialogo "Regras de Compra": (a) selecionar escopo "Por Fornecedor"; (b) confirmar que o dropdown lista os 6 fornecedores (nao campo de texto livre); (c) criar param com lead_time=99 para um fornecedor; (d) fechar dialogo; (e) verificar que SKUs daquele fornecedor tem `compra_sugerida` diferente.

**Expected:** Dropdown lista 6 nomes de fornecedor; param criado; tabela reflete nova sugestao de compra.

**Why human:** Requer browser logado com JWT da org para ativar a RLS + integracao RPC→hook→UI.

#### 2. Decisao sobre badge "global" no tooltip da tabela

**Test:** Apos criar param de fornecedor (item 1 acima), verificar o tooltip da linha de um SKU afetado na tabela — o badge de origem do param.

**Expected (ideal):** Badge deveria exibir "fornecedor". Comportamento atual: exibe "global" (ramo else em `ReplenishmentSkuTable.tsx` linha 160).

**Why human:** Decisao entre fix-now (adicionar ramo fornecedor no `ParamsTooltip`) ou defer para follow-up. Nao e blocker de funcionalidade — a sugestao de compra esta correta.

#### 3. Merge do PR e deploy Vercel

**Test:** Confirmar que branch `gsd/phase-66-override-fornecedor` tem todos os commits desta fase e aprovar o PR para merge na branch principal.

**Expected:** Vercel prod build ok; `/compras` com escopo "Por Fornecedor" disponivel para todos os usuarios da org.

**Why human:** Deploy na Vercel aguarda ok visual de Wesley — padrao estabelecido nas Phases 62/63/65. Nao e gap de implementacao; e processo de release.

---

### Gaps Summary

Nenhum gap de implementacao bloqueador. Todos os 5 Success Criteria do ROADMAP e os 4 must-haves do PLAN 66-03 estao VERIFIED.

Um item cosmético (WARNING) foi identificado: `ReplenishmentSkuTable.ParamsTooltip` nao renderiza badge "fornecedor" (exibe "global" em seu lugar). Nao impede o funcionamento correto da precedencia — e um gap de display que deve ser corrigido em follow-up. O escopo do plan 66-03 nao incluia `ReplenishmentSkuTable.tsx` em `files_modified`.

A pendencia de deploy Vercel (frontend em branch, nao mergeado) e intencional e segue o padrao das Phases anteriores (62/63/65) — nao e gap de codigo.

---

*Verified: 2026-06-26T17:51:47Z*
*Verifier: Claude (gsd-verifier)*
