# Phase 77: Produtos Vendidos + Análise de Preços (porte do app oficial) — Context

**Gathered:** 2026-07-01
**Status:** Ready for planning
**Source:** Discussão ao vivo com Wesley (sessão 2026-07-01) — substitui /gsd-discuss-phase

<domain>
## Phase Boundary

Portar da **versão oficial do app** (código de referência completo em `/root/garment-glow-official/` — zip enviado pelo Wesley em 2026-07-01) duas análises que existem lá como sub-abas da aba "Relatórios" de `MLAnuncios.tsx` e que faltam no nosso dash:

1. **Produtos Vendidos** — painel duplo: coluna esquerda lista marcas/categorias com receita+quantidade do período; ao selecionar um grupo, a direita mostra os produtos vendidos daquele grupo.
2. **Análise de Preços** — porte do componente `PrecoPraticadoReport` (oficial: `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx`): evolução do preço praticado (médio/mín/máx) por anúncio ao longo do tempo com volume de vendas sobreposto (ComposedChart recharts), granularidade dia/semana/mês, toggle qtd/receita, seletor de produto via Command/Popover.

ENTREGA: duas **páginas novas independentes**, cada uma com item próprio no menu lateral, grupo "Dashboard". NÃO mexer na estrutura de abas do nosso `MLAnuncios.tsx` além do atalho opcional (ver Specifics).

</domain>

<decisions>
## Implementation Decisions

### Escopo (LOCKED — Wesley 2026-07-01)
- Portar SOMENTE Produtos Vendidos e Análise de Preços. "Análise por Categoria" do app oficial ficou FORA por decisão explícita.

### Localização no menu (LOCKED — Wesley 2026-07-01)
- **DOIS itens separados** no grupo "Dashboard" do menu lateral (`src/components/layout/ApiSidebar.tsx`, array `apiSections`, children do item "Dashboard"), NÃO uma página única com abas e NÃO sub-abas de Relatórios em MLAnuncios como no oficial.
- Cada item com página e rota próprias (sugestão: `/produtos-vendidos` e `/analise-precos` — nomes finais a critério do planner, em PT-BR e consistentes com as rotas existentes).

### Processo (LOCKED)
- Phase GSD completa: plan → execute → verify.

### Claude's Discretion
- Nomes exatos de rotas, labels e ícones lucide dos itens de menu.
- Nível de acesso em `roleAccess.ts` (seguir o padrão de páginas de análise análogas do projeto; lembrar que rota fora do mapa = default-deny — bug da Phase 54).
- Como adaptar o atalho "coluna Preços" (no oficial abre a aba na mesma página; aqui vira navegação/deep-link para a página nova, ex. query param `?item=MLB...` — ou ficar de fora se acoplar demais, ver Deferred).
- Estrutura de dados: reusar hooks/utils existentes (`listingSalesAgg`, `useMLListingSales` da Phase 73 fazem agregação parecida sobre `orders`) quando fizer sentido, vs. utils novos.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Código-fonte a portar (app oficial — READ-ONLY, não é o repo de trabalho)
- `/root/garment-glow-official/src/pages/mercadolivre/MLAnuncios.tsx` — aba Relatórios: sub-aba `produtos` (linhas ~2773-2941, painel Produtos Vendidos, estados `pvView`/`pvGroups`) e sub-aba `precos` (linha ~3030, monta `PrecoPraticadoReport` com `priceReportProducts`, `resolvedMLUserIds`, `rankingDates`, `precoRequest`)
- `/root/garment-glow-official/src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` — componente completo da Análise de Preços (tipos `SeriesRow`, granularidade, KPIs, ComposedChart)

### Nosso projeto (destino)
- `src/components/layout/ApiSidebar.tsx` — grupo "Dashboard" do menu (children: Vendas, Consultor, Publicidade, Margem)
- `src/App.tsx` — registro de rotas lazy + ErrorBoundary + RoleRoute
- `src/config/roleAccess.ts` — mapa rota→roles (OBRIGATÓRIO adicionar as rotas novas; default-deny)
- `src/pages/mercadolivre/MLAnuncios.tsx` — nossa versão (divergiu muito da oficial; abas Relatórios atuais: Ranking/Marca/ABC)
- `src/components/mercadolivre/anuncios/listingSalesAgg.ts` + `useMLListingSales.ts` — padrão consolidado (Phase 73) de query direta em `orders` com RLS
- `src/components/mercadolivre/analise/` — pasta IDÊNTICA à do oficial (base já existe nos dois)

</canonical_refs>

<specifics>
## Specific Ideas

**Riscos/lições OBRIGATÓRIAS no porte das queries** (o schema do Supabase oficial ≠ nosso):
- Tabela de pedidos aqui é **`orders`** (não `ml_orders`); coluna `data_pedido` é **TEXT** → cast/`slice(0,10)`; filtrar **`status='paid'`**; escopo RLS por organização (queries diretas client-side já respeitam RLS).
- PostgREST trunca em 1000 linhas → paginação `.range()` obrigatória em queries de período longo.
- Se alguma agregação precisar de RPC: SECURITY INVOKER, **sem subqueries correlacionadas** (statement_timeout 8s do role authenticated) — preferir agregação client-side como a Phase 73 fez, que dispensou RPC.
- O oficial busca dados de vendas por produto de outra fonte (`ml_product_daily_cache` / edge functions próprias) — VALIDAR na pesquisa qual fonte nossa equivale para cada painel (candidatas: `orders` direto, `ml_product_daily_cache`, hooks existentes `useMLProductsQuery`).
- UI mobile: interações por item precisam funcionar nos DOIS layouts (mobile card + desktop table) — lição da Phase 71.

</specifics>

<deferred>
## Deferred Ideas

- **Análise por Categoria** (sub-aba do oficial) — excluída por decisão do Wesley.
- **PriceDetailSheet + sugestão de preço** da aba Catálogo do oficial — já temos `MLPrecificacao`/simulador; fora do escopo desta phase.
- Atalho "coluna Preços" na listagem de anúncios → deep-link para `/analise-precos?item=...` — desejável mas OPCIONAL; se complicar, entregar as páginas sem o atalho e registrar como follow-up.

</deferred>

---

*Phase: 77-pagina-analise-de-anuncios-produtos-vendidos-e-analise-de-pr*
*Context gathered: 2026-07-01 via discussão ao vivo*
