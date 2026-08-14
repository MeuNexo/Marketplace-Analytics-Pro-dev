-- Snapshot de reversão de `orders` ANTES da primeira escrita da régua nova
-- (Fase 222, plano 222-05-R).
--
-- MOMENTO DE APLICAÇÃO: **primeiro de todos**. Nenhuma outra migration desta
-- fase, nenhum deploy de edge function e nenhum backfill pode entrar antes de
-- esta ter sido aplicada E a contagem conferida contra a origem, registro a
-- registro. Reescrita de dado fiscal é o único erro irreversível desta fase.
--
-- POR QUE O RECORTE POR LOJA, E NÃO `FROM orders` INTEIRA: a conta da Thales
-- (loja 427063369) tem ~359 mil pedidos e esta fase a proíbe de ser tocada em
-- passo nenhum. Copiá-la aqui não protegeria nada e arrastaria o volume inteiro
-- para dentro de um projeto que já teve colapso por disco cheio (07/07/2026).
-- O recorte é por `ml_user_id` porque é por ele que o backfill e o botão
-- "Recalcular" da tela de pedidos filtram — a proteção tem de ter exatamente a
-- mesma forma do risco.
--
-- POR QUE SEM RECORTE DE DATA: o botão "Recalcular" de `MLPedidos.tsx` invoca
-- `recalc-order-costs` com `only_missing: false` sobre a janela que estiver na
-- tela, qualquer que seja. Recortar o snapshot por mês deixaria buraco
-- exatamente onde alguém pode reescrever amanhã.
--
-- POR QUE EM MIGRATION, E NÃO EM `execute_sql` AVULSO: tabela criada fora de
-- migration nasce SEM RLS e o lint não pega (feedback_tabela_de_execucao_
-- nasce_sem_rls — três tabelas da Fase 214 nasceram abertas para `anon` assim).
-- Aqui a RLS é ligada e os privilégios revogados na MESMA migration.
--
-- QUANDO PODE SER DESCARTADA: só depois do aceite do Wesley (Task 7 do
-- 222-05-R). Enquanto ele não aceitar o número novo, esta tabela fica.

-- ─── Guarda de entrada: um segundo snapshot valeria nada ────────────────────
-- Se esta migration rodar de novo DEPOIS do backfill, a "reversão" seria uma
-- cópia do estado já reescrito. Falha alto em vez de fabricar uma rede de
-- segurança falsa.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'orders_pre_222'
  ) THEN
    RAISE EXCEPTION 'public.orders_pre_222 já existe: um segundo snapshot seria tirado depois da escrita e não serviria de reversão. Confira a tabela existente antes de qualquer coisa.';
  END IF;
END $$;

-- ─── Cópia ──────────────────────────────────────────────────────────────────
-- Colunas de identidade, data, receita, custo, frete e fiscais. Dados de
-- comprador (nome, cidade) ficam de fora de propósito: não são necessários
-- para reverter imposto e não têm por que ser duplicados.
CREATE TABLE public.orders_pre_222 AS
SELECT
  o.id,
  o.ml_order_id,
  o.ml_user_id,
  o.organization_id,
  o.item_id,
  o.sku,
  o.data_pedido,
  o.status,
  o.estado,
  o.quantidade,
  o.preco_unit,
  o.comissao,
  o.frete,
  o.receita_bruta,
  o.receita_liquida,
  o.custo_unit,
  o.custo_unit_cheio,
  o.bonus_envio,
  o.custo_entrega,
  o.logistic_type,
  o.uf_origem,
  o.tax_rate,
  o.tax_amount,
  o.tax_versao,
  o.icms_debito,
  o.pis_cofins_debito,
  o.credito_pc_comissao,
  o.credito_pc_frete,
  o.credito_icms_frete,
  o.pis_cofins_debito_com_difal,
  o.difal_base,
  o.difal_amount,
  o.fcp_amount,
  o.difal_fonte,
  o.synced_at,
  now() AS snapshot_em
FROM public.orders o
WHERE o.ml_user_id IN ('1639558873', '2359559427');

CREATE INDEX IF NOT EXISTS orders_pre_222_id_idx
  ON public.orders_pre_222 (id);
CREATE INDEX IF NOT EXISTS orders_pre_222_loja_idx
  ON public.orders_pre_222 (ml_user_id);

COMMENT ON TABLE public.orders_pre_222 IS
  'Snapshot de reversão de public.orders tirado ANTES do backfill da régua '
  'fiscal da Fase 222 (plano 222-05-R), restrito às lojas 1639558873 '
  '(Pé Vermeio) e 2359559427 (Junior) — a conta da Thales fica fora por '
  'construção. Reverter = UPDATE orders o SET ... FROM orders_pre_222 s WHERE '
  's.id = o.id. Pode ser descartada SOMENTE após o aceite do Wesley (Task 7 do '
  '222-05-R); não confundir com public.orders_pre_tax_junior_jul, que é o '
  'snapshot da correção manual de julho de 14/08 e sobrevive junto.';

-- ─── RLS e privilégios, na MESMA migration que cria a tabela ────────────────
-- Cópia de dado financeiro por pedido. Ninguém precisa lê-la pela API: a
-- reversão é operação de service_role, que ignora RLS. RLS ligada SEM policy
-- nenhuma = nenhum papel autenticado enxerga linha alguma.
ALTER TABLE public.orders_pre_222 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.orders_pre_222 FROM anon;
REVOKE ALL ON public.orders_pre_222 FROM authenticated;

-- ─── Guarda de saída: o snapshot tem de bater com a origem ──────────────────
DO $$
DECLARE
  v_snapshot bigint;
  v_origem   bigint;
  v_thales   bigint;
BEGIN
  SELECT count(*) INTO v_snapshot FROM public.orders_pre_222;
  SELECT count(*) INTO v_origem
    FROM public.orders
   WHERE ml_user_id IN ('1639558873', '2359559427');

  IF v_snapshot <> v_origem THEN
    RAISE EXCEPTION 'snapshot não bate com a origem: orders_pre_222 tem % linhas, orders (2 lojas em escopo) tem %', v_snapshot, v_origem;
  END IF;

  IF v_snapshot = 0 THEN
    RAISE EXCEPTION 'snapshot vazio: nenhuma linha copiada para orders_pre_222 — o recorte por ml_user_id não encontrou pedido nenhum das duas lojas em escopo';
  END IF;

  -- Nenhuma loja fora das duas em escopo pode ter entrado.
  SELECT count(*) INTO v_thales
    FROM public.orders_pre_222
   WHERE ml_user_id NOT IN ('1639558873', '2359559427');

  IF v_thales > 0 THEN
    RAISE EXCEPTION 'snapshot fora de escopo: % linha(s) de loja que não é Pé Vermeio nem Junior entraram em orders_pre_222', v_thales;
  END IF;
END $$;
