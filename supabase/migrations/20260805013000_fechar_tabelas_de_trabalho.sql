-- ============================================================================
-- Fecha as tabelas de trabalho criadas na Fase 214 e revoga escrita de `anon`.
--
-- FALHA INTRODUZIDA POR MIM EM 2026-08-04, corrigida em 2026-08-05.
--
-- `gate_reposicao_baseline`, `gate_reposicao_v2` e `rpc_backup_214` nasceram de
-- `CREATE TABLE AS SELECT` durante a execução da fase. Tabela criada assim NÃO
-- ganha RLS, e os default privileges do Supabase concedem SELECT/INSERT/UPDATE/
-- DELETE a `anon`. Como a chave anônima é pública — vai no bundle do site —
-- qualquer pessoa podia LER e APAGAR essas tabelas.
--
-- `gate_reposicao_baseline` e `gate_reposicao_v2` guardam SKU, estoque e compra
-- sugerida: dado de operação, não metadado. Era vazamento real, não teórico.
--
-- Lição: o lint de migration pega `CREATE TABLE` em arquivo de migration. Tabela
-- nascida de um `execute_sql` avulso durante a execução escapa dele — é o furo
-- que o próprio lint documenta e que a varredura ao vivo do catálogo cobre.
--
-- Estas três são internas: evidência de gate e backup de função. Ninguém as lê
-- pela aplicação. Ligar RLS SEM criar policy é o correto — `service_role` e
-- `postgres` seguem acessando, todo o resto fica de fora.
-- ============================================================================

ALTER TABLE public.gate_reposicao_baseline ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gate_reposicao_v2       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rpc_backup_214          ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.gate_reposicao_baseline FROM anon, authenticated;
REVOKE ALL ON public.gate_reposicao_v2       FROM anon, authenticated;
REVOKE ALL ON public.rpc_backup_214          FROM anon, authenticated;

-- ============================================================================
-- Defesa em profundidade: `anon` não escreve em nada do schema `public`.
--
-- Medido em 2026-08-05: 57 tabelas concediam INSERT/UPDATE/DELETE a `anon` —
-- é o default do Supabase, não uma decisão. Nenhuma estava exposta de fato,
-- porque as policies exigem `is_org_member(auth.uid(), ...)` e
-- `is_org_member(NULL, org)` devolve false (verificado). Ou seja: hoje a RLS
-- segura sozinha.
--
-- O problema é que ela segura sozinha. Basta alguém criar uma policy `TO PUBLIC`
-- sem condição — e cinco tabelas JÁ usam `TO PUBLIC`, salvas apenas pelo
-- conteúdo da condição — para a porta abrir. Remover o GRANT tira a dependência
-- de uma única camada.
--
-- SELECT de `anon` é preservado: algumas telas públicas dependem dele.
-- ============================================================================

DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM anon', t.relname);
  END LOOP;
END $$;
