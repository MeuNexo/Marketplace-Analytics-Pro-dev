# Phase 45: Consultor v1 - Pattern Map

**Mapped:** 2026-06-14
**Files analyzed:** 9 (2 migrations SQL + 1 pg_cron migration + 1 EF + 1 hook + 2 components + 1 page modification + 1 route entry)
**Analogs found:** 9 / 9

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `supabase/migrations/20260645_consultor_tables.sql` | migration | CRUD | `supabase/migrations/20260614123000_tenant04_onboarding_progress.sql` | exact |
| `supabase/migrations/20260645_pg_cron_consultor.sql` | migration | event-driven | `supabase/migrations/20260614110000_pg_cron_questions_claims.sql` | exact |
| `supabase/functions/consultor-insights/index.ts` | service (EF) | batch + CRUD | `supabase/functions/sync-ml-claims/index.ts` (auth service role) + `supabase/functions/sync-ml-inventory/index.ts` (auth dual) | exact (dual) |
| `src/hooks/useConsultorInsights.ts` | hook | request-response + on-demand | `src/hooks/useMLBilling.ts` (`useMLBillingWithSync`) | exact |
| `src/components/mercadolivre/ConsultorCard.tsx` | component | request-response | `src/components/onboarding/OnboardingBanner.tsx` + `src/components/dashboard/KPICard.tsx` | role-match |
| `src/pages/mercadolivre/MLConsultor.tsx` | page | request-response | `src/pages/MercadoLivre.tsx` (estrutura) | role-match |
| `src/pages/MercadoLivre.tsx` (modificação) | page | request-response | si mesmo (inserir após `<OnboardingBanner>`) | self |

---

## Pattern Assignments

### `supabase/migrations/20260645_consultor_tables.sql` (migration, CRUD)

**Analog:** `supabase/migrations/20260614123000_tenant04_onboarding_progress.sql`

**Estrutura de migration RLS org-first** (linhas 1-66 do analog):

```sql
-- Idempotência: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS antes de recriar.
CREATE TABLE IF NOT EXISTS public.<table> (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  ...
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "sel" ON public.<table>';
  EXECUTE 'DROP POLICY IF EXISTS "wrt" ON public.<table>';
END $$;

-- SELECT: qualquer membro da org lê
CREATE POLICY "sel"
  ON public.<table>
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- WRITE: owner only ou service role
CREATE POLICY "wrt"
  ON public.<table>
  FOR ALL
  TO authenticated
  USING  (public.get_org_role(auth.uid(), organization_id) = 'owner'::public.org_role)
  WITH CHECK (public.get_org_role(auth.uid(), organization_id) = 'owner'::public.org_role);
```

**Diferenças para as 3 novas tabelas:**

- `insights`: SELECT = `is_org_member`; UPDATE (dismiss) = `is_org_member`; INSERT/DELETE = service role only (sem policy `authenticated`). Usar índice único funcional separado para dedup (não constraint inline com COALESCE — ver Pitfall 7 do RESEARCH.md):
  ```sql
  CREATE UNIQUE INDEX insights_dedup_idx
    ON public.insights (organization_id, rule_key, COALESCE(ml_user_id, ''));
  ```
- `consultor_config`: SELECT = `is_org_member`; ALL = `get_org_role = 'owner'`.
- `consultor_health_snapshots`: SELECT = `is_org_member`; INSERT/UPDATE = service role only.

**Constraint idempotente via DO/EXCEPTION** (padrão do analog, linhas 37-43):

```sql
DO $$ BEGIN
  ALTER TABLE public.<table>
    ADD CONSTRAINT <name> CHECK (...);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
```

---

### `supabase/migrations/20260645_pg_cron_consultor.sql` (migration, event-driven)

**Analog:** `supabase/migrations/20260614110000_pg_cron_questions_claims.sql`

**Pattern B — unschedule idempotente + schedule com vault** (linhas 23-44 do analog):

