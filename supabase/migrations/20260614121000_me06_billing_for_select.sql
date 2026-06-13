-- ME-06: Endurecer ml_billing_monthly — trocar FOR ALL por FOR SELECT.
--
-- Problema (D-15): a policy "org_member_billing" usa FOR ALL (SELECT+INSERT+UPDATE+DELETE)
-- para o role authenticated. Isso permite que qualquer membro da org — incluindo viewers —
-- execute INSERT, UPDATE ou DELETE em dados de billing, que é uma elevação de privilégio.
--
-- Solução: substituir por FOR SELECT only. Escrita exclusiva de service role (EF sync-ml-billing),
-- que já ignora RLS via SERVICE_ROLE_KEY. Nenhuma policy de INSERT/UPDATE/DELETE é necessária
-- para authenticated — default-deny cobre.
--
-- Idempotência: DROP POLICY IF EXISTS garante re-entrant safe.

DROP POLICY IF EXISTS "org_member_billing" ON public.ml_billing_monthly;

-- Leitura: qualquer membro da org pode ler os dados de billing da sua org.
-- Escrita: exclusiva do service role (sync-ml-billing EF) — sem policy explícita necessária.
CREATE POLICY "org_member_billing_select"
  ON public.ml_billing_monthly
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));
