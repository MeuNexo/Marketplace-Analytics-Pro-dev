# Phase 14: ml_orders — Orders Individuais - Research

**Researched:** 2026-05-21
**Domain:** MercadoLibre Orders API + Supabase RLS + React Query hooks + costSummary refactor
**Confidence:** HIGH

---

## Summary

A tabela `orders` **já existe** no banco de produção com schema completo que atende todos os requisitos de ORDERS-01. Ela é populada diariamente pela edge function `sync-ml-orders` via fila `sync_jobs`. A edge function usa `item.sale_fee` para `comissao` e calcula `frete` com fallback entre `order.shipping.cost` (pago pelo comprador) e `shipment.base_cost` (absorvido pelo vendedor — frete grátis/Full).

O problema central desta fase **não é criar uma nova tabela** — é fazer o frontend consumir `orders` para calcular `comissao` e `frete` reais em vez dos percentuais hardcoded de 11% e 5% usados em `MercadoLivre.tsx`.

A única lacuna é que `mercado-libre-integration` (o sync interativo acionado pelo usuário) ainda não faz upsert em `orders` — apenas `sync-ml-orders` faz isso. Ambas as funções precisam gravar em `orders` para que os dados fiquem disponíveis imediatamente após sync manual.

**Primary recommendation:** Criar hook `useMLOrders(from, to)` que lê a tabela `orders` existente e substituir o `costSummary` hardcoded em `MercadoLivre.tsx` pelos valores reais de SUM(comissao) e SUM(frete).

---

## Descoberta Crítica: Tabela `orders` já existe

A tabela `orders` em `public.orders` já está na produção com o schema completo. Confirmado via `src/integrations/supabase/types.ts` (linhas 995–1095) e pela edge function `sync-ml-orders/index.ts` que faz upsert nela.

### Schema atual de `public.orders` (via types.ts)

| Coluna | Tipo | Notas |
|--------|------|-------|
| `id` | uuid | PK |
| `ml_order_id` | text | NOT NULL |
| `ml_user_id` | text | NOT NULL |
| `organization_id` | uuid | FK organizations, nullable |
| `seller_id` | uuid | FK sellers, nullable |
| `user_id` | uuid | nullable (ver migration 20260520190000) |
| `item_id` | text | NOT NULL |
| `variation_id` | text | NOT NULL DEFAULT '' |
| `sku` | text | nullable |
| `titulo` | text | nullable |
| `listing_type` | text | nullable (classic/premium/free) |
| `quantidade` | integer | NOT NULL |
| `preco_unit` | numeric | nullable |
| `comissao` | numeric | nullable — via `item.sale_fee` |
| `frete` | numeric | nullable — via shipping cost (ver abaixo) |
| `status` | text | nullable (paid/cancelled/etc.) |
| `data_pedido` | text (date) | nullable |
| `data_pagamento` | text (date) | nullable |
| `estado` | text | UF (nullable) |
| `cidade` | text | nullable |
| `comprador` | text | nullable |
| `custo_unit` | numeric | nullable |
| `tax_rate` | numeric | nullable |
| `tax_amount` | numeric | nullable |
| `uf_origem` | text | nullable |
| `receita_bruta` | numeric | nullable (computed) |
| `receita_liquida` | numeric | nullable (computed) |
| `synced_at` | timestamptz | NOT NULL |

**Unique constraint (upsert key):** `(ml_order_id, ml_user_id, item_id, variation_id)` — confirmado em `sync-ml-orders/index.ts` linha 484.

**Conclusão para ORDERS-01:** A tabela `orders` satisfaz todos os campos requeridos por ORDERS-01. O requirement `ml_orders` da spec é um alias para essa tabela já existente. NÃO criar nova tabela.

---

## Campos da ML Orders API — Comissao e Frete

### `comissao` → `item.sale_fee`

**Fonte verificada:** `sync-ml-orders/index.ts`, função `expandOrder()`, linha 299:
```typescript
comissao: item.sale_fee != null ? Number(item.sale_fee) : null,
```

O campo `sale_fee` existe no objeto `order_items[i]` (não no nível do order). É a taxa de serviço do ML cobrada por item vendido.

- **Alternativa descartada:** `order.payments[0].marketplace_fee` — existe na API mas representa a comissão total do pagamento, não por item. `sale_fee` por `order_item` é o correto para sellers multi-item.
- **Nota:** `order.fee_details` existe mas contém um array de objetos `{type, amount}` — mais complexo de parsear e já resolvido por `sale_fee`.