```sql
-- Sempre unschedule antes (idempotente — não lança exceção se não existe)
DO $$ BEGIN
  PERFORM cron.unschedule('consultor-insights-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'consultor-insights-daily',
  '30 8 * * *',   -- 08:30 UTC = após sync principal 07:03 + scores 07:30
  $cmd$
    SELECT net.http_post(
      url     := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/consultor-insights',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'service_role_key' LIMIT 1
        )
      ),
      body    := '{"mode":"all_orgs"}'::jsonb
    ) AS request_id;
  $cmd$
);
```

**CRÍTICO:** O token no vault tem name = `service_role_key` e é do tipo `sb_secret_*` (não JWT legacy). Verificar antes de aplicar:
```sql
SELECT name FROM vault.secrets WHERE name = 'service_role_key';
```

---

### `supabase/functions/consultor-insights/index.ts` (EF Deno, batch + CRUD)

**Analogs combinados:**
- Auth service-role only: `supabase/functions/sync-ml-claims/index.ts` (linhas 45-62)
- Auth dual (service role + user JWT): `supabase/functions/sync-ml-inventory/index.ts` (linhas 60-92)
- Loop por org + upsert: `supabase/functions/sync-ml-claims/index.ts` (linhas 264-299)
- Token refresh + ml_tokens lookup: `supabase/functions/sync-ml-claims/index.ts` (linhas 66-110)

**Imports e boilerplate** (padrão sync-ml-claims linhas 18-40):

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").trim();
const SERVICE_KEY  = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
```

**Auth dual — cron (service role) + on-demand (user JWT)** — adaptar de `sync-ml-inventory/index.ts` linhas 60-92:

```typescript
// Retorna: { userId: null } = service role autenticado
//          { userId: string } = user JWT válido
//          { error: Response } = não autorizado
async function authenticate(req: Request): Promise<{ error: Response } | { userId: string | null }> {
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!svcKey) return { userId: null }; // dev local

  const auth = req.headers.get("authorization") ?? "";

  // Form 1: service role key (cron)
  if (auth === "Bearer " + svcKey) return { userId: null };

  // Form 2: Bearer user JWT (on-demand frontend)
  if (auth.startsWith("Bearer ")) {
    const sb = createClient(SUPABASE_URL, svcKey);
    const { data: authData } = await sb.auth.getUser(auth.replace("Bearer ", ""));
    if (authData?.user?.id) return { userId: authData.user.id };
  }

  return { error: json({ error: "Unauthorized" }, 401) };
}
```

**Distinção de modo por auth** (adaptado da lógica de sync-ml-inventory linhas 164-175):

```typescript
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const authResult = await authenticate(req);
  if ("error" in authResult) return authResult.error;

  let body: { mode?: string };
  try { body = await req.json(); } catch { body = {}; }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  if (authResult.userId === null) {
    // Cron: iterar todas as orgs
    // mode = 'all_orgs'
  } else {
    // Frontend on-demand: só a org do usuário autenticado
    // mode = 'org_only'
    const { data: member } = await sb.rpc("is_org_member", {
      _user_id: authResult.userId, _org_id: orgId,
    });
    if (!member) return json({ error: "Forbidden" }, 403);
  }
});
```

**Loop por org com error isolation** (padrão sync-ml-claims linhas 282-299):

```typescript
const results: any[] = [];
for (const org of orgs) {
  try {
    const result = await runConsultorForOrg(sb, org.organization_id);
    results.push({ organization_id: org.organization_id, ...result });
  } catch (e: any) {
    console.error("consultor-insights org=" + org.organization_id + " error:", e.message);
    results.push({ organization_id: org.organization_id, error: e.message });
  }
}
return json({ ok: true, results });
```

**Upsert idempotente de insights** (padrão de upsert de sync-ml-claims linhas 247-259):

```typescript
// Para cada insight candidato gerado pelas regras:
const { error } = await sb
  .from("insights")
  .upsert(candidates, {
    onConflict: "organization_id,rule_key,ml_user_id_key", // coluna helper ou índice funcional
  });
