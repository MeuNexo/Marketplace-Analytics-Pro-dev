# Phase 1 — Infraestrutura: DB Schema + Hook

**Goal:** Deliver the complete database infrastructure for tax configuration (enum + table +
trigger + RLS) and the `useMLTaxConfig` TanStack Query hook. No UI, no edge functions. Just
the DB plumbing and the hook that consumes it.

**Requirements:** INFRA-01, INFRA-02

---

## Threat Model

| Risk | Category | Disposition | Mitigation |
|------|----------|-------------|------------|
| Unauthorized cross-org read of tax config | Spoofing / Info Disclosure | Mitigate | RLS SELECT policy enforces `is_org_member(auth.uid(), organization_id)`; `authenticated` role only |
| Non-owner INSERT/UPDATE/DELETE of tax config | Tampering / Elevation of Privilege | Mitigate | Separate INSERT, UPDATE, DELETE policies each check `get_org_role(auth.uid(), organization_id) = 'owner'`; no combined FOR ALL policy that could conflate read and write checks |
| Negative effective_rate stored and silently used as discount | Information Disclosure / Data Integrity | Accept (phase-scoped) | Trigger stores raw value (Lucro Real can be negative); UI clamps to 0% in Phase 2. Value is never exposed to unauthenticated callers. |

---

## Task 1 — Create migration: `20260515120000_ml_tax_config.sql`

**File:** `supabase/migrations/20260515120000_ml_tax_config.sql`

Create this file with the exact content below. Do not alter column names, types, or defaults.

**Why each section exists:**

- `CREATE TYPE` before `CREATE TABLE` — PostgreSQL requires the type to exist before a column
  references it. Do not use `CREATE TYPE IF NOT EXISTS`; the migration is idempotent via the
  surrounding transaction — if it fails, roll back and fix.
- Trigger function `calculate_effective_rate` is separate from `handle_updated_at`. The project
  already has `handle_updated_at` defined globally; do NOT redefine it. The new function handles
  both `effective_rate` calculation and `updated_at` stamping for this table.
- RLS argument order: both `is_org_member` and `get_org_role` are defined as
  `(_user_id UUID, _org_id UUID)` — verified in migration
  `20260414200325_7db961c3-5398-4d01-9fef-1bdd1f217b40.sql`. Call as
  `fn(auth.uid(), organization_id)` throughout.
- No `organization_id IS NOT NULL AND` guard in RLS — the column is `NOT NULL` by schema;
  the guard is redundant and diverges from the cleaner pattern in the authoritative migration.

