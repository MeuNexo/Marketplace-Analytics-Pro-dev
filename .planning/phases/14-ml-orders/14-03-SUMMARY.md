---
plan: 14-03
status: complete
commit: b1a9b97d
---

## O que foi feito

Inserido invoke de `sync-ml-orders` dentro do `while` loop em `useMLSync.syncFromAPI`, após o bloco `if (syncData.seller_reputation)` e antes de `chunksDone++` (linha 164 do arquivo final).

### Linha exata inserida

```typescript
// Sync orders para este chunk (non-fatal — não aborta o sync principal)
try {
  await supabase.functions.invoke("sync-ml-orders", {
    body: {
      ml_user_id: mlUserId,
      date_from: format(chunkStart, "yyyy-MM-dd"),
      date_to: format(chunkEnd, "yyyy-MM-dd"),
      seller_id: capturedStores.find(s => s.ml_user_id === mlUserId)?.seller_id || null,
    },
  });
} catch (ordersErr) {
  console.warn("sync-ml-orders (non-fatal):", ordersErr);
}
```

### Resultado do build

```
✓ built in 17.31s
```

Zero erros TypeScript (`npx tsc --noEmit` sem output).

## Efeito esperado após sync na UI

1. Cada chunk (1 dia) que passa por `mercado-libre-integration` agora invoca `sync-ml-orders` com o mesmo range de datas
2. `sync-ml-orders` (versão 4, deployed) insere/atualiza rows em `public.orders` com `onConflict: ml_order_id,ml_user_id,item_id,variation_id`
3. `useMLOrders` (já existente) busca `SUM(comissao)` e `SUM(frete)` de `public.orders` — o hook `useMLOrders` é invalidado pelo `invalidateAll()` que já existia ao fim do loop
4. Dashboard de Vendas passa a exibir comissão e frete calculados de dados reais (não 11%/5% hardcoded)

## Validação pendente (UI)

Após próximo sync via browser:
- `SELECT count(*) FROM orders WHERE data_pedido >= current_date - 7` deve retornar > 0
- Cards de Comissão e Frete no Dashboard devem mostrar valores derivados de `SUM(orders.comissao)` e `SUM(orders.frete)`
