-- TENANT-01: Consolidar RLS de ml_product_costs em policy org-first única.
--
-- Contexto (D-10/D-11/D-12):
--   - Existem duas migrations conflitantes de RLS:
--       20260514120000: "Users can manage own product costs" FOR ALL (auth.uid()=user_id)
--       20260515133732: "ml_product_costs select/insert/update/delete" (org-aware parcial)
--   - A INSERT policy antiga ainda exige user_id=auth.uid() via WITH CHECK,
--     bloqueando paths que não setam user_id corretamente (mas não afeta service role,
--     que ignora RLS).
--   - Consolidar em 4 policies org-first: SELECT/INSERT/UPDATE/DELETE.
--
-- Regras das novas policies:
--   - SELECT: membro da org pode ler custos de qualquer membro da mesma org (D-11).
--   - INSERT/UPDATE: owner, admin ou member da org podem gravar (customer input de custo).
--   - DELETE: owner, admin ou member da org podem deletar.
--   - Service role (recalc-order-costs, sync-tiny-costs, useMLProductCosts upsert via service key):
--     ignora RLS automaticamente — nenhuma policy necessária para esse caminho.
--   - user_id permanece coluna de auditoria (quem criou/editou), NÃO define scope de RLS (D-10).
--
-- Idempotência: DROP POLICY IF EXISTS dropa todas as policies conhecidas antes de recriar.
-- Seguro rodar múltiplas vezes.

DO $$ BEGIN
  -- Dropa a policy antiga FOR ALL (20260514120000)
  EXECUTE 'DROP POLICY IF EXISTS "Users can manage own product costs" ON public.ml_product_costs';

  -- Dropa as policies org-aware parciais (20260515133732)
  EXECUTE 'DROP POLICY IF EXISTS "ml_product_costs select" ON public.ml_product_costs';
  EXECUTE 'DROP POLICY IF EXISTS "ml_product_costs insert" ON public.ml_product_costs';
  EXECUTE 'DROP POLICY IF EXISTS "ml_product_costs update" ON public.ml_product_costs';
  EXECUTE 'DROP POLICY IF EXISTS "ml_product_costs delete" ON public.ml_product_costs';

  -- Dropa as novas (caso esta migration já tenha rodado antes — re-entrant safe)
  EXECUTE 'DROP POLICY IF EXISTS "mpc_select" ON public.ml_product_costs';
  EXECUTE 'DROP POLICY IF EXISTS "mpc_insert" ON public.ml_product_costs';
  EXECUTE 'DROP POLICY IF EXISTS "mpc_update" ON public.ml_product_costs';
  EXECUTE 'DROP POLICY IF EXISTS "mpc_delete" ON public.ml_product_costs';
END $$;

-- Garante que RLS está ativa (idempotente se já estava)
ALTER TABLE public.ml_product_costs ENABLE ROW LEVEL SECURITY;

-- SELECT: qualquer membro da org lê custos de todos os membros da mesma org.
-- organization_id IS NOT NULL guard: linhas sem org (órfãs pré-backfill) são invisíveis
-- para todos até o backfill da tenant02 as resolver.
CREATE POLICY "mpc_select"
  ON public.ml_product_costs
  FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND public.is_org_member(auth.uid(), organization_id)
  );

-- INSERT: owner/admin/member da org podem cadastrar custos.
-- viewer não pode escrever custos (default-deny — sem policy = sem acesso).
CREATE POLICY "mpc_insert"
  ON public.ml_product_costs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IS NOT NULL
    AND public.get_org_role(auth.uid(), organization_id)
        = ANY (ARRAY['owner', 'admin', 'member']::public.org_role[])
  );

-- UPDATE: mesma condição que INSERT (owner/admin/member).
-- USING e WITH CHECK idênticos para evitar escalada via UPDATE no USING.
CREATE POLICY "mpc_update"
  ON public.ml_product_costs
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

-- DELETE: owner/admin/member da org podem deletar custos.
CREATE POLICY "mpc_delete"
  ON public.ml_product_costs
  FOR DELETE
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND public.get_org_role(auth.uid(), organization_id)
        = ANY (ARRAY['owner', 'admin', 'member']::public.org_role[])
  );

-- Índice para performance da leitura por org (idempotente via IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_ml_product_costs_org_item
  ON public.ml_product_costs (organization_id, item_id);