// Para insights ativos cujas condições NÃO dispararam → auto-resolver:
await sb
  .from("insights")
  .update({ status: "resolved", resolved_at: new Date().toISOString() })
  .eq("organization_id", orgId)
  .eq("status", "active")
  .not("rule_key", "in", `(${activeRuleKeys.map(k => `"${k}"`).join(",")})`);
```

**Lookup de ml_tokens por org** (padrão de sync-ml-claims linhas 272-280):

```typescript
const { data: tokenRows } = await sb
  .from("ml_tokens")
  .select("ml_user_id, user_id, organization_id")
  .not("refresh_token", "is", null);
// Para org específica: adicionar .eq("organization_id", orgId)
```

**config.toml** (adicionar entrada):

```toml
[functions.consultor-insights]
verify_jwt = false
```

---

### `src/hooks/useConsultorInsights.ts` (hook, request-response + on-demand)

**Analog:** `src/hooks/useMLBilling.ts` — padrão `useMLBillingWithSync` (linhas 213-255)

**Imports padrão de hook React Query** (de `src/hooks/useMLQuestions.ts` linhas 1-4):

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, useEffect } from "react";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
```

**Leitura org-scoped com React Query** (padrão de `useMLQuestions.ts` linhas 36-57):

```typescript
export function useConsultorInsights() {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  const query = useQuery<InsightRow[]>({
    queryKey: ["consultor_insights", orgId],
    enabled: !!orgId,
    staleTime: 4 * 60 * 60 * 1000, // 4h — cron roda diário
    queryFn: async (): Promise<InsightRow[]> => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("insights")
        .select("*")
        .eq("organization_id", orgId)
        .in("status", ["active"])
        .order("severity", { ascending: true }) // critical < high < medium
        .order("impact_brl", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as InsightRow[];
    },
  });
  ...
}
```

**On-demand invoke quando stale** — adaptar de `useMLBillingWithSync` (linhas 221-254):

```typescript
const [syncing, setSyncing] = useState(false);
const attempted = useRef(false);

useEffect(() => {
  if (query.isLoading || (query.data && query.data.length > 0) || !orgId) return;
  if (attempted.current) return;
  attempted.current = true;

  let cancelled = false;
  setSyncing(true);
  supabase.functions
    .invoke("consultor-insights", { body: { mode: "org_only" } })
    .then(() => { if (!cancelled) return query.refetch(); })
    .finally(() => { if (!cancelled) setSyncing(false); });

  return () => { cancelled = true; };
}, [query.isLoading, query.data, orgId, query.refetch]);
```

**Mutation de dismiss** (padrão de `useOnboardingProgress.ts` completeMutation linhas 160-188):

```typescript
const queryClient = useQueryClient();
const dismissMutation = useMutation({
  mutationFn: async (insightId: string) => {
    const { error } = await supabase
      .from("insights")
      .update({ status: "dismissed", dismissed_at: new Date().toISOString() })
      .eq("id", insightId)
      .eq("organization_id", orgId);
    if (error) throw error;
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["consultor_insights", orgId] });
  },
});
```

---

### `src/components/mercadolivre/ConsultorCard.tsx` (component, request-response)

**Analogs:**
- Estrutura de card com `Card`/`CardContent`: `src/components/onboarding/OnboardingBanner.tsx` (linhas 33-65)
- Variantes de cor por status (`success`/`warning`/`danger`): `src/components/dashboard/KPICard.tsx` (linhas 33-42)
- Ícones lucide-react de severidade: padrão do projeto (`AlertTriangle`, `XCircle`, `Info`)

**Imports do componente** (padrão de OnboardingBanner linhas 1-8):

