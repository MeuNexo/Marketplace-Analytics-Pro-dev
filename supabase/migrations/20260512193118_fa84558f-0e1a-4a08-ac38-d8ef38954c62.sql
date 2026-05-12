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
      'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdpb25wc3V1bmZra3p6amR1YmZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NTc2NDgsImV4cCI6MjA4ODEzMzY0OH0.mHbEEnXlynQopAd5j7A4B4emYwalXqvyVcvEh_G5gUk',
      'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='CRON_SECRET' LIMIT 1)
    ),
    body := jsonb_build_object('name', _name, 'owner_email', _email)
  );
$$;
SELECT public.bootstrap_org_once_invoke('Pé Vermeio', 'wesleysantos@pevermeio.com');