-- ============================================================
-- Phase 66 — Override por Fornecedor: RPC auxiliar get_purchase_order_suppliers
-- ============================================================
-- Retorna os fornecedores distintos das OCs da organização — alimenta o
-- dropdown de fornecedor no CRUD de params da UI (/compras).
-- SECURITY INVOKER: a RLS purchase_orders_select (is_org_member) garante
-- que org alheia (Thales via JWT Pé Vermeio) retorna 0 linhas (anti-IDOR).
-- REVOKE PUBLIC/anon + GRANT authenticated. Implementa FORN-04 (backend).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_purchase_order_suppliers(
  p_org_id UUID
)
RETURNS TABLE (fornecedor TEXT)
LANGUAGE sql
SECURITY INVOKER
SET search_path = 'public'
AS $$
  SELECT DISTINCT po.fornecedor
  FROM public.purchase_orders po
  WHERE po.organization_id = p_org_id
    AND po.fornecedor IS NOT NULL
  ORDER BY po.fornecedor;
$$;

REVOKE EXECUTE ON FUNCTION public.get_purchase_order_suppliers(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_purchase_order_suppliers(UUID) TO authenticated;
