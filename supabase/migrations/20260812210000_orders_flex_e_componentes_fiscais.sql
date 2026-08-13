-- Flex + componentes fiscais: 12 colunas novas em orders, e a whitelist de
-- batch_upsert_orders passa a conhece-las (Fase 222, plano 222-04).
--
-- (a) POR QUE 12 COLUNAS NUMA MIGRATION SO: reescrever a funcao de upsert
-- duas vezes na mesma fase e risco sem beneficio -- cada reescrita e uma
-- chance nova de a whitelist descartar um campo em silencio. As 12 colunas
-- desta fase (Flex + fiscal) nascem juntas, na mesma entrega, com a mesma
-- guarda.
--
-- (b) A ARMADILHA DA WHITELIST: batch_upsert_orders tem lista EXPLICITA de
-- colunas no INSERT, na projecao do SELECT e no DO UPDATE SET. Um campo que
-- o record da edge function manda mas que a funcao nao conhece e
-- DESCARTADO SEM ERRO -- e exatamente o que ja aconteceu na Fase 96-07
-- (Trava C): sync-ml-orders passou a mandar custo_unit_cheio, mas a funcao
-- de upsert nao sabia da coluna, e o campo morria no meio do caminho sem
-- nenhum log, nenhuma excecao -- so um numero que nunca mudava. Os tres
-- lugares (INSERT, SELECT, DO UPDATE SET) sao obrigatorios, e por isso o
-- Bloco 3 desta migration recusa aplicar se qualquer um faltar.
--
-- (c) POR QUE CREATE OR REPLACE E NUNCA UM COMANDO DESTRUTIVO: a
-- assinatura (jsonb) -> integer nao muda nesta migration. Apagar a funcao
-- para recria-la do zero apagaria o GRANT de service_role de que
-- sync-ml-orders depende para gravar -- CREATE OR REPLACE preserva a ACL.

-- ────────────────────────────────────────────────────────────────────────
-- BLOCO 1 — colunas
-- ────────────────────────────────────────────────────────────────────────
-- Todas nulaveis, nenhuma com valor padrao: null aqui significa "esta linha
-- ainda nao passou pela regua nova", que e informacao por si -- um valor
-- padrao zero mentiria que a linha ja foi calculada.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS logistic_type text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS bonus_envio numeric;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS custo_entrega numeric;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS icms_debito numeric;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS pis_cofins_debito numeric;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS credito_pc_comissao numeric;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS credito_pc_frete numeric;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS difal_base numeric;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS difal_amount numeric;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS fcp_amount numeric;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS difal_fonte text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tax_versao smallint;

COMMENT ON COLUMN public.orders.bonus_envio IS
  'Valor que o ML paga ao vendedor no envio Flex (gross_amount de /shipments/{id}/costs). NULL = nao capturado ou indisponivel na API; ZERO = capturado e vale zero. As duas coisas sao diferentes (D-05, 222-CONTEXT.md) -- nunca tratar ausencia como zero.';

COMMENT ON COLUMN public.orders.custo_entrega IS
  'Custo de entrega propria (Flex) copiado de ml_tax_config.flex_custo_entrega no momento do sync. NULL significa que o dono da conta ainda nao informou o valor -- o MCO deste pedido esta declaradamente inflado enquanto isso.';

COMMENT ON COLUMN public.orders.difal_amount IS
  'DIFAL DEVIDO pela regra (base dupla, LC 190/2022), nao necessariamente recolhido. Quem recolhe de fato e configuracao por loja (D-02, ml_tax_config.difal_ufs_recolhidas) -- este campo nunca decide sozinho se o DIFAL entra no MCO exibido.';

COMMENT ON COLUMN public.orders.difal_fonte IS
  'Procedencia do DIFAL deste pedido (D-07): "cobrado_ml" quando ha lancamento CDIFAL correspondente na fatura (fato, mesma logica da Fase 210 com ads), "calculado" quando vem da regua (previsao), "nao_conciliado" quando ha CDIFAL na fatura sem pedido interestadual correspondente, ou NULL quando nao ha DIFAL a atribuir. O cobrado e o calculado NUNCA somam no mesmo pedido -- seria contagem dupla.';

