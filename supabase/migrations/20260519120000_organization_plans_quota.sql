-- ─── Enum ─────────────────────────────────────────────────────────────────────
CREATE TYPE public.plan_tier AS ENUM (
  'free',
  'starter',
  'pro',
  'enterprise'
);

-- ─── Table: organization_plans ────────────────────────────────────────────────
CREATE TABLE public.organization_plans (
  organization_id        uuid          NOT NULL PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_tier              public.plan_tier NOT NULL DEFAULT 'free',
  sync_interval_minutes  integer       NOT NULL DEFAULT 1440,  -- 1440=free, 720=starter, 180=pro, 60=enterprise, -1=unlimited
  history_days           integer       NOT NULL DEFAULT 30,    -- -1 = unlimited
  created_at             timestamptz   NOT NULL DEFAULT now(),
  updated_at             timestamptz   NOT NULL DEFAULT now()
);

-- ─── Table: sync_quota_daily ──────────────────────────────────────────────────
CREATE TABLE public.sync_quota_daily (
  organization_id  uuid    NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  date             date    NOT NULL,
  sync_count       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, date)
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS organization_plans_created_at_idx
  ON public.organization_plans (created_at);

CREATE INDEX IF NOT EXISTS sync_quota_daily_org_date_idx
  ON public.sync_quota_daily (organization_id, date DESC);

-- ─── RLS: organization_plans ──────────────────────────────────────────────────
ALTER TABLE public.organization_plans ENABLE ROW LEVEL SECURITY;

-- SELECT: all members of the organisation
CREATE POLICY "organization_plans select"
  ON public.organization_plans FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- INSERT: owner only
CREATE POLICY "organization_plans insert"
  ON public.organization_plans FOR INSERT TO authenticated
  WITH CHECK (public.get_org_role(auth.uid(), organization_id) = 'owner');

-- UPDATE: owner only
CREATE POLICY "organization_plans update"
  ON public.organization_plans FOR UPDATE TO authenticated
  USING (public.get_org_role(auth.uid(), organization_id) = 'owner');

-- ─── RLS: sync_quota_daily ────────────────────────────────────────────────────
ALTER TABLE public.sync_quota_daily ENABLE ROW LEVEL SECURITY;

-- SELECT: all members of the organisation
CREATE POLICY "sync_quota_daily select"
  ON public.sync_quota_daily FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- NOTE: No INSERT or UPDATE policies for authenticated role.
-- Writes to sync_quota_daily are exclusive to service_role (edge functions).
