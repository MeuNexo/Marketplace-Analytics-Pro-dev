---
phase: 77-pagina-analise-de-anuncios-produtos-vendidos-e-analise-de-pr
plan: "03"
subsystem: routing-and-navigation
tags:
  - routing
  - access-control
  - navigation
  - roleAccess
  - lazy-import
dependency_graph:
  requires:
    - MLProdutosVendidos page (77-02)
    - MLAnalisePrecos page (77-02)
  provides:
    - route /produtos-vendidos (lazy + RoleRoute + ErrorBoundary)
    - route /analise-precos (lazy + RoleRoute + ErrorBoundary)
    - roleAccess entries /produtos-vendidos + /analise-precos = OPERATIONAL
    - ApiSidebar Dashboard group items Produtos Vendidos + Análise de Preços
  affects:
    - Phase 77 deliverable complete — pages navigable from menu
tech_stack:
  added: []
  patterns:
    - "Lazy route + RoleRoute + ErrorBoundary (padrão consolidado App.tsx)"
    - "OPERATIONAL role level = owner/admin/member (mesmo nível que /compras)"
    - "canAccess() default-deny evitado por registro explícito em roleAccess"
    - "Ícones lucide-react distintos: PackageSearch (Produtos) + BarChart2 (Preços)"
key_files:
  created: []
  modified:
    - src/App.tsx
    - src/config/roleAccess.ts
    - src/components/layout/ApiSidebar.tsx
decisions:
  - "Ícone PackageSearch para Produtos Vendidos — ShoppingBag já em uso no grupo Operações (Anúncios), evitar confusão"
  - "Ícone BarChart2 para Análise de Preços — disponível no lucide-react instalado (v1.7.0), sem instalar novo pacote"
  - "Ambas as rotas em OPERATIONAL (owner/admin/member) — nível analítico coerente com /compras e /fluxo-de-caixa"
  - "Não adicionado a VIEWER_ELIGIBLE_ROUTES — viewers permanecem default-deny para análises (coerente com /compras)"
metrics:
  duration: "~3 min"
  completed_date: "2026-07-01"
  tasks_completed: 3
  tasks_total: 3
  files_created: 0
  files_modified: 3
  tests_added: 0
  tests_passing: 0
status: complete
---

# Phase 77 Plan 03: Fiação de Rotas + Controle de Acesso + Menu Summary

Fiação final das duas páginas ao app: lazy imports em App.tsx com RoleRoute+ErrorBoundary, entradas em roleAccess.ts para evitar o default-deny silencioso (pitfall Phase 54), e 2 itens navegáveis no grupo Dashboard do menu lateral.

## One-liner

Lazy routes `/produtos-vendidos` e `/analise-precos` em App.tsx + OPERATIONAL em roleAccess.ts (anti-default-deny) + itens `PackageSearch/BarChart2` no Dashboard do ApiSidebar — zero pacote novo, tsc clean.

## What Was Built

### Task 1: Lazy imports + Routes em App.tsx

**Lazy imports adicionados** (junto de `MLCompras`, linha 40-41 do arquivo):
```tsx
const MLProdutosVendidos = React.lazy(() => import("./pages/mercadolivre/MLProdutosVendidos"));
const MLAnalisePrecos    = React.lazy(() => import("./pages/mercadolivre/MLAnalisePrecos"));
```

**Rotas adicionadas** (após `/compras`, mesmo wrapper `RoleRoute + ErrorBoundary`):
```tsx
<Route path="/produtos-vendidos" element={
  <RoleRoute><ErrorBoundary fallbackTitle="Erro em Produtos Vendidos"><MLProdutosVendidos /></ErrorBoundary></RoleRoute>
} />
<Route path="/analise-precos" element={
  <RoleRoute><ErrorBoundary fallbackTitle="Erro em Análise de Preços"><MLAnalisePrecos /></ErrorBoundary></RoleRoute>
} />
```

Arquivo: `src/App.tsx` — 4 linhas adicionadas, padrão idêntico ao de `/compras`.

### Task 2: Entradas em roleAccess.ts (anti-default-deny)

**Chaves adicionadas** após `/compras: OPERATIONAL`:
```typescript
"/produtos-vendidos": OPERATIONAL,
"/analise-precos": OPERATIONAL,
```

