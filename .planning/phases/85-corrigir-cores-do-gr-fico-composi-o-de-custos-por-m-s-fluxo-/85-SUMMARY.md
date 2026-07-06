# Phase 85 — Corrigir cores do gráfico Composição de Custos por Mês

**Status:** Implementada e verificada (aguardando ok visual + landing)
**Data:** 2026-07-06

## Problema (causa raiz)

`src/components/financial/CostCompositionChart.tsx` pintava cada categoria casando
o **rótulo literal** contra um mapa fixo `CATEGORY_COLORS`. Mas as categorias vêm
do campo livre `categoria.descricao` do Tiny (RPC `get_cost_by_month`, fallback
`"Outros"`). As chaves do mapa usavam variantes com barra (`Impostos/taxas`,
`Água/luz`, `Aluguéis/condomínio`) enquanto os dados reais usam vírgula/"e"
(`Impostos, taxas`, `Água, luz`, `Aluguéis e condomínio`), e rótulos como
`Reembolso cliente`, `Telecomunicação, internet`, `Previsões de compra` nem
existiam no mapa. Tudo que não batia caía no fallback único `#94a3b8` → ~5
categorias coloriam e **todo o resto virava um único cinza indistinto**. Além
disso, são ~13 categorias — acima do que uma paleta categórica distingue bem.

## Solução

- **Nova lib pura** `src/lib/costCompositionData.ts` (`buildCostComposition`):
  soma total por categoria, mantém as **top-6 por total desc** e **dobra a cauda
  (+ qualquer "Outros" literal) num único balde "Outros"**; pivota long→wide.
  Ordem de categorias estável = base da atribuição de cor por índice.
- **Componente reescrito**: cor **por índice** a partir de paleta categórica
  **CVD-safe validada** (skill dataviz) com steps próprios para light e dark
  (tema por classe via `next-themes` — `attribute="class"`, `enableSystem=false`).
  "Outros" = cinza neutro `#898781` no topo da pilha. Gap de superfície de 1.5px
  (`stroke=hsl(var(--card))`) entre segmentos = separação + encoding secundário.
- Categorias novas do Tiny agora recebem cor automaticamente (não dependem de
  casar rótulo).

## Paleta (validada com `scripts/validate_palette.js`)

| Slot | Light | Dark |
|---|---|---|
| 1 | `#2a78d6` | `#3987e5` |
| 2 | `#1baf7a` | `#199e70` |
| 3 | `#eda100` | `#c98500` |
| 4 | `#008300` | `#008300` |
| 5 | `#4a3aa7` | `#9085e9` |
| 6 | `#e34948` | `#e66767` |
| Outros | `#898781` | `#898781` |

Light: 6 hues ALL PASS (worst adjacent ΔE 24.2). Dark: 6 hues ALL PASS (worst
ΔE 10.3, floor band legalizado pelo gap). Outros↔red: light ΔE 21.4 / dark 11.3.

## Verificação

- `npx tsc --noEmit` → 0 erros
- `npx vitest run` → **423/423** (inclui 9 novos testes de `costCompositionData`)
- Paleta validada por script em light e dark
- Preview visual antes×depois (light+dark) gerado e enviado ao Wesley

## Arquivos

- `src/lib/costCompositionData.ts` (novo)
- `src/lib/costCompositionData.test.ts` (novo, 9 testes)
- `src/components/financial/CostCompositionChart.tsx` (reescrito)

## Pendente

- Ok visual do Wesley (`/fluxo-de-caixa`, light + dark)
- Landing: isolar em branch a partir de `main` (o branch atual carrega a Phase 84
  pausada) → PR + preview Vercel
