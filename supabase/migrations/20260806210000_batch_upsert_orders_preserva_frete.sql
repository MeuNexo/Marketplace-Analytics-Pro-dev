-- Frete/estado/cidade param de ser apagados por rodada que falha (06/08/2026).
--
-- O QUE ACONTECIA: `batch_upsert_orders` protegia o custo com COALESCE
--   custo_unit = COALESCE(EXCLUDED.custo_unit, orders.custo_unit)
-- mas gravava frete/estado/cidade direto:
--   frete = EXCLUDED.frete
-- Quando a busca do detalhe de envio (/shipments/{id}) falhava — e ela falha em
-- silencio, num Promise.allSettled sem retry e sem log —, o sync gravava NULL
-- POR CIMA do frete que ja estava correto. Falha passageira virava perda
-- permanente de dado.
--
-- MEDIDO: a Pe Vermeio tinha 0% de pedidos sem frete ate 02/08; em 03/08 foi a
-- 100% (44 de 44) e em 05/08 a 70% (43 de 61). Conferido contra o relatorio de
-- vendas do Tiny do dia 05/08: onde os dois lados tinham frete, a diferenca era
-- R$ 0,00 — ou seja, nao era regua diferente, era dado apagado. Faltavam
-- R$ 1.698,25 so naquele dia, custo que o MCO deixava de descontar.
--
-- Depois desta migration + re-sync dos dias 03 a 06/08: 0 pedidos sem frete, e
-- o MCO do dia 05/08 caiu de 19,11% (falso) para 12,39% (real).
--
-- A regra passa a ser a mesma ja aplicada ao custo: dado novo so substitui dado
-- velho quando o dado novo EXISTE. Ausencia nunca sobrescreve presenca.
--
-- Substituicao cirurgica sobre o corpo atual, com CREATE OR REPLACE (nunca
-- DROP, que apagaria a ACL service_role=X).
do $$
declare
  v_src  text;
  v_new  text;
  v_trocas int := 0;
begin
  select prosrc into v_src from pg_proc
   where proname = 'batch_upsert_orders'
     and pronamespace = 'public'::regnamespace;
  if v_src is null then
    raise exception 'batch_upsert_orders nao encontrada';
  end if;

  v_new := v_src;
  v_new := replace(v_new, 'frete           = EXCLUDED.frete,',
                          'frete           = COALESCE(EXCLUDED.frete, orders.frete),');
  v_new := replace(v_new, 'estado          = EXCLUDED.estado,',
                          'estado          = COALESCE(EXCLUDED.estado, orders.estado),');
  v_new := replace(v_new, 'cidade          = EXCLUDED.cidade,',
                          'cidade          = COALESCE(EXCLUDED.cidade, orders.cidade),');

  -- Falha alto se algum dos tres alvos nao existir: melhor nao aplicar nada do
  -- que aplicar pela metade e achar que consertou.
  select (v_new like '%COALESCE(EXCLUDED.frete, orders.frete)%')::int
       + (v_new like '%COALESCE(EXCLUDED.estado, orders.estado)%')::int
       + (v_new like '%COALESCE(EXCLUDED.cidade, orders.cidade)%')::int
    into v_trocas;
  if v_trocas <> 3 then
    raise exception 'esperava 3 substituicoes, consegui %; corpo da funcao mudou — revisar a mao', v_trocas;
  end if;

  execute format(
    'CREATE OR REPLACE FUNCTION public.batch_upsert_orders(p_records jsonb) '
    'RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS %L',
    v_new);
end $$;
