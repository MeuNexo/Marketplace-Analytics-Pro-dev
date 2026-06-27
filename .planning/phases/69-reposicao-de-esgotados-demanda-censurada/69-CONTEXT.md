# Phase 69: Reposição de esgotados (demanda censurada) - Context

**Gathered:** 2026-06-27
**Status:** Ready for planning
**Source:** Brainstorming aprovado por Wesley → spec `docs/superpowers/specs/2026-06-27-reposicao-esgotados-design.md`

<domain>
## Phase Boundary

Melhoria do **motor de cálculo** da `/compras` (RPC `get_replenishment_by_sku` +
frontend), sobre a fundação das Phases 62–68. **Não** mexe em fundação de dados,
sync, nem na RPC `get_replenishment` (Phase 62, intocada).

**Problema:** SKUs esgotados (`sku_stock = 0`) que não venderam nos últimos 30d
**porque estavam esgotados** ficam com `venda_dia = 0` → `compra_sugerida = 0` e
somem da compra, mesmo com demanda real. É demanda censurada / lost sales.

**Evidência (prod ckcdevcxgvueywivefgx, Pé Vermeio, 2026-06-27):** 293 SKUs, 170
com gatilho aceso mas só 87 com compra. Os 83 com gatilho e compra zero são TODOS
`sku_stock=0` E `venda_dia=0`. Desses 83: 15 venderam ≤90d, 54 ≤180d, 70 ≤365d,
13 sem venda há +1 ano; média 159 dias desde a última venda. Não há histórico de
estoque diário (`ml_inventory_cache` é só snapshot atual) → estimar pelas vendas.
</domain>

<decisions>
## Implementation Decisions (TRAVADAS com Wesley)

### Classificação por recência (3 baldes) — aplica só a esgotado + venda 30d = 0
- 🔴 `repor_esgotado`: última venda ≤ **90d** → estima venda/dia e **sugere compra**.
- ⚠️ `revisar_esgotado`: última venda **90–365d** → **sinaliza, sem quantidade**.
- ⚫ `descontinuar`: sem venda há **+1 ano** → fora da compra (cauda morta).
- SKUs com giro normal (venda 30d > 0) seguem o caminho atual, **intocados** →
  recebem `status_esgotado = 'com_giro'`.
- Cortes 90d/365d e janela de estimativa 180d são **parâmetros** (constantes da RPC
  com default; calibráveis sem deploy quando viável via `replenishment_params`).

### Estimativa de venda/dia (balde 🔴)
- **Melhor ritmo**: a maior soma de vendas numa janela móvel de **30 dias dentro
  dos últimos 180 dias**, ÷ 30. (Reflete a demanda de quando TINHA estoque; corrige
  o viés de dividir pela janela cheia, que subestima quem ficou esgotado.)
- **Proteção anti-pico**: exige ≥ **2 dias distintos com venda** no histórico pra
  usar a taxa; senão cai numa estimativa conservadora (média 90d). Evita inflar por
  1 venda em atacado.
- A partir da venda/dia estimada, **reusa exatamente** a matemática atual
  (`ponto`/`alvo`/MOQ/pack/desconto de a-caminho). Nada muda no cálculo — só a fonte
  da venda/dia. O `alvo` já usa `GREATEST(meta_cobertura, lead_time+7)+safety` (fix
  quick 260627-1z0).

### Transparência (RPC + tela)
- RPC ganha coluna `status_esgotado` (`com_giro`/`repor_esgotado`/`revisar_esgotado`/`descontinuar`).
- `venda_dia_origem` ganha o valor `historico_esgotado` quando a venda/dia veio da estimativa.
- Tela `/compras`: coluna "O que fazer" ganha os 3 estados; badge na linha
  **"estoque zerado · demanda estimada pelo histórico"** + a venda/dia usada; filtro
  "Situação" ganha as 3 opções novas. Distinguir SEMPRE estimado de real.

### Invariantes
- RPC continua **SECURITY INVOKER** (RLS org-first; anti-IDOR provado = 0 linhas cross-org).
- Aplicar migration via **MCP `apply_migration`** (nunca `supabase db push` — CLI no projeto errado).
- Espelho TS (`replenishmentUtils`) cobre classificação + estimativa; tsc/build/vitest
  sem regressão das Phases 62–68.

### Claude's Discretion
- Forma exata das CTEs (janela móvel de 30d: gerar série ou agrupar por bucket).
- Onde armazenar os cortes (constantes vs colunas em `replenishment_params`).
- Rótulos/ícones PT exatos dos 3 estados na coluna "O que fazer" (seguir o padrão
  leigo já existente — 63-05).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### RPC (backend) — base a estender
- `supabase/migrations/20260668000300_get_replenishment_by_sku_alvo_order_up_to.sql` — versão ATUAL em prod da RPC (copiar como base da migration nova; é o `pg_get_functiondef` vigente). Contém CTEs: `inventory_by_sku`, `row_sales`, `canon` (colapsa espelhos por sku_code), `sales_by_sku`, `incoming_by_sku`, `fornecedor_by_sku`, `ewma_sales`, `seasonal_index`, `lead_time_by_fornecedor`, `sales_smart`, `params`, `base`, `calc`.
- `supabase/migrations/20260668000200_get_replenishment_by_sku_engine_max_confidence.sql` — motor simples/inteligente (contexto Phase 68).

### Frontend `/compras`
- `src/pages/mercadolivre/MLCompras.tsx` — página /compras.
- `src/hooks/useReplenishmentBySku.ts` — hook que chama a RPC.
- `src/lib/analysis/replenishmentUtils.ts` + `.test.ts` — espelho TS testável (estender).
- `src/components/mercadolivre/ReplenishmentSkuTable.tsx` — tabela (coluna "O que fazer").
- `src/components/mercadolivre/ReplenishmentSkuFilters.tsx` — filtro "Situação".
- `src/integrations/supabase/types.ts` — tipos da RPC (atualizar manualmente, NÃO regenerar).

### Spec / decisões
- `docs/superpowers/specs/2026-06-27-reposicao-esgotados-design.md` — design aprovado.

### Identificadores
- Supabase projeto: `ckcdevcxgvueywivefgx`. Org Pé Vermeio: `7f615df7-7bac-45e5-8a93-827fb9ddeec7`.
- Tabela de vendas real: **`orders`** (não `ml_orders`); `data_pedido` é **TEXT** → `::timestamptz::date`; status real `paid`/`cancelled`/`partially_refunded` (sem `confirmed`).
</canonical_refs>

<specifics>
## Specific Ideas

- A classificação precisa da **última venda por SKU canônico** (mesma chave do CTE
  `canon`: `seller_custom_field` quando presente, senão `item_id::variation_id`).
- A janela de "melhor ritmo" usa as mesmas `orders` (status `paid`) dos últimos 180d.
- Garantir que `descontinuar` e `revisar_esgotado` NÃO entrem no `sum(compra_sugerida)`
  do total da tela.
- Reusar os badges/tooltip já criados no 63-05 e 67 (toggle "Cálculo esperto").
</specifics>

<deferred>
## Deferred Ideas

- Reconstruir histórico de estoque diário (não temos; fora de escopo).
- Automatizar a ação de descontinuar (só marca; decisão é do Wesley).
- Previsão/ML de demanda além do "melhor ritmo".
- Snooze/ocultar SKUs marcados `descontinuar` (pode virar follow-up).
</deferred>

---

*Phase: 69-reposicao-de-esgotados-demanda-censurada*
*Context gathered: 2026-06-27 via brainstorming + spec aprovado por Wesley*
