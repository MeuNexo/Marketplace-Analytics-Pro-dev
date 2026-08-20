-- ────────────────────────────────────────────────────────────────────────────
-- As três tabelas do rebate por pedido (Fase 223, plano 223-03, D-223-04/05).
--
-- POR QUE TABELA NOVA, E NÃO REVIVER O STAGE: `ml_billing_moves_stage` e
-- `ml_billing_page_cursor` nasceram de `execute_sql` direto em produção — não
-- têm migration, não aparecem nos tipos gerados, e ninguém sabe se têm RLS
-- (D-223-04). Construir em cima delas seria herdar o problema. Estas três
-- tabelas nascem VERSIONADAS, com RLS na mesma migration.
--
-- POR QUE A MARCA DE PROCESSADO É OBRIGATÓRIA: `/group/ML/order/details` é o
-- endpoint CAMPEÃO de 429 no ML, e o bloqueio é POR IP — reconsultar um
-- pedido já capturado derruba `sync-ml-orders`, `sync-ml-billing` e a
-- sincronização de ads junto (D-223-05, ML-BILLING-API-DOC.txt linhas
-- 194-211). `ml_order_sale_fee_captura` é essa marca, por pedido.
--
-- 🔴 POR QUE NÃO HÁ RATEIO: o plano original desta fase supunha que um
-- pedido de carrinho teria N linhas em `orders` para o mesmo `ml_order_id`,
-- exigindo distribuir o rebate entre elas. Medido em produção (223-01):
-- `orders` é 1:1 com o pedido do ML — julho/2026 tem 1.136 linhas para 1.136
-- pedidos distintos, zero multilinha, e a tabela não tem coluna de pacote.
-- A chave é `(organization_id, ml_order_id)`, direto. O que existe no lugar
-- do rateio é um MULTIPLICADOR — `orders.quantidade` — consumido pela
-- Identidade (II) em `orderSaleFee.ts` (223-03, Task 1), não por esta
-- migration: nenhuma expressão de divisão de rebate por comissão mora aqui.
--
-- 🔴 A UNIDADE DE CADA GRANDEZA DE VALOR (a armadilha desta fase, declarada
-- em cada coluna abaixo):
--   · as quatro colunas `sale_fee_*` de `ml_order_sale_fee_captura` e
--     `detail_amount`/`comissao_linhas` — TOTAL do pedido (raiz do
--     `results[]` e soma de linhas de cobrança, ambos medidos em 223-01)
--   · `orders.comissao` (fora desta migration) — POR UNIDADE
-- Misturar as duas bases produziu o defeito ativo registrado em
-- `223-CONTRATO-SALE-FEE.md`: comissão gravada subestimada em todo pedido de
-- quantidade > 1 (medido: Pé Vermeio R$ 713,41 em 62 pedidos; Thales e Junior
-- são extrapolação da regra, não medição). NÃO SE CORRIGE AQUI — é
-- `sync-ml-orders`, outra fase, mexe em número que a contadora já validou.
--
-- POR QUE NENHUM UUID É SEMEADO: `ml_sale_fee_sync_config` nasce vazia.
-- UUID de organização não é completado por prefixo nesta casa — quem semeia
-- as duas linhas (Pé Vermeio + Junior, D-223-02/D-223-03) é o portão de
-- produção, com o nome da organização conferido na tela.
--
-- APLICAÇÃO É PORTÃO DO ORQUESTRADOR: este plano só escreve o arquivo.
-- Aplicar via MCP `apply_migration` no projeto `ckcdevcxgvueywivefgx` — NUNCA
-- SQL Editor, NUNCA `supabase db push` — é passo do 223-08.
-- ────────────────────────────────────────────────────────────────────────────

