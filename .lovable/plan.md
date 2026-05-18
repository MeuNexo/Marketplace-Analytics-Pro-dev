## Objetivo

Quando o usuário seleciona vários produtos na busca, eles devem ser tratados como **variações de um mesmo produto**. O resultado é **uma única análise** e **um único card**, agregando os pedidos de todas as variações no período selecionado.

## Comportamento

- A busca continua permitindo seleção múltipla com checkmarks e chips (como já está).
- Ao clicar em **Analisar**:
  - Buscar pedidos de cada `item_id` selecionado no período.
  - Concatenar todos os pedidos em uma única lista.
  - Rodar `computeAnalysis` uma única vez sobre essa lista combinada.
  - Salvar **um único snapshot** representando o conjunto.
- Renderizar **um único `AnalysisProductCard`**, a tabela de preços e o painel de compra recomendada com base nesse snapshot único.
- Histórico mostra a análise combinada como uma única linha.

## Decisões técnicas

- **`item_id` do snapshot (chave de histórico)**: usar uma chave composta determinística — os `item_id`s das variações ordenados e unidos por `+` (ex.: `MLB123+MLB456`). Assim, o histórico do mesmo conjunto de variações é recuperado consistentemente; combinações diferentes geram históricos separados.
- **`product_title`**: usar o título da primeira variação + sufixo `(+N variações)` quando houver mais de uma. Variação única mantém o título original.
- **`brand`**: `null` (já é o padrão atual).
- **`ml_user_id`**: o mesmo já usado hoje (loja selecionada / primeira loja).
- **Sem mudanças no schema** — o registro continua sendo uma linha em `commercial_analysis_snapshots`.

## Mudanças no código

`src/components/mercadolivre/analise/AnaliseDashboard.tsx`:

1. `handleAnalyze`: substituir o loop por-produto por uma única chamada agregada:
   - `Promise.all(selectedProducts.map(p => fetchOrders(p.item_id, ...)))` → flatten.
   - Se total de pedidos = 0 → toast "Sem pedidos" e retorna.
   - Montar `SnapshotInput` único com `itemId` composto e `productTitle` agregado.
   - `saveSnapshot(input)` uma única vez; atualizar `snapshots` com o novo registro no topo.
2. `useEffect` que carrega histórico: usar a chave composta atual (derivada de `selectedProducts`) em vez de buscar por cada produto individualmente.
3. Render do grid de cards: voltar a exibir apenas `snapshots[0]` (um único card), removendo o `Map`/`flat` introduzido anteriormente.
4. `removeProduct`: continua removendo do array de seleção; limpa snapshots locais (porque a chave composta mudou e o histórico recarrega).

Nenhuma mudança em `useAnalysisSnapshots`, `AnalysisProductCard`, `AnalisePrecosTable`, `CompraRecomendadaPanel`, `HistoricoSnapshotTable` ou no banco.
