---
phase: 71-modal-de-detalhe-do-an-ncio-shell-indicadores
verified: 2026-06-29T13:00:00Z
status: passed
score: 7/7 must-haves verificados
behavior_unverified: 0
overrides_applied: 0
---

# Phase 71: Modal de Detalhe do Anúncio — Shell + Indicadores — Relatório de Verificação

**Objetivo da fase:** O lojista clica num anúncio (miniatura ou ícone "Ver detalhes") na página de catálogo e abre um Dialog central (`max-w-4xl`) com cabeçalho do anúncio e aba Indicadores completa — usando SOMENTE dados já em memória (`ProductItem`), zero chamada de backend nova. As demais abas aparecem desabilitadas com tooltip "em breve".

**Verificado em:** 2026-06-29T13:00:00Z
**Branch:** `gsd/anuncio-detail-modal`
**Re-verificação:** Não — verificação inicial

---

## Resultado Geral

Status: **PASSOU** — todos os 7 Success Criteria verificados com evidência direta no código.

---

## Critérios de Sucesso Observáveis

| #  | SC                                                                                      | Status      | Evidência resumida                                                      |
|----|-----------------------------------------------------------------------------------------|-------------|-------------------------------------------------------------------------|
| 1  | Miniatura E ícone Eye abrem o modal; `toggleRow` e link do título preservados           | VERIFICADO  | Linhas 1371, 1381, 1392, 1595 de `MLAnuncios.tsx`                       |
| 2  | Aba Indicadores: quality score (null→"sem dado"), variações, logística, KPIs — zero rede | VERIFICADO  | `ListingIndicatorsTab.tsx` + `ListingQualityScore.tsx`; grep zero fetch  |
| 3  | Abas Vendas/Precificação/Avaliações/Histórico renderizadas + disabled + tooltip          | VERIFICADO  | `ListingDetailModal.tsx` linhas 152–155, componente `DisabledTabTrigger`|
| 4  | "Ver no ML" → URL `produto.mercadolivre.com.br/MLB-<id>` em nova aba                    | VERIFICADO  | `mlListingUrl()` em `listingHelpers.ts` + `target="_blank"` no modal    |
| 5  | Multi-tenant: modal recebe `ProductItem` já filtrado, zero fetch próprio                | VERIFICADO  | Prop drilling via `selectedItem`/`marginByItem`, nenhum hook novo       |
| 6  | vitest 17/17 PASS + `tsc --noEmit` sem erros + `npm run build` ok                      | VERIFICADO  | Comandos executados — outputs reais abaixo                              |
| 7  | Componentes isolados em `anuncios/`; `MLAnuncios.tsx` só ganhou estado + gatilho + render | VERIFICADO  | 7 arquivos na pasta; página cresceu 14 linhas (~2285 → 2299)           |

**Pontuação: 7/7**

---

## SC1 — Gatilho na miniatura + ícone Eye; toggleRow e link preservados

**Miniatura como gatilho** (`MLAnuncios.tsx` linha 1381):
```tsx
<TableCell className="p-2 cursor-pointer"
  onClick={(e) => { e.stopPropagation(); openDetail(item); }}
  title="Ver detalhes">
```

**Ícone Eye como gatilho** (`MLAnuncios.tsx` linha 1595):
```tsx
<Button ... onClick={(e) => { e.stopPropagation(); openDetail(item); }}
  aria-label="Ver detalhes">
  <Eye className="w-3.5 h-3.5" />
</Button>
```

**toggleRow preservado** (`MLAnuncios.tsx` linha 1371):
```tsx
<TableRow onClick={() => item.has_variations && toggleRow(item.id)}>
```

**Link do título preservado com `stopPropagation`** (`MLAnuncios.tsx` linha 1392):
```tsx
<a href={mlListingUrl(item.id)} target="_blank" rel="noopener noreferrer"
   onClick={(e) => e.stopPropagation()} ...>
```

`e.stopPropagation()` nos dois gatilhos impede que o clique na miniatura e no ícone propague para o `TableRow` (que chama `toggleRow`). Os dois comportamentos coexistem sem conflito.

---

## SC2 — Aba Indicadores sem fetch

**ListingQualityScore.tsx** — recebe `health: number | null`, usa `qualityScoreBand(health)` de módulo puro:
- `health === null` → exibe "—" com Badge "Sem dado"
- `health >= 0.8` → faixa bom (emerald), `>= 0.5` → médio (amber), `< 0.5` → ruim (destructive)

