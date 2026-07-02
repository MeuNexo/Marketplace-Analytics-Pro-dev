---
phase: quick-260702-kfo
plan: 01
subsystem: frontend
tags: [ui, chart, design-tokens, analise-precos]
dependency-graph:
  requires: [KFO-CORES-01]
  provides: ["--chart-price", "--chart-breakeven", "--chart-mco tokens"]
  affects: ["src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx"]
tech-stack:
  added: []
  patterns: ["hsl(var(--token)) design tokens em :root/.dark", "Legend payload explícito Recharts", "chip de cor no tooltip via prop opcional"]
key-files:
  created: []
  modified:
    - src/index.css
    - src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx
decisions:
  - "Paleta LOCKED aplicada exatamente como especificada no plano (azul/laranja/violeta, valores light+dark)"
  - "Break-even ganhou strokeWidth 2 (era 1.5) para reforçar a distinção visual da linha tracejada"
metrics:
  duration: 5min
  completed: 2026-07-02
status: complete
---

# Quick Task 260702-kfo: Cores e legendas nítidas no gráfico de Análise de Preços Summary

Recoloriu as 3 linhas do ComposedChart de `/analise-precos` (Preço=azul, Break-even=laranja, MCO %=violeta) via novos tokens de tema `--chart-price/--chart-breakeven/--chart-mco`, expandiu a legenda de 1 item verboso para 5 itens nítidos, e adicionou chips de cor no tooltip que casam com as linhas do gráfico — zero mudança de dados ou lógica.

## O que foi feito

**Task 1 — `src/index.css`:** Adicionados 3 tokens de gráfico (paleta LOCKED, validada CVD/contraste) em `:root` e `.dark`:
- `--chart-price`: `217 70% 45%` (light) / `217 65% 54%` (dark) — azul
- `--chart-breakeven`: `21 90% 48%` (ambos os modos) — laranja
- `--chart-mco`: `262 83% 58%` (light) / `260 100% 71%` (dark) — violeta

Nenhum token pré-existente (`--accent`, `--primary`, `--muted-foreground`, `--success`, `--destructive`) foi alterado.

**Task 2 — `PrecoPraticadoReport.tsx`:**
1. As 3 `<Line>` do gráfico principal trocaram de cor: "Preço praticado" (`--accent`→`--chart-price`), "Break-even" (`--muted-foreground`→`--chart-breakeven`, `strokeWidth` 1.5→2), "MCO %" (`--primary`→`--chart-mco`).
2. `<Legend>` reescrita: o item único "Margem (verde=positiva, vermelho=negativa)" virou 4 itens dedicados (Preço praticado, Break-even, MCO %, mais as 2 bandas Margem positiva/negativa) — total 5 itens.
3. `ChartTooltip`/`Row`: nova prop opcional `dotColor` que renderiza um chip redondo (`w-2 h-2 rounded-full`) antes do rótulo. Aplicado nas linhas "Preço", "Break-even" e "MCO %"; as linhas de decomposição (Custo, Comissão, Frete, Ads, Imposto, Unidades, MCO R$/un) ficaram sem chip, como especificado.
4. `<YAxis yAxisId="mco">` (eixo direito) teve o `tick.fill` trocado para `hsl(var(--chart-mco))`; o `YAxis` esquerdo e o `XAxis` permaneceram com `--muted-foreground`.

Nada mais foi tocado: `BarTooltip`, `<Bar>`, `<Area>` das bandas de margem e o rodapé de transparência permanecem inalterados.

## Deviations from Plan

None - plan executed exatamente como escrito.

## Verification

- `grep -c` em `src/index.css`: 6 declarações dos 3 tokens (3 em `:root`, 3 em `.dark`).
- `grep -c` em `PrecoPraticadoReport.tsx`: 11 usos de `hsl(var(--chart-price|breakeven|mco))`.
- `npx vitest run`: 334/334 passed (23 arquivos de teste).
- `npm run build`: build limpo, 23.03s, sem erros de TypeScript/Vite.

## Known Stubs

None.

## Threat Flags

None — mudança puramente de apresentação (cores/legenda/tooltip), sem nova superfície de rede, auth ou schema.

## Self-Check: PASSED

- FOUND: src/index.css (tokens confirmados via grep)
- FOUND: src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx (usos confirmados via grep)
- FOUND commit 00563889 (feat: tokens de cor de gráfico)
- FOUND commit 86dd69d6 (style: recolorir linhas/legenda/tooltip)
