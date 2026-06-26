# 64 — sync-tiny-costs: importar TODOS os custos (remover cap de 80)

**Origem (2026-06-26):** Wesley apontou que produtos sem custo na tela /compras (Phase 63) **têm** custo no Tiny. Diagnóstico ao vivo (prod `ckcdevcxgvueywivefgx`, org Pé Vermeio `7f615df7-7bac-45e5-8a93-827fb9ddeec7`) confirmou a causa-raiz na EF `sync-tiny-costs`:

- `fetchAllProducts` pagina todos os produtos ativos do Tiny e extrai custo da LISTAGEM (`precos.precoCustoMedio`/`precoCusto`).
- **Fase 1**: produtos com custo na listagem (`cost > 0`) → upsert todos (`withPrice`).
- **Fase 2**: produtos SEM custo na listagem (`cost === 0`, precisam de `/produtos/{id}` detalhe) → **`withoutPrice.slice(0, 80)`** (index.ts ~linha 207). Comentário: "Cap at 80 products to stay within the 150s timeout". **Pega sempre os mesmos 80 primeiros** → produtos além do 80 NUNCA são importados, mesmo no cron diário (`sync-tiny-costs-daily` 3h). `skippedDetail` (linha ~247) conta os ignorados.
- Resultado: marcas de revenda (Pralana/TXC/Sandrini) cujo custo só vem no detalhe ficam sem custo. `ml_product_costs` tem só 604 SKUs.

**Impacto medido:** 306 SKUs vendidos/90d → **29 sem custo** (4 marcas); margem/DRE subestimada neles. Tela /compras: 37 sem custo (11%).

**Caso à parte (NÃO é este fix):** "Arizona Vi Rodeio" `MLB4587613312` tem SKU vazio no PRÓPRIO ML (provado via API `/items/{id}/variations`) → Wesley cadastra SELLER_SKU no anúncio. Fora do escopo desta correção.

## Constantes relevantes (supabase/functions/sync-tiny-costs/index.ts)
`RATE_MS=1100` (60 req/min), `BATCH_SIZE=50`. `tinyGet` lança em 429. Detalhe = 1 req c/ `sleep(RATE_MS)` entre cada. Auth: service-role-key OU user JWT. Chamada por cron diário + manual (`/integracoes`). Hoje **NÃO** usa `EdgeRuntime.waitUntil`.

## Solução (a detalhar no plano)
1. **`EdgeRuntime.waitUntil`** — retornar 202 imediato e processar a Fase 2 em background (lição Phase 59 / [[project_garment_session_20260625b]]: EF longa + pg_cron → pg_net derruba aos 5s antes do commit). O cron precisa do 202 rápido.
2. **Priorizar FALTANTES** — antes da Fase 2, carregar o conjunto de `seller_sku` já presentes em `ml_product_costs` (org/loja) e ordenar `withoutPrice` com os que **ainda não têm custo** primeiro. Assim os 29 faltantes entram já na 1ª execução.
3. **Elevar o cap** de 80 para um valor que cubra os faltantes com folga (ex: 250) **+ guarda de tempo** (parar a Fase 2 ao atingir ~120s decorridos e deixar o resto para a próxima execução — rotação natural, já que processados ganham custo e saem da fila de faltantes). Não remover o cap totalmente sem guarda (risco de wall-clock).

## Critérios de aceite
- Após deploy + re-rodar o sync para Pé Vermeio (`ml_user_id=1639558873`), `ml_product_costs` ganha os custos faltantes e `custo_ausente` na RPC `get_replenishment_by_sku` cai (alvo: dos 37, sobram só os ~4 de SKU vazio no ML).
- SKUs vendidos/90d sem custo cai de 29 para perto de 0 (exceto SKU vazio no ML).
- A EF responde rápido (202) e completa a importação em background sem 429 fatal (respeitar RATE_MS).
- Sem regressão: produtos com custo na listagem (Fase 1) continuam importados; deno check verde.

## Fora de escopo (YAGNI)
- Não criar editor manual de custo na UI. Não mexer na RPC de reposição nem no frontend. Não tocar outras EFs. Não resolver o SKU vazio no ML (é cadastro no anúncio).
