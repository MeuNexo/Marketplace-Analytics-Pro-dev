-- ─── Table ────────────────────────────────────────────────────────────────────
CREATE TABLE public.commercial_analysis_snapshots (
  id                uuid          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  ml_user_id        text          NOT NULL REFERENCES public.ml_tokens(ml_user_id) ON DELETE CASCADE,
  organization_id   uuid          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  item_id           text          NOT NULL,
  product_title     text          NOT NULL,
  brand             text,
  period_start      date          NOT NULL,
  period_end        date          NOT NULL,
  price_curve       jsonb         NOT NULL,
  price_gmv         numeric(10,2) NOT NULL,
  price_neutral     numeric(10,2) NOT NULL,
  price_margin      numeric(10,2) NOT NULL,
  elasticity_pct    numeric(8,4)  NOT NULL,
  elasticity_class  text          NOT NULL CHECK (elasticity_class IN ('baixa','media','alta','extrema')),
  strategy          text          CHECK (strategy IN ('gmv','neutral','margin'))
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS commercial_analysis_snapshots_org_item_created_idx
  ON public.commercial_analysis_snapshots (organization_id, item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS commercial_analysis_snapshots_ml_user_item_idx
  ON public.commercial_analysis_snapshots (ml_user_id, item_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.commercial_analysis_snapshots ENABLE ROW LEVEL SECURITY;

-- SELECT: members of the organisation
CREATE POLICY "Members can view own org snapshots"
  ON public.commercial_analysis_snapshots FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- INSERT: members of the organisation
CREATE POLICY "Members can insert own org snapshots"
  ON public.commercial_analysis_snapshots FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

-- UPDATE: members of the organisation (to set strategy after analysis)
CREATE POLICY "Members can update strategy on own org snapshots"
  ON public.commercial_analysis_snapshots FOR UPDATE TO authenticated
  USING  (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));
