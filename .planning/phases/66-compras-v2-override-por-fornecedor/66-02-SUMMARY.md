---
phase: 66-compras-v2-override-por-fornecedor
plan: "02"
subsystem: database
tags: [supabase, rpc, postgresql, replenishment, security-invoker, rls, idor]

# Dependency graph
requires:
  - phase: 66-compras-v2-override-por-fornecedor
    plan: "01"
    provides: "tabela replenishment_params com scope='fornecedor' em prod + nomes de fornecedor validados nas OCs"
  - phase: 65-compras-estoque-a-chegar
    provides: "RPC get_replenishment_by_sku (Phase 65 baseline) + tabela purchase_orders com coluna fornecedor"
provides:
  - "RPC get_replenishment_by_sku estendida com CTE fornecedor_by_sku e COALESCE de 4 níveis (SKU > fornecedor > marca > global) para lead_time, cobertura, safety, MOQ e pack"
  - "Nova coluna param_origem com valor 'fornecedor' quando param de fornecedor predominante está ativo"
  - "RPC get_purchase_order_suppliers(p_org_id UUID) retornando fornecedores distintos das OCs — alimenta o dropdown da UI"
  - "Ambas as RPCs SECURITY INVOKER com REVOKE anon/PUBLIC e GRANT authenticated — anti-IDOR provado em prod"
affects:
  - "66-03 (UI override por fornecedor) — consome get_purchase_order_suppliers para dropdown e param_origem='fornecedor' para exibição"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DISTINCT ON (sku_code) para fornecedor predominante: subquery agrega SUM(quantidade)/MAX(data) por SKU+fornecedor, DISTINCT ON pega o maior por SKU"
    - "forn.fornecedor direto (sem COALESCE(...,'')) nos subselects do CTE params — NULL não casa com nenhum scope_value, COALESCE cai no próximo nível silenciosamente"
    - "CREATE OR REPLACE compatível: mesma assinatura e RETURNS TABLE da Phase 65, sem regressão"

key-files:
  created:
    - supabase/migrations/20260666000100_get_replenishment_by_sku_fornecedor.sql
    - supabase/migrations/20260666000200_get_purchase_order_suppliers_rpc.sql
  modified: []

key-decisions:
  - "Fornecedor predominante = maior SUM(quantidade) de OCs; desempate = OC mais recente (MAX(data_entrega|data_pedido)). DISTINCT ON exige sku_code como 1º campo do ORDER BY (Pitfall 4 do RESEARCH)"
  - "forn.fornecedor usado DIRETO (sem COALESCE(...,'')) no lookup do nível fornecedor — garante que SKU sem OC pule o nível fornecedor silenciosamente, caindo em marca/global sem erro"
  - "SECURITY INVOKER nas duas RPCs: RLS de purchase_orders (is_org_member) e replenishment_params bloqueia enumeração cross-org sem repassar SECURITY DEFINER para a função"
  - "FORN-03 coberto (precedência 4 níveis + mapeamento predominante); FORN-05 backend coberto (anti-IDOR INVOKER + sem regressão Phase 63)"

patterns-established:
  - "Padrão CTE predominante: subquery GROUP BY (sku, coluna) + DISTINCT ON (sku) ORDER BY sku, aggregate DESC — mesmo padrão da CTE incoming_by_sku (Phase 65)"
  - "REVOKE EXECUTE FROM PUBLIC, anon + GRANT EXECUTE TO authenticated: padrão obrigatório para novas RPCs de leitura org-scoped nesta plataforma"

requirements-completed: [FORN-03, FORN-05]

# Metrics
duration: N/A (continuation agent — tasks executadas por agente anterior e orquestrador)
completed: "2026-06-26"
status: complete
---

# Phase 66 Plan 02: Backend — RPC Precedência Fornecedor + Suppliers Summary

**RPC get_replenishment_by_sku estendida para COALESCE de 4 níveis (SKU>fornecedor>marca>global) via CTE fornecedor_by_sku predominante, mais RPC get_purchase_order_suppliers para dropdown — ambas SECURITY INVOKER, aplicadas e validadas em prod (precedência/anti-IDOR/advisors OK)**

## Performance

- **Duration:** N/A (continuation agent)
- **Started:** N/A
- **Completed:** 2026-06-26
- **Tasks:** 3 (2 auto + 1 checkpoint:human-verify)
- **Files modified:** 2 migrations criadas

## Accomplishments

