# Phase 83: MCO por anúncio em Produtos Vendidos + redesign UX - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning
**Source:** Discussão direta com Wesley (decisões travadas via AskUserQuestion)

<domain>
## Phase Boundary

A página `/produtos-vendidos` (`src/pages/mercadolivre/MLProdutosVendidos.tsx`) hoje é um painel duplo:
- **Esquerda:** lista de grupos (toggle Marca | Categoria), cada grupo mostra receita.
- **Direita:** anúncios do grupo selecionado, com colunas Qtd · Receita · Estoque · % Grupo.

É alimentada pela RPC `orders_sold_products_agg` (hook `useMLSoldProducts.ts`), que **só retorna `quantidade` e `receita_bruta`** por `item_id` e filtra `status='paid'`. Não há custo/MCO disponível na página hoje.

**O que esta phase entrega:** trazer **MCO** para a página, para responder "esse anúncio/marca vende bem, mas sobra?". Coluna de MCO% por anúncio (com semáforo de saúde), MCO% por marca, coluna de % Ads (ACoS), tabela ordenável, e um cabeçalho-resumo por grupo. Reaproveita RPCs de margem já existentes e reconciliadas (Análise de Preços / Phase 48/margin_aggregate).

**Fora de escopo:** mudar o cálculo de MCO em si (a fórmula canônica `src/lib/mco.ts` é fonte da verdade), criar RPC nova de MCO (as necessárias já existem), ou mexer em outras páginas.
</domain>

<decisions>
## Implementation Decisions

### Fonte de dados — UMA RPC só (`get_margin_with_ads_by_product`)
Decisão refinada após inspecionar as assinaturas reais das RPCs:

- **Fonte única da página** = **`get_margin_with_ads_by_product`** (migration `supabase/migrations/20260615120000_margin_with_ads_rpc.sql`, hook `useMLMarginWithAds.ts`). Assinatura: `(p_org_id UUID, p_user_ids TEXT[], p_from DATE, p_to DATE)`, `SECURITY INVOKER`, `status IN ('paid','shipped','delivered')`, `GROUP BY o.item_id`. Retorna por anúncio tudo que precisamos: `item_id, titulo, sku, listing_type, receita, cmv, comissao, frete, impostos, lucro, lucro_pct, pedidos, unidades, has_cmv, ads_spend, ads_attributed_orders, lucro_pos_ads, lucro_pct_pos_ads, ads_no_sale`.
- **Problema descoberto:** essa RPC **NÃO retorna `marca`**, e a página agrupa anúncios por marca (hoje via `row.marca` de `orders_sold_products_agg`). **Solução:** pequena migration que adiciona **`marca`** à RPC (`MAX(o.marca) AS marca` no CTE `orders_side` + na `RETURNS TABLE` + no `SELECT` final). Como muda a `RETURNS TABLE`, exige **DROP FUNCTION + CREATE** (não dá `CREATE OR REPLACE`), deployada **via MCP `apply_migration`** no projeto `ckcdevcxgvueywivefgx` (padrão phases 79/82). Manter `SECURITY INVOKER` + grant a `authenticated`.
- **Agregados por marca (painel esquerdo) = client-side** a partir das linhas por anúncio (mesmo padrão do `soldProductsAgg.ts`/`% grupo` atual): Receita da marca = Σ receita; MCO% da marca = Σ`lucro_pos_ads` ÷ Σ`receita` (pós-ads, **consistente** com o número do painel direito); nº no vermelho = contagem de anúncios com MCO% ≤ 5%. **Isso dispensa `get_margin_by_brand`** (que é pré-ads e criaria inconsistência esquerda≠direita) — NÃO usar essa RPC.
- **Toggle Categoria** (a outra dimensão do painel esquerdo) continua cruzando `item_id → category_id` via `itemsMap`/`MLInventoryContext`, como hoje.
- **Estoque** continua vindo do `MLInventoryContext`/`itemsMap` por `item_id` (não vem da RPC).
- **Semântica "produtos vendidos":** o `FULL OUTER JOIN` com ads pode produzir linhas *ads-only* (anúncio com gasto de ads mas 0 vendas no período → `receita=0`, `marca` null, `unidades=0`). Para uma página de **produtos vendidos**, filtrar para linhas com venda (`unidades > 0`), como a página faz hoje. (O sinal `ads_no_sale` fica fora de escopo aqui — já aparece em telas de ads.)

### MCO exibido
- MCO principal = **COM ads** = `lucro_pos_ads` (percentual `lucro_pct_pos_ads`). Decisão de Wesley (padrão Phase 48).
- Formato = **MCO% com semáforo de cor**; o R$ de MCO e a quebra de custos (ads, comissão, frete, imposto) aparecem no **hover/tooltip**.

### Faixas do semáforo (MCO% por anúncio) — travadas por Wesley
- 🔴 **vermelho:** MCO% ≤ 5%
- 🟡 **amarelo:** MCO% 6% a 8% (ou seja > 5% e < 9%)
- 🟢 **verde:** MCO% ≥ 9%
- Centralizar os cortes numa constante `MCO_SAUDAVEL_PCT` (e um corte inferior para o vermelho), reutilizável. Cor **nunca** é sinal único: o rótulo `%` fica sempre visível ao lado da bolinha. Paleta CVD-safe validada pela skill `dataviz` (validar em light + dark).

