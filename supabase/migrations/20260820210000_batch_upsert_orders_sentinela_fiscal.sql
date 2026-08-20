-- Sentinela de intenção nos onze campos fiscais do upsert incremental
-- (Quick 260820-3aa) — fecha o defeito ATIVO medido em produção em 20/08/2026.
--
-- O DEFEITO, COM OS NÚMEROS: uma rodada de sync-ml-orders respondeu 65
-- pedidos e buscou ZERO envios (rodada incremental — `jaCompletos` pulou o
-- detalhe de todos, porque frete+estado já estavam no banco). Ainda assim
-- 103 linhas saíram marcadas `tax_versao = 2` com todos os componentes
-- fiscais ausentes, numa base que já tinha esses componentes calculados por
-- rodada anterior ou pelo backfill. 222-PROVA.md, seção "PORTÃO BATIDO",
-- documenta a medição.
--
-- A CADEIA: sync incremental pula a busca do envio → o endereço do
-- comprador só existe na resposta do envio → `estado` chega `null` em
-- `expandOrder` → `computeOrderTax` devolve `motivo: "destino_desconhecido"`
-- e os 11 campos fiscais (10 componentes + o marcador `tax_versao`) saem
-- `null` no breakdown → a atribuição DIRETA no `DO UPDATE SET` desta função
-- grava esse `null` por CIMA do que uma rodada anterior (ou o backfill do
-- 222-05) já tinha apurado corretamente.
--
-- POR QUE A ATRIBUIÇÃO DIRETA ERA ASSIM (E POR QUE A RAZÃO ESTAVA ERRADA): o
-- comentário da migration `20260812210000` justifica assim: "COALESCE aqui
-- congelaria o valor da régua antiga para sempre — exatamente o que o
-- backfill do 222-05 precisa poder sobrescrever". Isso está FACTUALMENTE
-- ERRADO: `recalc-order-costs/index.ts` (o backfill) escreve por UPDATE
-- DIRETO em `orders` via PostgREST — nunca chama esta função. Grep
-- confirmado: `batch_upsert_orders` tem UM único chamador, `sync-ml-orders`.
-- O requisito que a atribuição direta protegia já é atendido por OUTRA
-- porta, e nunca dependeu do `DO UPDATE SET` desta função.
--
-- POR QUE A SENTINELA E NÃO `COALESCE` SIMPLES: `recalc-order-costs` monta o
-- patch com "só grava campo não nulo" — o backfill NUNCA escreve `NULL` num
-- componente fiscal. Se este `DO UPDATE SET` também perdesse a capacidade de
-- gravar ausência (o que `COALESCE` simples faria), um componente NÃO-NULO
-- ERRADO (tabela de UF desatualizada, pedido que deixou de ser
-- interestadual) ficaria inalcançável por qualquer porta automática — só SQL
-- à mão limparia. A Fase 220 já pagou por um número errado inalcançável
-- (quatro meses de alíquota errada); esta migration não repete o erro em
-- onze colunas de uma vez.
--
-- A SAÍDA (C, 260820-3aa-PLAN.md): `tax_versao` presente no payload passa a
-- significar "esta rodada apurou a régua" — libera a escrita dos 11 campos.
-- `tax_versao` ausente (chave que não existe no jsonb, não valor nulo)
-- significa "esta rodada não teve insumo" — a linha inteira é preservada. A
-- metade CLIENTE já foi entregue em `orderTaxRate.ts`
-- (`camposFiscaisParaUpsert`/`reguaApurouNestaRodada`, commit anterior desta
-- mesma entrega): quando a rodada não apura, o record do upsert não carrega
-- NENHUMA das 11 chaves — nem com valor `null`.
--
-- MOLDE OBRIGATÓRIO: mesma técnica de `20260806233000_batch_upsert_orders_
-- preserva_imposto.sql` — ler `prosrc` de `pg_proc`, `regexp_replace`
-- cirúrgico sobre o corpo VIVO, `CREATE OR REPLACE` (nunca um comando
-- destrutivo — apagar a função apagaria o GRANT de `service_role` de que
-- `sync-ml-orders` depende para gravar). Não editar `20260812210000`: ela já
-- está aplicada em produção, com `md5(prosrc)` conferido byte a byte
-- (`222-PROVA.md`, Passo 1).
--
-- A guarda do bloco final foi ESTENDIDA de propósito: além dos dez
-- `COALESCE` herdados e das quinze colunas, ela passa a exigir as dez novas
-- guardas de intenção (`CASE WHEN ... END`) e a preservação do marcador.

