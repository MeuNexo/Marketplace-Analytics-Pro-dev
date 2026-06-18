---
phase: 260618-sum
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/migrations/20260618210000_cash_flow_rpcs_all_statuses.sql
autonomous: true
requirements: [CASHFLOW-FIX-01]

must_haves:
  truths:
    - "A projeção de fluxo de caixa inclui contas a pagar com status 'paid' E 'pending' (saídas agendadas no Tiny com dataPagamento futura não somem mais)."
    - "As 3 RPCs continuam futuro-only — o recorte por data (v_start/v_today/BETWEEN) permanece intacto."
    - "As 3 RPCs continuam SECURITY INVOKER com REVOKE PUBLIC + GRANT authenticated preservados."
  artifacts:
    - path: "supabase/migrations/20260618210000_cash_flow_rpcs_all_statuses.sql"
      provides: "CREATE OR REPLACE das 3 RPCs (get_cashflow, get_daily_balance, get_projected_balance_summary) sem o filtro de status nas saídas"
      contains: "CREATE OR REPLACE FUNCTION public.get_cashflow"
      min_lines: 200
  key_links:
    - from: "supabase/migrations/20260618210000_cash_flow_rpcs_all_statuses.sql"
      to: "cash_outflows"
      via: "queries de saída sem filtro de status"
      pattern: "FROM cash_outflows co"
---

<objective>
Corrigir as 3 RPCs de fluxo de caixa da Phase 49 (`get_cashflow`, `get_daily_balance`, `get_projected_balance_summary`) para considerar contas a pagar de QUALQUER status (paid + pending), não apenas `pending`, mantendo o recorte futuro-only.

Purpose: Wesley agenda pagamentos no Tiny para o vencimento; o Tiny grava `dataPagamento` futura → a EF `sync-tiny-payables` normaliza para `status='paid'` → as RPCs atuais filtram `co.status = 'pending'` e descartam essas saídas agendadas. Confirmado nos dados: 13 contas 'paid' futuras (R$44.064,95) sumiam da projeção, inflando o saldo previsto.

Output: UMA migration nova em `supabase/migrations/` (timestamp posterior a 20260618195812) contendo `CREATE OR REPLACE` das 3 funções já SEM o filtro `AND co.status = 'pending'` (e variante `co.status='pending'`) em TODAS as ocorrências, preservando assinatura, RETURNS TABLE, SECURITY INVOKER, SET search_path e REVOKE/GRANT.
</objective>

<execution_context>
@/root/.claude/gsd-core/workflows/execute-plan.md
@/root/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md

# Migration base das RPCs (fonte canônica a copiar; o fix é remover o filtro de status das saídas)
@supabase/migrations/20260618120000_cash_flow_rpcs.sql
</context>

<deployment_note>
IMPORTANTE — o executor NÃO aplica a migration em produção. O executor apenas:
1. Cria o arquivo de migration em `supabase/migrations/`.
2. Commita o arquivo.

A APLICAÇÃO em produção (`apply_migration` no projeto Supabase `ckcdevcxgvueywivefgx`) é feita pelo ORQUESTRADOR depois desta execução. Regra de domínio do projeto: DDL SEMPRE via migration commitada em `supabase/migrations/` — NUNCA via SQL Editor. O gsd-executor não tem Supabase MCP/deploy. Não criar task de deploy.

Branch atual: `preview/phase-49-fluxo-caixa` (sem worktree).
</deployment_note>

<tasks>

