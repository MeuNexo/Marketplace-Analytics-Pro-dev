## Refinamentos no card de Análise (AnalysisProductCard)

Apenas frontend. Arquivos afetados: `AnalysisProductCard.tsx` e `AnaliseDashboard.tsx`.

### 1. Remover linha "Sem marca"
- Apagar o `<p>` que renderiza `snapshot.brand ?? "Sem marca"`. O título do produto basta.

### 2. Card ocupa a linha toda
- No `AnaliseDashboard.tsx`, trocar o wrapper `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3` por um simples `div` (sem grid) para que o card use 100% da largura disponível.
- Skeleton também passa a um único bloco `w-full h-40`.

### 3. Quantidade vendida (totais)
- Derivar do `snapshot.priceCurve` (já existe no snapshot):
  - **Total geral:** soma de `units` em todos os buckets.
  - **Por tipo (GMV / Neutro / Margem):** localizar o bucket cujo `price` casa com `priceGmv` / `priceNeutral` / `priceMargin` (comparação em centavos via helper já existente em `compraUtils`/inline) e exibir o `units` desse bucket. Quando não houver bucket exato (caso raro), exibir `—`.
- Cada tile dos 3 preços ganha uma segunda linha discreta: `Vendidos: <units> un` (`text-[11px] text-muted-foreground tabular-nums`).
- Acima do bloco de elasticidade, uma linha-resumo com:
  `Total vendido no período: <total> un` (`text-xs text-muted-foreground`).

### 4. Simulador de elasticidade interativo
Bloco novo abaixo do badge de elasticidade, ocupando linha inteira:

- Dois inputs numéricos pequenos (`Input` shadcn, `h-8 w-24`):
  - **Preço inicial** — default = `snapshot.priceGmv`.
  - **Acréscimo (R$)** — default = `1,00`, step `0,50`.
- Texto dinâmico ao lado, atualizado em tempo real:
  > A cada **R$ X,XX** de subida a partir de **R$ Y,YY**, perde aproximadamente **Z,Z%** em volume (≈ **N un** a menos no período).

Cálculo (puro frontend, sem hook novo):
- `perdaPct = elasticityPct * acrescimo` (linear, mesma premissa do texto atual).
- `unidadesPerdidas = round(totalUnits * perdaPct / 100)`.
- Clamp `perdaPct` em 100%.

A frase descritiva atual ("A cada R$1,00…") é substituída por essa versão interativa.

### Layout final do card (largura total)

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Título do produto                                                    │
├──────────────────────────────────────────────────────────────────────┤
│ [ Preço GMV ]    [ Preço Neutro ]    [ Preço Margem ]                │
│  R$ X,XX          R$ X,XX             R$ X,XX                        │
│  Vendidos: N un   Vendidos: N un      Vendidos: N un                 │
│                                                                      │
│ Total vendido no período: N un                                       │
│                                                                      │
│ [Elasticidade Média]                                                 │
│ Simular:  a partir de [R$ 49,90]  subida de [R$ 1,00]                │
│ → perde ~3,2% em volume (≈ 12 un a menos no período)                 │
└──────────────────────────────────────────────────────────────────────┘
```

### Detalhes técnicos
- Sem mudanças no schema, hooks ou edge functions.
- Helper local `findUnitsAtPrice(curve, target)` usando comparação em centavos (`Math.round(p*100) === Math.round(t*100)`) — mesma técnica já usada em `compraUtils.ts`.
- Estado local com `useState` para os dois inputs do simulador, inicializados a partir do snapshot via `useEffect` quando `snapshot.id` mudar.
- Mantém tokens semânticos (`text-muted-foreground`, `text-foreground`, `bg-muted`) e Plus Jakarta Sans herdado.
