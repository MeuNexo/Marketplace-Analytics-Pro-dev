# Phase 28 — Performance & Escalabilidade Multi-Conta

## Problema

Com duas contas ML conectadas (Wesley=admin, Thales=conta com alto volume de pedidos), o sistema apresenta lentidão perceptível:

- Dashboard `/financeiro` carrega devagar — `useMLMarginAnalysis` traz **todos os rows da tabela `orders`** para o browser e agrega no cliente
- `useMLCostWaterfall` também busca rows completos sem LIMIT
- Sync de pedidos da conta Thales é lenta — `sync-ml-orders` faz **um RPC por pedido** (N+1) ao invés de batch
- Página de produtos (`/anuncios`) faz **2 queries por paginação** no `ml-products-aggregated` (dual-scope), depois dedup no cliente
- Com 2 contas de volumes distintos, o problema só piora conforme a base cresce

## Solução (3 planos)

### Plano 28-01 — Batch Upsert no sync-ml-orders (Wave 1)

Substituir o loop `for (const r of records) { await supabaseAdmin.rpc("upsert_order_preserve_cost", ...) }` por um único RPC `batch_upsert_orders(records JSONB)` que executa um só `INSERT ... ON CONFLICT DO UPDATE` para todos os pedidos do lote, preservando `custo_unit` existente.

**Impacto:** Para 200 pedidos/sync, passa de 200 round-trips para 1.

### Plano 28-02 — Agregação Server-Side via RPCs Postgres (Wave 1)

Criar funções Postgres que recebem filtros e retornam dados **já agregados** — o hook passa a receber apenas as linhas de summary, sem trazer rows crus para o browser.

Funções:
- `get_margin_summary(p_org_id, p_user_ids, p_from, p_to)` → 1 row de totais
- `get_margin_by_day(p_org_id, p_user_ids, p_from, p_to)` → N rows (1/dia)
- `get_margin_by_product(p_org_id, p_user_ids, p_from, p_to)` → N rows (1/produto)
- `get_margin_by_brand(p_org_id, p_user_ids, p_from, p_to)` → N rows (1/marca)
- `get_margin_by_estado(p_org_id, p_user_ids, p_from, p_to)` → N rows (1/estado)
- `get_cost_waterfall(p_org_id, p_user_ids, p_from, p_to)` → 1 row de totais (substitui hook atual)

`useMLMarginAnalysis` e `useMLCostWaterfall` passam a usar `.rpc()` ao invés de `.from("orders").select(...)`.

**Impacto:** Independente do volume, o browser recebe apenas os dados processados — não 50k+ rows.

### Plano 28-03 — Fix Dual-Scope + Indexes (Wave 2, depende 28-02)

1. **Fix `ml-products-aggregated`:** Unificar as duas queries (user-scope + org-scope) em uma só com `OR` ou mover para uma única query com `in("organization_id", [...])` usando o mesmo `resolvedIds`
2. **Indexes:** Adicionar `idx_orders_status_data` em `(status, data_pedido)` — campo `status` não tem index dedicado, e a maioria dos filtros combina os dois
3. **LIMITs defensivos:** Adicionar `.limit(50000)` nos hooks `useMLOrders`, `useMLProductCosts` e no fetch de product costs do `sync-ml-orders` — garante que uma eventual regressão não carregue a tabela inteira

## Arquitetura de dados (referência)

### Tabela `orders`
- Unique constraint: `(ml_order_id, ml_user_id, item_id, variation_id)`
- RLS: `is_org_member(auth.uid(), organization_id)` — já usa função cacheada
- Índices existentes: `(organization_id)`, `(ml_user_id)`, `(data_pedido)`, mas **NÃO** `(status, data_pedido)` combinado

### Função `upsert_order_preserve_cost` (atual)
- Recebe 1 record, faz INSERT ... ON CONFLICT DO UPDATE
- Lógica de preserve: `custo_unit = COALESCE(EXCLUDED.custo_unit, orders.custo_unit)` — não sobrescreve CMV histórico

### Stack
- Supabase Edge Functions (Deno)
- React + TanStack Query v5
- PostgreSQL via Supabase

## Sucesso da fase

1. Sync de 200+ pedidos passa de N RPCs seriais para 1 RPC batch
2. `/financeiro` não faz mais `SELECT * FROM orders` no browser — usa RPCs de agregação
3. `/anuncios` não executa 2 queries por paginação — dual-scope resolvido
4. `npx tsc --noEmit` e `npm run build` sem erros após os 3 planos

## Restrições

- Preservar lógica "preserve cost" do upsert — não sobrescrever `custo_unit` histórico
- RPCs devem respeitar o mesmo filtro multi-account (`p_user_ids uuid[]`)
- Sem novas dependências de frontend
- Migrations devem seguir o padrão `YYYYMMDDHHMMSS_descricao.sql`
