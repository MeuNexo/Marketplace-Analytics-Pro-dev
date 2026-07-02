---
phase: 81-giro-e-cobertura-por-faixa-de-pre-o
plan: 01
subsystem: analise-precos
tags: [util-puro, precoFaixas, giro, cobertura, vitest]
status: complete
dependency-graph:
  requires: []
  provides:
    - "precoFaixas.MIN_DIAS_CONFIANCA"
    - "precoFaixas.COBERTURA_RISCO_DIAS"
    - "precoFaixas.computeGiroFaixa"
    - "precoFaixas.computeCoberturaFaixa"
    - "FaixaPreco.diasNaFaixa/giroDia/coberturaDias/baixaConfianca"
    - "ComputeFaixasOpts.estoqueAtual"
    - "FaixasResult.estoqueAtual"
    - "Veredicto.coberturaTexto"
  affects:
    - "src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx (consumido na Wave 2, plan 81-02)"
tech-stack:
  added: []
  patterns:
    - "Contagem de dias-com-venda no acumulador interno (Acc.dias) do loop de bucketização existente"
    - "Helpers puros exportados com precedência explícita de branches (estoque null > estoque<=0 > giro null/<=0 > floor)"
key-files:
  created: []
  modified:
    - "src/lib/precoFaixas.ts"
    - "src/lib/precoFaixas.test.ts"
decisions:
  - "Ordem de execução das tasks seguiu o plan literalmente: Task 1 estendeu o util (feat) mantendo a suíte antiga verde; Task 2 acrescentou os novos testes (test) depois — não é RED→GREEN clássico por arquivo, é a decomposição explícita do 81-01-PLAN.md."
  - "coberturaTexto usa precedência: sem faixa atual/estoque null → null; estoque<=0 → frase de estoque zerado; coberturaDias null (giro indisponível) → null; coberturaDias 0 com estoque>0 → frase 'dura menos de 1 dia'; senão frase com ~N dias."
metrics:
  duration: "~25min"
  completed: "2026-07-02"
---

# Phase 81 Plan 01: Giro e Cobertura por Faixa de Preço Summary

Estendeu o util puro `src/lib/precoFaixas.ts` para computar giro (unidades/dia sobre dias-com-venda) e cobertura em dias do estoque atual por faixa de preço, com sinalização de baixa confiança para amostras < 3 dias e frase determinística de cobertura no veredito do preço vigente — zero I/O, zero dependências novas.

## What Was Built

- **Constantes nomeadas** `MIN_DIAS_CONFIANCA = 3` (limiar de amostra fraca) e `COBERTURA_RISCO_DIAS = 7` (limiar de risco de ruptura), documentadas inline, junto das demais constantes do módulo.
- **`computeGiroFaixa(unidades, diasNaFaixa): number | null`** — `unidades / diasNaFaixa` quando há dia-com-venda; `null` caso contrário.
- **`computeCoberturaFaixa(estoqueAtual, giro): number | null`** — precedência exata: `estoqueAtual == null` → `null`; `estoqueAtual <= 0` → `0`; `giro == null || giro <= 0` → `null`; senão `Math.floor(estoqueAtual / giro)`.
- **Contagem de dias por faixa**: o acumulador interno (`Acc`) do loop de bucketização em `computePrecoFaixas` ganhou o campo `dias`, incrementado a cada `McoSeriesPoint` atribuído ao bucket (cada ponto = 1 dia-com-venda, pois a série usada é sempre granularidade "day").
- **`FaixaPreco`** ganhou 4 campos: `diasNaFaixa`, `giroDia`, `coberturaDias`, `baixaConfianca` (`true` quando `0 < diasNaFaixa < MIN_DIAS_CONFIANCA`; faixa vazia = `false`).
- **`ComputeFaixasOpts.estoqueAtual?: number | null`** — injeção do estoque (mantém o util sem I/O); **`FaixasResult.estoqueAtual: number | null`** ecoa o valor para o veredito.
- **`Veredicto.coberturaTexto: string | null`** — frase determinística (template sobre números, sem LLM) sobre o preço vigente, cobrindo as bordas: sem faixa atual / estoque `null` / `coberturaDias null` → `null`; estoque `<= 0` → "estoque está zerado"; `coberturaDias === 0` com estoque `> 0` → "dura menos de 1 dia"; senão "dura ~N dia(s)".
- `MCO`/margem/altura/`niceStep`/`weightedPercentile`/`classificarSaude` **inalterados**.

## Test Results (real, executado nesta sessão)

