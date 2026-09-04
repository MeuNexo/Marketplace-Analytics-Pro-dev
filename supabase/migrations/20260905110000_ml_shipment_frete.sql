-- ────────────────────────────────────────────────────────────────────────────
-- Fase 239, plano 239-02 — o ESPERADO HISTORICO do frete, por ENVIO.
--
-- 🔴 O PROBLEMA QUE ESTA MIGRATION EXISTE PARA RESOLVER, com o numero medido:
-- 1.137 dos 1.200 pedidos de frete da tela saem rotulados
-- `frete_sem_vigencia_na_venda` (M-01) — 94,8% —, e o card ainda assim ostenta
-- "Frete cobrado acima do publicado" SEM conseguir dizer acima de quanto. Em
-- M-08, ZERO de 1.200 linhas provam as tres linhas do card. A regua vigente
-- (`ml_item_frete_tabela`, 225-06) so comeca em 04/09/2026: venda anterior a
-- primeira captura do anuncio nao tem regua e nunca tera, porque aquele
-- endpoint devolve o custo de HOJE e nao o de tres semanas atras.
--
-- ─── ONDE O PASSADO AINDA ESTA VIVO ────────────────────────────────────────
--
-- `GET /shipments/{id}` devolve `shipping_option.list_cost`: o custo de tabela
-- CONGELADO na data daquela compra. Ele nao envelhece — o envio guarda o que
-- valia quando a venda aconteceu. Essa e a unica fonte de esperado historico
-- que sobreviveu, e ela ja passa pela nossa ingestao: `sync-ml-orders` le o
-- campo e o COLAPSA com o frete do comprador dentro de `orders.frete`
-- (`const cost = s.shipping_option?.list_cost ?? s.base_cost ?? null`,
-- seguido de `buyerCost > 0 ? buyerCost : detail.cost`), apagando a identidade
-- do numero. Depois do colapso e impossivel saber se `orders.frete` e o que o
-- ML cobrou de nos ou o que o comprador pagou.
--
-- Esta migration da lugar PROPRIO ao numero. `sync-ml-orders` NAO e tocado.
--
-- ─── A REGUA E `list_cost`, E `base_cost` NAO E — ISTO FOI MEDIDO ──────────
--
-- M-07, 04/09/2026 15h29 UTC, 6 pedidos contra a API do ML:
--
--   pedido              cobrado   list_cost   base_cost   receiver   senders
--   2000018261249292     27,05      27,05       28,70       0,00      27,05
--   2000018271217346     19,05      19,05       38,10       0,00      19,05
--   2000018257771974     25,45      25,45       26,50       0,00      25,45
--   2000018260207858     45,25      45,25       74,00       0,00      45,25
--   2000018263268386     45,25      45,25       90,50       0,00      45,25
--   2000018269900034     34,04      34,04       48,60      14,99      19,05
--
-- `cobrado == list_cost` em 6 de 6, AO CENTAVO. A armadilha que a pesquisa
-- levantou — bases diferentes produzindo diferenca negativa por construcao —
-- NAO se materializou: os dois numeros estao na mesma base.
--
-- 🔴 E `base_cost` e SEMPRE MAIOR nos 6. Compara-lo com o cobrado fabricaria
-- "frete cobrado a menor" em 100% dos pedidos — uma tela inteira de acusacao
-- falsa. Por isso ele entra como `base_cost_ref`, DIAGNOSTICO, e a edge
-- function tem proibicao TESTADA de cair para ele quando `list_cost` falta.
--
-- ⚠️ No 6º pedido, `senders[].cost` (19,05) + `receiver.cost` (14,99) = 34,04 =
-- o cobrado. Quando o comprador paga parte, e a SOMA DAS DUAS PONTAS que fecha;
-- `senders` sozinho subestimaria. Por isso as duas pontas sao colunas separadas
-- e nenhuma delas e somada aqui: quem soma e a regua do plano 239-03.
--
-- ⚠️ LIMITE HONESTO DA M-07: os 6 sao de 03/09/2026 e tem regua vigente. Os
-- 1.137 sem vigencia sao MAIS ANTIGOS e nada ali prova o que acontece la. A
-- M-07 prova que a COMPARACAO E POSSIVEL e que a base e a mesma — nao prova a
-- direcao do desvio na populacao.
--
-- ─── SEGURANCA, QUE NAO SE NEGOCIA ─────────────────────────────────────────
--
--   · as tres tabelas nascem com RLS e policy NO MESMO ARQUIVO. Tabela criada
--     fora de migration nasce sem protecao e o lint nao a alcanca
--     (feedback_tabela_de_execucao_nasce_sem_rls).
--   · `revoke ... from anon` e EXPLICITO. Revogar de PUBLIC nao desfaz o grant
--     direto que o Supabase concede a `anon` — R-08(c) da fase 225 falhou
--     exatamente nisso.
--   · nenhuma policy de escrita para `authenticated`: quem escreve e o papel de
--     servico, que passa por cima de RLS por definicao.
--
-- NENHUM UUID E SEMEADO AQUI. O escopo da captura sai de dado
-- (`conciliacao_config`, LIDA nunca escrita), nao de UUID no codigo — e UUID
-- nao se completa por prefixo nesta casa.
--
-- APLICACAO: via MCP `apply_migration` no projeto ckcdevcxgvueywivefgx.
-- NUNCA SQL Editor, NUNCA `db push`.
--
-- ⚠️ PREFIXO: `20260905110000` e exclusivo desta onda. O plano 239-01 leva
-- `20260905100000`, o 239-03 leva `20260905120000` e o 239-04 leva
-- `20260905130000`. O Supabase usa o prefixo como VERSAO e duas migrations com
-- o mesmo numero colidem, com ordem indefinida entre elas.
-- ────────────────────────────────────────────────────────────────────────────

