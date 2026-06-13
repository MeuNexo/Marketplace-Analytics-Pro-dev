-- Phase 42 (Zero Mock) Plan 01: Tables for ML Questions and Claims
-- Analog: supabase/migrations/20260612140000_ml_billing_monthly.sql (CREATE TABLE + ENABLE RLS + org_member FOR ALL policy)
-- Index pattern: supabase/migrations/20260613020000_ml_billing_daily.sql (composite indexes)

-- ─── ml_questions ──────────────────────────────────────────────────────────

CREATE TABLE public.ml_questions (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  ml_user_id      TEXT NOT NULL,
  question_id     BIGINT NOT NULL,              -- ML numeric question ID
  item_id         TEXT,                         -- MLB...
  item_title      TEXT,                         -- optional enrichment
  texto           TEXT NOT NULL,                -- question text from buyer
  status          TEXT NOT NULL DEFAULT 'UNANSWERED', -- UNANSWERED | ANSWERED | CLOSED
  comprador_id    TEXT,                         -- from.id (buyer)
  data_pergunta   TIMESTAMPTZ,                  -- date_created from ML API
  resposta        TEXT,                         -- answer.text (null if not answered)
  data_resposta   TIMESTAMPTZ,                  -- answer.date_created
  synced_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, ml_user_id, question_id)
);

ALTER TABLE public.ml_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_questions"
  ON public.ml_questions
  FOR ALL
  USING (public.is_org_member(auth.uid(), organization_id));

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_ml_questions_scope
  ON public.ml_questions (organization_id, ml_user_id);

CREATE INDEX IF NOT EXISTS idx_ml_questions_status
  ON public.ml_questions (organization_id, ml_user_id, status);

CREATE INDEX IF NOT EXISTS idx_ml_questions_data
  ON public.ml_questions (organization_id, ml_user_id, data_pergunta DESC);

-- ─── ml_claims ─────────────────────────────────────────────────────────────

CREATE TABLE public.ml_claims (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  ml_user_id      TEXT NOT NULL,
  claim_id        TEXT NOT NULL,                -- ML claim ID (string)
  order_id        TEXT,                         -- resource_id / order_id
  tipo            TEXT NOT NULL DEFAULT 'mediations', -- 'mediations' | 'returns'
  status          TEXT NOT NULL DEFAULT 'opened',     -- 'opened' | 'closed'
  motivo          TEXT,                         -- reason_id from ML API
  data_abertura   DATE,                         -- date_created (date part)
  data_limite     DATE,                         -- resolution_due_date
  solucao         TEXT,                         -- resolution.type
  synced_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, ml_user_id, claim_id)
);

ALTER TABLE public.ml_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_claims"
  ON public.ml_claims
  FOR ALL
  USING (public.is_org_member(auth.uid(), organization_id));

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_ml_claims_scope
  ON public.ml_claims (organization_id, ml_user_id);

CREATE INDEX IF NOT EXISTS idx_ml_claims_status
  ON public.ml_claims (organization_id, ml_user_id, status);

CREATE INDEX IF NOT EXISTS idx_ml_claims_data
  ON public.ml_claims (organization_id, ml_user_id, data_abertura DESC);
