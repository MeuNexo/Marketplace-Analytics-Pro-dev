---
phase: 99-dre-caixa-apura-o-por-recebimento-mercado-pago-p-gina-dedica
verified: 2026-07-17T02:45:00Z
status: passed
score: 13/13 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 99: DRE Caixa — apuração por recebimento Mercado Pago (página dedicada) Verification Report

**Phase Goal:** Página nova dedicada `/dre-caixa` que responde "o que entrou no mês pagou as contas do mês, ou tirei dinheiro de outro lugar?" — apuração em regime de caixa puro (entradas = liberações líquidas MP por release_date; saídas = cash_outflows pagas no mês incl. fornecedores e estornos por data real). Badge-resposta, KPIs, cascata com drill-down por categoria, evolução + histórico 12 meses, previsão de imposto informativa, banner dado-velho. DRE por faturamento intocada; zero acoplamento com saldo/projeções do Fluxo de Caixa.

**Verified:** 2026-07-17
**Status:** passed
**Re-verification:** No — initial verification

**Nota sobre escopo:** a phase teve 4 fixes aprovados pelo dono durante o checkpoint Task 3 (fornecedores como saída; entrada cheia+estorno como saída; estorno no mês do débito via `refund_date`; bloco `excluido` por categoria). Migrations `20260717010000`/`020000`/`030000` e EF `sync-mp-releases` v6 fazem parte do escopo entregue. Divergências dos planos originais que foram decisões explícitas do dono não foram tratadas como gaps (conforme instrução do orquestrador). Gates humanos de reconciliação × extrato MP e ok visual estão registrados como APROVADOS por Wesley em 99-03-SUMMARY.md (2026-07-17) — tratados como PASSED.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `get_dre_cash`/`get_dre_cash_items`/`get_dre_cash_history` existem em prod, SECURITY INVOKER, REVOKE/GRANT explícito | ✓ VERIFIED | 4 migrations no repo (`20260717000000/010000/020000/030000`); todas com `LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'` + `REVOKE EXECUTE ... FROM PUBLIC, anon` + `GRANT ... TO authenticated`; aplicadas em prod via MCP com evidência registrada em 99-01-SUMMARY.md (EXPLAIN ANALYZE 402ms, anti-IDOR 0 linhas contra org Thales real) |
| 2 | Régua de saídas = `cash_outflows.status='paid'` por `outflow_date`, blocos via `dre_bloco_for_category`, `cancelled` excluídas | ✓ VERIFIED | `status = 'paid'` literal em todas as CTEs de saída das 4 migrations; nenhuma referência a `competence_date` no corpo SQL (`grep -v '^--'` retorna 0) |
| 3 | Fornecedores (bloco `excluido`) somam como saída (decisão do dono, checkpoint) | ✓ VERIFIED | Migration `20260717010000` remove o filtro `<> 'excluido'` do histórico; `dreCashCascade.ts` trata `excluido` como primeira linha de saída operacional (`SAIDA_BLOCOS[0]`); testado em `dreCashCascade.test.ts` ("Test 9") |
| 4 | Entrada cheia + estorno como linha de saída explícita | ✓ VERIFIED | Migration `20260717020000`: `liquido`/`bruto` somam só créditos (`net_amount > 0`), `refunds` vira estorno negativo; `dreCashCascade.ts` inverte em linha "Estornos (devoluções MP)" com ABS, `drillable:false`; testado ("Test 10", cenário real de junho reconciliado a ~R$1) |
| 5 | Estorno pesa no mês em que o dinheiro saiu (`refund_date`), não no mês da venda | ✓ VERIFIED | Migration `20260717030000` adiciona coluna `cash_inflows.refund_date` + índice; RPCs usam `COALESCE(refund_date, release_date)` no filtro/agrupamento; EF `supabase/functions/sync-mp-releases/index.ts` grava `refund_date` no upsert (linha 245) |
| 6 | Bloco `excluido` exibido por categoria com drill-down (não linha única opaca) | ✓ VERIFIED | `buildExcluidoLines()` em `dreCashCascade.ts` agrupa por categoria com rótulos amigáveis; testado ("Test 11", 4 sub-casos incl. regressão de categoria única) |
| 7 | Badge-resposta verde/vermelho/neutro com selo "mês em andamento" | ✓ VERIFIED | `buildDreCashCascade` retorna `badge.tone`/`texto` determinístico (testado: Tests 3/4/5); `MLDreCaixa.tsx` renderiza `<BadgeResposta>` com selo "mês em andamento" condicional a `isCurrentMonth` (linhas 357-363) |
| 8 | Cascata com drill-down bloco→categoria→lançamento sob demanda | ✓ VERIFIED | `MLDreCaixa.tsx` usa `Collapsible` por linha de saída (`SaidaBlocoRow`), dispara `useDreCashItems(pMonth, bloco)` só ao expandir (`enabled: !!bloco` confirmado em `useDreCashItems.ts`) |
| 9 | Previsão de imposto (média 3 meses) com alerta de desvio, null → "—" | ✓ VERIFIED | `computePrevisaoDesvio` null-safe (testado: Test 7, 3 casos incl. previsto null/0); KPI tile renderiza "—" quando `impostoPrevisto === null` (linha 396) |
| 10 | Banner dado-velho acusa `cash_inflows`/`cash_outflows` separadamente | ✓ VERIFIED | `useCashFreshness.ts` faz 2 leituras RLS paralelas (`maybeSingle` × 2); `MLDreCaixa.tsx` exibe cada fonte separadamente (linhas 307-314) |
| 11 | Wiring completo: rota `/dre-caixa` + role `OPERATIONAL` + meta + menu desktop/mobile | ✓ VERIFIED | `App.tsx:147` (Route+RoleRoute+ErrorBoundary), `roleAccess.ts:27` (`OPERATIONAL`, fora de VIEWER_ELIGIBLE_ROUTES), `routeMeta.ts:25`, `ApiSidebar.tsx:58`, `ApiMobileSidebar.tsx:46` — todos presentes |
| 12 | Zero acoplamento com Fluxo de Caixa/DRE de faturamento; DRE por faturamento intocada | ✓ VERIFIED | `grep -rn "get_cashflow\|get_treasury_panel\|financial_settings\|initial_balance"` nos 9 arquivos novos/modificados da phase (page, lib, 4 hooks, 3 migrations SQL + EF) retorna 0 matches; `git log 46162110^..HEAD -- src/pages/MercadoLivre.tsx src/lib/dreCascade.ts` retorna vazio (phase 99 não tocou nesses arquivos) |
| 13 | Suíte de testes verde + tsc limpo + zero debt markers | ✓ VERIFIED | `npx vitest run` → 626/626 testes verdes (45 arquivos, incl. `dreCashCascade.test.ts` com 20 testes); `npx tsc --noEmit` → exit 0; `grep TBD\|FIXME\|XXX` nos arquivos da phase → 0 matches |

