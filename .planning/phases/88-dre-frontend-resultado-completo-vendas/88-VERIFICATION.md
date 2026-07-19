---
phase: 88-dre-frontend-resultado-completo-vendas
verified: 2026-07-10T14:25:00Z
status: human_needed
score: 8/8 must-haves de código verificados (2 itens visuais/prod aguardam Wesley)
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Abrir /vendas em light + dark, no mês de junho/2026, e conferir a cascata completa do card 'DRE do Mês' até o Resultado líquido (Margem de contribuição → Pessoal/Estrutura/Serviços/Operacional/Não classificado → Resultado operacional → Financeiro (Empréstimo) → Resultado líquido)."
    expected: "Legível em light e dark, responsiva no mobile (padrão Phase 78); hierarquia visual dos três subtotais; sinal verde/vermelho no líquido; tooltip discreto na linha Operacional (double_count_risk)."
    why_human: "Aparência visual, contraste light/dark e layout mobile não são verificáveis por grep — validação visual em produção (ROADMAP SC-3/SC-4)."
  - test: "Conferir se os números da cascata em /vendas para junho/2026 batem com a reconciliação provada no backend da Phase 87 (delta R$0,00)."
    expected: "Deduções operacionais e financeiro exibidos no card coincidem com get_dre_operational_by_competence para o mesmo mês; impostos_venda/excluido não aparecem."
    why_human: "A matemática da cascata está provada por fixture unitária, mas a reconciliação com dados reais de produção exige a validação ao vivo do Wesley (ROADMAP SC-4)."
---

# Phase 88: DRE — Frontend Resultado Completo (/vendas) — Relatório de Verificação

**Phase Goal:** A DRE do mês em `/vendas` passa a mostrar o resultado real completo (margem de contribuição → resultado operacional → resultado líquido), consumindo a RPC da Phase 87.
**Verified:** 2026-07-10T14:25:00Z
**Status:** human_needed
**Re-verification:** Não — verificação inicial

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
| -- | ----- | ------ | -------- |
| 1  | Card 'DRE do Mês' mostra a cascata completa (Margem → Resultado operacional → Resultado líquido) | ✓ VERIFIED | `MercadoLivre.tsx` L309-312 monta `buildDreCascade`; passa 4 props ao `<MLCostCard>` L813-816; `MLCostCard.tsx` L275-407 renderiza na ordem travada |
| 2  | 'Lucro do mês' renomeado para 'Margem de contribuição' (mesmo cálculo) | ✓ VERIFIED | `MLCostCard.tsx` L283 label novo; usa `lucro`/`margemPct` inalterados (L293/L285); nenhum resquício de "Lucro do mês" em código (só um comentário órfão em `mco.ts`, arquivo não tocado) |
| 3  | Cada bloco operacional (Pessoal/Estrutura/Serviços/Operacional/Não classificado) é linha própria visível | ✓ VERIFIED | `dreCascade.ts` L114-122 emite 1 linha por bloco com dados na ordem fixa; `MLCostCard.tsx` L301-333 `.map`; teste Test 4 prova nao_classificado como linha própria |
| 4  | Bloco 'financeiro' (Empréstimo) desce depois do Resultado operacional até o líquido | ✓ VERIFIED | `MLCostCard.tsx` ordem: subtotal operacional L335-353 → linha Financeiro L355-385 → Resultado líquido L387-407; `dreCascade.ts` L129-139 |
| 5  | Resultado líquido com sinal semântico verde/vermelho (TrendingUp/Down) | ✓ VERIFIED | `MLCostCard.tsx` L390-394 TrendingUp/Down; L400-403 `text-kpi-positive/negative` baseado em `liquidoPositivo` |
| 6  | Linha com double_count_risk exibe tooltip discreto (não escondida, não netada) | ✓ VERIFIED | `dreCascade.ts` L120 propaga `doubleCountRisk` por bloco; `MLCostCard.tsx` L309-322 HelpCircle+Tooltip condicional; Test 3 prova propagação |
| 7  | impostos_venda e excluido NUNCA renderizados nem somados (guardrail SC-3) | ✓ VERIFIED | `dreCascade.ts` L109-112 filtra ANTES de qualquer soma; Test 1 e Test 5 (fixture jun/2026) provam exclusão de todos os subtotais |
| 8  | Números batem com a reconciliação de junho/2026 (Phase 87) | ✓ VERIFIED (lógica) / ⏳ prod = humano | Test 5 fixture: deduções 53.030, financeiro 20.027, impostos_venda 4.793 e excluido 139.968 fora — verde. Reconciliação com dado real de prod → validação do Wesley |