COMMENT ON COLUMN public.orders.tax_versao IS
  'Regua fiscal que gravou esta linha: NULL ou 1 = regua anterior a Fase 222 (aliquota unica, sem credito de PIS/COFINS); 2 = regua desta fase (componentes + creditos + DIFAL). Marcador que mede o avanco do backfill e impede somar as duas reguas como se fossem a mesma coisa.';

COMMENT ON COLUMN public.orders.tax_amount IS
  'Soma dos componentes fiscais SEM DIFAL (ICMS debito + PIS/COFINS debito - creditos de comissao e frete). O cenario COM DIFAL e composto por CIMA deste valor (tax_amount + difal_amount + fcp_amount), nunca por subtracao -- Pitfall 3 do 222-RESEARCH.md.';

-- Índice parcial para a view de saude do 222-05 nao varrer orders inteira ao
-- medir cobertura de Flex por organizacao.
CREATE INDEX IF NOT EXISTS idx_orders_org_logistic_type
  ON public.orders (organization_id, logistic_type)
  WHERE logistic_type IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────
-- BLOCO 2 — a funcao
-- ────────────────────────────────────────────────────────────────────────
-- Corpo base = versao viva (migration 20260715231735, Trava C) mais os dois
-- ajustes ja aplicados por cima dela por substituicao cirurgica
-- (20260806210000 preserva frete/estado/cidade; 20260806233000 preserva
-- tax_rate/tax_amount). Nenhum desses nove COALESCE historicos muda: frete,
-- estado, cidade, custo_unit, custo_unit_cheio, tax_rate, tax_amount,
-- receita_bruta, receita_liquida. A chave de conflito
-- (ml_order_id, ml_user_id, item_id, variation_id) nao muda.
--
-- Regra de preserve decidida por campo, nao por reflexo:
--   - logistic_type, bonus_envio, custo_entrega recebem COALESCE contra a
--     coluna atual: os tres vem de chamada de rede que pode falhar (a
--     mesma chamada ao envio, ou a chamada extra de /costs), e falha
--     passageira nao pode apagar dado bom -- e a licao da Fase 219
--     (frete/estado/cidade), reaplicada aqui aos campos novos que tambem
--     dependem de rede.
--   - os nove campos fiscais restantes (icms_debito, pis_cofins_debito,
--     credito_pc_comissao, credito_pc_frete, difal_base, difal_amount,
--     fcp_amount, difal_fonte, tax_versao) recebem atribuicao DIRETA: sao
--     derivados deterministicos do que ja esta na linha (nao dependem de
--     rede), e COALESCE aqui congelaria o valor da regua antiga para
--     sempre -- exatamente o que o backfill do 222-05 precisa poder
--     sobrescrever.
--   - conversao de entrada no molde de custo_unit: NULLIF do texto antes
--     do cast numerico, para string vazia nao virar erro.

