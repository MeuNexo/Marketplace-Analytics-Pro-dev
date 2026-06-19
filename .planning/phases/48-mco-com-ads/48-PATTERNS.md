# Phase 48: MCO com Ads — Mapa de Padrões

**Mapeado:** 2026-06-14
**Arquivos analisados:** 7 (2 migrations novas, 1 EF modificada, 1 hook novo, 2 páginas modificadas, 1 componente modificado)
**Análogos encontrados:** 7 / 7

---

## Classificação de Arquivos

| Arquivo Novo/Modificado | Role | Data Flow | Análogo Mais Próximo | Qualidade |
|-------------------------|------|-----------|----------------------|-----------|
| `supabase/migrations/*_margin_with_ads_rpc.sql` | migration / RPC | CRUD aggregation | `supabase/migrations/20260527110000_margin_aggregate_rpcs.sql` (get_margin_by_product) | exact |
| `supabase/migrations/*_consultor_config_ads_cols.sql` | migration / DDL | schema change | `supabase/migrations/20260645000000_consultor_tables.sql` (ALTER TABLE padrão de colunas config) | exact |
| `supabase/functions/consultor-insights/index.ts` | edge function | event-driven / rule engine | o próprio arquivo (RULE 1/2 para nova RULE ads_eating_margin; RULE 3 para upgrade ads_no_sale) | exact |
| `src/hooks/useMLMarginWithAds.ts` | hook | request-response / RPC | `src/hooks/useMLMarginAnalysis.ts` | exact |
| `src/pages/mercadolivre/MLAnuncios.tsx` | page component | request-response | o próprio arquivo (columnView "financeiro" existente, linhas 1226-1247) | exact |
| `src/pages/MercadoLivre.tsx` | page component | request-response | o próprio arquivo (adsSpendMes + chamada MLCostCard, linhas 255-258 e 714-729) | exact |
| `src/components/mercadolivre/MLCostCard.tsx` | component | request-response | o próprio arquivo (padrão de linha CMV/Impostos, linhas 196-242) | exact |

---

## Atribuições de Padrão por Arquivo

---

### `supabase/migrations/*_margin_with_ads_rpc.sql` (migration, aggregation)

**Análogo:** `supabase/migrations/20260527110000_margin_aggregate_rpcs.sql`

**Padrão de assinatura e cabeçalho da RPC** (linhas 118-177 do análogo):

```sql
CREATE OR REPLACE FUNCTION public.get_margin_with_ads_by_product(
  p_org_id   UUID,
  p_user_ids TEXT[],
  p_from     DATE,
  p_to       DATE
)
RETURNS TABLE (
  item_id               TEXT,
  titulo                TEXT,
  sku                   TEXT,
  listing_type          TEXT,
  receita               NUMERIC,
  cmv                   NUMERIC,
  comissao              NUMERIC,
  frete                 NUMERIC,
  impostos              NUMERIC,
  lucro                 NUMERIC,
  lucro_pct             NUMERIC,
  pedidos               BIGINT,
  unidades              BIGINT,
  has_cmv               BOOLEAN,
  -- Campos novos: ads
  ads_spend             NUMERIC,
  ads_attributed_orders BIGINT,
  lucro_pos_ads         NUMERIC,
  lucro_pct_pos_ads     NUMERIC,
  ads_no_sale           BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER          -- diferença crítica vs análogo (SECURITY INVOKER); DEFINER evita truncamento PostgREST
SET search_path = public
AS $$
  ...
$$;
GRANT EXECUTE ON FUNCTION public.get_margin_with_ads_by_product(UUID, TEXT[], DATE, DATE) TO authenticated;
```

**Padrão do filtro de status e COALESCE** (linhas 145-177 do análogo — copiar exatamente):