**Score:** 8/8 truths de código verificados. Alinhamento por competência (ROADMAP SC-2): ✓ VERIFIED — `useDreOperational` recebe o MESMO ternário de mês do `useMLCostWaterfall` (`MercadoLivre.tsx` L237-239 vs L230-231). Consistência visual light/dark + mobile (ROADMAP SC-3) e validação em prod (SC-4): itens de verificação humana.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/lib/dreCascade.ts` | Helper puro, exporta `buildDreCascade`/`OPERACIONAL_BLOCOS`, filtra impostos_venda/excluido, consome `bloco` direto | ✓ VERIFIED | 149 linhas; sem React/Supabase; guardrail L109-112; consome `r.bloco` direto (nunca re-deriva de category); math dos 3 subtotais correta |
| `src/lib/dreCascade.test.ts` | 5+ casos incl. guardrail e fixture jun/2026 | ✓ VERIFIED | 6 testes, todos verdes; fixture junho/2026 (Test 5) com deduções 53.030 + financeiro 20.027 |
| `src/hooks/useDreOperational.ts` | Hook RPC 87 org-scoped, enabled guard, p_month YYYY-MM-01 documentado | ✓ VERIFIED | `supabase.rpc("get_dre_operational_by_competence", {p_org_id, p_month})` L39-42; `enabled: !!orgId && !!pMonth` L34; JSDoc p_month=YYYY-MM-01 L24-26 |
| `src/hooks/useDreOperational.test.ts` | Mock de supabase.rpc | ✓ VERIFIED | 5 testes; mock `rpc: vi.fn()` (não from/select); args exatos, error path, disabled sem org/mês |
| `src/components/mercadolivre/MLCostCard.tsx` | Card estendido com props da cascata + linhas/subtotais | ✓ VERIFIED | Props L55-62; render L275-409; degradação graciosa via `temCascata` L99/L298 |
| `src/pages/MercadoLivre.tsx` | Wiring do hook no eixo do waterfall + props ao card | ✓ VERIFIED | imports L53-54; hook L237-239; `margemContribuicao` L305-308; `dreCascade` L309-312; props L813-816 |

### Key Link Verification

| From | To | Via | Status |
| ---- | -- | --- | ------ |
| `MercadoLivre.tsx` | `useDreOperational.ts` | `useDreOperational(billingMonthIsCurrentMonth ? monthlyFrom : billingMonthFrom)` — mesmo eixo do waterfall | ✓ WIRED (L237-239) |
| `useDreOperational.ts` | RPC `get_dre_operational_by_competence` | `supabase.rpc` com p_org_id=currentOrg.id, p_month | ✓ WIRED (L39-42) |
| `MercadoLivre.tsx` | `dreCascade.ts` | `buildDreCascade(dreOperationalRows ?? [], margemContribuicao)` | ✓ WIRED (L310) |
| `MercadoLivre.tsx` | `MLCostCard.tsx` | props blocosOperacionais + resultadoOperacional + financeiro + resultadoLiquido | ✓ WIRED (L813-816) |

### Behavioral Spot-Checks / Gates

| Gate | Comando | Resultado | Status |
| ---- | ------- | --------- | ------ |
| Typecheck | `npx tsc --noEmit` | exit 0, sem erros | ✓ PASS |
| Testes | `npx vitest run` | 537/537 verde (39 arquivos); dreCascade 6, useDreOperational 5 | ✓ PASS |
| Build | `npx vite build` | ✓ built in 20.17s | ✓ PASS |

### Anti-Patterns Found

Nenhum nos arquivos da phase. Sem TODO/FIXME/XXX/placeholder em `dreCascade.ts`, `useDreOperational.ts`, `MLCostCard.tsx`. O único "Lucro do mês" restante é um comentário em `src/lib/mco.ts` (arquivo não modificado nesta phase) — informativo, não é gap.

### Decisão Diferida (SC-7) — confirmada, NÃO é gap

Toggle previsão×apuração NÃO implementado — correto conforme SC-7/CONTEXT (hand-off ao Wesley). Grep confirmou ausência de `apuracao`/`custo_unit_cheio`/`cmv_cheio`/`toggle previsão` nos arquivos da phase. O card mantém as fontes atuais (modo previsão).

### Human Verification Required

1. **Validação visual em /vendas (light + dark, mobile), junho/2026** — conferir a cascata completa, hierarquia dos três subtotais, sinal verde/vermelho, tooltip discreto. Motivo: aparência não verificável por grep (ROADMAP SC-3/SC-4).
2. **Reconciliação com dados reais de produção** — os números da cascata devem bater com a Phase 87 (delta R$0,00). A matemática está provada por fixture; a reconciliação com dado real é do Wesley ao vivo.

### Gaps Summary

Nenhum gap bloqueante. Todos os 8 truths de código, os 6 artefatos e os 4 key links estão verificados; tsc/vitest(537)/build verdes. O status é `human_needed` porque a validação visual (light/dark + mobile) e a reconciliação com dado real em produção são inerentemente humanas — o próprio plano e a memória do projeto registram que a validação visual/de dados em produção é feita pelo Wesley ao vivo.

---

_Verified: 2026-07-10T14:25:00Z_
_Verifier: Claude (gsd-verifier)_
