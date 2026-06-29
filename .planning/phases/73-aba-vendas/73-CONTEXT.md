# Phase 73: Aba Vendas - Context

**Gathered:** 2026-06-29
**Status:** Ready for planning
**Source:** Alinhamento (AskUserQuestion) + spec `docs/superpowers/specs/2026-06-29-anuncio-detail-modal-design.md` (seção 4, Fase C)

<domain>
## Phase Boundary

Fase C do milestone Modal de Detalhe do Anúncio. Liga a aba **"Vendas"** (hoje desabilitada "em breve" no `ListingDetailModal`) a um gráfico real do histórico de vendas do anúncio aberto, a partir da tabela `orders`.

**Dentro do escopo:** hook de consulta a `orders` por item_id; componente da aba Vendas com gráfico recharts (toggle unidades/receita + seletor 30/90d); wiring no modal removendo o estado desabilitado da aba "vendas".
**Fora do escopo:** as demais abas (Precificação=74, Avaliações=75, Ação IA=76); quebra por SKU/variação individual; export.
</domain>

<decisions>
## Implementation Decisions (LOCKED)

- **Métrica:** toggle **unidades vendidas/dia ↔ receita (R$)/dia** no mesmo gráfico.
- **Janela:** seletor **30 ↔ 90 dias** (refaz a consulta ao trocar).
- **Fonte:** **query direta** `supabase.from("orders")` no client. A tabela tem **RLS org-scoped** (2 policies — confirmado) → anti-IDOR pelo RLS. **NÃO criar EF nem RPC.**
- **Filtro:** `item_id` = id do anúncio aberto; `status = 'paid'` (alinhado ao resto do app — MLFinanceiro/MLPedidos). Agrega TODAS as variações do anúncio (gráfico por item_id, não por SKU separado).
- **Datas:** coluna `data_pedido` é **TEXT** → cast/parse para data ao bucketizar por dia (lição Phase 63: `data_pedido` TEXT). Preencher dias sem venda com 0 dentro da janela.
- **Lazy:** só consulta quando o modal está aberto (item presente); idealmente só quando a aba "Vendas" é ativada. Estados loading/vazio/erro.
- **UI isolada:** novo componente em `src/components/mercadolivre/anuncios/` (ex.: `ListingSalesTab.tsx`) + hook (ex.: `useMLListingSales.ts`). O `ListingDetailModal` só troca a aba "vendas" de `DisabledTabTrigger` para `TabsTrigger` ativo + `TabsContent` com o componente.
- Utilitário puro de agregação (bucketização por dia + soma de quantidade/receita + preenchimento de dias vazios) testável por vitest.

### Claude's Discretion
- Tipo de gráfico (barras vs área/linha) — recomendado barras para unidades, área/linha para receita; escolher o que ficar limpo no mobile. Nomes de props/hook. Formatação de eixos/tooltip (reusar `currencyFmt`).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `src/pages/mercadolivre/MLPedidos.tsx` (linhas ~690–740) — padrão de query direta em `orders` via supabase client (filtros, status, datas).
- `src/components/mercadolivre/MLRevenueChart.tsx` — padrão de gráfico recharts do projeto (eixos, tooltip, cores/tokens).
- `src/components/mercadolivre/anuncios/ListingDetailModal.tsx` (Phase 71) — onde a aba "vendas" hoje é `DisabledTabTrigger`; trocar por aba ativa + `TabsContent`.
- `src/components/mercadolivre/anuncios/ListingIndicatorsTab.tsx` / `ListingIssues.tsx` (Phase 71/72) — padrão de componente de aba + estados loading/vazio/erro a espelhar.
- `src/integrations/supabase/client.ts` — client para a query.
- `src/contexts/MLInventoryContext.tsx` — `ProductItem.id` (item_id) e `_ml_user_id`.
- Tabela `orders` (Supabase `ckcdevcxgvueywivefgx`): colunas-chave `item_id` (text), `variation_id`, `sku`, `quantidade` (int), `receita_bruta` (numeric), `status` (text, usar 'paid'), `data_pedido` (TEXT), `organization_id` (uuid, RLS).
</canonical_refs>

<specifics>
## Specific Ideas
- Modal já tem `item.id` — passar para o hook como `item_id`.
- Tooltip de receita usa `currencyFmt` (já existe em `listingHelpers.ts` / `MLAnuncios`).
- Preencher dias sem venda com 0 para o gráfico não "pular" datas.
</specifics>

<deferred>
## Deferred Ideas
- Quebra por SKU/variação, comparação entre períodos, export — fora desta fase.
</deferred>

---

*Phase: 73-aba-vendas*
*Context gathered: 2026-06-29 via alinhamento + spec*