```sql
-- orders_side CTE (copiar de get_margin_by_product, acrescentar apenas GROUP BY item_id):
WHERE o.organization_id = p_org_id
  AND o.ml_user_id  = ANY(p_user_ids)
  AND o.status      IN ('paid', 'shipped', 'delivered')
  AND o.data_pedido::date BETWEEN p_from AND p_to
  AND o.item_id IS NOT NULL
GROUP BY o.item_id

-- ads_side CTE (nova):
FROM public.ml_ads_products_cache a
WHERE a.organization_id = p_org_id
  AND a.ml_user_id = ANY(p_user_ids)
  AND a.date BETWEEN p_from AND p_to
GROUP BY a.item_id

-- JOIN: FULL OUTER JOIN (não LEFT JOIN) para surfacing de itens ads-only (D-11):
FROM orders_side o
FULL OUTER JOIN ads_side a USING (item_id)
ORDER BY COALESCE(o.receita, 0) DESC;
-- SEM LIMIT — análogo tem LIMIT 500; nova RPC remove o limite (MCO-01)
```

**Padrão de GRANT** (linha 321 do análogo):
```sql
GRANT EXECUTE ON FUNCTION public.get_margin_with_ads_by_product(UUID, TEXT[], DATE, DATE) TO authenticated;
```

**Diferenças em relação ao análogo:**
- `SECURITY DEFINER` em vez de `SECURITY INVOKER` (padrão das RPCs de consultor — evita truncamento)
- FULL OUTER JOIN em vez de GROUP BY simples (itens ads-only devem aparecer)
- Sem `LIMIT 500` (itens ads-only não aparecem em orders, o FULL JOIN já limita ao universo de itens com ads ou vendas)

---

### `supabase/migrations/*_consultor_config_ads_cols.sql` (migration, DDL)

**Análogo:** `supabase/migrations/20260645000000_consultor_tables.sql` (colunas de consultor_config)

**Padrão de ALTER TABLE para novas colunas com DEFAULT** (replicar convenção das colunas existentes verificadas):

```sql
ALTER TABLE public.consultor_config
  ADD COLUMN IF NOT EXISTS ads_eating_critical_pct NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ads_eating_alert_pct    NUMERIC NOT NULL DEFAULT 10;
```

**Convenção confirmada** de colunas existentes em `consultor_config` (extraídas do RESEARCH.md — verificadas):
- `margin_critical_pct NUMERIC DEFAULT 0` / `margin_alert_pct NUMERIC DEFAULT 10`
- `tacos_alert_pct NUMERIC DEFAULT 15` / `ads_no_sale_days INTEGER DEFAULT 7`
- Padrão: `NUMERIC NOT NULL DEFAULT <valor>` para percentuais; `INTEGER NOT NULL DEFAULT <valor>` para dias

---

### `supabase/functions/consultor-insights/index.ts` (edge function, rule engine)

**Análogo:** o próprio arquivo (modificação)

**Padrão 1 — ConsultorConfig e DEFAULT_CONFIG** (linhas 85-109 do arquivo):

Adicionar ao tipo `ConsultorConfig`:
```typescript
// Após paused_ads_lookback_days (linha 93):
ads_eating_critical_pct: number;
ads_eating_alert_pct: number;
```

Adicionar ao `DEFAULT_CONFIG` (linhas 96-109):
```typescript
// Após paused_ads_lookback_days: 30:
ads_eating_critical_pct: 0,
ads_eating_alert_pct: 10,
```

**Padrão 2 — Estrutura de regra (RULE 1 margin_critical como modelo)** (linhas 178-248):

