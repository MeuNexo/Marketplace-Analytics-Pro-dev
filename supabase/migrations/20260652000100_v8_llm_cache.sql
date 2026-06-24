-- ============================================================
-- Phase 52 v8.0 — Cache de análise LLM (org-first): llm_analysis_cache
-- ============================================================
--
-- Cache da análise narrativa gerada por LLM (Consultor v2), 1 linha por
-- (organization_id, analysis_date, prompt_version). A EF da fase 53 grava o
-- cache; a UI lê. Evita re-chamar o LLM múltiplas vezes no mesmo dia/org.
--
-- UNIQUE org-first (SC-1, Pitfall P1): `organization_id` LIDERA a key
--   (organization_id, analysis_date, prompt_version) — anti cross-tenant leak.
--   Nunca cachear em memória module-level na EF (containers Deno quentes
--   compartilham memória entre orgs).
--
-- POR QUE `prompt_version` na key (Pitfall P2, diverge de ARCHITECTURE que usava
--   só prompt_hash): isola caches quando o system prompt da fase 53 mudar, sem
--   invalidar/colidir os caches de TODAS as orgs ao mesmo tempo. Um bump de
--   prompt_version cria uma nova linha de cache por org de forma controlada.
--   `prompt_hash` permanece como coluna de STALENESS separada (LLM-06: hash dos
--   insight IDs ativos, muda no dia) — NÃO entra na key de dedup.
--
-- RLS org-first: SELECT = is_org_member; INSERT/UPDATE só via service_role
--   (sem policy de escrita para authenticated) — a EF da fase 53 grava o cache.
--
-- Idempotência: CREATE TABLE IF NOT EXISTS, constraint UNIQUE via DO/EXCEPTION
--   duplicate_object, índice IF NOT EXISTS, DROP POLICY IF EXISTS.
--   Seguro re-aplicar via MCP apply_migration.
--
-- Supabase project: ckcdevcxgvueywivefgx (NÃO usar gionpsuunfkkzzjdubfy).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.llm_analysis_cache (
  id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  analysis_date   date        NOT NULL,
  prompt_version  text        NOT NULL DEFAULT 'v1',  -- SC-1 pede esta coluna na key
  model_used      text        NOT NULL,
  prompt_hash     text        NULL,   -- staleness check (LLM-06); NÃO entra na key de dedup
  analysis_text   text        NOT NULL,
  insight_count   int         NOT NULL DEFAULT 0,
  tokens_used     int         NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- UNIQUE org-first (SC-1, P1): organization_id é a primeira coluna da key.
-- Idempotente via DO/EXCEPTION para re-aplicação segura.
DO $$ BEGIN
  ALTER TABLE public.llm_analysis_cache
    ADD CONSTRAINT llm_cache_org_date_version
    UNIQUE (organization_id, analysis_date, prompt_version);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Índice de leitura: buscar o cache mais recente de uma org.
CREATE INDEX IF NOT EXISTS llm_cache_org_date_idx
  ON public.llm_analysis_cache (organization_id, analysis_date DESC);

ALTER TABLE public.llm_analysis_cache ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "llm_cache_select" ON public.llm_analysis_cache';
END $$;

-- SELECT: qualquer membro da org pode ler a análise cacheada.
CREATE POLICY "llm_cache_select"
  ON public.llm_analysis_cache
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- INSERT/UPDATE: service role only (a EF da fase 53 grava o cache).
-- Nenhuma policy de escrita para 'authenticated'.
