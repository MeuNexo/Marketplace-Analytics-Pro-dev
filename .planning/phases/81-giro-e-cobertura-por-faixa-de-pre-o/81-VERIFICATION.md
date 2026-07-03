---
phase: 81-giro-e-cobertura-por-faixa-de-pre-o
verified: 2026-07-02T23:50:00Z
status: human_needed
score: 6/6 truths verified (code-level); 1 blocking human checkpoint pending
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Rodar `npm run dev`, abrir /analise-precos, selecionar anúncio com vendas em vários preços no período."
    expected: "Cada barra com vendas mostra rótulo `~Xd` (vermelho quando cobertura < 7 dias; sufixo `?` + tom esmaecido quando a faixa tem < 3 dias de amostra); tooltip da faixa lista giro (X/dia), cobertura (Y dias) e estoque atual (Z und); cartão-veredito mostra a frase 'No preço atual R$X, seu estoque de N und dura ~Y dias.'; conferência manual (unidades ÷ dias-com-venda = giro; estoque ÷ giro, floor = cobertura) bate com o que a tela mostra."
    why_human: "Requer app rodando (npm run dev), dados reais de vendas/estoque e inspeção visual do gráfico (posição do rótulo, legibilidade do vermelho/esmaecido, layout light+dark) — não verificável por grep/tsc/vitest. Este é exatamente o Task 3 `checkpoint:human-verify` (gate blocking) do 81-02-PLAN.md, ainda sem 81-02-SUMMARY.md (checkpoint não resolvido)."
  - test: "Confirmar que a COR DA BARRA (verde/âmbar/vermelho) continua refletindo saúde de margem, não cobertura, em ambos os temas light e dark."
    expected: "Cor de fundo da barra inalterada em relação à Phase 80 (classificarSaude sobre mcoPctMedio); cobertura aparece só como texto (vermelho) sobreposto, nunca mudando o fill da barra."
    why_human: "Percepção visual de cor/contraste em light+dark não é verificável estaticamente; código confirma a fonte de dados (SAUDE_COLOR[f.saude] com f.saude = classificarSaude(f.mcoPctMedio), goal do rótulo de cobertura é `fill` de `<text>`, nunca do `<Cell>`), mas a validação final é visual."
---

# Phase 81: Giro e Cobertura por Faixa de Preço Verification Report

**Phase Goal:** Cada faixa de preço em `/analise-precos` (`PrecoPraticadoReport.tsx`) mostra giro (unidades/dia) e cobertura em dias do estoque atual do anúncio; zero RPC/migration/edge function nova. Apresentação: rótulo `~Xd` na barra (vermelho <7d, `?`+esmaecido em baixa confiança <3 dias), tooltip com giro/cobertura/estoque, frase de cobertura no cartão-veredito, rodapé de transparência. Cor da barra continua saúde de margem.

**Verified:** 2026-07-02
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `computePrecoFaixas` calcula giro (unidades ÷ dias-com-venda) e cobertura (estoque ÷ giro, floor) por faixa, com a precedência LOCKED (estoque null→null; estoque≤0→0; giro null/≤0→null; senão floor) | ✓ VERIFIED | `src/lib/precoFaixas.ts:64-77` (`computeGiroFaixa`, `computeCoberturaFaixa`); `src/lib/precoFaixas.ts:136-158` (loop de bucketização incrementa `b.dias` por ponto, popula `giroDia`/`coberturaDias`); testado em `src/lib/precoFaixas.test.ts:22-51,136-168` incluindo o caso do Wesley (giro 15, estoque 30 → 2 dias) |
| 2 | Faixa com < 3 dias de amostra marca `baixaConfianca=true`; ≥ 3 dias ou faixa vazia (0 dias) marca `false` | ✓ VERIFIED | `src/lib/precoFaixas.ts:158` (`b.dias > 0 && b.dias < MIN_DIAS_CONFIANCA`); testado em `precoFaixas.test.ts:170-200` (2 dias=true, 3 dias=false, faixa vazia=false) |
| 3 | Componente lê o estoque atual do anúncio selecionado (via `item_id`) e injeta em `computePrecoFaixas` | ✓ VERIFIED | `PrecoPraticadoReport.tsx:13,239` (import + chamada de `useMLInventory`); `:433-436` (`estoqueAtual` via `inventoryItems.find(i => i.id === selectedId)`); `:437-440` (injetado no `opts` de `computePrecoFaixas`); `MLInventoryContext.tsx:64` confirma `id: row.item_id` |
| 4 | Cada barra com vendas exibe rótulo `~Xd` (vermelho <7d via `COBERTURA_RISCO_DIAS`; sufixo `?` + opacidade reduzida em baixa confiança; `<1d` no piso) | ✓ VERIFIED | `PrecoPraticadoReport.tsx:190-196` (`coberturaBarraTexto`) + `:684-718` (`<LabelList>` custom content — `fill` vermelho quando `coberturaRisco`, `opacity={f.baixaConfianca ? 0.6 : 1}`) |
| 5 | Tooltip da faixa mostra giro/dia, cobertura em dias e estoque atual (+ aviso de baixa confiança) | ✓ VERIFIED | `PrecoPraticadoReport.tsx:200-234` (`FaixaTooltip`) — linhas Giro/Cobertura/Estoque atual (`:222-226`), aviso "só N dias de dados" quando `baixaConfianca` (`:227-231`) |
| 6 | Cartão-veredito ganha a frase determinística de cobertura do preço vigente | ✓ VERIFIED | `precoFaixas.ts:226-244` (`Veredicto.coberturaTexto`, 4 ramos de borda); `PrecoPraticadoReport.tsx:642-646` (renderizado abaixo das 2 frases existentes, colorido de vermelho quando `coberturaVigenteRisco`) |
| 7 | Rodapé de transparência explica giro (dias-com-venda) e estoque (saldo atual) | ✓ VERIFIED | `PrecoPraticadoReport.tsx:747-750` — texto estendido do rodapé cita exatamente essas duas fontes + o limiar de risco/confiança |
| 8 | Cor da barra continua sendo saúde de margem (não cobertura) | ✓ VERIFIED | `PrecoPraticadoReport.tsx:445-450` (`faixasChartData` calcula `saude: classificarSaude(f.mcoPctMedio)`, inalterado desde a Phase 80); `:672-680` (`<Cell fill={SAUDE_COLOR[f.saude]}>`) — o rótulo de cobertura usa `fill` só no `<text>` da LabelList (`:709`), nunca no `<Cell>` |
| 9 | Zero RPC/migration/edge function nova | ✓ VERIFIED | `git diff --name-only 2fd5facb^ 369a1889 -- supabase/` → vazio; único consumo de estoque é `useMLInventory()` (cache já existente, `ml_inventory_cache`), sem novo fetch |

