-- SEC-08 (Fase 209), complemento: can_member_access_route tinha grant NOMINAL
-- de service_role (alem do PUBLIC), que o REVOKE FROM PUBLIC/anon/authenticated
-- nao remove. A funcao tem ZERO chamadores (frontend le member_route_permissions
-- direto; nenhuma policy/funcao/trigger/repo a referencia). Fechar tambem o
-- service_role deixa a funcao alcancavel por ninguem — nao ha porta que precise
-- ficar aberta. Reversao: GRANT EXECUTE ... TO service_role.
REVOKE EXECUTE ON FUNCTION public.can_member_access_route(uuid, uuid, text) FROM service_role;