-- ═══ 1. ml_shipment_frete — o esperado congelado, um registro por ENVIO ════
--
-- A chave e o ENVIO, nao o pedido, e isso e propriedade do dominio: carrinho
-- manda varios pedidos no MESMO envio, com UM custo. Chavear por pedido
-- multiplicaria o mesmo frete por N e inventaria despesa que nao existe.

create table if not exists public.ml_shipment_frete (
  organization_id  uuid        not null references public.organizations(id) on delete cascade,
  ml_user_id       bigint      null,
  shipment_id      text        not null,
  pack_id          text        null,
  list_cost        numeric     null,
  base_cost_ref    numeric     null,
  custo_vendedor   numeric     null,
  custo_comprador  numeric     null,
  logistic_type    text        null,
  capturado_em     timestamptz not null default now(),
  visto_em         timestamptz not null default now(),

  constraint ml_shipment_frete_pk primary key (organization_id, shipment_id)
);

comment on table public.ml_shipment_frete is
  '239-02: o custo de tabela do frete CONGELADO NA DATA DA VENDA, um registro por envio, vindo de '
  'GET /shipments/{id}. 🔴 Existe porque a regua por anuncio (`ml_item_frete_tabela`, 225-06) so '
  'comeca em 04/09/2026 e devolve o custo de HOJE: venda antiga nao tem regua vigente e nunca '
  'teria. O envio, ao contrario, guarda o que valia quando a compra aconteceu — e a unica fonte '
  'de esperado HISTORICO que sobreviveu. Alvo: os 1.137 pedidos rotulados '
  '`frete_sem_vigencia_na_venda` mais os 49 de `possivel_carrinho` (M-01), que hoje sao 98,8% das '
  '1.200 linhas de frete da tela e provam ZERO das tres linhas do card (M-08). ⚠️ Esta tabela e '
  'MATERIA-PRIMA: ela nao faz nenhum card provar nada sozinha — quem liga a regua e o 239-03.';

comment on column public.ml_shipment_frete.list_cost is
  '🔴 A REGUA. `shipping_option.list_cost` do payload do envio — o custo de tabela congelado na '
  'compra. Medido em M-07 (04/09/2026): `cobrado == list_cost` AO CENTAVO em 6 de 6 pedidos de '
  '03/09, comparando a fatura do ML com o payload do envio. As duas grandezas estao na mesma '
  'base. ⚠️ NULO quando o payload nao traz `shipping_option` — e ausencia viaja como AUSENCIA. '
  'Cair para `base_cost` neste campo e PROIBIDO e testado no portao: `base_cost` foi maior nos 6 '
  'de 6 (28,70 x 27,05 · 90,50 x 45,25) e usa-lo como regua fabricaria "frete cobrado a menor" '
  'em 100% dos pedidos.';

