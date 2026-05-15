CREATE TABLE IF NOT EXISTS public.ml_product_costs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  organization_id uuid,
  item_id         text NOT NULL,
  cost            numeric,
  tax_rate        numeric,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, item_id)
);

ALTER TABLE public.ml_product_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ml_product_costs select"
  ON public.ml_product_costs FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (organization_id IS NOT NULL AND is_org_member(auth.uid(), organization_id)));

CREATE POLICY "ml_product_costs insert"
  ON public.ml_product_costs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "ml_product_costs update"
  ON public.ml_product_costs FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR (organization_id IS NOT NULL AND get_org_role(auth.uid(), organization_id) = ANY (ARRAY['owner'::org_role,'admin'::org_role,'member'::org_role])));

CREATE POLICY "ml_product_costs delete"
  ON public.ml_product_costs FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR (organization_id IS NOT NULL AND get_org_role(auth.uid(), organization_id) = ANY (ARRAY['owner'::org_role,'admin'::org_role])));

CREATE INDEX IF NOT EXISTS idx_ml_product_costs_org_item ON public.ml_product_costs (organization_id, item_id);
CREATE INDEX IF NOT EXISTS idx_ml_product_costs_user_item ON public.ml_product_costs (user_id, item_id);