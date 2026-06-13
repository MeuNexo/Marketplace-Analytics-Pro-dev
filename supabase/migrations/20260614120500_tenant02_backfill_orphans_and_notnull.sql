-- TENANT-02: Resolver linhas órfãs (organization_id NULL) em tabelas de cache e config.
--
-- Estratégia híbrida (D-01/D-02/D-03):
--   BACKFILL via ml_tokens (nunca organization_members — evita duplicação se user em 2 orgs):
--     ml_product_costs, ml_tax_config, sellers, seller_stores, ml_targets, ml_tokens
--   DELETE direto (caches regeneráveis — o sync recria):
--     ml_daily_cache, ml_hourly_cache, ml_product_daily_cache, ml_state_daily_cache,
--     ml_ads_daily_cache, ml_ads_campaigns_cache, ml_ads_products_cache,
--     ml_user_cache, ml_sync_log
--   SKIP (sem ml_user_id linkável ou fora de escopo desta fase):
--     audit_log, shopee_orders, shopee_sales (anotadas como A3 / fora de escopo)
--
-- Idempotência: UPDATE com WHERE organization_id IS NULL é no-op se já há 0 órfãos.
--   DELETE com WHERE organization_id IS NULL também é no-op se 0 linhas restam.
--   SET NOT NULL só é aplicado após guard DO block com RAISE EXCEPTION se ainda há NULLs.
--
-- NOTA sobre writers: EFs/recalc que ainda gravam organization_id=NULL serão corrigidos
--   na Phase 43-02 (TENANT-02 guard nas EFs). Após essa migration, linhas novas com NULL
--   serão visíveis via RLS apenas se passarem pelo guard SET NOT NULL.

-- ─── 1. BACKFILL: tabelas config/histórico via ml_tokens ─────────────────────

-- ml_product_costs: join via user_id → ml_tokens.ml_user_id não existe diretamente.
-- ml_product_costs.user_id é auth.uid() (Supabase user), ml_tokens.organization_id é o alvo.
-- Estratégia: se existe exatamente 1 org com ml_tokens para o usuário dono da linha, backfill.
-- Critério explícito: usar o organization_id do ml_tokens mais recente para o user_id da linha.
-- Em ambiente de organização única (Pé Vermeio), isso resolve todos os órfãos sem ambiguidade.
-- Para multi-org com o mesmo user_id em 2 orgs: subquery retorna múltiplas linhas → DISTINCT
-- com ORDER BY garante determinismo; caso real de conflito deve ser tratado manualmente.
UPDATE public.ml_product_costs c
SET organization_id = (
  SELECT tok.organization_id
  FROM public.ml_tokens tok
  WHERE tok.organization_id IS NOT NULL
  ORDER BY tok.updated_at DESC
  LIMIT 1
)
WHERE c.organization_id IS NULL
  AND EXISTS (SELECT 1 FROM public.ml_tokens WHERE organization_id IS NOT NULL);

-- ml_tax_config: join via ml_user_id (armazena o ml_user_id da loja ML)
UPDATE public.ml_tax_config t
SET organization_id = tok.organization_id
FROM (
  SELECT ml_user_id, organization_id,
         ROW_NUMBER() OVER (PARTITION BY ml_user_id ORDER BY updated_at DESC) AS rn
  FROM public.ml_tokens
  WHERE organization_id IS NOT NULL
) tok
WHERE t.organization_id IS NULL
  AND t.ml_user_id = tok.ml_user_id
  AND tok.rn = 1;

-- sellers: join via ml_user_id
UPDATE public.sellers s
SET organization_id = tok.organization_id
FROM (
  SELECT ml_user_id, organization_id,
         ROW_NUMBER() OVER (PARTITION BY ml_user_id ORDER BY updated_at DESC) AS rn
  FROM public.ml_tokens
  WHERE organization_id IS NOT NULL
) tok
WHERE s.organization_id IS NULL
  AND s.ml_user_id = tok.ml_user_id
  AND tok.rn = 1;

-- seller_stores: join via ml_user_id
UPDATE public.seller_stores ss
SET organization_id = tok.organization_id
FROM (
  SELECT ml_user_id, organization_id,
         ROW_NUMBER() OVER (PARTITION BY ml_user_id ORDER BY updated_at DESC) AS rn
  FROM public.ml_tokens
  WHERE organization_id IS NOT NULL
) tok
WHERE ss.organization_id IS NULL
  AND ss.ml_user_id = tok.ml_user_id
  AND tok.rn = 1;

-- ml_targets: join via ml_user_id
UPDATE public.ml_targets mt
SET organization_id = tok.organization_id
FROM (
  SELECT ml_user_id, organization_id,
         ROW_NUMBER() OVER (PARTITION BY ml_user_id ORDER BY updated_at DESC) AS rn
  FROM public.ml_tokens
  WHERE organization_id IS NOT NULL
) tok
WHERE mt.organization_id IS NULL
  AND mt.ml_user_id = tok.ml_user_id
  AND tok.rn = 1;