-- ─── 1. ml_order_sale_fee — grão de LINHA DE COBRANÇA (details[]) ───────────
--
-- Todas as linhas do payload são persistidas aqui, inclusive frete (CFFE),
-- parcelamento (CFONPN) e estorno (BVVML/BVVPRC) — descartar campo do
-- payload foi o defeito de origem desta fase (223-CONTRATO-SALE-FEE.md, Q2).
--
-- `detail_id` foi medido presente e único em 25/25 linhas da amostra (Q2):
-- é a chave natural, não há chave sintética a inventar, e é ela que torna o
-- upsert idempotente.
CREATE TABLE IF NOT EXISTS public.ml_order_sale_fee (
  organization_id            uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ml_user_id                 text        NOT NULL,
  ml_order_id                text        NOT NULL,
  detail_id                  bigint      NOT NULL,
  item_id                    text        NULL,
  detail_type                text        NULL,
  detail_sub_type            text        NULL,
  detail_amount               numeric     NULL,
  -- Aponta o detail_id da cobrança estornada — só preenchido em linhas BONUS.
  charge_bonified_id          bigint      NULL,
  charge_status                text        NULL,
  charge_status_description    text        NULL,
  capturado_em                  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (organization_id, ml_order_id, detail_id)
);

COMMENT ON COLUMN public.ml_order_sale_fee.detail_amount IS
  'Valor da linha de cobrança, TOTAL do pedido (nao por unidade) — medido em '
  '223-01. Frete (CFFE), parcelamento (CFONPN) e estorno (BVVML/BVVPRC) estao '
  'aqui tambem: nada do payload e descartado.';
COMMENT ON COLUMN public.ml_order_sale_fee.charge_bonified_id IS
  'Em linhas detail_type=BONUS, aponta o detail_id da cobranca original '
  'estornada por cancelamento (Q4, 223-CONTRATO-SALE-FEE.md). E o que separa '
  'estorno de promocao — os dois usam o mesmo par de campos (charge_status) '
  'no payload cru.';
COMMENT ON COLUMN public.ml_order_sale_fee.charge_status IS
  'charge_info.status medido (ex.: BONUS_ON_BILL = "Cancelado neste mes"). '
  'Distingue cancelamento de promocao junto com detail_type/charge_bonified_id.';

CREATE INDEX IF NOT EXISTS ml_order_sale_fee_pedido_idx
  ON public.ml_order_sale_fee (organization_id, ml_order_id);

CREATE INDEX IF NOT EXISTS ml_order_sale_fee_item_idx
  ON public.ml_order_sale_fee (organization_id, item_id);

-- ─── 2. ml_order_sale_fee_captura — a marca de processado, grão de PEDIDO ───
--
-- É onde vive o sale_fee da RAIZ do result (Q1: um results[] por order_id,
-- sale_fee ao lado de details, nunca dentro de sales_info) e o estado da
-- captura que D-223-05 exige — sem ela, a ingestao reconsulta pedido ja
-- visto e derruba o IP.
CREATE TABLE IF NOT EXISTS public.ml_order_sale_fee_captura (
  organization_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ml_user_id            text        NOT NULL,
  ml_order_id            text        NOT NULL,
  -- Os quatro valores que o nucleo puro (orderSaleFee.ts, StatusCaptura) decide.
  status                  text        NOT NULL,
  http_status              int         NULL,
  tentativas                int         NOT NULL DEFAULT 0,
  linhas                    int         NOT NULL DEFAULT 0,
  sale_fee_gross            numeric     NULL,
  sale_fee_net              numeric     NULL,
  sale_fee_rebate           numeric     NULL,
  sale_fee_discount         numeric     NULL,
  discount_reason            text        NULL,
  -- Identidade (I): soma de detail_amount das linhas CVV*. Existe para
  -- conferir a leitura SEM depender de orders (223-CONTRATO-SALE-FEE.md).
  comissao_linhas             numeric     NULL,
  tem_estorno                  boolean     NOT NULL DEFAULT false,
  capturado_em                   timestamptz NULL,
  ultima_tentativa                timestamptz NOT NULL DEFAULT now(),
  proxima_tentativa                timestamptz NULL,

  PRIMARY KEY (organization_id, ml_order_id),

  CONSTRAINT ml_order_sale_fee_captura_status_valido CHECK (
    status IN ('ok', 'parcial', 'sem_linha', 'erro')
  ),

  -- D-223-05, no nivel do banco: um pedido so pode estar CAPTURADO (ok) se
  -- os tres valores de sale_fee que autorizam afirmar rebate estiverem
  -- preenchidos. Regra de negocio virando regra de banco.
  CONSTRAINT ml_order_sale_fee_captura_ok_tem_sale_fee CHECK (
    status <> 'ok'
    OR (sale_fee_gross IS NOT NULL AND sale_fee_net IS NOT NULL AND sale_fee_rebate IS NOT NULL)
  ),

  -- D-223-05, a proibicao central: resposta 206 (dado incompleto) NUNCA vira
  -- rebate zero. Um pedido PARCIAL nao pode ter sale_fee_rebate preenchido —
  -- se tivesse, alguem teria afirmado um rebate a partir de dado incompleto.
  CONSTRAINT ml_order_sale_fee_captura_parcial_sem_rebate CHECK (
    status <> 'parcial' OR sale_fee_rebate IS NULL
  ),

  -- A identidade gross - rebate == net (7/7 na amostra medida) vira
  -- invariante do banco quando o pedido esta capturado.
  CONSTRAINT ml_order_sale_fee_captura_identidade_gross_rebate_net CHECK (
    status <> 'ok'
    OR ABS((sale_fee_gross - sale_fee_rebate) - sale_fee_net) <= 0.01
  )
);

