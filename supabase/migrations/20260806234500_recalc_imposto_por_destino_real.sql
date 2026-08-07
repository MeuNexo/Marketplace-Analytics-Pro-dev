-- Recálculo retroativo do imposto gravado com a alíquota errada (Fase 220, TAX-02).
--
-- POR QUE ESTA MIGRATION EXISTE: o TAX-01 (migration 20260806233000 + deploy
-- de sync-ml-orders/recalc-order-costs) fechou a torneira — o cron parou de
-- regravar o imposto errado. Mas os pedidos que já foram corrompidos ANTES do
-- conserto continuam corrompidos: o COALESCE protege dado bom contra
-- sobrescrita futura, não desfaz o passado.
--
-- MEDIDO em 06/08/2026, varrendo 01/05 até hoje: 6 dias isolados em 4 meses,
-- 187 pedidos, R$ 4.332,88 de imposto que não existe — 01/06 (R$ 789,52),
-- 06/06 (R$ 587,21), 13/06 (R$ 223,88), 04/08 (R$ 847,75), 05/08
-- (R$ 1.030,04) e 06/08 (R$ 854,48). Todos os outros dias dos quatro meses
-- estão em zero. Em todas essas linhas a coluna `estado` está CERTA (MG é
-- MG) — só os campos derivados dela (tax_rate, tax_amount, receita_liquida)
-- ficaram errados. O banco está internamente incoerente consigo mesmo, o que
-- é exatamente o que torna a correção possível sem consultar o ML de novo.
--
-- POR QUE A SELEÇÃO É POR RÉGUA, NUNCA POR LISTA DE DATAS: a lista de dias
-- afetados muda a cada rodada do cron enquanto o bug estava vivo, e o
-- próprio ato de investigar já mexeu nela (uma invocação de sync-ml-orders
-- em 06/08 para provar o SYNC-01 da Fase 219 piorou aquele dia sem causar o
-- bug). O critério aqui é comparar a `tax_rate` GRAVADA com a alíquota que o
-- `estado` daquela linha DEVERIA produzir, com as alíquotas vindas de
-- `ml_tax_config` — nunca escritas à mão neste SQL.
--
-- ⚠️ orders.data_pedido é TEXT guardando timestamp: comparação de igualdade
-- com uma data devolve zero linhas. A janela usa comparação lexicográfica de
-- prefixo ISO (`>= '2026-05-01'`), que funciona porque o formato é sempre
-- 'YYYY-MM-DD...'. Ver [[feedback_garment_orders_date_perf]].
--
-- PRECEDENTE (e o que este UPDATE NÃO repete): a migration 20260521300000
-- (21/05) já fez um recálculo em massa com a MESMA fórmula, mas tinha dois
-- defeitos que esta migration existe para não repetir: (1) o CASE dela
-- colapsava "destino desconhecido" (estado IS NULL) com "destino é a UF de
-- origem" no mesmo ramo — o mesmo bug que o TAX-01 corrigiu no TypeScript,
-- reproduzido em SQL; e (2) não tinha filtro de data nenhum, tocando TODOS
-- os pedidos de toda a história de uma vez. Aqui: (1) o CASE só entra no
-- laço para org/ml_user_id com uf_origem preenchida — sem origem não dá para
-- separar intra de interestadual, então a linha é pulada com aviso, nunca
-- chutada; e (2) a janela é escopada a partir de 2026-05-01.
--
-- ESCOPO: só `regime = 'lucro_real'` — é o filtro que torna a conta Junior
-- (`simples_nacional`) estruturalmente inalcançável por este UPDATE, não uma
-- promessa. Nenhuma coluna fora de tax_rate/tax_amount/receita_liquida é
-- tocada: marca (D-220-03), frete, estado, cidade e custo_unit ficam
-- intocados.
--
-- IDEMPOTÊNCIA: a régua de seleção (`abs(tax_rate - tax_rate_novo) > 0.001`)
-- deixa de casar depois que a linha é corrigida — rodar esta migration duas
-- vezes não altera nenhuma linha na segunda vez.
do $$
declare
  cfg record;
  v_janela      constant text    := '2026-05-01';
  v_tolerancia  constant numeric := 0.001;
  v_trocas      bigint;
  v_total       bigint := 0;
