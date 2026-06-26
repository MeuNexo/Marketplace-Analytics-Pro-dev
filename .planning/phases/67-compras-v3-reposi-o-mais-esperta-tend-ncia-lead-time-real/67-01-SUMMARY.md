---
phase: 67-compras-v3-reposi-o-mais-esperta-tend-ncia-lead-time-real
plan: 01
subsystem: database
tags: [supabase, postgresql, rpc, ewma, sazonalidade, lead-time, reposicao, plpgsql]

# Dependency graph
requires:
  - phase: 66-compras-v2-fornecedor-e-sku
    provides: RPC get_replenishment_by_sku (3-arg) com fornecedor_by_sku, params por escopo SKU/fornecedor/marca/global, tabela purchase_orders
  - phase: 65-estoque-a-chegar
    provides: tabela purchase_orders com data_pedido/data_entrega usada pelo lead time real
  - phase: 63-compras-por-sku
    provides: tabela orders + ml_inventory_cache; CTEs inventory_by_sku/sales_by_sku/incoming_by_sku intocadas
provides:
  - RPC get_replenishment_by_sku v7 assinatura (UUID, INTEGER, NUMERIC, BOOLEAN) com toggle p_smart
  - CTE ewma_sales — EWMA decrescente POWER(0.7, week_offset) sobre 84d, threshold >=2 semanas
  - CTE seasonal_index — ratio-to-average por marca/mes-corrente, threshold >=12 meses, clamp [0.5,2.5]
  - CTE lead_time_by_fornecedor — mediana percentile_cont(0.5) por fornecedor, threshold >=2 OCs
  - 5 colunas de transparencia: venda_dia_origem, lead_time_origem, tendencia, fator_sazonal, lead_time_real
  - Nao-regressao provada: p_smart=FALSE reproduz EXATAMENTE avg_daily da Phase 66
affects:
  - "67-02 — badge de transparencia consome as 5 colunas novas"
  - "67-03 — toggle p_smart na UI deve passar p_smart=true explicitamente (DEFAULT SQL e FALSE)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "EWMA temporal: POWER(0.7, week_offset) com week_offset = offset REAL de semanas via DATE_TRUNC"
    - "Sazonalidade ratio-to-average por nivel de marca com clamp [0.5,2.5] e threshold 12 meses"
    - "Lead time mediano via percentile_cont(0.5) WITHIN GROUP por fornecedor"
    - "Fallback por dimensao independente: cada camada esperta ligan so quando limiar atingido"
    - "#variable_conflict use_column para evitar colisao entre RETURNS TABLE e variaveis PL/pgSQL"
    - "p_smart = TRUE em cada CTE nova como short-circuit + anti-IDOR paranoia"

key-files:
  created:
    - supabase/migrations/20260667000100_get_replenishment_by_sku_smart.sql
  modified: []

key-decisions:
  - "p_smart DEFAULT FALSE (nao TRUE como no plano original): frontend legado (3-arg via PostgREST) reproduz Phase 66 sem regressao ate o toggle (67-03) entrar; a UI passa p_smart=true explicitamente quando toggle ON"
  - "DROP overload 3-arg da Phase 66: overloads ambiguos impediam resolucao de chamadas de 3 args ('function is not unique'); o 4-arg com defaults substitui completamente"
  - "Sazonalidade ligou legitimamente (284 SKUs): dados vao de 2025-05 a 2026-06 (~13 meses), cobrindo o limiar de 12 meses; nao e fallback como o research previa"
  - "SECURITY INVOKER mantido + organization_id = p_org_id em cada CTE nova: padrao anti-IDOR parametrico da Phase 43"
  - "Assinatura final para 67-02/67-03: get_replenishment_by_sku(UUID, INTEGER, NUMERIC, BOOLEAN)"

patterns-established:
  - "Overload ambiguo: sempre DROP assinaturas legadas antes de adicionar defaults a novos params"
  - "#variable_conflict use_column: usar sempre que RETURNS TABLE e corpo PL/pgSQL compartilham nomes de coluna"
  - "Short-circuit EWMA/sazonal/lead-time: filtrar p_smart = TRUE dentro da subquery evita custo + garante anti-IDOR"

requirements-completed: [SMART-01, SMART-02, SMART-03, SMART-04]

# Metrics
duration: ~90min
completed: 2026-06-26
status: complete
---

# Phase 67 Plan 01: RPC get_replenishment_by_sku v7 (EWMA + sazonalidade + lead time real) Summary

