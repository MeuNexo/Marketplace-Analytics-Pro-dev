-- ============================================================
-- Phase 49 Fluxo de Caixa — Tabelas de caixa real (entradas + saídas + config)
-- ============================================================
--
-- Cria 3 tabelas:
--
--   1. financial_settings   — parâmetros de caixa por org (CASH-06).
--                             1 linha por organization_id (UNIQUE).
--                             Defaults: initial_balance=0, operational_cost_rate=0.22,
--                             safety_margin=10000.
--                             SELECT = qualquer membro da org; ALL (escrita) = owner only.
--
--   2. cash_inflows         — liberações reais do Mercado Pago, ingeridas pela EF
--                             sync-mp-releases (CASH-01).
--                             UNIQUE (organization_id, payment_id) — idempotente.
--                             release_date tipo DATE (não timestamptz — Armadilha 3).
--                             SELECT = qualquer membro da org; escrita = service role only.
--
--   3. cash_outflows        — contas a pagar do Tiny ERP, ingeridas pela EF
--                             sync-tiny-payables (CASH-02 atualizado — Wesley 2026-06-18).
--                             outflow_date tipo DATE (não timestamptz — Armadilha 3).
--                             Colunas Tiny: supplier, source, tiny_payable_id,
--                             document_number, synced_at.
--                             UNIQUE (organization_id, tiny_payable_id) — aceita múltiplos
--                             NULLs (source='manual'); EF de saídas grava source='tiny'.
--                             SELECT = qualquer membro da org; escrita = service role only.
--
-- RLS org-first: is_org_member(auth.uid(), organization_id) — uid PRIMEIRO, org SEGUNDO.
-- Fonte do padrão: supabase/migrations/20260645000000_consultor_tables.sql
--
-- Idempotência: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS antes de recriar,
--   constraints via DO/EXCEPTION WHEN duplicate_object THEN NULL.
-- Seguro rodar múltiplas vezes.
--
-- Supabase project: ckcdevcxgvueywivefgx (NÃO usar gionpsuunfkkzzjdubfy).
-- ============================================================

-- ============================================================
-- TABELA 1: financial_settings
-- ============================================================
-- Parâmetros de caixa por org (CASH-06). 1 linha por org.

