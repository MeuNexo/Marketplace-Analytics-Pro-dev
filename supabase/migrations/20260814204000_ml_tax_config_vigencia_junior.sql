-- As duas vigências da loja 2359559427 (Fase 222, plano 222-05-R, FISC-05).
--
-- ⚠️ MOMENTO DE APLICAÇÃO — LEIA ANTES DE APLICAR: **por último**, e só depois
-- de as duas edge functions (`sync-ml-orders` e `recalc-order-costs`) estarem
-- DEPLOYADAS. Esta é a migration que faz existir a segunda linha. Com duas
-- linhas e o código antigo no ar, a leitura de linha única do sync devolve
-- erro, o erro é ignorado e o imposto da loja inteira sai ausente — em
-- silêncio, que é a pior forma de sair.
--
-- ORIGEM DOS NÚMEROS: Wesley, 14/08/2026. A loja é Simples Nacional e a
-- alíquota efetiva mudou de 6% para 4% na virada de junho para julho. A config
-- foi alterada no sistema em 11/08 e, sem vigência, regravou retroativamente
-- 352 pedidos de 01 a 10/08 com 4%. Julho já havia sido corrigido por UPDATE
-- manual, com snapshot em `public.orders_pre_tax_junior_jul` — os dois são
-- PRESERVADOS por este plano.
--
-- NENHUMA SEED PARA PÉ VERMEIO NEM PARA THALES: quem não mudou de alíquota tem
-- uma vigência só, aberta desde sempre — que é exatamente o que a migration
-- `20260814201000` já deixou. Semear vigência para elas inventaria uma
-- fronteira que não existe.
--
-- A ORGANIZAÇÃO É DERIVADA DA PRÓPRIA LINHA, nunca digitada: digitar UUID em
-- migration é como o identificador errado entra em produção.

-- ─── Guarda de ENTRADA: recusa aplicar sobre um estado diferente do medido ──
DO $$
DECLARE
  v_linhas   integer;
  v_regime   text;
  v_aliquota numeric;
BEGIN
  SELECT count(*) INTO v_linhas
    FROM public.ml_tax_config WHERE ml_user_id = '2359559427';

  IF v_linhas <> 1 THEN
    RAISE EXCEPTION 'esperava exatamente 1 linha de ml_tax_config para a loja 2359559427, encontrei % — o estado do banco mudou desde a medição de 14/08/2026; conferir antes de seguir', v_linhas;
  END IF;

  SELECT regime::text, sn_aliquota_efetiva
    INTO v_regime, v_aliquota
    FROM public.ml_tax_config WHERE ml_user_id = '2359559427';

  IF v_regime <> 'simples_nacional' THEN
    RAISE EXCEPTION 'loja 2359559427 deveria estar em simples_nacional (foi assim que o Wesley confirmou em 14/08), está em %', v_regime;
  END IF;

  IF v_aliquota IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'a alíquota corrente da loja 2359559427 deveria ser 4%% (a que passou a valer em 01/07/2026), encontrei % — não semear vigência sobre estado divergente', v_aliquota;
  END IF;
END $$;

-- ─── A vigência corrente passa a começar em 01/07/2026 ──────────────────────
-- A linha que está no banco é a de 4%: ela deixa de valer "desde sempre" e
-- passa a valer a partir da virada de junho para julho.
UPDATE public.ml_tax_config
   SET vigencia_inicio = DATE '2026-07-01'
 WHERE ml_user_id = '2359559427'
   AND vigencia_fim IS NULL;

