-- Alinhamento das colunas fiscais do INSERT de batch_upsert_orders (Quick
-- 260820-4kk) — fecha o TERCEIRO DEFEITO ESTRUTURAL da Fase 222.
--
-- O DEFEITO, COM OS NÚMEROS: pedido `2000018000892664` (SP→MG, receita
-- 669,29 · comissão 36,82 · frete 30,75) saiu com `credito_icms_frete` =
-- 50,7656 sobre um frete de 30,75 -- aritmeticamente impossível (crédito de
-- ICMS sobre o frete nunca excede o próprio frete). `tax_amount` NÃO foi
-- afetado (vem de `breakdown.taxAmount`, coluna própria); quem quebra de
-- verdade é `difal_efeito_liquido(difal, fcp, pc_debito, pc_debito_com_difal)`,
-- que lê `pis_cofins_debito_com_difal` -- e essa coluna, hoje, recebe o valor
-- que a projeção calculou para `credito_pc_comissao`. O segundo número
-- (cenário COM DIFAL) das 12 telas sairia PLAUSÍVEL e ERRADO.
--
-- A CAUSA: em `public.batch_upsert_orders`, a lista de COLUNAS do `INSERT` e
-- a lista de VALORES do `SELECT` estão desalinhadas por uma posição no bloco
-- fiscal. Quatro ordenações descrevem o mesmo bloco, e três já concordam:
--
--   ordenação                                   posição de pis_cofins_debito_com_difal
--   ordem física da tabela (ALTER TABLE, 20260812210000)   depois de credito_icms_frete
--   projeção do SELECT (corpo da função)                   depois de credito_icms_frete
--   DO UPDATE SET (corpo da função)                         depois de credito_icms_frete
--   lista de COLUNAS do INSERT (corpo da função)            ANTES de credito_pc_comissao ❌
--
-- A lista de colunas do INSERT é a única dissidente -- agrupou
-- `pis_cofins_debito_com_difal` junto de `pis_cofins_debito` por parentesco
-- semântico, e foi exatamente esse agrupamento que criou o defeito. Esta
-- migration move `pis_cofins_debito_com_difal` da posição 3 para a posição 6
-- DENTRO do bloco de seis colunas fiscais (icms_debito, pis_cofins_debito,
-- pis_cofins_debito_com_difal, credito_pc_comissao, credito_pc_frete,
-- credito_icms_frete) -- fazendo as quatro ordenações coincidirem. Reordenar
-- a projeção, ao contrário, criaria DUAS novas divergências (contra a ordem
-- física e contra o DO UPDATE SET) -- mesma armadilha, só que adiada.
--
-- POR QUE REGEX DE BLOCO, E NÃO A FORMA DO 8B (substituição de termo): os
-- seis nomes precisam continuar existindo nas duas listas -- só as posições
-- mudam. Uma troca de termo (a forma do 8B) corromperia as outras três
-- listas onde os mesmos seis nomes aparecem noutra forma sintática. O que
-- resolve é substituição de BLOCO, ancorada numa sequência de tokens que só
-- existe num lugar do corpo: a forma "nomes crus separados por vírgula"
-- existe SÓ na lista de colunas do INSERT -- na projeção os nomes aparecem
-- dentro de `r->>'nome'`, no DO UPDATE SET como `nome = CASE WHEN ... END`.
-- A unicidade é demonstrável, não presumida (medido: o padrão abaixo casa em
-- exatamente um ponto do corpo).
--
-- POR QUE A GUARDA PROVA POSIÇÃO, E NÃO PRESENÇA: contagem não serve -- as
-- duas listas continuam com os mesmos seis nomes, só trocados. Qualquer
-- guarda de "aparece >= 3 vezes" (a de 20260812210000) passa em silêncio no
-- estado defeituoso -- foi assim que o defeito atravessou dois portões. A
-- guarda do BLOCO 2 é total e posicional, e só é possível porque foi medido
-- que, nas 44 colunas, o nome da coluna é IDÊNTICO à chave JSON lida na
-- projeção (`ml_order_id` ↔ `r->>'ml_order_id'`, ..., `tax_versao` ↔
-- `r->>'tax_versao'`). Um desalinhamento de uma posição quebra a comparação
-- e a migration ABORTA, nomeando a posição, a coluna e o valor que ela
-- estaria recebendo.
--
-- RESTRIÇÕES INEGOCIÁVEIS: NÃO editar `20260812210000` (já aplicada em
-- produção, md5 do prosrc conferido -- a correção é migration NOVA). NÃO
-- tocar o `DO UPDATE SET` -- é lá que a sentinela do 8B
-- (`20260820210000_batch_upsert_orders_sentinela_fiscal.sql`) vive, e o
-- padrão do BLOCO 1 abaixo não a alcança (a forma "nome = CASE WHEN ... END"
-- não casa com o padrão de nomes crus separados por vírgula). A guarda do
-- BLOCO 2 re-afirma as dez guardas de intenção + o marcador por segurança,
-- mesmo sem tocar naquele bloco. `CREATE OR REPLACE`, sempre -- nenhum
-- comando destrutivo de remoção de função, que apagaria o GRANT de
-- `service_role` de que `sync-ml-orders` depende para gravar.

