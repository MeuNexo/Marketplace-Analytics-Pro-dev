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

-- ─── Indexes ──────────────────────────────────────────────────────────────────
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