### `frete` → dupla fonte com fallback

**Fonte verificada:** `sync-ml-orders/index.ts`, função `expandOrder()`, linhas 271–275:
```typescript
const buyerCost = order.shipping?.cost != null ? Number(order.shipping.cost) : null;
const frete = (buyerCost != null && buyerCost > 0)
  ? buyerCost
  : (detail?.cost ?? null);
```

Onde `detail.cost` vem de `/shipments/{id}` campo `base_cost ?? cost?.gross`.

**Lógica de negócio:**
- `order.shipping.cost` > 0 → comprador pagou frete → usar esse valor
- `order.shipping.cost` == 0 ou null → frete grátis ou Full → usar `shipment.base_cost` (custo absorvido pelo vendedor)

**O campo `shipment.base_cost` é o custo real de frete grátis/Full.** Esta é a razão pela qual o frete real (R$37.555) é tão diferente do hardcoded 5% (R$17.561) — o frete grátis não aparece em `order.shipping.cost`.

### `sku` → `item.seller_custom_field ?? item.seller_sku`

**Fonte verificada:** `sync-ml-orders/index.ts` linha 293:
```typescript
sku: prod.seller_custom_field ?? prod.seller_sku ?? null,
```

Onde `prod = item.item` (objeto aninhado dentro de `order_items[i]`).

---

## Estado da RLS em `public.orders`

A tabela `orders` usa o padrão org-scope idêntico às outras tabelas ML. Confirmado via `src/integrations/supabase/types.ts` (FK `orders_organization_id_fkey` e `orders_seller_id_fkey`).

**Padrão RLS vigente (deduzido do padrão universal aplicado em `20260423153544`):**
```sql
CREATE POLICY "orders org select" ON public.orders FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND public.is_org_member(auth.uid(), organization_id));
```

O upsert em `sync-ml-orders` usa `supabaseAdmin` (service role), que bypassa RLS — correto para background sync.

**ORDERS-03 já está satisfeito** — RLS por organization_id já existe na tabela `orders`.

---

## Gap: `mercado-libre-integration` não grava em `orders`

A edge function `mercado-libre-integration` (sync interativo do usuário) **NÃO** faz upsert em `orders`. Ela escreve apenas em:
- `ml_daily_cache`
- `ml_hourly_cache`
- `ml_product_daily_cache`
- `ml_state_daily_cache`
- `ml_user_cache`
- `ml_sync_log`

Isso significa que após um sync manual do usuário no Dashboard, os dados de `comissao` e `frete` reais ficam desatualizados até o job cron noturno rodar.

**ORDERS-02 requer adicionar upsert em `orders` em `mercado-libre-integration`.**

A lógica já está implementada em `sync-ml-orders` — pode ser extraída como helper compartilhado ou duplicada inline.

**Risco:** `mercado-libre-integration` já é pesada (orders + visits + active listings + shipments + thumbnails). Adicionar shipment details para frete vai aumentar latência. A estratégia de `sync-ml-orders` de fazer 10 shipments em paralelo deve ser replicada.

---

## Análise do `costSummary` atual em `MercadoLivre.tsx`

**Linhas exatas hardcoded (linhas 291–302):**
```typescript
const costSummary = useMemo(() => {
  const grossRevenue = effectiveMetrics?.total_revenue ?? 0;
  const comissao = grossRevenue * 0.11;   // HARDCODED 11%
  const frete = grossRevenue * 0.05;      // HARDCODED 5%
  const ads = adsSummary.total_spend;
  const totalKnown = comissao + frete + ads;
  return {
    comissao, frete, publicidade: ads, custo_produto: 0, impostos: 0,
    total_known: totalKnown, gross_revenue: grossRevenue,
    pct_receita: grossRevenue > 0 ? Math.round((totalKnown / grossRevenue) * 10000) / 100 : 0,
  };
}, [effectiveMetrics, adsSummary]);
```

**Mudanças necessárias:**
1. `comissao` → `SUM(comissao) FROM orders WHERE data_pedido BETWEEN from AND to AND ml_user_id IN (resolvedMLUserIds) AND organization_id = currentOrgId`
2. `frete` → `SUM(frete) FROM orders WHERE mesmas condições`
3. `avg_ticket` → atualmente calculado em `effectiveMetrics` como `total_revenue / total_orders`. Precisa ser `approved_revenue / COUNT(*) WHERE status = 'paid'`