CREATE OR REPLACE FUNCTION public.batch_upsert_orders(p_records jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count INTEGER := 0;
BEGIN
  INSERT INTO public.orders (
    ml_order_id, ml_user_id, item_id, variation_id, seller_id,
    user_id, organization_id, sku, titulo, listing_type,
    quantidade, preco_unit, comissao, frete, status,
    data_pedido, data_pagamento, estado, cidade, comprador,
    synced_at, custo_unit, custo_unit_cheio, tax_rate, tax_amount,
    uf_origem, receita_bruta, receita_liquida, marca,
    logistic_type, bonus_envio, custo_entrega,
    icms_debito, pis_cofins_debito, credito_pc_comissao, credito_pc_frete,
    difal_base, difal_amount, fcp_amount, difal_fonte, tax_versao
  )
  SELECT
    (r->>'ml_order_id'),
    (r->>'ml_user_id'),
    (r->>'item_id'),
    (r->>'variation_id'),
    NULLIF(r->>'seller_id', '')::uuid,
    NULLIF(r->>'user_id', '')::uuid,
    NULLIF(r->>'organization_id', '')::uuid,
    (r->>'sku'),
    (r->>'titulo'),
    (r->>'listing_type'),
    (r->>'quantidade')::integer,
    (r->>'preco_unit')::numeric,
    (r->>'comissao')::numeric,
    (r->>'frete')::numeric,
    (r->>'status'),
    (r->>'data_pedido')::timestamptz,
    (r->>'data_pagamento')::timestamptz,
    (r->>'estado'),
    (r->>'cidade'),
    (r->>'comprador'),
    (r->>'synced_at')::timestamptz,
    NULLIF(r->>'custo_unit', '')::numeric,
    NULLIF(r->>'custo_unit_cheio', '')::numeric,
    NULLIF(r->>'tax_rate', '')::numeric,
    NULLIF(r->>'tax_amount', '')::numeric,
    (r->>'uf_origem'),
    NULLIF(r->>'receita_bruta', '')::numeric,
    NULLIF(r->>'receita_liquida', '')::numeric,
    (r->>'marca'),
    (r->>'logistic_type'),
    NULLIF(r->>'bonus_envio', '')::numeric,
    NULLIF(r->>'custo_entrega', '')::numeric,
    NULLIF(r->>'icms_debito', '')::numeric,
    NULLIF(r->>'pis_cofins_debito', '')::numeric,
    NULLIF(r->>'credito_pc_comissao', '')::numeric,
    NULLIF(r->>'credito_pc_frete', '')::numeric,
    NULLIF(r->>'difal_base', '')::numeric,
    NULLIF(r->>'difal_amount', '')::numeric,
    NULLIF(r->>'fcp_amount', '')::numeric,
    (r->>'difal_fonte'),
    NULLIF(r->>'tax_versao', '')::smallint
  FROM jsonb_array_elements(p_records) AS r
  ON CONFLICT (ml_order_id, ml_user_id, item_id, variation_id)
  DO UPDATE SET
    seller_id           = EXCLUDED.seller_id,
    user_id             = EXCLUDED.user_id,
    organization_id     = EXCLUDED.organization_id,
    sku                 = EXCLUDED.sku,
    titulo              = EXCLUDED.titulo,
    listing_type        = EXCLUDED.listing_type,
    quantidade          = EXCLUDED.quantidade,
    preco_unit          = EXCLUDED.preco_unit,
    comissao            = EXCLUDED.comissao,
    frete               = COALESCE(EXCLUDED.frete, orders.frete),
    status              = EXCLUDED.status,
    data_pedido         = EXCLUDED.data_pedido,
    data_pagamento      = EXCLUDED.data_pagamento,
    estado              = COALESCE(EXCLUDED.estado, orders.estado),
    cidade              = COALESCE(EXCLUDED.cidade, orders.cidade),
    comprador           = EXCLUDED.comprador,
    synced_at           = EXCLUDED.synced_at,
    custo_unit          = COALESCE(EXCLUDED.custo_unit, orders.custo_unit),
    custo_unit_cheio    = COALESCE(EXCLUDED.custo_unit_cheio, orders.custo_unit_cheio),
    tax_rate            = COALESCE(EXCLUDED.tax_rate, orders.tax_rate),
    tax_amount          = COALESCE(EXCLUDED.tax_amount, orders.tax_amount),
    uf_origem           = EXCLUDED.uf_origem,
    receita_bruta       = COALESCE(EXCLUDED.receita_bruta, orders.receita_bruta),
    receita_liquida     = COALESCE(EXCLUDED.receita_liquida, orders.receita_liquida),
    marca               = EXCLUDED.marca,
    -- Flex: vem de rede (envio + chamada extra de /costs), falha passageira
    -- nao pode apagar dado bom -- mesma licao da Fase 219.
    logistic_type        = COALESCE(EXCLUDED.logistic_type, orders.logistic_type),
    bonus_envio           = COALESCE(EXCLUDED.bonus_envio, orders.bonus_envio),
    custo_entrega         = COALESCE(EXCLUDED.custo_entrega, orders.custo_entrega),
    -- Componentes fiscais: derivados deterministicos, atribuicao DIRETA --
    -- COALESCE aqui congelaria a regua antiga para sempre e impediria o
    -- backfill do 222-05 de sobrescrever.
    icms_debito           = EXCLUDED.icms_debito,
    pis_cofins_debito      = EXCLUDED.pis_cofins_debito,
    credito_pc_comissao    = EXCLUDED.credito_pc_comissao,
    credito_pc_frete       = EXCLUDED.credito_pc_frete,
    difal_base             = EXCLUDED.difal_base,
    difal_amount           = EXCLUDED.difal_amount,
    fcp_amount             = EXCLUDED.fcp_amount,
    difal_fonte            = EXCLUDED.difal_fonte,
    tax_versao             = EXCLUDED.tax_versao;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────
-- BLOCO 3 — guarda
-- ────────────────────────────────────────────────────────────────────────
-- Falha alto se qualquer uma das 12 colunas novas nao aparecer pelo menos
-- tres vezes no corpo da funcao (INSERT + SELECT + DO UPDATE SET), ou se
-- qualquer um dos nove COALESCE historicos tiver sumido. Melhor a
-- migration falhar do que aplicar meia whitelist e o campo sumir em
-- silencio -- e exatamente o que ja aconteceu uma vez, na Fase 96-07.
do $$
declare
  v_src   text;
  v_cols  text[] := array[
    'logistic_type', 'bonus_envio', 'custo_entrega',
    'icms_debito', 'pis_cofins_debito', 'credito_pc_comissao', 'credito_pc_frete',
    'difal_base', 'difal_amount', 'fcp_amount', 'difal_fonte', 'tax_versao'
  ];
  v_coalesces text[] := array[
    'COALESCE(EXCLUDED.frete, orders.frete)',
    'COALESCE(EXCLUDED.estado, orders.estado)',
    'COALESCE(EXCLUDED.cidade, orders.cidade)',
    'COALESCE(EXCLUDED.custo_unit, orders.custo_unit)',
    'COALESCE(EXCLUDED.custo_unit_cheio, orders.custo_unit_cheio)',
    'COALESCE(EXCLUDED.tax_rate, orders.tax_rate)',
    'COALESCE(EXCLUDED.tax_amount, orders.tax_amount)',
    'COALESCE(EXCLUDED.receita_bruta, orders.receita_bruta)',
    'COALESCE(EXCLUDED.receita_liquida, orders.receita_liquida)'
  ];
  v_col  text;
  v_coal text;
  v_ocorrencias int;
begin
  select prosrc into v_src from pg_proc
   where proname = 'batch_upsert_orders'
     and pronamespace = 'public'::regnamespace;
  if v_src is null then
    RAISE EXCEPTION 'batch_upsert_orders nao encontrada apos CREATE OR REPLACE';
  end if;

  foreach v_col in array v_cols loop
    v_ocorrencias := (length(v_src) - length(replace(v_src, v_col, ''))) / length(v_col);
    if v_ocorrencias < 3 then
      RAISE EXCEPTION 'coluna % aparece % vez(es) no corpo da funcao, esperava pelo menos 3 -- whitelist incompleta', v_col, v_ocorrencias;
    end if;
  end loop;

  foreach v_coal in array v_coalesces loop
    if position(v_coal in v_src) = 0 then
      RAISE EXCEPTION 'COALESCE historico sumiu do corpo da funcao: % -- Fase 219/220 desfeita por engano', v_coal;
    end if;
  end loop;

  RAISE NOTICE '222-04: 12 colunas novas + 9 COALESCE historicos confirmados no corpo de batch_upsert_orders';
end $$;