```typescript
import { AlertTriangle, XCircle, Info, ArrowRight, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { InsightRow, HealthScore } from "@/hooks/useConsultorInsights";
```

**Score com token `kpi.positive/negative/neutral`** — padrão de `KPICard.tsx` variantes (linhas 33-42):

```tsx
// As 3 faixas do score (D-10) mapeiam para variantes/tokens existentes:
// 75-100 → variant="success"  / text-[hsl(var(--kpi-positive))]
// 50-74  → variant="warning"  / text-[hsl(var(--kpi-neutral))]
// 0-49   → variant="danger"   / text-[hsl(var(--kpi-negative))]

const scoreVariant = score >= 75 ? "success" : score >= 50 ? "warning" : "danger";
const scoreLabel   = score >= 75 ? "Saudável" : score >= 50 ? "Atenção" : "Crítico";
```

**Estrutura base do card** (padrão de OnboardingBanner linhas 34-65):

```tsx
export function ConsultorCard({ insights, score, syncing, onDismiss }: ConsultorCardProps) {
  return (
    <Card className="border-primary/20 shadow-[var(--shadow-glow)]">
      <CardContent className="flex flex-col gap-3 py-3">
        {/* Score de saúde no topo */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold">Saúde do negócio</span>
          </div>
          <Badge variant={scoreVariant === "success" ? "default" : "destructive"}>
            {score} — {scoreLabel}
          </Badge>
        </div>
        {/* Top 3 insights */}
        {topInsights.map((insight) => (
          <InsightRow key={insight.id} insight={insight} onDismiss={onDismiss} />
        ))}
        {/* Link painel completo */}
        <Button variant="ghost" size="sm" asChild>
          <Link to="/consultor">Ver todos <ArrowRight className="h-4 w-4 ml-1" /></Link>
        </Button>
      </CardContent>
    </Card>
  );
}
```

---

### `src/pages/mercadolivre/MLConsultor.tsx` (page, request-response)

**Analog:** `src/pages/MercadoLivre.tsx` (estrutura de página com React Query hook + render condicional)

**Estrutura de página padrão** (padrão de MercadoLivre.tsx linhas 1-48):

```typescript
// Imports seguem a ordem: React, aliases @/, contextos, hooks, componentes, ícones
import { useMemo } from "react";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useConsultorInsights } from "@/hooks/useConsultorInsights";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, XCircle, Info } from "lucide-react";

export default function MLConsultor() {
  const { currentOrg } = useOrganization();
  const { data: insights = [], isLoading, syncing, dismiss } = useConsultorInsights();
  ...
}
```

---

### `src/pages/MercadoLivre.tsx` (modificação — inserir ConsultorCard)

**Ponto de inserção** (linhas 97-99 do arquivo atual):

```tsx
// Linha 98: const { isComplete: onboardingComplete } = useOnboardingProgress();
// Linha 99: const [onboardingWizardOpen, ...

// Na JSX: após <OnboardingBanner ... /> e antes de <MLPeriodPicker ...>
// O padrão exato é o mesmo do OnboardingBanner (condicional + componente):
{onboardingComplete && <ConsultorCard ... />}
```

---

## Shared Patterns

### Auth dual na EF (service role + user JWT)

**Source principal:** `supabase/functions/sync-ml-inventory/index.ts` linhas 60-92

```typescript
async function authenticate(req: Request): Promise<{ error: Response } | { userId: string | null }> {
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!svcKey) return { userId: null }; // dev local — skip guard

  const auth = req.headers.get("authorization") ?? "";

  // Form 1: service role key
  if (auth === "Bearer " + svcKey) return { userId: null };

  // Form 2: Bearer user JWT (frontend on-demand)
  if (auth.startsWith("Bearer ") && auth !== "Bearer " + svcKey) {
    const sb = createClient(SUPABASE_URL, svcKey);
    const { data: authData } = await sb.auth.getUser(auth.replace("Bearer ", ""));
    if (authData?.user?.id) return { userId: authData.user.id };
  }

  return { error: new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401, headers: { ...CORS, "Content-Type": "application/json" },
  }) };
}
```

