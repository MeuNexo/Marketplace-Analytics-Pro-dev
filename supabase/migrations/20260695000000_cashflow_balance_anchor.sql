-- ============================================================
-- Phase 95 (Parte A) — coluna balance_anchor_date + get_rolled_opening_balance
-- ============================================================
-- Objetivo: eliminar o furo do saldo de abertura que envelhece. Hoje as 3 RPCs
-- de fluxo de caixa (get_cashflow, get_projected_balance_summary,
-- get_treasury_panel) leem financial_settings.initial_balance CRU, sem noção
-- de quando esse valor foi digitado — se Wesley digita o saldo uma vez e não
-- reancora por 18 dias, o "hoje" da curva já está 18 dias desatualizado.
--
-- Esta migration cria a base do modelo "âncora + roll-forward" travado por
-- Wesley (95-CONTEXT.md):
--
--   1. financial_settings.balance_anchor_date DATE (nullable, aditivo,
--      IF NOT EXISTS) — data em que initial_balance foi de fato digitado.
--   2. Backfill idempotente das linhas existentes: balance_anchor_date =
--      updated_at::date, SOMENTE onde ainda está NULL (decisão travada pelo
--      Wesley — aproximação de melhor esforço, ver Pitfall 2 do RESEARCH).
--   3. get_rolled_opening_balance(p_org_id uuid) RETURNS numeric — lógica do
--      roll-forward centralizada num único lugar, consumida pelas 3 RPCs na
--      próxima migration (20260695000100).
--
-- Fórmula (travada por Wesley):
--   saldo_abertura_hoje = âncora + Σ cash_inflows.net_amount (release_date no
--     intervalo [anchor_date, hoje)) − Σ cash_outflows.amount SOMENTE
--     status='paid' (outflow_date no intervalo [anchor_date, hoje)).
--
-- CRÍTICO (Pitfall 5, 95-RESEARCH.md): o filtro de saída do roll-forward é
-- status='paid' — dinheiro que JÁ SAIU entre a âncora e hoje. Isto é
-- INTENCIONALMENTE diferente do filtro status='pending' usado na CTE `exp` de
-- get_cashflow (série FUTURA — contas em aberto ainda não pagas). Mesma
-- tabela, mesma coluna, duas semânticas diferentes conforme a data é passado
-- (âncora→hoje, "o que já saiu") ou futuro (hoje→fim, "o que ainda vai sair").
--
-- Intervalo semi-aberto [anchor_date, hoje): se anchor_date = hoje, o
-- intervalo é vazio (v_inc=0, v_paid_exp=0) e a função retorna a âncora crua —
-- não-regressão travada pelo Wesley (teste-âncora obrigatório).
--
-- SEGURANÇA (padrão do domínio — ver Pattern 1, 95-RESEARCH.md):
--   SECURITY INVOKER, SEM checagem manual de org dentro da função. O guard
--   real é o RLS is_org_member(auth.uid(), organization_id) das 3 tabelas
--   lidas (financial_settings, cash_inflows, cash_outflows) — todas já têm
--   essa policy de SELECT (20260618100000_cash_flow_tables.sql). DEFINER +
--   p_org_id por parâmetro seria IDOR (caller poderia passar qualquer org_id).
--
-- Molde de coluna aditiva + backfill idempotente:
--   supabase/migrations/20260686000000_cash_outflows_competence_date.sql
-- Padrão "hoje" = BRT: supabase/migrations/20260619020000_cashflow_brt_timezone.sql
--
-- NOTA de timestamp (Pitfall 4, 95-RESEARCH.md): este checkout está um
-- commit atrás do main em migrations (main já tem 20260694000000, ausente
-- aqui). Timestamp 20260695000000 escolhido > 20260694000000 para não
-- colidir. O plano 95-03 confere o max real do banco via MCP antes de aplicar
-- e renumera se necessário.
--
-- Apply via MCP apply_migration no projeto ckcdevcxgvueywivefgx.
-- NUNCA `supabase db push` (sem token de CLI para este projeto).
-- ============================================================

-- ── 1. Coluna nova, nullable, aditiva ──────────────────────────────────────
ALTER TABLE public.financial_settings
  ADD COLUMN IF NOT EXISTS balance_anchor_date date;

-- ── 2. Backfill idempotente (só onde ainda está NULL) ──────────────────────
-- Decisão travada pelo Wesley: backfill = updated_at::date (aproximação de
-- melhor esforço — não há trigger de updated_at nesta tabela hoje, então o
-- valor pode refletir a data de criação/seed da linha, não a última edição
-- real; aceito conscientemente, ver Pitfall 2 do RESEARCH).
UPDATE public.financial_settings
   SET balance_anchor_date = updated_at::date
 WHERE balance_anchor_date IS NULL;

-- ── 3. get_rolled_opening_balance ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_rolled_opening_balance(p_org_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql SECURITY INVOKER SET search_path = 'public'
AS $$
DECLARE
  v_today       DATE    := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_anchor_date DATE;
  v_anchor_bal  NUMERIC := 0;
  v_inc         NUMERIC := 0;
  v_paid_exp    NUMERIC := 0;
BEGIN
  SELECT fs.balance_anchor_date, fs.initial_balance
    INTO v_anchor_date, v_anchor_bal
  FROM public.financial_settings fs
  WHERE fs.organization_id = p_org_id
  LIMIT 1;

  IF v_anchor_date IS NULL THEN
    -- Org sem âncora ainda (ou sem linha em financial_settings): comportamento
    -- atual, saldo cru sem roll-forward.
    RETURN COALESCE(v_anchor_bal, 0);
  END IF;

  -- Entradas confirmadas do Mercado Pago no intervalo [anchor_date, hoje).
  SELECT COALESCE(SUM(ci.net_amount), 0) INTO v_inc
  FROM public.cash_inflows ci
  WHERE ci.organization_id = p_org_id
    AND ci.release_date >= v_anchor_date
    AND ci.release_date <  v_today;

  -- Saídas JÁ PAGAS (Tiny) no intervalo [anchor_date, hoje). SOMENTE
  -- status='paid' — NÃO reusar o filtro 'pending' da série futura de
  -- get_cashflow (Pitfall 5): aqui o objetivo é o dinheiro que de fato saiu
  -- entre a âncora e hoje, não o que ainda está em aberto.
  SELECT COALESCE(SUM(co.amount), 0) INTO v_paid_exp
  FROM public.cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.status = 'paid'
    AND co.outflow_date >= v_anchor_date
    AND co.outflow_date <  v_today;

  -- anchor_date = hoje → intervalo [hoje, hoje) vazio → v_inc=0, v_paid_exp=0
  -- → retorna v_anchor_bal cru (não-regressão, teste-âncora travado pelo
  -- Wesley).
  RETURN v_anchor_bal + v_inc - v_paid_exp;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_rolled_opening_balance(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_rolled_opening_balance(UUID) TO authenticated, service_role;
