-- security-sweep.sql — varredura de privilégio do schema public como UMA declaração.
--
-- Por que uma declaração só: o execute_sql do MCP entrega apenas o primeiro result
-- set, e uma consulta única também roda por psql ou por dentro de uma RPC no futuro,
-- sem reescrita. Devolve um objeto JSON — o MESMO instrumento mede o antes e o depois
-- (Fase 209, SEC-07/SEC-08).
--
-- Regra que decide se a varredura presta: `proacl` NULO conta como EXPOSTO. proacl nulo
-- significa "valem os grants padrão", e o padrão do Postgres ao criar função é EXECUTE
-- para PUBLIC. Uma varredura que trate nulo como "sem achado" passa por cima exatamente
-- da classe de deriva que fechou `can_member_access_route` aberta por 3+ meses.
--
-- Uso:  psql "$DB_URL" -Atf scripts/security-sweep.sql
--   ou: execute_sql com o corpo abaixo.

WITH pol AS (
  SELECT tablename, policyname,
         coalesce(qual,'') || ' ' || coalesce(with_check,'') AS expr
  FROM pg_policies WHERE schemaname='public'
),
fns AS (
  SELECT p.oid, p.proname,
         (p.oid::regprocedure)::text AS assinatura,   -- assinatura, não nome: REVOKE sem assinatura falha; sobrecarga esquecida deixa buraco
         p.prosecdef,
         p.proacl::text AS proacl,
         has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_x,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
         has_function_privilege('service_role',  p.oid, 'EXECUTE') AS svc_x
  FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
)
SELECT jsonb_build_object(
  'gerado_por', 'scripts/security-sweep.sql',
  'total_tabelas', (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'),
  'total_funcoes', (SELECT count(*) FROM fns),
  -- todas as tabelas: RLS, ACL cru, policies, contagem
  'tabelas', (SELECT jsonb_agg(jsonb_build_object(
       'nome', c.relname, 'rls', c.relrowsecurity, 'relacl', c.relacl::text, 'reltuples', c.reltuples,
       'policies', (SELECT jsonb_agg(pp.policyname) FROM pg_policies pp WHERE pp.schemaname='public' AND pp.tablename=c.relname)
     ) ORDER BY c.relname)
     FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r'),
  -- SEC-07: tabelas sem RLS
  'sem_rls', (SELECT coalesce(jsonb_agg(c.relname ORDER BY c.relname),'[]'::jsonb) FROM pg_class c
              WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND NOT c.relrowsecurity),
  -- modo de falha oposto: RLS ligada e zero policy (tabela ilegível até para membro)
  'rls_sem_policy', (SELECT coalesce(jsonb_agg(c.relname ORDER BY c.relname),'[]'::jsonb) FROM pg_class c
              WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND c.relrowsecurity
                AND NOT EXISTS (SELECT 1 FROM pg_policies pp WHERE pp.schemaname='public' AND pp.tablename=c.relname)),
  -- tabelas que concedem qualquer privilégio a anon (aclexplode)
  'grants_para_anon', (SELECT coalesce(jsonb_agg(DISTINCT c.relname),'[]'::jsonb)
              FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
              WHERE c.relnamespace='public'::regnamespace AND c.relkind='r'
                AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname='anon')),
  -- todas as funções, com assinatura resolvida por regprocedure
  'funcoes', (SELECT jsonb_agg(jsonb_build_object(
       'assinatura', 'public.'||assinatura, 'prosecdef', prosecdef, 'proacl', proacl,
       'anon_execute', anon_x, 'authenticated_execute', auth_x, 'service_role_execute', svc_x
     ) ORDER BY assinatura) FROM fns),
  -- SEC-08: funções SECURITY DEFINER executáveis por anon OU authenticated (proacl nulo já entra como exposto via has_function_privilege)
  'definer_exposta', (SELECT coalesce(jsonb_agg('public.'||assinatura ORDER BY assinatura),'[]'::jsonb)
       FROM fns WHERE prosecdef AND (anon_x OR auth_x)),
  -- funções referenciadas por expressão de policy — a lista de INTOCÁVEIS, derivada da própria pg_policies
  'funcoes_usadas_por_policy', (SELECT coalesce(jsonb_object_agg(assinatura, deps),'{}'::jsonb) FROM (
       SELECT 'public.'||f.assinatura AS assinatura,
              (SELECT jsonb_agg(DISTINCT p.tablename||'.'||p.policyname) FROM pol p WHERE p.expr ~ ('\y'||f.proname||'\y')) AS deps
       FROM fns f WHERE EXISTS (SELECT 1 FROM pol p WHERE p.expr ~ ('\y'||f.proname||'\y'))
     ) z)
) AS sweep;
