UPDATE public.ml_product_costs c
SET organization_id = m.organization_id
FROM public.organization_members m
WHERE c.organization_id IS NULL
  AND c.user_id = m.user_id;