COMMENT ON COLUMN public.ml_order_sale_fee_captura.sale_fee_gross IS
  'sale_fee.gross da RAIZ do result, TOTAL do pedido (Q1/Q3, 223-01). NAO e '
  'por unidade — orders.comissao e que e por unidade.';
COMMENT ON COLUMN public.ml_order_sale_fee_captura.sale_fee_net IS
  'sale_fee.net da RAIZ do result, TOTAL do pedido. Identidade (II): '
  'sale_fee_net == orders.comissao x orders.quantidade — NUNCA orders.comissao '
  'sozinha, sob pena de acusar 62 pedidos bons como divergentes so na Pe Vermeio.';
COMMENT ON COLUMN public.ml_order_sale_fee_captura.sale_fee_rebate IS
  'sale_fee.rebate da RAIZ do result, TOTAL do pedido. AUSENTE (NULL) em '
  'resposta parcial (206) — nunca zero por omissao (D-223-05). Zero e um valor '
  'medido (nao houve campanha); NULL e "nao sei ainda".';
COMMENT ON COLUMN public.ml_order_sale_fee_captura.comissao_linhas IS
  'Identidade (I): soma de detail_amount das linhas CHARGE de subtipo CVV* '
  '(ml_order_sale_fee), TOTAL do pedido. Prova interna de que a leitura pegou '
  'as linhas certas, sem depender de orders.';
COMMENT ON COLUMN public.ml_order_sale_fee_captura.tem_estorno IS
  'true quando o pedido tem ao menos uma linha detail_type=BONUS (estorno por '
  'cancelamento, Q4). NUNCA e o mesmo fato que sale_fee_rebate preenchido — os '
  'dois convivem no mesmo pedido cancelado (medido: 2000017822557678, rebate '
  '21,17 E estorno, ao mesmo tempo) e um nao apaga o outro.';
COMMENT ON COLUMN public.ml_order_sale_fee_captura.status IS
  'Os quatro estados do nucleo puro (orderSaleFee.ts, StatusCaptura): '
  '"ok" (capturado, autoriza afirmar rebate) · "parcial" (206, reconsultar '
  'depois, NUNCA zero) · "sem_linha" (pedido sem linha de faturamento, teto de '
  'tentativas) · "erro" (o lote inteiro falhou, nada foi gravado).';

-- Indice parcial: a consulta de retomada do backfill/cron so olha pedidos que
-- ainda nao estao capturados. Roda a cada lote (223-04/223-08).
CREATE INDEX IF NOT EXISTS ml_order_sale_fee_captura_retomada_idx
  ON public.ml_order_sale_fee_captura (organization_id, ml_user_id, proxima_tentativa)
  WHERE status <> 'ok';

-- ─── 3. ml_sale_fee_sync_config — quais contas, desde quando ────────────────
--
-- Codifica D-223-02 (so 2026) e D-223-03 (Pe Vermeio + Junior, Thales fora)
-- como DADO, nao constante em codigo.
--
-- 🔴 NASCE VAZIA. Nenhum INSERT nesta migration: UUID de organizacao nao e
-- completado por prefixo nesta casa. Quem preenche e o portao de producao,
-- com o nome da organizacao conferido na tela (223-08).
CREATE TABLE IF NOT EXISTS public.ml_sale_fee_sync_config (
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ml_user_id         text        NOT NULL,
  habilitado           boolean     NOT NULL DEFAULT false,
  backfill_desde         date        NOT NULL,
  observacao               text        NULL,
  atualizado_em             timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (organization_id, ml_user_id)
);

