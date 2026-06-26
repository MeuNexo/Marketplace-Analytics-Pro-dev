# Phase 63: Compras — Reposição por SKU (página própria) - Context

**Gathered:** 2026-06-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Evolução da Phase 62 (reposição server-side por anúncio). Esta fase entrega:

1. **Reposição por SKU/variação** (Cor/Tamanho) em vez de por anúncio — cada variação tem estoque, venda/dia, cobertura, ponto, sugestão e custo próprios.
2. **Fundação de dados** que falta hoje: o sync passa a gravar o **SKU por variação** (estoque) e o **`seller_sku` por item de venda** (velocidade real por SKU).
3. **Custos resolvidos por SKU** — corrige o "custo ausente" (hoje 44/116 no Pé Vermeio) casando custo do Tiny pelo SKU da variação.
4. **Parâmetros editáveis por UI** (CRUD em `replenishment_params`), precedência **SKU > marca > global**, write owner/admin.
5. **Filtros** na tela (marca, status/gatilho, sem giro, com/sem custo, busca por título/SKU/tamanho) + drill anúncio→variações + exportação.
6. **Página própria `/compras`** — separada de `/estoque` (a aba "Compra Recomendada" sai do estoque).

**NÃO faz parte desta fase:** ordens de compra / recebimento (a página nasce só com a Compra Recomendada); descontar "a chegar" (OC); override por fornecedor (segue diferido da Phase 62 — supplier não existe por item). O `compraUtils` legado em `/precos-custos/analise` permanece **intocado**.
</domain>

<decisions>
## Implementation Decisions

### Granularidade & Ponte SKU (decisão central)
- **D-01:** Reposição passa a ser **por SKU/variação**. Anúncio **sem** variação é tratado como um SKU único.
- **D-02:** A ponte variação ML → custo/SKU do Tiny será feita pelo **SKU da própria variação no ML** (Wesley cadastra SKU por variação no anúncio). O sync de inventário (`ml-inventory`) passa a **gravar `seller_custom_field` por variação** (CMP-01), permitindo casar com `ml_product_costs.seller_sku` (formato Tiny, ex: `020491CA35GRX`).
- **D-03:** O custo casa pelo SKU da variação (CMP-04). Custo nulo → ainda sugere quantidade + flag `custo_ausente`, sem valor R$ (mantém regra da Phase 62).

### Venda por SKU (velocidade)
- **D-04:** Velocidade por SKU vem de **venda real**, não rateada. O sync de vendas (`mercado-libre-integration` / `sync-ml-orders`) passa a **gravar `seller_sku`/variação por item de pedido** em `ml_product_daily_cache` (CMP-02). Hoje esse campo está **nulo** para o Pé Vermeio.
- **D-05:** Anúncio sem variação → velocidade por item normal (já funciona).

### Motor de reposição (RPC)
- **D-06:** Nova RPC (ou revisão de `get_replenishment`) opera por SKU: estoque por variação via **unnest do jsonb `variations`** de `ml_inventory_cache`; venda/dia por SKU; mantém o modelo de ponto de reposição da Phase 62 (lead time + meta cobertura + safety, gatilho, MOQ/pack).
- **D-07:** Mantém **`SECURITY INVOKER`** (anti-IDOR: org alheia = 0 linhas) e paginação via `.range()` no front. Reaproveita o módulo puro `replenishmentUtils.ts` (fórmula ≡ RPC) com testes.

### Parâmetros (UI)
- **D-08:** `replenishment_params` ganha **escopo `sku`** além de `global`/`marca`. Precedência **SKU > marca > global** (hardcoded como último fallback). Hoje a tabela tem `global` + `marca`.
- **D-09:** UI de edição dos params (CRUD) na página `/compras`; write restrito a **owner/admin** (RLS já é org-first; manter).

### Página & Navegação
- **D-10:** Nova rota **`/compras`** com a Compra Recomendada por SKU; **remover** a aba de `/estoque` (`ReplenishmentPanel` migra). Adicionar "Compras" na sidebar. Acesso sugerido: **owner/admin/member** (decisão operacional/compras) — confirmar no plano com o mapa de `roleAccess`.
- **D-11:** Tela com **filtros** (CMP-06) + **drill anúncio→variações** (CMP-08) + exportação (xlsx já usado no projeto).

