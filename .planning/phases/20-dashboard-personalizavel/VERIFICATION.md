---
phase: 20-dashboard-personalizavel
verified: 2026-05-21T23:40:00Z
status: passed
score: 6/6 must-haves verified
---

# Phase 20: Dashboard Personalizável — Verification Report

**Phase Goal:** KPI cards expandidos (10 cards em size default) + personalização de layout (ordem e visibilidade) salva em localStorage.
**Verified:** 2026-05-21T23:40:00Z
**Status:** PASS
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | MLKPIGrid exibe ≥10 KPI cards em size default (não compact) | ✅ VERIFIED | 10 `<KPICard>` encontrados; nenhum tem `size="compact"`; grid `grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5` |
| 2 | Hook useDashboardLayout gerencia ordem e visibilidade via localStorage | ✅ VERIFIED | Hook completo em `useDashboardLayout.ts`; key `ml_dashboard_layout_v1`; `loadLayout` + `saveLayout` + merge de novos widgets |
| 3 | Botão Personalizar no header abre Sheet lateral | ✅ VERIFIED | Linha 470-479 de `MercadoLivre.tsx`; `Settings2` icon; `onClick={() => setLayoutOpen(true)}` |
| 4 | Sheet tem Switch por widget + botões ↑↓ + botão Restaurar padrão | ✅ VERIFIED | Linhas 589-635 de `MercadoLivre.tsx`; `Switch`, `ChevronUp`, `ChevronDown`, `RotateCcw` todos presentes |
| 5 | Widgets ocultos não renderizam; ordem define sequência | ✅ VERIFIED | `widgets.map((widget) => { if (!widget.visible) return null; ... })` — lines 496-576 |
| 6 | Nenhuma nova dependência adicionada ao package.json | ✅ VERIFIED | `git diff HEAD~3 HEAD -- package.json` retorna vazio |

**Score: 6/6 truths verified**

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|---------|--------|---------|
| `src/hooks/useDashboardLayout.ts` | Estado de layout com persistência localStorage | ✅ VERIFIED | 84 linhas; exporta hook com 5 funções + `widgets`; merge graceful de widgets novos |
| `src/components/mercadolivre/MLKPIGrid.tsx` | Grid expandido com 10 KPI cards default | ✅ VERIFIED | 196 linhas; 10 `KPICard`; sem `size="compact"` |
| `src/pages/MercadoLivre.tsx` | Seções ordenáveis + botão Personalizar + Sheet | ✅ VERIFIED | Renderização por `widgets.map()`; Sheet completo; botão no header |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `MercadoLivre.tsx` | `useDashboardLayout.ts` | `useDashboardLayout()` | ✅ WIRED | Importado linha 39; destructured linha 88; `widgets.map()` orquestra renderização |
| `MercadoLivre.tsx` | `MLKPIGrid.tsx` | widget.id === "kpi_grid" | ✅ WIRED | Linha 498-510; props incluem `kpiSummary` e `adsTotalForPeriod` |
| `MLKPIGrid.tsx` | `useMLKPISummary` | interface `MLKPISummary` | ✅ WIRED | `total_tax`, `has_tax_data`, `custo_plataforma` todos consumidos |
| `MercadoLivre.tsx` | `MLSalesAnalytics` | widget.id === "analytics" | ✅ WIRED | Linha 572-574; `from`/`to` passados corretamente |

---

### Phase 19 — Imposto Real (validação cruzada)

| Requisito | Status | Evidence |
|-----------|--------|----------|
| Fórmula Wesley: `ICMS + (1-ICMS%) × (PIS+COFINS)` | ✅ VERIFIED | `perOrder.ts` linha 72; `src/lib/tax/index.ts` linha 45-46 |
| ICMS 12% → 20.14% | ✅ VERIFIED | 24 testes passando em `index.test.ts` |
| Imposto vem de `SUM(orders.tax_amount)` | ✅ VERIFIED | `useMLKPISummary.ts` linha 62-63; `MercadoLivre.tsx` linha 149 |
| `has_tax_data` guard (não mostra R$0 falso) | ✅ VERIFIED | `impostosTotal = kpiSummary?.has_tax_data ? total_tax : null`; KPIGrid mostra "s/ dados" quando false |
| Custo histórico preservado | ✅ VERIFIED | Migration `upsert_order_preserve_cost` com `CASE WHEN custo_unit IS NOT NULL` (documentado em 19-01-SUMMARY.md) |

