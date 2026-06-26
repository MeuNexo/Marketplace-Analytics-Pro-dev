-- ============================================================
-- replenishment_params — adicionar escopo 'sku' ao CHECK de scope
-- ============================================================
-- Projeto: ckcdevcxgvueywivefgx (Org Pé Vermeio = 7f615df7-7bac-45e5-8a93-827fb9ddeec7)
-- Requisito: CMP-05
-- Decisão: D-08 (precedência SKU > marca > global; hardcoded como último fallback na RPC)
--
-- A migration 20260662000000 criou a constraint inline:
--   CHECK (scope IN ('global', 'marca'))
-- O Postgres auto-nomeou como replenishment_params_scope_check.
--
-- Esta migration substitui a constraint para incluir 'sku'. Para scope = 'sku',
-- scope_value recebe o seller_custom_field da variação ML (formato Tiny,
-- ex: '020491CA35GRX'). A UNIQUE (organization_id, scope, scope_value) existente
-- já cobre o novo escopo sem alteração (Pitfall 7).
--
-- NÃO altera: RLS, índice, colunas, UNIQUE constraint.
-- ============================================================

ALTER TABLE public.replenishment_params
  DROP CONSTRAINT IF EXISTS replenishment_params_scope_check;

ALTER TABLE public.replenishment_params
  ADD CONSTRAINT replenishment_params_scope_check
    CHECK (scope IN ('global', 'marca', 'sku'));
