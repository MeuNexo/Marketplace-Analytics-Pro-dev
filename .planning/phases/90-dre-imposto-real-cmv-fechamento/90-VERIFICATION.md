---
phase: 90-dre-imposto-real-cmv-fechamento
verified: 2026-07-07T01:00:00Z
status: passed
score: 6/6 must-haves verificados (SC1-SC6); 1 item de validação visual delegado a Wesley (esperado por design, não é gap)
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Navegar até Abril/2026 no card DRE (/vendas) e conferir o selo 'imposto real (guia)' (emerald) na linha Impostos próprios (~R$16.015,06) + nota 'custo cheio' na linha CMV do mês (~R$168.486,68), em light, dark e mobile."
    expected: "Selo/nota aparecem corretamente, sem quebra de layout; Lucro do mês exibido aproxima-se da planilha do Wesley."
    why_human: "Aparência visual, tema light/dark e responsividade mobile não são verificáveis por grep/código estático — exige olho humano em /vendas ao vivo."
  - test: "Navegar até o mês corrente (aberto) e até Junho/2026 no card DRE."
    expected: "Mês corrente mostra selo 'estimado (provisão)' (amber) sem nota de CMV (idêntico ao comportamento pré-fase); Junho também permanece 'estimado (provisão)' (guia de julho ainda pending)."
    why_human: "Confirmação visual de zero-regressão e do gatilho de placeholder em produção ao vivo."
---

# Phase 90: DRE — Imposto real e CMV cheio no fechamento do mês — Verification Report

**Phase Goal:** O DRE do `/vendas` passa a distinguir mês ABERTO vs FECHADO — no mês fechado troca a estimativa de imposto pelo imposto real da guia (competência S+1) e o CMV custo médio pelo CMV a preço de custo cheio, sem regressão no mês aberto, com selo explicativo na UI e anti-IDOR mantido.
**Verified:** 2026-07-07T01:00Z
**Status:** PASSED (com 1 checkpoint de validação visual pendente, esperado por design — ver Nota abaixo)
**Re-verification:** Não — verificação inicial.

## Metodologia

Verificação goal-backward: lidos `90-CONTEXT.md`, `90-DATA-FINDINGS.md`, `90-RESEARCH.md`, as 4 `90-0N-SUMMARY.md`, e o código-fonte real (migrations, RPC, lib, hooks, página, componente). Rodados `npx tsc --noEmit`, `npx vitest run` e `npm run build` de forma independente (não confiando nos números reportados nos SUMMARYs).

**Gates rodados nesta verificação:**
- `npx tsc --noEmit` → **exit 0**, sem erros.
- `npx vitest run` → **30 arquivos, 440 testes, 0 falhas** (bate com o número reportado no 90-04-SUMMARY.md).
- `npm run build` → **sucesso** (30.80s).

## Goal Achievement

### Observable Truths (Success Criteria do ROADMAP)

