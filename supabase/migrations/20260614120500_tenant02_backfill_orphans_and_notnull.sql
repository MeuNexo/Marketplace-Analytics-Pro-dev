-- TENANT-02: Resolver linhas órfãs (organization_id NULL) em tabelas de cache e config.
--
-- Estratégia híbrida (D-01/D-02/D-03) — REVISADA contra o schema real do banco
-- (auditoria via MCP no projeto ckcdevcxgvueywivefgx, 2026-06-14):
--
--   Estado real de órfãos confirmado antes desta migration:
--     ml_product_costs : 604 órfãos de 604 (100% — único backfill que importa)
--     ml_tax_config, sellers, seller_stores, ml_tokens : 0 órfãos
--     todos os caches (ml_daily_cache, ml_*_cache, ml_sync_log) : 0 órfãos
--
--   Schema real (colunas) — correções aplicadas após a auditoria:
--     ml_targets      : NÃO tem organization_id NEM ml_user_id → bloco REMOVIDO (quebraria no parse)
--     sellers         : tem organization_id, NÃO tem ml_user_id → UPDATE por ml_user_id REMOVIDO (0 órfãos)
--     seller_stores   : tem organization_id, NÃO tem ml_user_id/user_id → UPDATE REMOVIDO (0 órfãos)
--     ml_product_costs: tem user_id (auth.uid), NÃO tem ml_user_id → backfill via user_id→org
--     ml_tax_config   : tem ml_user_id → backfill via ml_tokens (mantido; no-op hoje)
--
--   BACKFILL ml_product_costs (D-02): há 2 orgs (Pé Vermeio, Thales). O token ML global
--     mais recente NÃO é fonte confiável (poderia atribuir custos da Pé Vermeio à Thales).
--     Os 604 custos têm 1 só user_id (ce8c797c…), que é owner APENAS da Pé Vermeio.
--     Logo a org correta é derivada de organization_members do user_id da própria linha —
--     determinístico (prefere owner) e seguro mesmo em cenário multi-org futuro.
--     (Exceção justificada a "via ml_tokens": ml_product_costs não tem ml_user_id; o vínculo
--      confiável custo→org é user_id→org. user tem 1 org → sem risco de duplicação que D-02 evita.)
--   DELETE caches regeneráveis: 0 órfãos hoje → no-op idempotente (mantido como guard de futuro).
--
-- Idempotência: UPDATE/DELETE com WHERE organization_id IS NULL são no-op se 0 órfãos.
--   SET NOT NULL só após guard DO block com RAISE EXCEPTION se ainda houver NULLs.

-- ─── 1. BACKFILL: ml_product_costs via user_id → organization_members ─────────
-- Determinístico: para cada linha órfã, a org do dono (preferindo papel owner).
UPDATE public.ml_product_costs c
SET organization_id = (
  SELECT om.organization_id
  FROM public.organization_members om
  WHERE om.user_id = c.user_id
  ORDER BY (om.role = 'owner') DESC, om.organization_id
  LIMIT 1
)
WHERE c.organization_id IS NULL
  AND EXISTS (
    SELECT 1 FROM public.organization_members om WHERE om.user_id = c.user_id
  );

-- ml_tax_config: backfill via ml_user_id → ml_tokens (0 órfãos hoje; no-op idempotente)
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

-- ml_tokens: auto-referência por ml_user_id (0 órfãos hoje; no-op idempotente)
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

-- NOTA: sellers, seller_stores e ml_targets NÃO recebem UPDATE de backfill —
--   sellers/seller_stores não têm ml_user_id (e têm 0 órfãos); ml_targets não tem
--   organization_id (fora do modelo org-scoped desta fase).

-- ─── 2. DELETE: caches regeneráveis (0 órfãos hoje — no-op idempotente) ───────
-- Linha com organization_id NULL em cache não tem dono identificável;
-- o próximo ciclo de sync as recria com organization_id preenchido.

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
-- Aborta com RAISE EXCEPTION se ainda houver NULLs antes do ALTER — falha visível
-- em vez de aplicar NOT NULL com dados inconsistentes.

DO $$
DECLARE
  v_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.ml_product_costs WHERE organization_id IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'TENANT-02: ml_product_costs ainda tem % linha(s) com organization_id NULL. Backfill incompleto — corrigir antes de aplicar NOT NULL.', v_count;
  END IF;
  EXECUTE 'ALTER TABLE public.ml_product_costs ALTER COLUMN organization_id SET NOT NULL';

  SELECT COUNT(*) INTO v_count FROM public.ml_tax_config WHERE organization_id IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'TENANT-02: ml_tax_config ainda tem % linha(s) com organization_id NULL. Backfill incompleto.', v_count;
  END IF;
  EXECUTE 'ALTER TABLE public.ml_tax_config ALTER COLUMN organization_id SET NOT NULL';

  SELECT COUNT(*) INTO v_count FROM public.sellers WHERE organization_id IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'TENANT-02: sellers ainda tem % linha(s) com organization_id NULL.', v_count;
  END IF;
  EXECUTE 'ALTER TABLE public.sellers ALTER COLUMN organization_id SET NOT NULL';

  SELECT COUNT(*) INTO v_count FROM public.seller_stores WHERE organization_id IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'TENANT-02: seller_stores ainda tem % linha(s) com organization_id NULL.', v_count;
  END IF;
  EXECUTE 'ALTER TABLE public.seller_stores ALTER COLUMN organization_id SET NOT NULL';

  -- Caches: DELETE acima deve ter zerado. Guard de confirmação.
  SELECT COUNT(*) INTO v_count FROM public.ml_daily_cache WHERE organization_id IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'TENANT-02: ml_daily_cache ainda tem % linha(s) NULL após DELETE.', v_count;
  END IF;
  SELECT COUNT(*) INTO v_count FROM public.ml_hourly_cache WHERE organization_id IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'TENANT-02: ml_hourly_cache ainda tem % linha(s) NULL após DELETE.', v_count;
  END IF;

  RAISE NOTICE 'TENANT-02: Backfill e DELETE concluídos. Todos os guards passaram.';
END $$;

-- ─── 4. SKIP: fora de escopo desta fase ──────────────────────────────────────
-- audit_log, shopee_orders, shopee_sales: sem ml_user_id linkável (A3).
-- ml_targets: não tem organization_id — não faz parte do modelo org-scoped (rever em fase futura).
-- NOTA: writers de EF que ainda gravem organization_id=NULL serão endurecidos em 43-02.
