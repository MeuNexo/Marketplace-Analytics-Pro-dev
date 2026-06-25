-- ============================================================
-- Reposição Server-Side — Tabela replenishment_params (RLS org-first)
-- ============================================================
-- Requisito: REPL-05 (parâmetros global + override por marca)
-- Projeto: ckcdevcxgvueywivefgx
-- Phase: 62-reposicao-server-side (Plan 62-01)
--
-- Colunas:
--   scope IN ('global','marca') — fornecedor reservado para v2 (fora do escopo v1)
--   scope_value = '' para global; nome da marca para scope='marca'
--     (case-sensitive, igual a ml_inventory_cache.brand)
--   lead_time_dias, meta_cobertura_dias, safety_days: parâmetros de ponto de reposição
--   moq: quantidade mínima do pedido
--   pack_multiple: múltiplo de embalagem (CHECK >= 1 — guarda contra divisão por zero)
--
-- Política de escrita: apenas owner/admin (NÃO member) — parâmetros de
-- reposição são configuração sensível de gestão. SELECT para todos os membros.
--
-- Sem linha de seed: a RPC get_replenishment usa COALESCE com fallback
-- hardcoded (30/60/7/1/1) quando nenhuma linha existe (Open Question 3 resolvida).
-- ============================================================

CREATE TABLE public.replenishment_params (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id     UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  scope               TEXT        NOT NULL DEFAULT 'global'
                                  CHECK (scope IN ('global', 'marca')),
  scope_value         TEXT        NOT NULL DEFAULT '',
  -- '' representa global; nome da marca representa override por marca
  lead_time_dias      INTEGER     NOT NULL DEFAULT 30,
  meta_cobertura_dias INTEGER     NOT NULL DEFAULT 60,
  safety_days         INTEGER     NOT NULL DEFAULT 7,
  moq                 INTEGER     NOT NULL DEFAULT 1 CHECK (moq >= 1),
  pack_multiple       INTEGER     NOT NULL DEFAULT 1 CHECK (pack_multiple >= 1),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT replenishment_params_org_scope_unique
    UNIQUE (organization_id, scope, scope_value)
);

-- --------------------------------------------------------
-- RLS org-first (espelhando ml_product_costs, Phase 43)
-- --------------------------------------------------------
ALTER TABLE public.replenishment_params ENABLE ROW LEVEL SECURITY;

-- SELECT: qualquer membro da org lê os parâmetros
CREATE POLICY "rp_select" ON public.replenishment_params
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- ESCRITA: somente owner/admin — parâmetros de reposição são config de gestão
-- (NÃO inclui 'member': configuração de lead_time, MOQ, etc. é decisão gerencial)
-- USING + WITH CHECK idênticos para evitar escalada via UPDATE no USING
CREATE POLICY "rp_write" ON public.replenishment_params
  FOR ALL TO authenticated
  USING (
    public.get_org_role(auth.uid(), organization_id)
      = ANY (ARRAY['owner', 'admin']::public.org_role[])
  )
  WITH CHECK (
    public.get_org_role(auth.uid(), organization_id)
      = ANY (ARRAY['owner', 'admin']::public.org_role[])
  );

-- --------------------------------------------------------
-- Índice para lookup rápido por org/scope/scope_value
-- --------------------------------------------------------
CREATE INDEX replenishment_params_org_idx
  ON public.replenishment_params (organization_id, scope, scope_value);