**ListingIndicatorsTab.tsx** — grid `md:grid-cols-5`:
- Coluna esquerda: thumbnail, lista de variações (atributo + estoque + vendido por variação), breakdown de tipo logístico (`aggregateLogisticType`)
- Coluna direita: `<ListingQualityScore health={item.health} />`, KPIs (visitas, vendido, estoque, margem via prop)

**Zero chamadas de rede:** grep sobre todos os 5 novos arquivos não retornou `fetch`, `supabase`, `useQuery`, `useEffect`, `axios`. A margem chega como prop `margin?: ProductMarginWithAds | null`, calculada do `marginByItem` já existente na página (derivado de `useMLMarginWithAds` pré-existente).

---

## SC3 — Abas futuras desabilitadas com tooltip

`ListingDetailModal.tsx` usa o componente interno `DisabledTabTrigger`:
```tsx
<DisabledTabTrigger value="vendas"       label="Vendas"       />
<DisabledTabTrigger value="precificacao" label="Precificação"  />
<DisabledTabTrigger value="avaliacoes"   label="Avaliações"   />
<DisabledTabTrigger value="historico"    label="Histórico"    />
```

`DisabledTabTrigger` envolve `TabsTrigger disabled` em um `<span cursor-not-allowed>` para que o `Tooltip` com "Em breve" funcione mesmo com o elemento Radix desabilitado (Radix bloqueia `onMouseEnter` em elementos `disabled` — o `span` pai captura o evento). Solução correta documentada nas decisões travadas do CONTEXT.md.

---

## SC4 — "Ver no ML" com URL correta

`listingHelpers.ts` linhas 39–41:
```typescript
export function mlListingUrl(id: string): string {
  return `https://produto.mercadolivre.com.br/${id.replace(/^(MLB)(\d+)$/, "$1-$2")}`;
}
```

Saída confirmada via `node`:
- `MLB123456` → `https://produto.mercadolivre.com.br/MLB-123456`
- `MLB999000123` → `https://produto.mercadolivre.com.br/MLB-999000123`

`ListingDetailModal.tsx` linha 113-118:
```tsx
<a href={mlListingUrl(item.id)} target="_blank" rel="noopener noreferrer" tabIndex={0}>
```

`target="_blank"` + `rel="noopener noreferrer"` presentes.

---

## SC5 — Multi-tenant intacto

O modal recebe somente dois props externos:
- `item: ProductItem | null` — vem de `selectedItem` (estado local inicializado via `openDetail(item)` onde `item` já foi filtrado por org/seller pelo `MLInventoryContext`)
- `margin?: ProductMarginWithAds | null` — vem de `marginByItem.get(selectedItem.id)`, mapa derivado do hook `useMLMarginWithAds` já existente, escopo por org

Nenhum fetch, nenhuma query Supabase, nenhum hook novo foi introduzido nos componentes do modal. Não há risco de cross-org.

---

## SC6 — Comandos executados

### vitest

```
 RUN  v3.2.4 /root/garment-glow-test
 ✓ src/components/mercadolivre/anuncios/listingIndicators.test.ts (17 tests) 8ms
 Test Files  1 passed (1)
      Tests  17 passed (17)
   Duration  1.09s
```

**17/17 testes verdes** — cobertura: 7 casos de `qualityScoreBand`, 5 casos de `logisticTypeLabel`, 5 casos de `aggregateLogisticType`.

### tsc --noEmit

```
(sem saída — zero erros)
```

### npm run build

```
✓ 4163 modules transformed.
dist/assets/MLAnuncios-ChBZDbPn.js  93.36 kB │ gzip: 23.61 kB
✓ built in 16.99s
```

Build limpo sem erros ou warnings de compilação.

---

## SC7 — Isolamento de componentes; MLAnuncios.tsx não inflado

**Arquivos em `src/components/mercadolivre/anuncios/`:**
```
ImportacaoCustos.tsx       (pré-existente)
ListingDetailModal.tsx     (novo — Phase 71)
ListingIndicatorsTab.tsx   (novo — Phase 71)
ListingQualityScore.tsx    (novo — Phase 71)
listingHelpers.ts          (novo — Phase 71)
listingIndicators.test.ts  (novo — Phase 71)
listingIndicators.ts       (novo — Phase 71)
```