COMMENT ON TABLE public.ml_sale_fee_sync_config IS
  'Quais contas participam da ingestao do rebate por pedido, e desde quando '
  '(D-223-02: so 2026; D-223-03: Pe Vermeio + Junior). Nasce vazia de proposito '
  '— nenhum UUID e semeado por migration nesta casa.';

-- ─── Segurança — RLS na MESMA migration que cria as três tabelas ────────────
--
-- Regra da casa (feedback_tabela_de_execucao_nasce_sem_rls): tabela criada
-- fora deste padrao ja nasceu aberta para `anon` nesta base antes. As tres
-- tabelas TEM organizacao — a policy filtra por participacao, no molde de
-- `ml_billing_sync_state` (20260805020000), nao no molde de tabela publica
-- de legislacao (icms_uf_aliquotas, que nao tem tenant).
ALTER TABLE public.ml_order_sale_fee         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ml_order_sale_fee_captura ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ml_sale_fee_sync_config   ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'ml_order_sale_fee'
       AND policyname = 'ml_order_sale_fee select'
  ) THEN
    CREATE POLICY "ml_order_sale_fee select"
      ON public.ml_order_sale_fee FOR SELECT TO authenticated
      USING (public.is_org_member(auth.uid(), organization_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'ml_order_sale_fee_captura'
       AND policyname = 'ml_order_sale_fee_captura select'
  ) THEN
    CREATE POLICY "ml_order_sale_fee_captura select"
      ON public.ml_order_sale_fee_captura FOR SELECT TO authenticated
      USING (public.is_org_member(auth.uid(), organization_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'ml_sale_fee_sync_config'
       AND policyname = 'ml_sale_fee_sync_config select'
  ) THEN
    CREATE POLICY "ml_sale_fee_sync_config select"
      ON public.ml_sale_fee_sync_config FOR SELECT TO authenticated
      USING (public.is_org_member(auth.uid(), organization_id));
  END IF;
END $$;

-- Nenhuma policy de INSERT/UPDATE/DELETE nas tres: a escrita e exclusiva do
-- papel de servico (service_role), que passa por cima de RLS por definicao —
-- e o mesmo padrao de ml_billing_sync_state.

REVOKE ALL ON public.ml_order_sale_fee         FROM anon;
REVOKE ALL ON public.ml_order_sale_fee_captura FROM anon;
REVOKE ALL ON public.ml_sale_fee_sync_config   FROM anon;

GRANT SELECT ON public.ml_order_sale_fee         TO authenticated;
GRANT SELECT ON public.ml_order_sale_fee_captura TO authenticated;
GRANT SELECT ON public.ml_sale_fee_sync_config   TO authenticated;

-- ─── Guardas finais: falha alto em vez de aplicar pela metade ───────────────
DO $$
DECLARE
  v_tabela        text;
  v_rls_ligada    boolean;
  v_policies      integer;
  v_sem_org       integer;
BEGIN
  FOREACH v_tabela IN ARRAY ARRAY[
    'ml_order_sale_fee', 'ml_order_sale_fee_captura', 'ml_sale_fee_sync_config'
  ]
  LOOP
    SELECT c.relrowsecurity INTO v_rls_ligada
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = v_tabela;

    IF v_rls_ligada IS NOT TRUE THEN
      RAISE EXCEPTION 'tabela % nao tem seguranca de linha ligada', v_tabela;
    END IF;

    SELECT count(*) INTO v_policies
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = v_tabela;

    IF v_policies = 0 THEN
      RAISE EXCEPTION 'tabela % nao tem nenhuma policy', v_tabela;
    END IF;

    SELECT count(*) INTO v_sem_org
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = v_tabela
       AND (qual IS NULL OR qual NOT ILIKE '%is_org_member%');

    IF v_sem_org > 0 THEN
      RAISE EXCEPTION 'tabela % tem policy sem checagem de organizacao (is_org_member)', v_tabela;
    END IF;
  END LOOP;

  -- A configuracao nasce vazia: nenhuma linha semeada por esta migration.
  IF EXISTS (SELECT 1 FROM public.ml_sale_fee_sync_config) THEN
    RAISE EXCEPTION 'ml_sale_fee_sync_config nao pode nascer com linhas — a semeadura e portao de producao (D-223-02/D-223-03)';
  END IF;
END $$;
