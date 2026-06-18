# Phase 49: Fluxo de Caixa (Caixa Real) — Mapa de Padrões

**Mapeado:** 2026-06-18
**Arquivos analisados:** 14 (4 novos no backend, 5 no frontend, 3 migrations, 2 configs)
**Analogs encontrados:** 13 / 14

---

## Classificação de Arquivos

| Arquivo Novo/Modificado | Papel | Fluxo de Dados | Analog Mais Próximo | Qualidade |
|-------------------------|-------|----------------|---------------------|-----------|
| `supabase/functions/sync-mp-releases/index.ts` | edge function | request-response + CRUD (upsert) | `supabase/functions/sync-ads/index.ts` | exact |
| `supabase/migrations/20260618_cash_flow_tables.sql` | migration | DDL + RLS | `supabase/migrations/20260645000000_consultor_tables.sql` | exact |
| `supabase/migrations/20260618_cash_flow_rpcs.sql` | migration | DDL (funções SQL) | `supabase/migrations/20260615120000_margin_with_ads_rpc.sql` | role-match |
| `supabase/migrations/20260618_cash_flow_cron.sql` | migration | pg_cron | `supabase/migrations/20260645020000_pg_cron_consultor.sql` | exact |
| `src/pages/mercadolivre/MLFluxoCaixa.tsx` | page component | request-response | `src/pages/mercadolivre/MLFinanceiro.tsx` | exact |
| `src/components/financial/CashFlowChart.tsx` | component | transform (Recharts) | `src/pages/mercadolivre/MLFinanceiro.tsx` (bloco de gráfico) | role-match |
| `src/components/financial/TodayBalanceCard.tsx` | component | request-response | `src/components/dashboard/KPICard.tsx` (via MLFinanceiro) | role-match |
| `src/components/financial/ProjectedBalanceCard.tsx` | component | request-response | `src/components/dashboard/KPICard.tsx` (via MLFinanceiro) | role-match |
| `src/components/financial/CapacityCard.tsx` | component | transform (client-side) | `src/components/dashboard/KPICard.tsx` (via MLFinanceiro) | role-match |
| `src/hooks/useCashFlowData.ts` | hook | CRUD (RPC) | `src/hooks/useMLMarginAnalysis.ts` | exact |
| `src/hooks/useTodayBalance.ts` | hook | CRUD (RPC) | `src/hooks/useMLCostWaterfall.ts` | exact |
| `src/hooks/useProjectedBalance.ts` | hook | CRUD (RPC) | `src/hooks/useMLCostWaterfall.ts` | exact |
| `src/hooks/useFinancialHealth.ts` | hook | transform (client-side) | `src/hooks/useMLCostWaterfall.ts` | role-match |
| `src/hooks/useFinancialSettings.ts` | hook | CRUD (select direto) | `src/hooks/useMLCostWaterfall.ts` | role-match |
| `src/components/layout/ApiSidebar.tsx` *(modificar)* | config | — | si mesmo | exact |
| `src/App.tsx` *(modificar)* | routing | — | si mesmo | exact |
| `src/config/roleAccess.ts` *(modificar)* | config | — | si mesmo | exact |

---

## Atribuições de Padrão por Arquivo

---

### `supabase/functions/sync-mp-releases/index.ts` (edge function, CRUD upsert)

**Analog:** `supabase/functions/sync-ads/index.ts`

**Padrão de imports e setup** (linhas 9–17 de sync-ads):
```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL     = (Deno.env.get("SUPABASE_URL") ?? "").trim();
const SERVICE_KEY      = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
const ML_API           = "https://api.mercadolibre.com";
// Para a EF de liberações, acrescentar:
const MP_API           = "https://api.mercadopago.com";
```

**Guard de auth (service role only)** (linhas 46–57 de sync-ads):
```typescript
function requireServiceRole(req: Request): Response | null {
  if (!SERVICE_KEY) return null;
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== "Bearer " + SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  return null;
}
```