```typescript
// Estrutura de uma regra — copiar exatamente este molde para ads_eating_margin:
const { data: marginRows, error: marginErr } = await sb.rpc("get_consultor_margin_by_product", {
  p_org_id: orgId,
  p_user_ids: mlUserIds,
  p_from: marginFrom,
  p_to: marginTo,
});

if (!marginErr && marginRows && marginRows.length > 0) {
  const criticalItems = (marginRows as Array<{...}>).filter(...);
  if (criticalItems.length > 0) {
    activeRuleKeys.push("margin_critical");
    candidates.push({
      organization_id: orgId,
      ml_user_id: null,
      ml_user_id_key: "",         // org-level: string vazia
      rule_key: "margin_critical",
      category: "Margem",
      severity: "critical",
      title: `...`,
      body: `... R$ ${fmt(monthlyImpact)}/mês ...`,
      action_label: "Ver anúncios",
      action_href: "/anuncios?items=" + titles.join(","),
      impact_brl: Math.round(monthlyImpact),
      status: "active",
      updated_at: nowIso,
    });
  }
}
```

**Para ads_eating_margin (per-item):** copiar o molde acima com estas diferenças:
- `ml_user_id_key: item.item_id` (string do item — dedup por produto, não org-level)
- Loop `for (const item of criticalAdsItems)` em vez de um único `candidates.push`
- `rule_key: "ads_eating_margin"`
- `category: "Ads"`
- RPC usada: `get_margin_with_ads_by_product` (nova desta fase)

**Padrão 3 — RULE 3 ads_no_sale atual** (linhas 251-291) para entender o que será substituído:

```typescript
// ATUAL (org-level via ml_ads_daily_cache):
const { data: adsNoSaleRows } = await sb
  .from("ml_ads_daily_cache")
  .select("spend, attributed_orders")
  .eq("organization_id", orgId)
  .gte("date", adsNoSaleFrom)
  .lte("date", today);

// dispara quando: totalSpend > 0 AND totalOrders === 0 (conta inteira)
// ml_user_id_key: "" (org-level)
// rule_key: "ads_no_sale"

// NOVO (per-item via ml_ads_products_cache):
const { data: productNoSaleRows } = await sb
  .from("ml_ads_products_cache")
  .select("item_id, spend, attributed_orders, title")
  .eq("organization_id", orgId)
  .gte("date", adsNoSaleFrom)
  .lte("date", today);

// agrupar por item_id no cliente; filtrar spend > 0 AND attributed_orders === 0
// ml_user_id_key: item_id (per-item)
// rule_key: "ads_no_sale" (MANTER O MESMO para auto-resolver insights históricos org-level)
// Decisão D-10: substituir, não complementar
```

**Padrão 4 — Pilar Ads do score** (linhas 778-788) para incluir ads_eating_margin:

```typescript
// ATUAL:
let notaAds = 100;
const hasCampanhaSemVenda = activeRuleKeys.includes("ads_no_sale");
notaAds = clamp(Math.round(100 - tacosOver15 * 5 - (hasCampanhaSemVenda ? 20 : 0)));

// NOVO (adicionar penalidade de ads_eating_margin):
const hasErosaoAds = activeRuleKeys.includes("ads_eating_margin");
notaAds = clamp(Math.round(
  100
  - tacosOver15 * 5
  - (hasCampanhaSemVenda ? 20 : 0)
  - (hasErosaoAds ? 15 : 0)    // penalidade nova
));
```

**Padrão 5 — Upsert idempotente** (linhas 860-893 — não alterar, aplicar automaticamente):

```typescript
// onConflict: "organization_id,rule_key,ml_user_id_key"
// Dismissed insights nunca são re-ativados (T-45-08)
// Para per-item: (org, "ads_eating_margin", "MLB123") é único por produto
```

---

### `src/hooks/useMLMarginWithAds.ts` (hook novo, request-response)

**Análogo:** `src/hooks/useMLMarginAnalysis.ts`

**Padrão de imports** (linhas 1-4 do análogo):

```typescript
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
```

**Padrão de interface de retorno** (linhas 6-34 do análogo — adaptar para ads):

