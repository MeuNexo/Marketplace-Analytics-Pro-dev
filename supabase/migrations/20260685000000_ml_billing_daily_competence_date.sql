-- Phase 84 (84-01): DRE por Competência de Venda — schema foundation.
-- Projeto Supabase: ckcdevcxgvueywivefgx (NÃO gionpsuunfkkzzjdubfy).
-- DEPLOY só via MCP apply_migration (sem token CLI); NUNCA via SQL Editor.
-- Esta migration é AUTORIA apenas — aplicação real acontece no plano 84-04.
--
-- Adiciona `competence_date` (data da VENDA, via sales_info.sale_date_time da
-- ML Billing API) em ml_billing_daily, faz backfill imediato = charge_date na
-- MESMA migration (gap zero-width — nenhuma query enxerga NULL), alarga a
-- UNIQUE constraint para incluir competence_date (senão o re-sync com o novo
-- grão de agregação colide) e cria o índice de suporte para o novo filtro de
-- DRE por mês de competência. NÃO toca na trilha de fatura mensal separada,
-- políticas RLS ou os índices existentes (idx_ml_billing_daily_lookup /
-- idx_ml_billing_daily_invoice).

-- 1) Coluna nova, nullable primeiro.
ALTER TABLE public.ml_billing_daily ADD COLUMN IF NOT EXISTS competence_date DATE;

-- 2) Backfill na MESMA migration: linhas existentes assumem charge_date como
--    aproximação de competência (nenhuma linha fica NULL no instante em que o
--    frontend trocar o filtro para competence_date).
UPDATE public.ml_billing_daily
SET competence_date = charge_date
WHERE competence_date IS NULL;

-- 3) Tornar obrigatória agora que todas as linhas estão preenchidas.
ALTER TABLE public.ml_billing_daily ALTER COLUMN competence_date SET NOT NULL;

-- 4) Alargar a UNIQUE constraint para incluir competence_date. O nome
--    original é auto-gerado pelo Postgres (5 colunas, provavelmente truncado)
--    — buscamos dinamicamente via pg_constraint em vez de hardcodar.
--    organization_id e ml_user_id permanecem as duas primeiras colunas:
--    isolamento cross-org continua estruturalmente impossível (anti-IDOR).
DO $$
DECLARE c_name text;
BEGIN
  SELECT conname INTO c_name
  FROM pg_constraint
  WHERE conrelid = 'public.ml_billing_daily'::regclass AND contype = 'u';

  IF c_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.ml_billing_daily DROP CONSTRAINT %I', c_name);
  END IF;
END $$;

ALTER TABLE public.ml_billing_daily
  ADD CONSTRAINT ml_billing_daily_uniq
  UNIQUE (organization_id, ml_user_id, competence_date, charge_date, charge_type, source_invoice_key);

-- 5) Índice de suporte para o novo shape de consulta (DRE filtrado por mês de
--    competência), mirrors idx_ml_billing_daily_lookup mas para competence_date.
CREATE INDEX IF NOT EXISTS idx_ml_billing_daily_competence
  ON public.ml_billing_daily (organization_id, ml_user_id, competence_date);