-- ────────────────────────────────────────────────────────────────────────
-- BLOCO 1 — substituição cirúrgica sobre o corpo vivo
-- ────────────────────────────────────────────────────────────────────────
-- Onze substituições: dez guardas de intenção (`CASE WHEN EXCLUDED.tax_versao
-- IS NULL THEN orders.<col> ELSE EXCLUDED.<col> END`) mais a preservação do
-- marcador (`COALESCE(EXCLUDED.tax_versao, orders.tax_versao)`).
--
-- `\m`/`\M` (limite de palavra do Postgres, regex avançada) em vez de match
-- literal solto: sem eles, o padrão de `pis_cofins_debito` casaria dentro de
-- `pis_cofins_debito_com_difal`. `pis_cofins_debito_com_difal` é trocado
-- ANTES de `pis_cofins_debito` pela mesma razão — mesmo com `\M`, trocar a
-- mais específica primeiro é a ordem mais segura.
--
-- Idempotente por desenho: na segunda aplicação, o corpo já não tem mais
-- `<col> = EXCLUDED.<col>,` (virou `CASE WHEN ...`), então nenhum
-- `regexp_replace` casa, `v_new = v_src`, o `CREATE OR REPLACE` reaplica o
-- MESMO corpo, e a guarda do Bloco 2 (que testa o RESULTADO, nunca quantas
-- substituições casaram nesta rodada) passa do mesmo jeito.
do $$
declare
  v_src text;
  v_new text;
begin
  select prosrc into v_src from pg_proc
   where proname = 'batch_upsert_orders'
     and pronamespace = 'public'::regnamespace;
  if v_src is null then
    raise exception 'batch_upsert_orders nao encontrada';
  end if;

  v_new := v_src;

  -- 1. pis_cofins_debito_com_difal — ANTES de pis_cofins_debito (prefixo comum).
  v_new := regexp_replace(
    v_new,
    '\mpis_cofins_debito_com_difal\M\s*=\s*EXCLUDED\.pis_cofins_debito_com_difal\M\s*,',
    'pis_cofins_debito_com_difal = CASE WHEN EXCLUDED.tax_versao IS NULL THEN orders.pis_cofins_debito_com_difal ELSE EXCLUDED.pis_cofins_debito_com_difal END,'
  );

  -- 2. icms_debito
  v_new := regexp_replace(
    v_new,
    '\micms_debito\M\s*=\s*EXCLUDED\.icms_debito\M\s*,',
    'icms_debito = CASE WHEN EXCLUDED.tax_versao IS NULL THEN orders.icms_debito ELSE EXCLUDED.icms_debito END,'
  );

  -- 3. pis_cofins_debito
  v_new := regexp_replace(
    v_new,
    '\mpis_cofins_debito\M\s*=\s*EXCLUDED\.pis_cofins_debito\M\s*,',
    'pis_cofins_debito = CASE WHEN EXCLUDED.tax_versao IS NULL THEN orders.pis_cofins_debito ELSE EXCLUDED.pis_cofins_debito END,'
  );

  -- 4. credito_pc_comissao
  v_new := regexp_replace(
    v_new,
    '\mcredito_pc_comissao\M\s*=\s*EXCLUDED\.credito_pc_comissao\M\s*,',
    'credito_pc_comissao = CASE WHEN EXCLUDED.tax_versao IS NULL THEN orders.credito_pc_comissao ELSE EXCLUDED.credito_pc_comissao END,'
  );

  -- 5. credito_pc_frete
  v_new := regexp_replace(
    v_new,
    '\mcredito_pc_frete\M\s*=\s*EXCLUDED\.credito_pc_frete\M\s*,',
    'credito_pc_frete = CASE WHEN EXCLUDED.tax_versao IS NULL THEN orders.credito_pc_frete ELSE EXCLUDED.credito_pc_frete END,'
  );

  -- 6. credito_icms_frete
  v_new := regexp_replace(
    v_new,
    '\mcredito_icms_frete\M\s*=\s*EXCLUDED\.credito_icms_frete\M\s*,',
    'credito_icms_frete = CASE WHEN EXCLUDED.tax_versao IS NULL THEN orders.credito_icms_frete ELSE EXCLUDED.credito_icms_frete END,'
  );

  -- 7. difal_base
  v_new := regexp_replace(
    v_new,
    '\mdifal_base\M\s*=\s*EXCLUDED\.difal_base\M\s*,',
    'difal_base = CASE WHEN EXCLUDED.tax_versao IS NULL THEN orders.difal_base ELSE EXCLUDED.difal_base END,'
  );

  -- 8. difal_amount
  v_new := regexp_replace(
    v_new,
    '\mdifal_amount\M\s*=\s*EXCLUDED\.difal_amount\M\s*,',
    'difal_amount = CASE WHEN EXCLUDED.tax_versao IS NULL THEN orders.difal_amount ELSE EXCLUDED.difal_amount END,'
  );

  -- 9. fcp_amount
  v_new := regexp_replace(
    v_new,
    '\mfcp_amount\M\s*=\s*EXCLUDED\.fcp_amount\M\s*,',
    'fcp_amount = CASE WHEN EXCLUDED.tax_versao IS NULL THEN orders.fcp_amount ELSE EXCLUDED.fcp_amount END,'
  );

  -- 10. difal_fonte
  v_new := regexp_replace(
    v_new,
    '\mdifal_fonte\M\s*=\s*EXCLUDED\.difal_fonte\M\s*,',
    'difal_fonte = CASE WHEN EXCLUDED.tax_versao IS NULL THEN orders.difal_fonte ELSE EXCLUDED.difal_fonte END,'
  );

  -- 11. tax_versao — a única que termina em ponto e vírgula (última do SET),
  -- e a única que recebe preservação SIMPLES: presença decide, não valor.
  v_new := regexp_replace(
    v_new,
    '\mtax_versao\M\s*=\s*EXCLUDED\.tax_versao\M\s*;',
    'tax_versao = COALESCE(EXCLUDED.tax_versao, orders.tax_versao);'
  );

  execute format(
    'CREATE OR REPLACE FUNCTION public.batch_upsert_orders(p_records jsonb) '
    'RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS %L',
    v_new);