**Lookup de token ML por ml_user_id com refresh automático** (linhas 61–104 de sync-ads):
```typescript
async function getAccessToken(sb: any, mlUserId: string): Promise<string> {
  const { data: row } = await sb
    .from("ml_tokens")
    .select("access_token,refresh_token,expires_at")
    .eq("ml_user_id", mlUserId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) throw new Error("No ML token for ml_user_id=" + mlUserId);

  const expiresTs = row.expires_at ? new Date(row.expires_at).getTime() / 1000 : 0;
  const now       = Date.now() / 1000;
  if (row.access_token && expiresTs - now > 300) return row.access_token;
  // ... refresh flow se expirado
}
```

**Padrão de fetch com retry** (linhas 132–142 de sync-ads):
```typescript
async function mlGet(url: string, token: string): Promise<any> {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, {
      headers: { Authorization: "Bearer " + token, "api-version": "2" },
    });
    if (res.ok) return res.json();
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? "2");
      await new Promise(r => setTimeout(r, wait * 1000));
      continue;
    }
    throw new Error(`HTTP ${res.status}`);
  }
}
```
> Para a EF sync-mp-releases: substituir `ML_API` por `MP_API` (`https://api.mercadopago.com`) e endpoint `/v1/payments/search`. O token é o **mesmo** de `ml_tokens` — o OAuth ML funciona para as duas APIs na mesma conta.

**Padrão de paginação** (linhas 97–124 de sync-ml-orders, adaptado):
```typescript
// Paginação por offset até total — mesma lógica de fetchOrdersPage
let offset = 0;
while (true) {
  const data = await mpGet(
    `/v1/payments/search?sort=money_release_date&criteria=asc` +
    `&range=money_release_date&begin_date=${beginDate}&end_date=${endDate}` +
    `&limit=100&offset=${offset}`,
    accessToken
  );
  const results = data.results ?? [];
  records.push(...results);
  offset += results.length;
  if (results.length < 100 || offset >= data.paging.total) break;
  await new Promise(r => setTimeout(r, 300)); // rate limit
}
```

**Upsert com conflito por chave única** (padrão de sync-ml-orders):
```typescript
await supabase
  .from("cash_inflows")
  .upsert(records, { onConflict: "organization_id,payment_id" });
```

---

### `supabase/migrations/20260618_cash_flow_tables.sql` (migration, DDL + RLS)

**Analog:** `supabase/migrations/20260645000000_consultor_tables.sql`

**Cabeçalho e comentário padrão** (linhas 1–35 de consultor_tables.sql):
```sql
-- ============================================================
-- Phase 49 Fluxo de Caixa — Tabelas de dados de caixa real
-- ============================================================
-- Supabase project: ckcdevcxgvueywivefgx (NÃO usar gionpsuunfkkzzjdubfy).
-- Idempotente: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS antes de recriar.
```

**Estrutura de CREATE TABLE com FK para organizations** (linhas 41–64 de consultor_tables.sql):
```sql
CREATE TABLE IF NOT EXISTS public.insights (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- ... demais colunas
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
```

**Padrão de RLS org-first com `is_org_member`** (linhas 90–115 de consultor_tables.sql):
```sql
ALTER TABLE public.cash_inflows ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "cash_inflows_select" ON public.cash_inflows';
END $$;

-- SELECT: qualquer membro da org pode ler
CREATE POLICY "cash_inflows_select"
  ON public.cash_inflows
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- INSERT/UPDATE/DELETE: service role only (EF escreve; service role ignora RLS).
-- Nenhuma policy de escrita para 'authenticated'.
```

> Atenção: em `consultor_tables.sql` a ordem dos parâmetros de `is_org_member` é `(auth.uid(), organization_id)` — **uid primeiro, org segundo**. Manter essa ordem.

**UNIQUE constraint via DO/EXCEPTION** (padrão do codebase para idempotência):
```sql
DO $$ BEGIN
  ALTER TABLE public.cash_inflows
    ADD CONSTRAINT cash_inflows_unique_payment UNIQUE (organization_id, payment_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
```

---

### `supabase/migrations/20260618_cash_flow_rpcs.sql` (migration, funções SQL)

