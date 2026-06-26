# Phase 65 — Estoque a Chegar — VERIFICATION

**Data:** 2026-06-26 · **Projeto:** ckcdevcxgvueywivefgx · **Org Pé Vermeio:** 7f615df7-7bac-45e5-8a93-827fb9ddeec7

## Backend (aplicado + provado em prod via MCP)

| Item | Status | Prova |
|---|---|---|
| Tabela `purchase_orders` + RLS org-first | ✅ | migration `20260665000000`; policy SELECT `is_org_member`; índice `(organization_id, sku)` |
| EF `sync-tiny-purchase-orders` (v1) | ✅ | deploy MCP (verify_jwt=false); endpoint Tiny correto = `/ordem-compra` (singular); waitUntil 202; `organization_id` no insert |
| Sync rodado | ✅ | HTTP 202; **200 linhas, 135 SKUs, 22 OCs, 1.885 un**; entregas 08/06→04/09 |
| RPC `get_replenishment_by_sku` + a-caminho | ✅ | migration `20260665000100` (DROP+CREATE; +2 colunas `qtd_a_caminho`/`data_proxima_chegada`; CTE `incoming_by_sku`); SECURITY INVOKER mantido |
| Cron diário | ✅ | `sync-tiny-purchase-orders-daily` jobid 34 `15 3 * * *`, Bearer service_role_key do vault |

### Prova do desconto (decisão D-05: descontar TODA a qtd a caminho)
RPC retornou **332 linhas; 93 com a-caminho (1.403 un); 80 zeraram a sugestão** por já ter compra vindo.
- **Cobertura total:** `K6CBS2345SORG2` — estoque 0, a caminho 120 > ponto 32,9 → `compra_sugerida=0`, `gatilho_ativo=false`. ✅
- **Cobertura parcial:** `11011273-CAFE3374G` — estoque 1 + 52 a caminho = 53 < ponto 56,5 → ainda `compra_sugerida=10`, `gatilho_ativo=true`. ✅
- **Sem regressão:** fórmula idêntica à Phase 63 quando `qtd_a_caminho=0` (COALESCE→0 nos termos de gatilho/necessidade).
- **Anti-IDOR:** `purchase_orders` tem RLS SELECT org-first; RPC SECURITY INVOKER → org alheia = 0 linhas (estrutural, padrão Phase 63).

## Frontend (PR)
| Item | Status |
|---|---|
| Hook `useReplenishmentBySku`: tipos + map `qtd_a_caminho`/`data_proxima_chegada` + `total_a_caminho` no grupo | ✅ |
| Coluna "A caminho" (qtd + "chega DD/mês") em variação/grupo/item-único | ✅ |
| Tooltip explicando + aviso amarelo v1 trocado por nota "já desconta o estoque a chegar" | ✅ |
| `tsc --noEmit` 0 erros · `vitest` 208/208 · `npm run build` ok | ✅ |

## Pendente
- Ok visual do Wesley em `/compras` (preview/merge do PR).
- Decisão tunável: "a caminho" = situação `3` (aguardando recebimento). Ampliar p/ `2` (aprovada) é 1 linha em `SITUACOES_A_CAMINHO` na EF se o Wesley quiser.