```typescript
export interface ProductMarginWithAds {
  item_id: string;
  titulo: string;
  sku: string | null;
  listing_type: string | null;
  receita: number;
  cmv: number;
  comissao: number;
  frete: number;
  impostos: number;
  lucro: number;              // operacional (sem ads)
  lucro_pct: number | null;   // operacional
  pedidos: number;
  unidades: number;
  has_cmv: boolean;
  ads_spend: number;
  ads_attributed_orders: number;
  lucro_pos_ads: number;
  lucro_pct_pos_ads: number | null;
  ads_no_sale: boolean;
}
```

**Padrão de hook com useQuery** (linhas 44-133 do análogo):

```typescript
export function useMLMarginWithAds(dateFrom: string, dateTo: string) {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();

  return useQuery({
    queryKey: ["ml_margin_with_ads", currentOrg?.id, resolvedMLUserIds, dateFrom, dateTo] as const,
    queryFn: async (): Promise<ProductMarginWithAds[]> => {
      if (!currentOrg?.id || !resolvedMLUserIds.length) return [];
      const { data, error } = await supabase.rpc("get_margin_with_ads_by_product", {
        p_org_id: currentOrg.id,
        p_user_ids: resolvedMLUserIds,
        p_from: dateFrom.substring(0, 10),  // análogo usa .substring(0, 10) — copiar exatamente
        p_to: dateTo.substring(0, 10),
      });
      if (error) throw error;
      return (data ?? []).map((r: Record<string, unknown>) => ({
        item_id:               String(r.item_id),
        titulo:                String(r.titulo ?? ""),
        sku:                   r.sku ? String(r.sku) : null,
        listing_type:          r.listing_type ? String(r.listing_type) : null,
        receita:               Number(r.receita),
        cmv:                   Number(r.cmv),
        comissao:              Number(r.comissao),
        frete:                 Number(r.frete),
        impostos:              Number(r.impostos),
        lucro:                 Number(r.lucro),
        lucro_pct:             r.lucro_pct != null ? Number(r.lucro_pct) : null,
        pedidos:               Number(r.pedidos),
        unidades:              Number(r.unidades),
        has_cmv:               Boolean(r.has_cmv),
        ads_spend:             Number(r.ads_spend),
        ads_attributed_orders: Number(r.ads_attributed_orders),
        lucro_pos_ads:         Number(r.lucro_pos_ads),
        lucro_pct_pos_ads:     r.lucro_pct_pos_ads != null ? Number(r.lucro_pct_pos_ads) : null,
        ads_no_sale:           Boolean(r.ads_no_sale),
      }));
    },
    enabled: !!currentOrg?.id && resolvedMLUserIds.length > 0,
    staleTime: 2 * 60 * 1000,  // análogo usa 2min — copiar exatamente
  });
}
```

**Padrão de coerção de tipos** (linhas 92-103 do análogo — crítico):
O driver Supabase retorna números como strings em alguns casos. O análogo usa `Number(r.campo)` em TODOS os campos numéricos — copiar este padrão sem exceção.

---

### `src/pages/mercadolivre/MLAnuncios.tsx` (modificação, novas colunas)

**Análogo:** o próprio arquivo (linhas 1226-1247 e região de TableBody)

**Padrão de cabeçalho da visão "financeiro"** (linhas 1226-1247):

```tsx
{columnView === "financeiro" ? (
  <>
    <TableHead className="text-xs text-right w-28">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help border-b border-dashed border-muted-foreground/40">Custo</span>
        </TooltipTrigger>
        <TooltipContent className="text-xs max-w-[200px]">...</TooltipContent>
      </Tooltip>
    </TableHead>
    <TableHead className="text-xs text-right w-24">Impostos</TableHead>
    <TableHead className="text-xs text-right w-28">Comissão ML</TableHead>
    <TableHead className="text-xs text-right w-28">Mg. Bruta</TableHead>
    <TableHead className="text-xs text-right w-28">Mg. Líq.</TableHead>
    {/* NOVAS COLUNAS — adicionar após Mg. Líq.: */}
    <TableHead className="text-xs text-right w-28">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help border-b border-dashed border-muted-foreground/40">Mg. Op.</span>
        </TooltipTrigger>
        <TooltipContent className="text-xs max-w-[220px]">
          Margem operacional real (pedidos do período, sem publicidade).
        </TooltipContent>
      </Tooltip>
    </TableHead>
    <TableHead className="text-xs text-right w-28">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help border-b border-dashed border-muted-foreground/40">Mg. Pós-Ads</span>
        </TooltipTrigger>
        <TooltipContent className="text-xs max-w-[220px]">
          Margem após dedução do gasto de publicidade do produto no período.
        </TooltipContent>
      </Tooltip>
    </TableHead>
  </>
) : (...)}
```