**Analog:** `supabase/migrations/20260615120000_margin_with_ads_rpc.sql`

**Cabeçalho padrão de RPC** (padrão observado em todas as migrations de RPC):
```sql
-- ── RPC get_cashflow ───────────────────────────────────────────────────────────
-- SECURITY INVOKER obrigatório: RLS em cash_inflows/cash_outflows é o guard real.
-- DEFINER + p_org_id por parâmetro = IDOR (bypass de RLS).

CREATE OR REPLACE FUNCTION public.get_cashflow(
  p_org_id     UUID,
  p_start_date DATE,
  p_end_date   DATE
)
RETURNS TABLE (...)
LANGUAGE plpgsql
SECURITY INVOKER          -- NUNCA DEFINER
SET search_path = 'public'
AS $$
```

**Padrão de REVOKE EXECUTE em RPCs de tenant** (de `20260645011000_consultor_rpcs_revoke_public_execute.sql`):
```sql
REVOKE EXECUTE ON FUNCTION public.get_cashflow(UUID, DATE, DATE) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_cashflow(UUID, DATE, DATE) TO authenticated;
```

---

### `supabase/migrations/20260618_cash_flow_cron.sql` (migration, pg_cron)

**Analog:** `supabase/migrations/20260645020000_pg_cron_consultor.sql`

**Padrão Pattern B completo** (linhas 31–53 de pg_cron_consultor.sql):
```sql
DO $$ BEGIN
  PERFORM cron.unschedule('sync-mp-releases-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'sync-mp-releases-daily',
  '30 7 * * *',           -- 07:30 UTC = 04:30 BRT (antes do relatório das 07:03)
  $cmd$
    SELECT net.http_post(
      url     := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/sync-mp-releases',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'service_role_key' LIMIT 1
        )
      ),
      body    := '{}'::jsonb
    ) AS request_id;
  $cmd$
);
```

> **Pré-requisito obrigatório (Pattern B):** `vault.secrets` deve ter uma linha `WHERE name = 'service_role_key'` com o valor `sb_secret_*` (não o JWT legado). Verificar antes de aplicar: `SELECT name FROM vault.secrets WHERE name = 'service_role_key';`

---

### `src/pages/mercadolivre/MLFluxoCaixa.tsx` (page component, request-response)

**Analog:** `src/pages/mercadolivre/MLFinanceiro.tsx`

**Padrão de imports** (linhas 1–45 de MLFinanceiro.tsx):
```typescript
import { useState, useMemo, useEffect, useCallback } from "react";
import { ComposedChart, /* ... */ ResponsiveContainer } from "recharts";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { TrendingUp, AlertTriangle, /* ... */ } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import { KPICard } from "@/components/dashboard/KPICard";
import { useOrganization } from "@/contexts/OrganizationContext";
```

**Estrutura do componente de página** (padrão MLFinanceiro.tsx):
```typescript
export default function MLFluxoCaixa() {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  // hooks de dados
  const cashFlow  = useCashFlowData(orgId, startDate, endDate);
  const today     = useTodayBalance(orgId);
  const projected = useProjectedBalance(orgId);
  const health    = useFinancialHealth(orgId);

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <MLPageHeader title="Fluxo de Caixa" />
      {/* 3 cards KPI */}
      {/* gráfico */}
    </div>
  );
}
```

**Padrão de Skeleton/loading** (MLFinanceiro.tsx — padrão de loading states):
```typescript
if (cashFlow.isLoading) {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28" />)}
      </div>
      <Skeleton className="h-72 w-full" />
    </div>
  );
}
```

**Padrão de tooltip customizado no gráfico Recharts** (linhas 54–88 de MLFinanceiro.tsx):
```typescript
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-lg text-xs space-y-1.5 min-w-[180px]">
      <p className="font-semibold text-foreground mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: p.stroke ?? p.fill }} />
            <span className="text-muted-foreground">{p.name}</span>
          </span>
          <span className="font-medium tabular-nums">{currFmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
};
```

