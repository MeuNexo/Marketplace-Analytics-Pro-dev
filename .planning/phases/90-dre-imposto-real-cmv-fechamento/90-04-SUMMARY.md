---
phase: 90-dre-imposto-real-cmv-fechamento
plan: 04
subsystem: dre
tags: [react, typescript, vitest, dre, imposto, cmv, ui]

# Dependency graph
requires:
  - phase: 90-01
    provides: "RPC get_imposto_guia_by_competence(p_org_id, p_competence) em prod"
  - phase: 90-02
    provides: "get_cost_waterfall.cmv_cheio (custo cheio com fallback custo médio)"
  - phase: 90-03
    provides: "evaluateGuiaReal, resolveTaxAndCmv (funções puras), useImpostoGuia (hook), useMLCostWaterfall com cmv_cheio/has_cmv_cheio"
provides:
  - "MercadoLivre.tsx calcula a competência da guia = billingMonth + 1 mês e consome useImpostoGuia"
  - "cmvMes/impostosMes do card DRE derivam de resolveTaxAndCmv (zero-regressão no mês aberto)"
  - "MLCostCard exibe selo 'imposto real (guia)' vs 'estimado (provisão)' com Popover explicativo"
  - "MLCostCard exibe nota de base do CMV ('custo cheio' / 'custo médio (sem preço cheio)')"
  - "Fixture de regressão: reconciliação abril/2026 (guia maio real 16.015,06 + cmv cheio 168.486,68)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Régua S+1 calculada com Date.UTC(y, m, 1) onde m já é 1-based — mesmo idioma de shiftDreMonth, documentado inline por ser fonte comum de erro"
    - "Fixture de reconciliação como teste vitest permanente (não script descartável) — prova regressão contra números de prod documentados no commit"

key-files:
  created: []
  modified:
    - src/pages/MercadoLivre.tsx
    - src/components/mercadolivre/MLCostCard.tsx
    - src/lib/dreOperational.test.ts

key-decisions:
  - "guiaCompetenceFrom calculado com useMemo dependente só de billingMonth, hook useImpostoGuia consumido com default seguro { hasGuiaReal: false, totalReal: 0 } enquanto carrega — nunca deixa cmvMes/impostosMes indefinidos durante loading"
  - "Reconciliação abril documentada como teste vitest permanente em dreOperational.test.ts (não script ad-hoc) — regressão fica protegida no CI"
  - "Resultado parcial da reconciliação (receita − cmv_cheio − imposto real = R$124.974,17) é PARCIAL por design — não inclui tarifas ML/ads/blocos operacionais, que são ortogonais ao escopo desta fase (imposto+CMV apenas)"

patterns-established:
  - "Selo de fonte (real/provisão) reusa exatamente as classes emerald/amber e o padrão Popover+HelpCircle já validados na Phase 88 — sem cores novas"

requirements-completed: [SC1, SC2, SC3, SC5, SC6]

# Metrics
duration: 35min
completed: 2026-07-07
status: complete
---

# Phase 90 Plan 04: Wiring do cérebro provisão/real + selo na UI Summary

**MercadoLivre.tsx agora calcula a competência da guia (S+1) e resolve imposto/CMV via `resolveTaxAndCmv`; MLCostCard exibe selo "imposto real (guia)" vs "estimado (provisão)" e nota de base do CMV — zero-regressão no mês aberto provada por teste, abril/2026 reconciliado como mês fechado (R$124.974,17 parcial, antes de tarifas/ads)**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2/2 auto completos + Task 3 (checkpoint) com automação executada e checkpoint visual delegado ao Wesley
- **Files modified:** 3

## Accomplishments
- `MercadoLivre.tsx` calcula `guiaCompetenceFrom` (billingMonth + 1 mês, `Date.UTC(y, m, 1)`) e chama `useImpostoGuia(guiaCompetenceFrom)` com default seguro
- `cmvMes`/`impostosMes` (antes atribuições diretas de `dreWaterfall`) agora vêm de `resolveTaxAndCmv(...)`, que decide provisão×real e cheio×médio; `impostoFonte`/`cmvFonte` passados ao `MLCostCard`
- `MLCostCard` ganhou props opcionais `impostoFonte`/`cmvFonte` (defaults `"provisao"`/`"medio"`, não quebram chamadas existentes), um pill 2-estados + Popover explicativo na linha "Impostos próprios", e uma nota discreta ("custo cheio" / "custo médio (sem preço cheio)") na linha "CMV do mês"
- Fixture de regressão em `dreOperational.test.ts`: prova que abril/2026 (mês fechado, guia competência maio) seleciona `impostoFonte="real"` (R$16.015,06) + `cmvFonte="cheio"` (R$168.486,68), e computa o resultado parcial (receita − cmv_cheio − imposto real = **R$124.974,17**) — usando os números de prod confirmados nos Plans 90-01/90-02
- tsc limpo, vitest 440/440 (30 arquivos, +1 teste novo), `npm run build` ok

