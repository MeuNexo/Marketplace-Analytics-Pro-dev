-- ============================================================
-- 225-09 — cash_inflows: a procedencia do dinheiro.
--          Quem RECEBEU, quem PAGOU, e se aquele real e da empresa.
-- ============================================================
-- Fase 225 (conciliacao de cobrancas do ML), plano 09, Task 1.
--
-- 🔴 AVISO PARA QUEM FOR ESCREVER UMA CONSULTA DE CORRECAO AQUI — LEIA ANTES.
--
-- NAO classifique por anti-join contra `orders`. NAO marque `entra_no_caixa = false`
-- por "a linha nao casa com nenhum pedido". As 28 VENDAS REAIS orfas da Pe Vermeio
-- (R$ 2.449,52 liquidos, entre 15/03 e 20/08/2026) falham no MESMO teste de
-- "nao casa com `orders`" que as 38 compras pessoais do titular — elas sao orfas
-- porque a INGESTAO DE PEDIDOS as perdeu, nao porque o dinheiro nao seja da empresa.
-- Um anti-join contra `orders` apagaria R$ 2.449,52 de dinheiro real do caixa.
--
-- Quem decide e o PAR `recebedor_ml_user_id` x `pagador_ml_user_id`, lido do
-- Mercado Pago, e nada mais. O censo (225-CENSO-COLLECTOR.md) provou os dois campos
-- MUTUAMENTE EXCLUSIVOS E EXAUSTIVOS em 438 de 438 linhas: zero com ambos
-- preenchidos, zero com nenhum. E o anti-join e o atalho obvio — por isso este aviso
-- e a primeira coisa do arquivo.
--
-- ------------------------------------------------------------
-- POR QUE ESTAS COLUNAS EXISTEM
--
-- A ingestao de caixa (`sync-mp-releases`) aceitava uma entrada perguntando DE QUE
-- TIPO E O PEDIDO (`order.type === 'mercadolibre'`) e nunca QUEM RECEBEU O DINHEIRO.
-- Esse teste e verdadeiro tanto quando a Pe Vermeio VENDE quanto quando o dono
-- COMPRA no ML pagando com a mesma conta Mercado Pago. Resultado medido:
-- R$ 12.232,60 em 38 linhas de compra pessoal do titular entraram como receita da
-- empresa desde 07/01/2026, com 97,6% concentrados em maio (R$ 6.436,32) e agosto
-- (R$ 5.496,89) — os dois meses de pico, e agosto e o mes de Barretos.
--
-- 🔴 O VALOR GRAVADO NAO MUDA. `net_amount` e `gross_amount` continuam sendo
-- exatamente o que a API do Mercado Pago devolveu. O que estas colunas dizem e se
-- aquele valor e dinheiro da empresa — a classificacao fica AO LADO do valor, nunca
-- por cima dele. Nenhuma linha e apagada; nenhuma soma e reescrita aqui.
--
-- A PROVA DE QUE A LINHA DE COMPRA E FICCAO CONTABIL: a EF grava
-- `transaction_details.net_received_amount`, que numa compra e o LIQUIDO DO OUTRO
-- VENDEDOR. Por isso o colchao de 27/08 aparece com bruto R$ 712,94 e liquido
-- R$ 837,42 — liquido maior que bruto, impossivel numa venda.
--
-- ------------------------------------------------------------
-- ESTA MIGRATION E ADITIVA. Nenhuma funcao e criada, substituida ou alterada aqui:
-- o efeito no caixa e do plano 225-11, e misturar os dois destruiria a
-- rastreabilidade de qual mudanca moveu qual numero. Nenhum UPDATE, nenhum DELETE,
-- nenhum valor existente tocado. As 19 funcoes que leem `cash_inflows` continuam
-- lendo o que liam.
--
-- ⚠️ DIVIDA CONHECIDA DESTA BASE: `apply_migration` grava a versao pelo RELOGIO DO
-- SERVIDOR, nao pelo prefixo do nome deste arquivo. As guardas abaixo sao
-- idempotentes (`IF NOT EXISTS` nas colunas e no indice, `ADD CONSTRAINT` sob
-- condicional) e suportam reaplicacao; um `db push` posterior, porem, FALHA em vez
-- de virar no-op, porque o prefixo aqui nao corresponde a versao registrada.
-- ============================================================