**RPC esperta com p_smart toggle aplicada e validada em prod: EWMA+sazonalidade ativa em 171 SKUs, lead time real em 93 SKUs, nao-regressao perfeita (off_nao_simples=0 com p_smart=FALSE), 3 desvios corrigidos no checkpoint**

## Performance

- **Duration:** ~90 min
- **Started:** 2026-06-26
- **Completed:** 2026-06-26
- **Tasks:** 2/2
- **Files modified:** 1

## Accomplishments

- Migration `20260667000100_get_replenishment_by_sku_smart.sql` escrita com RPC v7: 4 parametros, 3 CTEs novas (ewma_sales, seasonal_index, lead_time_by_fornecedor), 5 colunas de transparencia (venda_dia_origem, lead_time_origem, tendencia, fator_sazonal, lead_time_real)
- Aplicada e validada em prod `ckcdevcxgvueywivefgx` pelo orquestrador via MCP; 332 SKUs processados
- Nao-regressao provada ao SKU: p_smart=FALSE produce 100% venda_dia_origem='simples', off_nao_simples=0 (identicidade com Phase 66)
- EWMA ativa: 171 SKUs com calculo esperto (27 com origem 'ewma', 144 com 'ewma_sazonal'); 126 SKUs com venda_dia diferente, 76 com compra_sugerida diferente
- Sazonalidade ativa legitimamente: 284 SKUs beneficiados (dados cobrem ~13 meses, superando limiar de 12); fatores saudaveis min=0.93/max=1.68/avg=1.05/0 no clamp
- Lead time real ativo: 93 SKUs com fornecedores com >=2 OCs usando mediana real no lugar do param fixo
- Anti-IDOR provado: org alheia retorna 0 linhas; advisors sem novos ERROR/WARN

## Task Commits

1. **Task 1: Escrever migration RPC esperta** - `f8e2ed81` (feat)
2. **Task 2: Correcoes pos-checkpoint (3 desvios)** - `155f76d3` (fix)

## Files Created/Modified

- `supabase/migrations/20260667000100_get_replenishment_by_sku_smart.sql` — RPC get_replenishment_by_sku v7 com p_smart, ewma_sales, seasonal_index, lead_time_by_fornecedor, 5 colunas novas; DROP overload 3-arg; GRANT assinatura (UUID, INTEGER, NUMERIC, BOOLEAN)

## Decisions Made

- **p_smart DEFAULT FALSE** (mudou de TRUE para FALSE): garante que o frontend legado (PostgREST resolucao de 3 args) reproduza exatamente a Phase 66 sem regressao, ate o toggle da Phase 67-03 entrar. A UI passara p_smart=true quando toggle ON.
- **DROP overload 3-arg**: obrigatorio para eliminar a ambiguidade de resolucao de overloads no PostgreSQL.
- **Sazonalidade nao e fallback**: com 13 meses de dados, o limiar de 12 meses ja e atingido; 284 SKUs com fatores saudaveis (nenhum no clamp).

## Deviations from Plan

### Auto-fixed Issues (corrigidos no checkpoint — commit 155f76d3)

**1. [Rule 1 - Bug] Overload ambiguo impedindo chamadas de 3 args**
- **Found during:** Task 2 (validacao em prod pelo orquestrador)
- **Issue:** A assinatura de 4-arg com DEFAULT coexistia com a assinatura de 3-arg da Phase 66, tornando chamadas de 3 args ambiguas: `ERROR: function get_replenishment_by_sku(uuid, integer, numeric) is not unique`. PostgREST (e qualquer chamada legada sem p_smart) ficava bloqueado.
- **Fix:** `DROP FUNCTION public.get_replenishment_by_sku(UUID, INTEGER, NUMERIC)` adicionado ao inicio da migration, eliminando o overload de 3-arg. O 4-arg com DEFAULT FALSE assume todas as chamadas.
- **Files modified:** supabase/migrations/20260667000100_get_replenishment_by_sku_smart.sql
- **Verification:** Chamada de 3 args resolve para o 4-arg; nao-regressao confirmada (p_smart=FALSE=DEFAULT).
- **Committed in:** 155f76d3