- RPC `get_replenishment_by_sku` estendida com CTE `fornecedor_by_sku` (DISTINCT ON predominante por SUM(quantidade), desempate por data) e COALESCE de 4 níveis inserido nas 5 colunas de params (lead_time, cobertura, safety, MOQ, pack) — `param_origem='fornecedor'` retornável via novo ramo no CASE
- RPC `get_purchase_order_suppliers(p_org_id UUID)` criada com SELECT DISTINCT das OCs da org, SECURITY INVOKER, REVOKE anon/PUBLIC + GRANT authenticated — alimenta o dropdown de seleção de fornecedor da UI (plan 66-03)
- Validação em prod (`ckcdevcxgvueywivefgx`): param de teste para ZEBU INDUSTRIA DE BOTINAS LTDA resultou em 8 SKUs mudando de `param_origem='global'` para `'fornecedor'` com lead_time=99; distribuição final 19 fornecedor + 130 marca + 183 global = 332 linhas; anti-IDOR org alheia = 0; 6 fornecedores retornados pelo suppliers RPC; advisors sem novos issues

## Task Commits

1. **Task 1: get_replenishment_by_sku com CTE fornecedor_by_sku + precedência de 4 níveis** - `9963c3c9` (feat)
2. **Task 2: RPC get_purchase_order_suppliers para dropdown de fornecedores** - `49caa0a2` (feat)
3. **Task 3: Aplicar migrations via MCP + validar precedência, sem-regressão e anti-IDOR** — aprovado pelo Wesley via orquestrador (checkpoint:human-verify, sem commit de código)

## Files Created/Modified

- `supabase/migrations/20260666000100_get_replenishment_by_sku_fornecedor.sql` — CREATE OR REPLACE da RPC com CTE fornecedor_by_sku (DISTINCT ON predominante), COALESCE de 4 níveis nas 5 colunas de params, ramo THEN 'fornecedor' no CASE de param_origem. SECURITY INVOKER. Mesma assinatura e RETURNS TABLE da Phase 65 (CREATE OR REPLACE compatível)
- `supabase/migrations/20260666000200_get_purchase_order_suppliers_rpc.sql` — RPC get_purchase_order_suppliers(p_org_id UUID) LANGUAGE sql SECURITY INVOKER, SELECT DISTINCT ORDER BY fornecedor; REVOKE PUBLIC/anon + GRANT authenticated

## Decisions Made

- Fornecedor predominante determinado por maior SUM(quantidade) de OCs; desempate pela OC mais recente — mesma lógica do módulo incoming_by_sku da Phase 65
- forn.fornecedor usado diretamente (sem COALESCE para '') nos subselects do nível fornecedor: quando NULL (SKU sem OC), não casa com nenhum scope_value e o COALESCE externo cai no nível marca/global silenciosamente — sem erro, sem regressão
- DISTINCT ON exige sku_code como primeiro campo do ORDER BY (Pitfall 4 do RESEARCH); violação causaria erro de PostgreSQL em runtime

## Deviations from Plan

None - plan executado exatamente como escrito. As 3 mudanças cirúrgicas (CTE, COALESCE 4 níveis, ramo CASE) foram aplicadas sem alterar o restante da RPC (base CTE, SELECT final, fórmula de gatilho/compra, REVOKE/GRANT). Validação de prod confirmou precedência, sem regressão e anti-IDOR conforme definido nos must_haves.

## Issues Encountered

None. A validação em prod revelou comportamento correto em todos os cenários do plano: precedência fornecedor quando param cadastrado, fallback para marca/global quando ausente, 0 linhas para org alheia, advisors limpos.

## User Setup Required

None - migrations aplicadas em prod pelo orquestrador via MCP `apply_migration`. Nenhuma configuração manual de ambiente requerida.

## Next Phase Readiness

- Backend completo para Phase 66-03 (UI override por fornecedor): dropdown alimentado por `get_purchase_order_suppliers`, `param_origem='fornecedor'` disponível na RPC de reposição para exibição de badge/origem, tabela `replenishment_params` com scope='fornecedor' pronta para inserções via UI
- FORN-03 (precedência 4 níveis) e FORN-05 backend (anti-IDOR INVOKER + sem regressão) fechados
- Sem regressão dos casos Phase 63 (precedência SKU>marca>global intacta quando sem param de fornecedor)

## Self-Check: PASSED

- `supabase/migrations/20260666000100_get_replenishment_by_sku_fornecedor.sql` — commit `9963c3c9` confirmado em `git log`
- `supabase/migrations/20260666000200_get_purchase_order_suppliers_rpc.sql` — commit `49caa0a2` confirmado em `git log`
- Validacao em prod: 332 linhas, 19 com param_origem='fornecedor', 6 fornecedores via suppliers RPC, anti-IDOR = 0

---
*Phase: 66-compras-v2-override-por-fornecedor*
*Completed: 2026-06-26*
