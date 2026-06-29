# Phase 71: Modal de Detalhe do Anúncio — Shell + Indicadores - Context

**Gathered:** 2026-06-29
**Status:** Ready for planning
**Source:** Brainstorm aprovado → spec `docs/superpowers/specs/2026-06-29-anuncio-detail-modal-design.md` (seção 5 — Fase A)

<domain>
## Phase Boundary

Esta fase entrega APENAS o shell do modal de detalhe + a aba "Indicadores", reusando dados já carregados (zero backend novo). É a Fase A (MVP-first) de um milestone de 6 fases que replica o `ListingDetailModal` do projeto antigo `nexointeligence`.

**Dentro do escopo:**
- Gatilho de abertura na página de catálogo `src/pages/mercadolivre/MLAnuncios.tsx`.
- Componente `ListingDetailModal` (Dialog `max-w-4xl`) com cabeçalho + Tabs.
- Aba "Indicadores" completa com dados de `ProductItem`.
- Abas futuras (Vendas/Precificação/Avaliações/Histórico) presentes mas desabilitadas ("em breve").

**Fora do escopo (Phases 72–76):** galeria completa de fotos, issues detalhados via EF health, gráfico de vendas, calculadora embutida, reviews, ação de IA + histórico de otimização.
</domain>

<decisions>
## Implementation Decisions (LOCKED — do brainstorm)

### Formato
- Modal **central (shadcn `Dialog`)**, `max-w-4xl max-h-[90vh] overflow-y-auto` — fiel ao antigo. NÃO usar Sheet lateral.

### Gatilho de abertura
- Em `MLAnuncios.tsx`: clicar na **miniatura do produto** abre o modal; **e** um ícone 👁 "Ver detalhes" na linha (célula de ações) também abre.
- O comportamento atual de **expandir variações** (`onClick={() => item.has_variations && toggleRow(item.id)}`) e o **link do título** para o ML devem permanecer intactos — usar alvos de clique distintos e `e.stopPropagation()` onde necessário.

### Modelo de dados
- Reusar o tipo `ProductItem` de `src/contexts/MLInventoryContext.tsx` — NÃO criar modelo de dados novo. Campos disponíveis: `id`, `title`, `price`, `available_quantity`, `sold_quantity`, `thumbnail`, `status`, `listing_type_id`, `health` (quality score 0–1), `visits`, `brand`, `logistic_type`, `free_shipping`, `catalog_product_id`, `has_variations`, `variations[]` (cada uma com `attribute_combinations`, `available_quantity`, `sold_quantity`, `price`, `picture_id`, `seller_custom_field`).

### Conteúdo da aba Indicadores
- Layout 2 colunas (grid `md:grid-cols-5`: esquerda 2, direita 3), espelhando o antigo.
- **Esquerda:** imagem (`thumbnail`); lista de variações (atributos + estoque + vendido); breakdown de tipo logístico (agrega `logistic_type` × estoque entre variações; quando só há o item, usa `item.logistic_type`).
- **Direita:** scoreboard de qualidade a partir de `health` (0–1 → %, com badge de faixa bom/médio/ruim e estado "sem dado" quando `null`); KPIs (visitas, vendido, estoque, margem); marca; status; frete grátis; catálogo quando presente.
- **Margem:** reusar os hooks que `MLAnuncios.tsx` JÁ usa — `useMLMarginWithAds` e/ou `useMLProductCosts`/`useMLTaxConfig`. Não introduzir nova fonte de margem.

### Reuso de helpers já existentes em MLAnuncios.tsx
- `getCommissionRate(listingTypeId)`, `getListingLabel(listingTypeId)`, `listingBadge(...)`, `currencyFmt(...)` — reaproveitar para o badge de tipo de anúncio no cabeçalho (extrair para um módulo compartilhado se necessário, sem duplicar lógica).

### Estrutura de arquivos
- Componentes novos isolados em `src/components/mercadolivre/anuncios/` (pasta já existe — `ImportacaoCustos` vive lá):
  - `ListingDetailModal.tsx` — orquestra Dialog + Tabs + cabeçalho + ações ("Ver no ML").
  - `ListingIndicatorsTab.tsx` — conteúdo da aba Indicadores (recebe `item: ProductItem`).
  - `ListingQualityScore.tsx` — scoreboard isolado a partir de `health` (reutilizável pela Phase 72).
- `MLAnuncios.tsx` só ganha: estado `selectedItem`/`open`, o gatilho de abertura e a renderização do `<ListingDetailModal />`. NÃO inflar a página (já tem ~2285 linhas).

### Sem novas dependências
- shadcn/ui já disponível: `Dialog`, `Tabs`, `Tooltip`, `Badge`, `Button`. Ícones via `lucide-react`. Sem libs novas.

### Multi-tenant
- O modal recebe um `ProductItem` já filtrado por org/seller pelo `MLInventoryContext` — não faz fetch próprio nesta fase, então não há risco de cruzar organização.

### Claude's Discretion
- Nomes exatos de props internas, organização do JSX, micro-componentes auxiliares, e onde extrair helpers compartilhados (desde que sem duplicação).
- Conteúdo e cópia exata dos tooltips "em breve".
- Quais utilitários puros valem teste unitário (mínimo: faixa de quality score e agregação de tipo logístico).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Spec do milestone
- `docs/superpowers/specs/2026-06-29-anuncio-detail-modal-design.md` — design completo; seção 5 detalha a Fase A (esta fase).

### Projeto antigo (referência visual/estrutural — NÃO copiar backend)
- Repo: https://github.com/MeuNexo/nexointeligence — `src/components/anuncios/ListingDetailModal.tsx` (estrutura de Dialog + Tabs), `QualityScoreboardMulti.tsx`, `ProductImageGallery.tsx`. Apenas inspiração de layout; os hooks/EFs do antigo NÃO existem no projeto atual.

### Código atual a reusar
- `src/contexts/MLInventoryContext.tsx` — tipo `ProductItem`/`ProductVariation` (fonte de dados).
- `src/pages/mercadolivre/MLAnuncios.tsx` — página de catálogo (gatilho); helpers `getCommissionRate`/`getListingLabel`/`listingBadge`/`currencyFmt`; padrão do `PriceDetailSheet`; hooks de margem (`useMLMarginWithAds`, `useMLProductCosts`, `useMLTaxConfig`).
- `src/components/mercadolivre/anuncios/` — pasta destino (ver `ImportacaoCustos.tsx` como referência de estilo).
</canonical_refs>

<specifics>
## Specific Ideas

- Cabeçalho do modal: título (`line-clamp-1`), MLB id em mono, badge "N variações" quando `variations.length > 1`, badge de tipo de anúncio (Clássico/Premium/Grátis + %), botão "Ver no ML".
- URL do ML: `https://produto.mercadolivre.com.br/${id.replace(/^(MLB)(\d+)$/, '$1-$2')}` (mesmo padrão já usado na linha do título em `MLAnuncios.tsx`).
- Tabs: valor inicial `indicadores`; as outras 4 com `disabled` + `Tooltip` "em breve".
</specifics>

<deferred>
## Deferred Ideas

- Galeria completa de fotos (exige `get_item_details` / fetch de `pictures[]`) — fase futura.
- Issues detalhados, gráfico de vendas, calculadora embutida, reviews, ação de IA + histórico — Phases 72–76.
</deferred>

---

*Phase: 71-modal-de-detalhe-do-an-ncio-shell-indicadores*
*Context gathered: 2026-06-29 via brainstorm + spec*