**Para avg_ticket (KPIS-03):** O cálculo atual divide `total_revenue / total_orders` incluindo pedidos cancelados. O correto é `approved_revenue / count(status='paid')`. Esta mudança acontece também dentro de `effectiveMetrics` (linhas 264–265).

---

## Hook `useMLOrders(from, to)` — Design

**Localização sugerida:** `src/hooks/useMLOrders.ts`

**Padrão a seguir:** TanStack React Query v5 (Pattern 1 do projeto), igual a `useMLDailyQuery`.

```typescript
// src/hooks/useMLOrders.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";

export interface MLOrderSummary {
  total_comissao: number;
  total_frete: number;
  paid_orders_count: number;
  paid_revenue: number;
}

export function useMLOrders(from: string, to: string) {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<MLOrderSummary>({
    queryKey: ["ml-orders-summary", orgId, resolvedMLUserIds, from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("comissao, frete, status, preco_unit, quantidade")
        .eq("organization_id", orgId!)
        .in("ml_user_id", resolvedMLUserIds)
        .gte("data_pedido", from)
        .lte("data_pedido", to);
      if (error) throw error;
      const rows = data ?? [];
      return {
        total_comissao: rows.reduce((s, r) => s + (r.comissao ?? 0), 0),
        total_frete:    rows.reduce((s, r) => s + (r.frete ?? 0), 0),
        paid_orders_count: rows.filter(r => r.status === "paid").length,
        paid_revenue: rows
          .filter(r => r.status === "paid")
          .reduce((s, r) => s + ((r.preco_unit ?? 0) * (r.quantidade ?? 1)), 0),
      };
    },
    enabled: !!orgId && resolvedMLUserIds.length > 0 && !!from && !!to,
    staleTime: 5 * 60 * 1000,
  });
}
```

**Nota:** A query pode retornar muitas linhas para ranges longos. Para períodos > 30 dias com alto volume, considerar usar uma RPC que faça a agregação no banco.

---

## Mudanças em `mercado-libre-integration`

A edge function precisa do bloco de upsert em `orders` após processar os orders. O padrão exato está em `sync-ml-orders/index.ts` na função `expandOrder()` e no upsert final.

**O que adicionar ao loop de upsert (após linha ~778 de `mercado-libre-integration`):**

```typescript
// Expandir orders para upsert individual
const orderRecords = [];
for (const order of orders) {
  const shipId = order.shipping?.id ? Number(order.shipping.id) : null;
  const detail = shipId ? shipmentStates_extended.get(shipId) : undefined;
  // ... lógica idêntica a expandOrder() em sync-ml-orders
}

if (orderRecords.length > 0) {
  (async () => {
    try {
      for (let i = 0; i < orderRecords.length; i += 200) {
        await supabaseAdmin
          .from("orders")
          .upsert(orderRecords.slice(i, i + 200), {
            onConflict: "ml_order_id,ml_user_id,item_id,variation_id",
          });
      }
    } catch (e) {
      console.error("orders upsert error (non-fatal):", e);
    }
  })();
}
```

**Problema:** `mercado-libre-integration` já busca shipments via `fetchShipmentStates()` que retorna apenas `{ uf, state_name }` — não inclui `base_cost` para frete. Será necessário ampliar `fetchShipmentStates` para também retornar `base_cost`, ou chamar `/shipments/{id}` novamente.

**Recomendação:** Criar uma nova função `fetchShipmentDetails()` (idêntica à de `sync-ml-orders`) que retorna `{ cost, estado, cidade }`. Substituir ou complementar `fetchShipmentStates` na `mercado-libre-integration`.

**Risco de performance:** Cada `/shipments/{id}` adiciona latência. O cap de 150 shipments em `mercado-libre-integration` deve ser mantido.

---

## Mudanças em `MercadoLivre.tsx`

### 1. Substituir `costSummary` hardcoded

**Antes (linha 291–302):**
```typescript
const costSummary = useMemo(() => {
  const grossRevenue = effectiveMetrics?.total_revenue ?? 0;
  const comissao = grossRevenue * 0.11;
  const frete = grossRevenue * 0.05;
  ...
```

**Depois:**
```typescript
const { data: ordersSummary } = useMLOrders(currentFrom, currentTo);

const costSummary = useMemo(() => {
  const grossRevenue = effectiveMetrics?.total_revenue ?? 0;
  const comissao = ordersSummary?.total_comissao ?? grossRevenue * 0.11; // fallback
  const frete = ordersSummary?.total_frete ?? grossRevenue * 0.05;       // fallback
  ...
```

