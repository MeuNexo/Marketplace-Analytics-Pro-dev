-- ============================================================
-- Phase 52 v8.0 — ALTERs em tabelas existentes (insights / consultor_config /
--                  consultor_health_snapshots)
-- ============================================================
--
-- 3 ALTERs idempotentes que estendem as tabelas do Consultor v1 para o v2:
--
--   1. insights.snoozed_until (SNZ-02) — snooze server-side POR-LINHA (Pitfall
--      P6: nunca tabela à parte, senão o snooze de uma loja sumiria o alerta de
--      outra). + snooze_count (discricionário, informativo). A policy
--      insights_dismiss (UPDATE p/ qualquer membro) JÁ cobre a escrita de
--      snoozed_until — NÃO criar policy nova (Pitfall P8). NÃO re-adicionar
--      ml_user_id nem ml_user_id_key (já existem).
--
--   2. consultor_config.llm_enabled (LLM-07 kill-switch) + llm_model. A policy
--      owner-only consultor_config_write já cobre a escrita. NÃO re-adicionar os
--      14 limiares existentes (margin_*, tacos_*, stock_*, etc.).
--
--   3. consultor_health_snapshots.ml_user_id_key (STORE-01) + troca da UNIQUE
--      de (org, snapshot_month) → (org, ml_user_id_key, snapshot_month).
--      Pitfall P3: a troca precisa ser re-entrant — DROP CONSTRAINT IF EXISTS +
--      ADD CONSTRAINT dentro de DO/EXCEPTION duplicate_object. Linhas org-level
--      antigas têm ml_user_id_key='' por default → não colidem.
--
-- Idempotência: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS, ADD
--   CONSTRAINT via DO/EXCEPTION duplicate_object. Seguro re-aplicar via MCP.
--
-- Supabase project: ckcdevcxgvueywivefgx (NÃO usar gionpsuunfkkzzjdubfy).
-- ============================================================

-- ── 1. insights: snooze por-linha (RLS via insights_dismiss já cobre — P8) ──
ALTER TABLE public.insights
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz NULL,
  ADD COLUMN IF NOT EXISTS snooze_count  int         NOT NULL DEFAULT 0;

-- ── 2. consultor_config: kill-switch LLM (policy owner-only já cobre escrita) ──
ALTER TABLE public.consultor_config
  ADD COLUMN IF NOT EXISTS llm_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS llm_model   text    NOT NULL DEFAULT 'claude-haiku-4-5';

-- ── 3. consultor_health_snapshots: suporte por-loja + troca de UNIQUE (P3) ──
ALTER TABLE public.consultor_health_snapshots
  ADD COLUMN IF NOT EXISTS ml_user_id_key text NOT NULL DEFAULT '';

-- Remove a UNIQUE antiga (org, snapshot_month) se existir.
ALTER TABLE public.consultor_health_snapshots
  DROP CONSTRAINT IF EXISTS snapshots_org_month;

-- Adiciona a UNIQUE nova por-loja, idempotente (re-entrant via DO/EXCEPTION).
-- Linhas antigas têm ml_user_id_key='' por default → não colidem sob a nova chave.
DO $$ BEGIN
  ALTER TABLE public.consultor_health_snapshots
    ADD CONSTRAINT snapshots_org_store_month
    UNIQUE (organization_id, ml_user_id_key, snapshot_month);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