### Claude's Discretion
- Forma exata da UI dos filtros e do drill (flat por SKU vs agrupado por anúncio com expand) — seguir padrões shadcn/ui já usados (`MLEstoque`, tabelas com stripe/hover).
- Estrutura da edição de params (modal vs aba) — definir no plano/UI-spec.
- Se a RPC por SKU substitui `get_replenishment` ou nasce como `get_replenishment_by_sku` — decisão de plano (preferência: nova RPC para não quebrar nada em prod até validar).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 62 (base direta a evoluir)
- `.planning/phases/62-reposicao-server-side/62-CONTEXT.md` — decisões originais da reposição
- `.planning/phases/62-reposicao-server-side/62-RESEARCH.md` — pesquisa da fórmula/fontes
- `supabase/migrations/20260662000100_get_replenishment_rpc.sql` — RPC atual (agrega por `item_id`; CTEs sales/inventory/params/base)
- `supabase/migrations/20260662000000_replenishment_params.sql` — tabela de params (escopos global/marca; RLS org-first)
- `src/lib/analysis/replenishmentUtils.ts` (+ `.test.ts`) — fórmula pura espelho da RPC
- `src/hooks/useReplenishment.ts` — hook de consumo da RPC
- `src/components/mercadolivre/ReplenishmentPanel.tsx` — painel atual (a migrar p/ `/compras`)

### Fontes de dados (verificadas live em 2026-06-25, projeto `ckcdevcxgvueywivefgx`)
- `ml_inventory_cache` — colunas `has_variations` (bool) + `variations` (jsonb: `variation_id`, `available_quantity`, `sold_quantity`, `attribute_combinations` [COLOR/SIZE], `seller_custom_field` **nulo hoje**)
- `ml_product_daily_cache` — venda por dia; tem coluna `seller_sku` (**nula p/ Pé Vermeio**)
- `ml_product_costs` — custo por `seller_sku` (Tiny, ex: `020491CA35GRX`) — 604 linhas no Pé Vermeio, todas com `seller_sku`
- Edge functions a tocar: `ml-inventory` (CMP-01), `mercado-libre-integration` + `sync-ml-orders` (CMP-02) — ver `CLAUDE.md` (tabela de edge functions)

### Sistema legado (NÃO tocar)
- `src/lib/analysis/compraUtils.ts` + `/precos-custos/analise` — cálculo antigo, permanece como está

### Identificadores
- Org Pé Vermeio = `7f615df7-7bac-45e5-8a93-827fb9ddeec7` | Org Thales = `e4150d57-1349-48c9-9a89-82b1774857b0`
- Projeto Supabase live = `ckcdevcxgvueywivefgx` (**NÃO** o `gionpsuunfkkzzjdubfy`/`ckc...` citado no CLAUDE.md)
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `replenishmentUtils.ts`: fórmula pura (ponto de reposição/MOQ/pack/sem-giro) — estender para nível SKU mantendo paridade com a RPC.
- `useReplenishment.ts` + `ReplenishmentPanel.tsx`: base do hook e da UI — migrar para `/compras` e adaptar para linhas por SKU + filtros + drill.
- `replenishment_params` (tabela + RLS): estender com escopo `sku`.
- Padrão de tabela/filtros em `MLEstoque.tsx` e demais telas ML (shadcn/ui, design tokens `table.*`).
- `xlsx` já no projeto para exportação.

### Established Patterns
- RPC `SECURITY INVOKER` escopada por org (anti-IDOR por construção) — padrão Phase 43/48/62; manter.
- Paginação via `.rpc().range()` no front (PostgREST trunca 1000).
- Deploy de migration/EF via Supabase MCP; push direto na `main` bloqueado (classificador exige PR).

### Integration Points
- Sidebar/menu (`MenuVisibilityProvider`, `roleAccess`) — adicionar `/compras`.
- Pipeline de inventário (`ml-inventory` → `ml_inventory_cache`) — gravar SKU por variação.
- Pipeline de vendas (`mercado-libre-integration`/`sync-ml-orders` → `ml_product_daily_cache`) — gravar `seller_sku` por item.
</code_context>

<specifics>
## Specific Ideas

- Custo do Tiny chaveado por SKU no formato `{codigo}{tamanho}{cor}` (ex: `020491CA35GRX`, `020491CA35SELA`) — um SKU por variação. A ponte depende do SKU da variação ML bater com esse `seller_sku`.
- Variação do Pé Vermeio confirmada com atributos Cor (Natural/Bege) + Tamanho (P/M/G/GG ou numérico) e `available_quantity` por variação (ex: MLB3818741753 — Chapéu Pralana Bangora).
</specifics>

<deferred>
## Deferred Ideas

- **Ordens de Compra / recebimento** na página Compras (a página nasce só com a Recomendada) — fase futura.
- **Descontar "a chegar" (OC)** na sugestão — segue diferido da Phase 62.
- **Override por fornecedor** nos params — diferido (supplier não existe por item hoje).
- **Fallback ponte via Tiny** (puxar mapeamento variação→SKU do Tiny) — só se a pesquisa mostrar que o ML **não** retorna o SKU por variação no payload (CMP-01).
- **Multi-loja (Thales, 0 custos)** — esta fase foca no Pé Vermeio; Thales não tem custos cadastrados.

</deferred>

---

*Phase: 63-compras-reposicao-por-sku*
*Context gathered: 2026-06-25*