comment on column public.ml_shipment_frete.base_cost_ref is
  '🔴 DIAGNOSTICO, NUNCA REGUA. `base_cost` e funcao do DESTINO e foi SEMPRE MAIOR que o cobrado '
  'nos 6 pedidos de M-07 (28,70 / 38,10 / 26,50 / 74,00 / 90,50 / 48,60 contra 27,05 / 19,05 / '
  '25,45 / 45,25 / 45,25 / 34,04). Guardado para um uso unico: se o esperado divergir '
  'sistematicamente na populacao antiga, comparar contra o base_cost e o caminho de remedicao. '
  'Usa-lo na comparacao produziria divergencia inventada — e uma tela de acusacao falsa.';

comment on column public.ml_shipment_frete.custo_vendedor is
  'A SEGUNDA FONTE INDEPENDENTE: `senders[0].cost` de GET /shipments/{id}/costs. Bateu com o '
  'cobrado em 5 dos 6 pedidos de M-07. ⚠️ No 6º nao bateu sozinho — o comprador pagou parte e foi '
  '`senders[].cost` (19,05) + `receiver.cost` (14,99) = 34,04 que fechou. Por isso as duas pontas '
  'sao colunas SEPARADAS: somar aqui esconderia qual das duas explica o numero. Quem soma e a '
  'regua do 239-03, que ve as duas.';

comment on column public.ml_shipment_frete.custo_comprador is
  'A outra ponta: `receiver.cost` do mesmo payload de custos — o que o COMPRADOR pagou de frete. '
  'Zero em 5 dos 6 pedidos de M-07 (frete gratis, quem paga e o vendedor) e 14,99 no 6º. 🔴 Nao '
  'confundir com `orders.frete`, onde as duas grandezas ja estao COLAPSADAS por '
  '`sync-ml-orders`: la nao da mais para saber se o numero e o que o ML cobrou de nos ou o que o '
  'comprador pagou. A separacao aqui e o ponto todo da tabela.';

comment on column public.ml_shipment_frete.visto_em is
  'Ultima vez que a captura OBSERVOU este envio. Distingue "o envio nao mudou desde X" de '
  '"ninguem olha desde X" — sem essa coluna a serie fica indistinguivel de uma captura parada, '
  'que e a assinatura do dado velho servido como atual.';

create index if not exists ml_shipment_frete_pack_idx
  on public.ml_shipment_frete (organization_id, pack_id);

alter table public.ml_shipment_frete enable row level security;

drop policy if exists ml_shipment_frete_select on public.ml_shipment_frete;
create policy ml_shipment_frete_select on public.ml_shipment_frete
  for select to authenticated
  using (public.is_org_member(auth.uid(), organization_id));

-- ═══ 2. ml_shipment_pedido — o mapa pedido -> envio ════════════════════════
--
-- 🔴 SEM ESTE MAPA, CARRINHO CONTINUA SENDO HEURISTICA. Hoje o rotulo
-- `possivel_carrinho` (49 pedidos, M-01) nasce de "mesmo comprador, mesmo dia"
-- — uma SUPOSICAO. O `shipment_id` compartilhado e FATO: dois pedidos com o
-- mesmo envio estao no mesmo pacote, ponto. E a diferenca entre o 239-03
-- apurar o pacote uma vez e continuar chutando.
--
-- A relacao e 1:N no sentido envio -> pedido, e e por isso que a chave aqui e o
-- PEDIDO enquanto la e o envio.

create table if not exists public.ml_shipment_pedido (
  organization_id  uuid        not null references public.organizations(id) on delete cascade,
  ml_order_id      text        not null,
  shipment_id      text        not null,
  pack_id          text        null,
  capturado_em     timestamptz not null default now(),

  constraint ml_shipment_pedido_pk primary key (organization_id, ml_order_id)
);