**MLAnuncios.tsx:** cresceu de ~2285 para 2299 linhas (+14 linhas). O delta inclui exclusivamente:
- 2 `useState` (`detailModalOpen`, `selectedItem`)
- 1 `useCallback` (`openDetail`)
- Gatilho na célula da miniatura (1 `onClick`)
- Ícone Eye com botão (4 linhas)
- Render do `<ListingDetailModal>` (5 linhas)

Toda a lógica do modal, da aba Indicadores e dos utilitários vive nos 6 novos arquivos isolados.

---

## Artefatos Obrigatórios

| Artefato                                           | Status      | Observação                               |
|----------------------------------------------------|-------------|------------------------------------------|
| `src/components/mercadolivre/anuncios/listingHelpers.ts`     | VERIFICADO  | Módulo puro, 4 funções exportadas        |
| `src/components/mercadolivre/anuncios/listingIndicators.ts`  | VERIFICADO  | Módulo puro, 3 funções + 2 tipos         |
| `src/components/mercadolivre/anuncios/listingIndicators.test.ts` | VERIFICADO | 17 testes, todos passando           |
| `src/components/mercadolivre/anuncios/ListingQualityScore.tsx` | VERIFICADO | Scoreboard isolado, estado sem_dado     |
| `src/components/mercadolivre/anuncios/ListingIndicatorsTab.tsx` | VERIFICADO | Grid 5 colunas, sem fetch              |
| `src/components/mercadolivre/anuncios/ListingDetailModal.tsx` | VERIFICADO | Dialog + Tabs + 4 abas disabled         |
| `src/pages/mercadolivre/MLAnuncios.tsx`            | VERIFICADO  | +14 linhas apenas (estado+gatilho+render)|

---

## Anti-padrões

Nenhum `TODO`, `FIXME`, `TBD` ou `XXX` encontrado nos novos arquivos.
Nenhum componente retorna `null` ou `[]` como stub — todos os campos renderizados provêm diretamente de `ProductItem`.
`rel="noopener noreferrer"` presente no link externo "Ver no ML" (mitigação de segurança T-71-02 confirmada).

---

## Links Chave Verificados

| De                        | Para                             | Via                                           | Status      |
|---------------------------|----------------------------------|-----------------------------------------------|-------------|
| `MLAnuncios.tsx`          | `ListingDetailModal`             | import + render com `item={selectedItem}`      | WIRED       |
| `ListingDetailModal`      | `ListingIndicatorsTab`           | import + `<ListingIndicatorsTab item={item} margin={margin} />` | WIRED |
| `ListingDetailModal`      | `listingHelpers.ts`              | import `getCommissionRate`, `getListingLabel`, `mlListingUrl` | WIRED |
| `ListingIndicatorsTab`    | `ListingQualityScore`            | import + `<ListingQualityScore health={item.health} />` | WIRED |
| `ListingIndicatorsTab`    | `listingIndicators.ts`           | import `aggregateLogisticType`, `logisticTypeLabel` | WIRED |
| `ListingQualityScore`     | `listingIndicators.ts`           | import `qualityScoreBand`                     | WIRED       |
| `MLAnuncios.tsx`          | `listingHelpers.ts`              | import (centralizado — 3 ocorrências de regex inline removidas) | WIRED |

---

## Commits da Fase

| Commit     | Descrição                                                              |
|------------|------------------------------------------------------------------------|
| `cf2a23e8` | test(71-01): testes RED para `listingIndicators` (TDD)                 |
| `cb47fe38` | feat(71-01): `listingHelpers` + `listingIndicators` utils GREEN         |
| `e4d61089` | feat(71-01): `ListingQualityScore` + `ListingIndicatorsTab`            |
| `d38712c4` | feat(71-01): `ListingDetailModal` shell                                |
| `3a1e995f` | refactor(71-02): centralizar helpers em `listingHelpers.ts`            |
| `4fc75a21` | feat(71-02): integrar modal em `MLAnuncios.tsx` (miniatura + ícone Eye)|

Todos os 6 commits presentes no histórico git da branch `gsd/anuncio-detail-modal`.

---

## Verificação de Requisitos

| Requisito | Descrição                                | Status      | Evidência                                   |
|-----------|------------------------------------------|-------------|---------------------------------------------|
| ADM-71    | Porte do `ListingDetailModal`, Fase A    | SATISFEITO  | 7/7 SCs verificados; zero backend novo      |

---

_Verificado em: 2026-06-29T13:00:00Z_
_Verificador: Claude (gsd-verifier)_