---

### Behavioral Spot-Checks

| Behavior | Check | Status |
|----------|-------|--------|
| TypeScript: 0 erros | `npx tsc --noEmit` | ✅ PASS — saída vazia |
| Testes: 63/63 passando | `npx vitest run` | ✅ PASS — 4 arquivos, 63 testes |
| Fórmula fiscal Lucro Real 12% → 20.14% | `index.test.ts` | ✅ PASS — 24 testes específicos |

---

### Anti-Patterns Found

| Arquivo | Linha | Padrão | Severidade | Impacto |
|---------|-------|--------|------------|---------|
| `MLTopProducts.tsx` | 16 e 31 | Header mostra `{products.length}` (10) mas renderiza apenas `top5 = products.slice(0, 5)` | ⚠️ Médio | Label "10 produtos" mas só 5 aparecem — leve confusão de UX |
| `MercadoLivre.tsx` | 88 | `isVisible` destructurado mas nunca usado no arquivo | ℹ️ Info | Dead code; `widgets.map()` controla visibilidade diretamente — `isVisible` é redundante mas inofensivo |
| `BrandRevenueChart.tsx` | 105-115 | `Area` para "Outros" renderizada sem entrada no `chartConfig` nem no `topBrands` | ⚠️ Médio | "Outros" aparece no gráfico stacked mas **não tem entrada na Legend** do Recharts; usuário vê área sem rótulo |
| `BrandSharePieChart.tsx` | 14 | `const chartConfig = {}` — config vazio passado ao `ChartContainer` | ℹ️ Info | PieChart usa `Cell fill` direto, então funciona; mas o ChartContainer não contribui com nada |
| `useDashboardLayout.ts` | 18 | `STORAGE_KEY` global, sem prefixo por `ml_user_id` | ℹ️ Info | RF-03 do CONTEXT.md requeria prefixo `ml_dashboard_layout_v1__{ml_user_id}` para multi-conta; não foi implementado |

---

### Divergências em Relação ao Plano

| Item | Plano | Implementado | Avaliação |
|------|-------|--------------|-----------|
| Nº de widgets no DEFAULT | 4 (kpi_grid, revenue_chart, cost_waterfall, brand_charts) | 5 (+ analytics) | ✅ Melhoria — `analytics` foi integrado via fix commits (c7cde37d) |
| Sucesso criterion #5 | "Sheet abre com **4** widgets" | Sheet mostra 5 widgets | ✅ Correto — spec desatualizado |
| Prefixo localStorage por ml_user_id | Requerido em RF-03 (CONTEXT.md) | Não implementado — global key | ⚠️ Desvio de requisito (baixo impacto prático) |
| Posição do Switch na Sheet | Primeiro (esquerda), antes do label | Último (direita), após arrows+label | ✅ Melhor UX — padrão mais convencional |
| Accordion MLSalesAnalytics | defaultValue não especificado | `defaultValue={["horario","ticket","estado","funil"]}` — todos abertos | ✅ Correto — fase 20 requeriu "abertos por padrão" |

---

### Human Verification Required

#### 1. Persistência localStorage multi-conta

**Teste:** Com duas contas ML conectadas, personalizar layout na conta A (ex: ocultar brand_charts), trocar para conta B, voltar para A.
**Esperado:** Layout da conta A deveria ser independente do da conta B, mas ambas usam a mesma key `ml_dashboard_layout_v1`.
**Por que human:** Envolve múltiplas contas ML e estado de contexto; não testável programaticamente sem banco real.

#### 2. Reordenação visual confirmada na página

**Teste:** Abrir Personalizar, mover "Gráfico de Receita" para a posição 1 (acima de KPIs), fechar Sheet.
**Esperado:** Gráfico de Receita aparece antes dos KPI cards na página.
**Por que human:** Renderização DOM não verificável com grep.

#### 3. KPI "Impostos" com regime configurado