**Importante:** Manter o fallback para percentual enquanto `orders` não tem dados para o período selecionado (antes do primeiro sync com dados de orders). O fallback evita regressão com `total_known = 0`.

### 2. Corrigir `avg_ticket` (KPIS-03)

**Antes (linhas 264–265):**
```typescript
if (m.total_orders > 0) m.avg_ticket = m.total_revenue / m.total_orders;
```

**Depois:**
```typescript
const paidCount = ordersSummary?.paid_orders_count ?? m.total_orders;
const paidRev   = ordersSummary?.paid_revenue     ?? m.approved_revenue;
if (paidCount > 0) m.avg_ticket = paidRev / paidCount;
```

**Nota:** `effectiveMetrics` é calculado em `useMemo` — o hook `useMLOrders` retorna dados de query assíncrona. A dependência `ordersSummary` precisará ser incluída no `useMemo` de `effectiveMetrics`, ou avg_ticket calculado separadamente.

### 3. Taxa de conversão (KPIS-04)

**Sem mudança necessária.** A taxa de conversão usa `unique_buyers / unique_visits` de `ml_daily_cache`, não de `orders`. Não há risco de regressão.

---

## RLS Pattern para `ml_orders` (alias `orders`)

O padrão vigente no projeto para todas as tabelas ML cache é o "org-scope" introduzido na migration `20260423153544`:

```sql
-- SELECT: is_org_member check
CREATE POLICY "orders org select" ON public.orders FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND public.is_org_member(auth.uid(), organization_id));
```

**Confirmação:** Este padrão já existe em `orders` (conforme tipos gerados mostram FK para organizations e sellers).

**Para leitura via hook frontend:** O client anon (com JWT do usuário) vai usar este RLS automaticamente. O hook precisa apenas filtrar por `organization_id` explicitamente para performance (evitar seq scan).

---

## Don't Hand-Roll

| Problema | Não construir | Usar |
|----------|---------------|------|
| Frete real de ordens ML | Cálculo manual de taxa | `orders.frete` (já calculado via `/shipments/{id}.base_cost`) |
| Comissão real | Percentual hardcoded 11% | `orders.comissao` (via `item.sale_fee`) |
| Paginação de orders | Loop manual | `sync-ml-orders` já implementa paginação com split recursivo |
| Deduplicate orders | Lógica custom | Unique constraint `(ml_order_id, ml_user_id, item_id, variation_id)` |

---

## Common Pitfalls

### Pitfall 1: Tabela `orders` sem migration commitada (drift)
**O que vai errado:** A tabela `orders` existe no banco de produção mas NÃO está em nenhum arquivo de migration em `/supabase/migrations/`. É drift puro.
**Por que acontece:** Foi criada diretamente via Supabase SQL Editor ou fase anterior sem commitar migration.
**Como evitar:** Antes de criar nova migration, capturar o DDL atual com `supabase db diff` para não duplicar a tabela. A migration de Phase 14 deve apenas verificar existência (`CREATE TABLE IF NOT EXISTS` ou `ALTER TABLE IF NOT EXISTS`).
**Sinal de alerta:** A migration `20260520190000_orders_user_id_nullable.sql` faz `ALTER TABLE public.orders` sem que haja um `CREATE TABLE` prévio nas migrations — confirma que a tabela é drift.

### Pitfall 2: `comissao` NULL para ordens sem `sale_fee`
**O que vai errado:** Nem toda order item tem `sale_fee` não-nulo. Se NULL, `SUM(comissao)` vai subtrair do total real.
**Por que acontece:** Ordens canceladas ou antigas podem não ter `sale_fee`.
**Como evitar:** No hook e no costSummary, usar `COALESCE(comissao, 0)` / `?? 0` e filtrar apenas `status IN ('paid', 'shipped', 'delivered')` para o cálculo de custos.

### Pitfall 3: Frete duplicado no fallback
**O que vai errado:** Se `order.shipping.cost` é 0 (frete grátis) e `shipment.base_cost` também é 0 (Full sem custo visível), o frete fica NULL. A soma retorna menos que o real.
**Por que acontece:** ML não expõe o custo real do Full para o vendedor em todos os casos.
**Como evitar:** Documentar como limitação conhecida. Não tentar compensar com percentual hardcoded (geraria inconsistência).

