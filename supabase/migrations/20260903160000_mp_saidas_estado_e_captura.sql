-- ═══════════════════════════════════════════════════════════════════════════
-- 225-04 — as SAIDAS da conta do Mercado Pago: estado do relatorio e captura
--
-- Contexto: a sonda de 03/09 (225-SAIDAS-SPIKE.md) baixou o primeiro arquivo
-- real do relatorio de liberacoes do MP. Veredito VIAVEL. Esta migration ajusta
-- `mp_saidas` ao arquivo REAL e cria a tabela de estado do relatorio assincrono.
--
-- 🔴 NUMERACAO: este arquivo era `20260903140000_...` no plano. O prefixo JA
-- ESTAVA OCUPADO por `20260903140000_conciliacao_acl_e_totais.sql` (onda 2). O
-- Supabase usa o prefixo numerico como VERSAO — duas migrations com o mesmo
-- prefixo colidem e a ordem entre elas fica indefinida. Renumerado para
-- 160000, deixando 150000 livre para `conciliacao_retido_com_saidas.sql`.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══ 1. 🔴 A chave unica de `mp_saidas` esta ERRADA e precisa cair ══════════
--
-- `mp_saidas` nasceu no plano 02 com `unique (organization_id, source_id)`,
-- escrito quando ninguem tinha visto o arquivo. O arquivo real REFUTA isso:
--
--   291 linhas de dados  →  161 SOURCE_ID distintos
--
-- O mesmo pagamento aparece varias vezes, com papeis diferentes:
-- `reserve_for_payment`, `payment`, `reserve_for_dispute`, `mediation`. Manter
-- a constraint faria a ingestao COLAPSAR 130 de 291 linhas — 45% do arquivo
-- sumindo em silencio, que e precisamente o defeito que esta fase existe para
-- combater. A chave verdadeira e composta; ver `_shared/csvSimples.ts`.

ALTER TABLE public.mp_saidas DROP CONSTRAINT IF EXISTS mp_saidas_unico;

-- ═══ 2. As colunas que o arquivo real exigiu ════════════════════════════════
-- Só ADD COLUMN: a tabela nasceu no plano 02 com RLS e policy, e nada disso muda.

ALTER TABLE public.mp_saidas
  ADD COLUMN IF NOT EXISTS movimento_hash    text,
  ADD COLUMN IF NOT EXISTS ocorrencia        integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS classe            text,
  ADD COLUMN IF NOT EXISTS conta_no_total    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS business_unit     text,
  ADD COLUMN IF NOT EXISTS relatorio_arquivo text,
  ADD COLUMN IF NOT EXISTS linha_no_arquivo  integer,
  ADD COLUMN IF NOT EXISTS divergente        boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.mp_saidas.movimento_hash IS
  '225-04: SHA-256 das SEIS colunas que identificam o movimento no CSV do MP '
  '(DATE, SOURCE_ID, DESCRIPTION, GROSS_AMOUNT, NET_CREDIT_AMOUNT, NET_DEBIT_AMOUNT) '
  'mais a ocorrencia. Medido sobre o arquivo real de 291 linhas: SOURCE_ID sozinho '
  'repete (161 distintos), a tripla (DATE, SOURCE_ID, DESCRIPTION) ainda deixa 30 '
  'grupos duplicados, e a 6-tupla da ZERO. O par reserva/contrapartida e o que '
  'derruba a tripla: mesmo instante, mesmo id, mesma descricao, diferindo SO nas '
  'colunas de valor. BALANCE_AMOUNT fica de fora de proposito — e saldo corrido, '
  'muda conforme a janela pedida ao MP, e na chave faria reprocessar duplicar tudo.';

COMMENT ON COLUMN public.mp_saidas.ocorrencia IS
  '225-04: desempata linhas identicas nas seis colunas da chave. Hoje sao ZERO em '
  '291 linhas — mas "zero hoje" nao e "zero sempre", e colapsar duas linhas iguais '
  'em uma e o erro OPOSTO ao de duplicar: some dinheiro da conta em silencio.';

