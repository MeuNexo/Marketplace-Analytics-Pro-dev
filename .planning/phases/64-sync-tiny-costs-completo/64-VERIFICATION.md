# 64-01 VERIFICATION — sync-tiny-costs (custos completos)

**Veredito: PASS (provado em prod ckcdevcxgvueywivefgx, org Pé Vermeio).**

## Causa-raiz real (≠ plano inicial)
O upsert gravava só `user_id`; `ml_product_costs.organization_id` é NOT NULL sem
default/trigger → upsert falhava silencioso (0 gravações). Cap 80 era causa do custo
ausente HISTÓRICO, mas o "0 gravações" no re-sync era o organization_id. Fix: incluir
`organization_id` (de ml_tokens) no upsert + gravação incremental por página + cap 250/90s.

## Provas
- ml_product_costs: 604 → 633 (Fase 1 incremental gravou; updated_at avançou).
- RPC get_replenishment_by_sku custo_ausente: 37 (11,1%) → 12 (3,6%).
- 12 restantes: 4 = Arizona Vi Rodeio SEM SKU no ML (comprar 69 — cadastro do Wesley);
  8 = comprar=0 (sem giro/estoque ok, sem impacto na decisão).
- EF v14 retorna 202 (~220ms); background grava (waitUntil OK).
- deno check verde. verify_jwt=false preservado.

## Infra
- Cron `sync-tiny-costs-daily` (3h) corrigido: tinha header só Content-Type (401, nunca
  rodava desde 04/06) → adicionado Authorization Bearer service_role_key (cron.alter_job).

## Pendente
- ok do Wesley; merge do branch gsd/fix-sync-tiny-costs-completo (PR separado do #12).
