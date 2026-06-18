---
spike: 001
name: mapeamento-ml-tiny-custo
type: standard
validates: "Dado orders (ML) sem custo e ml_product_costs (Tiny) com custo mas chave incompatível, quando consultamos a API Tiny v3 com Developer-Id, então conseguimos o vínculo ML↔Tiny (incl. kits) para popular orders.custo_unit"
verdict: VALIDATED
related: []
tags: [tiny, mercado-livre, custo, cmv, mapeamento, kit, backend, edge-function]
---

# Spike 001: Mapeamento ML item_id/SKU ↔ Tiny (kit-aware) para popular orders.custo_unit

## O que valida
Dado que `orders` (ML) está ~98% sem `custo_unit` e `ml_product_costs` (Tiny) tem custo mas com chave incompatível, **é possível obter de forma confiável o custo por pedido ML — incluindo kits — via a API Tiny?**

## Evidência do problema (medido em prod, ckcdevcxgvueywivefgx)
- `orders.data_pedido` é `timestamptz`; `orders` tem `item_id` ML (`MLB…`), `sku` ML (ex kits `K10BMS2345GSORT`, `KSA03000001000CM0G0189`), `custo_unit` **~98% NULL** (78 de 3968 em 3 dias).
- `ml_product_costs` (604 produtos, todos com cost) é 100% chaveado por **Tiny**: `item_id = "TINY_<sku>"`, `seller_sku` formato Tiny (`036314CA39CASTOR`, `K4CBS2345SORG1`).
- Join `orders.sku ↔ ml_product_costs.seller_sku` cobre só **1,7% dos pedidos / 4,1% da receita** (mesmo normalizado). Join por `item_id`: **0** (ML `MLB…` vs Tiny `TINY_…`).
- `recalc-order-costs/index.ts` (L94-153) resolve custo via `costBySku.get(orders.sku)` [= `ml_product_costs.seller_sku`] e `costByItem` (vazio: todos `TINY_`). → falha p/ ~98%.
- `get_cost_waterfall` RPC calcula `cmv = SUM(orders.custo_unit*qtd)` → **DRE/CMV também é low-coverage** pelo mesmo motivo.
- `sync-tiny-costs` puxa `/produtos` e grava custo por SKU Tiny; **NÃO** busca o vínculo anúncio-ML ↔ produto-Tiny nem composição de kit.

## Research (API Tiny)
"Obter Produto" (Tiny/Olist) retorna, no detalhe do produto:

| Campo | Estrutura | Relevância |
|---|---|---|
| `produto.mapeamentos[]` | `{ mapeamento: { idEcommerce, skuMapeamento, idMapeamento, preco, preco_promocional } }` | **A ponte.** Só vem com **`Developer-Id` válido no header**. `skuMapeamento` = SKU do anúncio no marketplace = **`orders.sku`**. `idEcommerce` identifica a integração (ML). `idMapeamento` = id do anúncio no marketplace. |
| `produto.kit[]` | `{ item: { id_produto, quantidade } }` | Composição de kit (só quando `classe_produto = "K"`). Custo do kit = Σ(custo do componente × quantidade). |
| `produto.preco_custo` / `preco_custo_medio` | decimal | Custo do produto/componente. |

**Por que o join atual falha e este resolve:** o Tiny guarda, por produto, o **SKU do anúncio ML** em `mapeamentos[].skuMapeamento` — que é exatamente o `orders.sku`. A SKU interna Tiny (`seller_sku`) é outra coisa; por isso o match direto SKU↔seller_sku só pega ~2%. Indo pelo `skuMapeamento`, o elo passa a existir.

## Veredito: VALIDATED (viável) — com 3 caveats
1. **Developer-Id obrigatório:** o array `mapeamentos[]` só retorna com um `Developer-Id` válido no header. É preciso confirmar/registrar o Developer-Id do app Tiny da Pé Vermeio (o `TINY_APP_ID` atual pode ou não habilitar isso). **Maior dependência externa.**
2. **Cobertura = produtos "sincronizados":** só produtos que tiveram "Sincronizar anúncios" no Tiny terão `mapeamentos`. Produtos não-sincronizados continuam sem custo (cair no estado atual). Medir cobertura real após o primeiro sync.
3. **Kit = soma de componentes:** custo do kit calculado de `kit[]` (Σ componente × qtd). Decisão de produto: usar `preco_custo` do próprio kit quando existir, senão somar componentes.

