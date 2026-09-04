-- ────────────────────────────────────────────────────────────────────────────
-- Fase 225, plano 225-06 — o custo de tabela do frete por anuncio, HISTORIADO.
--
-- 🔴 A TERCEIRA REGUA. Esta tabela existe para responder a queixa que originou
-- a fase inteira: "no painel de anuncios da plataforma esta uma coisa cobrada,
-- ja na venda acontece outra... e e sempre a mais" (D-225-17).
--
-- ⚠️ E ela NAO e a regua dos 98,9% do research (D-225-19). Aquele numero compara
-- a FATURA do ML com o que o ENVIO registrou (/shipments) — duas fontes
-- independentes, numero legitimo, pergunta diferente. A pergunta do Wesley e se
-- o ENVIO cobrou o que o ANUNCIO publicava, e essa regua nao existia em lugar
-- nenhum ate esta migration.
--
-- ─── A FONTE, e por que e `list_cost` e nao `base_cost` ────────────────────
--
-- Medido ao vivo em 03/09/2026 contra a API do ML:
--
--   MLB7273733004  base_cost  R$ 23,30 (SP) / 47,50 (DF) / 29,20 (RS)
--                  list_cost  R$ 25,45 NOS TRES
--   MLB4391644481  base_cost  R$ 42,20 (SP) / 85,30 (DF)
--                  list_cost  R$ 50,75 NOS DOIS, e em todos os metodos de envio
--
-- `base_cost` e funcao do destino; `list_cost` depende so do item. E o Wesley
-- CONFIRMOU na tela do painel de vendedor, em 03/09 (D-W-225-03): "sobre o
-- frete, e esse mesmo, ja confirmei pra voce". R$ 25,45 e R$ 50,75 sao os
-- numeros que ele ve.
--
-- Por isso `list_cost` e a regua e `base_cost_ref` e SO DIAGNOSTICO. Guardar o
-- `base_cost` do destino de referencia serve para uma coisa unica: se o "frete
-- prometido" divergir sistematicamente do que ele enxerga, a primeira premissa
-- a remedir e justamente esta, e o dado para remedir precisa existir.
--
-- ⚠️ A origem da prova esta declarada: CONFIRMACAO VISUAL HUMANA, nao leitura
-- automatizada do painel. Nao promova isso a fato medido.
--
-- ─── POR QUE A TABELA E HISTORIADA POR VIGENCIA ────────────────────────────
--
-- 🔴 Comparar o custo de tabela de HOJE contra uma cobranca de tres semanas
-- atras compara REGUAS DIFERENTES se o ML mexeu na tabela no meio. A vigencia
-- e o que torna a comparacao honesta: a regua aplicada e a que estava publicada
-- NA DATA DA VENDA. Venda anterior a primeira captura do item nao tem regua
-- vigente e por isso NAO VIRA CASO — sai rotulada como diagnostico.
--
-- Sem `vigente_desde` o numero existiria e estaria errado sem ninguem perceber,
-- que e a assinatura de defeito que esta fase inteira existe para combater.
--
-- Consulta canonica de "custo vigente na data X", uma linha por anuncio:
--
--   select distinct on (t.item_id) t.item_id, t.list_cost
--     from public.ml_item_frete_tabela t
--    where t.organization_id = :org
--      and t.vigente_desde  <= :data
--    order by t.item_id, t.vigente_desde desc;
--
-- ─── SEGURANCA, QUE NAO SE NEGOCIA ─────────────────────────────────────────
--
--   · as duas tabelas nascem com RLS e policy NO MESMO ARQUIVO. Tabela criada
--     fora de migration nasce sem protecao e o lint nao a alcanca
--     (feedback_tabela_de_execucao_nasce_sem_rls).
--   · `revoke ... from anon` e EXPLICITO. Revogar de PUBLIC nao desfaz o grant
--     direto que o Supabase concede a `anon` — foi exatamente nisso que R-08(c)
--     falhou na onda 2 desta mesma fase.
--   · nenhuma policy de escrita para `authenticated`: quem escreve e o papel de
--     servico, que passa por cima de RLS por definicao. Mesma disciplina de
--     `cash_inflows` e `ml_order_sale_fee`.
--
-- NENHUM UUID E SEMEADO AQUI. O escopo da captura sai de `conciliacao_config`,
-- que a onda 2 semeou so para a Pe Vermeio (D-225-14). UUID nao se completa por
-- prefixo nesta casa.
--
-- APLICACAO: via MCP `apply_migration` no projeto ckcdevcxgvueywivefgx.
-- NUNCA SQL Editor, NUNCA `db push`.
--
-- ⚠️ PREFIXO: `20260903160000` ja e de `20260903160000_mp_saidas_estado_e_captura`
-- (plano 04). O Supabase usa o prefixo como VERSAO e duas migrations com o mesmo
-- numero colidem, com ordem indefinida entre elas. Por isso este arquivo e
-- `20260904100000`. E a segunda colisao evitada nesta fase — a primeira foi o
-- `20260903140000`, que o plano 04 renumerou.
-- ────────────────────────────────────────────────────────────────────────────