```sql
-- ─── Enum ─────────────────────────────────────────────────────────────────────
CREATE TYPE public.tax_regime AS ENUM (
  'simples_nacional',
  'lucro_presumido',
  'lucro_real'
);

-- ─── Table ────────────────────────────────────────────────────────────────────
CREATE TABLE public.ml_tax_config (
  id                   uuid          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ml_user_id           text          NOT NULL,
  organization_id      uuid          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  regime               public.tax_regime NOT NULL,

  -- Simples Nacional
  sn_aliquota_efetiva  numeric(6, 4) DEFAULT NULL,

  -- Lucro Presumido
  lp_pis               numeric(6, 4) DEFAULT NULL,   -- default 0.65%
  lp_cofins            numeric(6, 4) DEFAULT NULL,   -- default 3.00%
  lp_irpj              numeric(6, 4) DEFAULT NULL,
  lp_csll              numeric(6, 4) DEFAULT NULL,

  -- Lucro Real
  lr_pis_debito        numeric(6, 4) DEFAULT NULL,   -- default 1.65%
  lr_pis_credito       numeric(6, 4) DEFAULT NULL,   -- default 0
  lr_cofins_debito     numeric(6, 4) DEFAULT NULL,   -- default 7.60%
  lr_cofins_credito    numeric(6, 4) DEFAULT NULL,   -- default 0
  lr_icms_debito       numeric(6, 4) DEFAULT NULL,
  lr_icms_credito      numeric(6, 4) DEFAULT NULL,

  effective_rate       numeric(6, 4) NOT NULL DEFAULT 0,
  created_at           timestamptz   NOT NULL DEFAULT now(),
  updated_at           timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT ml_tax_config_unique UNIQUE (ml_user_id, organization_id)
);

-- ─── Index ────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS ml_tax_config_org_idx
  ON public.ml_tax_config (organization_id);

CREATE INDEX IF NOT EXISTS ml_tax_config_ml_user_idx
  ON public.ml_tax_config (ml_user_id);

-- ─── Trigger: calculate effective_rate + stamp updated_at ─────────────────────
CREATE OR REPLACE FUNCTION public.calculate_effective_rate()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Always stamp updated_at
  NEW.updated_at := now();

  -- Compute effective_rate by regime
  IF NEW.regime = 'simples_nacional' THEN
    NEW.effective_rate :=
      COALESCE(NEW.sn_aliquota_efetiva, 0);

  ELSIF NEW.regime = 'lucro_presumido' THEN
    NEW.effective_rate :=
      COALESCE(NEW.lp_pis,   0)
      + COALESCE(NEW.lp_cofins, 0)
      + COALESCE(NEW.lp_irpj,   0)
      + COALESCE(NEW.lp_csll,   0);

  ELSIF NEW.regime = 'lucro_real' THEN
    -- Raw value; may be negative when credits > debits. UI clamps in Phase 2.
    NEW.effective_rate :=
      (COALESCE(NEW.lr_pis_debito,    0)
       + COALESCE(NEW.lr_cofins_debito, 0)
       + COALESCE(NEW.lr_icms_debito,   0))
      - (COALESCE(NEW.lr_pis_credito,   0)
         + COALESCE(NEW.lr_cofins_credito, 0)
         + COALESCE(NEW.lr_icms_credito,   0));
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ml_tax_config_calculate_rate
  BEFORE INSERT OR UPDATE
  ON public.ml_tax_config
  FOR EACH ROW
  EXECUTE FUNCTION public.calculate_effective_rate();

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.ml_tax_config ENABLE ROW LEVEL SECURITY;

-- SELECT: all members of the organisation
CREATE POLICY "ml_tax_config select"
  ON public.ml_tax_config FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- INSERT: owner only
CREATE POLICY "ml_tax_config insert"
  ON public.ml_tax_config FOR INSERT TO authenticated
  WITH CHECK (public.get_org_role(auth.uid(), organization_id) = 'owner');

-- UPDATE: owner only
CREATE POLICY "ml_tax_config update"
  ON public.ml_tax_config FOR UPDATE TO authenticated
  USING  (public.get_org_role(auth.uid(), organization_id) = 'owner');

-- DELETE: owner only
CREATE POLICY "ml_tax_config delete"
  ON public.ml_tax_config FOR DELETE TO authenticated
  USING  (public.get_org_role(auth.uid(), organization_id) = 'owner');
```

**Acceptance criterion:** File exists at `supabase/migrations/20260515120000_ml_tax_config.sql`
with the exact SQL above. Lint: `npx supabase db lint` (or `supabase db lint`) produces no
errors related to this file.

---

## Task 2 — [BLOCKING] Push migration to Supabase

**This task must complete before Tasks 3 and 4. The hook cannot be tested and the TypeScript
types cannot be verified against the live schema until the migration is applied.**