**Padrão de célula com Tooltip** (reutilizar `TooltipTrigger`+`TooltipContent` com `cursor-help border-b border-dashed border-muted-foreground/40` — padrão da linha "Custo" e "Impostos").

**Integração do hook:** chamar `useMLMarginWithAds(rankingFrom, rankingTo)` com o mesmo range do ranking existente na página (variáveis `rankingPeriod`/`rankingRange`). Criar um mapa `item_id → ProductMarginWithAds` via `useMemo` para lookup O(1) na TableBody.

---

### `src/pages/MercadoLivre.tsx` (modificação, prop nova)

**Análogo:** o próprio arquivo

**Padrão de adsSpendMes já existente** (linhas 255-258 — não recriar):

```typescript
// JÁ EXISTE — usar diretamente como adsTotalMes:
const adsSpendMes = useMemo(
  () => adsDaily.filter((d) => d.date >= billingMonthFrom && d.date <= billingMonthTo)
    .reduce((s, d) => s + d.spend, 0),
  [adsDaily, billingMonthFrom, billingMonthTo],
);
```

**Padrão de chamada de MLCostCard** (linhas 714-729 — adicionar prop):

```tsx
<MLCostCard
  mesLabel={mesLabel}
  receitaMes={receitaMes}
  gruposTarifas={gruposTarifasEfetivos}
  totalTarifas={totalTarifasEfetivo}
  cmvMes={cmvMes}
  impostosMes={impostosMes}
  adsTotalMes={dreFonte !== "estimado" ? adsSpendMes : null}  // null no estimado (Pitfall 7)
  fonte={dreFonte}
  loading={dreWaterfallLoading}
  ...
/>
```

**Pitfall 7 — duplicação no fallback estimado** (RESEARCH.md §Pitfall 7):
Quando `dreFonte === "estimado"`, `gruposTarifasEfetivos` já inclui "Campanhas de publicidade" com `adsSpendMes` (linha 276 do arquivo). Passar `adsTotalMes={null}` quando `fonte === "estimado"` evita duplicação. A prop `adsTotalMes` em `MLCostCard` deve ser `number | null`.

---

### `src/components/mercadolivre/MLCostCard.tsx` (modificação, nova linha DRE)

**Análogo:** o próprio arquivo

**Padrão de interface de props** (linhas 20-47 — adicionar prop):

```typescript
interface MLCostCardProps {
  // ... props existentes ...
  /** Gasto total de ads do mês (ml_ads_daily_cache). null = não exibir linha (fonte estimado já inclui). */
  adsTotalMes?: number | null;
}
```

**Padrão de linha DRE** (linhas 196-242 — copiar estrutura exata da linha "Impostos próprios"):

```tsx
{/* ── Publicidade (ads ML) ── */}
{adsTotalMes != null && adsTotalMes > 0 && (
  <div className="flex items-center justify-between text-xs py-1">
    <span className="text-muted-foreground flex items-center gap-1">
      <span className="text-muted-foreground/50">(−)</span>
      Publicidade (ads ML)
    </span>
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
        {pct(adsTotalMes, receitaMes)}
      </span>
      <span className="font-semibold tabular-nums w-24 text-right text-foreground">
        {fmt(adsTotalMes)}
      </span>
    </div>
  </div>
)}
```