-- ─── 1. O par que decide: quem recebeu e quem pagou ────────────────────────
-- `bigint` porque sao ids de usuario do Mercado Livre (o da PV e 1639558873, dez
-- digitos). Nulaveis: linha antiga nunca teve a pergunta feita, e nulo e o estado
-- que documenta isso — zero seria um terceiro estado que nenhum filtro pega.
ALTER TABLE public.cash_inflows
  ADD COLUMN IF NOT EXISTS recebedor_ml_user_id bigint;

ALTER TABLE public.cash_inflows
  ADD COLUMN IF NOT EXISTS pagador_ml_user_id bigint;

-- ─── 2. A flag reversivel e o motivo, que andam juntos ─────────────────────
-- `not null default true`: nenhuma linha pode sair do caixa por OMISSAO. Sair exige
-- decisao escrita. As 9.891 linhas existentes da Pe Vermeio nascem `true` com
-- `motivo_fora_do_caixa` nulo — o lado verdadeiro do CHECK abaixo — entao nenhuma
-- muda de estado por causa desta migration e nao e preciso validar em duas etapas.
ALTER TABLE public.cash_inflows
  ADD COLUMN IF NOT EXISTS entra_no_caixa boolean NOT NULL DEFAULT true;

ALTER TABLE public.cash_inflows
  ADD COLUMN IF NOT EXISTS motivo_fora_do_caixa text;

-- ─── 3. Quando a procedencia foi determinada ───────────────────────────────
ALTER TABLE public.cash_inflows
  ADD COLUMN IF NOT EXISTS origem_conferida_em timestamptz;

-- ─── 4. O identificador de ENVIO, para a familia do frete ──────────────────
-- `text` pelo mesmo motivo de `ml_order_id`: o join de conciliacao e contra colunas
-- `text`, e join entre text e bigint nao usa indice.
ALTER TABLE public.cash_inflows
  ADD COLUMN IF NOT EXISTS ml_shipment_id text;

-- ─── 5. A unidade e a medicao, gravadas na propria coluna ──────────────────
COMMENT ON COLUMN public.cash_inflows.recebedor_ml_user_id IS
  'Quem RECEBEU o dinheiro: collector_id lido de /v1/payments/{id} do Mercado Pago, '
  'gravado pela EF sync-mp-releases. Unidade: identificador de usuario do ML, nunca '
  'valor. Preenchido quando o dono do token recebe; AUSENTE quando ele paga. Forma o '
  'par que decide junto com pagador_ml_user_id — medidos MUTUAMENTE EXCLUSIVOS E '
  'EXAUSTIVOS em 438 de 438 linhas do censo de 04/09/2026 (0 com ambos, 0 com nenhum). '
  'Guardar os DOIS e o que torna a classificacao auditavel: com so um deles, "nao sei" '
  'e "nao e" ficam indistinguiveis. NULO em toda linha anterior a esta migration.';

COMMENT ON COLUMN public.cash_inflows.pagador_ml_user_id IS
  'Quem PAGOU: payer_id da RAIZ do payload de /v1/payments/{id} — nao o objeto payer, '
  'que vem NULO nos dois casos e por isso nao serve. Preenchido quando o dono do token '
  'paga. Este e o campo que distingue compra pessoal do titular de venda da empresa, e '
  'e por isso que a regra NAO pode ser anti-join contra orders (ver aviso no topo). '
  'ATENCAO: /v1/payments/search OMITE collector_id quando o dono do token e o pagador — '
  'a busca da o sinal, o endpoint de detalhe da a prova. Unidade: identificador.';

COMMENT ON COLUMN public.cash_inflows.entra_no_caixa IS
  'Se este valor e dinheiro da empresa. TRUE = soma no caixa (padrao: nenhuma linha sai '
  'por omissao). FALSE = fica na tabela, visivel, mas fora das somas de caixa — e exige '
  'motivo_fora_do_caixa escrito, amarrado pela constraint '
  'cash_inflows_fora_do_caixa_exige_motivo. 🔴 O VALOR NAO MUDA: net_amount e '
  'gross_amount continuam sendo o que a API devolveu; esta flag diz se aquele valor e da '
  'empresa. Medicao que a justifica: R$ 12.232,60 em 38 linhas de compra pessoal do '
  'titular entraram como receita desde 07/01/2026, 97,6% em maio e agosto. O efeito nas '
  'funcoes de caixa e do plano 225-11 — esta migration apenas cria a coluna.';