COMMENT ON COLUMN public.mp_saidas.classe IS
  '225-04 (D-225-10 aplicado as SAIDAS): toda linha termina com uma classificacao '
  'NOMEADA, e a cascata e TOTAL — nenhuma linha cai para nulo. Cinco valores: '
  '`saldo_de_abertura` (a primeira linha da janela nao e movimento, e o saldo '
  'inicial: somar o arquivo cru infla o total); `reserva` (as linhas `reserve_*`, '
  'que sao lancamento de reserva e contrapartida, NAO movimento economico novo); '
  '`atribuivel_a_venda` (BUSINESS_UNIT = Mercado Libre — o SOURCE_ID e o payment_id '
  'e chega ao pedido por cash_inflows; medido 29/29 nas linhas de disputa); '
  '`estrutural_da_conta` (BUSINESS_UNIT vazio — saque; medido 0/3 atribuiveis, e '
  'NUNCA vira acusacao contra o ML, T-225-04-08); `origem_desconhecida` (o else '
  'explicito — desconhecido e resposta aceitavel SO quando e nomeado como tal).';

COMMENT ON COLUMN public.mp_saidas.conta_no_total IS
  '🔴 225-04: false para `reserva` e `saldo_de_abertura`. QUALQUER soma que ignore '
  'esta coluna FABRICA numero. Medido no arquivo real: reserve_for_payout e payout '
  'trazem R$ 38.089,95 CADA — e sao o MESMO saque. reserve_for_payment e payment '
  'trazem R$ 3.860,43 cada, tambem o mesmo dinheiro. Somar tudo o que tem debito '
  'DOBRA o saque. E a mesma classe de erro do par CHARGE/BONUS que a fase 223 '
  'enfrentou no billing: o par existe no extrato, e quem soma sem trata-lo mente.';

COMMENT ON COLUMN public.mp_saidas.business_unit IS
  '225-04: coluna BUSINESS_UNIT do CSV. E o DISCRIMINADOR pronto entre saida de '
  'venda e saida de conta, sem heuristica: "Mercado Libre" em 100% das linhas de '
  'disputa/mediacao (29/29 com ml_order_id), vazio em 100% das de saque (0/3).';

COMMENT ON COLUMN public.mp_saidas.divergente IS
  '225-04: a linha do CSV tinha numero de campos diferente do cabecalho. Ela e '
  'gravada assim mesmo, marcada — ingestao que descarta linha sem dizer e como o '
  'vazamento fica invisivel.';

-- 🔴 A chave de idempotencia de verdade. Sem ela, reprocessar a mesma janela
-- duplica saida — e saida duplicada infla o vazamento total, que e justamente
-- o numero que esta fase existe para tornar confiavel (T-225-04-07).
CREATE UNIQUE INDEX IF NOT EXISTS mp_saidas_movimento_unico
  ON public.mp_saidas (organization_id, movimento_hash);

CREATE INDEX IF NOT EXISTS mp_saidas_org_classe_idx
  ON public.mp_saidas (organization_id, classe, data_movimento);

CREATE INDEX IF NOT EXISTS mp_saidas_source_idx
  ON public.mp_saidas (organization_id, source_id)
  WHERE source_id IS NOT NULL;

-- ═══ 3. `mp_saidas_relatorio` — o estado do relatorio assincrono ════════════
--
-- POR QUE UMA TABELA DE ESTADO: o relatorio do MP e criado, fica `pending`, e
-- so depois de minutos vira arquivo baixavel. Sem carregar o identificador
-- entre invocacoes, cada execucao criaria um relatorio novo — que e o
-- T-225-04-05 (laço de criacao contra o MP) escrito na propria arquitetura.
-- Mesmo espirito do `ml_billing_sync_state` da fase 211: falha de sync deixa
-- de ser silenciosa quando existe um campo de estado consultavel.

CREATE TABLE IF NOT EXISTS public.mp_saidas_relatorio (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ml_user_id      bigint      NULL,
  relatorio_id    text        NOT NULL,
  arquivo         text        NULL,
  status          text        NOT NULL DEFAULT 'pendente',
  begin_date      timestamptz NULL,
  end_date        timestamptz NULL,
  linhas_lidas    integer     NULL,
  linhas_gravadas integer     NULL,
  tentativas      integer     NOT NULL DEFAULT 0,
  ultimo_erro     text        NULL,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT mp_saidas_relatorio_unico UNIQUE (organization_id, relatorio_id)
);

