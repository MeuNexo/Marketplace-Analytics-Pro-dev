-- SEC-07 (Fase 209): fechar o vazamento de orders_status_reconciliation.
-- Unica tabela sem RLS (1 de 53); entregava organization_id real a qualquer
-- chave publicavel. Espelho do padrao de orders/audit_log: SELECT por papel,
-- escrita so por service_role (que ignora RLS). ENABLE + REVOKE + POLICY + GRANT
-- SAEM JUNTOS — ENABLE orfao deixaria a tabela negando tudo para todos.
-- Alcance owner/admin (nao todo membro): e trilha de auditoria de correcao
-- financeira (R$ 63k, 203 pedidos), analogo semantico = audit_log. Alargar para
-- todo membro depois = trocar a expressao da policy. Nenhuma tela le esta tabela hoje.
-- Reversao: DISABLE ROW LEVEL SECURITY + restaurar relacl (arwdDxtm a anon/authenticated).

ALTER TABLE public.orders_status_reconciliation ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.orders_status_reconciliation FROM PUBLIC, anon, authenticated;

CREATE POLICY "orders_status_reconciliation org select"
  ON public.orders_status_reconciliation
  FOR SELECT TO authenticated
  USING (
    organization_id IS NOT NULL
    AND get_org_role(auth.uid(), organization_id) IN ('owner','admin')
  );

GRANT SELECT ON public.orders_status_reconciliation TO authenticated;
