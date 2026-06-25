---
phase: 62-reposicao-server-side
plan: 01
subsystem: database
tags: [postgres, supabase, rpc, security-invoker, rls, replenishment, estoque, reposicao]

# Dependency graph
requires:
  - phase: 43-multi-tenant-hardening
    provides: "RLS org-first (is_org_member/get_org_role) + padrão SECURITY INVOKER anti-IDOR"
  - phase: 59-fluxo-caixa-correcoes
    provides: "Padrão canônico get_cashflow (SECURITY INVOKER + SET search_path + REVOKE/GRANT) + apply via MCP"
provides:
  - "Tabela replenishment_params (parâmetros global + override por marca, RLS org-first, write owner/admin)"
  - "RPC get_replenishment (SECURITY INVOKER, escopada por org, paginável) com fórmula de ponto de reposição"
  - "types.ts tipado para replenishment_params (Tables) e get_replenishment (Functions)"
affects: [62-02, 62-03, reposicao, estoque, ReplenishmentPanel, useReplenishment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RPC server-side de reposição via SECURITY INVOKER + RLS org-first (não DEFINER)"
    - "Resolução de parâmetros marca>global>hardcoded via COALESCE com subqueries por campo"
    - "Custo via LATERAL JOIN com ponte dupla item_id OR seller_sku (Tiny TINY_{sku})"
    - "Estoque cross-store SUM(available_quantity) sem filtro logistic_type (corrige VERAC-01)"

key-files:
  created:
    - supabase/migrations/20260662000000_replenishment_params.sql
    - supabase/migrations/20260662000100_get_replenishment_rpc.sql
  modified:
    - src/integrations/supabase/types.ts

key-decisions:
  - "SECURITY INVOKER (nunca DEFINER): RLS org-first das 4 tabelas base é o gate real; p_org_id alheio retorna 0 linhas (anti-IDOR provado)"
  - "Write policy de replenishment_params restrita a owner/admin (não member) — config de reposição é decisão gerencial"
  - "Sem linha de seed: COALESCE com fallback hardcoded (30/60/7/1/1) cobre o caso de tabela vazia"
  - "Estoque = SUM cross-store sem filtro logistic_type (Full + anúncios); guard NULLIF(pack,0) + CHECK pack_multiple>=1"

patterns-established:
  - "Reposição calculada no banco (não no front) espelhando get_cashflow — fonte-da-verdade server-side"
  - "Apply de migration via MCP apply_migration no ckcdevcxgvueywivefgx (nunca db push — CLI no projeto errado)"

requirements-completed: [REPL-01, REPL-02, REPL-03, REPL-04, REPL-05, REPL-06, REPL-07, REPL-08]

# Metrics
duration: 7min
completed: 2026-06-25
status: complete
---

# Phase 62 Plan 01: Reposição Server-Side (replenishment_params + get_replenishment) Summary

**Tabela `replenishment_params` (RLS org-first, write owner/admin) e RPC `get_replenishment` (SECURITY INVOKER, fórmula de ponto de reposição com gatilho/MOQ/pack/custo-nulo/sem-giro) aplicadas e validadas em produção — 116 linhas reais para a Pé Vermeio, 0 cross-org.**

## Performance

- **Duration:** ~7 min (execução autônoma das Tasks 1-2) + checkpoint do orquestrador
- **Started:** 2026-06-25T20:37:34Z
- **Completed:** 2026-06-25T20:44:10Z
- **Tasks:** 3 (2 autônomas + 1 checkpoint do orquestrador)
- **Files modified:** 3 (2 migrations criadas, types.ts atualizado)

## Accomplishments

- **Tabela `replenishment_params`** criada com RLS org-first: SELECT para membros via `is_org_member`; escrita FOR ALL restrita a `owner`/`admin` via `get_org_role` (member NÃO escreve). CHECKs em `scope IN ('global','marca')`, `moq >= 1` e `pack_multiple >= 1`; UNIQUE (org, scope, scope_value); índice de lookup.
- **RPC `get_replenishment`** (SECURITY INVOKER + SET search_path='public') implementando a fórmula travada: estoque de `ml_inventory_cache` (SUM cross-store, sem filtro logistic_type), venda/dia de `ml_product_daily_cache`, custo de `ml_product_costs` (ponte item_id OR seller_sku), parâmetros marca>global>hardcoded. Gatilho, cobertura, MOQ+pack arredondado, custo ausente e sem-giro. REVOKE PUBLIC/anon + GRANT authenticated.
- **types.ts** atualizado manualmente: entry `replenishment_params` em Tables (Row/Insert/Update) e `get_replenishment` em Functions (3 args + 20 colunas de retorno). `tsc --noEmit` limpo.
- **Aplicação e validação em produção** (ckcdevcxgvueywivefgx, via MCP pelo orquestrador): RPC viva, retornando dados reais, anti-IDOR comprovado.

## Task Commits

1. **Task 1: Migration da tabela replenishment_params (RLS org-first)** — `e9443e3f` (feat)
2. **Task 2: Migration da RPC get_replenishment + types.ts manual** — `6f386410` (feat)
3. **Task 3: [BLOCKING] Aplicar migrations via MCP + validar por SQL** — checkpoint do orquestrador (apply via MCP `apply_migration`, sem commit de código; resultados abaixo)

## Files Created/Modified

- `supabase/migrations/20260662000000_replenishment_params.sql` — Tabela replenishment_params + RLS org-first + índice + CHECKs (CREATE TABLE, ENABLE RLS, policies rp_select/rp_write)
- `supabase/migrations/20260662000100_get_replenishment_rpc.sql` — Função get_replenishment SECURITY INVOKER + 4 CTEs (sales/inventory/params/base) + REVOKE/GRANT
- `src/integrations/supabase/types.ts` — Tipos manuais de replenishment_params (Tables) e get_replenishment (Functions)

## Validação em Produção (Task 3 — orquestrador via MCP, projeto ckcdevcxgvueywivefgx)

**Passo 1 — apply_migration:** Ambas migrations aplicadas com sucesso (replenishment_params + get_replenishment).

**Passo 2 — Validação funcional** (org Pé Vermeio `7f615df7-7bac-45e5-8a93-827fb9ddeec7`, janela 30d, mult 1.0):

| Métrica | Valor |
|---------|-------|
| linhas | 116 |
| sugeridos (compra_sugerida > 0) | 29 |
| sem_custo (custo_ausente) | 44 |
| sem_giro | 41 |
| acima_do_ponto (NOT gatilho_ativo AND compra=0) | 87 |
| total_unid_sugeridas | 1.013 |
| valor_total_estimado | R$ 34.098,05 |

- `29 + 87 = 116` (consistente: itens com gatilho ativo + itens acima do ponto).
- Sem erro de divisão por zero (NULLIF(pack,0) + CHECK + cobertura NULL quando sem giro).
- Gatilho funcionando: 87 itens acima do ponto → `compra_sugerida = 0`.

**Passo 3 — Anti-IDOR** (impersonação `SET LOCAL ROLE authenticated` + jwt.claims sub=usuário Pé Vermeio):
- `get_replenishment(org Thales e4150d57-1349-48c9-9a89-82b1774857b0)` = **0 linhas** (cross-org bloqueado pela RLS org-first).
- `get_replenishment(própria org)` = 116 linhas.
- SECURITY INVOKER + RLS comprovados (T-62-01 mitigado).

**Passo 4 — Security advisors:** Nenhum issue novo para `get_replenishment` nem `replenishment_params`. A RPC não aparece em `security_definer` (é INVOKER); a tabela não aparece em `rls_disabled` (tem RLS + 2 policies). WARNs restantes = backlog pré-existente (Phase 47).

## Decisions Made

- **SECURITY INVOKER (não DEFINER):** a RLS org-first das 4 tabelas base é o enforcement real de isolamento; passar `p_org_id` alheio retorna 0 linhas. Provado no checkpoint (cross-org = 0).
- **Write policy owner/admin (não member):** parâmetros de reposição (lead_time, MOQ, pack) são configuração de gestão; SELECT cobre leitura para todos os membros.
- **Sem seed:** RPC usa COALESCE marca>global>hardcoded (30/60/7/1/1); tabela vazia ainda produz resultados corretos com defaults.
- **Estoque SUM cross-store sem filtro logistic_type:** soma Full + anúncios, corrige o bug VERAC-01 do Nexo.

## Deviations from Plan

None - plan executed exactly as written. Ajuste cosmético: removido espaço duplo em `GRANT EXECUTE` para satisfazer o grep de acceptance (sem impacto funcional).

## Issues Encountered

None. As Tasks 1-2 passaram em todos os acceptance criteria (greps + `tsc --noEmit`) na primeira tentativa. O apply em produção (Task 3) foi executado pelo orquestrador via MCP (o gsd-executor não tem acesso ao MCP Supabase nem ao SUPABASE_ACCESS_TOKEN).

## User Setup Required

None - a aplicação da migration foi feita pelo orquestrador via MCP `apply_migration` no projeto `ckcdevcxgvueywivefgx`. Nenhuma configuração manual de serviço externo necessária.

## Next Phase Readiness

- Backend da reposição pronto: RPC `get_replenishment` viva e validada em produção, REPL-01..08 satisfeitos.
- **62-02 / 62-03** podem construir o hook `useReplenishment.ts`, a fórmula TS pura `replenishmentUtils.ts` (+ testes vitest) e o componente `ReplenishmentPanel.tsx` em `/estoque` sobre esta RPC.
- Nota: o `CompraRecomendadaPanel.tsx` antigo em `/precos-custos` permanece intocado (decisão da Open Question 1).

## Self-Check: PASSED

- Files: 2 migrations + types.ts + SUMMARY.md — all FOUND
- Commits: e9443e3f, 6f386410 — all FOUND

---
*Phase: 62-reposicao-server-side*
*Completed: 2026-06-25*
