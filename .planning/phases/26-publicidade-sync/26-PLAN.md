# Phase 26 — Publicidade: Conectar sync-ads e Margem Líquida

## Goal

A página `/publicidade` deve exibir dados corretos do pipeline sync-ads (gastos por período com filtro de data, agregados por item_id) e mostrar a Margem Líquida real por produto (receita − CMV − comissão − frete − imposto − ads spend).

## Success Criteria

- Tabela "Produtos Patrocinados" mostra spend/cliques/pedidos agregados no período selecionado (não todos os dias do histórico)
- Coluna "Margem Líq." aparece na tabela com valor colorido (verde ≥0, vermelho <0)
- Botão "Sincronizar" enfileira job `ads` na tabela `sync_jobs` (não chama `ml-ads` diretamente)
- Nenhuma regressão nas outras colunas (CTR, ROAS, ACoS, TACoS, Share Ads, ACoS BE, Estoque)

---

## Task 26-01 — Fix useMLAds: adicionar filtro de data e agregação por item_id em ml_ads_products_cache

**File:** `src/hooks/useMLAds.ts`

**Problem:** Linha 163-166 consulta ml_ads_products_cache sem filtro de data. Com o pipeline sync-ads v10 gravando uma linha por item por dia, a query retorna todos os dias do histórico — itens duplicados, spend inflado.

**Change:** Adicionar `.gte("date", effectiveDateFrom).lte("date", effectiveDateTo)` na query de products. Em seguida, no processamento do `productsRes.data`, agregar as linhas por `item_id` (somando impressions, clicks, spend, attributed_revenue, attributed_orders; calculando cpc/ctr/roas médios ponderados).

**Before (lines 163-166):**
```typescript
supabase
  .from("ml_ads_products_cache")
  .select("*")
  .in("ml_user_id", mlUserIds),
```

**After:**
```typescript
supabase
  .from("ml_ads_products_cache")
  .select("*")
  .in("ml_user_id", mlUserIds)
  .gte("date", effectiveDateFrom)
  .lte("date", effectiveDateTo),
```

**Aggregation (lines ~218-230):** Substituir o `productRows.map()` direto por uma lógica de Map que acumula por `item_id`:
```typescript
const productAcc = new Map<string, AdsProductStat & { _clicks: number; _impressions: number }>();
for (const r of productRows) {
  const prev = productAcc.get(r.item_id);
  if (prev) {
    prev.impressions        += r.impressions        ?? 0;
    prev.clicks             += r.clicks             ?? 0;
    prev.spend              += r.spend              ?? 0;
    prev.attributed_revenue += r.attributed_revenue ?? 0;
    prev.attributed_orders  += r.attributed_orders  ?? 0;
    // recalculate derived metrics after accumulation
  } else {
    productAcc.set(r.item_id, {
      item_id:             r.item_id,
      title:               r.title     ?? "",
      thumbnail:           r.thumbnail ?? null,
      impressions:         r.impressions        ?? 0,
      clicks:              r.clicks             ?? 0,
      spend:               r.spend              ?? 0,
      attributed_revenue:  r.attributed_revenue ?? 0,
      attributed_orders:   r.attributed_orders  ?? 0,
      cpc:  0,
      ctr:  0,
      roas: 0,
    });
  }
}
// Recalculate derived metrics
const products: AdsProductStat[] = Array.from(productAcc.values()).map((p) => ({
  ...p,
  cpc:  p.clicks > 0 ? p.spend / p.clicks : 0,
  ctr:  p.impressions > 0 ? (p.clicks / p.impressions) * 100 : 0,
  roas: p.spend > 0 ? p.attributed_revenue / p.spend : 0,
}));
```

---

## Task 26-02 — Fix syncNow: enfileirar job sync-ads em vez de chamar ml-ads diretamente

**File:** `src/hooks/useMLAds.ts`

**Problem:** Linha 257 chama `supabase.functions.invoke("ml-ads", ...)` — função legada que usa endpoint ML deprecado e não grava dados por data. O pipeline novo é `sync-ads` via `sync_jobs`.

**Change:** Substituir o `Promise.all(mlUserIds.map(...invoke("ml-ads"...)))` por um único INSERT em `sync_jobs` para cada `ml_user_id`, enfileirando job do tipo `ads` com o período correto. O cron `process-sync-job` vai processar em até 5 minutos.

**Before (lines 255-259):**
```typescript
await Promise.all(
  mlUserIds.map((ml_user_id) =>
    supabase.functions.invoke("ml-ads", { body: { ml_user_id, force: true } })
  )
);
```

**After:**
```typescript
const today = format(new Date(), "yyyy-MM-dd");
await supabase.from("sync_jobs").insert(
  mlUserIds.map((ml_user_id) => ({
    job_type:   "ads",
    ml_user_id,
    date_from:  effectiveDateFrom,
    date_to:    today,
    status:     "pending",
  }))
);
```

Note: `effectiveDateFrom` e `today` são acessíveis dentro do `useCallback` via closure (já usados em `refresh`). Importar `format` de `date-fns` se ainda não importado.

---

## Task 26-03 — Adicionar coluna "Margem Líq." na tabela de Produtos Patrocinados

**File:** `src/pages/mercadolivre/MLPublicidade.tsx`

**Problem:** A página não usa `useMLProductMargins`, então não exibe margem líquida (receita − CMV − comissão − frete − imposto − ads) por produto.

**Change (3 sub-steps):**

### 26-03a — Importar e chamar useMLProductMargins

```typescript
// Adicionar import no topo (junto dos outros hooks):
import { useMLProductMargins } from "@/hooks/useMLProductMargins";

// Dentro do componente, após a linha de useMLAdsDerivedMetrics:
const { data: marginMap } = useMLProductMargins(fetchFrom, currentTo);
```

`fetchFrom` e `currentTo` já existem no componente (são usados em `useMLAds`).

### 26-03b — Adicionar coluna no `<thead>` após TACoS (linha ~778), antes de Share Ads

```tsx
<th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground whitespace-nowrap">
  Margem Líq.
</th>
```

Inserir entre `</th>` do TACoS e o `<th>` de Share Ads.

### 26-03c — Adicionar célula no `<tbody>` (linha ~836), após a célula TACoS

```tsx
<td className="px-4 py-3 text-right text-xs tabular-nums">
  {(() => {
    const m = marginMap?.get(p.item_id);
    if (m == null) return <span className="text-muted-foreground">—</span>;
    return (
      <span className={m >= 0 ? "text-emerald-500 font-semibold" : "text-red-500 font-semibold"}>
        {m.toFixed(1)}%
      </span>
    );
  })()}
</td>
```

Inserir entre o `</td>` do TACoS e o `<td>` de Share Ads.

**Atualizar colSpan:** A linha de "sem dados" usa `colSpan={14}` (linha ~793) — incrementar para `colSpan={15}`.

---

## Execution Order

```
Wave 1 (independentes):
  - 26-01: fix useMLAds query + aggregation
  - 26-02: fix syncNow

Wave 2 (depende que 26-01 esteja OK para validar):
  - 26-03: adicionar Margem Líq. na página
```

## Validation

Após implementação:
1. Abrir `/publicidade` → tabela de produtos deve mostrar spend/cliques do período selecionado (não inflado)
2. Mudar período para "Últimos 7 dias" → valores devem mudar (prova que filtro de data funciona)
3. Coluna "Margem Líq." aparece com % colorido (verde ou vermelho)
4. Clicar "Sincronizar" → toast "Publicidade sincronizada" aparece; verificar `sync_jobs` no Supabase que um job `ads` foi inserido com status `pending`