## Task Commits

1. **Task 1: Composição real/provisão + competência S+1 em MercadoLivre.tsx** - `35ed7718` (feat)
2. **Task 2: Selo imposto real/provisão + nota de base do CMV no MLCostCard** - `878f8e18` (feat)
3. **Task 3 (parte automatizada): fixture de reconciliação abril/2026** - `864d5072` (test)

_Task 3 é `type="checkpoint:human-verify"` com `gate="blocking"` — a parte automatizável (tsc/vitest/build + prova programática da reconciliação) foi executada e commitada; a validação VISUAL em `/vendas` fica PENDENTE-WESLEY (ver seção abaixo), conforme autorização explícita do Wesley de validar só no final._

## Files Created/Modified
- `src/pages/MercadoLivre.tsx` — `guiaCompetenceFrom` (useMemo) + `useImpostoGuia` + substituição de `cmvMes`/`impostosMes` por `resolveTaxAndCmv`; `impostoFonte`/`cmvFonte` passados ao `MLCostCard`
- `src/components/mercadolivre/MLCostCard.tsx` — props `impostoFonte?`/`cmvFonte?` (defaults seguros); pill emerald/amber + Popover na linha de Impostos próprios; nota discreta na linha de CMV
- `src/lib/dreOperational.test.ts` — novo `describe("Reconciliação ABRIL/2026 ...")` com fixture de regressão dos números de prod

## Reconciliação ABRIL/2026 (mês fechado, guia competência MAIO)

Números confirmados em prod (org Pé Vermeio `7f615df7`, projeto `ckcdevcxgvueywivefgx`), herdados dos Plans 90-01/90-02 e agora protegidos por teste (`src/lib/dreOperational.test.ts`):

| Item | Valor |
|---|---|
| Receita do mês (paid_revenue, abril) | R$ 309.475,91 |
| Imposto real — guia competência maio (ICMS 12.000 + PIS 716,19 + COFINS 3.298,87, todas `paid`) | R$ 16.015,06 |
| CMV cheio (abril, `cmv_cheio` do waterfall) | R$ 168.486,68 |
| **Resultado parcial** (receita − cmv_cheio − imposto real) | **R$ 124.974,17** |

`impostoFonte` resolvido = `"real"`; `cmvFonte` resolvido = `"cheio"` — confirma que abril, ao navegar o card DRE, deve exibir o selo "imposto real (guia)" (emerald) e a nota "custo cheio" na linha de CMV.

**Este resultado é PARCIAL por design** — não inclui tarifas ML (comissão/frete), ads, nem os blocos operacionais (Pessoal/Estrutura/Serviços/Outros/Financeiro da Phase 88), que são compostos client-side em `MercadoLivre.tsx`/`MLCostCard.tsx` a partir de outras fontes (`gruposTarifasEfetivos`, `adsSpendMes`, `dreOperational`) e não fazem parte do escopo desta fase (que troca apenas a base de imposto+CMV). O executor não tinha acesso a uma sessão MCP Supabase neste ambiente para extrair `total_comissao`/`total_frete`/ads de abril ao vivo — a prova ficou no par (imposto, CMV) que é exatamente o que este plano decide, e a comparação final do **lucro completo do mês** contra a planilha do Wesley é o item da validação visual abaixo.

Zero-regressão do mês aberto também confirmada por teste: quando `guia.hasGuiaReal === false` (ex.: maio → guia competência junho é `paid` mas placeholder PIS/COFINS=0,01, portanto reprovada por `evaluateGuiaReal`; junho → guia competência julho é `pending`), `resolveTaxAndCmv` reproduz **byte a byte** as expressões legadas `(has_tax_data ? total_tax : null)` / `(has_cmv ? cmv : null)` — teste "ZERO-REGRESSÃO" (herdado do Plan 90-03, ainda verde).

## Decisions Made
- `guiaCompetenceFrom` isolado num `useMemo` dependente só de `billingMonth`, espelhando o padrão existente de `billingMonthFrom` — evita recomputar a cada render
- `useImpostoGuia` consumido com fallback `{ hasGuiaReal: false, totalReal: 0 }` enquanto a query carrega, garantindo que o card nunca renderize com imposto/CMV indefinidos durante a navegação de mês
- A fixture de reconciliação de abril foi implementada como teste vitest permanente (não script descartável), documentando os números de prod diretamente no arquivo de testes para proteção contra regressão futura
- Nenhuma mudança na fonte de tarifas (`dreFonte`) nem no cálculo de `lucro`/`resultadoLiquido` em `MLCostCard` — só o par (impostosMes, cmvMes) e seus selos de fonte mudaram