comment on table public.ml_shipment_pedido is
  '239-02: o mapa PEDIDO -> ENVIO, de `shipping.id` em GET /orders/{id}. 🔴 Existe porque envio e '
  '1:N com pedido em carrinho e sem ele o rotulo `possivel_carrinho` (49 pedidos, M-01) continua '
  'sendo "mesmo comprador, mesmo dia" — suposicao, nao fato. `shipment_id` compartilhado e prova '
  'de que os pedidos viajam no mesmo pacote, e e o que permite ao 239-03 apurar o frete UMA VEZ '
  'por pacote em vez de multiplicar o mesmo custo por N pedidos.';

comment on column public.ml_shipment_pedido.shipment_id is
  'Chave estrangeira LOGICA para `ml_shipment_frete` — nao declarada como FK de proposito: o par '
  'pedido->envio e gravado ANTES de o envio ser buscado, e um envio que devolveu erro na leitura '
  'nao pode impedir o mapa de existir. O mapa e conhecimento; o custo e outra coisa.';

create index if not exists ml_shipment_pedido_envio_idx
  on public.ml_shipment_pedido (organization_id, shipment_id);

create index if not exists ml_shipment_pedido_pack_idx
  on public.ml_shipment_pedido (organization_id, pack_id);

alter table public.ml_shipment_pedido enable row level security;

drop policy if exists ml_shipment_pedido_select on public.ml_shipment_pedido;
create policy ml_shipment_pedido_select on public.ml_shipment_pedido
  for select to authenticated
  using (public.is_org_member(auth.uid(), organization_id));

-- ═══ 3. ml_shipment_frete_captura — o estado da varredura ══════════════════
--
-- Existe por duas razoes, e as duas sao do plano:
--
--  (a) ORCAMENTO POR INVOCACAO com continuacao. Varrer 1.200 pedidos sem teto
--      estoura o tempo da funcao; varrer sempre do inicio nunca alcanca o fim.
--      A ordem e `ultima_tentativa asc nulls first`.
--
--  (b) 🔴 PEDIDO SEM ENVIO PROPRIO E CONDICAO NORMAL, NAO ERRO. O mesmo vale
--      para envio cujo payload nao traz `shipping_option`. Contar os dois como
--      falha faria a cobertura mentir para BAIXO e a taxa de erro mentir para
--      CIMA ao mesmo tempo — e a decisao sobre a premissa A2 (se envio
--      `fulfillment` traz `shipping_option`) depende justamente de conseguir
--      separar `sem_opcao_de_envio` de `erro`.

create table if not exists public.ml_shipment_frete_captura (
  organization_id  uuid        not null references public.organizations(id) on delete cascade,
  ml_user_id       bigint      null,
  ml_order_id      text        not null,
  ultima_tentativa timestamptz not null default now(),
  ultimo_status    text        not null,
  tentativas       int         not null default 1,
  ultimo_erro      text        null,

  constraint ml_shipment_frete_captura_pk primary key (organization_id, ml_order_id)
);

comment on table public.ml_shipment_frete_captura is
  '239-02: estado da varredura do esperado por envio, um registro por PEDIDO. NAO guarda dinheiro '
  '— guarda "quando tentei e o que aconteceu". 🔴 `ultimo_status` distingue cinco desfechos e a '
  'distincao e o coracao do desenho: `ok` (envio lido com custo), `sem_envio` (pedido sem '
  '`shipping.id` — CONDICAO NORMAL), `sem_opcao_de_envio` (o payload do envio nao trouxe '
  '`shipping_option` — tambem normal, e o que APROVA OU REFUTA a premissa A2), `erro` (falha real) '
  'e `bloqueio` (429 do ML). Somar `sem_envio` e `sem_opcao_de_envio` dentro de `erro` faria a '
  'cobertura mentir para baixo e a taxa de erro mentir para cima na mesma consulta.';

