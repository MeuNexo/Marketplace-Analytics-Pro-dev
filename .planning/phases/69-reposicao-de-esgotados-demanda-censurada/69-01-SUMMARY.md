---
phase: 69-reposicao-de-esgotados-demanda-censurada
plan: "01"
subsystem: backend-rpc
tags: [replenishment, sql, demanda-censurada, esgotados, security-invoker]
dependency_graph:
  requires: [phase-68-rpc-alvo-order-up-to]
  provides: [status_esgotado-column, historico_esgotado-origem, migration-69-01]
  affects: [get_replenishment_by_sku-rpc, compras-page-69-02]
tech_stack:
  added: []
  patterns: [set-based-window-self-join, lateral-join-classification, named-constants-declare]
key_files:
  created:
    - supabase/migrations/20260669000000_get_replenishment_by_sku_esgotados.sql
  modified: []
decisions:
  - "set-based self-join (daily_qty_180d d1 JOIN d1 d2 onde d2 in [d1, d1+30)) para melhor ritmo — evita subquery correlacionada que estouraria timeout 8s do role authenticated"
  - "status_esgotado calculado via LATERAL esg em base, depois injetado em vbeff LATERAL — separa classificação de substituição de venda_base sem CTE intermediária"
  - "daily_qty_180d e sales_history_by_sku reusamm inventory_by_sku (já materializado) como driving table com LEFT/JOIN orders — garante que itens sem vendas aparecem com ultima_venda=NULL"
  - "6 constantes no DECLARE (não em replenishment_params) — escopo de uma feature nova; calibráveis via redeploy sem DDL adicional (Claude's Discretion do CONTEXT)"
metrics:
  duration: "~20min"
  completed: "2026-06-27"
  tasks_completed: 1
  tasks_total: 2
  files_changed: 1
status: complete
---

# Phase 69 Plan 01: Migration get_replenishment_by_sku com demanda censurada — Summary

**One-liner:** RPC `get_replenishment_by_sku` estendida com classificação por recência de esgotados (4 baldes) e estimativa "melhor ritmo 30d/180d" via self-join set-based (SECURITY INVOKER, 36 colunas).

## O que foi construído

A migration `20260669000000_get_replenishment_by_sku_esgotados.sql` substitui a função
`get_replenishment_by_sku` mantendo todas as 35 colunas existentes e acrescentando:

### Nova coluna de retorno
- `status_esgotado TEXT` (36ª coluna, após `venda_inteligente`)
  - `'com_giro'` — SKU com venda na janela 30d: caminho atual intocado.
  - `'repor_esgotado'` — sku_stock=0, venda_30d=0, última venda ≤90d: injeta estimativa e sugere compra.
  - `'revisar_esgotado'` — sku_stock=0, venda_30d=0, última venda 91–365d: sinaliza, compra=0.
  - `'descontinuar'` — sku_stock=0, venda_30d=0, última venda >365d ou nunca: compra=0.

### Novo valor de venda_dia_origem
- `'historico_esgotado'` — indica que o `venda_dia` veio da estimativa histórica (não de vendas recentes).

### 4 novas CTEs internas
| CTE | Descrição |
|-----|-----------|
| `sales_history_by_sku` | Por chave canônica: última venda, dias desde última, soma_90d, dias_distintos_180d |
| `daily_qty_180d` | Vendas diárias por chave canônica nos últimos 180d (materializado) |
| `window_sums_30d` | Self-join: para cada âncora d1, soma vendas em [d1, d1+30) |
| `best_rate_by_sku` | MAX(window_sum) / 30 por chave canônica (melhor ritmo) |

### 6 constantes nomeadas no DECLARE
```sql
v_recency_repor_days   INTEGER := 90;   -- corte repor_esgotado
v_recency_revisar_days INTEGER := 365;  -- corte revisar_esgotado
v_best_window_days     INTEGER := 30;   -- janela melhor ritmo
v_best_lookback_days   INTEGER := 180;  -- lookback do melhor ritmo
v_min_distinct_days    INTEGER := 2;    -- mínimo dias distintos anti-pico
v_conservative_days    INTEGER := 90;   -- janela da estimativa conservadora
```

### Lógica de estimativa (repor_esgotado)
1. Se `dias_distintos_180d >= 2` E `best_rate > 0` → usa melhor ritmo (best_rate).
2. Senão (anti-pico ou <2 dias) → usa `soma_90d / 90` (média conservadora).
3. O `venda_base` estimado flui naturalmente para `ponto`, `alvo`, `compra` (math existente inalterada).
4. Para `revisar_esgotado`/`descontinuar`: `venda_base = 0` → `compra_sugerida = 0` estruturalmente.

## Commits

| Task | Commit | Descrição |
|------|--------|-----------|
| 1 — Escrever migration | `16b08721` | feat(69-01): migration get_replenishment_by_sku com demanda censurada |

## Deviations from Plan

None — plano executado exatamente como escrito.

## Checkpoint: Task 2 aguarda o orquestrador

**Task 2 é do ORQUESTRADOR** (apply_migration via MCP + validações SQL). O executor não tem acesso ao MCP Supabase.