<task type="auto">
  <name>Task 1: Criar migration das 3 RPCs sem o filtro de status nas saídas</name>
  <files>supabase/migrations/20260618210000_cash_flow_rpcs_all_statuses.sql</files>
  <action>
  Criar a migration `supabase/migrations/20260618210000_cash_flow_rpcs_all_statuses.sql` copiando INTEGRALMENTE o conteúdo de `supabase/migrations/20260618120000_cash_flow_rpcs.sql` e aplicando UMA ÚNICA mudança semântica: remover toda condição que filtra saídas por status nas três funções (`get_cashflow`, `get_daily_balance`, `get_projected_balance_summary`).

  Nota importante sobre o estado atual: a migration base lida (`20260618120000`) NÃO contém o filtro `AND co.status = 'pending'` — o filtro foi introduzido em produção por uma migration posterior (a definição em produção, capturada via `pg_get_functiondef`, tem o filtro). Portanto, o ALVO desta nova migration é a definição EM PRODUÇÃO, não a do arquivo `20260618120000`. Use a definição de produção descrita em CASHFLOW-FIX-01 (abaixo) como referência das ocorrências a remover, e produza um `CREATE OR REPLACE` que resulte em queries de `cash_outflows` SEM qualquer cláusula de status.

  Pontos onde o filtro de status deve estar AUSENTE no arquivo final (todas as saídas de `cash_outflows`):
  - `get_cashflow`: o `SELECT ... FROM cash_outflows co WHERE co.organization_id = p_org_id AND co.outflow_date BETWEEN ...` (saídas anteriores ao período E saídas do período no UNION ALL) — sem `AND co.status = 'pending'`.
  - `get_daily_balance`: as saídas anteriores ao dia (`outflow_date < p_target_date`) e as saídas do dia (`outflow_date = p_target_date`) — sem `AND co.status = 'pending'`.
  - `get_projected_balance_summary`: as 3 ocorrências de saídas — (a) total futuro `outflow_date > v_today AND <= v_today + p_projection_days`, (b) loop diário `outflow_date = v_day_date`, e qualquer ocorrência de saldo de hoje — todas sem `co.status='pending'` / `AND co.status = 'pending'`.

  PRESERVAR sem alteração tudo o mais:
  - Assinaturas exatas: `get_cashflow(UUID, DATE, DATE)`, `get_daily_balance(UUID, DATE)`, `get_projected_balance_summary(UUID, INT)`.
  - `RETURNS TABLE (...)` de cada função (colunas e tipos idênticos).
  - `LANGUAGE plpgsql`, `SECURITY INVOKER` (NUNCA DEFINER — DEFINER + p_org_id = IDOR, ver feedback_supabase_security_invoker), `SET search_path = 'public'`.
  - Todo o recorte futuro-only existente: `v_start := GREATEST(p_start_date, CURRENT_DATE)` em get_cashflow, `v_today := CURRENT_DATE` em get_projected_balance_summary, e todas as condições de data (`BETWEEN`, `<`, `=`, `>`, `<=`). O futuro-only continua garantido APENAS pelas condições de data — não pelo status.
  - Window functions (SUM OVER ORDER BY), CTEs, lógica de SMA, loop dia a dia, detecção de critical_date/min_balance — tudo idêntico.
  - Bloco final de controle de acesso: `REVOKE EXECUTE ... FROM PUBLIC, anon` e `GRANT EXECUTE ... TO authenticated` para as 3 funções.
  - NÃO tocar em `cash_inflows`, frontend ou edge functions. Escopo é exclusivamente as 3 RPCs.

  Adicionar no topo do arquivo um cabeçalho de comentário explicando: que esta migration substitui o filtro `status='pending'` por "qualquer status", o motivo (contas Tiny agendadas viram status='paid' com data futura e sumiam — R$44.064,95 / 13 contas), e que o recorte futuro-only é garantido pelas condições de data. Marcar como idempotente (CREATE OR REPLACE). Apontar o projeto Supabase alvo: `ckcdevcxgvueywivefgx`.
  </action>
  <verify>
    <automated>test -f supabase/migrations/20260618210000_cash_flow_rpcs_all_statuses.sql && grep -v '^--' supabase/migrations/20260618210000_cash_flow_rpcs_all_statuses.sql | grep -c "co.status" | grep -qx 0 && echo OK_NO_STATUS_FILTER</automated>
  </verify>
  <done>
  O arquivo `supabase/migrations/20260618210000_cash_flow_rpcs_all_statuses.sql` existe, contém `CREATE OR REPLACE FUNCTION` para as 3 funções com assinaturas e RETURNS TABLE idênticos à produção, ZERO referências a `co.status` em linhas não-comentário, mantém `SECURITY INVOKER` + `SET search_path = 'public'` nas 3, mantém os blocos REVOKE/GRANT, e preserva todas as condições de data (futuro-only intacto). `cash_inflows` inalterado.
  </done>
