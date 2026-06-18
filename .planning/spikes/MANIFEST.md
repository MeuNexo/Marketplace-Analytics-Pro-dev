# Spike Manifest

## Idea
Popular `orders.custo_unit` (e portanto CMV/DRE e "Markup por Marca") resolvendo o custo por pedido ML a partir do Tiny, mapeando ML↔Tiny (kit-aware). Hoje `orders.custo_unit` é ~98% nulo porque a chave ML (item_id MLB/sku do anúncio) não casa com a chave Tiny (seller_sku) — e o vínculo correto (`skuMapeamento` = `orders.sku`) só existe na API Tiny.

## Requirements
- O elo correto é `mapeamentos[].skuMapeamento` (API Tiny) = `orders.sku`. Não usar match SKU↔seller_sku (cobre só ~2%).
- Kit: custo = Σ(custo componente × quantidade) via `kit[]`.
- `mapeamentos[]` exige header `Developer-Id` válido — dependência a validar.

## Spikes

| # | Name | Type | Validates | Verdict | Tags |
|---|------|------|-----------|---------|------|
| 001 | mapeamento-ml-tiny-custo | standard | ML item_id/sku → Tiny (kit-aware) → custo via API Tiny | VALIDATED (viável, caveat Developer-Id) | tiny, custo, kit, mapeamento |