**Aplicar em:** `supabase/functions/consultor-insights/index.ts`

---

### RLS org-first (`is_org_member` / `get_org_role`)

**Source:** `supabase/migrations/20260614123000_tenant04_onboarding_progress.sql` linhas 52-66

```sql
CREATE POLICY "select_policy"
  ON public.<table>
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "write_policy"
  ON public.<table>
  FOR ALL TO authenticated
  USING  (public.get_org_role(auth.uid(), organization_id) = 'owner'::public.org_role)
  WITH CHECK (public.get_org_role(auth.uid(), organization_id) = 'owner'::public.org_role);
```

**Aplicar em:** todas as 3 tabelas novas (`insights`, `consultor_config`, `consultor_health_snapshots`)

---

### pg_cron Pattern B (vault `service_role_key`)

**Source:** `supabase/migrations/20260614110000_pg_cron_questions_claims.sql` linhas 23-44

```sql
DO $$ BEGIN
  PERFORM cron.unschedule('<job-name>');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('<job-name>', '<schedule>',
  $cmd$
    SELECT net.http_post(
      url     := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/<ef>',
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

**Aplicar em:** `supabase/migrations/20260645_pg_cron_consultor.sql`

---

### React Query hook org-scoped com staleTime

**Source:** `src/hooks/useMLQuestions.ts` linhas 36-57

```typescript
return useQuery<T[]>({
  queryKey: ["<key>", orgId, resolvedMLUserIds],
  enabled: !!orgId && resolvedMLUserIds.length > 0,
  staleTime: N * 60 * 1000,
  queryFn: async (): Promise<T[]> => {
    if (!orgId) return [];
    const { data, error } = await supabase
      .from("<table>")
      .select("*")
      .eq("organization_id", orgId)
      .in("ml_user_id", resolvedMLUserIds);
    if (error) throw error;
    return (data ?? []) as T[];
  },
});
```

**Aplicar em:** `src/hooks/useConsultorInsights.ts` (leitura de `insights` + `consultor_health_snapshots`)

---

### On-demand invoke de EF quando stale / sem dados

**Source:** `src/hooks/useMLBilling.ts` `useMLBillingWithSync` linhas 213-255

```typescript
const [syncing, setSyncing] = useState(false);
const attemptedRef = useRef<Set<string>>(new Set());

useEffect(() => {
  if (isLoading || data || !orgId) return;
  const key = orgId;
  if (attemptedRef.current.has(key)) return;
  attemptedRef.current.add(key);

  let cancelled = false;
  setSyncing(true);
  supabase.functions
    .invoke("<ef-name>", { body: { mode: "org_only" } })
    .then(({ error }) => {
      if (error) attemptedRef.current.delete(key); // libera retry em erro de rede
      if (!cancelled) return refetch();
    })
    .finally(() => { if (!cancelled) setSyncing(false); });

  return () => { cancelled = true; };
}, [isLoading, data, orgId, refetch]);

return { ...query, syncing };
```

**Aplicar em:** `src/hooks/useConsultorInsights.ts`

---

### Cores do score (tokens `kpi.positive/negative/neutral`)

**Source:** `src/components/dashboard/KPICard.tsx` linhas 33-42 (variantStyles)

```typescript
// Mapeamento das 3 faixas (D-10) para as variantes existentes:
// score 75-100 → variant="success" → "bg-success/10 text-success" (kpi.positive)
// score 50-74  → variant="warning" → "bg-warning/10 text-warning" (kpi.neutral)
// score 0-49   → variant="danger"  → "bg-destructive/10 text-destructive" (kpi.negative)