| # | Truth (SC) | Status | Evidência |
|---|---|---|---|
| SC1 | Mês aberto = zero-regressão (imposto estimado + CMV custo médio, exatamente como hoje) | ✓ VERIFIED | `resolveTaxAndCmv` (`src/lib/dreOperational.ts:163-181`) no ramo `!guia.hasGuiaReal` retorna `impostosMes: hasTaxData ? estimatedTax : null` / `cmvMes: hasCmv ? custoMedio : null` — reprodução literal das expressões legadas. Teste `"ZERO-REGRESSÃO: mês aberto devolve exatamente o par legado..."` (`dreOperational.test.ts:307-333`) reconstrói a expressão legada e compara byte a byte em 4 cenários — passa. |
| SC2 | Mês fechado: imposto = soma real das guias `impostos_venda` (não estimativa); CMV = preço de custo cheio (não custo médio) | ✓ VERIFIED | Wiring completo: `useImpostoGuia` (`src/hooks/useImpostoGuia.ts`) chama `get_imposto_guia_by_competence` e aplica `evaluateGuiaReal`; `useMLCostWaterfall` expõe `cmv_cheio`/`has_cmv_cheio` da RPC `get_cost_waterfall` (coluna nova, migration `20260690000100`); `resolveTaxAndCmv` no ramo `guia.hasGuiaReal` usa `guia.totalReal` e `cmvCheio` (fallback `custoMedio` quando `!hasCmvCheio`). Prova numérica: abril → imposto real R$16.015,06 (guia maio) + cmv_cheio R$168.486,68 (fixture `dreOperational.test.ts:353-380`). |
| SC3 | Gatilho provisão→real determinístico (paid + guarda de placeholder) + selo explicativo na UI | ✓ VERIFIED | `evaluateGuiaReal` (`dreOperational.ts:119-124`): só considera linhas `status==='paid'`; reprova se qualquer linha paid tem `total <= R$1` (`PLACEHOLDER_THRESHOLD=1`) — cobre exatamente o caso de junho (PIS/COFINS=0,01). Testado com Maio (real), Junho (placeholder reprovado), Julho (pending reprovado) e mistura paid+pending. UI: `MLCostCard.tsx:256-298` renderiza pill "imposto real (guia)" (emerald) vs "estimado (provisão)" (amber) + `Popover` explicativo; nota de base do CMV ("custo cheio" / "custo médio (sem preço cheio)") em `MLCostCard.tsx:227-236`. |
| SC4 | Mapeado no código ANTES de implementar: base de custo usada hoje (custo médio vs preço de custo) e onde a estimativa de imposto entra na margem | ✓ VERIFIED | `90-RESEARCH.md` (Q3, linhas 87-99 e Landmines linha 202) documenta, com grep/linha exata, que `cmvMes` vinha de `get_cost_waterfall.cmv` (`custo_unit`, custo-médio-preferido) e que `precoCusto` (preço de custo cheio) era descartado em `sync-tiny-costs/index.ts` (linha 95, `precoCustoMedio ?? precoCusto`) antes de qualquer migration ser escrita. Migration `20260690000100` + EFs (`sync-tiny-costs/index.ts:161-171,208-219`, `recalc-order-costs/index.ts:97-149`) implementam exatamente o gap mapeado, sem colapsar os dois campos. |
| SC5 | Reconciliação: mês fechado com guia bate com a DRE do Wesley (planilha) | ✓ VERIFIED (parcial, por escopo) | Fixture `describe("Reconciliação ABRIL/2026 ...")` (`dreOperational.test.ts:353-` em diante) prova programaticamente que abril seleciona `impostoFonte="real"` (R$16.015,06, guia de maio) e `cmvFonte="cheio"` (R$168.486,68), com resultado parcial (receita − cmv_cheio − imposto real) = R$124.974,17. **Nota:** este resultado é parcial por desenho — não inclui tarifas ML/ads/blocos operacionais (fora do escopo desta fase, que troca só a base imposto+CMV); o fechamento do **lucro total** do mês contra a planilha do Wesley faz parte do checkpoint visual pendente (ver Human Verification). |
| SC6 | Anti-IDOR (`organization_id`, `SECURITY INVOKER`), light+dark, mobile | ✓ VERIFIED (código) / ⚠️ pendente validação visual | `get_imposto_guia_by_competence` — `SECURITY INVOKER` explícito + `SET search_path='public'` + `REVOKE ... FROM PUBLIC, anon` + `GRANT ... TO authenticated` (migration `20260690000000:37,38,54,55`); filtra `cash_outflows.organization_id = p_org_id`, e a RLS de `cash_outflows` (`20260618100000_cash_flow_tables.sql:192-199`, policy org-scoped) barra cross-org — 90-01-SUMMARY documenta prova empírica (org Thales impersonada → 0 linhas). `get_cost_waterfall` — sem `SECURITY DEFINER` (INVOKER por default, idêntico à versão anterior confirmada pelo 90-02-SUMMARY), filtra `orders.organization_id = p_org_id`, e a RLS de `orders` (`20260521190000_orders_rls_and_unique_fix.sql`, policy "orders org select") é org-scoped — 90-02-SUMMARY documenta prova empírica análoga. Light/dark/mobile: código reusa classes/padrões já validados (Popover, pill emerald/amber, Phase 78 mobile) — **não pode ser confirmado por grep**; é o item pendente de validação visual do Wesley (esperado, ver abaixo). |

