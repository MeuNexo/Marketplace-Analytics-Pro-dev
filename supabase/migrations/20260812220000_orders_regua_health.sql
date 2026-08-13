-- View de saude das duas reguas fiscais (Fase 222, plano 222-05).
--
-- Serve para medir o avanco do backfill sem ninguem ter que escrever a
-- consulta de cabeca duas vezes, e para tornar visivel a diferenca entre
-- "pedido sem DIFAL porque e intraestadual" e "pedido sem DIFAL porque a UF
-- nao foi confirmada" -- a mesma distincao que orderTaxRate.ts ja preserva
-- em difal_motivo_ausencia (nao persistido), agora visivel por consulta via
-- difal_fonte e a comparacao direta entre estado e uf_origem.
--
-- VIEW COMUM, SEM PRIVILEGIO DE DEFINIDOR: nenhuma clausula de seguranca
-- especial aqui -- a view roda com o mesmo RLS que ja protege `orders` por
-- organizacao, para nunca virar porta de leitura cruzando tenant.
--
-- Agrupada tambem por mes (data_pedido truncado): a fase mede maio->agosto
-- de 2026 por conta: filtrar `WHERE mes BETWEEN ...` sobre esta view da o
-- "total de pedidos na janela" sem precisar de uma segunda consulta.

CREATE OR REPLACE VIEW public.orders_regua_health AS
SELECT
  organization_id,
  ml_user_id,
  date_trunc('month', data_pedido)::date AS mes,

  -- Volume total do grupo (organizacao, loja, mes).
  count(*) AS total_pedidos,

  -- Regua antiga (NULL ou 1) x regua nova (Fase 222, tax_versao = 2).
  -- tax_versao NUNCA e somado com a regua nova como se fossem a mesma
  -- coisa -- e o marcador que impede exatamente esse erro.
  count(*) FILTER (WHERE tax_versao IS NULL OR tax_versao < 2) AS pedidos_regua_antiga,
  count(*) FILTER (WHERE tax_versao = 2) AS pedidos_regua_nova,
  min(data_pedido) FILTER (WHERE tax_versao IS NULL OR tax_versao < 2)
    AS pedido_mais_antigo_regua_antiga,

  -- Tipo logistico: quantos ainda nao passaram pelo backfill do Flex
  -- (FLEX-01), e quantos sao Mercado Envios Flex (self_service).
  count(*) FILTER (WHERE logistic_type IS NULL) AS pedidos_logistic_type_nulo,
  count(*) FILTER (WHERE logistic_type = 'self_service') AS pedidos_self_service,

  -- Criterio de sucesso 2 da fase, medido direto: nenhum pedido de
  -- auto-servico pode ficar com frete nulo depois do backfill (ou os que
  -- ficarem estao nomeados e contados aqui).
  count(*) FILTER (WHERE logistic_type = 'self_service' AND frete IS NULL)
    AS pedidos_self_service_frete_nulo,
  count(*) FILTER (WHERE logistic_type = 'self_service' AND bonus_envio IS NULL)
    AS pedidos_self_service_bonus_nulo,
  count(*) FILTER (WHERE logistic_type = 'self_service' AND custo_entrega IS NULL)
    AS pedidos_self_service_custo_entrega_nulo,

  -- DIFAL ausente com destino conhecido e interestadual: sinal de UF fora
  -- da tabela ou nao confirmada pelo contador (222-UF-TABELA.md) -- exclui
  -- de proposito os pedidos intraestaduais e os de destino desconhecido,
  -- que nunca deveriam ter DIFAL mesmo.
  count(*) FILTER (
    WHERE difal_amount IS NULL
      AND estado IS NOT NULL
      AND uf_origem IS NOT NULL
      AND estado <> uf_origem
  ) AS pedidos_difal_ausente_destino_interestadual,

  -- Procedencia do DIFAL (D-07): cobrado pelo ML (fato) x calculado pela
  -- regua (previsao) x cruzamento ainda nao feito para esta loja. Os tres
  -- nunca somam no mesmo pedido -- e o que difal_fonte garante por tipo.
  count(*) FILTER (WHERE difal_fonte = 'cobrado_ml') AS pedidos_difal_cobrado_ml,
  count(*) FILTER (WHERE difal_fonte = 'calculado') AS pedidos_difal_calculado,
  count(*) FILTER (WHERE difal_fonte = 'nao_conciliado') AS pedidos_difal_nao_conciliado

FROM public.orders
GROUP BY organization_id, ml_user_id, date_trunc('month', data_pedido);

COMMENT ON VIEW public.orders_regua_health IS
  'Saude do backfill fiscal da Fase 222, por organizacao/loja/mes: quanto do passado ja migrou da regua antiga (tax_versao nulo ou 1) para a nova (2), quantos pedidos de auto-servico ainda faltam tipo logistico/frete/bonus/custo de entrega, e quantos pedidos interestaduais ficam sem DIFAL por UF nao confirmada -- para nao confundir "sem DIFAL porque e intraestadual" com "sem DIFAL porque falta confirmar a UF".';

-- SELECT liberado a authenticated (herda a RLS de orders); nenhum GRANT
-- para anon -- mesma convencao das demais tabelas/views de referencia
-- desta fase (icms_uf_aliquotas, ml_difal_cobrado).
GRANT SELECT ON public.orders_regua_health TO authenticated;
REVOKE ALL ON public.orders_regua_health FROM PUBLIC;
