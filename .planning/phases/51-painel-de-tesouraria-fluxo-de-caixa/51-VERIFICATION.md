---
phase: 51-painel-de-tesouraria-fluxo-de-caixa
verified: 2026-06-20T00:00:00Z
status: human_needed
score: 7/7 must-haves verified (code-level); 2 items require DB/visual validation by orchestrator
overrides_applied: 0
human_verification:
  - test: "Confirmar que a migration 20260650000000_treasury_panel.sql foi aplicada no projeto LIVE ckcdevcxgvueywivefgx (coluna alert_threshold + 3 RPCs com prosecdef=false)"
    expected: "1 linha para alert_threshold em information_schema.columns; 3 RPCs em pg_proc com prosecdef=false (INVOKER)"
    why_human: "Verificador não tem Supabase MCP. SUMMARY 51-01 afirma aplicação via apply_migration, mas isso não é verificável no código/git — requires DB validation by orchestrator"
  - test: "Validar valores do painel no preview Vercel com Wesley (smoke get_treasury_panel)"
    expected: "Burn Rate, Fornec 30/60/90d, Total Exposição coerentes com a operação atual"
    why_human: "SUMMARY 51-01 reporta smoke ao vivo com valores ~2x acima da imagem de referência do Wesley (burn≈191k vs 124k; total_exposicao≈2,12M vs 671k). SUMMARY justifica que a imagem era snapshot antigo, mas a divergência precisa de confirmação visual/numérica do Wesley antes do merge — checkpoint Task 4 do 51-03 (visual approval) é blocking"
  - test: "Confirmar definição do Burn Rate (D-08) com Wesley: média mensal 3m (atual) vs janela 30d"
    expected: "Wesley confirma manter 3m (subtítulo 'média mensal (3m)') ou pede troca para 30d"
    why_human: "Ponto aberto explícito em D-08/CONTEXT — Wesley marcou '30 dias' no bloco original; implementação manteve 3m para evitar duplicidade com Saída Real. SUMMARY 51-03 diz 'pre-authorized', mas o CONTEXT marca como ponto a confirmar no checkpoint"
---

# Phase 51: Painel de Tesouraria (Fluxo de Caixa) — Verification Report

**Phase Goal:** Substituir os 3 cards da aba "Caixa Real" por um painel de tesouraria — 12 KPIs em 3 faixas + 3 gráficos (Saldo Projetado reuso, Composição de Custos por Mês, Exposição por Fornecedor 30/60/90d). Card "Posso comprar mais estoque?" sai. Simulador (Phase 50) preservado.
**Verified:** 2026-06-20
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria + PLAN must_haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Aba "Caixa Real" exibe 12 KPIs em 3 faixas (Saúde / Realizado / Exposição) | ✓ VERIFIED | `TreasuryPanel.tsx` renderiza Saldo Atual, Runway, Saldo Mín 90d, Alerta (faixa 1, header amber); Entrada Real, Saída Real, Resultado, Burn Rate (faixa 2, header blue); Fornec ≤30/60/90d, Total Exposição (faixa 3, header orange). Todos via hooks reais, sem hardcode |
| 2 | Card "Posso comprar mais estoque?" (CapacityCard) removido da página | ✓ VERIFIED | `grep -cE "TodayBalanceCard\|ProjectedBalanceCard\|CapacityCard" MLFluxoCaixa.tsx` = 0. Arquivos mantidos em disco (D-01 — só removidos da página) |
| 3 | Gráfico Saldo Projetado mantido (reuso do CashFlowChart) | ✓ VERIFIED | `CashFlowChart` importado e renderizado (linha 251), hook `useCashFlowData` intocado. grep = 2 ocorrências |
| 4 | Gráfico novo: Composição de Custos por Mês (barras empilhadas por categoria) | ✓ VERIFIED | `CostCompositionChart.tsx` — pivot long→wide com useMemo, `<Bar stackId="stack">` por categoria dinâmica via `useCostByMonth(9)`, empty state |
| 5 | Gráfico novo: Exposição por Fornecedor (barras 30/60/90d por supplier) | ✓ VERIFIED | `SupplierExposureChart.tsx` — 3 `<Bar>` sem stackId (amount_30d/60d/90d) via `useSupplierExposure(10)`, truncate, empty state |
| 6 | Aba "Simulador" (Phase 50) preservada e intocada | ✓ VERIFIED | `CashFlowSimulator` importado/renderizado em TabsContent value="simulador" (grep = 2). Edição cirúrgica restrita à aba "real" |
| 7 | Fórmulas/janelas de cada KPI travadas no CONTEXT e implementadas conforme referência | ✓ VERIFIED (código) / ? checkpoint | RPC `get_treasury_panel` implementa D-02..D-09b: Burn Rate = SUM(90d)/3.0 (D-08), Saída Real = status='paid' 30d (D-07), Fornec cumulativo pending (D-09), Total Expo todas pending (D-09b), min_balance_date arg-min loop 90d (D-05), alert_date 1º cruzamento <threshold (D-06). Runway com guard div/0. Valores absolutos requerem confirmação no checkpoint visual |