-- ─── A vigência histórica de 6%, encerrada em 30/06/2026 ────────────────────
-- Todos os demais campos são copiados da linha corrente: o que mudou de junho
-- para julho foi a alíquota, nada mais. Copiar em vez de redigitar evita
-- inventar diferença onde não houve.
INSERT INTO public.ml_tax_config (
  organization_id, ml_user_id, regime,
  sn_aliquota_efetiva,
  lp_pis, lp_cofins, lp_irpj, lp_csll,
  lr_pis_debito, lr_pis_credito, lr_cofins_debito, lr_cofins_credito,
  lr_icms_debito, lr_icms_credito,
  difal_ufs_recolhidas, difal_ufs_cobradas_pelo_ml, flex_custo_entrega,
  vigencia_inicio, vigencia_fim
)
SELECT
  c.organization_id, c.ml_user_id, c.regime,
  6,
  c.lp_pis, c.lp_cofins, c.lp_irpj, c.lp_csll,
  c.lr_pis_debito, c.lr_pis_credito, c.lr_cofins_debito, c.lr_cofins_credito,
  c.lr_icms_debito, c.lr_icms_credito,
  c.difal_ufs_recolhidas, c.difal_ufs_cobradas_pelo_ml, c.flex_custo_entrega,
  DATE '2020-01-01', DATE '2026-06-30'
FROM public.ml_tax_config c
WHERE c.ml_user_id = '2359559427'
  AND c.vigencia_fim IS NULL;

-- ─── Guarda de SAÍDA ────────────────────────────────────────────────────────
DO $$
DECLARE
  v_linhas    integer;
  v_abertas   integer;
  v_aliq_jun  numeric;
  v_aliq_jul  numeric;
BEGIN
  SELECT count(*) INTO v_linhas
    FROM public.ml_tax_config WHERE ml_user_id = '2359559427';
  IF v_linhas <> 2 THEN
    RAISE EXCEPTION 'esperava 2 vigências para a loja 2359559427 ao fim desta migration, encontrei %', v_linhas;
  END IF;

  SELECT count(*) INTO v_abertas
    FROM public.ml_tax_config
   WHERE ml_user_id = '2359559427' AND vigencia_fim IS NULL;
  IF v_abertas <> 1 THEN
    RAISE EXCEPTION 'esperava exatamente 1 vigência aberta para a loja 2359559427, encontrei %', v_abertas;
  END IF;

  -- A fronteira, medida pelos dois lados: 30/06 é 6% e 01/07 é 4%. É esta
  -- pergunta, feita em SQL, que a prova em produção repete depois do backfill.
  SELECT sn_aliquota_efetiva INTO v_aliq_jun
    FROM public.ml_tax_config
   WHERE ml_user_id = '2359559427'
     AND vigencia_inicio <= DATE '2026-06-30'
     AND (vigencia_fim IS NULL OR vigencia_fim >= DATE '2026-06-30');

  SELECT sn_aliquota_efetiva INTO v_aliq_jul
    FROM public.ml_tax_config
   WHERE ml_user_id = '2359559427'
     AND vigencia_inicio <= DATE '2026-07-01'
     AND (vigencia_fim IS NULL OR vigencia_fim >= DATE '2026-07-01');

  IF v_aliq_jun IS DISTINCT FROM 6 OR v_aliq_jul IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'fronteira de vigência errada na loja 2359559427: 30/06 resolveu %%%, 01/07 resolveu %%% (esperado 6%% e 4%%)', v_aliq_jun, v_aliq_jul;
  END IF;

  -- Sobreposição: nenhuma data pode ser coberta por duas linhas.
  IF EXISTS (
    SELECT 1
      FROM public.ml_tax_config a
      JOIN public.ml_tax_config b
        ON b.id <> a.id
       AND b.ml_user_id = a.ml_user_id
       AND b.organization_id = a.organization_id
       AND daterange(a.vigencia_inicio, COALESCE(a.vigencia_fim + 1, 'infinity'::date), '[)')
        && daterange(b.vigencia_inicio, COALESCE(b.vigencia_fim + 1, 'infinity'::date), '[)')
     WHERE a.ml_user_id = '2359559427'
  ) THEN
    RAISE EXCEPTION 'as duas vigências da loja 2359559427 se sobrepõem — a resolução por data ficaria ambígua e resolverConfigVigente lançaria erro em cada pedido';
  END IF;
END $$;
