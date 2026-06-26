---
phase: 66-compras-v2-override-por-fornecedor
plan: "03"
subsystem: frontend-replenishment
tags: [replenishment, fornecedor, tdd, typescript, react, shadcn-ui]
status: complete

dependency_graph:
  requires: ["66-02"]
  provides: ["resolveParamsBySku-4-levels", "usePurchaseOrderSuppliers", "ReplenishmentParamsDialog-fornecedor-scope"]
  affects: ["src/lib/analysis/replenishmentUtils.ts", "src/hooks/useReplenishmentBySku.ts", "src/components/mercadolivre/ReplenishmentParamsDialog.tsx"]

tech_stack:
  added: []
  patterns:
    - "TDD RED/GREEN: test commit before implementation"
    - "4-level parameter precedence SKU>fornecedor>marca>global (espelho TS da RPC)"
    - "Dropdown obrigatório para fornecedor via usePurchaseOrderSuppliers (anti-Pitfall1)"
    - "SECURITY INVOKER RPC get_purchase_order_suppliers scoped por org"

key_files:
  created:
    - src/hooks/usePurchaseOrderSuppliers.ts
  modified:
    - src/lib/analysis/replenishmentUtils.ts
    - src/lib/analysis/replenishmentUtils.test.ts
    - src/hooks/useReplenishmentBySku.ts
    - src/components/mercadolivre/ReplenishmentParamsDialog.tsx

decisions:
  - "Dropdown obrigatório (não Input livre) para scope_value quando scope=fornecedor — match exato com purchase_orders.fornecedor, evita Pitfall 1 (T-66-08)"
  - "fornecedorRow inserido como 2º argumento na assinatura de resolveParamsBySku (entre skuRow e marcaRow) — mantém retrocompatibilidade com null"
  - "Skeleton durante load de suppliers, mensagem se lista vazia orientando re-sync (D-11)"
  - "scopeColor âmbar para badge fornecedor no ParamRow"

metrics:
  duration: "~10 min"
  completed: "2026-06-26"
  tasks_completed: 3
  files_changed: 5
---

# Phase 66 Plan 03: Frontend 4-level Precedence + Dropdown Fornecedor Summary

**One-liner:** Frontend do override por fornecedor: `resolveParamsBySku` com 5 args (SKU>fornecedor>marca>global), hook `usePurchaseOrderSuppliers` via RPC, e dropdown em `ReplenishmentParamsDialog` — FORN-04 e FORN-05 fechados.

## What Was Built

### Task 1: resolveParamsBySku — 4º nível fornecedor (TDD)

**RED (28f618d4):** Atualização do arquivo de testes:
- 5 chamadas existentes migradas para nova aridade (inserindo `null` como 2º arg)
- 5 novos casos FORN-05 adicionados cobrindo todos os fallbacks do nível fornecedor
- Resultado: 6 tests falhando conforme esperado (RED gate)

**GREEN (d77d9cac):** Implementação em `replenishmentUtils.ts`:
- `resolveParamsBySku` ganha `fornecedorRow: Partial<ReplenishmentParams> | null` como 2º parâmetro
- Ramo `else if (fornecedorRow != null) { origem = "fornecedor"; source = fornecedorRow; }` inserido entre `skuRow` e `marcaRow`
- `ReplenishmentResult.paramOrigem` atualizado: `"sku" | "fornecedor" | "marca" | "global"`
- JSDoc atualizado para refletir precedência de 4 níveis (D-08)
- Resultado: todos os 20 testes passando (GREEN gate)

### Task 2: Hook usePurchaseOrderSuppliers + tipo param_origem (50eddf26)

**`src/hooks/usePurchaseOrderSuppliers.ts` (NOVO):**
- Named export `usePurchaseOrderSuppliers` usando `useQuery`
- `queryKey: ["get_purchase_order_suppliers", currentOrg?.id]`
- `queryFn` chama `supabase.rpc("get_purchase_order_suppliers", { p_org_id: currentOrg.id })`
- Lança erro se RPC falhar; retorna `string[]` com nomes dos fornecedores
- `enabled: !!currentOrg?.id`, `staleTime: 5 * 60 * 1000`