Run one of the following (use whichever matches the project's Supabase setup):

```bash
# Option A — CLI push (preferred if supabase link is already configured)
npx supabase db push

# Option B — apply directly to a local dev instance
npx supabase db reset
```

If neither works, apply the SQL from Task 1 manually via the Supabase dashboard SQL editor
(project > SQL Editor > paste content > Run).

**Verification steps:**

1. Open the Supabase dashboard > Table Editor — confirm `ml_tax_config` appears.
2. Open Database > Enums — confirm `tax_regime` with three values.
3. Open Database > Functions — confirm `calculate_effective_rate` exists.
4. Open Database > Policies — confirm four policies on `ml_tax_config`.
5. Insert a test row via SQL editor and verify `effective_rate` is auto-computed:

```sql
INSERT INTO public.ml_tax_config
  (ml_user_id, organization_id, regime, lp_pis, lp_cofins, lp_irpj, lp_csll)
VALUES
  ('MLB123', '<any-valid-org-uuid>', 'lucro_presumido', 0.0065, 0.0300, 0.0150, 0.0090);

SELECT ml_user_id, regime, effective_rate FROM public.ml_tax_config WHERE ml_user_id = 'MLB123';
-- Expected effective_rate: 0.0605
```

**Acceptance criterion:** All five dashboard checks pass and the test query returns
`effective_rate = 0.0605`.

---

## Task 3 — Hand-edit `src/integrations/supabase/types.ts`

**File:** `src/integrations/supabase/types.ts`

Make three targeted edits. Do not regenerate or reformat the rest of the file.

### Edit A — Add `ml_tax_config` table to `Tables` (inside `public: { Tables: { ... } }`)

Find the `Tables` block (currently contains `audit_log`, `member_route_permissions`, etc.).
Insert the following entry **in alphabetical order by table name** — `ml_tax_config` sorts
after `ml_product_costs` and before `organizations` (or wherever the `m` tables fall):

```typescript
      ml_tax_config: {
        Row: {
          created_at: string
          effective_rate: number
          id: string
          lp_cofins: number | null
          lp_csll: number | null
          lp_irpj: number | null
          lp_pis: number | null
          lr_cofins_credito: number | null
          lr_cofins_debito: number | null
          lr_icms_credito: number | null
          lr_icms_debito: number | null
          lr_pis_credito: number | null
          lr_pis_debito: number | null
          ml_user_id: string
          organization_id: string
          regime: Database["public"]["Enums"]["tax_regime"]
          sn_aliquota_efetiva: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          effective_rate?: number
          id?: string
          lp_cofins?: number | null
          lp_csll?: number | null
          lp_irpj?: number | null
          lp_pis?: number | null
          lr_cofins_credito?: number | null
          lr_cofins_debito?: number | null
          lr_icms_credito?: number | null
          lr_icms_debito?: number | null
          lr_pis_credito?: number | null
          lr_pis_debito?: number | null
          ml_user_id: string
          organization_id: string
          regime: Database["public"]["Enums"]["tax_regime"]
          sn_aliquota_efetiva?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          effective_rate?: number
          id?: string
          lp_cofins?: number | null
          lp_csll?: number | null
          lp_irpj?: number | null
          lp_pis?: number | null
          lr_cofins_credito?: number | null
          lr_cofins_debito?: number | null
          lr_icms_credito?: number | null
          lr_icms_debito?: number | null
          lr_pis_credito?: number | null
          lr_pis_debito?: number | null
          ml_user_id?: string
          organization_id?: string
          regime?: Database["public"]["Enums"]["tax_regime"]
          sn_aliquota_efetiva?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_tax_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
```

### Edit B — Add `tax_regime` to `Enums` block (currently at line ~1120)

Find this exact block:

```typescript
    Enums: {
      app_role: "admin" | "editor" | "viewer"
      org_role: "owner" | "admin" | "member" | "viewer"
    }
```

Replace it with:

```typescript
    Enums: {
      app_role: "admin" | "editor" | "viewer"
      org_role: "owner" | "admin" | "member" | "viewer"
      tax_regime: "simples_nacional" | "lucro_presumido" | "lucro_real"
    }
```

### Edit C — Add `tax_regime` to `Constants.public.Enums` (currently at line ~1247)

Find this exact block:

```typescript
export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "editor", "viewer"],
      org_role: ["owner", "admin", "member", "viewer"],
    },
  },
```

Replace it with:

```typescript
export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "editor", "viewer"],
      org_role: ["owner", "admin", "member", "viewer"],
      tax_regime: ["simples_nacional", "lucro_presumido", "lucro_real"],
    },
  },
```

**Acceptance criterion:** `npx tsc --noEmit` (or the project's type-check command) exits 0 with
no new errors. Specifically, `Database["public"]["Enums"]["tax_regime"]` resolves to
`"simples_nacional" | "lucro_presumido" | "lucro_real"` without TypeScript complaints.

---

## Task 4 — Create `src/hooks/useMLTaxConfig.ts`

**File:** `src/hooks/useMLTaxConfig.ts` (new file)

This hook follows the TanStack Query pattern from `useMLQueries.ts` — NOT the legacy
`useState`/`useEffect`/`useCallback` pattern from `useMLProductCosts.ts`.

Key decisions:
- `queryKey` includes both `orgId` and `mlUserIds` so cache is correctly scoped per org and
  per set of ML user IDs.
- `enabled` guard prevents the query from firing with an unauthenticated user, an empty
  `mlUserIds` array, or a missing `orgId`.
- `staleTime: 5 * 60 * 1000` (5 minutes) — tax config changes rarely; avoids unnecessary
  round-trips on every render.
- Return type is `Map<string, { regime: string; effective_rate: number }>` keyed by
  `ml_user_id`. Consumers iterate the map with `map.get(mlUserId)`.
- `regime` is typed as `string` (not the enum union) intentionally — avoids the need to import
  the enum type in every consumer and keeps the return contract stable across future enum
  extensions.

```typescript
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MLTaxConfigEntry {
  regime: string;
  effective_rate: number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Fetches tax configuration for one or more ML user IDs within a given org.
 *
 * Returns a stable Map keyed by ml_user_id. Callers use:
 *   const { data: taxMap } = useMLTaxConfig(mlUserIds, orgId);
 *   const entry = taxMap?.get(mlUserId);
 *
 * effective_rate is the computed value from the DB trigger (see calculate_effective_rate).
 * For lucro_real the value may be negative when credits exceed debits — clamp at display layer.
 */
export function useMLTaxConfig(mlUserIds: string[], orgId: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["ml", "taxConfig", orgId, mlUserIds] as const,
    queryFn: async (): Promise<Map<string, MLTaxConfigEntry>> => {
      const { data, error } = await supabase
        .from("ml_tax_config")
        .select("ml_user_id, regime, effective_rate")
        .in("ml_user_id", mlUserIds)
        .eq("organization_id", orgId);

      if (error) throw error;

      const map = new Map<string, MLTaxConfigEntry>();
      for (const row of data ?? []) {
        map.set(row.ml_user_id, {
          regime: row.regime,
          effective_rate: Number(row.effective_rate),
        });
      }
      return map;
    },
    enabled: !!user && mlUserIds.length > 0 && !!orgId,
    staleTime: 5 * 60 * 1000,
  });
}
```

**Acceptance criterion:**

1. `npx tsc --noEmit` exits 0 — no TypeScript errors in the new file or its imports.
2. The supabase call `.from("ml_tax_config")` resolves against the type definitions added in
   Task 3 without `any` casts.
3. A minimal smoke test: import the hook in any existing component that already has a
   `QueryClientProvider` ancestor, call `useMLTaxConfig(["MLB123"], orgId)`, and confirm the
   return shape matches `UseQueryResult<Map<string, MLTaxConfigEntry>>` in DevTools or a
   TypeScript hover.

---

## Verification (Phase Complete)

All four tasks are done when:

- [ ] `supabase/migrations/20260515120000_ml_tax_config.sql` exists and contains the enum,
      table, trigger function, trigger, and four RLS policies exactly as written.
- [ ] Migration is applied to the Supabase project (table visible in dashboard).
- [ ] `effective_rate` is auto-computed by trigger on INSERT/UPDATE (verified by test query in
      Task 2).
- [ ] `src/integrations/supabase/types.ts` contains `ml_tax_config` Row/Insert/Update shapes
      and `tax_regime` in both `Enums` and `Constants.public.Enums`.
- [ ] `src/hooks/useMLTaxConfig.ts` exists, exports `useMLTaxConfig` and `MLTaxConfigEntry`.
- [ ] `npx tsc --noEmit` exits 0 with no new errors introduced by this phase.
