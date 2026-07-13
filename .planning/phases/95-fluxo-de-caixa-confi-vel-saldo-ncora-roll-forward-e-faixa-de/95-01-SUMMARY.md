---
phase: 95-fluxo-de-caixa-confiavel
plan: 01
subsystem: database
tags: [postgres, plpgsql, supabase-rpc, security-invoker, cashflow, rls]

# Dependency graph
requires:
  - phase: 60-fluxo-de-caixa-dfc-alignment
    provides: get_cashflow / get_projected_balance_summary / get_treasury_panel (corpo atual consumido verbatim)
  - phase: 49-fluxo-de-caixa-tabelas
    provides: financial_settings / cash_inflows / cash_outflows schema + RLS is_org_member
provides:
  - "financial_settings.balance_anchor_date (coluna nova + backfill)"
  - "get_rolled_opening_balance(p_org_id) — lógica de roll-forward centralizada"
  - "get_cashflow / get_projected_balance_summary / get_treasury_panel migrados para v_initial via roll-forward"
  - "set_financial_balance(p_org_id, p_amount) — RPC de escrita atômica da âncora"
  - "get_cashflow_data_health(p_org_id) — RPC de saúde dos dados (Tiny/MP/âncora stale)"
affects: [95-02-frontend, 95-03-migration-apply]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SECURITY INVOKER sem checagem manual de org — RLS is_org_member/get_org_role é o guard real"
    - "Roll-forward âncora + Σ entradas − Σ saídas pagas, intervalo semi-aberto [anchor_date, hoje_BRT)"
    - "MAX(synced_at) FILTER (WHERE source='tiny') para evitar falso-positivo de sync por linha manual"

key-files:
  created:
    - supabase/migrations/20260695000000_cashflow_balance_anchor.sql
    - supabase/migrations/20260695000100_cashflow_rpcs_use_rolled_balance.sql
    - supabase/migrations/20260695000200_set_financial_balance_rpc.sql
    - supabase/migrations/20260695000300_cashflow_data_health_rpc.sql
  modified: []

key-decisions:
  - "Timestamp das migrations escolhido 20260695000000+ (> 20260694000000, presente no main mas não neste checkout) — Pitfall 4 do RESEARCH; 95-03 confere o max real via MCP antes de aplicar"
  - "get_daily_balance (RPC separada, ainda lê initial_balance direto, consumida por useTodayBalance.ts) fica FORA de escopo desta migration — não estava na lista travada por Wesley"
  - "get_treasury_panel: SELECT de alert_threshold e leitura de v_initial separados em duas instruções (era uma query só); alert_threshold continua vindo direto de financial_settings, v_initial passa a vir do roll-forward"

patterns-established:
  - "Toda leitura de saldo de abertura deve passar por get_rolled_opening_balance — nenhuma RPC nova deve ler financial_settings.initial_balance direto"

requirements-completed: [CASH-95-01, CASH-95-02, CASH-95-03, CASH-95-04, CASH-95-06]

# Metrics
duration: 25min
completed: 2026-07-13
status: complete
---

# Phase 95 Plan 01: Saldo Âncora + Roll-Forward (Backend/RPCs) Summary

**4 migrations SQL (não aplicadas — autoria apenas) que centralizam o roll-forward do saldo de abertura em `get_rolled_opening_balance` e adicionam a RPC de saúde dos dados `get_cashflow_data_health`, todas SECURITY INVOKER.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3/3 completed
- **Files modified:** 4 (todos criados, nenhum arquivo existente tocado)

## Accomplishments
- `financial_settings.balance_anchor_date` (coluna aditiva + backfill idempotente `= updated_at::date`) e `get_rolled_opening_balance(p_org_id)` criadas, centralizando a fórmula `âncora + entradas (MP) − saídas pagas (Tiny)` no intervalo semi-aberto `[anchor_date, hoje_BRT)`.
- `get_cashflow`, `get_projected_balance_summary` e `get_treasury_panel` migrados para consumir `get_rolled_opening_balance` — corpo de cada função preservado verbatim, só a origem de `v_initial` muda.
- `set_financial_balance(p_org_id, p_amount)` criada para gravar `initial_balance` + `balance_anchor_date` (BRT servidor) + `updated_at` atomicamente, fechando o Pitfall 1 do RESEARCH (upsert parcial do dialog nunca tocava a âncora).
- `get_cashflow_data_health(p_org_id)` criada com as 9 colunas de saúde (Tiny/MP sync + âncora), usando `FILTER (WHERE source='tiny')` para não mascarar um token Tiny morto com uma linha manual.

## Task Commits

Each task was committed atomically:

1. **Task 1: coluna balance_anchor_date + backfill + get_rolled_opening_balance** - `48c56c40` (feat)
2. **Task 2: get_cashflow / get_projected_balance_summary / get_treasury_panel usam get_rolled_opening_balance** - `2f63a975` (feat)
3. **Task 3: set_financial_balance + get_cashflow_data_health** - `4d335548` (feat)

