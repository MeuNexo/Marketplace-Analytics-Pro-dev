-- ──────────────────────────────────────────────────────────────────────────────
-- Adiciona colunas de limiar de ads em consultor_config (D-06).
-- ads_eating_critical_pct: lucro_pct_pos_ads <= 0  → insight "critical"
-- ads_eating_alert_pct:    lucro_pct_pos_ads <= 10 → insight "high"
-- Convenção: NUMERIC NOT NULL DEFAULT <valor> (padrão das colunas de percentual).
-- RLS existente (org-first, Phase 45) permanece inalterado (T-48-01-03 accepted).
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.consultor_config
  ADD COLUMN IF NOT EXISTS ads_eating_critical_pct NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ads_eating_alert_pct    NUMERIC NOT NULL DEFAULT 10;
