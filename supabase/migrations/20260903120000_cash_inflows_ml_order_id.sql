-- ============================================================
-- 225-01 — cash_inflows.ml_order_id: a chave que o Mercado Pago
--          já entregava e a ingestão jogava fora.
-- ============================================================
-- Fase 225 (conciliação de cobranças do ML), plano 01.
--
-- POR QUE ESTA COLUNA EXISTE: sem ela a pergunta "esta venda foi repassada?"
-- não tem resposta possível. `cash_inflows` guarda `payment_id`, datas e
-- valores, e nada que ligue o dinheiro à venda. A única conta disponível é
-- contar linhas por mês, e ela é inconclusiva POR CONSTRUÇÃO: `release_date`
-- é a data em que o dinheiro liberou, não a da venda — uma venda de 31/03
-- libera em abril.
--
-- DE ONDE VEM O VALOR: `order.id` do payload de `/v1/payments/search` do
-- Mercado Pago, que a edge function `sync-mp-releases` JÁ lia (para filtrar
-- `order.type === 'mercadolibre'`) e descartava no upsert. Chave provada 3/3
-- ao vivo em 03/09/2026: payments 175133468362 / 174415284727 / 175413095610
-- casaram com os pedidos 2000018066036962 / 2000018088160544 / 2000018093886340,
-- com título e SKU idênticos.
--
-- ESTA MIGRATION É ADITIVA. Nenhuma das 14 funções que leem `cash_inflows`
-- muda aqui: o research (Q6) verificou com `pg_get_functiondef` que nenhuma
-- delas faz `SELECT *` contra a tabela. O defeito do estorno somado como
-- entrada em `get_dre_cash` é da FASE 237 — misturar as duas destrói a
-- rastreabilidade de qual fase corrigiu o quê.
-- ============================================================

-- ─── 1. A coluna ───────────────────────────────────────────────────────────
-- `text` porque `public.orders.ml_order_id` é `text`, e o join de conciliação
-- tem que ser do mesmo tipo (join entre text e bigint não usa índice).
ALTER TABLE public.cash_inflows
  ADD COLUMN IF NOT EXISTS ml_order_id text;

-- ─── 2. A unidade e a cardinalidade, gravadas na própria coluna ────────────
COMMENT ON COLUMN public.cash_inflows.ml_order_id IS
  'ID do pedido no Mercado Livre (order.id do payload de /v1/payments/search do '
  'Mercado Pago), gravado pela EF sync-mp-releases. Unidade: identificador, nunca '
  'valor. Cardinalidade 1:N — UM pedido pode ter VÁRIOS pagamentos (split payment, '
  'tentativa recusada + tentativa boa, expiração + nova tentativa): 7,7% dos pedidos '
  'da PV têm mais de um payment_id (141 de 1.826 medidos entre 01/07 e 03/09/2026). '
  'Por isso a coluna NÃO tem constraint de unicidade — teria transformado 7,7% dos '
  'pedidos em erro de upsert. NULA em toda entrada que não seja venda do ML.';

-- ─── 3. O índice parcial ───────────────────────────────────────────────────
-- A leitura quente é o `GROUP BY ml_order_id` da RPC de conciliação (plano 02).
-- Parcial porque linha com `ml_order_id` nulo nunca é procurada por esta chave —
-- indexá-la só engorda o índice sem servir a nenhuma consulta.
CREATE INDEX IF NOT EXISTS cash_inflows_org_ml_order_idx
  ON public.cash_inflows (organization_id, ml_order_id)
  WHERE ml_order_id IS NOT NULL;

-- ─── 4. Guardas finais: falha alto em vez de aplicar pela metade ───────────
-- Molde: supabase/migrations/20260821100000_ml_order_sale_fee.sql:263-306,
-- adaptado de CREATE TABLE para ALTER TABLE. A tabela JÁ tinha RLS antes deste
-- arquivo — esta guarda existe para PROVAR que continua tendo depois, não para
-- criar. Policy é por LINHA, não por coluna: nada a recriar aqui.
DO $$
DECLARE
  v_rls_ligada    boolean;
  v_policies      integer;
  v_sem_org       integer;
  v_coluna        integer;
  v_unicidade     integer;
BEGIN
  -- 4.1 A coluna existe e é do tipo certo
  SELECT count(*) INTO v_coluna
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'cash_inflows'
     AND column_name  = 'ml_order_id'
     AND data_type    = 'text'
     AND is_nullable  = 'YES';

  IF v_coluna <> 1 THEN
    RAISE EXCEPTION 'cash_inflows.ml_order_id nao existe como text nulavel';
  END IF;

  -- 4.2 Nenhuma constraint de unicidade sobre a coluna (split payment é legítimo)
  SELECT count(*) INTO v_unicidade
    FROM pg_index i
    JOIN pg_class c        ON c.oid = i.indrelid
    JOIN pg_namespace n    ON n.oid = c.relnamespace
    JOIN pg_attribute a    ON a.attrelid = c.oid AND a.attnum = ANY (i.indkey)
   WHERE n.nspname = 'public'
     AND c.relname = 'cash_inflows'
     AND a.attname = 'ml_order_id'
     AND i.indisunique;

  IF v_unicidade > 0 THEN
    RAISE EXCEPTION 'cash_inflows.ml_order_id nao pode ter unicidade — 7,7%% dos pedidos tem mais de um pagamento (split payment)';
  END IF;

  -- 4.3 A seguranca de linha sobreviveu ao ALTER
  SELECT c.relrowsecurity INTO v_rls_ligada
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'cash_inflows';

  IF v_rls_ligada IS NOT TRUE THEN
    RAISE EXCEPTION 'tabela cash_inflows nao tem seguranca de linha ligada';
  END IF;

  -- 4.4 Continua havendo policy
  SELECT count(*) INTO v_policies
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'cash_inflows';

  IF v_policies = 0 THEN
    RAISE EXCEPTION 'tabela cash_inflows nao tem nenhuma policy';
  END IF;

  -- 4.5 A policy de leitura continua checando a organizacao
  SELECT count(*) INTO v_sem_org
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'cash_inflows'
     AND cmd = 'SELECT'
     AND (qual IS NULL OR qual NOT ILIKE '%is_org_member%');

  IF v_sem_org > 0 THEN
    RAISE EXCEPTION 'tabela cash_inflows tem policy de leitura sem checagem de organizacao (is_org_member)';
  END IF;
END $$;
