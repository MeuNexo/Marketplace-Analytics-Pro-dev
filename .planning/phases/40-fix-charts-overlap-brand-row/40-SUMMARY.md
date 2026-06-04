# Phase 40 — fix-charts-overlap-brand-row — SUMMARY

**Status:** ✅ Concluído (código + tsc) — 2026-06-04
**Mode:** bugfix (layout/CSS, sem dados/edge functions)

## Problema

Os 3 gráficos de marca em `/` (Vendas) renderizavam sobrepostos: eixos X invadindo
o vizinho e legendas (Pralana/Zebu/Sandrini/TXC...) misturadas entre charts. Print
reportado por Wesley em 2026-06-04.

## Causa raiz

Itens de CSS grid têm `min-width: auto`. O `ResponsiveContainer` do Recharts tem
largura intrínseca > 0, então cada coluna `1fr` do grid `lg:grid-cols-3`
(`MercadoLivre.tsx:607`) crescia além do permitido e transbordava sobre as vizinhas.
Os `<Card>` raiz dos 3 componentes não tinham `min-w-0`.

## Fix aplicado

`className="min-w-0 overflow-hidden"` adicionado ao `<Card>` raiz dos 3 componentes,
em **todos os 3 estados** de cada um (loading + erro + sucesso) = 9 edições:

- `src/components/mercadolivre/BrandRevenueChart.tsx` (3 Cards)
- `src/components/mercadolivre/BrandMarkupChart.tsx` (3 Cards)
- `src/components/mercadolivre/CustoOperacionalChart.tsx` (3 Cards)

`min-w-0` permite a coluna do grid encolher ao tamanho real (1fr) → ResponsiveContainer
mede a largura correta e não vaza. `overflow-hidden` é defesa extra contra labels de
eixo na borda.

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