-- ═══ 1. ml_item_frete_tabela — a serie por vigencia ═════════════════════════

create table if not exists public.ml_item_frete_tabela (
  organization_id  uuid        not null references public.organizations(id) on delete cascade,
  ml_user_id       bigint      null,
  item_id          text        not null,
  list_cost        numeric     not null,
  base_cost_ref    numeric     null,
  cep_ref          text        not null,
  vigente_desde    date        not null,
  capturado_em     timestamptz not null default now(),
  visto_em         timestamptz not null default now(),

  constraint ml_item_frete_tabela_pk primary key (organization_id, item_id, vigente_desde)
);

comment on table public.ml_item_frete_tabela is
  '225-06: o custo de tabela do frete publicado na ficha do anuncio (`list_cost`), HISTORIADO '
  'POR VIGENCIA. 🔴 A historia existe por um motivo aritmetico, nao por gosto de auditoria: '
  'comparar o custo de tabela de hoje contra uma cobranca de tres semanas atras compara REGUAS '
  'DIFERENTES se o ML mudou a tabela no meio. A comparacao usa a linha vigente NA DATA DA VENDA '
  '(`vigente_desde <= data_pedido`, a mais recente), e venda anterior a primeira captura do item '
  'NAO VIRA CASO — sai como diagnostico rotulado. ⚠️ Uma linha por MUDANCA, nunca uma por dia: '
  'anuncio cujo custo nao mudou so tem `visto_em` atualizado.';

comment on column public.ml_item_frete_tabela.list_cost is
  '🔴 A REGUA. Custo de envio que o VENDEDOR paga, publicado na ficha do anuncio (D-225-17). '
  'Vem de GET /items/{id}/shipping_options e NAO varia por destino nem por metodo de envio — '
  'medido em 03/09/2026 contra 3 CEPs e 4 metodos. Confirmado pelo Wesley na tela do painel de '
  'vendedor (D-W-225-03): R$ 25,45 em MLB7273733004 e R$ 50,75 em MLB4391644481. ⚠️ A prova e '
  'CONFIRMACAO VISUAL HUMANA, nao leitura automatizada — se o frete prometido divergir '
  'sistematicamente do que ele enxerga, esta e a primeira premissa a remedir.';

comment on column public.ml_item_frete_tabela.base_cost_ref is
  '🔴 DIAGNOSTICO, NUNCA REGUA. `base_cost` e funcao do DESTINO: medido variando R$ 23,30 / '
  '47,50 / 29,20 no MESMO item, so mudando o CEP. Guardado para um uso unico — se o frete '
  'prometido nao bater com a tela do Wesley, comparar contra o base_cost do destino de '
  'referencia e o caminho de remedicao. Usa-lo na comparacao produziria divergencia inventada.';

comment on column public.ml_item_frete_tabela.cep_ref is
  'O CEP usado na chamada. Qualquer CEP valido serve, porque `list_cost` nao varia por destino — '
  'mas registrar QUAL torna a medicao reproduzivel. Semeado em 01310100 (Av. Paulista, SP), que '
  'e o mesmo destino que produziu os R$ 25,45 e R$ 50,75 confirmados pelo Wesley. Trocar o CEP '
  'sem trocar este registro tornaria a serie nao comparavel com a medicao que fundou a decisao.';

comment on column public.ml_item_frete_tabela.visto_em is
  'Ultima vez que a captura OBSERVOU este valor, mesmo sem mudanca. Distingue "o custo nao mudou '
  'desde 04/09" de "ninguem olha desde 04/09" — sem essa coluna a serie ficaria indistinguivel '
  'de uma captura parada, que e a assinatura do dado velho servido como atual.';

create index if not exists ml_item_frete_tabela_vigencia_idx
  on public.ml_item_frete_tabela (organization_id, item_id, vigente_desde desc);

alter table public.ml_item_frete_tabela enable row level security;

drop policy if exists ml_item_frete_tabela_select on public.ml_item_frete_tabela;
create policy ml_item_frete_tabela_select on public.ml_item_frete_tabela
  for select to authenticated
  using (public.is_org_member(auth.uid(), organization_id));

