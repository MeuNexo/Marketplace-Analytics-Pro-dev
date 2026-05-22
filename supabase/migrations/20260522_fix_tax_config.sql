-- Fix 1: Set uf_origem = SP for Pé Vermeio (seller 1639558873)
-- Without this, intrastate detection was broken → SP→SP orders taxed at 12% instead of 18%
UPDATE ml_tax_config
SET uf_origem = 'SP', updated_at = now()
WHERE ml_user_id = '1639558873';

-- Fix 2: Rewrite trigger to use the new formula aligned with Wesley:
--   effective_rate = ICMS% + (1 - ICMS%/100) × (PIS 1,65% + COFINS 7,60%)
--   For ICMS=18%: 18 + 0.82 × 9.25 = 25.585%
--   For ICMS=12%: 12 + 0.88 × 9.25 = 20.14%
CREATE OR REPLACE FUNCTION calculate_effective_rate()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  icms_aliq NUMERIC;
  base_factor NUMERIC;
BEGIN
  NEW.updated_at := now();

  IF NEW.regime = 'simples_nacional' THEN
    NEW.effective_rate := COALESCE(NEW.sn_aliquota_efetiva, 0);

  ELSIF NEW.regime = 'lucro_presumido' THEN
    NEW.effective_rate :=
      COALESCE(NEW.lp_pis,   0)
      + COALESCE(NEW.lp_cofins, 0)
      + COALESCE(NEW.lp_irpj,   0)
      + COALESCE(NEW.lp_csll,   0);

  ELSIF NEW.regime = 'lucro_real' THEN
    -- Preview usa alíquota intraestadual como referência
    icms_aliq := COALESCE(
      NEW.lr_icms_aliquota_intra,
      NEW.lr_icms_aliquota_inter_sul_sudeste,
      NEW.lr_icms_debito,
      12
    );
    base_factor := 1.0 - (icms_aliq / 100.0);
    NEW.effective_rate := GREATEST(0, icms_aliq + base_factor * (1.65 + 7.60));

  END IF;

  RETURN NEW;
END;
$$;

-- Recalculate effective_rate for all existing lucro_real rows
UPDATE ml_tax_config
SET updated_at = now()
WHERE regime = 'lucro_real';