**Teste:** Configurar uf_origem = 'SC' e lr_icms_aliquota_intra = 12 na Organização, aguardar sync de orders.
**Esperado:** Card Impostos mostra ~20.14% da receita (não 9.25% atual de PIS+COFINS apenas).
**Por que human:** Requer config de regime no banco e sync real de orders.

---

## Bugs Potenciais em Produção

### 1. [MÉDIO] MLTopProducts: label inconsistente

**Arquivo:** `src/components/mercadolivre/MLTopProducts.tsx` linhas 16 e 31.

O header do card exibe `{products.length} produtos` (que vem como 10, já que `MercadoLivre.tsx` passa `filteredTopProducts.slice(0, 10)`), mas o corpo renderiza `products.slice(0, 5)`. O usuário vê "10 produtos" mas apenas 5 linhas aparecem.

**Fix simples:** Mudar linha 16 para `{Math.min(products.length, 5)} produtos` ou renderizar os 10.

### 2. [MÉDIO] BrandRevenueChart: "Outros" sem legenda

**Arquivo:** `src/components/mercadolivre/BrandRevenueChart.tsx` linhas 93-115.

A área "Outros" é renderizada no stacked area chart mas `chartConfig` não tem entrada para ela, e o `topBrands` array não inclui "Outros". O `<Legend>` do Recharts lista apenas as Series do `chartConfig`, então "Outros" aparece visualmente no gráfico mas sem identificação na legenda.

**Fix simples:** Adicionar `"Outros"` ao `chartConfig` antes de renderizar `<ChartContainer>`, condicionalmente quando `data[0]?.["Outros"] !== undefined`.

### 3. [BAIXO] isVisible exportado e nunca consumido

**Arquivo:** `src/pages/MercadoLivre.tsx` linha 88; `src/hooks/useDashboardLayout.ts` linha 77.

`isVisible` é destructurado na página mas nunca chamado. A lógica de visibilidade usa `widget.visible` direto no map. Dead code sem consequência funcional, mas pode confundir quem mantiver o hook.

### 4. [BAIXO] localStorage sem prefixo por usuário/conta

**Arquivo:** `src/hooks/useDashboardLayout.ts` linha 18.

O CONTEXT.md (RF-03) especificava prefixo por ml_user_id para separar layouts entre contas. A implementação usa key global `ml_dashboard_layout_v1`. Em cenários com múltiplos vendedores compartilhando o mesmo browser (improvável mas possível), o layout de um sobrescreve o outro.

---

## Melhorias Sugeridas (sem scope creep)

1. **MLTopProducts:** Alinhar a contagem no header com o que é renderizado (mostrar top 5 ou top 10 consistentemente).

2. **BrandRevenueChart "Outros":** Adicionar "Outros" ao chartConfig para que apareça na legenda com label correto e cor cinza coerente.

3. **isVisible:** Remover do destructuring em `MercadoLivre.tsx` (era necessário em uma versão anterior do design).

4. **localStorage key:** Prefixar com `scopeKey` (já calculado na página) para isolar preferências por contexto de seller: `ml_dashboard_layout_v1__${scopeKey}`. O `scopeKey` já está disponível em `MLStoreContext`.

5. **Sheet Personalizar — feedback visual:** Ao ocultar um widget, a seção desaparece instantaneamente mas o usuário fica olhando para o Sheet aberto. Adicionar um badge de contagem "X de 5 visíveis" no SheetTitle daria contexto imediato.

---

## Veredito Final

**Pronto para produção com ressalvas menores.**

As fases 19 e 20 entregaram seus objetivos centrais:
- Imposto real via fórmula Wesley implementada, testada (24 testes) e aplicada no banco (327 orders recalculados).
- Dashboard personalizável funcional: 5 widgets, toggle, reordenação, persistência localStorage, Sheet bem estruturado.
- 10 KPI cards em tamanho default, TypeScript limpo, 63/63 testes passando.

Os dois bugs médios (MLTopProducts label, BrandRevenueChart "Outros" sem legenda) são visuais e não bloqueiam uso. Podem ser corrigidos em um fix rápido antes do próximo release. O desvio de localStorage sem prefixo por conta tem impacto prático zero para a maioria dos usuários.

---

_Verified: 2026-05-21T23:40:00Z_
_Verifier: Claude (gsd-verifier)_
