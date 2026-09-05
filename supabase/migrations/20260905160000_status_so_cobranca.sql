-- 240-03 — `so_cobranca`: o ML respondeu COM cobranca, sem `sale_fee` completo
--
-- 🔴 POR QUE UM STATUS NOVO, e nao afrouxar a CHECK existente.
--
-- A 240-01 fez o pedido cujo `details` traz SO tarifa de envio entrar no mapa
-- de `lerPedidos` — provado ao vivo: `2000017653416208` volta com
-- `sale_fee: null` e uma linha CFFE de R$ 23,65, que bate ao centavo com o
-- retido no Mercado Pago. Sao anuncios sem comissao de venda.
--
-- Chama-lo de `ok` seria mentira nas DUAS direcoes:
--   · `ok` PROMETE que da para afirmar rebate — e a CHECK
--     `ml_order_sale_fee_captura_ok_tem_sale_fee` exige os tres campos de
--     `sale_fee` justamente para que a promessa nao seja vazia;
--   · `sem_linha` NEGA cobranca que existe, e era o rotulo que fazia a tela
--     dizer "o ML respondeu sem cobranca" sobre cobranca que o ML fez.
--
-- Afrouxar a CHECK para admitir `ok` sem `sale_fee` resolveria o INSERT e
-- destruiria a garantia: `ok` deixaria de significar qualquer coisa. O estado
-- e um TERCEIRO e ganha nome proprio — mesmo contrato da fase 239.
--
-- ⚠️ A CHECK do `ok` fica INTOCADA. `so_cobranca` nao promete rebate, entao
-- nao precisa de `sale_fee`; e `parcial` continua proibido de gravar rebate.

alter table public.ml_order_sale_fee_captura
  drop constraint if exists ml_order_sale_fee_captura_status_valido;

alter table public.ml_order_sale_fee_captura
  add constraint ml_order_sale_fee_captura_status_valido
  check (status = any (array['ok','parcial','sem_linha','erro','so_cobranca']));

-- 🔴 `so_cobranca` NAO promete rebate, e a CHECK escreve isso: sem `sale_fee`
-- completo ninguem pode afirmar rebate a partir deste estado. Sem ela, um
-- codigo futuro poderia gravar `sale_fee_rebate` num `so_cobranca` e a leitura
-- de baixo acreditaria.
alter table public.ml_order_sale_fee_captura
  drop constraint if exists ml_order_sale_fee_captura_so_cobranca_sem_rebate;

alter table public.ml_order_sale_fee_captura
  add constraint ml_order_sale_fee_captura_so_cobranca_sem_rebate
  check (status <> 'so_cobranca' or sale_fee_rebate is null);

comment on column public.ml_order_sale_fee_captura.status is
  'ok = ML respondeu com sale_fee completo (autoriza afirmar rebate) · so_cobranca = ML respondeu '
  'com linha(s) de cobranca mas sem sale_fee completo, tipicamente anuncio sem comissao de venda '
  'em que so ha tarifa de envio (240-03) · parcial = HTTP 206, nunca grava valor · sem_linha = o ML '
  'respondeu e nao ha NADA a cobrar · erro = reagenda';