-- ────────────────────────────────────────────────────────────────────────
-- BLOCO 1 — substituição cirúrgica sobre o corpo vivo
-- ────────────────────────────────────────────────────────────────────────
-- Idempotente por desenho, igual ao 8B: na segunda aplicação o padrão não
-- casa mais (a lista já está na ordem nova), `v_new = v_src`, o
-- `CREATE OR REPLACE` reaplica o MESMO corpo, e a guarda do BLOCO 2 -- que
-- testa o RESULTADO, nunca quantas substituições casaram nesta rodada --
-- passa do mesmo jeito.
do $$
declare
  v_src    text;
  v_new    text;
  -- gsd:padrao-inicio
  v_padrao text := 'icms_debito,\s*pis_cofins_debito,\s*pis_cofins_debito_com_difal,\s*credito_pc_comissao,\s*credito_pc_frete,\s*credito_icms_frete,';
  v_troca  text := 'icms_debito, pis_cofins_debito, credito_pc_comissao, credito_pc_frete, credito_icms_frete, pis_cofins_debito_com_difal,';
  -- gsd:padrao-fim
  -- ⚠️ O literal acima não usa `\m`/`\M`/`\y` (limite de palavra da regex
  -- AVANÇADA do Postgres) de propósito: o teste offline
  -- `batchUpsertColunasAlinhadas.test.ts` roda o MESMO literal no motor de
  -- regex do JavaScript, e essas construções não existem lá. Sem essa
  -- restrição, o teste provaria uma substituição diferente da que o banco
  -- executa.
begin
  select prosrc into v_src from pg_proc
   where proname = 'batch_upsert_orders'
     and pronamespace = 'public'::regnamespace;
  if v_src is null then
    raise exception 'batch_upsert_orders nao encontrada';
  end if;

  v_new := regexp_replace(v_src, v_padrao, v_troca);

  execute format(
    'CREATE OR REPLACE FUNCTION public.batch_upsert_orders(p_records jsonb) '
    'RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS %L',
    v_new);
end $$;

-- ────────────────────────────────────────────────────────────────────────
-- BLOCO 2 — guarda POSICIONAL (asserta sobre o RESULTADO, não sobre a rodada
-- de substituição) + defesa em profundidade da sentinela do 8B
-- ────────────────────────────────────────────────────────────────────────
do $$
declare
  v_src        text;
  v_analise    text;
  v_cols       text[];
  v_keys       text[];
  i            int;
  -- As dez guardas de intenção + o marcador instalados pela sentinela do 8B
  -- (20260820210000). O padrão do BLOCO 1 não toca o DO UPDATE SET, mas esta
  -- guarda não presume isso -- ela reconfere.
  v_guardas    text[] := array[
    'icms_debito = CASE WHEN EXCLUDED.tax_versao IS NULL THEN orders.icms_debito ELSE EXCLUDED.icms_debito END',
    'pis_cofins_debito = CASE WHEN EXCLUDED.tax_versao IS NULL THEN orders.pis_cofins_debito ELSE EXCLUDED.pis_cofins_debito END',
    'pis_cofins_debito_com_difal = CASE WHEN EXCLUDED.tax_versao IS NULL THEN orders.pis_cofins_debito_com_difal ELSE EXCLUDED.pis_cofins_debito_com_difal END',
    'credito_pc_comissao = CASE WHEN EXCLUDED.tax_versao IS NULL THEN orders.credito_pc_comissao ELSE EXCLUDED.credito_pc_comissao END',
    'credito_pc_frete = CASE WHEN EXCLUDED.tax_versao IS NULL THEN orders.credito_pc_frete ELSE EXCLUDED.credito_pc_frete END',
    'credito_icms_frete = CASE WHEN EXCLUDED.tax_versao IS NULL THEN orders.credito_icms_frete ELSE EXCLUDED.credito_icms_frete END',
    'difal_base = CASE WHEN EXCLUDED.tax_versao IS NULL THEN orders.difal_base ELSE EXCLUDED.difal_base END',
    'difal_amount = CASE WHEN EXCLUDED.tax_versao IS NULL THEN orders.difal_amount ELSE EXCLUDED.difal_amount END',
    'fcp_amount = CASE WHEN EXCLUDED.tax_versao IS NULL THEN orders.fcp_amount ELSE EXCLUDED.fcp_amount END',
    'difal_fonte = CASE WHEN EXCLUDED.tax_versao IS NULL THEN orders.difal_fonte ELSE EXCLUDED.difal_fonte END'
  ];
  v_marcador   text := 'COALESCE(EXCLUDED.tax_versao, orders.tax_versao)';
  -- Os dez COALESCE herdados (Fase 219/220 + D-R2-04) -- mesmos literais do
  -- BLOCO 2 de 20260820210000. Não tocados por esta migration.
  v_coalesces  text[] := array[
    'COALESCE(EXCLUDED.frete, orders.frete)',
    'COALESCE(EXCLUDED.estado, orders.estado)',
    'COALESCE(EXCLUDED.cidade, orders.cidade)',
    'COALESCE(EXCLUDED.custo_unit, orders.custo_unit)',
    'COALESCE(EXCLUDED.custo_unit_cheio, orders.custo_unit_cheio)',
    'COALESCE(EXCLUDED.tax_rate, orders.tax_rate)',
    'COALESCE(EXCLUDED.tax_amount, orders.tax_amount)',
    'COALESCE(EXCLUDED.receita_bruta, orders.receita_bruta)',
    'COALESCE(EXCLUDED.receita_liquida, orders.receita_liquida)',
    'COALESCE(EXCLUDED.frete_comprador, orders.frete_comprador)'
  ];
  v_item       text;