**`src/hooks/useReplenishmentBySku.ts` (CORRIGIDO):**
- Interface `ReplenishmentSkuRow.param_origem`: `"sku" | "fornecedor" | "marca" | "global"` (Pitfall 5)
- Cast em `mapRow`: incluído `"fornecedor"` na união — hook não descarta valor retornado pela RPC

### Task 3: ReplenishmentParamsDialog — escopo fornecedor com dropdown (588df949)

**Extensões em `ReplenishmentParamsDialog.tsx`:**
- `type Scope` → `"global" | "marca" | "sku" | "fornecedor"`
- `z.enum([...])` → inclui `"fornecedor"`
- `SCOPE_LABELS` → `fornecedor: "Por Fornecedor"`
- `scopeValueLabel("fornecedor")` → `"Fornecedor (das ordens de compra)"`
- `scopeColor` → badge âmbar para `fornecedor` no `ParamRow`
- `SelectItem value="fornecedor"` adicionado ao select de escopo
- Quando `scope === "fornecedor"`: renderiza `<Select>` (nunca `<Input>`) alimentado por `usePurchaseOrderSuppliers`
  - Loading → `<Skeleton className="h-8 w-full" />`
  - Lista vazia → mensagem "Nenhum fornecedor encontrado... Sincronize as OCs primeiro em Compras" (D-11)
  - Lista preenchida → dropdown com todos os fornecedores; `setValue("scope_value", v)` garante gravação exata
- Texto de precedência atualizado: "Por SKU supera Por Fornecedor, que supera Por Marca, que supera Global" (em 2 locais)
- `canEdit` (owner/admin) reutilizado sem mudança de permissão

## Verification Results

| Gate | Result |
|------|--------|
| `npx vitest run` (suíte inteira) | 213/213 passed (208 existentes + 5 novos FORN-05) |
| `npx tsc --noEmit` | 0 erros |
| `npm run build` | ok (✓ built in 18.84s) |
| TDD RED gate (test commit antes de implementação) | 28f618d4 |
| TDD GREEN gate (feat commit após testes passarem) | d77d9cac |

## Requirements Covered

- **FORN-04:** CRUD de params por fornecedor (owner/admin) com dropdown dos fornecedores distintos das OCs; precedência visível na UI. ✅
- **FORN-05 (frontend):** `resolveParamsBySku` de 4 níveis testado (todos os fallbacks) + suíte/tsc/build sem regressão. ✅

## Deviations from Plan

None — plano executado exatamente como escrito.

## Known Stubs

None. O dropdown de fornecedores estará vazio até que a EF `sync-tiny-purchase-orders` seja deployada e re-sync executado (responsabilidade do orquestrador, não desta plan). A mensagem de lista vazia já orienta o usuário corretamente (D-11).

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: no-new-surface | — | Nenhuma nova superfície de rede introduzida além da RPC já existente `get_purchase_order_suppliers` (deployada em 66-02 com SECURITY INVOKER + escopo org) |

## TDD Gate Compliance

- RED commit: `28f618d4` (test(66-03): RED - resolveParamsBySku 4-level precedence tests)
- GREEN commit: `d77d9cac` (feat(66-03): resolveParamsBySku 4-level precedence SKU>fornecedor>marca>global)
- REFACTOR: não necessário (código limpo na primeira iteração)

## Self-Check: PASSED

- `src/hooks/usePurchaseOrderSuppliers.ts`: FOUND
- `src/lib/analysis/replenishmentUtils.ts` (fornecedorRow): FOUND
- `src/components/mercadolivre/ReplenishmentParamsDialog.tsx` (fornecedor scope): FOUND
- commits 28f618d4, d77d9cac, 50eddf26, 588df949: FOUND
