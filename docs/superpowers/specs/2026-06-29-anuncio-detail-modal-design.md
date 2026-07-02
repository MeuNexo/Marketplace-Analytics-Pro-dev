# Design — Modal de Detalhe do Anúncio (Milestone)

**Data:** 2026-06-29
**Status:** aprovado (brainstorm) — aguardando plano
**Origem:** porte da feature `ListingDetailModal` do projeto antigo `nexointeligence` (https://github.com/MeuNexo/nexointeligence) para o dashboard atual `garment-glow-test`.

---

## 1. Problema / Objetivo

No projeto antigo, a página `/anuncios` permitia **clicar num anúncio e abrir um modal rico** (`ListingDetailModal`) com diagnóstico completo e ações sobre aquele anúncio (5 abas + ação de IA). O dashboard atual (`MLAnuncios.tsx`) lista os anúncios numa tabela com linhas expansíveis, mas **não tem** esse detalhe por anúncio: clicar no título só abre o ML e clicar no preço abre apenas um `PriceDetailSheet` (breakdown de margem).

**Objetivo:** replicar o espírito completo do modal antigo ("info + ações por anúncio") no dashboard atual, respeitando a arquitetura org-first/multi-tenant e a filosofia de **ações com aprovação** já adotada no projeto (Phase 54 — fila de ações do Consultor).

## 2. Diagnóstico de gap (antigo → atual)

O modal antigo tinha 5 abas + ação de IA, cada uma com seu backend:

| Aba (antigo) | Backend que exigia | Existe no atual? |
|--------------|--------------------|------------------|
| Indicadores (quality score, galeria, variações, tipo logístico, issues) | `fetch-ml-listing-health` | **Parcial** — `ProductItem.health` + variações/logístico já sincronizam; issues detalhados não |
| Precificação (calculadora) | só frontend | **Sim** — já existe `MLPrecificacao` + hooks de preço/custo |
| Avaliações (reviews) | `fetch-ml-listing-reviews` + `analyze-listing-reviews` | **Não** |
| Histórico de Vendas (gráfico por SKU) | tabela `sales_by_sku` | **Equivalente** — há tabela `orders` |
| Histórico de Otimização | tabela `listing_optimization_history` | **Não** |
| Ação "Melhorar com NexoAI" (recria anúncio) | `generate-listing-optimization` + `apply-ml-listing-changes` + `revert` | **Não como EF**, mas há MCP `Meu_Nexo` com `update_listing_*` e pipeline de aprovação |

**Conclusão:** "replicar o modal inteiro" implica também construir backend que não existe no projeto atual. Por isso o trabalho é um **milestone decomposto em fases**, construído **MVP-first**.

## 3. Decisões de design (aprovadas no brainstorm)

- **Escopo:** replicar o modal antigo inteiro (as 5 abas + ação de IA), em fases.
- **Ordem:** **MVP-first** — Fase A entrega valor sem backend novo; B→F preenchem as abas.
- **Formato:** **Modal central (Dialog `max-w-4xl`)**, igual ao antigo (não Sheet lateral).
- **Filosofia de ações:** qualquer ação que escreve no ML passa por **aprovação** (alinhado à Phase 54), nunca execução automática.

## 4. Decomposição em fases

Cada fase é entregável e testável sozinha, fecha como PR próprio.

| Fase | Entrega | Backend novo |
|------|---------|--------------|
| **A — Shell + Indicadores** | Clicar anúncio → modal abre com cabeçalho, variações, tipo logístico, quality score (`health`) e KPIs (visitas/vendas/estoque/margem). Abas futuras já presentes desabilitadas ("em breve"). | Nenhum |
| **B — Quality Score + Issues** | EF `fetch-ml-listing-health` (API `/items/{id}/health` do ML) enriquece a aba Indicadores com lista de problemas acionáveis. | 1 EF |
| **C — Aba Vendas** | Gráfico de vendas por SKU a partir da tabela `orders`. | Leve (query/RPC) |
| **D — Aba Precificação** | Reaproveitar a calculadora existente (`MLPrecificacao`) embutida no modal. | Nenhum (reuso) |
| **E — Aba Avaliações** | EF de reviews do ML + análise (resumo IA dos comentários). | 1–2 EF |
| **F — Ação "Melhorar com IA" + Histórico de Otimização** | Pipeline IA gera sugestão → aplica via MCP `update_listing_*` **com aprovação** → registra em tabela de histórico, com revert. | EF + tabela |

> Numeração GSD: este milestone ocupa as próximas fases após a Phase 70 (sugestão: Phases 71–76, uma por etapa A–F).

---

## 5. Fase A — detalhamento (o que construímos primeiro)

### 5.1 Gatilho de abertura (em `src/pages/mercadolivre/MLAnuncios.tsx`)
Hoje o clique na linha apenas expande variações (`onClick={() => item.has_variations && toggleRow(item.id)}`) e o título leva ao ML. Adicionar um **gatilho dedicado** que não conflite com o expandir:
- Clique na **miniatura do produto** abre o modal; **e**
- Um ícone **👁 "Ver detalhes"** na linha (célula de ações) abre o modal.

O expandir-variações e o link do título permanecem intactos.

### 5.2 Estrutura do modal
Novo componente `src/components/mercadolivre/anuncios/ListingDetailModal.tsx`:
- **Props:** `item: ProductItem | null`, `open: boolean`, `onOpenChange: (open) => void`. Reusa o tipo `ProductItem` do `MLInventoryContext` (não cria modelo de dados novo).
- **Dialog** `max-w-4xl max-h-[90vh] overflow-y-auto`.
- **Cabeçalho:** título (`line-clamp-1`), MLB id em mono, badge "N variações" (quando `variations.length > 1`), badge de tipo de anúncio (Clássico/Premium/Grátis + % de comissão — reusar `getListingLabel`/`getCommissionRate` que já existem na página), botão "Ver no ML" (`https://produto.mercadolivre.com.br/<MLB-id>`).
- **Tabs (shadcn `Tabs`):** `indicadores` (ativa) + `vendas`, `precificacao`, `avaliacoes`, `historico` renderizadas **desabilitadas** com tooltip "em breve". Isso deixa o shell pronto para B–F encaixarem sem refazer layout.

### 5.3 Conteúdo da aba "Indicadores" (apenas dados já existentes em `ProductItem`)
Layout em duas colunas (grid `md:grid-cols-5`, esquerda 2 / direita 3, como no antigo):
- **Esquerda:**
  - Imagem: `thumbnail` (galeria completa fica para fase futura — exige `get_item_details`).
  - Lista de variações: por variação, atributos (`attribute_combinations`), estoque (`available_quantity`) e vendido (`sold_quantity`).
  - Breakdown de **tipo logístico**: agrega `logistic_type` × estoque entre variações (a página já tem o dado por item; quando houver só o item, usa `item.logistic_type`).
- **Direita:**
  - **Scoreboard de qualidade** a partir de `item.health` (0–1 → %); badge de faixa (bom/médio/ruim).
  - **KPIs:** visitas (`visits`), vendido (`sold_quantity`), estoque (`available_quantity`), e **margem** via os hooks que a página já usa (`useMLMarginWithAds` / `useMLProductCosts`).
  - Marca (`brand`), status do anúncio (`status`), frete grátis (`free_shipping`), catálogo (`catalog_product_id` quando presente).
- **Ações (Fase A):** apenas "Ver no ML". A ação "Melhorar com IA" entra na Fase F.

### 5.4 Componentes (isolados, um propósito cada)
Em `src/components/mercadolivre/anuncios/` (a pasta já existe — `ImportacaoCustos` vive lá):
- `ListingDetailModal.tsx` — orquestra Dialog + Tabs + cabeçalho.
- `ListingIndicatorsTab.tsx` — conteúdo da aba Indicadores (recebe `item: ProductItem`).
- `ListingQualityScore.tsx` — scoreboard isolado a partir de `health` (reutilizável pela Fase B).

### 5.5 Fora de escopo da Fase A
Galeria completa de fotos, issues detalhados (B), gráfico de vendas (C), calculadora embutida (D), reviews (E), ação de IA + histórico de otimização (F).

### 5.6 Critérios de sucesso (Fase A)
1. Clicar na miniatura ou no ícone "Ver detalhes" de qualquer anúncio abre o modal com os dados daquele anúncio.
2. A aba Indicadores mostra quality score, variações, tipo logístico, KPIs e margem usando **somente** dados já carregados (zero chamada de backend nova).
3. As abas Vendas/Precificação/Avaliações/Histórico aparecem desabilitadas com tooltip "em breve".
4. "Ver no ML" abre o anúncio correto em nova aba.
5. Multi-tenant intacto: nenhum dado vaza entre organizações (reusa o `ProductItem` já filtrado por org/seller no contexto).
6. `tsc` sem erros + `build` ok; testes dos novos utilitários (faixa de quality score, agregação de tipo logístico) passando.

## 6. Riscos e mitigação
- **Conflito do gatilho com expandir-variações:** mitigado usando alvos distintos (miniatura/ícone vs. resto da linha) e `e.stopPropagation()`.
- **`health` ausente em alguns itens:** scoreboard trata `null` com estado "sem dado" (a Fase B força refresh via EF).
- **`MLAnuncios.tsx` já tem 2285 linhas:** o modal e as abas ficam em arquivos próprios (não inflar a página); a página só ganha o estado de abertura e o gatilho.

## 7. Convenções seguidas
React 18 + TS + shadcn/ui (Dialog, Tabs, Tooltip, Badge), sem novas dependências. Named exports, props interface inline, arquivos PascalCase em `components/mercadolivre/anuncios/`. Edge functions (fases B/E/F) em Deno seguindo o padrão do projeto.