end $$;

-- ────────────────────────────────────────────────────────────────────────
-- BLOCO 2 — guarda (asserta sobre o RESULTADO, não sobre a rodada de substituição)
-- ────────────────────────────────────────────────────────────────────────
-- Re-lê `pg_proc` DEPOIS do `CREATE OR REPLACE` do Bloco 1 — falha alto e é
-- idempotente porque testa o que o corpo da função É, nunca quantas
-- substituições casaram nesta execução específica (na segunda aplicação,
-- zero casam, e o corpo já tem tudo isso — a guarda passa do mesmo jeito).
do $$
declare
  v_src        text;
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
  -- Os dez COALESCE herdados — mesmos literais do bloco 3 de 20260812210000.
  -- Não tocados por esta migration; a guarda confirma que continuam vivos.
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
  -- As quinze colunas de 20260812210000 seguem obrigadas a aparecer >= 3
  -- vezes (INSERT + SELECT + DO UPDATE SET) — repete a verificação existente,
  -- que é o que impede uma whitelist meia de passar em silêncio. ⚠️
  -- `pis_cofins_debito` também casa dentro de `pis_cofins_debito_com_difal`
  -- e o número sai inflado — aceito, o teste é `< 3`, inflar nunca produz
  -- falso verde para "coluna sumiu".
  v_cols       text[] := array[
    'logistic_type', 'bonus_envio', 'custo_entrega', 'frete_comprador',
    'icms_debito', 'pis_cofins_debito', 'pis_cofins_debito_com_difal',
    'credito_pc_comissao', 'credito_pc_frete', 'credito_icms_frete',
    'difal_base', 'difal_amount', 'fcp_amount', 'difal_fonte', 'tax_versao'
  ];
  v_item       text;
  v_ocorrencias int;
begin
  select prosrc into v_src from pg_proc
   where proname = 'batch_upsert_orders'
     and pronamespace = 'public'::regnamespace;
  if v_src is null then
    raise exception 'batch_upsert_orders nao encontrada apos CREATE OR REPLACE';
  end if;

  -- (a) as dez guardas de intencao, nome a nome.
  foreach v_item in array v_guardas loop
    if position(v_item in v_src) = 0 then
      raise exception 'guarda de intencao sumiu do corpo da funcao: % -- CASE WHEN esperado nao encontrado', v_item;
    end if;
  end loop;

  -- (b) a preservacao do marcador.
  if position(v_marcador in v_src) = 0 then
    raise exception 'preservacao do marcador sumiu do corpo da funcao: %', v_marcador;
  end if;

  -- (c) os dez COALESCE obrigatorios herdados.
  foreach v_item in array v_coalesces loop
    if position(v_item in v_src) = 0 then
      raise exception 'COALESCE obrigatorio sumiu do corpo da funcao: % -- preserve historico desfeito por engano', v_item;
    end if;
  end loop;

  -- (d) as quinze colunas, cada uma pelo menos tres vezes.
  foreach v_item in array v_cols loop
    v_ocorrencias := (length(v_src) - length(replace(v_src, v_item, ''))) / length(v_item);
    if v_ocorrencias < 3 then
      raise exception 'coluna % aparece % vez(es) no corpo da funcao, esperava pelo menos 3 -- whitelist incompleta', v_item, v_ocorrencias;
    end if;
  end loop;

  raise notice '260820-3aa: % guardas de intencao + 1 marcador + % COALESCE herdados + % colunas (>=3x cada) confirmados no corpo de batch_upsert_orders',
    array_length(v_guardas, 1), array_length(v_coalesces, 1), array_length(v_cols, 1);
end $$;