-- ═══ 2. ml_item_frete_captura — o estado da varredura ══════════════════════
--
-- Existe por duas razoes, e as duas sao do plano:
--
--  (a) ORCAMENTO POR INVOCACAO com continuacao. Varrer sem teto estoura o tempo
--      da funcao; varrer sempre do inicio nunca alcanca o fim da lista. A ordem
--      e `ultima_tentativa asc nulls first`: item nunca tentado vem primeiro,
--      item tentado ha mais tempo vem em seguida.
--
--  (b) 🔴 ANUNCIO SEM ESTOQUE E CONDICAO NORMAL, NAO ERRO. O endpoint devolve
--      404 "stock out for all requested products" e isso nao pode contaminar a
--      contagem de falha. Registrar a TENTATIVA (e nao so o sucesso) e o que
--      impede o item sem estoque de ser re-tentado infinitamente na frente dos
--      outros, consumindo o orcamento inteiro numa lista que nunca avanca.

create table if not exists public.ml_item_frete_captura (
  organization_id  uuid        not null references public.organizations(id) on delete cascade,
  ml_user_id       bigint      null,
  item_id          text        not null,
  ultima_tentativa timestamptz not null default now(),
  ultimo_status    text        not null,
  tentativas       int         not null default 1,
  ultimo_erro      text        null,

  constraint ml_item_frete_captura_pk primary key (organization_id, item_id)
);

comment on table public.ml_item_frete_captura is
  '225-06: estado da varredura de custo de tabela, um registro por anuncio. NAO guarda dinheiro '
  '— guarda "quando tentei e o que aconteceu". 🔴 `ultimo_status` distingue `ok`, `inalterado`, '
  '`sem_estoque` e `erro`, e essa distincao e o coracao do desenho: anuncio sem estoque devolve '
  '404 no endpoint de opcoes de envio e isso e CONDICAO NORMAL a repetir depois, nunca falha de '
  'sync. Contar os dois juntos faria a cobertura mentir para baixo e a taxa de erro mentir para '
  'cima ao mesmo tempo.';

comment on column public.ml_item_frete_captura.ultima_tentativa is
  'Ordena a fila da proxima invocacao (`asc nulls first`) E serve de trava diaria: item ja '
  'tentado hoje e pulado. Sem a trava, a carona no `sync-mp-releases` (que roda de 3 em 3 horas) '
  'varreria a conta inteira 8 vezes por dia atras de um valor de TABELA, que nao muda de hora em '
  'hora — e o bloqueio do ML por excesso e por ENDERECO DE ORIGEM, ou seja, derrubaria as outras '
  'sincronizacoes junto.';

create index if not exists ml_item_frete_captura_fila_idx
  on public.ml_item_frete_captura (organization_id, ultima_tentativa asc);

alter table public.ml_item_frete_captura enable row level security;

drop policy if exists ml_item_frete_captura_select on public.ml_item_frete_captura;
create policy ml_item_frete_captura_select on public.ml_item_frete_captura
  for select to authenticated
  using (public.is_org_member(auth.uid(), organization_id));

-- Nenhuma policy de INSERT/UPDATE/DELETE nas duas: a escrita e exclusiva do
-- papel de servico, que passa por cima de RLS por definicao.

-- ═══ 3. ACL — 🔴 `from anon` e EXPLICITO ═══════════════════════════════════
--
-- Revogar de PUBLIC NAO desfaz o grant direto que o Supabase concede a `anon`.
-- R-08(c) da onda 2 desta mesma fase falhou exatamente nisso.

revoke all on public.ml_item_frete_tabela  from anon;
revoke all on public.ml_item_frete_captura from anon;

grant select on public.ml_item_frete_tabela  to authenticated;
grant select on public.ml_item_frete_captura to authenticated;

-- ═══ 4. Guardas finais: falha alto em vez de aplicar pela metade ════════════

DO $$
DECLARE
  v_tabela     text;
  v_rls_ligada boolean;
  v_policies   integer;
  v_sem_org    integer;
  v_anon       boolean;
BEGIN
  FOREACH v_tabela IN ARRAY ARRAY['ml_item_frete_tabela', 'ml_item_frete_captura']
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

    -- 🔴 A guarda que R-08(c) ensinou: revoke de PUBLIC nao alcanca `anon`.
    SELECT has_table_privilege('anon', 'public.' || v_tabela, 'SELECT') INTO v_anon;
    IF v_anon THEN
      RAISE EXCEPTION 'anon ainda LE a tabela % — o revoke de PUBLIC nao desfaz o grant direto', v_tabela;
    END IF;
  END LOOP;

  -- A serie nasce VAZIA: quem captura e a edge function, sob papel de servico.
  IF EXISTS (SELECT 1 FROM public.ml_item_frete_tabela) THEN
    RAISE EXCEPTION 'ml_item_frete_tabela nao pode nascer com linhas — a captura e da edge function';
  END IF;
END $$;
