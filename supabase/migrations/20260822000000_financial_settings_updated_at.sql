-- ============================================================
-- Fase 230, plano 01 (CX-06) — trigger de updated_at em financial_settings
-- ============================================================
--
-- O DEFEITO QUE ESTA MIGRATION CORRIGE: `financial_settings` não tem, e
-- nunca teve, nenhuma trigger de `updated_at` (confirmado por busca em
-- TODAS as migrations do repositório). A coluna tem `DEFAULT now()`
-- (`20260618100000_cash_flow_tables.sql`), mas o DEFAULT só vale no INSERT.
-- O botão "Ajustar saldo de hoje" (`MLFluxoCaixa.tsx`) faz UPDATE quando a
-- linha da organização já existe — que é o caso normal, depois do primeiro
-- ajuste. Resultado: `updated_at` ficava igual à data de CRIAÇÃO da linha, e
-- não à data do ÚLTIMO ajuste. Medido em 21/08/2026: a linha da Pé Vermeio
-- mostrava 39 dias de idade quando, na verdade, não havia como saber quando
-- o Wesley tinha ajustado o saldo pela última vez.
--
-- O QUE ESTA MIGRATION FAZ: cria uma trigger BEFORE UPDATE em
-- `public.financial_settings` chamando `public.handle_updated_at()` — a
-- mesma função já usada por outras tabelas do projeto (ex.:
-- `organizations`, `20260414200325_...sql:102-104`), já com EXECUTE
-- revogado de PUBLIC/anon/authenticated. Ela só escreve `updated_at =
-- now()`, nunca toca em nenhum valor financeiro.
--
-- Ajustes de saldo feitos ANTES desta migration não têm como recuperar a
-- data real — `src/lib/saldoConfiabilidade.ts` declara esse caso como o
-- estado `nunca_carimbado` (updated_at === created_at), para que eles nunca
-- se apresentem como recentes.
--
-- Idempotente: DROP TRIGGER IF EXISTS antes do CREATE TRIGGER. Seguro rodar
-- múltiplas vezes.
--
-- Supabase project: ckcdevcxgvueywivefgx.
-- ============================================================

DROP TRIGGER IF EXISTS update_financial_settings_updated_at ON public.financial_settings;

CREATE TRIGGER update_financial_settings_updated_at
BEFORE UPDATE ON public.financial_settings
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
