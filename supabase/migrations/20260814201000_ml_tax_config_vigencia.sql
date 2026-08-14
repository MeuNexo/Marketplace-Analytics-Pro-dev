-- Vigência versionada em `ml_tax_config` — schema (Fase 222, plano 222-05-R,
-- FISC-02).
--
-- MOMENTO DE APLICAÇÃO: depois do snapshot (`20260814200000`) e depois das
-- migrations da fase que ainda faltam. **Esta migration mantém UMA linha por
-- loja** — não remove a unicidade e não semeia nada. É por isso que ela pode
-- entrar com o código antigo ainda no ar, sem abrir janela de quebra.
--
-- O PROBLEMA QUE ELA RESOLVE: `ml_tax_config` guardava uma linha por loja, sem
-- vigência. O que ficava em `orders.tax_rate` era a alíquota que estava na
-- config no dia em que o recálculo passou por aquele pedido — não a que valia
-- na competência dele. Medido em 14/08/2026: a config do Junior (loja
-- 2359559427) mudou de 6% para 4% em 11/08 e **352 pedidos de 01 a 10/08 foram
-- regravados retroativamente com 4%**. `orders.tax_amount` precisa ser
-- reprodutível: recalcular o mesmo pedido daqui a seis meses tem de dar o mesmo
-- número.
--
-- POR QUE `2020-01-01` PARA AS LINHAS EXISTENTES: quem nunca mudou de alíquota
-- tem uma régua só, válida desde antes de existir pedido neste banco. Uma data
-- larga preserva EXATAMENTE o comportamento de hoje para essas lojas. Inventar
-- uma data de início mais recente (a de criação da linha, por exemplo) faria
-- pedidos anteriores a ela ficarem sem vigência e, portanto, sem imposto — uma
-- regressão criada pela própria correção.

ALTER TABLE public.ml_tax_config
  ADD COLUMN IF NOT EXISTS vigencia_inicio date NULL,
  ADD COLUMN IF NOT EXISTS vigencia_fim    date NULL;

-- Backfill: toda linha existente vira a vigência ABERTA da sua loja.
UPDATE public.ml_tax_config
   SET vigencia_inicio = DATE '2020-01-01'
 WHERE vigencia_inicio IS NULL;

-- Obrigatória só DEPOIS do preenchimento: sem vigência de início não há como
-- resolver a régua de um pedido, e a coluna nula equivaleria a voltar ao bug.
ALTER TABLE public.ml_tax_config
  ALTER COLUMN vigencia_inicio SET NOT NULL;

-- Intervalo válido. NOT VALID não é necessário aqui: o backfill acima já deixou
-- todas as linhas em conformidade, então a validação imediata não reprova nada.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ml_tax_config_vigencia_valida'
       AND conrelid = 'public.ml_tax_config'::regclass
  ) THEN
    ALTER TABLE public.ml_tax_config
      ADD CONSTRAINT ml_tax_config_vigencia_valida CHECK (
        vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio
      );
  END IF;
END $$;

-- ─── Semântica escrita no próprio banco ─────────────────────────────────────
-- Isto é a parte que ninguém adivinha depois: quem consultar a coluna daqui a
-- um ano precisa achar a regra aqui, não em código que pode ter mudado.

COMMENT ON COLUMN public.ml_tax_config.vigencia_inicio IS
  'Primeiro dia em que esta régua fiscal vale (inclusive). A alíquota de um '
  'pedido é escolhida pela DATA DO PEDIDO (orders.data_pedido), NUNCA pela '
  'data do recálculo — é exatamente essa confusão que regravou 352 pedidos do '
  'Junior de 01–10/08/2026 com a alíquota que passou a valer em 11/08. Linhas '
  'que já existiam quando esta coluna foi criada receberam 2020-01-01: data '
  'larga deliberada, que preserva o comportamento de quem nunca mudou de '
  'alíquota. Resolvido em código por resolverConfigVigente '
  '(supabase/functions/_shared/taxConfigVigente.ts).';

COMMENT ON COLUMN public.ml_tax_config.vigencia_fim IS
  'Último dia em que esta régua vale (inclusive). NULL = vigência CORRENTE — é '
  'por este predicado que a tela fiscal, o hook useMLTaxConfig, a view '
  'ml_difal_cobrado_por_dia e a função get_difal_summary escolhem a linha de '
  'hoje. Alterar a alíquota na tela não sobrescreve a linha: fecha esta '
  'vigência no dia anterior e abre outra (plano 222-05-R, FISC-02).';

-- ─── Guardas finais: falha alto em vez de aplicar pela metade ───────────────
DO $$
DECLARE
  v_sem_inicio integer;
  v_duas_abertas integer;
BEGIN
  SELECT count(*) INTO v_sem_inicio
    FROM public.ml_tax_config WHERE vigencia_inicio IS NULL;
  IF v_sem_inicio > 0 THEN
    RAISE EXCEPTION 'backfill incompleto: % linha(s) de ml_tax_config sem vigencia_inicio', v_sem_inicio;
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
