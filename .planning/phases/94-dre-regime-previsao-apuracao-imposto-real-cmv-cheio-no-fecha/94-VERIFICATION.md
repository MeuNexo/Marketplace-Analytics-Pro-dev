---
phase: 94-dre-regime-previsao-apuracao-imposto-real-cmv-cheio-no-fecha
verified: 2026-07-11T13:26:20Z
status: human_needed
score: 6/7 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Owner abre /vendas como owner da Pé Vermeio, navega o card DRE para Junho/2026, confirma Previsão (âmbar) idêntica ao validado 2026-07-10, clica 'Marcar mês como apurado', confirma selo emerald 'Apurado — guias de 07/2026', CMV vira cheio (~R$133.264,87) e imposto vira a guia real M+1 (ICMS de julho R$5.151,56 + PIS/COFINS), NÃO a guia de junho (R$4.793,21). Clica 'Reabrir mês' e confirma volta para Previsão. Confirma que uma sessão non-owner vê o selo mas NÃO vê o botão marcar/reabrir. Se as 3 guias saíram do placeholder, confirma que o empurrãozinho 🟢 aparece e NÃO fecha sozinho."
    expected: "Junho/2026 reconcilia ao centavo em apuração; previsão fica idêntica ao validado 2026-07-10; botão só aparece para owner; empurrãozinho é só dica."
    why_human: "Requer sessão viva com dados reais de produção (ckcdevcxgvueywivefgx), clique manual em UI, e comparação visual/numérica que grep/testes não alcançam. É o Task 3 checkpoint:human-verify do 94-03-PLAN.md, explicitamente deixado pendente no 94-03-SUMMARY.md ('NOT YET PERFORMED')."
---

# Phase 94: DRE Regime Previsão↔Apuração Verification Report

**Phase Goal:** O card "DRE do Mês" em `/vendas` tem dois regimes por mês — PREVISÃO (default, mês aberto: CMV médio + imposto estimado) e APURAÇÃO (mês fechado: CMV cheio + guias reais de imposto), com a virada disparada por clique manual do owner, persistido em `dre_month_close` (RLS org-first, reversível por DELETE), nunca misturando as bases.