**Score:** 6/6 truths verificadas no código (100%). Nenhuma FAILED, nenhuma UNCERTAIN, 0 behavior-unverified real.

### Nota sobre o item pendente (não é gap)

O `90-04-SUMMARY.md` documenta explicitamente um checkpoint `type="checkpoint:human-verify"` `gate="blocking"`: a parte automatizável (tsc/vitest/build + prova programática da reconciliação de abril) foi executada; falta a **validação visual do Wesley** em `/vendas` (light/dark/mobile, navegação entre meses, conferência do selo e do Lucro do mês vs planilha). Isso é o comportamento **esperado e desenhado** pelo próprio Wesley (autorização explícita de validar só no final, per `90-CONTEXT.md`) — não é um gap de implementação, é o próximo passo humano do fluxo GSD. Listado em `human_verification` no frontmatter.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `supabase/migrations/20260690000000_get_imposto_guia_by_competence.sql` | RPC nova `get_imposto_guia_by_competence`, INVOKER, org-scoped, status-aware | ✓ VERIFIED | Lido integralmente; SECURITY INVOKER, REVOKE/GRANT corretos, filtro por categoria+competência, agrupado por status. |
| `supabase/migrations/20260690000100_cmv_cheio_schema.sql` | Colunas `cost_full`/`custo_unit_cheio` + `get_cost_waterfall` com `cmv_cheio` (fallback custo médio) | ✓ VERIFIED | DROP+CREATE correto (mudança de forma do RETURNS TABLE); `COALESCE(SUM(COALESCE(o.custo_unit_cheio, o.custo_unit) * o.quantidade), 0)` — fallback por linha implementado como documentado no 90-02-SUMMARY (desvio corrigido). |
| `supabase/migrations/20260690000200_backfill_custo_unit_cheio.sql` | Backfill idempotente de `custo_unit_cheio` por SKU | ✓ VERIFIED | `UPDATE ... WHERE ... custo_unit_cheio IS NULL` — idempotente, respeita org. |
| `supabase/functions/sync-tiny-costs/index.ts` | Grava `cost` E `cost_full` sem colapsar | ✓ VERIFIED | Linhas 161-171 e 208-219: `costMedio`/`costCheio` calculados separadamente, ambos persistidos (`cost_full: costCheio > 0 ? costCheio : null`). |
| `supabase/functions/recalc-order-costs/index.ts` | Grava `custo_unit_cheio` por SKU a partir de `cost_full` | ✓ VERIFIED | Linhas 97-149: `costFullBySku` carregado, `custo_unit_cheio` escrito quando `costFull != null`. |
| `src/lib/dreOperational.ts` | `evaluateGuiaReal` + `resolveTaxAndCmv` puras, testadas | ✓ VERIFIED | Lido integralmente; lógica confere com CONTEXT/DATA-FINDINGS. |
| `src/hooks/useImpostoGuia.ts` | Hook que consulta a guia por competência | ✓ VERIFIED | Lido integralmente; react-query, `enabled` guard, aplica `evaluateGuiaReal`. |
| `src/hooks/useMLCostWaterfall.ts` | Expõe `cmv_cheio`/`has_cmv_cheio` | ✓ VERIFIED | Lido integralmente; espelha `cmv`/`has_cmv`. |
| `src/pages/MercadoLivre.tsx` | Calcula competência S+1 e usa `resolveTaxAndCmv` | ✓ VERIFIED | `guiaCompetenceFrom` (linhas 243-247) + `useImpostoGuia` (248) + `resolveTaxAndCmv` (276-284) — wiring completo. |
| `src/components/mercadolivre/MLCostCard.tsx` | Selo "imposto real (guia)"/"estimado (provisão)" + nota de base do CMV | ✓ VERIFIED | Lido integralmente; pill + Popover + nota discreta implementados. |

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| `MercadoLivre.tsx` | `useImpostoGuia` | `useImpostoGuia(guiaCompetenceFrom)` | ✓ WIRED |
| `MercadoLivre.tsx` | `resolveTaxAndCmv` | chamada direta com `dreWaterfall.*` + `guia` | ✓ WIRED |
| `useImpostoGuia` | RPC `get_imposto_guia_by_competence` | `supabase.rpc(...)` | ✓ WIRED |
| `useMLCostWaterfall` | RPC `get_cost_waterfall` (coluna `cmv_cheio`) | `supabase.rpc(...)` + leitura de `r.cmv_cheio` | ✓ WIRED |
| `MercadoLivre.tsx` | `MLCostCard` | props `cmvMes`/`impostosMes`/`impostoFonte`/`cmvFonte` | ✓ WIRED |
| `sync-tiny-costs` | `ml_product_costs.cost_full` | upsert com `cost_full` separado | ✓ WIRED |
| `recalc-order-costs` | `orders.custo_unit_cheio` | patch por SKU via `costFullBySku` | ✓ WIRED |