_Nenhuma migration foi aplicada ao banco vivo — essa é a responsabilidade do plano 95-03 (via MCP `apply_migration`)._

## Files Created/Modified
- `supabase/migrations/20260695000000_cashflow_balance_anchor.sql` - coluna `balance_anchor_date` + backfill idempotente + `get_rolled_opening_balance`
- `supabase/migrations/20260695000100_cashflow_rpcs_use_rolled_balance.sql` - `get_cashflow`, `get_projected_balance_summary`, `get_treasury_panel` recriadas com `v_initial` vindo do roll-forward
- `supabase/migrations/20260695000200_set_financial_balance_rpc.sql` - `set_financial_balance` (escrita atômica da âncora)
- `supabase/migrations/20260695000300_cashflow_data_health_rpc.sql` - `get_cashflow_data_health` (Tiny/MP/âncora stale)

## Decisions Made
- **Timestamp de migration:** escolhido `20260695000000` e seguintes, maior que `20260694000000` (presente no `main` mas ausente neste checkout — drift documentado no RESEARCH, Pitfall 4). O plano 95-03 deve confirmar o max real via MCP antes de aplicar e renumerar se necessário.
- **get_treasury_panel — separação da leitura dupla:** o corpo original lia `fs.initial_balance` e `fs.alert_threshold` na MESMA query (`SELECT ... INTO v_alert_thresh, v_initial`). Como `v_initial` agora vem de uma chamada de função (`get_rolled_opening_balance`), separei em duas instruções: um `SELECT` isolado para `v_alert_thresh` (idêntico ao original, só sem `v_initial` junto) e uma atribuição de `v_initial := public.get_rolled_opening_balance(p_org_id)`. Comportamento idêntico, só a estrutura da leitura muda — não é uma mudança de lógica.
- **Grep de escopo (Assumption A3 do RESEARCH):** rodei `grep -rn "initial_balance" supabase/migrations/` em todas as migrations. Confirmado que só `get_cashflow`, `get_projected_balance_summary`, `get_treasury_panel` (as 3 travadas por Wesley) e a coluna em si aparecem nas versões correntes — MAS existe uma 4ª RPC, `get_daily_balance` (última definição em `20260618210000_cash_flow_rpcs_all_statuses.sql`), que também lê `financial_settings.initial_balance` direto e é consumida pelo frontend em `src/hooks/useTodayBalance.ts`. Ela está FORA da lista travada por Wesley — não foi alterada nesta fase. Ver seção de risco abaixo.

## Deviations from Plan

None - plan executado exatamente como escrito. Nenhum Rule 1-4 acionado; as únicas notas são as duas "Decisions Made" acima, que são esclarecimentos de implementação previstos no próprio texto do plano (não desvios de escopo).

## Issues Encountered
None.

## Risco / Fora de Escopo (reportado conforme pedido pela verificação de escopo do plano)

- **`get_daily_balance` continua lendo `financial_settings.initial_balance` diretamente**, sem passar por `get_rolled_opening_balance`. É consumida por `src/hooks/useTodayBalance.ts` no frontend. Não estava na lista de 3 RPCs travada por Wesley (`get_cashflow` / `get_projected_balance_summary` / `get_treasury_panel`) e por isso não foi tocada. **Efeito prático:** se `useTodayBalance` for exibida em algum lugar visível ao usuário, ela vai mostrar o saldo de abertura ANTIGO (sem roll-forward) enquanto as outras 3 telas já mostram o saldo rolado — uma divergência sutil entre partes da mesma página. Recomendo avaliar em fase futura se `get_daily_balance` deve ser migrada também, ou se está obsoleta/substituível por uma das 3 RPCs já corrigidas.

## User Setup Required

None - nenhuma configuração de serviço externo necessária. As 4 migrations ainda precisam ser APLICADAS ao banco vivo `ckcdevcxgvueywivefgx` via MCP `apply_migration` — isso é responsabilidade do plano 95-03, não deste plano.

## Next Phase Readiness
- As 4 migrations estão prontas para aplicação via MCP no plano 95-03 (validação SQL ao vivo: não-regressão âncora=hoje, roll com âncora passada, `pending` ignorado no roll, health flags, RLS cross-org).
- O plano 95-02 (frontend) pode prosseguir em paralelo assumindo os nomes de RPC definidos aqui: `get_rolled_opening_balance`, `set_financial_balance`, `get_cashflow_data_health` (assinatura e shape de retorno já fixados neste plano).
- Bloqueio conhecido: `get_daily_balance` fora de escopo (ver seção de risco) — não bloqueia esta fase, mas fica registrado para decisão futura.

---
*Phase: 95-fluxo-de-caixa-confiavel*
*Completed: 2026-07-13*

## Self-Check: PASSED

All 4 migration files and the SUMMARY.md itself confirmed present on disk; all 3 task commit hashes (`48c56c40`, `2f63a975`, `4d335548`) confirmed present in `git log --oneline --all`.
