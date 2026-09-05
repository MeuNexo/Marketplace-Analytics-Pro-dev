-- ===========================================================================
-- 244-02 — a tarifa PUBLICADA de comissão, por anúncio e por preço
--
-- ── POR QUE ESTA TABELA EXISTE ────────────────────────────────────────────
--
-- A régua `repasse_a_menor` compara o Mercado Livre contra o extrato DELE
-- MESMO: `receita + ponta do comprador − o que o ML DECLAROU cobrar`. Se ele
-- declarar 16% num anúncio de 11% e pagar de acordo, o resíduo é zero, a conta
-- fecha e ninguém acusa. Só o frete tinha segunda fonte (`list_cost`).
--
-- Esta tabela é o `list_cost` da comissão: `sale_fee_amount` de
-- `GET /sites/MLB/listing_prices`, que é a tarifa PUBLICADA, não o que o ML
-- cobrou. Medido ao vivo em 05/09/2026 — 12,0% × 383,99 = 46,08, igual ao
-- `sale_fee_net` do pedido `2000017848004682` e à soma `CVVML` + `CVVPRC`.
--
-- ── 🔴 A CHAVE INCLUI O PREÇO, E ISSO NÃO É DETALHE ───────────────────────
--
--   MLB430275 @ R$ 100 -> 14,0%        MLB430275 @ R$ 150 -> 12,0%
--
-- A alíquota tem DEGRAU por faixa de preço. Uma tabela por categoria — o que a
-- intuição manda — daria esperado errado em toda venda barata, e a régua
-- acusaria o ML de cobrar a mais justamente onde ele cobrou o certo.
--
-- ── POR QUE POR ITEM, E NÃO POR CATEGORIA ─────────────────────────────────
--
-- Chavear por `item_id` tira a LEITURA da dependência do `ml_inventory_cache`.
-- Aquele cache já teve nove anúncios fantasma — fechados no ML e marcados como
-- ativos, com 94 unidades que não existiam. `category_id` e `listing_type_id`
-- ficam na linha como DIAGNÓSTICO: servem para explicar a alíquota, nunca para
-- a régua ir buscá-los em outro lugar na hora de comparar.
--
-- ── `vigente_desde`: a honestidade que o plano 239 aprendeu ────────────────
--
-- 🔴 A tarifa capturada HOJE não autoriza afirmar nada sobre uma venda de
-- março. Por isso a vigência entra na CHAVE e a linha antiga nunca é apagada:
-- é ela que torna honesta a comparação com venda antiga. Onde não houver
-- tarifa vigente na data da venda, a RPC do 244-03 emite
-- `comissao_tarifa_nao_vigente_na_venda` e NÃO acusa.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.ml_comissao_tabela (
  organization_id   uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ml_user_id        bigint      NOT NULL,
  item_id           text        NOT NULL,
  -- O preço para o qual a tarifa foi consultada. Faz parte da chave porque a
  -- alíquota tem degrau por faixa.
  preco             numeric     NOT NULL,
  -- 🔴 O que o ML PUBLICA. `percentage_fee` e `fixed_fee` ficam separados de
  -- `sale_fee_publicado` de propósito: guardar só o total impede conferir se a
  -- conta do ML fecha, e foi guardar só o total que deixou a tarifa de
  -- parcelamento invisível por meses.
  percentage_fee    numeric     NOT NULL,
  fixed_fee         numeric     NOT NULL,
  sale_fee_publicado numeric    NOT NULL,
  -- Diagnóstico: explicam a alíquota, não são chave de leitura.
  category_id       text        NULL,
  listing_type_id   text        NULL,
  vigente_desde     date        NOT NULL,
  capturado_em      timestamptz NOT NULL DEFAULT now(),
  visto_em          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, item_id, preco, vigente_desde)
);

COMMENT ON TABLE public.ml_comissao_tabela IS
  '244-02: tarifa de comissao PUBLICADA pelo ML (GET /sites/MLB/listing_prices), por anuncio e por preco. E a fonte INDEPENDENTE da regua de comissao — o equivalente ao list_cost do frete. A aliquota tem degrau por faixa de preco, por isso o preco esta na chave.';

COMMENT ON COLUMN public.ml_comissao_tabela.vigente_desde IS
  '244-02: data em que esta tarifa passou a valer para nos. Linha antiga NUNCA e apagada: e ela que permite comparar venda antiga com a tarifa que valia entao. Venda anterior a primeira captura nao pode ser acusada (D-244-05).';

-- Estado da varredura, no molde de `ml_item_frete_captura`: quem foi tentado,
-- quando, e com que desfecho. Sem isso a trava diária não existe e a carona de
-- 3 em 3 horas varreria a conta oito vezes por dia.
CREATE TABLE IF NOT EXISTS public.ml_comissao_captura (
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ml_user_id       bigint      NOT NULL,
  item_id          text        NOT NULL,
  preco            numeric     NOT NULL,
  ultima_tentativa timestamptz NOT NULL DEFAULT now(),
  ultimo_status    text        NOT NULL,
  tentativas       integer     NOT NULL DEFAULT 0,
  ultimo_erro      text        NULL,
  PRIMARY KEY (organization_id, item_id, preco)
);

ALTER TABLE public.ml_comissao_tabela  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ml_comissao_captura ENABLE ROW LEVEL SECURITY;

-- 🔴 Leitura por tenancy, no molde de `ml_item_frete_tabela`. Escrita e SO da
-- service role (a edge function) — nenhuma policy de INSERT/UPDATE para
-- `authenticated`, porque tabela de captura que o cliente escreve deixa de ser
-- fonte. A lembranca vem de `ml_tokens`, onde `anon` tinha INSERT/UPDATE/DELETE.
DROP POLICY IF EXISTS ml_comissao_tabela_select ON public.ml_comissao_tabela;
CREATE POLICY ml_comissao_tabela_select ON public.ml_comissao_tabela
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS ml_comissao_captura_select ON public.ml_comissao_captura;
CREATE POLICY ml_comissao_captura_select ON public.ml_comissao_captura
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE INDEX IF NOT EXISTS ml_comissao_tabela_item_idx
  ON public.ml_comissao_tabela (organization_id, item_id, vigente_desde DESC);