// ícones de severidade por regra:
// 'critical' → <XCircle className="text-destructive" />
// 'high'     → <AlertTriangle className="text-warning" />
// 'medium'   → <Info className="text-muted-foreground" />
```

**Aplicar em:** `ConsultorCard.tsx` e `MLConsultor.tsx`

---

### RPCs de margem (padrão SQL agregado)

**Source:** `supabase/migrations/20260527110000_margin_aggregate_rpcs.sql` linhas 1-50

```sql
CREATE OR REPLACE FUNCTION public.get_margin_summary(
  p_org_id   UUID, p_user_ids TEXT[], p_from DATE, p_to DATE
)
RETURNS TABLE (receita NUMERIC, cmv NUMERIC, lucro NUMERIC, lucro_pct NUMERIC, ...)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(o.receita_bruta), 0)           AS receita,
    COALESCE(SUM(o.custo_unit * o.quantidade), 0) AS cmv,
    COALESCE(SUM(
      o.receita_bruta
      - COALESCE(o.custo_unit * o.quantidade, 0)
      - COALESCE(o.comissao, 0)
      - COALESCE(o.frete, 0)
      - COALESCE(o.tax_amount, 0)
    ), 0) AS lucro,
    ...
  FROM orders o
  WHERE o.organization_id = p_org_id
    AND o.ml_user_id = ANY(p_user_ids)
    AND o.status IN ('paid','shipped','delivered')
$$;
```

**No engine (EF Deno):** invocar via `supabase.rpc("get_margin_by_product", { p_org_id: orgId, p_user_ids: mlUserIds, ... })` — RPC já existe, não recriar lógica SQL inline para margem.

---

### Cobertura de estoque (lógica `useMLCoverage`)

**Source:** `src/hooks/useMLCoverage.ts` linhas 68-73 (`classifyDays`) + 125-135 (fórmula de coverage_days)

```typescript
// Fórmula portada para SQL no engine:
// coverage_days = FLOOR(available_quantity / avg_daily_sales)
// classifyDays:
//   ruptura  → coverage_days < rupturaMax  (default: 0, ou seja, stock=0)
//   critico  → coverage_days < criticoMax  (default: CEIL(period * 0.25) = ~7d para 30d)
//   alerta   → coverage_days < alertaMax   (default: period = 30d)

// D-05: limiares ajustados para o engine:
// critico = coverage_days < 7 AND avg_daily > 0
// alerta  = coverage_days < 15 AND coverage_days >= 7 AND avg_daily > 0
```

---

## No Analog Found

Nenhum arquivo desta fase ficou sem analog — todos os padrões necessários já existem no codebase.

---

## Metadata

**Analog search scope:** `supabase/functions/`, `supabase/migrations/`, `src/hooks/`, `src/components/`, `src/pages/`
**Files scanned:** 10 (lidos integralmente ou parcialmente)
**Pattern extraction date:** 2026-06-14

### Pitfalls críticos a propagar para os planos

1. **Supabase project ID correto:** `ckcdevcxgvueywivefgx` (não `gionpsuunfkkzzjdubfy` do CLAUDE.md).
2. **Migrations via MCP `apply_migration`** — CLI local está linkado no projeto errado.
3. **pg_cron Pattern B:** vault `service_role_key` = `sb_secret_*` (não JWT legacy).
4. **Unique index funcional com COALESCE** não pode ser constraint inline — usar `CREATE UNIQUE INDEX` separado.
5. **PostgREST trunca em 1000 linhas** — dentro da EF, usar `supabase.rpc()` com funções SQL que agregam, não `.from().select()` em tabelas com muitos produtos.
6. **`ml_ads_campaigns_cache` não tem coluna `date`** — regra "campanha sem venda" opera em nível de org via `ml_ads_daily_cache`.
7. **`ml_targets` sem `organization_id`** — join via `ml_tokens` para resolver org; fallback = não dispara se sem meta.
8. **verify_jwt=false na EF** não significa sem auth — auth interna dual obrigatória (ver padrão `authenticate()` acima).
