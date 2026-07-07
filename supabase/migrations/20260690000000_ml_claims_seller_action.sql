-- Phase 90 Plan 01: Triagem "de quem é a vez" — colunas derivadas em ml_claims.
-- Analog (ADD COLUMN IF NOT EXISTS style): supabase/migrations/20260689000200_ml_claims_motivo_texto.sql
-- Analog (table + indexes): supabase/migrations/20260614100000_ml_questions_claims.sql
--
-- Estas colunas são derivadas pela função pura deriveSellerAction
-- (supabase/functions/_shared/claimActions.ts) a partir do available_actions
-- do player respondent, seguindo a regra LOCKED "Pende você" (ver
-- docs/superpowers/specs/2026-07-07-atendimento-reclamacoes-design.md).
--
-- NÃO fazemos backfill aqui: linhas existentes ficam com
-- seller_action_required=false até o próximo webhook/sync GET re-derivar os
-- valores reais a partir do detail da claim (players/available_actions).
--
-- RLS: não alterada. A policy org_member_claims (FOR ALL) já cobre as novas
-- colunas por herdar da linha inteira.

ALTER TABLE public.ml_claims
  ADD COLUMN IF NOT EXISTS seller_action_required boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.ml_claims.seller_action_required IS
  'true quando o respondent (vendedor) tem pelo menos uma ação acionável pendente, seguindo a regra LOCKED "Pende você" (mensagem mandatory OU ação de decisão: refund/allow_return/open_dispute/allow_partial_refund).';

ALTER TABLE public.ml_claims
  ADD COLUMN IF NOT EXISTS pending_action_type text NULL;
COMMENT ON COLUMN public.ml_claims.pending_action_type IS
  'Tipo da ação pendente do vendedor: reply | return | refund | dispute (sem CHECK constraint, mantido flexível). Prioridade quando várias se aplicam: reply > return > refund > dispute.';

ALTER TABLE public.ml_claims
  ADD COLUMN IF NOT EXISTS action_due_date timestamptz NULL;
COMMENT ON COLUMN public.ml_claims.action_due_date IS
  'due_date da ação que definiu pending_action_type.';

ALTER TABLE public.ml_claims
  ADD COLUMN IF NOT EXISTS available_actions jsonb NULL;
COMMENT ON COLUMN public.ml_claims.available_actions IS
  'Lista bruta de available_actions do player respondent (para a planilha + auditoria).';

ALTER TABLE public.ml_claims
  ADD COLUMN IF NOT EXISTS stage text NULL;
COMMENT ON COLUMN public.ml_claims.stage IS
  'Estágio da claim no ML: claim | dispute | ...';

-- Índice parcial: sustenta os contadores "Pende você" (sino + KPI) sem varrer
-- claims já resolvidas.
CREATE INDEX IF NOT EXISTS idx_ml_claims_seller_action
  ON public.ml_claims (organization_id, ml_user_id)
  WHERE seller_action_required;