</task>

<task type="auto">
  <name>Task 2: Validar e commitar a migration</name>
  <files>supabase/migrations/20260618210000_cash_flow_rpcs_all_statuses.sql</files>
  <action>
  Validação estática do SQL produzido na Task 1 (sem aplicar em produção — o executor não tem Supabase MCP):
  - Confirmar que cada uma das 3 funções aparece exatamente uma vez como `CREATE OR REPLACE FUNCTION`.
  - Confirmar contagem de blocos `SECURITY INVOKER` = 3, `SET search_path = 'public'` = 3.
  - Confirmar 3 `GRANT EXECUTE ... TO authenticated` e os `REVOKE ... FROM PUBLIC, anon` correspondentes.
  - Confirmar que NENHUMA linha de código (não-comentário) contém `co.status`.
  - Confirmar que as condições de data ainda existem (ao menos um `GREATEST(p_start_date, CURRENT_DATE)` ou `CURRENT_DATE`, e ocorrências de `outflow_date`).
  - Sanidade de parênteses/`$$`: cada função abre e fecha com `AS $$ ... $$;`.

  Em seguida, fazer o commit do arquivo de migration na branch atual (`preview/phase-49-fluxo-caixa`). Mensagem sugerida: `fix(cashflow): RPCs consideram contas a pagar de qualquer status (paid+pending), recorte futuro-only mantido`.

  NÃO aplicar a migration em produção. NÃO fazer push se a política do projeto exigir confirmação — apenas commit local. Deixar registrado no SUMMARY que o `apply_migration` no projeto `ckcdevcxgvueywivefgx` é responsabilidade do orquestrador.
  </action>
  <verify>
    <automated>grep -c "CREATE OR REPLACE FUNCTION" supabase/migrations/20260618210000_cash_flow_rpcs_all_statuses.sql | grep -qx 3 && grep -c "SECURITY INVOKER" supabase/migrations/20260618210000_cash_flow_rpcs_all_statuses.sql | grep -qx 3 && grep -c "TO authenticated" supabase/migrations/20260618210000_cash_flow_rpcs_all_statuses.sql | grep -qx 3 && git -C . log --oneline -1 | grep -qi cashflow && echo OK_VALIDATED_COMMITTED</automated>
  </verify>
  <done>
  Validação estática passa: 3 `CREATE OR REPLACE FUNCTION`, 3 `SECURITY INVOKER`, 3 `GRANT ... TO authenticated`, zero `co.status` em código. O arquivo está commitado na branch `preview/phase-49-fluxo-caixa`. O SUMMARY registra que a aplicação em produção (`apply_migration` em `ckcdevcxgvueywivefgx`) cabe ao orquestrador.
  </done>
</task>

</tasks>

<verification>
- A migration recria as 3 RPCs com assinaturas idênticas e sem filtro de status nas saídas.
- Recorte futuro-only preservado (condições de data intactas).
- SECURITY INVOKER + search_path + REVOKE/GRANT preservados.
- `cash_inflows`, frontend e EFs intocados.
- Validação manual pós-deploy (pelo orquestrador, fora deste plano): chamar `get_projected_balance_summary` em produção deve refletir as 13 contas 'paid' futuras (R$44.064,95) no `total_expenses` e no saldo projetado.
</verification>

<success_criteria>
- `supabase/migrations/20260618210000_cash_flow_rpcs_all_statuses.sql` existe e está commitado.
- Zero ocorrências de `co.status` em linhas de código das 3 funções.
- 3× `SECURITY INVOKER`, 3× `SET search_path = 'public'`, 3× `GRANT EXECUTE ... TO authenticated`.
- Todas as condições de data (futuro-only) preservadas.
- SUMMARY indica que o `apply_migration` em `ckcdevcxgvueywivefgx` é do orquestrador.
</success_criteria>

<output>
Create `.planning/quick/260618-sum-corrigir-rpcs-de-fluxo-de-caixa-consider/260618-sum-SUMMARY.md` when done.
</output>