-- ml_tokens: auto-referência — linhas em ml_tokens SEM organization_id mas
-- com ml_user_id que aparece em outra linha COM organization_id → backfill.
UPDATE public.ml_tokens t
SET organization_id = src.organization_id
FROM (
  SELECT ml_user_id, organization_id,
         ROW_NUMBER() OVER (PARTITION BY ml_user_id ORDER BY updated_at DESC) AS rn
  FROM public.ml_tokens
  WHERE organization_id IS NOT NULL
) src
WHERE t.organization_id IS NULL
  AND t.ml_user_id = src.ml_user_id
  AND src.rn = 1;

-- ─── 2. DELETE: caches regeneráveis ──────────────────────────────────────────
-- Linha com organization_id NULL em cache não tem dono identificável.
-- O próximo ciclo de sync as recria corretamente com organization_id preenchido.

DELETE FROM public.ml_daily_cache           WHERE organization_id IS NULL;
DELETE FROM public.ml_hourly_cache          WHERE organization_id IS NULL;
DELETE FROM public.ml_product_daily_cache   WHERE organization_id IS NULL;
DELETE FROM public.ml_state_daily_cache     WHERE organization_id IS NULL;
DELETE FROM public.ml_ads_daily_cache       WHERE organization_id IS NULL;
DELETE FROM public.ml_ads_campaigns_cache   WHERE organization_id IS NULL;
DELETE FROM public.ml_ads_products_cache    WHERE organization_id IS NULL;
DELETE FROM public.ml_user_cache            WHERE organization_id IS NULL;
DELETE FROM public.ml_sync_log              WHERE organization_id IS NULL;

-- ─── 3. SET NOT NULL: apenas onde 0 órfãos restam (guard via DO block) ───────
-- Padrão Pitfall 3: abortar com RAISE EXCEPTION se ainda houver NULLs antes de
-- tentar o ALTER. Garante que a migration falhe de forma visível em vez de
-- aplicar NOT NULL com dados inconsistentes.

DO $$
DECLARE
  v_count bigint;
BEGIN
  -- ml_product_costs: NOT NULL somente após backfill limpo
  SELECT COUNT(*) INTO v_count FROM public.ml_product_costs WHERE organization_id IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'TENANT-02: ml_product_costs ainda tem % linha(s) com organization_id NULL. Backfill incompleto — corrigir antes de aplicar NOT NULL.', v_count;
  END IF;
  EXECUTE 'ALTER TABLE public.ml_product_costs ALTER COLUMN organization_id SET NOT NULL';

  -- ml_tax_config
  SELECT COUNT(*) INTO v_count FROM public.ml_tax_config WHERE organization_id IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'TENANT-02: ml_tax_config ainda tem % linha(s) com organization_id NULL. Backfill incompleto.', v_count;
  END IF;
  EXECUTE 'ALTER TABLE public.ml_tax_config ALTER COLUMN organization_id SET NOT NULL';

  -- sellers
  SELECT COUNT(*) INTO v_count FROM public.sellers WHERE organization_id IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'TENANT-02: sellers ainda tem % linha(s) com organization_id NULL. Backfill incompleto.', v_count;
  END IF;
  EXECUTE 'ALTER TABLE public.sellers ALTER COLUMN organization_id SET NOT NULL';

  -- seller_stores
  SELECT COUNT(*) INTO v_count FROM public.seller_stores WHERE organization_id IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'TENANT-02: seller_stores ainda tem % linha(s) com organization_id NULL. Backfill incompleto.', v_count;
  END IF;
  EXECUTE 'ALTER TABLE public.seller_stores ALTER COLUMN organization_id SET NOT NULL';

  -- Tabelas de cache: DELETE acima deve ter zerado. Guard para confirmar.
  SELECT COUNT(*) INTO v_count FROM public.ml_daily_cache WHERE organization_id IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'TENANT-02: ml_daily_cache ainda tem % linha(s) com organization_id NULL após DELETE. Investigar.', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.ml_hourly_cache WHERE organization_id IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'TENANT-02: ml_hourly_cache ainda tem % linha(s) com organization_id NULL após DELETE. Investigar.', v_count;
  END IF;

  RAISE NOTICE 'TENANT-02: Backfill e DELETE concluídos. Todos os guards passaram.';
END $$;

-- ─── 4. SKIP: tabelas fora de escopo desta fase ───────────────────────────────
-- audit_log: sem ml_user_id para join; estratégia a ser definida em fase futura.
-- shopee_orders, shopee_sales: sem ml_user_id linkável a ml_tokens; fora de escopo (A3).
-- ml_targets: SET NOT NULL deferido — verificar se há linhas sem correspondência no ml_tokens.
-- NOTA: writers de EF que ainda gravam organization_id=NULL serão corrigidos em 43-02.