Sem estas entradas, `canAccess()` retorna `false` para qualquer role (default-deny silencioso) e o usuário é redirecionado para /vendas sem mensagem de erro — pitfall confirmado na Phase 54 com `/consultor`.

Não adicionado a `VIEWER_ELIGIBLE_ROUTES` — viewers permanecem sem acesso, coerente com `/compras`.

### Task 3: Itens no grupo Dashboard do ApiSidebar

**Imports adicionados** ao bloco `lucide-react`:
- `BarChart2` — para Análise de Preços
- `PackageSearch` — para Produtos Vendidos

**Itens adicionados** ao array `children` do grupo Dashboard (após "Margem"):
```tsx
{ icon: PackageSearch, label: "Produtos Vendidos",  path: "/produtos-vendidos" },
{ icon: BarChart2,     label: "Análise de Preços",  path: "/analise-precos"   },
```

Ambos os ícones verificados como disponíveis no lucide-react 1.7.0 instalado. `ShoppingBag` não usado (já aparece em Anúncios no grupo Operações).

## Commits

| Hash | Mensagem | Tarefa |
|------|----------|--------|
| `70e2ac24` | feat(77-03): add lazy routes /produtos-vendidos and /analise-precos in App.tsx | Task 1 |
| `ad293b4e` | feat(77-03): register /produtos-vendidos and /analise-precos in roleAccess.ts | Task 2 |
| `d43fe76b` | feat(77-03): add Produtos Vendidos and Análise de Preços to Dashboard menu | Task 3 |

## Verification Results

| Check | Result |
|-------|--------|
| `grep MLProdutosVendidos src/App.tsx` | PASS |
| `grep MLAnalisePrecos src/App.tsx` | PASS |
| `grep 'path="/produtos-vendidos"' src/App.tsx` | PASS |
| `grep 'path="/analise-precos"' src/App.tsx` | PASS |
| `grep '"/produtos-vendidos": OPERATIONAL' roleAccess.ts` | PASS |
| `grep '"/analise-precos": OPERATIONAL' roleAccess.ts` | PASS |
| `grep '"/produtos-vendidos"' ApiSidebar.tsx` | PASS |
| `grep 'Análise de Preços' ApiSidebar.tsx` | PASS |
| `grep 'PackageSearch' ApiSidebar.tsx` | PASS |
| `grep 'BarChart2' ApiSidebar.tsx` | PASS |
| `npx tsc --noEmit` (Task 1) | PASS |
| `npx tsc --noEmit` (Task 2) | PASS |
| `npx tsc --noEmit` (Task 3) | PASS |

## Deviations from Plan

None — plano executado exatamente como escrito. Ícones `PackageSearch` e `BarChart2` usados conforme sugerido pelo PATTERNS.md (ambos disponíveis na versão instalada do lucide-react).

## Known Stubs

None — este plano é puramente fiação de config. Sem lógica de dados, sem UI renderizada, sem placeholders.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: Broken-Access-Control (mitigated) | `src/config/roleAccess.ts` | T-77-07: ambas as rotas registradas como OPERATIONAL — default-deny evitado (canAccess retorna false sem registro) |
| threat_flag: Elevation-of-Privilege (mitigated) | `src/App.tsx` | T-77-08: rotas envolvidas em RoleRoute (checa org role) + ErrorBoundary — padrão consolidado do projeto |

## Self-Check: PASSED

| Item | Status |
|------|--------|
| `src/App.tsx` contains `MLProdutosVendidos` lazy import | FOUND |
| `src/App.tsx` contains `MLAnalisePrecos` lazy import | FOUND |
| `src/App.tsx` contains `path="/produtos-vendidos"` route | FOUND |
| `src/App.tsx` contains `path="/analise-precos"` route | FOUND |
| `src/config/roleAccess.ts` contains `"/produtos-vendidos": OPERATIONAL` | FOUND |
| `src/config/roleAccess.ts` contains `"/analise-precos": OPERATIONAL` | FOUND |
| `src/components/layout/ApiSidebar.tsx` contains `/produtos-vendidos` item | FOUND |
| `src/components/layout/ApiSidebar.tsx` contains `Análise de Preços` label | FOUND |
| Commit `70e2ac24` (App.tsx routes) | FOUND |
| Commit `ad293b4e` (roleAccess entries) | FOUND |
| Commit `d43fe76b` (ApiSidebar items) | FOUND |
| `npx tsc --noEmit` final | PASS |