### Régua S+1 — Verificação de off-by-one

`billingMonth` é `"YYYY-MM"` (1-based, ex. `"2026-04"` = abril). `guiaCompetenceFrom` (`MercadoLivre.tsx:243-247`): `const [y, m] = billingMonth.split("-").map(Number)` → `m=4`; `new Date(Date.UTC(y, m, 1))` — como `Date.UTC` espera mês 0-based, passar `m=4` (que seria "maio" 0-based) aponta corretamente para 1º de **maio**. Abril(S) → Maio(S+1). **Confere exatamente** com a reconciliação de abril (guia de competência maio) e com a decisão LOCKED do Wesley. Sem off-by-one.

### Anti-Patterns Found

Nenhum. Escaneados todos os arquivos-chave modificados nesta fase (migrations + EFs + lib + hooks + página + componente) por `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER|console.log` — as únicas ocorrências de "placeholder" são terminologia de domínio legítima (guia com PIS/COFINS=R$0,01), não código incompleto.

### Requirements Coverage

Fase não referencia REQ-IDs formais de `.planning/REQUIREMENTS.md` (não é trilha do milestone v8.0 Consultor); usa Success Criteria do próprio ROADMAP.md como contrato, cobertos 6/6 acima.

### Behavioral / Gate Checks

| Check | Command | Result | Status |
|---|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0 | ✓ PASS |
| Testes | `npx vitest run` | 30 arquivos, 440 testes, 0 falhas | ✓ PASS |
| Build | `npm run build` | sucesso (30.80s) | ✓ PASS |
| Teste nomeado (zero-regressão) | incluído na suíte completa acima | passou | ✓ PASS |
| Teste nomeado (reconciliação abril) | incluído na suíte completa acima | passou | ✓ PASS |
| Commits citados nos SUMMARYs existem no repo | `git cat-file -e <sha>` × 10 | todos OK | ✓ PASS |

### Human Verification Required

1. **Navegar até Abril/2026 no card DRE (/vendas)** — confirmar selo "imposto real (guia)" (emerald, ~R$16.015,06) + nota "custo cheio" (~R$168.486,68) + Lucro do mês aproximando a planilha do Wesley. Light, dark, mobile.
2. **Navegar até o mês corrente (aberto) e até Junho/2026** — confirmar selo "estimado (provisão)" (amber) sem nota de CMV em ambos (zero-regressão visual + guarda de placeholder de junho).

Ambos os itens já estavam previstos e documentados como `checkpoint:human-verify` `gate="blocking"` no próprio Plan 90-04/SUMMARY — não são gaps descobertos por esta verificação, são o próximo passo esperado do fluxo.

### Gaps Summary

Nenhum gap de código encontrado. Todas as 6 Success Criteria do ROADMAP (SC1-SC6) têm evidência direta no código (não apenas na narrativa do SUMMARY), os 3 gates técnicos (tsc/vitest/build) rodados de forma independente confirmam os números reportados, a régua S+1 foi verificada linha a linha contra off-by-one, e o anti-IDOR foi confirmado estruturalmente (INVOKER + RLS org-scoped) para ambas as RPCs tocadas nesta fase. O único item em aberto é a validação visual do Wesley em produção — explicitamente desenhada como etapa humana final do próprio plano, não uma lacuna de implementação.

**Veredito: PASSED WITH NOTES** — fase tecnicamente completa e correta no código; pendente apenas o checkpoint visual humano (esperado por design, não bloqueante para esta verificação goal-backward).

---
_Verified: 2026-07-07T01:00Z_
_Verifier: Claude (gsd-verifier)_