begin
  for cfg in
    select * from public.ml_tax_config where regime = 'lucro_real'
  loop
    if cfg.uf_origem is null or trim(cfg.uf_origem) = '' then
      raise notice 'org % / ml_user_id % pulada: uf_origem ausente na config — sem origem nao da para separar intra de interestadual, e chutar repetiria o erro que esta fase conserta',
        cfg.organization_id, cfg.ml_user_id;
      continue;
    end if;

    with candidato as (
      select
        o.ml_order_id, o.ml_user_id, o.item_id, o.variation_id, o.organization_id,
        o.tax_rate, o.tax_amount, o.receita_liquida, o.receita_bruta,
        o.preco_unit, o.quantidade, o.comissao, o.frete,
        -- Alíquota de ICMS esperada, pela mesma ordem de ramos do módulo
        -- TypeScript (_shared/orderTaxRate.ts): destino == origem -> intra;
        -- destino ES ou N/NE/CO -> reduzida; senao -> Sul/Sudeste.
        (case
           when upper(trim(o.estado)) = upper(trim(cfg.uf_origem))
             then coalesce(cfg.lr_icms_aliquota_intra, cfg.lr_icms_debito, 0)
           when upper(trim(o.estado)) = 'ES'
                or upper(trim(o.estado)) in (
                     'AC','AP','AM','PA','RO','RR','TO',
                     'AL','BA','CE','MA','PB','PE','PI','RN','SE',
                     'DF','GO','MT','MS'
                   )
             then coalesce(cfg.lr_icms_aliquota_inter_norte_nordeste, 7)
           else coalesce(cfg.lr_icms_aliquota_inter_sul_sudeste, 12)
         end) as icms_esperado
      from public.orders o
      where o.organization_id = cfg.organization_id
        and o.ml_user_id      = cfg.ml_user_id
        and o.estado is not null and trim(o.estado) <> ''
        and o.tax_rate is not null
        and o.preco_unit is not null
        and o.data_pedido >= v_janela
    ),
    calculado as (
      select
        c.*,
        -- ICMS + (1 - ICMS%) * (PIS 1,65% + COFINS 7,60%) = ICMS + (1-ICMS%)*9.25
        round((c.icms_esperado + (1 - c.icms_esperado / 100.0) * 9.25)::numeric, 6) as tax_rate_novo
      from candidato c
    ),
    divergente as (
      select
        k.*,
        round((k.preco_unit * k.quantidade * k.tax_rate_novo / 100.0)::numeric, 6) as tax_amount_novo
      from calculado k
      where abs(k.tax_rate - k.tax_rate_novo) > v_tolerancia
    )
    update public.orders o
       set tax_rate        = d.tax_rate_novo,
           tax_amount      = d.tax_amount_novo,
           -- receita_liquida coerente com o tax_amount novo: mesma fórmula
           -- da ingestão (receita_bruta, com recuo para preco_unit*qtd,
           -- menos comissão, menos frete, menos o imposto novo).
           receita_liquida = coalesce(d.receita_bruta, d.preco_unit * d.quantidade)
                              - coalesce(d.comissao, 0)
                              - coalesce(d.frete, 0)
                              - d.tax_amount_novo
      from divergente d
     where o.ml_order_id   = d.ml_order_id
       and o.ml_user_id    = d.ml_user_id
       and o.item_id       = d.item_id
       and o.variation_id  = d.variation_id;

    get diagnostics v_trocas = row_count;
    v_total := v_total + v_trocas;
    raise notice 'org % / ml_user_id %: % linhas corrigidas (janela >= %)',
      cfg.organization_id, cfg.ml_user_id, v_trocas, v_janela;
  end loop;

  raise notice 'TAX-02: total de linhas corrigidas em todas as orgs lucro_real: %', v_total;
end $$;