### Migration a aplicar
```
supabase/migrations/20260669000000_get_replenishment_by_sku_esgotados.sql
```

### Queries de validação SQL (executar via MCP `execute_sql` no projeto `ckcdevcxgvueywivefgx`)

**1. Contagem dos 4 baldes na org Pé Vermeio:**
```sql
SELECT status_esgotado, count(*)
FROM get_replenishment_by_sku('7f615df7-7bac-45e5-8a93-827fb9ddeec7')
GROUP BY 1
ORDER BY 1;
```
Esperado: 4 valores distintos (com_giro, repor_esgotado, revisar_esgotado, descontinuar).

**2. Prova do resgate dos ~15 repor_esgotado:**
```sql
SELECT
  count(*) FILTER (WHERE compra_sugerida > 0) AS com_compra,
  count(*) FILTER (WHERE venda_dia_origem = 'historico_esgotado') AS estimados,
  count(*) FILTER (WHERE venda_dia > 0) AS com_venda_positiva
FROM get_replenishment_by_sku('7f615df7-7bac-45e5-8a93-827fb9ddeec7')
WHERE status_esgotado = 'repor_esgotado';
```
Esperado: com_compra ≈ estimados ≈ com_venda_positiva ≈ ~15.

**3. Garantia de que revisar/descontinuar ficam fora da compra:**
```sql
SELECT count(*)
FROM get_replenishment_by_sku('7f615df7-7bac-45e5-8a93-827fb9ddeec7')
WHERE status_esgotado IN ('revisar_esgotado', 'descontinuar')
  AND compra_sugerida > 0;
```
Esperado: 0.

**4. Anti-IDOR cross-org (SECURITY INVOKER):**
```sql
-- Confirmar SECURITY INVOKER no pg_get_functiondef
SELECT pg_get_functiondef('public.get_replenishment_by_sku(uuid,integer,numeric,boolean)'::regprocedure)
  LIKE '%SECURITY INVOKER%' AS is_invoker;
-- Esperado: true

-- Teste de impersonação cross-org (adaptar com usuário de outra org):
BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL "request.jwt.claims" TO '{"sub":"<uuid-usuario-outra-org>","role":"authenticated"}';
  SELECT count(*)
  FROM get_replenishment_by_sku('7f615df7-7bac-45e5-8a93-827fb9ddeec7');
ROLLBACK;
-- Esperado: 0 linhas
```

**5. Advisors (sem nova issue):**
```sql
-- Via MCP get_advisors (security) — verificar que não há nova issue introduzida
```

## Known Stubs

Nenhum — esta é uma migration SQL pura sem componente frontend (o 69-02 cuida do frontend).

## Threat Flags

Nenhuma superfície nova além do previsto no plano:
- `get_replenishment_by_sku` permanece SECURITY INVOKER com RLS org-first.
- Todas as novas CTEs filtram `organization_id = p_org_id` explicitamente.
- Abordagem set-based mitiga T-69-02 (DoS por timeout).

## Self-Check: PASSED

- [x] `supabase/migrations/20260669000000_get_replenishment_by_sku_esgotados.sql` existe.
- [x] Commit `16b08721` existe no branch `gsd/phase-69-reposicao-esgotados`.
- [x] Grep gate da Task 1: OK (SECURITY INVOKER, status_esgotado, historico_esgotado, repor_esgotado, REVOKE EXECUTE).
- [x] 36 colunas no RETURNS TABLE (35 originais + status_esgotado TEXT ao final).
- [x] 6 constantes nomeadas no DECLARE.
- [x] CTEs novas: sales_history_by_sku, daily_qty_180d, window_sums_30d, best_rate_by_sku.
- [x] Nenhuma subquery correlacionada por linha (abordagem self-join).
- [x] revisar_esgotado e descontinuar mantêm venda_base=0 (compra estruturalmente 0).
- [x] REVOKE/GRANT com assinatura 4-arg idêntica à base.

---

## Checkpoint Task 2 — APROVADO pelo orquestrador (2026-06-27, prod ckcdevcxgvueywivefgx)

Migration aplicada via MCP `apply_migration` (`{"success":true}`). 5 validações na org Pé Vermeio `7f615df7-…`:

| Validação | Resultado |
|-----------|-----------|
| Contagem dos 4 baldes | com_giro 192 · repor_esgotado 29 · revisar_esgotado 59 · descontinuar 13 (total 293) |
| Resgate dos repor_esgotado | 29 SKUs, 27 com compra>0, 100% `venda_dia_origem='historico_esgotado'`; +232 un / R$21.219 antes invisíveis |
| revisar/descontinuar fora da compra | 0 linhas com compra>0 (estrutural: venda_base=0) |
| Anti-IDOR cross-org | user org Thales lendo Pé Vermeio → **0 linhas vazadas** |
| SECURITY INVOKER | confirmado (`prosecdef=false`) |
| Performance sob role `authenticated` (statement_timeout 8s) | **Execution Time 2.114s** — set-based OK, sem estouro |
| Regressão | `com_giro` = 87 compras / 1003 un / R$126.815 = **idêntico ao baseline pré-Phase 69** |

Veredito: **PASS**. Backend live em prod. Pronto para Wave 2 (frontend).
