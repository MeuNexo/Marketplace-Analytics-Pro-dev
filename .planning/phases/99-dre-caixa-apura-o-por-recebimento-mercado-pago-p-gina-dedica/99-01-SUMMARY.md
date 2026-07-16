---
phase: 99-dre-caixa-apura-o-por-recebimento-mercado-pago-p-gina-dedica
plan: 01
subsystem: database
tags: [postgres, supabase, rpc, security-invoker, rls, dre, caixa]

# Dependency graph
requires: []
provides:
  - "RPC `get_dre_cash(p_org_id, p_month)` — cascata entrada/saida/previsao do mês em regime de caixa puro"
  - "RPC `get_dre_cash_items(p_org_id, p_month, p_bloco)` — drill-down de lançamentos individuais pagos por bloco"
  - "RPC `get_dre_cash_history(p_org_id, p_months)` — série até 12 meses de entradas/saidas/resultado"
affects: [99-02, 99-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cabeçalho canônico LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' + REVOKE/GRANT explícito (mesmo padrão de get_inss_guia_by_competence)"
    - "Regime de caixa puro: entradas por release_date (cash_inflows), saídas por outflow_date+status='paid' (cash_outflows) — sem shift M+1, sem competence_date"
    - "Previsão de imposto via generate_series(1,3) + CTEs pré-agregadas (sem subquery correlacionada) para respeitar o timeout 8s do role authenticated"

key-files:
  created:
    - supabase/migrations/20260717000000_dre_cash_rpcs.sql
  modified: []

key-decisions:
  - "Migration aplicada em prod recebeu timestamp real do MCP (max(version) < 20260717000000 no momento do apply, sem conflito) — arquivo do repo permanece com o nome original 20260717000000_dre_cash_rpcs.sql"
  - "Reuso de public.dre_bloco_for_category (já em produção) para mapear cash_outflows.category → bloco, sem redefinir a função"

patterns-established:
  - "Toda RPC nova de leitura financeira usa o cabeçalho canônico (INVOKER + REVOKE/GRANT) e reusa dre_bloco_for_category para categorização de saídas em bloco"

requirements-completed: [DREC-01, DREC-02, DREC-03, DREC-05]

# Metrics
duration: ~15min
completed: 2026-07-16
status: complete
---

# Phase 99 Plan 01: Migration com as 3 RPCs da DRE Caixa Summary

**3 RPCs novas (`get_dre_cash`, `get_dre_cash_items`, `get_dre_cash_history`) aplicadas em produção `ckcdevcxgvueywivefgx` — regime de caixa puro (recebimento MP + saídas pagas), sem subquery correlacionada, com provas de performance (<8s), reconciliação ao centavo e anti-IDOR contra org real.**

## Performance

- **Duration:** ~15 min (22:41 → 22:59 UTC, Task 1 + checkpoint Task 2)
- **Started:** 2026-07-16T22:41:00Z
- **Completed:** 2026-07-16T22:59:53Z
- **Tasks:** 2 (1 auto + 1 checkpoint:human-verify)
- **Files modified:** 1

## Accomplishments
- Migration `supabase/migrations/20260717000000_dre_cash_rpcs.sql` (305 linhas) criada com as 3 RPCs no padrão canônico do projeto: `LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'` + `REVOKE EXECUTE ... FROM PUBLIC, anon` + `GRANT EXECUTE ... TO authenticated` em cada uma.
- `get_dre_cash`: seção `entrada` (bruto/liquido/descontos_fonte/refunds/a_liberar via `cash_inflows.release_date`), seção `saida` (todos os blocos via `dre_bloco_for_category`, incluindo `excluido`/`nao_classificado`, via `cash_outflows.status='paid'`), seção `previsao` (imposto_guia_paga/faturamento_mes/imposto_previsto — média das taxas guia÷faturamento dos até 3 meses anteriores válidos, NULL quando nenhum mês válido).
- `get_dre_cash_items`: drill-down por bloco (comparação tipada, sem SQL dinâmico).
- `get_dre_cash_history`: série de até 12 meses via `generate_series`, entradas/saidas pré-agregadas por mês, `resultado = entradas − saidas`, meses sem movimento retornam 0.
- Migration aplicada em produção via MCP Supabase pelo orquestrador (checkpoint Task 2) com as 5 provas obrigatórias da phase — todas aprovadas.

## Task Commits

Cada task foi commitada atomicamente:

1. **Task 1: Migration com as 3 RPCs da DRE Caixa** - `39ed2c52` (feat)
2. **Task 2: Apply em prod via MCP + provas SQL** - sem commit de código (checkpoint executado pelo orquestrador diretamente em produção via MCP `apply_migration`; nenhuma alteração adicional no repo)

**Plan metadata:** (gerado por este commit final de documentação)

## Files Created/Modified
- `supabase/migrations/20260717000000_dre_cash_rpcs.sql` - 3 RPCs SECURITY INVOKER (get_dre_cash, get_dre_cash_items, get_dre_cash_history) para a DRE Caixa em regime de recebimento Mercado Pago

## Decisions Made
- Nenhuma decisão nova além das já travadas no 99-CONTEXT.md (régua de caixa puro, sem shift M+1). O plano foi executado exatamente conforme especificado.

## Deviations from Plan

None - plano executado exatamente como escrito. As 3 RPCs, cabeçalhos e seções batem 1:1 com o `must_haves` e `acceptance_criteria` do plano.

## Issues Encountered
None.

## Checkpoint Evidence (Task 2 — Apply em prod + provas SQL)

Executado pelo orquestrador via MCP Supabase (projeto `ckcdevcxgvueywivefgx`) em 2026-07-16 — checkpoint **aprovado** ("approved").

1. **Orgs confirmadas ao vivo** (`SELECT id, name FROM organizations`): "Pé Vermeio" = `7f615df7-7bac-45e5-8a93-827fb9ddeec7`; "Thales" = `e4150d57-1349-48c9-9a89-82b1774857b0` (UUIDs completos conferidos contra a lista viva, nunca completados de memória).
2. **Pré-apply:** `max(version)` = `20260716205308` (< `20260717000000`, sem conflito). Migration aplicada via `apply_migration` (nome `dre_cash_rpcs`) → success. (A versão viva em prod recebe o timestamp real do apply; o arquivo do repo permanece nomeado `20260717000000_dre_cash_rpcs.sql`.)
3. **Prova funcional + performance como role `authenticated`** (impersonação single-statement via `set_config('role','authenticated')` + `set_config('request.jwt.claims', ...)` + `CROSS JOIN LATERAL`): `get_dre_cash('7f615df7...', '2026-06-01')` retornou 18 linhas coerentes:
   - entrada: bruto 290.518,08 / líquido 159.638,88 / descontos_fonte 130.879,20 / refunds −33.837,64 (138) / a_liberar 0
   - previsao: faturamento_mes 261.987,61; imposto_guia_paga 4.793,23 (3); imposto_previsto 11.361,41 (n_validas=3)
   - saida por blocos: excluido/Fornecedores 147.328,45; financeiro/Empréstimo 20.027,82; impostos_venda 4.793,23; pessoal 27.852,19; servicos 2.103,22; operacional 2.200,63
4. **EXPLAIN ANALYZE** da mesma chamada: **Execution Time 402ms** (≪ 8000ms exigido).
5. **`get_dre_cash_items`** (PV, `2026-06-01`, `pessoal`): 4 itens, `2026-06-05..2026-06-21`, soma 27.852,19 (bate com o bloco `pessoal` da RPC 1).
6. **`get_dre_cash_history`** (PV, 12): 12 meses ordenados; jun/2026 entradas 159.638,88, saidas 56.977,09, resultado +102.661,79 (saidas = total − bloco `excluido`, correto); meses ≤ abr/2026 com entradas 0 (sync de inflows começa em mai/2026 — realidade do dado, não bug).
7. **Reconciliação:** Σ seção `saida` (204.305,54, n=49) = `SUM` direto de `cash_outflows` `paid` jun/2026 (204.305,54, n=49) — bate ao centavo.
8. **Anti-IDOR** (JWT Pé Vermeio × `p_org_id` Thales): `get_dre_cash` → nenhuma linha com `total≠0`/`n≠0` exceto `imposto_previsto` `total` NULL `n=0` (estrutural); `get_dre_cash_items` → 0 linhas; `get_dre_cash_history` → Σ|entradas|+|saidas| = 0. Zero vazamento confirmado (Thales fatura ~R$6,35M — nada apareceu sob impersonação da Pé Vermeio).

Todas as 5 provas do `how-to-verify`/`acceptance_criteria` da Task 2 foram cumpridas: UUIDs conferidos, migration aplicada sem erro, 3× EXPLAIN ANALYZE <8000ms, reconciliação R$0,00 de diferença, anti-IDOR sem vazamento.

## User Setup Required
None - nenhuma configuração de serviço externo necessária. Apply em prod feito diretamente pelo orquestrador via MCP.

## Next Phase Readiness
- 99-02 (lib pura + hooks, já executado) consome o contrato destas 3 RPCs.
- 99-03 (página `/dre-caixa`) pode consumir os hooks do 99-02 com dados reais das RPCs vivas em produção.
- Nenhum bloqueio: RPCs vivas em `pg_proc`, RLS org-first provado, performance <1s real.

---
*Phase: 99-dre-caixa-apura-o-por-recebimento-mercado-pago-p-gina-dedica*
*Completed: 2026-07-16*

## Self-Check: PASSED

Migration file verified present on disk (`supabase/migrations/20260717000000_dre_cash_rpcs.sql`, 305 lines). Task 1 commit `39ed2c52` verified present in git log. Task 2 (checkpoint) has no code commit — evidence is the MCP execution record captured above, provided by the orchestrator per the resolved checkpoint.