**Helper de formatação de moeda** (MLFinanceiro.tsx linha 49):
```typescript
const currFmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
```

---

### `src/components/financial/CashFlowChart.tsx` (component, Recharts ComposedChart)

**Analog:** Bloco Recharts de `src/pages/mercadolivre/MLFinanceiro.tsx` + referência `/tmp/nexointeligence/src/components/financial/CashFlowChart.tsx`

**Imports Recharts** (MLFinanceiro.tsx linhas 2–11):
```typescript
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
```

> Para o CashFlowChart, substituir `Bar` por `Area` (gráfico de linha com área preenchida, como no nexointeligence). Estrutura do ComposedChart com 2 linhas (real/pessimista + projetada/realista):
```typescript
<ResponsiveContainer width="100%" height={300}>
  <ComposedChart data={data}>
    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
    <YAxis tickFormatter={currFmt} tick={{ fontSize: 11 }} />
    <RechartsTooltip content={<CustomTooltip />} />
    <Line
      type="monotone"
      dataKey="accumulated_balance"
      name="Real (Pessimista)"
      stroke="var(--kpi-positive)"
      dot={false}
      strokeWidth={2}
    />
    <Line
      type="monotone"
      dataKey="projected_balance"
      name="Projetado (Realista)"
      stroke="var(--kpi-neutral)"
      strokeDasharray="5 5"
      dot={false}
      strokeWidth={2}
    />
  </ComposedChart>
</ResponsiveContainer>
```

---

### `src/hooks/useCashFlowData.ts` (hook, RPC)

**Analog:** `src/hooks/useMLMarginAnalysis.ts`

**Padrão completo de hook com RPC** (linhas 44–75 de useMLMarginAnalysis.ts):
```typescript
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";

export function useCashFlowData(startDate: string, endDate: string) {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery({
    queryKey: ["cashflow", orgId, startDate, endDate] as const,
    enabled: !!orgId,
    queryFn: async () => {
      if (!orgId) return [];

      const { data, error } = await supabase.rpc("get_cashflow", {
        p_org_id:     orgId,
        p_start_date: startDate.substring(0, 10),
        p_end_date:   endDate.substring(0, 10),
      });

      if (error) throw error;
      return data ?? [];
    },
  });
}
```

> Diferença do nexointeligence: usar `useOrganization()` para obter `orgId` (não `useUserPermissions()`). Não há lookup direto em `organization_members` — o contexto já resolve.

---

### `src/hooks/useTodayBalance.ts` e `src/hooks/useProjectedBalance.ts` (hooks, RPC)

**Analog:** `src/hooks/useMLCostWaterfall.ts`

**Padrão de hook RPC com dado único** (linhas 27–58 de useMLCostWaterfall.ts):
```typescript
import { useQuery } from "@tanstack/react-query";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";

export function useTodayBalance() {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery({
    queryKey: ["cashflow", "today_balance", orgId] as const,
    enabled: !!orgId,
    queryFn: async () => {
      if (!orgId) return null;

      const today = new Date().toISOString().substring(0, 10);
      const { data, error } = await supabase.rpc("get_daily_balance", {
        p_org_id:      orgId,
        p_target_date: today,
      });

      if (error) throw error;
      const r = data?.[0];
      if (!r) return null;
      return {
        saldo_inicial:        Number(r.saldo_inicial),
        entradas_hoje:        Number(r.entradas_hoje),
        saidas_hoje:          Number(r.saidas_hoje),
        saldo_final_previsto: Number(r.saldo_final_previsto),
      };
    },
  });
}
```

---

### `src/hooks/useFinancialHealth.ts` (hook, client-side transform)

**Analog:** `src/hooks/useMLCostWaterfall.ts` (padrão de hook), lógica do nexointeligence `useFinancialHealth.ts`

