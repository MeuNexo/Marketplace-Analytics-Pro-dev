-- Quick 260613-2p6: DRE mês-calendário exato (01–31).
-- Agrega os movimentos individuais da ML Billing API por (dia de lançamento, tipo
-- de tarifa). A "data de competência" é creation_date_time do movimento na fatura
-- (decisão Wesley 2026-06-13) — espelha a fatura ML e resolve o descasamento do
-- ciclo de fechamento (dia 06→05) contra o mês-calendário da receita.
CREATE TABLE public.ml_billing_daily (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id    UUID NOT NULL REFERENCES public.organizations(id),
  ml_user_id         TEXT NOT NULL,
  charge_date        DATE NOT NULL,           -- creation_date_time do movimento (competência)
  charge_type        TEXT NOT NULL,           -- detail_sub_type (CVVML, CFFE, CFONPN, BVVML, CSHIA...)
  charge_label       TEXT,                    -- transaction_detail (legível)
  amount             NUMERIC NOT NULL,        -- soma com sinal (B* negativos)
  source_invoice_key TEXT NOT NULL,           -- key da fatura de origem (YYYY-MM-01) — base do resync idempotente
  synced_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, ml_user_id, charge_date, charge_type, source_invoice_key)
);

CREATE INDEX idx_ml_billing_daily_lookup
  ON public.ml_billing_daily (organization_id, ml_user_id, charge_date);

CREATE INDEX idx_ml_billing_daily_invoice
  ON public.ml_billing_daily (organization_id, ml_user_id, source_invoice_key);

ALTER TABLE public.ml_billing_daily ENABLE ROW LEVEL SECURITY;

-- Apenas leitura para membros da org. A escrita é feita pela edge function
-- sync-ml-billing via service-role (bypassa RLS), então não há policy de
-- INSERT/UPDATE/DELETE — viewers não conseguem adulterar dados de billing.
CREATE POLICY "org_member_billing_daily_select"
  ON public.ml_billing_daily
  FOR SELECT
  USING (public.is_org_member(auth.uid(), organization_id));
