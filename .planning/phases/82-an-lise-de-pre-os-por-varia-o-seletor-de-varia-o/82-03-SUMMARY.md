---
phase: 82-an-lise-de-pre-os-por-varia-o-seletor-de-varia-o
plan: 03
subsystem: ui
tags: [react, typescript, supabase-rpc, shadcn, mercadolivre, precificacao]

# Dependency graph
requires:
  - phase: 82-02
    provides: "RPC orders_price_timeseries com 6º arg opcional _sku (deployada em produção)"
  - phase: 81
    provides: "PrecoPraticadoReport.tsx com histograma de faixas, giro e cobertura por estoque do anúncio pai"
provides:
  - "Seletor de variação em /analise-precos (dropdown shadcn Select) com default 'Todas as variações (anúncio)'"
  - "Util puro variacoesResumo.ts: resumoVariacoes (total/esgotadas/opcoes) e estoqueDaVariacao (lookup por SKU)"
  - "Fonte de dados condicional: RPC com _sku + estoqueAtual da variação (join por seller_custom_field, nunca variation_id)"
  - "Badge 'Analisando variação: …' e aviso discreto no nível pai (N variações, M esgotadas)"
affects: [analise-precos, mercadolivre-anuncios]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Util puro testado (zero I/O) alimentando fonte de dados condicional em componente React — mesmo padrão de precoFaixas.ts/precoMcoSeries.ts"
    - "Join por SKU (seller_custom_field) em vez de variation_id — validado com dados reais na 82-02"

key-files:
  created:
    - src/lib/variacoesResumo.ts
    - src/lib/variacoesResumo.test.ts
  modified:
    - src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx

key-decisions:
  - "Select shadcn (não Popover+Command) para o dropdown de variação — mais simples para lista sem busca livre"
  - "Sentinela '__all__' como value do item padrão (Select não aceita value vazio)"
  - "Reset do selectedSku via useEffect dedicado com dep [selectedId] — evita acoplar ao effect existente que mantém selectedId válido"

requirements-completed: ["APV-UI-SELECTOR", "APV-UI-AVISO-PAI"]

# Metrics
duration: ~35min
completed: 2026-07-03
status: complete
---

# Phase 82 Plan 03: Seletor de Variação em Análise de Preços Summary

**Dropdown de variação em `/analise-precos` que filtra faixas/giro/estoque/cobertura por SKU real via RPC `_sku` + `estoqueDaVariacao`, mantendo o anúncio pai como default (Phase 81 intacta) e `precoFaixas.ts` sem nenhuma mudança de lógica.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-03T01:04:00Z
- **Tasks:** 2/2
- **Files modified:** 3 (2 criados, 1 modificado)

## Accomplishments
- Util puro `variacoesResumo.ts` com `resumoVariacoes` (total/esgotadas/opcoes ordenadas por estoque) e `estoqueDaVariacao` (lookup por `seller_custom_field`, nunca `variation_id`), com 8 testes Vitest incluindo o caso-prova real (SKU `SA025132197AABPCN420603` → estoque 19).
- Seletor de variação (`Select` shadcn) em `PrecoPraticadoReport.tsx`: aparece só quando `has_variations=true`, default "Todas as variações (anúncio)", reseta ao trocar de anúncio.
- As DUAS chamadas `supabase.rpc("orders_price_timeseries", …)` (série temporal e histograma diário) agora enviam `_sku: selectedSku` e têm `selectedSku` nas dependências do effect — refetch automático ao trocar variação.
- `estoqueAtual` passa a ser condicional: `estoqueDaVariacao(...)` quando há SKU selecionado, senão `available_quantity` do pai — esse valor flui sem mudanças para `computePrecoFaixas`, fazendo a cobertura virar a da variação.
- Badge "Analisando variação: {label}" quando uma variação está selecionada; aviso discreto no nível pai ("Anúncio com N variações (M esgotadas) — selecione uma variação para cobertura precisa") quando há variações e nenhuma selecionada.
- `precoFaixas.ts` e `precoMcoSeries.ts` confirmados sem alteração (`git diff --stat` vazio para ambos).

## Task Commits

Ambas as tasks foram commitadas atomicamente:

1. **Task 1: Util puro variacoesResumo.ts + testes** - `d755b24e` (feat)
2. **Task 2: Seletor de variação em PrecoPraticadoReport.tsx** - `55227140` (feat)

**Plan metadata:** (a ser commitado após este SUMMARY)

