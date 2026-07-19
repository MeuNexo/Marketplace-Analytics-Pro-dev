---
phase: 96-dre-correcoes-linha-a-linha
plan: 01
subsystem: finance-dre
tags: [dre, billing, hook, tdd, pure-function, useMLBilling]

# Dependency graph
requires: []
provides:
  - "groupBillingCharges com blacklist do parcelamento (CFONPN+BFONPN) fora de totalTarifas"
  - "BillingGroup.excluded — flag para linhas informativas que não entram no total"
  - "useMLBillingDaily filtrando por competence_date em vez de charge_date"
  - "Primeiro arquivo de teste de useMLBilling.ts (não existia)"
affects: [96-05, 96-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Grupo de billing com excluded:true — mantém a linha na tela (auditoria) mas fora do total, em vez de dropar"
    - "Set de módulo com pares cobrança+estorno checado ANTES do fallback de prefixo, evitando armadilha de matching genérico"

key-files:
  created:
    - src/hooks/useMLBilling.test.ts
  modified:
    - src/hooks/useMLBilling.ts

key-decisions:
  - "Parcelamento (CFONPN+BFONPN) não é dropado de `groups` — vira linha excluded:true, preservando transparência/auditoria para a tela (implementação visual é do plano 96-05)"
  - "coverageTo continua derivado de charge_date (indicador de sync), não de competence_date — são dois conceitos diferentes"
  - "queryKey de useMLBillingDaily bumpada para billing-daily-v2 para evitar servir cache com a semântica antiga"

patterns-established:
  - "Pattern: blacklist de charge_type par (cobrança+estorno) checado antes de qualquer fallback de prefixo genérico"

requirements-completed: ["C2/C5", "C4"]

# Metrics
duration: 20min
completed: 2026-07-15
status: complete
---

# Phase 96 Plan 01: Blacklist do Parcelamento + Billing por Competência Summary

**`groupBillingCharges` remove CFONPN+BFONPN (parcelamento) de `totalTarifas` via flag `excluded`, corrigindo a armadilha onde `BFONPN` era engolido por "Cancelamentos" pelo prefixo "B"; `useMLBillingDaily` passa a filtrar `ml_billing_daily` por `competence_date` em vez de `charge_date`.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-07-15T22:12:00Z
- **Completed:** 2026-07-15T22:20:00Z
- **Tasks:** 2/2 completed
- **Files modified:** 2 (1 criado, 1 modificado)

## Accomplishments
- Fixture reconciliada de maio prova o SC2: 74.704,19 bruto por competência → `totalTarifas === 63.878,37` após excluir o parcelamento líquido (10.825,82 = CFONPN 12.187,14 + BFONPN −1.361,32).
- Armadilha do prefixo "B" corrigida: `BFONPN` (estorno do parcelamento) agora soma no grupo `parcelamento`, não mais em "Cancelamentos de tarifas" — testado explicitamente (Test 1, RED confirmado antes do fix).
- `groups` continua devolvendo TODAS as linhas (incluindo parcelamento com `excluded: true`) — nenhum charge_type dropado, mantendo a tela auditável.
- Não-regressão provada: demais `B*` (BVVML, BFFE) continuam em "Cancelamentos" e dentro do total; `CESM`/`CDSDB` continuam no bucket `afiliados_outras` e dentro do total.
- `useMLBillingDaily` lê `competence_date` no filtro de range (custo cai no mês da venda, não da cobrança) mantendo `coverageTo` pela `charge_date` de sync.

## Task Commits

Each task was committed atomically:

1. **Task 1: [C2/C5] Blacklist do parcelamento em groupBillingCharges (TDD)**
   - `e836d797` (test) — RED: 6 fixtures, 4 falharam como esperado (Test 1/2/3/4), 2 já passavam (Test 5/6, não-regressão)
   - `c4a730d8` (feat) — GREEN: `PARCELAMENTO_TYPES` checado antes do fallback `startsWith("B")`, `BillingGroup.excluded`, `totalTarifas` filtra grupos excluídos
2. **Task 2: [C4] useMLBillingDaily filtra por competence_date**
   - `451e53f2` (feat) — `.gte`/`.lte` trocam de `charge_date` para `competence_date`; `.select` traz as duas colunas; `coverageTo` mantém `charge_date`; queryKey bumpada para `billing-daily-v2`

**Plan metadata:** (commit a seguir, docs)

_Nota: Task 1 seguiu RED→GREEN completo (TDD). Task 2 não é TDD (tipo `auto` simples) — mudança direta de coluna verificada por `tsc` + suíte completa._

## Files Created/Modified
- `src/hooks/useMLBilling.test.ts` (novo) — 6 testes de `groupBillingCharges`: armadilha do BFONPN, flag `excluded`, exclusão do total, fixture de maio (prova do SC2), não-regressão de B* diversos e de CESM/CDSDB.
- `src/hooks/useMLBilling.ts` — `BillingGroup.excluded?: boolean`; `PARCELAMENTO_KEY`/`PARCELAMENTO_TYPES` (Set de módulo com CFONPN+BFONPN); loop de `groupBillingCharges` checa o Set ANTES do fallback de prefixo "B"; `totalTarifas` filtra `excluded` antes do reduce; comentário de bloco atualizado. `useMLBillingDaily`: filtro de range trocado para `competence_date`, `.select` ganha a coluna, `coverageTo` mantém `charge_date`, queryKey vira `billing-daily-v2`.

## Decisions Made
- Manter os grupos excluídos na lista `groups` (não dropar) — decisão já vinha do plano (linha informativa para a tela), reforça a rastreabilidade da fatura ML sem re-somar no total.
- `coverageTo` deliberadamente NÃO segue `competence_date` — é indicador de "até quando sincronizamos" (progresso do sync), semântica distinta de "em que mês a venda que gerou o custo caiu" (competência).

## Deviations from Plan

None - plano executado exatamente como escrito. Duas observações operacionais (não são desvios de implementação):

1. **Ambiente compartilhado (não-worktree):** o repositório não está isolado por worktree — outros planos da mesma fase (96-02, 96-04) executaram em paralelo no mesmo diretório de trabalho, com arquivos próprios staged/modificados simultaneamente (`dreRegime.ts`, `useImpostoGuiaReal.ts`, uma migration). Todos os commits deste plano foram feitos com `git add <arquivo específico>` e o commit da Task 2 usou pathspec explícito (`git commit -m "..." -- src/hooks/useMLBilling.ts`) para garantir que nenhum arquivo de outro plano staged concorrentemente fosse incluído. Confirmado via `git show --stat` em cada commit: só `useMLBilling.ts`/`useMLBilling.test.ts` aparecem.
2. A suíte completa (`npx vitest run`) mostrou 1 falha pré-existente e fora de escopo (`dreCloseGate.test.ts`, do plano 96-02 em fase RED) na primeira execução — não relacionada a este plano, não tocada. Ao final, o 96-02 concluiu seu GREEN e a suíte ficou 575/575 verde.

## Issues Encountered
None.

## User Setup Required

None - nenhuma configuração de serviço externo necessária. `ml_billing_daily.competence_date` já existe e está populada em prod (drift confirmado no RESEARCH, adendo do orquestrador) — sem DDL necessário.

## Next Phase Readiness
- `BillingGroup.excluded` está pronto para o plano 96-05 renderizar a linha "Taxas de parcelamento" como informativa (sem `(−)`, estilo diferenciado) sem precisar re-derivar a lógica de exclusão.
- `MercadoLivre.tsx:337-352` (fallback estimado com objeto `parcelamento` montado à mão) não foi tocado — compatível por `excluded` ser opcional; o plano 96-05 deve adicionar `excluded: false` explícito lá se quiser tipagem estrita.
- `totalTarifasEfetivo` em `MercadoLivre.tsx:354-357` continua re-somando o array de grupos por conta própria, ignorando `totalTarifas` do hook — unificação é escopo do 96-05, não deste plano.
- Nenhum bloqueio conhecido para os próximos planos da fase.

---
*Phase: 96-dre-correcoes-linha-a-linha*
*Completed: 2026-07-15*

## Self-Check: PASSED

- FOUND: src/hooks/useMLBilling.test.ts
- FOUND: src/hooks/useMLBilling.ts
- FOUND: .planning/phases/96-dre-corre-es-da-revis-o-linha-a-linha-c1-c9-c11-fechar-a-dre/96-01-SUMMARY.md
- FOUND: e836d797 (test — RED)
- FOUND: c4a730d8 (feat — GREEN)
- FOUND: 451e53f2 (feat — Task 2)