## Deviations from Plan

### Auto-fixed Issues

Nenhum ajuste de Rule 1-4 foi necessário no código de produção. Um ajuste técnico no teste, documentado por transparência:

**1. [Rule 1 - Bug] Precisão de ponto flutuante em `toEqual`/`toBe` na fixture de reconciliação**
- **Found during:** Task 3 (verificação da fixture de reconciliação)
- **Issue:** `12000 + 716.19 + 3298.87` em JS não soma exatamente `16015.06` (dá `16015.060000000001`), quebrando `toEqual`/`toBe` no teste novo
- **Fix:** trocado `toEqual`/`toBe` por `toBeCloseTo(..., 2)` nas asserções de `totalReal`/`impostosMes` da fixture
- **Files modified:** `src/lib/dreOperational.test.ts`
- **Commit:** `864d5072`

---

**Total deviations:** 1 auto-fix (Rule 1, cosmético — precisão de ponto flutuante em teste).
**Impact on plan:** Nenhum impacto em correção de produção; apenas ajuste de asserção de teste.

## Issues Encountered
- O ambiente deste executor não teve acesso a uma sessão MCP Supabase ativa para consultar `total_comissao`/`total_frete`/ads de abril ao vivo (necessários para o **lucro completo** do mês, além do par imposto+CMV). A reconciliação automática ficou limitada ao par (imposto real, CMV cheio) que é o entregável desta fase — o fechamento do **lucro total** de abril contra a planilha do Wesley faz parte da validação visual pendente abaixo.

## User Setup Required
None — nenhuma configuração externa necessária.

## PENDENTE-WESLEY: validação visual

Checkpoint bloqueante (`checkpoint:human-verify`, `gate="blocking"`) — a parte automatizável foi executada (tsc + vitest + build + prova programática da reconciliação abril). Falta a validação visual do Wesley em `/vendas`, light+dark+mobile:

1. **Navegar até Abril/2026** no card DRE (‹ ›): confirmar selo **"imposto real (guia)"** (emerald) na linha "Impostos próprios" (valor ≈ R$ 16.015,06) e nota **"custo cheio"** na linha "CMV do mês" (valor ≈ R$ 168.486,68). Conferir se o **Lucro do mês** exibido aproxima a DRE da planilha dele (bem melhor que a estimativa antiga de ~20%, que inflava o imposto).
2. **Navegar até o mês corrente (aberto)**: confirmar selo **"estimado (provisão)"** (amber) e nenhuma nota na linha de CMV (comportamento idêntico ao pré-fase — zero regressão visual).
3. **Navegar até Junho/2026**: confirmar que permanece **"estimado (provisão)"** (a guia de competência julho ainda é previsão/pending — não deve virar "fechado").
4. Testar em **light e dark**, e no **mobile** (Phase 78) — confirmar que o pill e o Popover (ícone "?") não quebram o layout nem ficam ilegíveis.

## Next Phase Readiness
- Milestone "DRE de Resultado" tecnicamente completo do lado do código: imposto real + CMV cheio já fluem ponta a ponta (RPC → hooks → funções puras → página → card) com zero-regressão provada.
- Bloqueio remanescente: aprovação visual do Wesley (item acima) antes de considerar a Phase 90 fechada e liberar o merge conjunto com a Phase 88 (per `90-CONTEXT.md`: "Bloqueia o merge da Phase 88 — devem ir juntas para prod").
- Nenhum bloqueio técnico conhecido.

## Self-Check: PASSED

- FOUND: `/root/garment-glow-dre/src/pages/MercadoLivre.tsx` (guiaCompetenceFrom + useImpostoGuia + resolveTaxAndCmv)
- FOUND: `/root/garment-glow-dre/src/components/mercadolivre/MLCostCard.tsx` (impostoFonte/cmvFonte + selo + nota)
- FOUND: `/root/garment-glow-dre/src/lib/dreOperational.test.ts` (fixture reconciliação abril)
- FOUND commit `35ed7718` (Task 1)
- FOUND commit `878f8e18` (Task 2)
- FOUND commit `864d5072` (Task 3 — fixture automática)
- tsc --noEmit: exit 0
- vitest completo: 30 arquivos, 440 testes, 0 falhas
- npm run build: sucesso (20.58s)

---
*Phase: 90-dre-imposto-real-cmv-fechamento*
*Completed: 2026-07-07*