**Verified:** 2026-07-11T13:26:20Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | (SC1) `dre_month_close` (PK org-first) live em prod, RLS owner-only write + member SELECT + reversível-por-DELETE, advisors limpos | ✓ VERIFIED | `supabase/migrations/20260694000000_dre_month_close.sql` cria a tabela + 3 policies (SELECT is_org_member; INSERT/DELETE `get_org_role(...)='owner'`; sem UPDATE) — cloned verbatim de `20260515120000_ml_tax_config.sql`. Aplicação em prod + advisors + proof recorded verbatim em `94-01-SUMMARY.md` (trusted per task instructions: DB-side facts aplicadas via MCP pelo orquestrador). Commit `2a3cb72f` existe no git log. |
| 2 | (SC2, redesenhado) M+1 shift vive no hook `useImpostoGuiaReal`, chamando `get_imposto_guia_by_competence` em `monthPlusOne(saleMonth)`; RPC grande NÃO é tocada (zero regressão nos outros 7 blocos) | ✓ VERIFIED | `src/hooks/useImpostoGuiaReal.ts:50` — `pCompetence = monthPlusOne(saleMonth)`, passado como `p_competence` na RPC. `monthPlusOne` em `src/lib/dreRegime.ts` usa aritmética numérica (não string-concat). Reconciliação junho/2026 provada por `dreRegime.test.ts` Test D (`toBeCloseTo(133264.87,2)` CMV cheio; soma guia 5151.56+716.19+3298.87). `git show --stat 2a3cb72f` confirma que 94-01 não tocou nenhuma RPC; 94-02/94-03 também não modificam nenhum arquivo SQL (só `supabase/migrations/20260694000000_dre_month_close.sql` no repo inteiro da fase). |
| 3 | (SC3) Regime derivado de presença em `dre_month_close`; bases nunca se misturam (médio+guia-real e cheio+estimado são inalcançáveis) | ✓ VERIFIED | `src/lib/dreRegime.ts` `resolveDreRegime()` — os dois branches (previsão/apuração) não compartilham nenhuma variável-base; provado estruturalmente por `dreRegime.test.ts` Test C (4 testes, incluindo "poison" de campos do branch errado). `npx vitest run src/lib/dreRegime.test.ts` → 18/18 verde (rodado nesta verificação). |
| 4a | (SC4, código) Card mostra selo do regime (âmbar "Previsão" / emerald "Apurado — guias de MM/YYYY") + botão owner-only marcar/reabrir + empurrãozinho 🟢 hint-only | ✓ VERIFIED | `src/components/mercadolivre/MLCostCard.tsx:179-236` — pill condicional por `regime`; botão `canClose && (...)` com `onClick={mesClosed ? onReopen : onClose}`; hint `nudgeClose && !mesClosed`. `git diff a8242d14~1 a8242d14` mostra 0 linhas removidas (puramente aditivo). `MercadoLivre.tsx:876-883` passa todos os novos props (`regime`, `mesClosed`, `canClose=orgRole==='owner'`, `nudgeClose`, `onClose`, `onReopen`, `closeBusy`). `canClose` é o único consumidor de `orgRole` da OrganizationContext (`orgRole: currentOrg?.role`). |
| 4b | (SC4, humano) Wesley confirma reconciliação de junho/2026 ao vivo em `/vendas` (previsão inalterada, apuração casa CMV cheio + guia ICMS de julho) | ? PENDING (human_needed) | `94-03-PLAN.md` Task 3 é `type="checkpoint:human-verify" gate="blocking"`; `94-03-SUMMARY.md` declara explicitamente "NOT YET PERFORMED" e "intentionally left pending — should be surfaced to Wesley". Não fere o código; é aprovação humana explicitamente diferida. |
| 5 | (SC5) Anti-IDOR: JWT de uma org não lê/fecha/reabre o fechamento de outra org | ✓ VERIFIED | Recorded verbatim em `94-01-SUMMARY.md`: Thales owner SELECT em rows da Pé Vermeio → 0 rows; INSERT → `ERROR 42501`; DELETE → 0 rows afetadas; Pé Vermeio owner INSERT/DELETE do próprio mês → sucesso. Trusted per task instructions (DB-only proof, aplicada pelo orquestrador via MCP). |
| 6 | (SC6) Zero regressão: Phase 88 previsão idêntica; `get_cashflow`/DFC intactos; suíte completa verde | ✓ VERIFIED | `git diff fab5b9d6~1 fab5b9d6` mostra a expressão legada `(dreWaterfall?.has_cmv ? dreWaterfall.cmv : null) ?? null` substituída por `resolveDreRegime(...)` cujo branch previsão reproduz essa EXATA expressão (confirmado por leitura direta, não só pela SUMMARY). `npx vitest run` (rodado nesta verificação) → **555/555 verde**, incluindo `dreCascade.test.ts` (junho fixture inalterado) e `dreRegime.test.ts` (18/18). `npx tsc --noEmit` → limpo. `npm run build` → build de produção limpo (23.9s). Nenhuma RPC (`get_dre_operational_by_competence`, `get_cost_waterfall`, `get_cashflow`) foi tocada em nenhum dos 3 planos (confirmado por `git show --stat` em todos os commits da fase — só arquivos TS/SQL novos/aditivos). |
| 7 | (plan 94-01 must_have) Member (non-owner) da MESMA org pode ler o close state mas NÃO pode INSERT/DELETE | ✓ VERIFIED (código) — não empiricamente re-testado ao vivo para non-owner same-org | A policy `WITH CHECK/USING public.get_org_role(auth.uid(), organization_id) = 'owner'` nas policies INSERT/DELETE (`20260694000000_dre_month_close.sql:55-62`) bloqueia estruturalmente qualquer role ≠ 'owner', incluindo member da mesma org — mesmo mecanismo já provado como `42501` no teste cross-org owner-vs-owner recorded em `94-01-SUMMARY.md`. O proof documentado testou explicitamente owner-vs-owner cross-org (SC5/anti-IDOR), não member-vs-owner same-org — a garantia intra-org não tem uma consulta live registrada, mas é o mesmo padrão RLS clonado verbatim de `ml_tax_config` (já em produção). Baixo risco; ver nota em Gaps Summary. |

