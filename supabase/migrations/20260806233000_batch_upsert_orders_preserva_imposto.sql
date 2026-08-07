-- Imposto para de ser regravado com a alíquota errada (Fase 220, TAX-01).
--
-- POR QUE COALESCE SOZINHO NÃO BASTARIA: o que chegava em EXCLUDED.tax_rate
-- não era `null` — era 25.585, a alíquota intraestadual, um valor ERRADO
-- aplicado a uma venda para fora de SP, não um valor ausente. COALESCE só
-- protege contra ausência. A proteção que esta migration aplica só passa a
-- ter efeito porque, na MESMA entrega, o cálculo em computeOrderTaxRate
-- (supabase/functions/_shared/orderTaxRate.ts) passou a devolver `null`
-- quando o destino do pedido é desconhecido — antes disso, EXCLUDED.tax_rate
-- nunca chegava `null`, e este COALESCE nunca teria disparado.
--
-- MEDIDO em 06/08/2026: 39 dos 45 pedidos do dia, todos com `estado` correto
-- no banco (MG, RJ, PR, SC, TO, RO, PE, ES), gravados com a alíquota de SP.
-- Imposto do dia: R$ 3.715,50 gravado contra R$ 2.861,02 correto — e o número
-- piorava sozinho a cada rodada do cron (duas medições com 57s de diferença,
-- sem venda nova, deram R$ 3.644,17 e depois R$ 3.715,50).
--
-- CAUSA: o sync incremental (Fase 219) pula a busca de envio de pedido que
-- já tem frete+estado no banco (`jaCompletos`). Pedido pulado não entra no
-- `shipmentMap` → `estado` vira `null` em `expandOrder` →
-- `computeOrderTaxRate(cfg, null)` devolvia a alíquota intraestadual (a MAIS
-- ALTA das três) em vez de sinalizar ausência.
--
-- Mesmo molde da migration 20260806210000 (frete/estado/cidade): substituição
-- cirúrgica sobre `prosrc`, CREATE OR REPLACE (NUNCA DROP, que apagaria a ACL
-- de service_role), com guarda que falha alto se as substituições não
-- casarem — melhor não aplicar nada do que aplicar pela metade. A guarda
-- também torna a migration idempotente: rodar duas vezes não casa nada na
-- segunda vez e passa pela verificação do mesmo jeito.
--
-- Não toca `marca` (D-220-03, fora de escopo) nem nenhuma outra coluna.
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
  -- regexp_replace em vez de replace literal: tolera espacamento diferente
  -- entre o nome da coluna e o sinal de igual.
  v_new := regexp_replace(
    v_new,
    'tax_rate\s*=\s*EXCLUDED\.tax_rate,',
    'tax_rate        = COALESCE(EXCLUDED.tax_rate, orders.tax_rate),'
  );
  v_new := regexp_replace(
    v_new,
    'tax_amount\s*=\s*EXCLUDED\.tax_amount,',
    'tax_amount      = COALESCE(EXCLUDED.tax_amount, orders.tax_amount),'
  );

  -- Falha alto se as duas substituicoes nao casarem, ou se ainda sobrar
  -- alguma atribuicao direta: melhor nao aplicar nada do que aplicar pela
  -- metade e achar que consertou.
  select (v_new like '%COALESCE(EXCLUDED.tax_rate, orders.tax_rate)%')::int
       + (v_new like '%COALESCE(EXCLUDED.tax_amount, orders.tax_amount)%')::int
    into v_trocas;
  if v_trocas <> 2 then
    raise exception 'esperava 2 substituicoes, consegui %; corpo da funcao mudou — revisar a mao', v_trocas;
  end if;
  if v_new like '%tax_rate        = EXCLUDED.tax_rate,%'
     or v_new like '%tax_amount      = EXCLUDED.tax_amount,%' then
    raise exception 'sobrou atribuicao direta de tax_rate/tax_amount apos a substituicao — revisar a mao';
  end if;

  execute format(
    'CREATE OR REPLACE FUNCTION public.batch_upsert_orders(p_records jsonb) '
    'RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS %L',
    v_new);
end $$;
