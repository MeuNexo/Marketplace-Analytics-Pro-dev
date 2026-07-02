---
phase: 71-modal-de-detalhe-do-an-ncio-shell-indicadores
plan: "02"
subsystem: mercadolivre/anuncios
tags:
  - modal
  - dialog
  - gatilho
  - refactor
  - helpers
dependency_graph:
  requires:
    - src/components/mercadolivre/anuncios/ListingDetailModal.tsx
    - src/components/mercadolivre/anuncios/listingHelpers.ts
    - src/hooks/useMLMarginWithAds.ts
    - src/contexts/MLInventoryContext.tsx
  provides:
    - src/pages/mercadolivre/MLAnuncios.tsx (estado + gatilhos + render do modal)
  affects:
    - Phases 72–76 (modal já acessível, gatilho funcionando)
tech_stack:
  added: []
  patterns:
    - Estado controlado (selectedItem/detailModalOpen espelha priceSheetItem)
    - Gatilho de clique com stopPropagation (miniatura + ícone Eye)
    - Prop drilling de margem (marginByItem.get() — zero novo fetch)
    - Import de módulo compartilhado (listingHelpers.ts — sem duplicação)
key_files:
  created: []
  modified:
    - src/pages/mercadolivre/MLAnuncios.tsx
decisions:
  - "Ícone Eye posicionado ao lado do botão Análise (view preco) — a miniatura funciona em ambas as views"
  - "listingBadge (dead code — nunca chamada na página) removida junto aos helpers locais"
  - "URL regex inline substituída por mlListingUrl() nos 3 sites da página para consistência"
  - "margin passada como undefined quando selectedItem é null (aceito por ListingDetailModalProps margin?)"
metrics:
  duration: "~10 minutos"
  completed_date: "2026-06-29"
  tasks_completed: 2
  files_created: 0
  files_modified: 1
status: complete
---

# Phase 71 Plan 02: Modal de Detalhe do Anúncio — Integração na Página de Catálogo — Summary

**Uma linha:** `MLAnuncios.tsx` ganha estado `selectedItem/detailModalOpen`, dois gatilhos (miniatura + ícone Eye) com `stopPropagation`, render de `<ListingDetailModal>` com margem reusada do `marginByItem`, e helpers de listing centralizados em `listingHelpers.ts` — sem duplicação, sem novo fetch, sem nova dependência.

## O que foi construído

Apenas `src/pages/mercadolivre/MLAnuncios.tsx` foi modificado, em duas passagens:

### Task 1 — Refactor de helpers

| Mudança | Antes | Depois |
|---------|-------|--------|
| Import `LISTING_TYPE_RATES` | `import { LISTING_TYPE_RATES } from "@/data/financialMockData"` | Removido |
| Helpers locais | `getCommissionRate`, `getListingLabel`, `currencyFmt`, `listingBadge` definidos na página | Removidos |
| Import compartilhado | — | `import { getCommissionRate, getListingLabel, currencyFmt, mlListingUrl } from "@/components/mercadolivre/anuncios/listingHelpers"` |
| URL regex inline | 3 ocorrências de `` `https://produto.mercadolivre.com.br/${id.replace(...)}` `` | `mlListingUrl(id)` / `mlListingUrl(r.id)` |

### Task 2 — Estado + gatilhos + render

| Elemento | Descrição |
|----------|-----------|
| Import `ProductItem` | Adicionado ao import de tipo de `MLInventoryContext` |
| Import `Eye` | Adicionado ao import de `lucide-react` |
| Import `ListingDetailModal` | `import { ListingDetailModal } from "@/components/mercadolivre/anuncios/ListingDetailModal"` |
| Estado | `const [detailModalOpen, setDetailModalOpen] = useState(false)` + `const [selectedItem, setSelectedItem] = useState<ProductItem \| null>(null)` |
| Handler | `const openDetail = useCallback((item: ProductItem) => { setSelectedItem(item); setDetailModalOpen(true); }, [])` |
| Gatilho 1 — miniatura | Célula da miniatura: `cursor-pointer` + `onClick={(e) => { e.stopPropagation(); openDetail(item); }}` |
| Gatilho 2 — ícone Eye | Botão ghost `<Eye>` ao lado do botão "Análise" na coluna Análise (view preco), com `stopPropagation` |
| Render modal | `<ListingDetailModal item={selectedItem} open={detailModalOpen} onOpenChange={setDetailModalOpen} margin={selectedItem ? marginByItem.get(selectedItem.id) : undefined} />` após `<PriceDetailSheet>` |

## Tarefas concluídas

| Task | Nome | Commit | Arquivos |
|------|------|--------|----------|
| 1 | Refatorar helpers de listing para o módulo compartilhado | 3a1e995f | MLAnuncios.tsx |
| 2 | Estado + gatilho (miniatura + ícone) + render do ListingDetailModal | 4fc75a21 | MLAnuncios.tsx |

## Resultados da verificação

- `npx tsc --noEmit` após Task 1 — **sem erros**
- `npx tsc --noEmit` após Task 2 — **sem erros**
- `npm run build` após Task 2 — **sucesso (17.54s)**
- Inspeção do diff: `toggleRow` e anchor do título inalterados; `openDetail` chamado com `e.stopPropagation()` nos dois gatilhos; `<ListingDetailModal>` renderizado com `margin={marginByItem.get(selectedItem.id)}` — zero novo fetch

## Desvios do plano

**Desvio (em escopo — limpeza de dead code):**

A função `listingBadge` foi removida junto com os outros helpers locais. Ela estava definida na página (linha 85) mas nunca era chamada em nenhum ponto do JSX — era dead code. Como o plano autorizava remoção das definições locais de helpers e `listingBadge` dependia de `getListingLabel`/`getCommissionRate` (que estavam sendo removidos), a remoção foi a decisão de limpeza correta. Não há perda de funcionalidade.

**Desvio menor (melhoria de consistência):**

Além do regex na linha 1400 (citado no plano como "opcional"), também foram substituídas 2 outras ocorrências de regex inline de URL do ML nas tabelas de ranking (linhas 1950 e 2222). O plano dizia "opcionalmente" — foi feito para consistência total.

## Itens deferidos

Nenhum stub. O modal abre com dados reais de `ProductItem` e `marginByItem` já calculados pela página.

## Threat Surface

Nenhum novo endpoint, nenhuma nova chamada de rede. O `ProductItem` e `margin` chegam ao modal já escopados por org/seller pelo `MLInventoryContext` e `useMLMarginWithAds` — T-71-04 mitigado por design (prop drilling sem novo fetch).

## Self-Check: PASSED

Todos os 2 commits existem no histórico git:
- `3a1e995f` — refactor(71-02): centralizar helpers de listing em listingHelpers.ts
- `4fc75a21` — feat(71-02): integrar ListingDetailModal na página de catálogo (miniatura + ícone Eye)

O arquivo `src/pages/mercadolivre/MLAnuncios.tsx` foi modificado com sucesso em ambas as passagens.
