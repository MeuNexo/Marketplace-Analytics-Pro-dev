---
phase: 71-modal-de-detalhe-do-an-ncio-shell-indicadores
plan: "01"
subsystem: mercadolivre/anuncios
tags:
  - modal
  - dialog
  - indicadores
  - quality-score
  - logistica
  - tdd
dependency_graph:
  requires:
    - src/contexts/MLInventoryContext.tsx
    - src/hooks/useMLMarginWithAds.ts
    - src/data/financialMockData.ts
    - src/components/ui/dialog
    - src/components/ui/tabs
    - src/components/ui/tooltip
    - src/components/ui/badge
    - src/components/ui/progress
  provides:
    - src/components/mercadolivre/anuncios/listingHelpers.ts
    - src/components/mercadolivre/anuncios/listingIndicators.ts
    - src/components/mercadolivre/anuncios/listingIndicators.test.ts
    - src/components/mercadolivre/anuncios/ListingQualityScore.tsx
    - src/components/mercadolivre/anuncios/ListingIndicatorsTab.tsx
    - src/components/mercadolivre/anuncios/ListingDetailModal.tsx
  affects:
    - Phase 72 (reutiliza ListingQualityScore para health refresh)
    - 71-02-PLAN.md (liga gatilho na página MLAnuncios.tsx)
tech_stack:
  added: []
  patterns:
    - TDD (RED/GREEN com vitest)
    - Dialog controlado (shadcn) max-w-4xl
    - Grid md:grid-cols-5 (esq 2 / dir 3)
    - Módulos puros sem React (listingHelpers, listingIndicators)
    - Margem por prop (sem hook de margem interno)
key_files:
  created:
    - src/components/mercadolivre/anuncios/listingHelpers.ts
    - src/components/mercadolivre/anuncios/listingIndicators.ts
    - src/components/mercadolivre/anuncios/listingIndicators.test.ts
    - src/components/mercadolivre/anuncios/ListingQualityScore.tsx
    - src/components/mercadolivre/anuncios/ListingIndicatorsTab.tsx
    - src/components/mercadolivre/anuncios/ListingDetailModal.tsx
  modified: []
decisions:
  - "Faixas de qualidade (0.8/0.5) espelham exatamente healthBadge em MLAnuncios.tsx para consistência visual"
  - "aggregateLogisticType usa item.logistic_type (variações não têm campo próprio) e retorna array ordenado por stock desc"
  - "DisabledTabTrigger envolve TabsTrigger com span + pointer-events-none para garantir que o Tooltip funcione mesmo com disabled (Radix não propaga onMouseEnter em elementos desabilitados)"
  - "mlListingUrl exportado de listingHelpers.ts usando o mesmo regex da página (MLB→MLB-XXX)"
metrics:
  duration: "~5 minutos"
  completed_date: "2026-06-29"
  tasks_completed: 3
  files_created: 6
  tests_added: 17
status: complete
---

# Phase 71 Plan 01: Modal de Detalhe do Anúncio — Shell + Indicadores — Summary

**Uma linha:** Dialog central `max-w-4xl` com aba Indicadores (quality scoreboard + variações + logística + KPIs) e 4 abas futuras desabilitadas, operando exclusivamente sobre `ProductItem` existente — zero backend, zero fetch, zero dependência nova.

## O que foi construído

6 arquivos novos em `src/components/mercadolivre/anuncios/`:

| Arquivo | Responsabilidade |
|---------|-----------------|
| `listingHelpers.ts` | Helpers puros: `getCommissionRate`, `getListingLabel`, `currencyFmt`, `mlListingUrl` |
| `listingIndicators.ts` | Utilitários puros: `qualityScoreBand`, `aggregateLogisticType`, `logisticTypeLabel` + tipos `QualityBand`, `LogisticBucket` |
| `listingIndicators.test.ts` | 17 testes vitest cobrindo: 4 faixas de quality score, 5 casos de logisticTypeLabel, 5 casos de aggregateLogisticType |
| `ListingQualityScore.tsx` | Scoreboard isolado: % grande + `Progress` + `Badge` colorido por faixa; estado "Sem dado" quando `health=null` |
| `ListingIndicatorsTab.tsx` | Grid `md:grid-cols-5` — esq: thumbnail/variações/logística; dir: scoreboard/KPIs/info do anúncio |
| `ListingDetailModal.tsx` | Shell do modal: Dialog + cabeçalho (título/MLB id/badges/Ver no ML) + Tabs (indicadores ativa + 4 disabled) |

## Tarefas concluídas

| Task | Nome | Commit | Arquivos |
|------|------|--------|----------|
| 1 — RED | Testes unitários (vitest) | cf2a23e8 | listingIndicators.test.ts |
| 1 — GREEN | Utilitários puros | cb47fe38 | listingHelpers.ts, listingIndicators.ts |
| 2 | ListingQualityScore + ListingIndicatorsTab | e4d61089 | ListingQualityScore.tsx, ListingIndicatorsTab.tsx |
| 3 | ListingDetailModal shell | d38712c4 | ListingDetailModal.tsx |

## Resultados da verificação

- `npx vitest run listingIndicators.test.ts` — **17/17 testes verdes**
- `npx tsc --noEmit` — **sem erros**
- `npm run build` — **sucesso (16.80s)**
- Inspeção: **nenhum `fetch`/`supabase`/`useQuery`/`useMLMarginWithAds`** dentro dos componentes ou utilitários (zero rede)
- `rel="noopener noreferrer"` presente no anchor "Ver no ML" (T-71-02 mitigado)

## Desvios do plano

**Nenhum desvio** — plano executado exatamente como especificado.

Nota técnica: `DisabledTabTrigger` envolve o `TabsTrigger disabled` em um `<span>` com `cursor-not-allowed` e `pointer-events-none` na `TabsTrigger`. Isso é necessário porque o Radix UI bloqueia eventos de mouse em elementos desabilitados, o que impediria o `Tooltip` de abrir — o `span` pai captura o evento e o repassa ao Tooltip. Decisão de implementação dentro do escopo de "Claude's Discretion" do CONTEXT.md.

## Itens deferidos

Nenhum stub ou dado fictício. Todos os campos exibidos vêm diretamente de `ProductItem` ou do prop `margin`.

## Threat Surface

| Flag | Arquivo | Descrição |
|------|---------|-----------|
| ✅ T-71-02 mitigado | ListingDetailModal.tsx | `rel="noopener noreferrer"` no anchor "Ver no ML" |

## Self-Check: PASSED

Todos os 6 arquivos existem em disco e todos os 4 commits confirmados no histórico git.