COMMENT ON COLUMN public.cash_inflows.motivo_fora_do_caixa IS
  'POR QUE a linha nao entra no caixa, em vocabulario fechado. Nulo quando entra. '
  'Valor previsto nesta fase: compra_do_titular (o dono comprou no ML pagando com a '
  'mesma conta Mercado Pago da empresa; a EF gravou o net_received_amount do OUTRO '
  'vendedor — prova: colchao de 27/08 com bruto R$ 712,94 e liquido R$ 837,42, liquido '
  'maior que bruto, impossivel numa venda). Dinheiro que some sem nome e a classe de '
  'defeito que a Fase 225 existe para matar: nenhuma linha sai do caixa sem motivo '
  'escrito, e o banco recusa a combinacao incoerente nos dois sentidos.';

COMMENT ON COLUMN public.cash_inflows.origem_conferida_em IS
  'Quando a procedencia desta linha foi determinada. Separa "nao sei" de "sei que sim": '
  'linha com esta coluna NULA nunca teve a pergunta feita — nao e o mesmo que linha '
  'conferida e aprovada. Preenchida pela EF sync-mp-releases no momento em que o par '
  'recebedor x pagador resolve a classificacao. Fica NULA de proposito quando a origem '
  'ficou indeterminada, e nesse caso a EF devolve a linha num contador proprio (o censo '
  'mediu ZERO indeterminadas em 438, entao qualquer ocorrencia e sinal novo).';

COMMENT ON COLUMN public.cash_inflows.ml_shipment_id IS
  'Identificador do ENVIO no Mercado Livre, para a familia do frete pago pelo comprador '
  '(description = marketplace_shipment): 105 linhas, R$ 1.329,15, desde 27/12/2025. '
  'Nesses pagamentos o order.id que o Mercado Pago devolve E o id do envio (11 digitos, '
  'nao 16), e a EF o gravava fielmente em ml_order_id — chave que nunca casa com '
  'orders.ml_order_id. Guardar o envio em coluna propria e o que permite ml_order_id '
  'receber o PEDIDO REAL, resolvido por GET /shipments/{id}: provado 103/103 pelo censo, '
  'com order_id sempre presente, sender_id = 1639558873 nas 103 e nenhuma colisao entre '
  'si. Reescrever a chave nao duplica nem apaga dinheiro — o frete e pagamento SEPARADO '
  'do da venda, 102 dos 103 pedidos ja tem outra linha aqui, e a chave unica da tabela e '
  '(organization_id, payment_id).';

-- ─── 6. O CHECK que e o coracao desta migration ────────────────────────────
-- Amarra flag e motivo NOS DOIS SENTIDOS:
--   linha que NAO entra no caixa PRECISA de motivo;
--   linha que ENTRA no caixa NAO PODE ter motivo.
-- O estado incoerente vira IMPOSSIVEL no banco, nao apenas desaconselhado. O nome e
-- legivel de proposito: a mensagem de erro desta constraint e o que alguem vai ler
-- daqui a seis meses, sem este arquivo aberto ao lado.
--
-- Sob condicional porque Postgres nao tem ADD CONSTRAINT IF NOT EXISTS, e esta
-- migration precisa suportar reaplicacao (ver divida do relogio do servidor no topo).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class t     ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = 'cash_inflows'
       AND c.conname = 'cash_inflows_fora_do_caixa_exige_motivo'
  ) THEN
    ALTER TABLE public.cash_inflows
      ADD CONSTRAINT cash_inflows_fora_do_caixa_exige_motivo
      CHECK (
        (entra_no_caixa = true  AND motivo_fora_do_caixa IS NULL)
        OR
        (entra_no_caixa = false AND motivo_fora_do_caixa IS NOT NULL)
      );
  END IF;
END $$;

COMMENT ON CONSTRAINT cash_inflows_fora_do_caixa_exige_motivo ON public.cash_inflows IS
  'Nenhuma linha sai do caixa sem motivo escrito, e nenhuma linha que soma no caixa '
  'carrega motivo orfao. Os dois sentidos, porque so o primeiro deixaria passar a '
  'reversao silenciosa: uma linha reclassificada de volta para entra_no_caixa = true '
  'com o motivo antigo esquecido ao lado.';

