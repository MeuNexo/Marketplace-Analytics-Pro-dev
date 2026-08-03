-- SEC-08 (Fase 209): tirar EXECUTE de anon/authenticated de duas funcoes
-- SECURITY DEFINER. Conserto na camada de PRIVILEGIO — o corpo NAO e tocado.
--
-- check_quota: unico chamador legitimo e process-sync-job (service role). Depois
-- do REVOKE nao sobra sessao (anon nem authenticated) capaz de passar _org_id
-- alheio: a recusa acontece no portao, antes do corpo rodar. NAO por checagem de
-- membro no corpo — process-sync-job chama com service role, auth.uid() e NULO,
-- e is_org_member(NULL, org) e falso => quebraria o portao de quota de todo sync.
--
-- can_member_access_route: zero chamadores (frontend le member_route_permissions
-- direto). Nenhum GRANT — conceder por precaucao reabre a porta.
--
-- REVOKE de PUBLIC, anon, authenticated os tres nomeados: revogar so de PUBLIC nao
-- retira grant nominal. NAO se toca em is_org_member/get_org_role (sustentam as 143
-- policies). Reversao: GRANT EXECUTE ... TO PUBLIC (ou anon, authenticated) de volta.

REVOKE EXECUTE ON FUNCTION public.check_quota(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.check_quota(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.can_member_access_route(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
