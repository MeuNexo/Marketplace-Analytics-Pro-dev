---
phase: 50-simulador-de-cenarios-de-caixa-e-se
plan: 02
subsystem: financial-ui
tags: [cashflow, simulador, recharts, shadcn]
requires:
  - "src/lib/cashflowSimulation.ts (SimPoint, SimVerdict — plano 50-01)"
  - "src/hooks/useCashFlowData.ts (CashFlowDataPoint)"
  - "src/lib/formatters.ts (formatCurrency)"
provides:
  - "CashFlowChart com prop opcional simulatedSeries (3ª linha tracejada azul, retrocompatível)"
  - "SimulatorVerdictCard (selo Saudável/Risco + folga/necessidade + menor saldo + data crítica)"
affects:
  - "plano 50-03 (CashFlowSimulator) monta os controles e injeta dados nestes componentes"
tech-stack:
  added: []
  patterns: ["prop opcional retrocompatível", "merge de série por fullDate", "cores via token hsl(var(--token))"]
key-files:
  created:
    - "src/components/financial/SimulatorVerdictCard.tsx"
  modified:
    - "src/components/financial/CashFlowChart.tsx"
decisions:
  - "Sem simulatedSeries, CashFlowChart reusa a referência `data` SEM cópia → render 100% idêntico (SIM-04)"
  - "strokeDasharray='2 6' na linha simulada para distinguir do âmbar projetado ('5 4')"
  - "valeDate dd/MM via split do yyyy-MM-dd (sem new Date) para evitar deslocamento de fuso"
metrics:
  duration: "~10min"
  completed: "2026-06-19"
  tasks: 2
  files: 2
---

# Phase 50 Plan 02: Componentes de apresentação do Simulador Summary

Estendi `CashFlowChart` com uma prop opcional `simulatedSeries` (3ª linha tracejada azul "Cenário simulado", `hsl(var(--kpi-neutral))`, 100% retrocompatível) e criei `SimulatorVerdictCard` (selo Saudável/Risco + frase de folga/necessidade + menor saldo e data crítica), ambos consumindo os tipos `SimPoint`/`SimVerdict` do plano 50-01.

## What Was Built

### Task 1 — CashFlowChart estendido (commit af5cd641)
- Nova prop OPCIONAL `simulatedSeries?: SimPoint[]` na interface `CashFlowChartProps`.
- **Retrocompatibilidade (SIM-04):** quando ausente/vazia, o componente reusa a própria referência `data` (sem cópia) e não renderiza nada novo → render idêntico ao uso atual da aba Caixa Real.
- Quando presente e não-vazia: merge do campo `cenario` por `fullDate` (via `Map`), gerando `ChartPoint[]`; pontos sem correspondência ficam sem o campo.
- 3ª `<Line dataKey="cenario">` com `stroke="hsl(var(--kpi-neutral))"`, `strokeDasharray="2 6"` (distinta do âmbar `5 4`), `strokeWidth={2}`, `dot={false}`, `connectNulls` — só montada quando há série simulada.
- `Legend formatter` mapeia `"cenario"` → "Cenário simulado".
- `CustomTooltip` mostra a linha "Cenário simulado" (azul) apenas quando o ponto tem `cenario`.

### Task 2 — SimulatorVerdictCard (commit cfaa6b55)
- Novo arquivo `src/components/financial/SimulatorVerdictCard.tsx`, export nomeado `SimulatorVerdictCard`, props `{ verdict: SimVerdict }`.
- Selo Saudável (`text-kpi-positive`/`bg-kpi-positive/15`, ícone `CheckCircle2`) ou Risco (`text-kpi-negative`/`bg-kpi-negative/15`, ícone `AlertTriangle`).
- Frases LOCKED do CONTEXT.md:
  - saudável: "Você ainda pode gastar até +{folgaGastoDia}/dia mantendo o caixa seguro."
  - risco: "Caixa fica abaixo da margem em {dd/MM}. Precisa de +{necessidadeReceitaDia}/dia de recebimento para equilibrar."
- Sempre exibe "Menor saldo: {formatCurrency(menorSaldo)}" e a data crítica dd/MM.
- Edge §7 (`verdict.ativa === false`): card não é escondido; mostra rótulo neutro "cenário projetado atual".
- `formatCurrency` de `@/lib/formatters` (sem `toLocaleString` inline). Data dd/MM via `split` do `yyyy-MM-dd` para evitar deslocamento de fuso de `new Date`.

## Deviations from Plan

None - plan executed exactly as written. (O tooltip da linha simulada era opcional no plano e foi incluído sem quebrar o tooltip atual.)

## Verification

- `npx tsc --noEmit` limpo após ambas as tasks (e na verificação final).
- Task 1 greps: `simulatedSeries` e `hsl(var(--kpi-neutral))` presentes em `CashFlowChart.tsx`.
- Task 2 greps: `export function SimulatorVerdictCard` e `text-kpi-(positive|negative)` presentes.
- Sem `var(` cru de cor nem hex literais novos nos arquivos alterados (regra CLAUDE.md): confirmado por grep.
- Retrocompatibilidade: a assinatura existente só ganhou prop opcional; `MLFluxoCaixa` (aba Caixa Real) chama sem a prop e o caminho de render é o mesmo array `data` original.

## Known Stubs

None. Ambos os componentes consomem dados reais via props tipadas (sem placeholders/mocks). A montagem com dados ao vivo ocorre no plano 50-03 (não escopo deste plano).

## Self-Check: PASSED

- FOUND: src/components/financial/CashFlowChart.tsx
- FOUND: src/components/financial/SimulatorVerdictCard.tsx
- FOUND commit: af5cd641 (Task 1)
- FOUND commit: cfaa6b55 (Task 2)