-- ─── 7. O indice parcial: a leitura de auditoria ───────────────────────────
-- Mesmo espirito do cash_inflows_org_ml_order_idx (225-01). A leitura quente e
-- "mostre o que ficou fora do caixa e quanto, por periodo" — uma fracao minuscula da
-- tabela (38 linhas medidas em 9.891, 0,38%). Indexar as 9.853 que ENTRAM no caixa
-- so engordaria o indice sem servir a nenhuma consulta.
CREATE INDEX IF NOT EXISTS cash_inflows_org_fora_do_caixa_idx
  ON public.cash_inflows (organization_id, release_date)
  WHERE entra_no_caixa = false;

-- ─── 8. Guardas finais: falha alto em vez de aplicar pela metade ───────────
-- Molde: supabase/migrations/20260903120000_cash_inflows_ml_order_id.sql:57-122,
-- que por sua vez adaptou 20260821100000_ml_order_sale_fee.sql:263-306.
-- Migration aplicada pela metade num objeto que 19 funcoes de caixa leem e PIOR que
-- migration recusada. A tabela JA tinha RLS antes deste arquivo — a guarda existe
-- para PROVAR que continua tendo depois, nao para criar.
DO $$
DECLARE
  v_coluna        text;
  v_existe        integer;
  v_constraint    integer;
  v_rls_ligada    boolean;
  v_policies      integer;
  v_sem_org       integer;
  v_flag_nula     integer;
BEGIN
  -- 8.1 As SEIS colunas existem
  FOREACH v_coluna IN ARRAY ARRAY[
    'recebedor_ml_user_id', 'pagador_ml_user_id', 'entra_no_caixa',
    'motivo_fora_do_caixa', 'origem_conferida_em', 'ml_shipment_id'
  ]
  LOOP
    SELECT count(*) INTO v_existe
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'cash_inflows'
       AND column_name  = v_coluna;

    IF v_existe <> 1 THEN
      RAISE EXCEPTION 'cash_inflows.% nao existe — a procedencia ficou pela metade', v_coluna;
    END IF;
  END LOOP;

  -- 8.2 A flag e obrigatoria: nulo seria um terceiro estado que o CHECK nao cobre
  SELECT count(*) INTO v_flag_nula
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'cash_inflows'
     AND column_name  = 'entra_no_caixa'
     AND is_nullable  = 'YES';

  IF v_flag_nula > 0 THEN
    RAISE EXCEPTION 'cash_inflows.entra_no_caixa precisa ser NOT NULL — nulo seria um terceiro estado fora do CHECK';
  END IF;

  -- 8.3 A constraint de coerencia entre flag e motivo existe
  SELECT count(*) INTO v_constraint
    FROM pg_constraint c
    JOIN pg_class t     ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public'
     AND t.relname = 'cash_inflows'
     AND c.conname = 'cash_inflows_fora_do_caixa_exige_motivo'
     AND c.contype = 'c';

  IF v_constraint <> 1 THEN
    RAISE EXCEPTION 'constraint cash_inflows_fora_do_caixa_exige_motivo nao existe — dinheiro poderia sair do caixa sem motivo escrito';
  END IF;

  -- 8.4 A seguranca de linha sobreviveu aos ALTER
  SELECT c.relrowsecurity INTO v_rls_ligada
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'cash_inflows';

  IF v_rls_ligada IS NOT TRUE THEN
    RAISE EXCEPTION 'tabela cash_inflows nao tem seguranca de linha ligada';
  END IF;

  -- 8.5 Continua havendo policy
  SELECT count(*) INTO v_policies
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'cash_inflows';

  IF v_policies = 0 THEN
    RAISE EXCEPTION 'tabela cash_inflows nao tem nenhuma policy';
  END IF;

  -- 8.6 A policy de leitura continua checando a organizacao
  SELECT count(*) INTO v_sem_org
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'cash_inflows'
     AND cmd = 'SELECT'
     AND (qual IS NULL OR qual NOT ILIKE '%is_org_member%');

  IF v_sem_org > 0 THEN
    RAISE EXCEPTION 'tabela cash_inflows tem policy de leitura sem checagem de organizacao (is_org_member)';
  END IF;
END $$;