**2. [Rule 1 - Bug] p_smart DEFAULT mudado de TRUE para FALSE**
- **Found during:** Task 2 (analise do impacto do overload fix)
- **Issue:** Com DEFAULT TRUE, o frontend legado (que nao passa p_smart) passaria automaticamente a usar EWMA sem que o toggle fosse criado (Phase 67-03), quebrando a auditabilidade das sugestoes de compra existentes.
- **Fix:** `p_smart BOOLEAN DEFAULT FALSE` — legado continua com calculo simples (Phase 66); modo esperto so liga quando a UI passa `p_smart=true` explicitamente. A UI (67-03) controlara o "ON por padrao" passando p_smart=true.
- **Files modified:** supabase/migrations/20260667000100_get_replenishment_by_sku_smart.sql
- **Verification:** p_smart=FALSE produce 100% venda_dia_origem='simples'; off_nao_simples=0.
- **Committed in:** 155f76d3

**3. [Rule 1 - Bug] `column reference "item_id" is ambiguous` nas CTEs**
- **Found during:** Task 2 (aplicacao da migration em prod retornou erro de compilacao PL/pgSQL)
- **Issue:** As colunas declaradas em `RETURNS TABLE` (ex: `item_id UUID`) viram variaveis PL/pgSQL no corpo da funcao e colidiram com referencias nao-qualificadas em CTEs como `seasonal_index` (subquery em `brand_by_item`, `monthly_raw`, `stats`).
- **Fix:** Duas acoes combinadas: (a) `#variable_conflict use_column` no topo do corpo da funcao (pragma PL/pgSQL que da prioridade as colunas sobre as variaveis); (b) qualificacao explicita das referencias ambiguas nas CTEs afetadas.
- **Files modified:** supabase/migrations/20260667000100_get_replenishment_by_sku_smart.sql
- **Verification:** Migration compilou sem erros; 332 SKUs retornados corretamente.
- **Committed in:** 155f76d3

---

**Total deviations:** 3 auto-fixed (todos Rule 1 — bugs descobertos na aplicacao em prod)
**Impact on plan:** Nenhum impacto no escopo ou na assinatura final. Todos os desvios eram necessarios para que a migration compilasse e funcionasse corretamente. A unica mudanca de comportamento observavel e o DEFAULT FALSE (vs TRUE previsto no research), que e mais conservador e correto para o cenario legado.

## Issues Encountered

- **Open question B (tipo de data_entrega - data_pedido):** Confirmado que o resultado e INTEGER (nao INTERVAL) — nao foi necessario trocar para `EXTRACT(DAY FROM ...)`. CTE lead_time_by_fornecedor funcionou diretamente.
- **Open question A (sazonalidade):** Contrariando a previsao do research (provavel fallback fator=1.0), os dados de orders cobrem 13 meses-calendario, ativando sazonalidade legitimamente para 284 SKUs.
- **Open question C (lead time):** 93 SKUs com fornecedores com >=2 OCs confirmados; lead_time_real ativo.

## Nota Importante para 67-02 e 67-03

**Assinatura final da RPC:** `get_replenishment_by_sku(p_org_id UUID, p_top INTEGER, p_min_coverage NUMERIC, p_smart BOOLEAN)`

**p_smart DEFAULT FALSE no SQL.** O frontend legado (sem p_smart) usa calculo simples = Phase 66. A UI do toggle (Phase 67-03) deve passar `p_smart=true` explicitamente quando o toggle estiver ON — nao confiar no DEFAULT.

As 5 colunas de transparencia estao na ULTIMA posicao do RETURNS TABLE (nao reordenam as existentes):
- `venda_dia_origem TEXT` — 'ewma_sazonal' | 'ewma' | 'simples'
- `lead_time_origem TEXT` — 'fornecedor_real' | 'param'
- `tendencia TEXT` — '+' | '-' | '~' (threshold 20% ewma_recent vs ewma_older)
- `fator_sazonal NUMERIC` — NULL se nao aplicado
- `lead_time_real INTEGER` — NULL se oc_count < 2

## Next Phase Readiness

- **67-02 (badges de transparencia):** Pode comecar imediatamente. As 5 colunas estao em prod e retornando dados reais. Usar `venda_dia_origem`, `lead_time_origem`, `tendencia`, `fator_sazonal`, `lead_time_real` para exibir badges na pagina /compras.
- **67-03 (toggle p_smart na UI):** Deve passar `p_smart=true` explicitamente na chamada RPC quando toggle ON. DEFAULT SQL e FALSE. Sem o toggle, a UI continua mostrando calculo simples (Phase 66).
- Sem blockers — fundacao das Phases 62-66 intocada.

---
*Phase: 67-compras-v3-reposi-o-mais-esperta-tend-ncia-lead-time-real*
*Completed: 2026-06-26*
