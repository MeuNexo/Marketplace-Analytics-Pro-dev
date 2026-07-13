-- ============================================================
-- Phase 95 (Parte A) — get_cashflow_data_health: faixa de saúde dos dados
-- ============================================================
-- Nova RPC consumida pelo frontend (Parte B, useCashflowDataHealth) para a
-- faixa de alerta de CONFIABILIDADE no topo de /fluxo-de-caixa (95-CONTEXT.md):
-- dispara em 3 situações — Tiny sync > 6h, MP sync > 6h, âncora > 7 dias.
-- Limiares travados por Wesley: 6h (cron roda a cada 3h = 2 ciclos), 7 dias.
--
-- Retorna TABLE de 1 linha com 9 colunas (mesmo padrão de get_treasury_panel/
-- get_projected_balance_summary — RETURN QUERY SELECT de escalares computados):
--   tiny_last_sync timestamptz, tiny_hours_ago numeric, tiny_stale boolean,
--   mp_last_sync   timestamptz, mp_hours_ago   numeric, mp_stale   boolean,
--   anchor_date    date,        anchor_days_ago numeric, anchor_stale boolean
--
-- CRÍTICO (Pitfall 3, 95-RESEARCH.md): tiny_last_sync usa
-- MAX(cash_outflows.synced_at) FILTER (WHERE source = 'tiny') — NÃO
-- MAX(synced_at) puro. cash_outflows.synced_at é uma coluna genérica; hoje só
-- a EF sync-tiny-payables grava source='tiny' (supabase/functions/
-- sync-tiny-payables/index.ts:280,282), mas uma linha source='manual' com
-- synced_at recente poderia mascarar um token Tiny morto (exatamente o
-- cenário real que motivou esta fase — o token do Tiny morreu em 08/07 e o
-- cron continuou reportando "succeeded"). cash_inflows NÃO tem coluna
-- `source` (toda linha vem do MP via sync-mp-releases) — ali MAX(synced_at)
-- puro está correto.
--
-- NULL (nunca sincronizou / sem âncora) conta como stale=true — org nova ou
-- nunca configurada deve aparecer como "não confiável", não como "ok".
--
-- SEGURANÇA: SECURITY INVOKER, sem checagem manual de org — RLS
-- is_org_member (SELECT) de cash_inflows/cash_outflows/financial_settings já
-- filtra a org do caller (Pattern 1, 95-RESEARCH.md).
--
-- Apply via MCP apply_migration no projeto ckcdevcxgvueywivefgx.
-- NUNCA `supabase db push` (sem token de CLI para este projeto).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_cashflow_data_health(p_org_id UUID)
RETURNS TABLE (
  tiny_last_sync   TIMESTAMPTZ,
  tiny_hours_ago   NUMERIC,
  tiny_stale       BOOLEAN,
  mp_last_sync     TIMESTAMPTZ,
  mp_hours_ago     NUMERIC,
  mp_stale         BOOLEAN,
  anchor_date      DATE,
  anchor_days_ago  NUMERIC,
  anchor_stale     BOOLEAN
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = 'public'
AS $$
DECLARE
  v_today           DATE        := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_tiny_last_sync  TIMESTAMPTZ;
  v_mp_last_sync    TIMESTAMPTZ;
  v_anchor_date     DATE;
  v_tiny_hours_ago  NUMERIC;
  v_mp_hours_ago    NUMERIC;
  v_anchor_days_ago NUMERIC;
BEGIN
  -- Tiny: MAX(synced_at) FILTER (WHERE source='tiny') — Pitfall 3, exclui
  -- linhas manuais que poderiam mascarar um token Tiny morto.
  SELECT MAX(co.synced_at) FILTER (WHERE co.source = 'tiny')
    INTO v_tiny_last_sync
  FROM public.cash_outflows co
  WHERE co.organization_id = p_org_id;

  -- MP: MAX(synced_at) puro — cash_inflows não tem coluna source (toda linha
  -- vem do MP via sync-mp-releases).
  SELECT MAX(ci.synced_at)
    INTO v_mp_last_sync
  FROM public.cash_inflows ci
  WHERE ci.organization_id = p_org_id;

  SELECT fs.balance_anchor_date
    INTO v_anchor_date
  FROM public.financial_settings fs
  WHERE fs.organization_id = p_org_id
  LIMIT 1;

  v_tiny_hours_ago  := CASE WHEN v_tiny_last_sync IS NULL THEN NULL
                            ELSE EXTRACT(EPOCH FROM (now() - v_tiny_last_sync)) / 3600 END;
  v_mp_hours_ago    := CASE WHEN v_mp_last_sync IS NULL THEN NULL
                            ELSE EXTRACT(EPOCH FROM (now() - v_mp_last_sync)) / 3600 END;
  v_anchor_days_ago := CASE WHEN v_anchor_date IS NULL THEN NULL
                            ELSE (v_today - v_anchor_date) END;

  RETURN QUERY SELECT
    v_tiny_last_sync,
    v_tiny_hours_ago,
    (v_tiny_last_sync IS NULL OR v_tiny_hours_ago > 6),
    v_mp_last_sync,
    v_mp_hours_ago,
    (v_mp_last_sync IS NULL OR v_mp_hours_ago > 6),
    v_anchor_date,
    v_anchor_days_ago,
    (v_anchor_date IS NULL OR v_anchor_days_ago > 7);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_cashflow_data_health(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_cashflow_data_health(UUID) TO authenticated, service_role;
