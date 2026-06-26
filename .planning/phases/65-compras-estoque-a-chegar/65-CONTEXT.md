# Phase 65: Compras — Estoque a Chegar (descontar OCs em trânsito) - Context

**Gathered:** 2026-06-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Evolução da Phase 63 (`/compras` — reposição por SKU). Esta fase faz a página **considerar as ordens de compra (OC) em trânsito** do Tiny ERP, removendo a limitação atual (aviso amarelo "não considera estoque a chegar").

Entrega:
1. **Nova fonte de dados** — EF `sync-tiny-purchase-orders` que sincroniza as OCs em aberto do Tiny por SKU para uma nova tabela `purchase_orders` (org-first, RLS), com cron diário.
2. **RPC `get_replenishment_by_sku`** ganha o "a caminho": desconta a quantidade em OC aberta da sugestão de compra e expõe `qtd_a_caminho` + `data_proxima_chegada`.
3. **Frontend `/compras`** — nova coluna leiga "A caminho" (qtd + data, ex: "30 un · chega 04/set"); a sugestão de compra passa a refletir o desconto; o aviso amarelo v1 sai/ajusta.

**NÃO faz parte desta fase (YAGNI):** gerar/criar OC no Tiny (botão criar OC); fluxo de recebimento; **override por fornecedor** (peça v2 separada — supplier por item ainda não existe); **cálculo mais esperto** (sazonalidade/lead time real — peça v2 separada). O `compraUtils` legado em `/precos-custos` permanece **intocado**. A RPC `get_replenishment` (Phase 62, por anúncio) permanece intocada.
</domain>

<decisions>
## Implementation Decisions (travadas com Wesley 2026-06-26)

### Fonte de dados
- **D-01:** Fonte = **OCs do Tiny ERP via EF própria** (`/ordens-compra` v3; token já tem `ordem-compra-leitura`). **NÃO** usar o cache do MCP Meu Nexo — provado travado em `synced_at=2026-06-03` mesmo com `force_refresh`. A EF sincroniza direto do Tiny e grava em `purchase_orders`, garantindo freshness.
- **D-02:** A EF segue o padrão da `sync-tiny-costs`: usa o **token Tiny de `ml_tokens`** (auto-refresh via `tiny-oauth`), pagina, e **`EdgeRuntime.waitUntil`** (202 imediato — lição Phase 59: EF lenta + pg_cron → pg_net derruba aos 5s antes do commit). `organization_id` + `user_id` derivados de `ml_tokens` no upsert (lição Phase 64: `organization_id` NOT NULL → upsert falha silencioso sem ele).
- **D-03:** Situações consideradas "a chegar" = OC **em aberto / não recebida e não cancelada**. O researcher DEVE confirmar os códigos exatos de `situacao` do Tiny (`/ordens-compra`); pela amostra MCP os itens trazem `situacao` 0/1/2/3 e a doc do MCP mapeia 3=aguardando recebimento, 1=aberta, 2=aprovada, 4=recebida parcial, 5=cancelada. Excluir recebidas/canceladas.

### Tabela `purchase_orders`
- **D-04:** Nova tabela `purchase_orders` (grão = 1 linha por SKU por OC): `organization_id`, `ml_user_id`, `id_ordem_compra`, `numero_pedido`, `sku`, `descricao`, `quantidade`, `data_entrega` (previsão), `data_pedido`, `situacao`, `preco_unitario`, `synced_at`. RLS **org-first** (`is_org_member(auth.uid(), organization_id)`), índice por `(organization_id, sku)`. Upsert idempotente por `(organization_id, id_ordem_compra, sku)`.

### Motor (RPC) — como o a-chegar afeta a sugestão
- **D-05:** **Descontar TODA a quantidade a caminho** da sugestão, **independente da data de entrega** (decisão explícita do Wesley). Nova CTE `incoming_by_sku` = `SUM(quantidade)` das OCs em aberto por SKU (match exato `purchase_orders.sku = inv.sku_code`). A necessidade passa a ser `alvo − estoque_atual − a_caminho` (antes era `alvo − estoque_atual`), mantendo **gatilho, MOQ, pack, sem-giro, custo-nulo** exatamente como na Phase 63.
- **D-06:** Expor 2 colunas novas na RPC: `qtd_a_caminho` (INTEGER, default 0) e `data_proxima_chegada` (DATE, menor `data_entrega` futura das OCs do SKU; informativa, não entra no cálculo dado D-05).
- **D-07:** Manter **`SECURITY INVOKER`** (anti-IDOR: org alheia = 0 linhas). `purchase_orders` filtra `organization_id = p_org_id` no JOIN (RLS reforça). Sem regressão da fórmula Phase 63 quando não há OC (a_caminho=0 → resultado idêntico).

### Match SKU
- **D-08:** Match **exato** `purchase_orders.sku = ml_inventory_cache.<variação>.seller_custom_field` (mesmo formato Tiny). Medido em prod: **227/333 SKUs de OC casam (68%)**; os ~106 sem match são insumos/consumíveis (graxa, cola, SRM/SRR) ou itens fora de linha — fora do escopo de reposição de qualquer forma. **Sem normalização** (hífen/case) — não há ganho.

### Frontend
- **D-09:** Nova coluna **"A caminho"** na tabela `/compras` (UX leiga, padrão da 63-05): mostra qtd + data da próxima chegada (ex: "30 un · chega 04/set") ou "—" quando 0. A coluna "Comprar" (sugestão) já reflete o desconto. Tooltip explicando. O aviso amarelo v1 ("não considera estoque a chegar") é **removido/ajustado**. Sem nova página — é incremento na `/compras` existente.
</decisions>

<open_questions>
## Para o researcher confirmar
1. **Códigos `situacao` do Tiny** em `/ordens-compra` v3 (quais = "a chegar" vs recebida/cancelada). Validar contra a API real com o token Pé Vermeio.
2. **Shape do payload** de `/ordens-compra` (header + itens[]; campos `produto.sku`/`codigo`, `quantidade`, `data`/`dataPrevista`). Já há referência na tool MCP `get_purchase_orders` (explode por item: `id_ordem_compra, numero_pedido, sku, quantidade, data_entrega, data_pedido, preco_unitario`).
3. **Multi-página / rate limit** do Tiny (`/ordens-compra` paginado; respeitar ~60 req/min como na `sync-tiny-costs`).
4. **Como agendar o cron** (reaproveitar padrão `sync-tiny-costs-daily`: `net.http_post` + Bearer service_role_key do vault).
</open_questions>

<references>
## Âncoras de código
- EF modelo (token Tiny + waitUntil + org_id no upsert): `supabase/functions/sync-tiny-costs/index.ts`
- RPC a alterar: `supabase/migrations/20260663000100_get_replenishment_by_sku_rpc.sql` (CTEs inventory_by_sku / sales_by_sku / params / base → adicionar `incoming_by_sku` + colunas)
- Frontend: `src/components/mercadolivre/ReplenishmentSkuTable.tsx`, `src/pages/mercadolivre/MLCompras.tsx`, `src/hooks/useReplenishmentBySku.ts`, `src/components/mercadolivre/ReplenishmentSkuFilters.tsx`
- Cron modelo: `sync-tiny-costs-daily` (pg_cron, vault service key)
- Org Pé Vermeio = `7f615df7-7bac-45e5-8a93-827fb9ddeec7`; ml_user_id `1639558873`; projeto Supabase `ckcdevcxgvueywivefgx`
</references>