**Score:** 6/7 truths verified (1 pending human verification — não conta para a pontuação, não é uma falha)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260694000000_dre_month_close.sql` | tabela `dre_month_close` + RLS org-first | ✓ VERIFIED | Existe, `create table public.dre_month_close`, 3 policies, sem UPDATE. |
| `src/lib/dreRegime.ts` | `resolveDreRegime`/`shouldNudgeClose`/`monthPlusOne` puros | ✓ VERIFIED | Todos os 4 exports presentes; sem import de React/Supabase. |
| `src/lib/dreRegime.test.ts` | never-mix + previsão byte-identical + reconciliação junho + 3-signal nudge | ✓ VERIFIED | 18 testes, todos verdes (rodado nesta verificação). |
| `src/hooks/useDreMonthClose.ts` | presence read + close()/reopen() | ✓ VERIFIED | `from("dre_month_close")` select/insert/delete; invalida query no sucesso. |
| `src/hooks/useImpostoGuiaReal.ts` | `useImpostoGuiaReal` (M+1 RPC) + `useImpostoGuiaNudge` (cash_outflows direto) | ✓ VERIFIED | Ambos exports presentes; `monthPlusOne` usado corretamente. |
| `src/hooks/useMLCostWaterfall.ts` | `cmv_cheio`/`has_cmv_cheio` aditivos | ✓ VERIFIED | Campos adicionados sem alterar guard/queryKey existentes. |
| `src/pages/MercadoLivre.tsx` | wiring `resolveDreRegime` no ponto de injeção cmvMes/impostosMes | ✓ VERIFIED | Linhas 268-320 e 857-884; `orgRole` destructurado; nenhum prop antigo removido. |
| `src/components/mercadolivre/MLCostCard.tsx` | pill + botão owner + empurrãozinho | ✓ VERIFIED | 8 novos props opcionais, todos com default seguro; diff 100% aditivo. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `dre_month_close` migration | `get_org_role`/`is_org_member` | RLS policies | ✓ WIRED | Ambas funções DEFINER já existentes em prod (confirmado em `94-CONTEXT.md <db_reality>` e usadas em `ml_claim_templates.sql`/`ml_tax_config.sql`). |
| `useImpostoGuiaReal.ts` | `get_imposto_guia_by_competence` RPC | `supabase.rpc` com `p_competence=M+1` | ✓ WIRED | `useImpostoGuiaReal.ts:59-62`. |
| `useImpostoGuiaNudge` | `cash_outflows` | leitura direta `[M, M+2)` | ✓ WIRED | `useImpostoGuiaReal.ts:96-103`, `.eq("organization_id", orgId)` — RLS org-scoped já anti-IDOR-provado para `get_cashflow`. |
| `useDreMonthClose` | `public.dre_month_close` | `supabase.from("dre_month_close")` | ✓ WIRED | select/insert/delete presentes. |
| `dreRegime.ts` | `useMLCostWaterfall` + `useImpostoGuiaReal` | `resolveDreRegime(...)` consome `cmv`/`cmv_cheio`/`total_tax`/`guiaReal` | ✓ WIRED | `MercadoLivre.tsx:279-290`. |
| `MercadoLivre.tsx` | `MLCostCard.tsx` | props `regime`/`mesClosed`/`canClose`/`nudgeClose`/`onClose`/`onReopen`/`closeBusy` | ✓ WIRED | `MercadoLivre.tsx:876-883`, único consumidor de `MLCostCard` no repo (`grep` confirma). |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `MLCostCard.regime` pill | `regimeResult.regime` | `resolveDreRegime` ← `monthClose.isClosed` ← `useDreMonthClose` query real (`dre_month_close` table) | Sim | ✓ FLOWING |
| `MLCostCard.cmvMes`/`impostosMes` | `regimeResult.cmvMes/impostosMes` | `useMLCostWaterfall` RPC `get_cost_waterfall` (live) + `useImpostoGuiaReal` RPC `get_imposto_guia_by_competence` (live) | Sim | ✓ FLOWING |
| `MLCostCard` botão + hint | `canClose`/`nudgeClose` | `orgRole` (OrganizationContext, real) / `shouldNudgeClose` ← `useImpostoGuiaNudge` (`cash_outflows` direto, real) | Sim | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Regime resolver: 18 testes puros (never-mix, byte-identical, reconciliação, nudge 3-signal) | `npx vitest run src/lib/dreRegime.test.ts` | 18/18 passed | ✓ PASS |
| Suíte completa (regressão) | `npx vitest run` | 555/555 passed | ✓ PASS |
| Tipagem | `npx tsc --noEmit` | 0 erros | ✓ PASS |
| Build de produção | `npm run build` | build limpo, 23.9s | ✓ PASS |

### Requirements Coverage

Nenhum requirement ID formal rastreado em REQUIREMENTS.md para esta fase (confirmado pela instrução da tarefa — SC1..SC6 são success criteria locais do ROADMAP.md). Cobertura avaliada acima na tabela de Observable Truths.

### Anti-Patterns Found

Nenhum bloqueador. Scan em todos os arquivos-fonte da fase (`dreRegime.ts`, `dreRegime.test.ts`, `useDreMonthClose.ts`, `useImpostoGuiaReal.ts`, `useMLCostWaterfall.ts`, `MercadoLivre.tsx`, `MLCostCard.tsx`, migration SQL) não encontrou `TODO`/`FIXME`/`XXX`/`HACK`. As únicas ocorrências de "placeholder" são termos de domínio legítimos (a linha recorrente do Tiny usada como estimativa antes da guia real chegar) — não stub de código.

### Human Verification Required

### 1. Reconciliação de junho/2026 ao vivo em `/vendas` (Task 3, 94-03-PLAN.md)

**Test:** Abrir `/vendas` como owner da Pé Vermeio, navegar o card DRE para Junho/2026, confirmar Previsão inalterada, clicar "Marcar mês como apurado", confirmar selo emerald + CMV cheio (~R$133.264,87) + imposto da guia real M+1 (ICMS de julho R$5.151,56 + PIS/COFINS, NÃO a guia de junho R$4.793,21), clicar "Reabrir mês", confirmar volta à Previsão, confirmar que non-owner não vê o botão, e que o empurrãozinho é só dica.
**Expected:** Reconciliação ao centavo em apuração; previsão idêntica ao validado 2026-07-10; gate owner funcional; nudge não dispara fechamento sozinho.
**Why human:** Dados reais de produção + interação de clique + comparação numérica visual — fora do alcance de grep/testes estáticos. Já é o checkpoint `type="checkpoint:human-verify" gate="blocking"` do próprio 94-03-PLAN.md, e o 94-03-SUMMARY.md registra explicitamente que ainda não foi executado.

### Gaps Summary

Nenhum gap bloqueador encontrado no código. Todas as peças de dados/hooks/UI/RLS previstas nos 3 planos existem, são substantivas, estão ligadas ponta-a-ponta, e a suíte de testes (555/555) + tsc + build de produção confirmam zero regressão na Phase 88/Phase 87 (`dreCascade.test.ts` inalterado). A única pendência é a aprovação humana explícita de Wesley sobre a reconciliação visual de junho/2026 em produção — isso é um checkpoint de fase deliberadamente bloqueante, não uma falha de implementação, e a própria 94-03-SUMMARY.md já sinaliza corretamente que está pendente.

Nota secundária (não bloqueante): o proof de anti-IDOR recorded em `94-01-SUMMARY.md` testa explicitamente cross-org owner-vs-owner (SC5), mas não registra uma consulta live de um member (non-owner) DENTRO da mesma org tentando INSERT/DELETE. A policy SQL (`get_org_role(...) = 'owner'`) bloqueia estruturalmente esse caso pelo mesmo mecanismo já provado (`42501`), e é o padrão idêntico já em produção via `ml_tax_config`/`ml_claim_templates` — risco residual baixo, mas fica registrado para quem quiser fechar o proof com um teste same-org member explícito.

---

_Verified: 2026-07-11T13:26:20Z_
_Verifier: Claude (gsd-verifier)_
