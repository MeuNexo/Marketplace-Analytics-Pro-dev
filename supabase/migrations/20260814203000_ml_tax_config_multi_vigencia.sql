-- Troca a unicidade por loja pela não-sobreposição de vigência (Fase 222,
-- plano 222-05-R, FISC-02).
--
-- ⚠️ MOMENTO DE APLICAÇÃO — LEIA ANTES DE APLICAR: esta migration **só pode
-- entrar depois de o frontend corrigido estar publicado**. O salvamento antigo
-- da tela fiscal usa `upsert` com resolução de conflito por `(ml_user_id,
-- organization_id)`, e o PostgreSQL só sabe inferir esse conflito enquanto
-- existir um índice único sobre exatamente esse par. No segundo em que a
-- restrição sair, qualquer salvamento na tela fiscal passa a devolver erro de
-- inferência de conflito. O frontend do 222-05-R (Task 3) já não usa upsert:
-- ele atualiza por identificador da linha, ou fecha-e-insere.
--
-- POR QUE É NECESSÁRIA: `ml_tax_config_unique` torna a segunda vigência de uma
-- loja IMPOSSÍVEL — inserir a linha histórica de 6% do Junior falharia na hora.
-- A unicidade certa não é "uma linha por loja", é "nenhuma loja com duas réguas
-- valendo no mesmo dia".
--
-- POR QUE ESTA REMOÇÃO É PERMITIDA: a regra da casa proíbe `DROP FUNCTION` e
-- `DROP VIEW`, porque DROP apaga a ACL (GRANT) de que o frontend depende.
-- Restrição de tabela não carrega ACL nenhuma — não há privilégio a perder
-- aqui. É a única remoção deste plano.
--
-- Molde idêntico ao do 222-01-R em `icms_uf_aliquotas`: `btree_gist` com
-- exclusão por intervalo quando disponível, índice único parcial como fallback.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ─── Sai a unicidade por loja ───────────────────────────────────────────────
ALTER TABLE public.ml_tax_config
  DROP CONSTRAINT IF EXISTS ml_tax_config_unique;

-- ─── Entra a não-sobreposição por vigência ──────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ml_tax_config_sem_sobreposicao'
       AND conrelid = 'public.ml_tax_config'::regclass
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    ALTER TABLE public.ml_tax_config
      ADD CONSTRAINT ml_tax_config_sem_sobreposicao
      EXCLUDE USING gist (
        ml_user_id WITH =,
        organization_id WITH =,
        -- `vigencia_fim` é INCLUSIVA nesta tabela (o pedido do dia 30/06
        -- pertence à vigência que termina em 30/06 — mesma régua de
        -- resolverConfigVigente). Um `daterange` é meio-aberto, então o limite
        -- superior é `fim + 1`; nulo vira infinito. Escrever `'[]'` com
        -- 'infinity' faria o Postgres canonicalizar somando 1 ao infinito.
        daterange(vigencia_inicio, COALESCE(vigencia_fim + 1, 'infinity'::date), '[)') WITH &&
      );
  ELSE
    -- Fallback mais fraco: garante só que existe no máximo UMA vigência ABERTA
    -- por (loja, organização). Não impede sobreposição entre vigências
    -- históricas já encerradas — btree_gist ausente neste projeto.
    CREATE UNIQUE INDEX IF NOT EXISTS ml_tax_config_uma_vigente_por_loja
      ON public.ml_tax_config (ml_user_id, organization_id)
      WHERE vigencia_fim IS NULL;
  END IF;
END $$;

-- ─── Guardas finais: falha alto em vez de aplicar pela metade ───────────────
DO $$
DECLARE
  v_tem_protecao boolean;
  v_duas_abertas integer;
BEGIN
  SELECT
    EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'ml_tax_config_sem_sobreposicao'
         AND conrelid = 'public.ml_tax_config'::regclass
    )
    OR EXISTS (
      SELECT 1 FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname  = 'ml_tax_config_uma_vigente_por_loja'
    )
  INTO v_tem_protecao;

  IF NOT v_tem_protecao THEN
    RAISE EXCEPTION 'ml_tax_config ficou SEM proteção de vigência: nem a restrição de não-sobreposição nem o índice único parcial foram criados. Aplicar assim deixaria a tabela aceitar duas réguas valendo no mesmo dia.';
  END IF;

  SELECT count(*) INTO v_duas_abertas
    FROM (
      SELECT ml_user_id, organization_id
        FROM public.ml_tax_config
       WHERE vigencia_fim IS NULL
       GROUP BY ml_user_id, organization_id
      HAVING count(*) > 1
    ) x;
  IF v_duas_abertas > 0 THEN
    RAISE EXCEPTION 'estado inválido: % loja(s) com mais de uma vigência aberta em ml_tax_config', v_duas_abertas;
  END IF;
END $$;