comment on column public.ml_shipment_frete_captura.ultima_tentativa is
  'Ordena a fila da proxima invocacao (`asc nulls first`) E serve de trava diaria: pedido ja '
  'tentado hoje e pulado. 🔴 Sem a trava, um pedido que devolve erro voltaria ao topo da fila a '
  'cada rodada e consumiria o orcamento inteiro numa lista que nunca avanca — e o bloqueio do ML '
  'por excesso e por ENDERECO DE ORIGEM, ou seja, derrubaria `sync-ml-orders`, `sync-ml-billing` '
  'e ads junto.';

comment on column public.ml_shipment_frete_captura.ultimo_status is
  'O desfecho da ultima tentativa. 🔴 `bloqueio` e terminal por rodada: um unico 429 interrompe a '
  'varredura inteira e NAO dispara continuacao. Linha em `bloqueio` sobrando depois do backfill e '
  'condicao de REPROVACAO do portao P2-B, nao ruido.';

create index if not exists ml_shipment_frete_captura_fila_idx
  on public.ml_shipment_frete_captura (organization_id, ultima_tentativa asc);

alter table public.ml_shipment_frete_captura enable row level security;

drop policy if exists ml_shipment_frete_captura_select on public.ml_shipment_frete_captura;
create policy ml_shipment_frete_captura_select on public.ml_shipment_frete_captura
  for select to authenticated
  using (public.is_org_member(auth.uid(), organization_id));

-- Nenhuma policy de INSERT/UPDATE/DELETE nas tres: a escrita e exclusiva do
-- papel de servico, que passa por cima de RLS por definicao. Mesma disciplina
-- de `cash_inflows`, `ml_order_sale_fee` e `ml_item_frete_tabela`.

-- ═══ 4. ACL — 🔴 `from anon` e EXPLICITO ═══════════════════════════════════
--
-- Revogar de PUBLIC NAO desfaz o grant direto que o Supabase concede a `anon`.
-- R-08(c) da fase 225 falhou exatamente nisso.

revoke all on public.ml_shipment_frete         from anon;
revoke all on public.ml_shipment_pedido        from anon;
revoke all on public.ml_shipment_frete_captura from anon;

grant select on public.ml_shipment_frete         to authenticated;
grant select on public.ml_shipment_pedido        to authenticated;
grant select on public.ml_shipment_frete_captura to authenticated;

-- ═══ 5. Guardas finais: falha alto em vez de aplicar pela metade ═══════════

DO $$
DECLARE
  v_tabela     text;
  v_rls_ligada boolean;
  v_policies   integer;
  v_sem_org    integer;
  v_escrita    integer;
  v_anon       boolean;
BEGIN
  FOREACH v_tabela IN ARRAY ARRAY[
    'ml_shipment_frete', 'ml_shipment_pedido', 'ml_shipment_frete_captura'
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

    -- Quem escreve e o papel de servico. Policy de escrita para `authenticated`
    -- daria ao navegador o poder de forjar o esperado do frete — o numero que
    -- a acusacao vai usar.
    SELECT count(*) INTO v_escrita
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = v_tabela
       AND cmd <> 'SELECT' AND 'authenticated' = ANY(roles);

    IF v_escrita > 0 THEN
      RAISE EXCEPTION 'tabela % tem policy de escrita para authenticated — a escrita e do papel de servico', v_tabela;
    END IF;

    -- 🔴 A guarda que R-08(c) ensinou: revoke de PUBLIC nao alcanca `anon`.
    SELECT has_table_privilege('anon', 'public.' || v_tabela, 'SELECT') INTO v_anon;
    IF v_anon THEN
      RAISE EXCEPTION 'anon ainda LE a tabela % — o revoke de PUBLIC nao desfaz o grant direto', v_tabela;
    END IF;
  END LOOP;

  -- As tres nascem VAZIAS: quem captura e a edge function, sob papel de servico.
  IF EXISTS (SELECT 1 FROM public.ml_shipment_frete) THEN
    RAISE EXCEPTION 'ml_shipment_frete nao pode nascer com linhas — a captura e da edge function';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ml_shipment_pedido) THEN
    RAISE EXCEPTION 'ml_shipment_pedido nao pode nascer com linhas — a captura e da edge function';
  END IF;
END $$;
