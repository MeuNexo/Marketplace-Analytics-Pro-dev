-- ── TENANT-03: RPC check_quota(_org_id uuid) RETURNS boolean ─────────────────
--
-- Implementa o gate de quota de sync por org (D-04, D-06).
-- Derivado de checkAndIncrementQuota() em sync-ml-inventory/index.ts.
--
-- Regras:
--   • Se sync_interval_minutes IS NULL ou = -1 (enterprise/unlimited) → retorna TRUE
--     imediatamente (enterprise nunca bloqueia — D-04).
--   • Senão, incrementa sync_quota_daily atomicamente (ON CONFLICT DO UPDATE) e
--     compara sync_count com o limite diário derivado de 1440 / sync_interval_minutes.
--   • Retorna TRUE se dentro da quota; FALSE se excedeu.
--
-- Chamado por process-sync-job (EF) ANTES de despachar o job.
-- SECURITY DEFINER para que a EF (service role) possa chamar mesmo com verify_jwt=false.
--
-- Escopo Phase 43 = apenas sync (sync_interval_minutes + contagem diária).
-- history_days e nº de lojas ficam para Phase 44 (D-05).
--
-- Idempotente: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.check_quota(_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_interval  int;
  v_count     int;
  v_limit     int;
BEGIN
  -- Busca o intervalo de sync do plano da org
  SELECT sync_interval_minutes INTO v_interval
  FROM public.organization_plans
  WHERE organization_id = _org_id
  LIMIT 1;

  -- NULL = sem plano cadastrado; -1 = enterprise/unlimited → nunca bloqueia (D-04)
  IF v_interval IS NULL OR v_interval = -1 THEN
    RETURN true;
  END IF;

  -- Incrementa o contador diário atomicamente (ON CONFLICT DO UPDATE = UPSERT)
  INSERT INTO public.sync_quota_daily (organization_id, date, sync_count)
  VALUES (_org_id, current_date, 1)
  ON CONFLICT (organization_id, date)
    DO UPDATE SET sync_count = sync_quota_daily.sync_count + 1
  RETURNING sync_count INTO v_count;

  -- Limite diário: quantos syncs cabem em 1440 minutos com o intervalo configurado
  -- Ex.: sync_interval_minutes=60 → limite=24 syncs/dia
  v_limit := greatest(1, floor(1440.0 / v_interval));

  RETURN v_count <= v_limit;
END;
$$;

-- Revoga acesso público (EF usa service role — ignora RLS; usuários autenticados
-- não devem chamar diretamente)
REVOKE ALL ON FUNCTION public.check_quota(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_quota(uuid) TO service_role;