### Pitfall 4: Período sem dados em `orders` → fallback para hardcoded
**O que vai errado:** Se o usuário seleciona um período histórico antes do primeiro sync de orders, `SUM(comissao)` retorna 0 e o costSummary mostra comissão R$0.
**Por que acontece:** `orders` só tem dados a partir do momento em que `sync-ml-orders` foi implantado.
**Como evitar:** Implementar fallback explícito no hook: se `total_comissao === 0 && total_frete === 0 && paid_orders_count === 0`, retornar `null` para sinalizar "sem dados" ao invés de zeros. O `costSummary` usa percentual hardcoded como fallback nesse caso.

### Pitfall 5: `mercado-libre-integration` timeout com shipment details
**O que vai errado:** Adicionar fetch de shipments em `mercado-libre-integration` pode causar timeout (função já é pesada).
**Por que acontece:** O cap atual de `fetchShipmentStates` é 150 shipments com orçamento total de 20s. Adicionar `base_cost` ao mesmo fetch não adiciona latência (mesma chamada). O problema seria se o cap fosse removido.
**Como evitar:** Manter cap de 150 shipments. O upsert em `orders` deve ser fire-and-forget (async IIFE), igual ao padrão de `ml_product_daily_cache` e `ml_state_daily_cache`.

### Pitfall 6: `avg_ticket` regride se `ordersSummary` ainda está carregando
**O que vai errado:** `useMLOrders` é assíncrono. Durante o loading, `paid_orders_count === undefined` e `avg_ticket` fica 0 brevemente.
**Por que acontece:** Dependência de query async em cálculo de metric.
**Como evitar:** Usar fallback `?? m.total_orders` e `?? m.approved_revenue` enquanto `ordersSummary` não carregou. Adicionar estado de loading ao KPI de ticket médio se necessário.

---

## Architecture Patterns

### Upsert de orders em `mercado-libre-integration`

Seguir o padrão de upsert fire-and-forget já estabelecido:

```typescript
// Fire-and-forget, igual a productRows e stateRows já implementados
if (orderRows.length > 0) {
  (async () => {
    try {
      const batches: typeof orderRows[] = [];
      for (let i = 0; i < orderRows.length; i += 200) {
        batches.push(orderRows.slice(i, i + 200));
      }
      await Promise.all(
        batches.map((batch) =>
          supabaseAdmin
            .from("orders")
            .upsert(batch, { onConflict: "ml_order_id,ml_user_id,item_id,variation_id" })
            .then(({ error }) => { if (error) console.error("Orders upsert error:", error); }),
        ),
      );
      console.log(`Orders: ${orderRows.length} rows saved`);
    } catch (e) {
      console.error("Orders async error:", e);
    }
  })();
}
```

### Modificar `fetchShipmentStates` para retornar `base_cost`

A função atual em `mercado-libre-integration` retorna `{ uf: string; state_name: string }`. Ampliar para:

```typescript
interface ShipmentInfo {
  uf: string;
  state_name: string;
  base_cost: number | null;  // NOVO
  cidade: string | null;     // NOVO
}
```

Adicionar na leitura do JSON de cada shipment:
```typescript
const base_cost_raw = data?.base_cost ?? data?.cost?.gross ?? null;
const base_cost = base_cost_raw != null ? Number(base_cost_raw) : null;
const cityObj = addr?.city ?? null;
const cidade = cityObj ? (typeof cityObj === "object" ? cityObj?.name : String(cityObj)) : null;
```

---

## Riscos e Edge Cases

| Risco | Probabilidade | Impacto | Mitigação |
|-------|--------------|---------|-----------|
| Drift sem migration da tabela `orders` | CONFIRMADO | Alto | Usar `CREATE TABLE IF NOT EXISTS` ou só alterar se precisar de coluna nova |
| `sale_fee` NULL em alguns items | Média | Médio | COALESCE para 0 no aggregation |
| Timeout em `mercado-libre-integration` com shipment details | Baixa | Médio | Manter cap 150 + fire-and-forget |
| Período histórico sem dados em `orders` | Alta (curto prazo) | Médio | Fallback para hardcoded quando sem dados |
| `avg_ticket` pisca durante loading de `useMLOrders` | Alta | Baixo | Fallback em useMemo |
| Dois fontes de verdade (orders vs daily_cache) divergindo | Média | Alto | `orders` é authoritative para comissao/frete; daily_cache para totais de receita |

---

## Ambiente — Verificação de Dependências

A phase é puramente código + migration SQL. Sem dependências externas além do Supabase já ativo.