CREATE TABLE IF NOT EXISTS public.financial_settings (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  initial_balance       numeric     NOT NULL DEFAULT 0,
  operational_cost_rate real        NOT NULL DEFAULT 0.22,
  safety_margin         numeric     NOT NULL DEFAULT 10000,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- UNIQUE por org (1 linha de configuração por organização)
DO $$ BEGIN
  ALTER TABLE public.financial_settings
    ADD CONSTRAINT financial_settings_org_unique UNIQUE (organization_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.financial_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "financial_settings_select" ON public.financial_settings';
  EXECUTE 'DROP POLICY IF EXISTS "financial_settings_write" ON public.financial_settings';
END $$;

-- SELECT: qualquer membro da org pode ler os parâmetros de caixa
CREATE POLICY "financial_settings_select"
  ON public.financial_settings
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- ALL (escrita): somente owner pode modificar os parâmetros financeiros
CREATE POLICY "financial_settings_write"
  ON public.financial_settings
  FOR ALL
  TO authenticated
  USING  (public.get_org_role(auth.uid(), organization_id) = 'owner'::public.org_role)
  WITH CHECK (public.get_org_role(auth.uid(), organization_id) = 'owner'::public.org_role);


-- ============================================================
-- TABELA 2: cash_inflows
-- ============================================================
-- Liberações reais do Mercado Pago, ingeridas pela EF sync-mp-releases (CASH-01).
-- release_date é tipo DATE (não timestamptz) — cálculo de caixa por dia, sem timezone.

CREATE TABLE IF NOT EXISTS public.cash_inflows (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ml_user_id       bigint      NOT NULL,        -- seller_id (vínculo com ml_tokens)
  payment_id       text        NOT NULL,        -- ID do payment no Mercado Pago
  release_date     date        NOT NULL,        -- money_release_date[:10]
  net_amount       numeric     NOT NULL,        -- transaction_details.net_received_amount
  gross_amount     numeric,                     -- transaction_amount
  status_mp        text,                        -- approved / in_mediation / refunded
  payment_method   text,                        -- pix / credit_card / etc.
  description      text,
  synced_at        timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- UNIQUE para idempotência de upsert (EF re-executa sem duplicar)
DO $$ BEGIN
  ALTER TABLE public.cash_inflows
    ADD CONSTRAINT cash_inflows_unique_payment UNIQUE (organization_id, payment_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Índice para queries de período por org
CREATE INDEX IF NOT EXISTS cash_inflows_org_date_idx
  ON public.cash_inflows (organization_id, release_date);

ALTER TABLE public.cash_inflows ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "cash_inflows_select" ON public.cash_inflows';
END $$;

-- SELECT: qualquer membro da org pode ler as entradas de caixa
CREATE POLICY "cash_inflows_select"
  ON public.cash_inflows
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- INSERT/UPDATE/DELETE: service role only (EF sync-mp-releases escreve;
-- service role ignora RLS). Nenhuma policy de escrita para 'authenticated'.


-- ============================================================
-- TABELA 3: cash_outflows
-- ============================================================
-- Contas a pagar do Tiny ERP (CASH-02 — decisão Wesley 2026-06-18).
-- outflow_date é tipo DATE (não timestamptz) — Armadilha 3 do RESEARCH.
-- Colunas Tiny: supplier, source, tiny_payable_id, document_number, synced_at.
-- UNIQUE (organization_id, tiny_payable_id) — aceita múltiplos NULLs em PostgreSQL
-- (source='manual' → tiny_payable_id NULL; source='tiny' → tiny_payable_id preenchido).

CREATE TABLE IF NOT EXISTS public.cash_outflows (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  outflow_date     date        NOT NULL,        -- data efetiva da saída (pagamento ou vencimento)
  amount           numeric     NOT NULL,        -- valor positivo da saída
  description      text        NOT NULL,        -- historico / descricao do Tiny
  supplier         text,                        -- contato.nome / nomeFornecedor
  category         text,                        -- tipo da conta no Tiny
  status           text        NOT NULL DEFAULT 'pending',
  document_number  text,                        -- numeroDocumento (boleto, NF, etc.)
  source           text        NOT NULL DEFAULT 'manual',
  tiny_payable_id  text,                        -- id do Tiny (chave de idempotência)
  synced_at        timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- CHECK idempotente: status válido
DO $$ BEGIN
  ALTER TABLE public.cash_outflows
    ADD CONSTRAINT cash_outflows_status_check
    CHECK (status IN ('pending', 'paid'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CHECK idempotente: source válido
DO $$ BEGIN
  ALTER TABLE public.cash_outflows
    ADD CONSTRAINT cash_outflows_source_check
    CHECK (source IN ('manual', 'tiny'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- UNIQUE de idempotência Tiny: aceita múltiplos NULLs (PostgreSQL: NULL != NULL)
-- source='manual' → tiny_payable_id NULL → múltiplos registros manuais OK
-- source='tiny'   → tiny_payable_id preenchido → dedup pelo id do Tiny
DO $$ BEGIN
  ALTER TABLE public.cash_outflows
    ADD CONSTRAINT cash_outflows_tiny_unique UNIQUE (organization_id, tiny_payable_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Índice para queries de período por org
CREATE INDEX IF NOT EXISTS cash_outflows_org_date_idx
  ON public.cash_outflows (organization_id, outflow_date);

ALTER TABLE public.cash_outflows ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "cash_outflows_select" ON public.cash_outflows';
END $$;

-- SELECT: qualquer membro da org pode ler as saídas de caixa
CREATE POLICY "cash_outflows_select"
  ON public.cash_outflows
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- INSERT/UPDATE/DELETE: service role only (EF sync-tiny-payables escreve;
-- service role ignora RLS). Nenhuma policy de escrita para 'authenticated'.