**Posição no DRE:** inserir entre "Impostos próprios" (linha ~221) e o separador de Lucro (linha ~244).

**Atualização do cálculo de lucro** (linha 68-72):

```typescript
// ATUAL:
const lucro = receitaMes - totalTarifas - (cmvMes ?? 0) - (impostosMes ?? 0);

// NOVO:
const lucro = receitaMes - totalTarifas - (cmvMes ?? 0) - (impostosMes ?? 0) - (adsTotalMes ?? 0);
```

**Classe CSS de valor positivo/negativo:** copiar padrão da linha de "Lucro do mês" (linha 258) para a margem final:
- positivo: `text-kpi-positive`
- negativo: `text-kpi-negative`

---

## Padrões Compartilhados (Cross-cutting)

### Escopo de dados multi-conta
**Fonte:** todos os arquivos de dados existentes  
**Aplicar a:** RPC nova + hook novo + EF

```typescript
// Sempre: organization_id = p_org_id AND ml_user_id = ANY(p_user_ids)
// Nunca filtrar por ml_user_id individual sem organization_id
// Hook: usar resolvedMLUserIds (já inclui todas as contas da org)
```

### PostgREST 1000 linhas — feedback_postgrest_pagination
**Fonte:** `feedback_postgrest_pagination` (confirmado no RESEARCH.md §Pitfall 6)  
**Aplicar a:** RPC nova (SECURITY DEFINER sem LIMIT) + query inline do EF se houver

```sql
-- Na RPC: SECURITY DEFINER + sem LIMIT = sem truncamento
-- No EF (se query inline): usar .range(offset, offset+999) em loop OU usar RPC
```

### Upsert de insights idempotente (T-45-08)
**Fonte:** `supabase/functions/consultor-insights/index.ts` linhas 860-893  
**Aplicar a:** nova RULE ads_eating_margin + RULE 3 upgradada

```typescript
// onConflict: "organization_id,rule_key,ml_user_id_key"
// Dismissed não são re-ativados: filtrar dismissedSet antes de upsert
// Por item: ml_user_id_key = item_id (string)
// Org-level: ml_user_id_key = "" (string vazia)
```

### Coerção de tipos de RPC Supabase
**Fonte:** `src/hooks/useMLMarginAnalysis.ts` linhas 92-103  
**Aplicar a:** hook `useMLMarginWithAds`

```typescript
// Sempre envolver retornos de RPC em Number(), String(), Boolean()
// Nunca assumir que um campo numérico chegou como number
// Campos nullable: r.campo != null ? Number(r.campo) : null
```

### Formato de moeda e percentual no DRE
**Fonte:** `src/components/mercadolivre/MLCostCard.tsx` linhas 7-10

```typescript
const fmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const pct = (v: number, base: number) =>
  base > 0 ? `${((v / base) * 100).toFixed(1)}%` : "—";
```

### Texto de insight em linguagem leiga com R$
**Fonte:** `supabase/functions/consultor-insights/index.ts` linhas 211-213 e 283-284  
**Aplicar a:** nova RULE ads_eating_margin

```typescript
// Padrão: "X produto(s) com Y situação. Você está perdendo ~R$ ${fmt(n)}/mês."
// Usar fmt() do próprio EF (linha 137-139): n.toFixed(0).replace(...)
// Corpo deve citar o item_id ou título e os dois percentuais (operacional → pós-ads)
```

---

## Sem Análogo (arquivo sem par existente)

Nenhum. Todos os arquivos desta fase têm análogos diretos ou são modificações de arquivos existentes.

---

## Metadados

**Escopo de busca de análogos:** `supabase/migrations/`, `supabase/functions/consultor-insights/`, `src/hooks/`, `src/pages/mercadolivre/`, `src/components/mercadolivre/`
**Arquivos lidos:** 7 arquivos de código-fonte
**Data do mapeamento:** 2026-06-14