begin
  select prosrc into v_src from pg_proc
   where proname = 'batch_upsert_orders'
     and pronamespace = 'public'::regnamespace;
  if v_src is null then
    raise exception 'batch_upsert_orders nao encontrada apos CREATE OR REPLACE';
  end if;

  -- Cópia de análise sem comentários de linha -- sem isso a guarda poderia
  -- se auto-satisfazer com texto de comentário em vez do corpo executável.
  v_analise := regexp_replace(v_src, '--[^\n]*', '', 'g');

  -- (a) as 44 colunas do INSERT, em ordem. `WITH ORDINALITY` é obrigatório:
  -- sem ele a ordem das linhas de uma função de conjunto não é garantida
  -- pelo padrão SQL, e uma guarda posicional que depende de ordem acidental
  -- não é guarda. `btrim(t, E' \t\n\r')` -- NUNCA `btrim(t)` sozinho: o
  -- default de `btrim` remove só ' ', e a lista de colunas quebra linha
  -- (INSERT INTO public.orders (\n    ml_order_id, ...) -- o primeiro token
  -- de CADA linha carrega `\n` + indentação à esquerda. `btrim(t)` sem o
  -- conjunto de caracteres para no primeiro `\n` e devolve
  -- '\n    ml_order_id' intacto, que nunca casa com a chave limpa
  -- 'ml_order_id' -- a guarda reprovava por espaço em branco antes de
  -- avaliar qualquer posição de verdade (medido ao vivo, aplicação real).
  select array_agg(btrim(t, E' \t\n\r') order by o) into v_cols
    from regexp_split_to_table(
           substring(v_analise from 'INSERT INTO public\.orders \(([^)]*)\)'),
           ','
         ) with ordinality as x(t, o);

  -- (b) as 44 chaves r->>'...' da projeção, em ordem.
  select array_agg(m[1] order by o) into v_keys
    from regexp_matches(v_analise, $re$r->>'([a-z_]+)'$re$, 'g') with ordinality as y(m, o);

  if coalesce(array_length(v_cols, 1), 0) <> 44 or coalesce(array_length(v_keys, 1), 0) <> 44 then
    raise exception
      'extracao truncada: % colunas do INSERT, % chaves da projecao -- esperava 44 de cada lado',
      coalesce(array_length(v_cols, 1), 0), coalesce(array_length(v_keys, 1), 0);
  end if;

  for i in 1..44 loop
    if v_cols[i] <> v_keys[i] then
      raise exception
        'posicao %: coluna ''%'' recebe o valor de ''%'' -- desalinhamento entre INSERT e SELECT',
        i, v_cols[i], v_keys[i];
    end if;
  end loop;

  -- (c) defesa em profundidade: a sentinela do 8B continua viva.
  foreach v_item in array v_guardas loop
    if position(v_item in v_src) = 0 then
      raise exception 'guarda de intencao do 8B sumiu do corpo da funcao: %', v_item;
    end if;
  end loop;

  if position(v_marcador in v_src) = 0 then
    raise exception 'marcador do 8B sumiu do corpo da funcao: %', v_marcador;
  end if;

  foreach v_item in array v_coalesces loop
    if position(v_item in v_src) = 0 then
      raise exception 'COALESCE herdado sumiu do corpo da funcao: %', v_item;
    end if;
  end loop;

  raise notice
    '260820-4kk: 44 posicoes conferidas (INSERT == SELECT) + % guardas de intencao do 8B + 1 marcador + % COALESCE herdados confirmados no corpo de batch_upsert_orders',
    array_length(v_guardas, 1), array_length(v_coalesces, 1);
end $$;
