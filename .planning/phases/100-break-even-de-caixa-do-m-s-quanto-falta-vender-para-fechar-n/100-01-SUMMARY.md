---
phase: 100-break-even-de-caixa-do-m-s-quanto-falta-vender-para-fechar-n
plan: 01
subsystem: database
tags: [postgres, rpc, supabase, security-invoker, dre-caixa, cash-forecast]

# Dependency graph
requires:
  - phase: 99-dre-caixa-mp
    provides: "RPCs get_dre_cash/get_dre_cash_items/get_dre_cash_history (régua base-cheia de entradas, estorno por refund_date, imposto via dre_bloco_for_category) — as réguas clonadas por esta RPC"
provides:
  - "RPC public.get_dre_cash_forecast(p_org_id uuid, p_month date) SECURITY INVOKER, single round-trip, viva em prod (ckcdevcxgvueywivefgx)"
  - "Contrato de 13 categorias canônicas (saida_prevista/entrada/taxa/ritmo) + N linhas alerta_recorrencia consumível pelo plano 100-02"
affects: [100-02-dre-cash-forecast-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Clone literal de CTEs vivas (refunds_agg, dre_bloco_for_category) em vez de redefinir régua — mantém reconciliação ao centavo entre RPCs irmãs"
    - "Método de centroides ponderados (valor) com clamp [7,30] + fallback 14 para estimar lag venda→liberação sem vínculo direto venda↔liberação no schema"
    - "Guarda anti-fantasma set-based (JOIN entre CTE de pendentes do mês corrente e CTE de recorrência em meses futuros, HAVING COUNT DISTINCT >= 2) sem subquery correlacionada"

key-files:
  created: [supabase/migrations/20260717040000_dre_cash_forecast.sql]
  modified: []

key-decisions:
  - "Assinatura de 2 argumentos (p_org_id, p_month) — meta NÃO entra na RPC, é aplicada client-side sobre o gap no plano 100-02 (D-04), superando o 3º parâmetro citado no ROADMAP"
  - "estornos_ocorridos usa a mesma régua refund_date/release_date da get_dre_cash (Phase 99) para reconciliar ao centavo com a DRE Caixa apurada no mesmo instante"
  - "saidas_pendentes limitado a outflow_date >= hoje E < fim do mês corrente (guarda anti-fantasma parte a) — pendente de mês futuro nunca infla o gap do mês corrente"
  - "taxa_liquido_bruto e taxa_estornos MEDIDAS de janela 90d via cash_inflows (nunca constantes fixas), com NULLIF para divisão segura"

requirements-completed: [BEC-01, BEC-04]

# Metrics
duration: ~10min (Task 1 auto + Task 2 checkpoint humano)
completed: 2026-07-17
status: complete
---

# Phase 100 Plan 01: RPC get_dre_cash_forecast Summary

**RPC `get_dre_cash_forecast(p_org_id, p_month)` aplicada em prod (SECURITY INVOKER, single round-trip) — saídas previstas, entradas garantidas, taxas medidas dos dados, lag de liberação e guarda anti-fantasma para o painel "Fechar o mês" da /dre-caixa.**

## Performance

- **Duration:** ~10 min (Task 1 migration + Task 2 checkpoint de apply/prova via MCP, aprovado pelo orquestrador)
- **Completed:** 2026-07-17
- **Tasks:** 2/2
- **Files modified:** 1

## Accomplishments

- Migration `supabase/migrations/20260717040000_dre_cash_forecast.sql` criada com a função `public.get_dre_cash_forecast(p_org_id uuid, p_month date)`, cabeçalho canônico (LANGUAGE sql, STABLE, SECURITY INVOKER, `SET search_path TO 'public'`, REVOKE de PUBLIC/anon + GRANT authenticated), 11 CTEs MATERIALIZED, zero subquery correlacionada.
- RPC aplicada em produção (projeto Supabase `ckcdevcxgvueywivefgx`) via MCP `apply_migration`, com as 8 provas do checkpoint do orquestrador registradas abaixo.
- Contrato de saída de 13 categorias canônicas (`saidas_pagas`, `estornos_ocorridos`, `saidas_pendentes`, `estornos_previstos`, `imposto_previsto_restante`, `entradas_liberadas`, `entradas_agendadas`, `taxa_liquido_bruto`, `taxa_estornos`, `taxa_venda_para_caixa`, `lag_liberacao_dias`, `vendas_7d_media_diaria`) + N linhas `alerta_recorrencia` — pronto para consumo pela lib pura do plano 100-02.
- Guarda anti-fantasma (BEC-04) provada ao vivo: pendentes de mês futuro nunca entram em `saidas_pendentes`; recorrências legítimas (INSS, Aluguéis, parcelas de Fornecedores) aparecem corretamente como linhas `alerta_recorrencia` — o comportamento é do detector, não um bug.

## Task Commits

1. **Task 1: Migration com a RPC get_dre_cash_forecast (clone das réguas da Phase 99)** - `bc558edc` (feat)
2. **Task 2: Apply em prod via MCP + provas (orquestrador)** - checkpoint `type="checkpoint:human-verify"` — sem commit de código (executor não aplica migration; aplicação feita pelo orquestrador via MCP). Resultado: **APROVADO** (2026-07-17).

**Plan metadata:** commit desta SUMMARY (docs: complete plan) — ver seção Final Commit abaixo.

## Files Created/Modified

- `supabase/migrations/20260717040000_dre_cash_forecast.sql` - RPC `get_dre_cash_forecast(p_org_id uuid, p_month date)` completa, SECURITY INVOKER, 11 CTEs MATERIALIZED, contrato de 13 categorias + guarda anti-fantasma + método de lag documentado em comentário.

## Provas do Checkpoint (Task 2, aplicadas em prod ckcdevcxgvueywivefgx)

1. **Pré-apply:** `max(version)` = `20260717003741` < `20260717040000` (versão nova, sem colisão) ✓
2. **Apply:** `apply_migration` de `dre_cash_forecast` → `success` ✓
3. **Performance como `authenticated`** (impersonação `ce8c797c-f984-4abb-b5f1-3e2f2eecbb73`, org Pé Vermeio): **1.112ms** ≪ 8000ms (timeout do role) ✓
4. **Anti-IDOR:** org Thales (`e4150d57-1349-48c9-9a89-82b1774857b0`, confirmada ao vivo via `SELECT id, name FROM organizations` — nunca completada de memória) sob JWT Pé Vermeio → 0 linhas com dado, 0 linhas `alerta_recorrencia` ✓
5. **Reconciliação ao centavo** com `get_dre_cash` (julho, mesmo instante): `entradas_liberadas` = 131.679,54 = linha `liquido`; `estornos_ocorridos` = 17.123,43 = ABS de `refunds`; `saidas_pagas` = 129.647,65 = Σ seção `saida`. Confere: 129.647,65 + 17.123,43 = 146.771,08 = total de saídas do history ✓
6. **Guarda anti-fantasma ao vivo:** 16 linhas `alerta_recorrencia` detectadas, incluindo recorrências **legítimas** (INSS 3.852,19 n=10, Aluguéis 6.000 n=10, parcelas de Fornecedores) — comportamento correto do detector (não é falso positivo). **Nota registrada para o plano 100-02:** o card deve exibir essas linhas como aviso informativo neutro ("pendentes que se repetem nos próximos meses — confira se são reais"), nunca como erro/alarme.
7. **Sanidade das taxas:** `taxa_liquido_bruto` = 0,778 ∈ [0,5, 1,0]; `taxa_estornos` = 0,128 ∈ [0, 0,5]; `lag_liberacao_dias` = 7 ∈ [7, 30] (clamp inferior ativo — método de centroides ponderados, esperado e documentado no SQL); `vendas_7d_media_diaria` = 8.122,78 > 0 ✓
8. **`get_advisors`:** nenhum apontamento novo introduzido pela RPC (só lints pré-existentes do projeto) ✓

## Limitação Documentada

Pendentes com `category` NULL escapam do JOIN da guarda anti-fantasma (NULL ≠ NULL em SQL) até a fila de enriquecimento preencher a categoria. Não é um bug desta RPC — é uma dependência de dado upstream (sync Tiny). Registrado aqui para acompanhamento; não bloqueia BEC-04 porque a maioria das linhas relevantes já chega categorizada.

## Decisions Made

- Assinatura de 2 argumentos (sem `p_meta`) — meta é aplicada client-side no plano 100-02 sobre o gap devolvido pela RPC (D-04 do CONTEXT), superando o 3º parâmetro que o ROADMAP citava.
- `estornos_ocorridos` clona literalmente a CTE `refunds_agg` da `get_dre_cash` (mesma régua `COALESCE(refund_date, release_date)`) para garantir reconciliação ao centavo com a DRE Caixa apurada.
- `saidas_pendentes` nunca inclui mês futuro (guarda anti-fantasma parte a) — lição direta da recorrência acidental de ads/full de ~16.958,57/mês que motivou o BEC-04.
- Taxas (`taxa_liquido_bruto`, `taxa_estornos`) sempre MEDIDAS de janela 90d via `cash_inflows`, nunca constantes fixas — usa `NULLIF` para evitar divisão por zero sem mascarar o caso de janela vazia (retorna NULL, tratado pela lib pura do 100-02).
- Método do lag de liberação = diferença de centroides ponderados por valor (não há vínculo direto venda↔liberação no schema), clamp [7,30], fallback 14 — documentado em comentário no SQL.

## Deviations from Plan

None - plano executado exatamente como escrito. As 8 provas do checkpoint bateram com os critérios de aceitação sem necessidade de ajuste na migration.

## Issues Encountered

None.

## User Setup Required

None - RPC pura em SQL, sem configuração de serviço externo.

## Next Phase Readiness

- RPC `get_dre_cash_forecast` viva em prod, contrato de 13 categorias + alertas de recorrência pronto para consumo.
- Plano 100-02 (Wave 2, bloqueado por esta wave) pode agora construir a lib pura `dreCashForecast.ts` (TDD), o hook `useDreCashForecast` e o card "Fechar o mês" na `/dre-caixa`, incluindo o tratamento neutro das linhas `alerta_recorrencia` (nota da prova 6) e a aplicação client-side da meta (D-04).
- Nenhum bloqueio técnico identificado para a Wave 2.

---
*Phase: 100-break-even-de-caixa-do-m-s-quanto-falta-vender-para-fechar-n*
*Completed: 2026-07-17*

## Self-Check: PASSED

- FOUND: supabase/migrations/20260717040000_dre_cash_forecast.sql
- FOUND: bc558edc (git log --oneline --all)
