-- Phase 101 (D-06/D-09): tabela de configuração `ml_mco_targets`.
--
-- Persiste a meta de MCO% (target_mco_pct) por item_id, escopada por organização,
-- com sentinela `sku=''` para representar "anúncio inteiro" (D-09: grão = item_id,
-- variação opcional via sku).
--
-- RLS clonada 1:1 do padrão org-first já auditado em ml_product_costs
-- (20260614120000_tenant01_ml_product_costs_rls_orgfirst.sql, Phase 43 TENANT-01):
--   - SELECT: qualquer membro da org.
--   - INSERT/UPDATE/DELETE: owner/admin/member (nunca viewer — default-deny).
--   - organization_id sempre vem de is_org_member/get_org_role via auth.uid();
--     nunca um parâmetro de org vindo do cliente (anti-IDOR).
--
-- Sem RPC: escrita via supabase.from('ml_mco_targets').upsert(...) direto,
-- igual a ml_product_costs e replenishment_params (nenhuma das duas usa RPC
-- para escrita de config simples). SECURITY DEFINER não se aplica aqui.

CREATE TABLE public.ml_mco_targets (
  id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  item_id         text        NOT NULL,
  sku             text        NOT NULL DEFAULT '',  -- sentinel '' = anúncio inteiro; NEVER null
  target_mco_pct  numeric(5,2) NOT NULL CHECK (target_mco_pct > 0 AND target_mco_pct <= 100),
  updated_by      uuid        NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ml_mco_targets_org_item_sku_unique UNIQUE (organization_id, item_id, sku)
);

ALTER TABLE public.ml_mco_targets ENABLE ROW LEVEL SECURITY;

-- SELECT: qualquer membro da org lê as metas de MCO% de qualquer membro da mesma org.
CREATE POLICY "mmt_select"
  ON public.ml_mco_targets
  FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND public.is_org_member(auth.uid(), organization_id)
  );

-- INSERT: owner/admin/member da org podem definir metas de MCO%.
-- viewer não pode escrever (default-deny — sem policy = sem acesso).
CREATE POLICY "mmt_insert"
  ON public.ml_mco_targets
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IS NOT NULL
    AND public.get_org_role(auth.uid(), organization_id)
        = ANY (ARRAY['owner', 'admin', 'member']::public.org_role[])
  );

-- UPDATE: mesma condição que INSERT. USING e WITH CHECK idênticos
-- para evitar escalada via UPDATE no USING.
CREATE POLICY "mmt_update"
  ON public.ml_mco_targets
  FOR UPDATE
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND public.get_org_role(auth.uid(), organization_id)
        = ANY (ARRAY['owner', 'admin', 'member']::public.org_role[])
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND public.get_org_role(auth.uid(), organization_id)
        = ANY (ARRAY['owner', 'admin', 'member']::public.org_role[])
  );

-- DELETE: owner/admin/member da org podem remover metas.
CREATE POLICY "mmt_delete"
  ON public.ml_mco_targets
  FOR DELETE
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND public.get_org_role(auth.uid(), organization_id)
        = ANY (ARRAY['owner', 'admin', 'member']::public.org_role[])
  );

-- Índice para performance da leitura por org+item (idempotente via IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_ml_mco_targets_org_item
  ON public.ml_mco_targets (organization_id, item_id, sku);