| Dependência | Necessário Por | Disponível | Versão | Fallback |
|-------------|----------------|------------|--------|----------|
| Supabase `orders` table | ORDERS-01/02/03/04 | Confirmado (drift, existe em prod) | — | — |
| `sync-ml-orders` edge function | ORDERS-02 background | Confirmado (existe) | — | — |
| `is_org_member` RPC | RLS policy | Confirmado | — | — |
| `@tanstack/react-query` v5 | ORDERS-04 hook | Confirmado (5.83.0) | 5.83.0 | — |

---

## O que NÃO fazer

- **Não criar tabela `ml_orders`** — a tabela `orders` já existe com todos os campos necessários. Criar uma nova tabela duplicaria dados e criaria inconsistência.
- **Não remover o fallback hardcoded** antes de confirmar que `orders` tem dados para todos os períodos relevantes.
- **Não fazer a query de `useMLOrders` retornar todas as linhas individualmente** para períodos longos — para períodos > 60 dias considerar RPC com agregação no banco.
- **Não mudar o `onConflict` key** de `(ml_order_id, ml_user_id, item_id, variation_id)` — está correto para suportar múltiplos itens por order.

---

## Resumo de Mudanças por Arquivo

### Migration (nova)
- Arquivo: `supabase/migrations/20260521NNNNNN_ml_orders_indexes.sql`
- Objetivo: Adicionar índices em `orders` para queries de período+org+ml_user_id eficientes
- Não criar tabela (já existe)

```sql
-- Índice composto para query do hook useMLOrders
CREATE INDEX IF NOT EXISTS idx_orders_org_mluser_date
  ON public.orders (organization_id, ml_user_id, data_pedido);

CREATE INDEX IF NOT EXISTS idx_orders_org_status_date
  ON public.orders (organization_id, status, data_pedido);
```

### Edge function: `mercado-libre-integration`
- Ampliar `fetchShipmentStates` para retornar `{ uf, state_name, base_cost, cidade }`
- Adicionar loop de expansão de order rows (extrair de `sync-ml-orders.expandOrder()`)
- Adicionar upsert fire-and-forget em `orders` (mesmo padrão de productRows/stateRows)

### Hook novo: `src/hooks/useMLOrders.ts`
- `useMLOrders(from: string, to: string) → { data: MLOrderSummary | undefined, isLoading, error }`
- Query: `SELECT comissao, frete, status, preco_unit, quantidade FROM orders WHERE organization_id=? AND ml_user_id IN (?) AND data_pedido BETWEEN ? AND ?`
- Retorna: `{ total_comissao, total_frete, paid_orders_count, paid_revenue }`

### `src/pages/MercadoLivre.tsx`
- Importar e chamar `useMLOrders(currentFrom, currentTo)`
- Substituir `comissao = grossRevenue * 0.11` por `ordersSummary?.total_comissao ?? grossRevenue * 0.11`
- Substituir `frete = grossRevenue * 0.05` por `ordersSummary?.total_frete ?? grossRevenue * 0.05`
- Corrigir `avg_ticket` para usar `paid_revenue / paid_orders_count` com fallback

---

## Sources

### Primary (HIGH confidence)
- `/root/garment-glow-test/supabase/functions/sync-ml-orders/index.ts` — confirma campos `sale_fee` (comissao) e lógica de frete com `base_cost`
- `/root/garment-glow-test/src/integrations/supabase/types.ts` linhas 995–1095 — schema completo de `public.orders`
- `/root/garment-glow-test/src/pages/MercadoLivre.tsx` linhas 291–302 — hardcoded atual
- `/root/garment-glow-test/supabase/migrations/20260423153544_*.sql` — padrão RLS org-scope

### Secondary (MEDIUM confidence)
- ML Orders API documentation implícita — `sale_fee` e `base_cost` são campos documentados na API pública do Mercado Livre; comportamento confirmado pela implementação existente em `sync-ml-orders`

---

## Metadata

**Confidence breakdown:**
- Campos ML API (comissao/frete): HIGH — confirmado por implementação existente e funcionando em sync-ml-orders
- Schema tabela orders: HIGH — verificado via types.ts e migrations
- RLS pattern: HIGH — verificado via múltiplas migrations do projeto
- Hook design: HIGH — segue padrão TanStack Query v5 já usado no projeto
- Pitfalls: HIGH — baseados em código real lido

**Research date:** 2026-05-21
**Valid until:** 2026-06-21 (estável — sem dependências de APIs externas que mudem frequentemente)