**Score:** 13/13 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260717000000_dre_cash_rpcs.sql` | 3 RPCs novas, SECURITY INVOKER | ✓ VERIFIED | 305 linhas, 3× `CREATE FUNCTION`, INVOKER/REVOKE/GRANT presentes |
| `supabase/migrations/20260717010000_dre_cash_history_fornecedores.sql` | fix checkpoint: fornecedores no histórico | ✓ VERIFIED | `CREATE OR REPLACE` de `get_dre_cash_history`, comentário de decisão do dono |
| `supabase/migrations/20260717020000_dre_cash_estorno_como_saida.sql` | fix checkpoint: entrada cheia + estorno saída | ✓ VERIFIED | `CREATE OR REPLACE` de `get_dre_cash`/`get_dre_cash_history` |
| `supabase/migrations/20260717030000_cash_inflows_refund_date.sql` | fix checkpoint: coluna `refund_date` + régua própria | ✓ VERIFIED | `ALTER TABLE` + índice + `CREATE OR REPLACE` das 2 RPCs |
| `supabase/functions/sync-mp-releases/index.ts` | grava `refund_date` (v6) | ✓ VERIFIED | linha 245 `refund_date: refundDate` no upsert |
| `src/lib/dreCashCascade.ts` | lib pura da cascata + badge + previsão | ✓ VERIFIED | 437 linhas, zero import React/Supabase, `buildDreCashCascade`/`computePrevisaoDesvio` exportados |
| `src/lib/dreCashCascade.test.ts` | testes vitest | ✓ VERIFIED | 394 linhas, 20 testes, cobre os 4 fixes do checkpoint com cenário real de junho |
| `src/hooks/useDreCash.ts` / `useDreCashItems.ts` / `useDreCashHistory.ts` / `useCashFreshness.ts` | 4 hooks TanStack Query | ✓ VERIFIED | padrão `useDreOperational` clonado; `useDreCashItems` com `enabled` lazy; `useCashFreshness` com 2 `maybeSingle` |
| `src/pages/mercadolivre/MLDreCaixa.tsx` | página completa (602 linhas, min 200) | ✓ VERIFIED | header+badge, 4 KPICards, cascata drill-down, evolução 12m (Recharts), tabela histórico, banner dado-velho |
| `src/App.tsx`, `roleAccess.ts`, `routeMeta.ts`, `ApiSidebar.tsx`, `ApiMobileSidebar.tsx` | wiring | ✓ VERIFIED | `/dre-caixa` presente nos 5 arquivos |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `MLDreCaixa.tsx` | `dreCashCascade.ts` | `buildDreCashCascade(rows)` | ✓ WIRED | linha 251, memoizado sobre `useDreCash(pMonth).data` |
| `MLDreCaixa.tsx` | `useDreCashItems.ts` | drill-down sob demanda | ✓ WIRED | linha 256, `enabled` só dispara com bloco selecionado |
| `App.tsx` | `MLDreCaixa.tsx` | `React.lazy` + `Route path="/dre-caixa"` | ✓ WIRED | linhas 40 e 147 |
| `useDreCash.ts` | RPC `get_dre_cash` | `supabase.rpc("get_dre_cash", {...})` | ✓ WIRED | confirmado no arquivo |
| migrations `010000/020000/030000` | `20260717000000` (base) | `CREATE OR REPLACE FUNCTION` (nunca `DROP`) | ✓ WIRED | preserva ACL (lição `feedback_drop_function_apaga_acl`), confirmado nos comentários e corpo SQL |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Suíte completa de testes | `npx vitest run` | 626/626 testes passaram, 45 arquivos, `dreCashCascade.test.ts` 20/20 | ✓ PASS |
| Typecheck | `npx tsc --noEmit` | exit 0, sem erros | ✓ PASS |
| Zero acoplamento Fluxo de Caixa | `grep -rn "get_cashflow\|get_treasury_panel\|financial_settings\|initial_balance"` nos 9 arquivos da phase | 0 matches (exit 1) | ✓ PASS |
| DRE de faturamento intocada | `git log 46162110^..HEAD -- src/pages/MercadoLivre.tsx src/lib/dreCascade.ts` | vazio (phase 99 não tocou) | ✓ PASS |
| Debt markers | `grep TBD\|FIXME\|XXX` nos arquivos da phase | 0 matches | ✓ PASS |

### Requirements Coverage

Nota: DREC-01..06 não estão cadastrados em `.planning/REQUIREMENTS.md` (confirmado por grep vazio) — a phase entrou via Roadmap Evolution, não via fluxo de REQUIREMENTS formal. Cobertura avaliada contra o texto do ROADMAP.md (Phase 99) e os `must_haves` dos 3 PLAN.md.

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| DREC-01 | 99-01 | RPC `get_dre_cash` cascata do mês | ✓ SATISFIED | migration + provas SQL registradas |
| DREC-02 | 99-01 | RPC `get_dre_cash_items` drill-down | ✓ SATISFIED | migration + hook + UI wired |
| DREC-03 | 99-01 | RPC `get_dre_cash_history` série 12 meses | ✓ SATISFIED | migration + hook + gráfico/tabela |
| DREC-04 | 99-02/99-03 | Página + hooks + lib pura testada | ✓ SATISFIED | página 602 linhas, 20 testes vitest |
| DREC-05 | 99-01/99-02/99-03 | Previsão de imposto + alerta de desvio | ✓ SATISFIED | `computePrevisaoDesvio` testado, KPI tile renderiza alerta |
| DREC-06 | 99-02/99-03 | Banner dado-velho via `max(synced_at)` duplo | ✓ SATISFIED | `useCashFreshness` + banner na página |

### Anti-Patterns Found

Nenhum. Zero debt markers (`TBD`/`FIXME`/`XXX`), zero `TODO`/`HACK`/`PLACEHOLDER`, zero stub visual nos arquivos da phase.

### Human Verification Required

Nenhuma pendência. Os 2 gates humanos da phase já foram executados e aprovados:
- **Anti-IDOR + performance <8s** (checkpoint 99-01 Task 2): aprovado, evidência registrada em `99-01-SUMMARY.md` (EXPLAIN ANALYZE 402ms; org Thales real sob impersonação Pé Vermeio → 0 linhas/zerado nas 3 RPCs).
- **Reconciliação mês fechado × extrato MP + ok visual** (checkpoint 99-03 Task 3): aprovado por Wesley em 2026-07-17, evidência registrada em `99-03-SUMMARY.md` (reconciliação de junho fecha a ~R$1 contra a planilha manual, preview Vercel `https://marketplace-analytics-pro-q8wnwo112-xambrafios-projects.vercel.app` validado, commit `354d44e8`).

### Gaps Summary

Nenhum gap. Todos os 13 must-haves derivados do ROADMAP (Success Criteria 1-6) + constraints explícitas do orquestrador (wiring, separação de escopo, suíte verde, tsc limpo) foram verificados diretamente no código e nas migrations, com evidência de commit para cada um. Os 4 ajustes pós-checkpoint (fornecedores/estorno/refund_date/bloco excluído por categoria) são decisões documentadas do dono, não desvios não resolvidos — código e testes refletem essas decisões de forma consistente entre backend (RPCs), lib pura e UI.

---

*Verified: 2026-07-17*
*Verifier: Claude (gsd-verifier)*
