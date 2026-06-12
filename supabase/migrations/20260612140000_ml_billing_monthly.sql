-- DATA-04: Tabela para armazenar dados reais da ML Billing API por conta/mês.
-- Contém CFFE (frete Full) e CFONPN (parcelamento sem juros) para uso no breakdown de custos.
CREATE TABLE public.ml_billing_monthly (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  ml_user_id      TEXT NOT NULL,
  period_month    TEXT NOT NULL,  -- YYYY-MM
  charges         JSONB,          -- array [{type, label, amount}]
  resumo          JSONB,          -- {cffe, cfonpn, total_charges, synced_at}
  synced_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, ml_user_id, period_month)
);

ALTER TABLE public.ml_billing_monthly ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_billing"
  ON public.ml_billing_monthly
  FOR ALL
  USING (public.is_org_member(auth.uid(), organization_id));
