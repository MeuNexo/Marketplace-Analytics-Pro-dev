-- ──────────────────────────────────────────────────────────────────────────────
-- RPC: ads_cache_daily_totals — Fase 211, Plano 03, Task 2 (ADS-06 / D-03, D-07)
--
-- PARA QUE SERVE: é o DENOMINADOR do rateio de publicidade por anúncio. A fatura
-- do Mercado Livre (`ml_billing_daily`) manda no TOTAL, mas não tem `item_id`;
-- quem distribui esse total por MLB é a proporção do relatório de publicidade
-- (`ml_ads_products_cache`). Para saber a fatia de um anúncio num dia é preciso
-- o gasto daquele dia somado sobre TODOS os anúncios das mesmas lojas — e isso
-- é exatamente o que esta função devolve: UMA LINHA POR DIA.
--
-- POR QUE NO BANCO: o mesmo número no navegador exigiria baixar dezenas de
-- milhares de linhas (anúncios × dias) só para somar. O PostgREST não agrega.
--
-- POR QUE NÃO EXISTE PARÂMETRO DE ORGANIZAÇÃO: a função é SECURITY INVOKER —
-- roda com o privilégio de QUEM CHAMA, então a política de RLS org-first de
-- `ml_ads_products_cache` (is_org_member, Phase 43) é a fronteira real de
-- isolamento. Aceitar um `organization_id` vindo do cliente numa função
-- SECURITY DEFINER é justamente o desenho que já produziu IDOR neste projeto —
-- está proibido aqui. Threat: T-211-24 (Information Disclosure / IDOR),
-- T-211-25 (Elevation of Privilege).
--
-- ESCOPO: esta função NÃO é usada por nenhuma tela de Publicidade e não muda
-- régua nenhuma de ROAS — aquelas seguem no cache de propósito, porque precisam
-- de impressões, cliques e recorte por campanha, que a fatura não tem.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ads_cache_daily_totals(
  p_ml_user_ids TEXT[],
  p_from        DATE,
  p_to          DATE
)
RETURNS TABLE (
  dia         DATE,
  total_spend NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    a.date                          AS dia,
    COALESCE(SUM(a.spend), 0)       AS total_spend
  FROM public.ml_ads_products_cache a
  WHERE (p_ml_user_ids IS NULL OR a.ml_user_id = ANY(p_ml_user_ids))
    AND (p_from IS NULL OR a.date >= p_from)
    AND (p_to   IS NULL OR a.date <= p_to)
  GROUP BY a.date
  ORDER BY a.date;
$$;

COMMENT ON FUNCTION public.ads_cache_daily_totals(TEXT[], DATE, DATE) IS
  'Gasto diário de publicidade somado sobre todos os anúncios das lojas pedidas. Chave de rateio (denominador) do ads por anúncio — Fase 211, ADS-06. SECURITY INVOKER: a RLS de ml_ads_products_cache é a fronteira; não recebe organization_id de propósito.';

-- Só `authenticated`: nunca `anon`. Sem DEFINER, não há privilégio a escalar.
GRANT EXECUTE ON FUNCTION public.ads_cache_daily_totals(TEXT[], DATE, DATE) TO authenticated;
