-- ml_product_costs: stores per-user product cost and tax rate for margin calculations
CREATE TABLE IF NOT EXISTS public.ml_product_costs (
  id          uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid        NOT NULL,
  item_id     text        NOT NULL,
  cost        numeric(12, 2) DEFAULT NULL,    -- custo do produto (R$)
  tax_rate    numeric(6, 4)  DEFAULT NULL,    -- alíquota de imposto ex: 0.1500 = 15%
  notes       text           DEFAULT NULL,
  updated_at  timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT ml_product_costs_unique UNIQUE (user_id, item_id)
);

-- Index for fast lookup by user + item
CREATE INDEX IF NOT EXISTS ml_product_costs_user_item_idx
  ON public.ml_product_costs (user_id, item_id);

-- RLS
ALTER TABLE public.ml_product_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own product costs"
  ON public.ml_product_costs
  FOR ALL
  TO authenticated
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
