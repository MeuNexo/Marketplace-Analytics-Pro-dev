# Gate de não-regressão — baseline da reposição ANTES da RPC v2

**Capturado em:** 2026-08-04 ~22:30 UTC
**Task:** 6 do plano `2026-08-04-reposicao-fonte-unica.md`
**Por quê:** depois que a Task 7 trocar a CTE base da RPC, este retorno é irrecuperável.
A Task 8 compara contra ele para provar que **nenhum SKU que hoje aparece sumiu** e que
**nenhuma compra sugerida hoje diminuiu sem explicação**.

## Como foi capturado

```sql
create table public.gate_reposicao_baseline as
select sku_code, item_id, variation_id, sku_stock, venda_dia,
       compra_sugerida, gatilho_ativo, venda_dia_origem
from public.get_replenishment_by_sku(
  '7f615df7-7bac-45e5-8a93-827fb9ddeec7'::uuid,  -- Pé Vermeio
  30,    -- p_sales_window_days
  1.0,   -- p_demand_multiplier
  true); -- p_smart
```

Assinatura confirmada em `pg_get_function_identity_arguments`:
`p_org_id uuid, p_sales_window_days integer, p_demand_multiplier numeric, p_smart boolean`.

## O baseline

| Medida | Valor |
|---|---|
| Linhas devolvidas pela RPC | **299** |
| SKUs distintos | 299 |
| Com `compra_sugerida > 0` | 130 |
| **Total de unidades sugeridas** | **1.785** |
| Soma de `sku_stock` | 1.174 |
| Com `gatilho_ativo` | 194 |
| Com `venda_dia > 0` | 182 |
| Com `sku_stock > 0` | 166 |

## ⚠️ O diagnóstico registrado não se reproduz — e o número real é outro

A spec e a memória do projeto dizem **"86 de 681 SKUs (~13%)"**. Medido ao vivo agora:

| Fonte | Contagem |
|---|---|
| SKUs que a RPC devolve hoje | **299** |
| SKUs úteis no catálogo do Tiny (`tipo_variacao` V ou N) | **673** |
| Anúncios ML ativos (`ml_inventory_cache`, status='active') | 142 |

**Cobertura real hoje: 299 / 673 = 44,4%** — não 13%.

Não sei dizer se o "86" foi medido com outros parâmetros, com outra régua de denominador,
ou se o dado mudou desde então (o `ml_inventory_cache` pode ter sincronizado mais anúncios).
**Não vou repetir o 13% como se fosse atual.**

**A tese da fase continua de pé, com magnitude corrigida:** **374 SKUs (55,6%) do catálogo
seguem invisíveis** para a decisão de compra. O alvo da Task 8 passa a ser esta linha de
base — 299 SKUs e 1.785 unidades — e não a de 86.

## O que a Task 8 tem que provar

1. **Nenhum dos 299 SKUs do baseline sumiu** do retorno da RPC v2.
2. Para os SKUs que existem nos dois lados, `compra_sugerida` só pode **cair** se o estoque
   do CD explicar a queda (era invisível antes, agora desconta) — nunca por SKU ter sumido
   da lista-base.
3. Os SKUs novos que entrarem sem anúncio ML ativo têm de vir com
   `tem_anuncio_ativo = false` e `compra_sugerida = 0` (D-1).

A tabela `public.gate_reposicao_baseline` fica no banco para a Task 8 consultar.