**Score:** 7/7 truths verificadas no nível de código. Truth #1, #7 e a aplicação da migration têm itens delegados ao orquestrador/Wesley (ver Human Verification).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260650000000_treasury_panel.sql` | ALTER + 3 RPCs INVOKER + REVOKE/GRANT | ✓ VERIFIED | Coluna idempotente (EXCEPTION duplicate_column); 3 CREATE OR REPLACE FUNCTION; 0 SECURITY DEFINER em linhas não-comentário (única ocorrência é comentário linha 41); min_balance_date no RETURNS TABLE + RETURN QUERY; BRT em todas; REVOKE PUBLIC,anon + GRANT authenticated p/ as 3 assinaturas |
| `supabase/migrations/20260650000100_treasury_category_backfill.sql` | Backfill categoria Tiny | ✓ VERIFIED (desvio justificado) | Fila + pg_net + pg_cron. Usa SECURITY DEFINER, mas em PROCEDURES de cron/admin (lê token server-side), NÃO em RPC user-facing com org_id-param — fora do padrão IDOR proibido |
| `src/hooks/useTreasuryPanel.ts` | hook + TreasuryPanelData (10 escalares) | ✓ VERIFIED | rpc("get_treasury_panel"), data?.[0], Number()/String() coercion, min_balance_date incluído |
| `src/hooks/useCostByMonth.ts` | hook + CostByMonthRaw | ✓ VERIFIED | rpc("get_cost_by_month"), array map, sem select direto |
| `src/hooks/useSupplierExposure.ts` | hook + SupplierExposureRow | ✓ VERIFIED | rpc("get_supplier_exposure"), array map, sem select direto |
| `src/hooks/useFinancialSettings.ts` | alert_threshold (default 30000) | ✓ VERIFIED | Na interface, DEFAULTS, .select() e mapeamento — 4 pontos |
| `src/components/financial/TreasuryPanel.tsx` | 12 KPIs em 3 faixas (≥80 linhas) | ✓ VERIFIED | 284 linhas; 3 hooks; AlertTriangle; runway guard `burn_rate > 0` |
| `src/components/financial/CostCompositionChart.tsx` | BarChart empilhado | ✓ VERIFIED | 154 linhas; stackId="stack"; useCostByMonth |
| `src/components/financial/SupplierExposureChart.tsx` | BarChart agrupado 3 séries | ✓ VERIFIED | 105 linhas; 3 Bars; useSupplierExposure |
| `src/pages/mercadolivre/MLFluxoCaixa.tsx` | wiring + remoção de cards | ✓ VERIFIED | TreasuryPanel + 2 gráficos na aba real; 3 cards removidos; Simulador/CashFlowChart preservados |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `get_treasury_panel` | `cash_outflows/cash_inflows/financial_settings` | agregação por p_org_id sob SECURITY INVOKER | ✓ WIRED | Filtra `organization_id = p_org_id` sob INVOKER — RLS org-first faz isolamento; org_id é filtro, não trust-bypass. Padrão correto (não-IDOR) |
| `useTreasuryPanel` | `get_treasury_panel` RPC | supabase.rpc("get_treasury_panel",{p_org_id}) | ✓ WIRED | — |
| `useFinancialSettings` | `financial_settings.alert_threshold` | .select inclui alert_threshold | ✓ WIRED | — |
| `TreasuryPanel` | `useTreasuryPanel / useProjectedBalance(90) / useFinancialSettings` | hooks de dados | ✓ WIRED | useProjectedBalance(90) — assinatura aceita projectionDays (default), passa p_projection_days |
| `MLFluxoCaixa` | `TreasuryPanel / CostCompositionChart / SupplierExposureChart` | render em TabsContent value="real" | ✓ WIRED | — |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| TreasuryPanel | treasury/projected/settings | useTreasuryPanel → RPC; useProjectedBalance → RPC; useFinancialSettings → table | RPC agregam cash_* reais (não estático) | ✓ FLOWING (code) / requires DB validation por orquestrador (migration aplicada?) |
| CostCompositionChart | rawData | useCostByMonth → get_cost_by_month | RPC com SUM/GROUP BY sobre cash_outflows | ✓ FLOWING (depende do backfill de categoria — empty state coberto) |
| SupplierExposureChart | exposureData | useSupplierExposure → get_supplier_exposure | RPC com FILTER por janela | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Compila sem erros de tipo | `npx tsc --noEmit` | exit 0 | ✓ PASS |
| Build de produção | `npm run build` | ✓ built in 15.43s, exit 0 | ✓ PASS |
| RPCs INVOKER (não DEFINER) | grep não-comentário "SECURITY DEFINER" na migration | 0 | ✓ PASS |
| 12 KPIs presentes | inspeção TreasuryPanel.tsx | 12 KpiCards/Cards em 3 faixas | ✓ PASS |
| Smoke RPC ao vivo | `SELECT * FROM get_treasury_panel(...)` | não executável (sem MCP) | ? SKIP — requires DB validation by orchestrator |