**Padrão de derivação client-side** (a partir dos outros hooks):
```typescript
export function useFinancialHealth() {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery({
    queryKey: ["cashflow", "financial_health", orgId] as const,
    enabled: !!orgId,
    queryFn: async () => {
      if (!orgId) return null;
      // Lógica: capacidade = saldo_atual + entradas_30d + sma_23d - saidas_30d - safety_margin
      // Fontes: cash_inflows, cash_outflows, ml_daily_cache (SMA), financial_settings
      // Status: SAFE se capacidade > 0, DANGER se <= 0
    },
  });
}
```

---

### `src/hooks/useFinancialSettings.ts` (hook, select direto)

**Analog:** `src/hooks/useMLCostWaterfall.ts`

```typescript
export function useFinancialSettings() {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery({
    queryKey: ["financial_settings", orgId] as const,
    enabled: !!orgId,
    queryFn: async () => {
      if (!orgId) return null;
      // Select direto é seguro aqui: financial_settings tem 1 linha por org (sem risco de truncamento)
      const { data, error } = await supabase
        .from("financial_settings")
        .select("*")
        .eq("organization_id", orgId)
        .maybeSingle();
      if (error) throw error;
      return data ?? { initial_balance: 0, operational_cost_rate: 0.22, safety_margin: 10000 };
    },
  });
}
```

---

### `src/components/layout/ApiSidebar.tsx` *(modificar)*

**Arquivo:** `src/components/layout/ApiSidebar.tsx`

**Estado atual do grupo "Operações"** (linhas 39–50 de ApiSidebar.tsx):
```typescript
{
  icon: Layers,
  label: "Operações",
  path: "/estoque",
  noSelfLink: true,
  children: [
    { icon: ShoppingBag,   label: "Anúncios",    path: "/anuncios"     },
    { icon: Package,       label: "Estoque",     path: "/estoque"      },
    { icon: ClipboardList, label: "Pedidos",     path: "/pedidos"      },
    { icon: Calculator,    label: "Precificação", path: "/precificacao" },
  ],
},
```

**Modificação necessária** — adicionar ao array `children`:
```typescript
// Acrescentar após Precificação:
{ icon: Banknote, label: "Fluxo de Caixa", path: "/fluxo-de-caixa" },
```
Adicionar `Banknote` ao bloco de imports do lucide-react na linha 1.

---

### `src/App.tsx` *(modificar)*

**Padrão de rota lazy + RoleRoute** (linhas 31–125 de App.tsx):
```typescript
// 1. Adicionar import lazy (junto com os outros):
const MLFluxoCaixa = React.lazy(() => import("./pages/mercadolivre/MLFluxoCaixa"));

// 2. Adicionar rota (dentro do bloco de ProtectedRoute + Suspense):
<Route path="/fluxo-de-caixa" element={
  <RoleRoute>
    <ErrorBoundary fallbackTitle="Erro no Fluxo de Caixa">
      <MLFluxoCaixa />
    </ErrorBoundary>
  </RoleRoute>
} />
```

---

### `src/config/roleAccess.ts` *(modificar)*

**Estado atual de `roleAccess`** (linhas 10–28 de roleAccess.ts):
```typescript
export const roleAccess: Record<string, OrgRole[]> = {
  // ...
  "/pedidos": OPERATIONAL,
  "/precificacao": OPERATIONAL,
  // ...
};
```

**Modificação necessária**:
```typescript
// Acrescentar ao mapa roleAccess:
"/fluxo-de-caixa": OPERATIONAL,  // owner/admin/member

// Acrescentar ao array VIEWER_ELIGIBLE_ROUTES (opcional — decisão de produto):
// { path: "/fluxo-de-caixa", label: "Fluxo de Caixa" },
```

---

## Padrões Compartilhados

### Autenticação / guard multi-tenant
**Fonte:** `supabase/migrations/20260645000000_consultor_tables.sql` linhas 97–111
**Aplicar a:** todas as tabelas novas (`cash_inflows`, `cash_outflows`, `financial_settings`)
```sql
CREATE POLICY "<tabela>_select"
  ON public.<tabela>
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));
-- Ordem dos parâmetros: uid PRIMEIRO, organization_id SEGUNDO.
```