COMMENT ON TABLE public.mp_saidas_relatorio IS
  '225-04: o estado do relatorio de liberacoes do Mercado Pago entre invocacoes da '
  'EF sync-mp-saidas. O relatorio e assincrono: nasce `pending` e vira arquivo '
  'baixavel minutos depois (medido: ~2 min na sonda de 03/09). Guardar o '
  'identificador aqui e o que impede a EF de criar um relatorio novo a cada '
  'execucao — o teto de chamadas contra o MP e compartilhado (T-225-04-05).';

COMMENT ON COLUMN public.mp_saidas_relatorio.status IS
  '225-04: `pendente` (criado, ainda em preparo) · `pronto` (arquivo baixado e '
  'ingerido) · `erro` (ver ultimo_erro). Sem este campo a falha de sync e '
  'silenciosa, que foi a licao do ml_billing_sync_state da fase 211.';

COMMENT ON COLUMN public.mp_saidas_relatorio.ultimo_erro IS
  '225-04: o motivo REAL da ultima falha, em texto. Ausencia que nao diz o motivo '
  'e a mesma classe de defeito que feedback_ausencia_diz_o_motivo_real descreve.';

CREATE INDEX IF NOT EXISTS mp_saidas_relatorio_org_status_idx
  ON public.mp_saidas_relatorio (organization_id, status, criado_em DESC);

ALTER TABLE public.mp_saidas_relatorio ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mp_saidas_relatorio_select ON public.mp_saidas_relatorio;
CREATE POLICY mp_saidas_relatorio_select ON public.mp_saidas_relatorio
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- Nenhuma policy de escrita para `authenticated`: a escrita e exclusiva do
-- papel de servico, que passa por cima de RLS por definicao. Mesma disciplina
-- de `cash_inflows` e de `mp_saidas`.

-- 🔴 `revoke ... from anon` NOMEADO. Revogar de PUBLIC NAO desfaz a concessao
-- direta que o default privilege do Supabase grava para `anon` — foi
-- exatamente o defeito que a onda 2 encontrou e corrigiu (`d941b2d0`), e o
-- mesmo mecanismo esta aberto desde a fase 215. Nesta base, `anon` precisa ser
-- nomeado.
REVOKE ALL ON public.mp_saidas_relatorio FROM anon;
GRANT SELECT ON public.mp_saidas_relatorio TO authenticated;

-- ═══ 4. Guardas finais: falha alto em vez de aplicar pela metade ════════════

DO $$
DECLARE
  v_tabela     text;
  v_rls_ligada boolean;
  v_policies   integer;
  v_sem_org    integer;
  v_tem_anon   integer;
BEGIN
  FOREACH v_tabela IN ARRAY ARRAY['mp_saidas', 'mp_saidas_relatorio']
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

    -- Nenhuma escrita para `authenticated`: a ingestao e do papel de servico.
    IF EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = v_tabela
         AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    ) THEN
      RAISE EXCEPTION 'tabela % nao pode ter policy de escrita para authenticated', v_tabela;
    END IF;

    SELECT count(*) INTO v_tem_anon
      FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = v_tabela AND grantee = 'anon';

    IF v_tem_anon > 0 THEN
      RAISE EXCEPTION 'anon ainda tem grant em % — revogar de PUBLIC nao basta nesta base', v_tabela;
    END IF;
  END LOOP;

  -- 🔴 A constraint errada TEM que ter caido. Se ela sobreviver, a ingestao
  -- colapsa 130 das 291 linhas do arquivo real em silencio.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.mp_saidas'::regclass AND conname = 'mp_saidas_unico'
  ) THEN
    RAISE EXCEPTION 'mp_saidas_unico (organization_id, source_id) ainda existe — SOURCE_ID repete no arquivo real (161 distintos para 291 linhas)';
  END IF;

  -- E a chave certa TEM que existir: sem ela, reprocessar duplica saida.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'mp_saidas'
       AND indexname = 'mp_saidas_movimento_unico'
  ) THEN
    RAISE EXCEPTION 'mp_saidas nao tem indice unico por movimento_hash — sem chave de idempotencia a ingestao duplica';
  END IF;

  -- A tabela de estado nasce vazia: nenhuma linha semeada por esta migration.
  IF EXISTS (SELECT 1 FROM public.mp_saidas_relatorio) THEN
    RAISE EXCEPTION 'mp_saidas_relatorio nao pode nascer com linhas';
  END IF;
END $$;
