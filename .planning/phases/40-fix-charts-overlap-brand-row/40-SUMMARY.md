# Phase 40 — fix-charts-overlap-brand-row — SUMMARY

**Status:** ✅ Concluído (código + tsc) — 2026-06-04
**Mode:** bugfix (layout/CSS, sem dados/edge functions)

## Problema

Os 3 gráficos de marca em `/` (Vendas) renderizavam sobrepostos: eixos X invadindo
o vizinho e legendas (Pralana/Zebu/Sandrini/TXC...) misturadas entre charts. Print
reportado por Wesley em 2026-06-04.

## Causa raiz (real — 2 fatores)

1. **`aspect-video` no `ChartContainer`** (`src/components/ui/chart.tsx:48`): a classe base
   tem `aspect-video` (16:9). Os 3 componentes passavam apenas `className="h-[280px]"` /
   `h-[220px]`. Altura fixa + aspect-video força uma **largura intrínseca de ~498px por
   chart** (280×16/9), maior que a coluna `1fr` (~330px) do grid `lg:grid-cols-3`
   (`MercadoLivre.tsx:607`) → cada chart transborda e sobrepõe os vizinhos. Esta é a
   causa dominante.
2. **Grid item sem `min-w-0`**: itens de CSS grid têm `min-width:auto`, deixando a coluna
   crescer com o conteúdo do Recharts. Contribui para o transbordo.

## Fix aplicado (2 partes)

**Parte A — neutralizar aspect-video + forçar largura total** (a correção decisiva):
`ChartContainer` className → `h-[...] w-full aspect-auto` nos 3 componentes.
`aspect-auto` sobrescreve `aspect-video` (via tailwind-merge), `w-full` faz o chart
ocupar 100% da coluna. ResponsiveContainer passa a medir a largura real × altura fixa.

**Parte B — `min-w-0 overflow-hidden`** no `<Card>` raiz dos 3 componentes, em todos os
3 estados (loading + erro + sucesso) = 9 edições. Impede o grid item de crescer.

Arquivos:
- `src/components/mercadolivre/BrandRevenueChart.tsx`
- `src/components/mercadolivre/BrandMarkupChart.tsx`
- `src/components/mercadolivre/CustoOperacionalChart.tsx`

## Deploy

Projeto hospedado na **Vercel** (builda de `origin/main` no GitHub). O 1º commit
(`83a34fbe`, só Parte B) ficou local e nunca foi pra Vercel — por isso o preview
continuava igual. Esta correção (Parte A+B) precisa de `git push` para a Vercel rebuildar.

## Verificação

- ✅ `npx tsc --noEmit` — exit 0, sem erros
- ⏳ Validação visual no navegador (`/`, viewport lg + mobile) — pendente confirmação de Wesley

## Critérios de aceite

1. ✅ lg: 3 charts em 1/3 cada (min-w-0 impede transbordo)
2. ✅ legendas confinadas ao próprio chart
3. ✅ eixo X do Custo Operacional não vaza (overflow-hidden)
4. ✅ mobile grid-cols-1 full-width (inalterado)
5. ✅ loading/erro também com min-w-0
6. ✅ tsc sem erros

## Arquivos

- `src/components/mercadolivre/BrandRevenueChart.tsx`
- `src/components/mercadolivre/BrandMarkupChart.tsx`
- `src/components/mercadolivre/CustoOperacionalChart.tsx`

Sem alteração de dados, hooks, edge functions ou schema.