### Critério de vendas — unificado
- A página passa a contar `status IN ('paid','shipped','delivered')` (o critério das RPCs de margem), em vez de só `paid`. Wesley cedeu o aval: os números de Receita/Qtd da tela mudam levemente vs. hoje — comportamento esperado, não é bug.

### Colunas / UX do painel direito
- Colunas: **Anúncio · Qtd · Receita · MCO% (semáforo) · % Ads (ACoS) · Estoque · % Grupo**.
- **% Ads (ACoS)** = `ads_spend / receita` por anúncio.
- Tabela **ordenável por qualquer coluna** (hoje é fixa por receita desc). A ordenação por MCO% é o caminho para achar "micos" (vende bem, margem ruim).
- Manter a versão mobile em cards coerente com as novas métricas.

### Painel esquerdo (marcas)
- Cada marca mostra Receita + **MCO% com bolinha de cor** (mesmas faixas), para bater o olho no ranking de saúde sem precisar clicar.

### Cabeçalho do grupo
- Ao selecionar uma marca, exibir uma faixa-resumo: **Receita total · MCO% médio da marca · nº de anúncios no vermelho**.

### Dados ausentes
- Nunca inventar número quando o custo (`custo_unit`) estiver ausente. Seguir o padrão das phases 79-82: quando um anúncio não tem custo, o MCO% fica indefinido/avisado (ex.: "—" + aviso de custo ausente), não zerado nem estimado.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Página e agregação atuais
- `src/pages/mercadolivre/MLProdutosVendidos.tsx` — componente da rota (painel duplo, tabela desktop + cards mobile).
- `src/hooks/useMLSoldProducts.ts` — hook que chama `orders_sold_products_agg` (a ser trocado/estendido).
- `src/components/mercadolivre/anuncios/soldProductsAgg.ts` — agregação client-side (grupos, `shareOfGroup`/% grupo, itens).

### MCO — fórmula e RPCs (reutilizar, não recriar)
- `src/lib/mco.ts` — `computeMco` (fórmula canônica: receita − cmv − platformCost − ads − tax). Fonte da verdade.
- `src/lib/kpi-glossary.ts` — entrada `mco` do glossário (texto ao usuário).
- `supabase/migrations/20260615120000_margin_with_ads_rpc.sql` — RPC `get_margin_with_ads_by_product` (por item_id, com e sem ads). Consumida por `src/hooks/useMLMarginWithAds.ts`.
- `supabase/migrations/20260527110000_margin_aggregate_rpcs.sql` — RPCs de margem por dimensão, incl. `get_margin_by_brand`. Consumidas por `src/hooks/useMLMarginAnalysis.ts` / `useMLProductMargins.ts` / `useMLCostWaterfall.ts`.

### Estoque e filtros
- `MLInventoryContext` — estoque atual (`available_quantity`) por `item_id`.
- `src/hooks/useMLFilters.ts` — período (`currentFrom`/`currentTo`), `MLPeriodPicker`.

### Design / cor
- Skill `dataviz` (`references/palette.md`) — paleta categórica/semáforo CVD-safe; validar cores com o script da skill em light + dark.
- Tokens de cor do projeto: `--kpi-positive`, `--kpi-negative`, `--kpi-neutral`, `--success`, `--warning`, `--destructive`.

### Padrões da linhagem Análise de Preços (phases 79-82)
- Deploy de migration/EF **só via MCP** (`mcp__claude_ai_Supabase__apply_migration` / `deploy_edge_function`) — sem token para CLI. Projeto Supabase = `ckcdevcxgvueywivefgx` (NÃO o `gionpsuunfkkzzjdubfy` do CLAUDE.md).
- Testes com **vitest**. Nunca inventar número quando custo ausente (mostrar aviso).
</canonical_refs>

<specifics>
## Specific Ideas

- MCO% célula: `<bolinha cor> 12,3%` — cor pela faixa, número sempre presente. Tooltip: "MCO R$ 45,20 · Ads R$ 8,10 · Comissão R$ 12,00 · Frete R$ 6,50 · Imposto R$ 9,00".
- % Ads (ACoS): formatar como `%`; destacar (amarelo/vermelho) quando ACoS estiver alto e comendo a margem — opcional, decisão de UI do planner.
- Cabeçalho-resumo do grupo: 3 números lado a lado; "N anúncios no vermelho" com destaque quando N > 0.
- Ordenação: clicar no header alterna asc/desc; indicador visual da coluna ativa.
- Reconciliação: como troca o critério de status (paid→paid+shipped+delivered), documentar/checar que Receita da tela passa a bater com Análise de Preços e com as telas de margem.
</specifics>

<deferred>
## Deferred Ideas

- Métrica agregada de "% da marca no vermelho" como filtro/ordenação global do painel esquerdo (só exibir o número por ora).
- Sparkline de tendência de MCO por anúncio.
- Drill-down por variação/SKU dentro do anúncio (a Análise de Preços já cobre isso na Phase 82).
</deferred>

---

*Phase: 83-produtos-vendidos-mco-redesign*
*Context gathered: 2026-07-03 via discussão direta com Wesley*