**Score:** 9/9 truths verified at the code level. 0 behavior-unverified. 1 blocking human checkpoint (visual/manual-math confirmation) not yet resolved — this is exactly `81-02-PLAN.md` Task 3 (`checkpoint:human-verify`, `gate="blocking"`), and `81-02-SUMMARY.md` does not exist on disk, confirming the checkpoint has not been approved.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/precoFaixas.ts` | `MIN_DIAS_CONFIANCA`/`COBERTURA_RISCO_DIAS`, giro/cobertura fields, helpers, `estoqueAtual` in opts/result, `coberturaTexto` in veredicto | ✓ VERIFIED | All present, exported, wired into `computePrecoFaixas`/`computeVeredicto` — see lines 23-61, 64-77, 96-175, 182-245 |
| `src/lib/precoFaixas.test.ts` | Tests for day counting, giro, cobertura (4 precedence branches), confidence threshold, veredicto phrase | ✓ VERIFIED | 32 tests in file, all passing; covers exact edge cases from CONTEXT (Wesley's example, estoque 0/null, `<1d` floor, 2-vs-3-day threshold) |
| `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` | `useMLInventory` read, `estoqueAtual` injection, bar label, tooltip, veredict phrase, footer | ✓ VERIFIED | All present and wired — see diff evidence above |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `PrecoPraticadoReport.tsx` | `MLInventoryContext.tsx` | `useMLInventory().items → available_quantity` do `item_id` selecionado | ✓ WIRED | `:239` chama o hook; `:433-436` faz o lookup por `id === selectedId`; provider já ancestral da rota (`App.tsx:127`) |
| `PrecoPraticadoReport.tsx` | `precoFaixas.ts` | `computePrecoFaixas` recebe `estoqueAtual` no opts | ✓ WIRED | `:437-440`, deps `[dailyPoints, faixaMode, estoqueAtual]` |
| `precoFaixas.ts` (`computePrecoFaixas`) | `precoFaixas.ts` (`FaixaPreco`) | `giroDia`/`coberturaDias` calculados no map de cada bucket | ✓ WIRED | `:147-148,157` |
| `precoFaixas.ts` (`computeVeredicto`) | UI cartão-veredito | `veredicto.coberturaTexto` renderizado condicionalmente | ✓ WIRED | `PrecoPraticadoReport.tsx:642-646` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `estoqueAtual` (component) | `inventoryItems` | `useMLInventory()` → `ml_inventory_cache` (DB-first, real sync data) | Yes (existing production data source, no mock) | ✓ FLOWING |
| `giroDia`/`coberturaDias` (per faixa) | `dailyPoints` (from `dailyRows` RPC `orders_price_timeseries`) + `estoqueAtual` | Real order data + real inventory cache; no static/hardcoded fallback in the render path | Yes | ✓ FLOWING |
| Bar label / tooltip / veredicto phrase | `faixasChartData` / `faixasResult` / `veredicto` | Derived purely from the above via `computePrecoFaixas`/`computeVeredicto`, no hardcoded empty defaults reaching the render | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Vitest suite (full workspace, run once) | `npx vitest run` | `Test Files 24 passed (24)` / `Tests 366 passed (366)` | ✓ PASS |
| Type-check | `npx tsc --noEmit` | exit 0, no output | ✓ PASS |
| Phase 81 unit tests specifically | `npx vitest run src/lib/precoFaixas.test.ts` (subset of full run above) | `32 tests passed` | ✓ PASS |
| App running in browser at `/analise-precos` (visual rendering, colors in light/dark, manual math check) | N/A — requires `npm run dev` + browser + real seller data | Not run | ? SKIP → routed to human verification (Step 8), matches the plan's own blocking checkpoint |

### Anti-Patterns Found

None. No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers in `src/lib/precoFaixas.ts`, `src/lib/precoFaixas.test.ts`, or `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx`. No hardcoded empty-data stubs reaching the render path (`estoqueAtual` correctly resolves to `null`, not `0`, when the item is absent from the inventory cache — matches CONTEXT precedence exactly).

**Note (informational, not a gap):** `npx eslint` on the three touched files reports 22 `@typescript-eslint/no-explicit-any` errors (13 pre-existing in `PrecoPraticadoReport.tsx` + 3 pre-existing in `precoFaixas.test.ts`, confirmed by diffing against the pre-phase-81 commit `2fd5facb`; phase 81 added 1 new `any` at `PrecoPraticadoReport.tsx:686` in the `LabelList` `content` prop, consistent with the pre-existing pattern already used at lines 108/160/200 in the same file, and 6 new `any` in test mocks). Lint was not part of either plan's `<verify>` gate (only `tsc --noEmit` and `vitest run` were specified), and this matches the documented project convention ("`any` is used... for third-party data shapes... and Supabase query result mapping") — not flagged as a blocker.

### Requirements Coverage

Both plans declare `requirements: []` (phase ad-hoc, no formal REQUIREMENTS.md IDs — confirmed in ROADMAP.md: "Requirements: (phase ad-hoc — nenhum requirement ID)"). No orphaned requirements to check.

### Human Verification Required

### 1. Visual/manual-math checkpoint (Task 3 of 81-02-PLAN.md, gate: blocking)

**Test:** Run `npm run dev`, open `/analise-precos`, select an ad with sales at multiple prices in the period. For one faixa, manually compute: units ÷ days-with-sale = giro; current stock ÷ giro (floor) = cobertura. Compare against the `~Xd` bar label and the tooltip.
**Expected:** Manual math matches what's rendered; cobertura < 7 days shows in red; faixa with < 3 days shows `?` suffix + dimmed tone; veredict card shows "No preço atual R$X, seu estoque de N und dura ~Y dias." Bar color still reflects margin health (green/amber/red), not cobertura. Confirmed in both light and dark mode.
**Why human:** Requires a running app, real seller/order/inventory data, and visual inspection (color contrast, label placement, readability) that cannot be verified via grep/tsc/vitest. The plan itself scoped this as a blocking human checkpoint (`81-02-PLAN.md` Task 3) and no `81-02-SUMMARY.md` exists — confirming it has not yet been resolved.

### Gaps Summary

No code-level gaps. Every LOCKED decision from `81-CONTEXT.md` is implemented exactly as specified:
- Giro = unidades ÷ dias-com-venda (not calendar days) — ✓ (`computeGiroFaixa`, fed by the per-bucket `dias` counter incremented once per `McoSeriesPoint`, i.e. once per day-with-sale).
- Cobertura = estoque ÷ giro, floored, with exact precedence (estoque null→null; estoque≤0→0; giro null/≤0→null) — ✓ (`computeCoberturaFaixa`, tested for all 4 branches plus the Wesley example).
- `MIN_DIAS_CONFIANCA=3` / `COBERTURA_RISCO_DIAS=7` — ✓, both exported and consumed in the UI.
- Bar color unchanged (still `classificarSaude(mcoPctMedio)`) — ✓, confirmed both by direct code read and by diffing against the pre-phase-81 commit.
- Zero RPC/migration/edge function — ✓, confirmed via `git diff --name-only` against `supabase/` across all 4 phase-81 commits (empty).
- `npx tsc --noEmit` and `npx vitest run` were executed live in this verification session (not taken from SUMMARY.md claims): tsc exit 0, vitest 366/366 passing including the 32 new/extended tests in `precoFaixas.test.ts`.

The only open item is the blocking human-verify checkpoint that the plan itself designed as a required gate before closing the phase (visual rendering + manual arithmetic confirmation in the real app, light and dark mode). This is expected process, not a defect — routing to `human_needed` per the verification decision tree (a non-empty human verification section always overrides an otherwise-clean `passed`).

---

_Verified: 2026-07-02_
_Verifier: Claude (gsd-verifier)_