## Design da implementação (para /gsd-plan-phase)
1. **Migration** — nova tabela `ml_sku_cost_map (organization_id, ml_user_id, ml_sku text, cost numeric, is_kit bool, tiny_product_id text, updated_at)`, UNIQUE(organization_id, ml_sku). (`ml_sku` = `skuMapeamento`.)
2. **EF nova/estendida `sync-tiny-mappings`** (ou estender `sync-tiny-costs`): para cada produto Tiny, `GET /produtos/{id}` **com header `Developer-Id`** → ler `mapeamentos[].skuMapeamento` (filtrar `idEcommerce` = ML) e `kit[]`. Para kit, resolver custo = Σ(custo componente × qtd) usando os custos já carregados. Upsert em `ml_sku_cost_map` por `ml_sku`. Respeitar rate limit (já há `RATE_MS`/sleep no client).
3. **Fix `recalc-order-costs`** — adicionar resolução por `orders.sku → ml_sku_cost_map.ml_sku → cost` ANTES dos fallbacks atuais (que continuam para o legado). Assim `custo_unit` passa a popular pela ponte correta.
4. **Backfill** — após o sync popular o mapa, re-rodar `recalc-order-costs` (modo backfill) sobre orders com `custo_unit IS NULL`. CMV/DRE/markup voltam a ter cobertura.

## Validação ao vivo (parcial, 2026-06-18) — API v3
Probe read-only (EF temporária `probe-tiny-map`, depois NEUTRALIZADA) contra a conta ml_user_id 1639558873:
- `Developer-Id` (= `TINY_APP_ID`, 60 chars) É enviável e aceito (HTTP 200).
- `GET /produtos/{id}` (v3) retorna `precoCusto`/`precoCustoMedio` (ex 162.57) e tem campo `kit` (vazio p/ não-kits), `variacoes`, `produtoPai` — **mas NÃO retorna `mapeamentos`** (isso é da API v2). Logo, no v3 o vínculo ML↔Tiny NÃO está no detalhe do produto.
- **Pendente:** descobrir o endpoint v3 do mapeamento de anúncios (candidatos /anuncios, /mapeamentos, /produtos/{id}/mapeamentos não confirmados — o probe foi interrompido pela guarda de segurança antes de testá-los) OU usar a API v2 `produto.obter` (que tem `mapeamentos[]` com Developer-Id). Decisão de implementação a confirmar com acesso ao Swagger v3 + Wesley.
- **Guardrail:** deploy de EF ad-hoc não-autenticada lendo tokens Tiny em produção foi (corretamente) bloqueado. Implementação real deve ser EF autenticada/revisada, não probe overnight.

## Riscos / decisões em aberto
- **Deploy de Edge Function** exige `SUPABASE_ACCESS_TOKEN` (historicamente bloqueado nesta conta — ver memória). Sem token, o sync/recalc não sobe.
- **Developer-Id**: precisa validar que o app Tiny da Pé Vermeio tem um Developer-Id habilitado para o array `mapeamentos`.
- **v2 vs v3**: doc lida é da API 2.0; o projeto usa v3 (`api.tiny.com.br/public-api/v3`). Confirmar o nome/forma do `mapeamentos`/`kit` no detalhe do produto v3 (Swagger `erp.tiny.com.br/public-api/v3/swagger`).
- **Rateio de kit**: confirmar com Wesley se kit usa custo próprio do kit no Tiny ou soma de componentes.

## Como rodar (validação ao vivo — pendente token)
Não executável neste spike (read-only/design): requer `Developer-Id` + token Tiny OAuth da conta. Próximo passo de validação ao vivo: chamar `GET /produtos/{id}` com `Developer-Id` para 1 produto kit conhecido (ex: o Tiny product do "Kit 10 Cuecas") e conferir `mapeamentos[].skuMapeamento == 'K10BMS2345GSORT'` e `kit[]` com os componentes.

## Sources
- [Tiny/Olist API 2.0 — Obter Produto](https://tiny.com.br/api-docs/api2-produtos-obter)
- [Tiny ERP API v3 Swagger](https://erp.tiny.com.br/public-api/v3/swagger/index.html)
- [Olist — integração Tiny/marketplaces (sincronizar anúncios por SKU)](https://ajuda.olist.com/ecommerce-erps/ecommerce-integracao-com-tiny-erp)
