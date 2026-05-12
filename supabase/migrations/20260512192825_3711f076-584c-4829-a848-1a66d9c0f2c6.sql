CREATE OR REPLACE FUNCTION public.bootstrap_org_once_invoke(_name text, _email text)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
  SELECT net.http_post(
    url := 'https://gionpsuunfkkzzjdubfy.supabase.co/functions/v1/bootstrap-org-once',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='CRON_SECRET' LIMIT 1)
    ),
    body := jsonb_build_object('name', _name, 'owner_email', _email)
  );
$$;