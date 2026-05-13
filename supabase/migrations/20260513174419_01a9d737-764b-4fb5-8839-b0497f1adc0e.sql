
-- 1) ml_tokens: revoke secret column access from frontend
REVOKE SELECT ON public.ml_tokens FROM authenticated, anon;
GRANT SELECT (id, user_id, ml_user_id, seller_id, organization_id, expires_at, scope, token_type, created_at, updated_at)
  ON public.ml_tokens TO authenticated;

-- 2) organization_invites: restrict email visibility
DROP POLICY IF EXISTS "Owners and admins can view org invites" ON public.organization_invites;
CREATE POLICY "Owner or inviter can view invites"
  ON public.organization_invites
  FOR SELECT
  TO authenticated
  USING (
    get_org_role(auth.uid(), organization_id) = 'owner'::org_role
    OR invited_by = auth.uid()
  );

-- 3) NOT NULL on organization_id for ML tables (verified 0 nulls)
ALTER TABLE public.ml_tokens               ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.sellers                 ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.seller_stores           ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.ml_daily_cache          ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.ml_hourly_cache         ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.ml_product_daily_cache  ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.ml_state_daily_cache    ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.ml_sync_log             ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.ml_user_cache           ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.ml_ads_campaigns_cache  ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.ml_ads_daily_cache      ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.ml_ads_products_cache   ALTER COLUMN organization_id SET NOT NULL;

-- 4) Remove obsolete bootstrap function (edge function already deleted)
DROP FUNCTION IF EXISTS public.bootstrap_org_once_invoke(text, text);

-- 5) Lock down internal SECURITY DEFINER functions — only service_role/postgres may call
REVOKE EXECUTE ON FUNCTION public.trigger_ml_token_refresh()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_cron_secret()                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.insert_audit_log(uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_cache_table_stats()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_updated_at()               FROM PUBLIC, anon, authenticated;