## Files Created/Modified
- `src/lib/variacoesResumo.ts` - util puro: `resumoVariacoes` (total/esgotadas/opcoes) e `estoqueDaVariacao` (lookup por SKU)
- `src/lib/variacoesResumo.test.ts` - 8 testes Vitest, incluindo o caso-prova SKU …420603 → estoque 19
- `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` - estado `selectedSku`, dropdown de variação (Select), `_sku` nas duas chamadas RPC, `estoqueAtual` condicional, badge, aviso do pai, reset ao trocar anúncio

## Decisions Made
- Usei `Select` (shadcn) em vez de `Popover`+`Command` para o dropdown de variação — a lista de variações não precisa de busca livre como o seletor de anúncio, então o componente mais simples é suficiente (Claude's Discretion do plano).
- Value sentinela `"__all__"` para o item padrão do `Select`, porque o componente Radix não aceita `value=""` em `SelectItem`; convertido para `null` (= pai) no `onValueChange`.
- Reset do `selectedSku` implementado como `useEffect` dedicado com dependência `[selectedId]`, separado do effect existente que mantém `selectedId` válido — evita side-effects cruzados entre os dois estados.
- Label do dropdown segue exatamente o formato do util: `{atributo} · {SKU} · {estoque} und`, com fallback "Variação" quando não há `attribute_combinations`.

## Deviations from Plan

None - plan executado exatamente como escrito.

## Issues Encountered
None.

## Verification Results (real)

- `npx tsc --noEmit` → **limpo** (sem output, exit 0).
- `npx vitest run` → **374/374 testes verdes** em 25 arquivos (incluindo os 8 novos de `variacoesResumo.test.ts` e os 32 já existentes de `precoFaixas.test.ts`, inalterados).
- `npx vite build` → **build de produção OK** (`✓ built in 20.92s`, chunk `MLAnalisePrecos-*.js` gerado normalmente).
- Grep de verificação do plano: `_sku: selectedSku` aparece 2x (as duas chamadas RPC); `estoqueDaVariacao` presente.
- `git diff --stat src/lib/precoFaixas.ts src/lib/precoMcoSeries.ts` → vazio (nenhuma das duas utils foi tocada).

## O que mudou na UI

- **Dropdown de variação:** novo `Select` ao lado do seletor de anúncio, visível só quando o anúncio tem variações (`has_variations=true`). Primeira opção fixa "Todas as variações (anúncio)"; demais opções = variações com SKU, ordenadas por estoque desc, rótulo `{atributo} · {SKU} · {estoque} und`.
- **Badge:** "Analisando variação: {label}" aparece nos controles quando uma variação está selecionada.
- **Aviso no nível pai:** linha discreta com ícone de alerta ("Anúncio com N variações (M esgotadas) — selecione uma variação para cobertura precisa") logo abaixo dos controles, só quando há variações e nenhuma selecionada.
- **Fonte de dados condicional:** sem variação selecionada, a página é idêntica à Phase 81 (série do pai, estoque do pai). Com variação selecionada, a série (histograma + evolução no tempo) filtra por `_sku` e o `estoqueAtual` injetado em `computePrecoFaixas` passa a ser o `available_quantity` da variação — cobertura, giro e faixa campeã refletem só aquele SKU.

## User Setup Required

None - nenhuma configuração de serviço externo necessária. A RPC com `_sku` já está em produção (deploy feito em 82-02).

## Checkpoint Visual

O plan 82-03 **não contém checkpoint de verificação visual** (nenhum `type="checkpoint:*"` nas tasks — confirmado via grep antes da execução). As duas tasks são `type="auto"`. A implementação está completa e verificada automaticamente (tsc + vitest + build), mas a validação visual em `/analise-precos` (dropdown, badge, aviso, comportamento ao trocar variação/anúncio) ainda não foi feita pelo Wesley — recomendado antes do merge do PR #27, seguindo o padrão das fases anteriores desta branch.

## Next Phase Readiness
- Seletor de variação funcional e testado; branch `feat/analise-precos-giro-cobertura` pronta para validação visual e posterior merge (PR #27, que também inclui a Phase 81).
- Nenhum bloqueio técnico identificado. Próximo passo é validação humana em `/analise-precos` (light+dark, mobile+desktop) antes do merge.

---
*Phase: 82-an-lise-de-pre-os-por-varia-o-seletor-de-varia-o*
*Completed: 2026-07-03*

## Self-Check: PASSED
- FOUND: src/lib/variacoesResumo.ts
- FOUND: src/lib/variacoesResumo.test.ts
- FOUND: src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx
- FOUND: .planning/phases/82-an-lise-de-pre-os-por-varia-o-seletor-de-varia-o/82-03-SUMMARY.md
- FOUND commit: d755b24e
- FOUND commit: 55227140