```
$ npx tsc --noEmit
(sem output — exit 0, build limpo)

$ npx vitest run src/lib/precoFaixas.test.ts
✓ src/lib/precoFaixas.test.ts (32 tests) 38-91ms
Test Files  1 passed (1)
     Tests  32 passed (32)

$ npx vitest run   (suíte completa do projeto)
Test Files  24 passed (24)
     Tests  366 passed (366)
```

Novos testes cobrem: contagem de dias (inclusive datas não contíguas), giro/cobertura de ponta a ponta em `computePrecoFaixas` (estoque injetado, estoque 0, estoque null/omitido, estoque menor que giro), os 4 ramos de precedência de `computeCoberturaFaixa` isolado (incluindo o caso do Wesley: giro 15/dia + estoque 30 → 2 dias), limiar de `baixaConfianca` (2 dias = true, 3 dias = false, faixa vazia = false), e os 6 cenários de `coberturaTexto` no veredito.

## Acceptance Criteria — verificação real

- `grep -c 'MIN_DIAS_CONFIANCA' src/lib/precoFaixas.ts` → 3 (>= 2 ✓)
- `grep -c 'COBERTURA_RISCO_DIAS' src/lib/precoFaixas.ts` → 1 (>= 1 ✓)
- `computeGiroFaixa` e `computeCoberturaFaixa` exportados ✓ (grep confirma ambas as assinaturas)
- 4 campos novos presentes em `FaixaPreco` ✓
- `estoqueAtual` presente em `ComputeFaixasOpts`, `FaixasResult` e corpo de `computePrecoFaixas` ✓
- `coberturaTexto` presente na interface `Veredicto` e no retorno de `computeVeredicto` ✓
- `npx tsc --noEmit` → exit 0 ✓
- `precoFaixas.test.ts`: `coberturaDias` aparece 14x (>= 3 ✓), `baixaConfianca` 4x (presente ✓), helpers testados diretamente 14x (>= 1 ✓)
- Testes pré-existentes (11 originais) continuam verdes dentro dos 32 do arquivo ✓

## Deviations from Plan

### Auto-fixed Issues

Nenhum desvio de Rule 1/2/3/4. A única decisão de execução notável (documentada em `decisions`, não é um desvio) é que a Task 1 (tdd="true") não seguiu literalmente RED→GREEN dentro de si mesma — o próprio 81-01-PLAN.md decompôs o trabalho em Task 1 = extensão do util (feat) e Task 2 = testes novos (test), nessa ordem, com o `<verify>` da Task 1 rodando apenas a suíte pré-existente (que continua verde). Segui a decomposição exatamente como escrita no plan.

Um ajuste de dado de teste foi necessário durante a Task 2: o primeiro rascunho do teste "conta dias-com-venda... calcula giroDia" usava apenas 2 pontos (preços 56 e 58), o que faz `niceStep`/percentil calcular uma largura de bucket de 1 (não 5), quebrando a asserção `r.faixas.find(x => x.min === 55)`. Corrigido adicionando um terceiro ponto (preço 62, mesmo padrão do teste original da suíte) para reproduzir a largura de bucket 5 esperada — sem alterar `precoFaixas.ts`, apenas o dado de entrada do teste. Verificado: suíte 32/32 verde após o ajuste.

### None outros

Nenhum outro desvio. Plano executado conforme escrito.

## TDD Gate Compliance

Plan `type: execute` (não `type: tdd`), Task 1 tem `tdd="true"` mas sem `<behavior>`/`<implementation>` explícitos — segui a decomposição literal do plan (feat na Task 1, test na Task 2). Sequência de commits real:

1. `a084e2f8` — `feat(81-01): giro, cobertura e confianca por faixa de preco`
2. `cee2f2a3` — `test(81-01): cobertura de testes para giro/cobertura por faixa`

Não há gate RED/GREEN formal a validar aqui (plano não é `type: tdd` no nível do arquivo); registrado apenas para transparência.

## Known Stubs

Nenhum. Util puro, sem UI, sem dado mockado — todos os campos novos são calculados a partir de `McoSeriesPoint`/`estoqueAtual` injetados.

## Threat Flags

Nenhuma superfície nova. Confirma o disposto no `<threat_model>` do plan: `computeCoberturaFaixa` tem guardas de precedência que evitam divisão por zero/Infinity (T-81-01, mitigado e testado); nenhuma dependência nova instalada (T-81-02, aceito).

## Self-Check: PASSED

- `FOUND: src/lib/precoFaixas.ts`
- `FOUND: src/lib/precoFaixas.test.ts`
- `FOUND: a084e2f8` (commit Task 1)
- `FOUND: cee2f2a3` (commit Task 2)