### Probe Execution

N/A — fase de UI/migration; nenhum probe `scripts/*/tests/probe-*.sh` declarado.

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| TESO-01 (12 KPIs) | 51-02, 51-03 | ✓ SATISFIED | TreasuryPanel + useTreasuryPanel |
| TESO-02 (3 gráficos) | 51-02, 51-03 | ✓ SATISFIED | CostCompositionChart + SupplierExposureChart + CashFlowChart reuso |
| TESO-03 (alert_threshold config) | 51-01, 51-02 | ✓ SATISFIED (code) | Coluna na migration + useFinancialSettings; aplicação live requires DB validation |
| TESO-04 (RPC agregação INVOKER) | 51-01 | ✓ SATISFIED (code) | get_treasury_panel INVOKER; aplicação live requires DB validation |
| TESO-05 (Simulador preservado) | 51-03 | ✓ SATISFIED | CashFlowSimulator intocado |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (nenhum) | — | — | — | Zero debt markers (TODO/FIXME/XXX) nos arquivos entregues; zero stubs; sem dados hardcoded fluindo para render |

### Human Verification Required

1. **Migration aplicada no LIVE** — Confirmar via SQL (orquestrador c/ MCP): coluna alert_threshold + 3 RPCs prosecdef=false em ckcdevcxgvueywivefgx. (requires DB validation by orchestrator)
2. **Valores do painel vs realidade** — SUMMARY 51-01 reporta smoke ~2x acima da imagem de referência (burn≈191k vs 124k; total≈2,12M vs 671k). Justificado como snapshot antigo, mas precisa confirmação visual de Wesley antes do merge (checkpoint Task 4 do 51-03 é blocking).
3. **Definição do Burn Rate (D-08)** — manter 3m (atual) ou trocar para 30d. Ponto aberto explícito no CONTEXT; SUMMARY diz pré-autorizado mas o checkpoint visual deve registrar a decisão final de Wesley.

### Gaps Summary

Nenhum gap bloqueante no código. Backend (3 RPCs INVOKER + coluna + REVOKE/GRANT + BRT) e frontend (3 hooks RPC-only sem truncamento, 12 KPIs reais, 2 gráficos, wiring preservando CashFlowChart/Simulator, 3 cards antigos removidos) estão entregues e compilam/buildam limpos. O status é **human_needed** porque: (a) a aplicação da migration no projeto LIVE não é verificável sem Supabase MCP (delegada ao orquestrador), e (b) o checkpoint visual blocking (Task 4) com Wesley — incluindo a divergência de valores do smoke vs referência e a confirmação do Burn Rate 3m/30d — é parte do contrato da fase e ainda depende de confirmação humana.

---

_Verified: 2026-06-20_
_Verifier: Claude (gsd-verifier)_
