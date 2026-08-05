-- ============================================================================
-- Fase 215 — leitura do access_token do ML pelo usuário de serviço do MCP.
--
-- POR QUE UMA RPC, E NÃO UM GRANT NA TABELA:
--
-- `public.ml_tokens` não concede SELECT a `authenticated` — só `postgres` e
-- `service_role` leem. Isso é deliberado: um token de OAuth do ML não é dado
-- de leitura. Com ele dá para mudar preço, pausar anúncio e responder cliente.
-- Abrir SELECT na tabela daria esse poder a QUALQUER membro de QUALQUER org,
-- inclusive `viewer`.
--
-- Esta função abre uma fresta do tamanho exato da necessidade:
--   · devolve APENAS access_token e expires_at — nunca o refresh_token
--   · exige que o chamador seja membro da org pedida (fecha o IDOR do
--     parâmetro p_org_id, que é o risco clássico de SECURITY DEFINER)
--   · exige que o chamador seja um usuário de SERVIÇO do MCP, e não um humano
--     qualquer que por acaso seja membro
--
-- O refresh_token fica FORA de propósito: o Mercado Livre rotaciona o refresh
-- a cada renovação, então quem renovasse por último invalidaria o outro — e o
-- sync do dashboard pararia em silêncio. O MCP lê; o dashboard mantém.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_ml_token_for_service(p_org_id uuid)
RETURNS TABLE(access_token text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_email text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'sem sessao autenticada';
  END IF;

  -- Guarda 1 — IDOR: o parâmetro só vale se o chamador for membro DAQUELA org.
  -- Sem isto, SECURITY DEFINER deixaria qualquer um pedir o token de qualquer
  -- organização só trocando o UUID.
  IF NOT public.is_org_member(v_uid, p_org_id) THEN
    RAISE EXCEPTION 'sem permissao na organizacao %', p_org_id;
  END IF;

  -- Guarda 2 — só usuário de serviço. Ser membro não basta: um humano com
  -- papel viewer não tem por que extrair o token de OAuth da empresa.
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;
  IF v_email IS NULL OR v_email NOT LIKE 'nexo-mcp+%' THEN
    RAISE EXCEPTION 'esta funcao atende apenas usuarios de servico do MCP';
  END IF;

  RETURN QUERY
  SELECT t.access_token, t.expires_at
  FROM public.ml_tokens t
  WHERE t.organization_id = p_org_id
    AND t.access_token IS NOT NULL
  LIMIT 1;
END;
$function$;

-- Disciplina de privilégio: nada de PUBLIC nem anon. `authenticated` é o role
-- do usuário de serviço — as duas guardas acima é que fazem o recorte fino.
REVOKE ALL ON FUNCTION public.get_ml_token_for_service(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_ml_token_for_service(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_ml_token_for_service(uuid) TO authenticated;