### SECURITY INVOKER em RPCs de tenant
**Fonte:** feedback_supabase_security_invoker.md (memória do projeto)
**Aplicar a:** `get_cashflow`, `get_daily_balance`, `get_projected_balance_summary`
```sql
CREATE OR REPLACE FUNCTION public.get_cashflow(...)
LANGUAGE plpgsql
SECURITY INVOKER          -- NUNCA DEFINER (DEFINER + p_org_id = IDOR)
SET search_path = 'public'
```

### pg_cron Pattern B (service_role_key via vault)
**Fonte:** `supabase/migrations/20260645020000_pg_cron_consultor.sql` + `20260614122500_tenant03_fix_sync_cron_pattern_b.sql`
**Aplicar a:** `20260618_cash_flow_cron.sql`
```sql
headers := jsonb_build_object(
  'Content-Type',  'application/json',
  'Authorization', 'Bearer ' || (
    SELECT decrypted_secret FROM vault.decrypted_secrets
    WHERE name = 'service_role_key' LIMIT 1
  )
)
-- Pré-requisito: vault.secrets tem linha WHERE name = 'service_role_key' com valor sb_secret_*
```

### Token ML (mesmo para API Mercado Pago)
**Fonte:** `supabase/functions/sync-ads/index.ts` linhas 61–104
**Aplicar a:** `sync-mp-releases/index.ts`
```typescript
// O mesmo access_token de ml_tokens serve para https://api.mercadopago.com
// (MP e ML usam o mesmo OAuth na mesma conta seller).
// Usar getAccessToken() idêntica ao sync-ads.
// Base URL muda para MP_API = "https://api.mercadopago.com"
// Endpoint: /v1/payments/search (não /orders/search)
```

### Hook com useOrganization (não lookup direto em organization_members)
**Fonte:** `src/hooks/useMLMarginAnalysis.ts` linhas 46–47, `src/hooks/useMLCostWaterfall.ts` linhas 29–31
**Aplicar a:** todos os hooks novos (`useCashFlowData`, `useTodayBalance`, `useProjectedBalance`, `useFinancialHealth`, `useFinancialSettings`)
```typescript
const { currentOrg } = useOrganization();
const orgId = currentOrg?.id ?? null;
// NÃO fazer query direta em organization_members como o nexointeligence faz —
// o contexto garment já resolve o orgId.
```

### Paginação via RPC (não select direto para volumes altos)
**Fonte:** feedback_postgrest_pagination.md (memória do projeto)
**Aplicar a:** `useCashFlowData`, `useTodayBalance`, `useProjectedBalance`
```typescript
// CORRETO: RPC retorna o conjunto completo sem truncamento
const { data } = await supabase.rpc("get_cashflow", { ... });

// ERRADO: select direto trunca em 1000 linhas
// const { data } = await supabase.from("cash_inflows").select("*"); // NÃO USAR
```

### Formatação de moeda pt-BR
**Fonte:** `src/pages/mercadolivre/MLFinanceiro.tsx` linha 49
**Aplicar a:** `CashFlowChart.tsx`, `TodayBalanceCard.tsx`, `ProjectedBalanceCard.tsx`, `CapacityCard.tsx`
```typescript
const currFmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
```

---

## Sem Analog no Codebase

| Arquivo | Papel | Fluxo de Dados | Motivo |
|---------|-------|----------------|--------|
| (nenhum) | — | — | Todos os arquivos da fase têm analog direto no garment ou no nexointeligence (referência canônica) |

Os RPCs `get_cashflow`, `get_daily_balance` e `get_projected_balance_summary` não têm equivalente SQL no garment, mas o SQL completo foi extraído do nexointeligence e documentado no RESEARCH.md — o planner deve usar aquele SQL como fonte primária, adaptando apenas `transactions` → `cash_inflows`/`cash_outflows`.

---

## Metadados

**Escopo de busca:** `supabase/functions/`, `supabase/migrations/`, `src/pages/mercadolivre/`, `src/hooks/`, `src/components/layout/`, `src/config/`
**Arquivos escaneados:** 24
**Data do mapeamento:** 2026-06-18
