---
phase: quick-260702-i8u
plan: 01
subsystem: frontend/analise-precos
tags: [recharts, legend, tooltip, mco, phase-79-feedback]
requires: [phase-79]
provides:
  - "Campo qtd no McoSeriesPoint (unidades vendidas por bucket)"
  - "Linha discreta de unidades no gráfico de /analise-precos (3º eixo Y oculto)"
  - "Legend recharts com payload custom (5 itens, Areas técnicas ocultas)"
  - "Tooltip com linha 'Unidades'"
affects: []
tech-stack:
  added: []
  patterns:
    - "Legend com payload explícito para esconder séries técnicas (stacked Areas) da legenda"
    - "YAxis hide como 3º eixo de escala independente sem poluir eixos visíveis"
key-files:
  created: []
  modified:
    - src/lib/precoMcoSeries.ts
    - src/lib/precoMcoSeries.test.ts
    - src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx
decisions:
  - "Tooltip: 'Unidades' logo após o cabeçalho do bucket (antes de Preço) — leitura de volume primeiro"
  - "Espaço da legenda via altura do ResponsiveContainer 340→380 (não via margin.bottom)"
  - "Linha de unidades sem strokeDasharray para não confundir com break-even tracejado"
metrics:
  duration: ~4min
  completed: 2026-07-02
status: complete
---

# Quick 260702-i8u: Linha de unidades vendidas + legendas no gráfico Summary

Linha discreta de unidades vendidas por bucket (3º eixo Y oculto) + Legend recharts com payload custom de 5 itens + tooltip com unidades no gráfico de /analise-precos, propagando `qtd` do util `precoMcoSeries`.

## Tasks

| # | Task | Commit |
|---|------|--------|
| 1 | Propagar `qtd` do PrecoSeriesRow para o McoSeriesPoint (TDD) | 232fb9d1 (RED) + de131f92 (GREEN) |
| 2 | Linha de unidades (3º eixo oculto) + Legend filtrada + tooltip | 596fb659 |

## O que mudou

- **`src/lib/precoMcoSeries.ts`** — interface `McoSeriesPoint` ganhou `qtd: number` (unidades vendidas no bucket) logo após `bucket`; o `.map` de `computePrecoMcoSeries` propaga `qtd: r.qtd`. Nenhuma fórmula (MCO, bandas, bucketização de ads) alterada.
- **`src/lib/precoMcoSeries.test.ts`** — nova asserção `expect(p.qtd).toBe(10)` no caso base (TDD RED→GREEN).
- **`src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx`**:
  - Import de `Legend` do recharts.
  - `<YAxis yAxisId="qtd" hide />` — 3º eixo com escala própria das unidades, sem ticks (eixos R$/un e MCO % intocados).
  - `<Line yAxisId="qtd" dataKey="qtd">` discreta: muted-foreground, strokeWidth 1, opacity 0.5, sem dot, sem dash (para não confundir com break-even tracejado).
  - `<Legend>` com `payload` explícito de 5 itens: Preço praticado, Break-even, MCO %, Unidades vendidas e "Margem (verde=positiva, vermelho=negativa)". As 3 Areas técnicas do colchão (base/gainBand/lossBand) NÃO aparecem na legenda. `wrapperStyle` com fontSize 11 e wrap responsivo (paridade mobile).
  - `ResponsiveContainer` 340→380 para a legenda não sobrepor o eixo X.
  - Tooltip: linha `Unidades` (via `intFmt(d.qtd)`) logo após o cabeçalho `{d.label}`.

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- `npx vitest run` — 23 arquivos / **327 testes verdes** (inclui a nova asserção de `qtd`).
- `npm run build` — build Vite limpo, tsc sem erros (`d.qtd` tipado via `McoSeriesPoint`).
- Greps do `done`: `yAxisId="qtd"` ×2 (YAxis + Line); `<YAxis yAxisId="qtd" hide` ×1; `Legend` ×3 (import + comentário + uso); `Unidades vendidas` na Legend; `Margem (verde=positiva` ×1; `intFmt(d.qtd)` ×1; `qtd: r.qtd` ×1 no util.
- Inspeção visual (checkpoint humano do orquestrador, fora deste plano): pendente ok do Wesley.

## Known Stubs

None.

## Threat Flags

Nenhuma nova superfície — mudança puramente presencial sobre dados já autorizados via RLS (T-i8u-01 accept, conforme threat model do plano).

## Self-Check: PASSED

- src/lib/precoMcoSeries.ts — FOUND
- src/lib/precoMcoSeries.test.ts — FOUND
- src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx — FOUND
- Commits 232fb9d1, de131f92, 596fb659 — FOUND no git log
