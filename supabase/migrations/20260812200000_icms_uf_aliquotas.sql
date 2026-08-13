-- Percentual de DIFAL por UF e procedência (Fase 222, FISC-03, régua D-08/D-09).
--
-- POR QUE O DIFAL É DADO DIRETO, E NÃO DERIVADO DE `interna − interestadual`:
-- a versão anterior desta migration guardava alíquota interna + FCP e deixava o
-- DIFAL ser calculado. Em 13/08/2026 a planilha de precificação do Wesley
-- (Google Sheets 1AJ3oP-uui8f66w9fu4VC88HXHEc-g2UcC_p6E6ogrcE) foi lida e as
-- fórmulas revertidas célula a célula: ela já carrega o **percentual de DIFAL
-- pronto** por UF, e é a régua que o negócio usa para precificar de verdade.
-- Derivar de novo o que a fonte já entrega só reintroduziria a ambiguidade do
-- FCP que fez 4 das 27 UFs divergirem entre fontes secundárias.
--
-- Onde o FCP existe, ele já está EMBUTIDO no percentual (RJ: 10% = 22% − 12%,
-- e os 22% já incluem os 2 pp de FCP). PB é exceção deliberada do Wesley:
-- 13%, ignorando os 2 pp de FCP que a folha do contador propunha. Por isso
-- NÃO existe mais coluna `aliq_fcp` — ver D-09 no 222-CONTEXT.md.
--
-- POR QUE PROCEDÊNCIA É PARTE DA CHAVE:
-- produto importado sai a 4% de alíquota interestadual (Resolução SF 13/2012),
-- não 7%/12%. A soma `interestadual + DIFAL` dá o MESMO total nas duas
-- procedências, então tratar importado como nacional só erra quando a UF não
-- recolhe DIFAL — e aí erra por 8 pp de ICMS, para MAIS. Ver D-11.
--
-- POR QUE `confirmado_por` MUDOU DE SIGNIFICADO:
-- antes era "um humano conferiu esta linha", e o seed nascia inteiro sem
-- confirmação porque vinha de agregador de NFe. Agora a fonte é a régua fiscal
-- do próprio negócio, referendada pela contadora em 13/08. O campo passa a
-- registrar QUAL FONTE confirmou. A guarda do computeOrderTax continua
-- idêntica — linha sem confirmação produz DIFAL null, nunca zero.
--
-- POR QUE É VERSIONADA POR VIGÊNCIA:
-- alíquota estadual muda por lei, não por decisão do sistema. Uma tabela sem
-- vigência exigiria UPDATE destrutivo a cada mudança, perdendo o valor
-- histórico já aplicado a pedidos passados.

-- ─── Extensão para a garantia de vigência sem sobreposição ──────────────────
-- btree_gist habilita EXCLUDE USING gist com igualdade (uf, procedencia) +
-- faixa (daterange). Se a extensão não puder ser criada neste projeto, o índice
-- único parcial abaixo (fallback) garante uma vigência ATUAL por par, mas não
-- impede sobreposição de vigências históricas.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ─── Tabela ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.icms_uf_aliquotas (
  id                  uuid          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  uf                  char(2)       NOT NULL,
  -- 'nacional' = interestadual 7%/12% conforme a região.
  -- 'importado' = interestadual 4% (Resolução SF 13/2012).
  procedencia         text          NOT NULL DEFAULT 'nacional',
  vigencia_inicio     date          NOT NULL,
  vigencia_fim        date          NULL,  -- null = vigente até segunda ordem

  -- Alíquota de ICMS da operação interestadual (débito na origem, SP).
  aliq_interestadual  numeric(6,4)  NOT NULL,
  -- Percentual de DIFAL do destino — DADO DIRETO da planilha, com FCP embutido
  -- onde ele existe. Nunca derivar de aliq_interna: não há aliq_interna aqui.
  pct_difal           numeric(6,4)  NOT NULL,

  fonte               text          NOT NULL,  -- de onde o número veio; obrigatória
  observacao          text          NULL,

  confirmado_por      text          NULL,
  confirmado_em       timestamptz   NULL,

  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT icms_uf_aliquotas_uf_valida CHECK (
    uf IN ('AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
           'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO')
  ),
  CONSTRAINT icms_uf_aliquotas_procedencia_valida CHECK (
    procedencia IN ('nacional', 'importado')
  ),
  CONSTRAINT icms_uf_aliquotas_interestadual_faixa CHECK (
    aliq_interestadual >= 0 AND aliq_interestadual <= 40
  ),
  CONSTRAINT icms_uf_aliquotas_pct_difal_faixa CHECK (
    pct_difal >= 0 AND pct_difal <= 40
  ),
  -- Meia confirmação não existe: os dois campos são nulos, ou os dois
  -- preenchidos.
  CONSTRAINT icms_uf_aliquotas_confirmacao_coerente CHECK (
    (confirmado_por IS NULL AND confirmado_em IS NULL)
    OR (confirmado_por IS NOT NULL AND confirmado_em IS NOT NULL)
  ),
  CONSTRAINT icms_uf_aliquotas_vigencia_valida CHECK (
    vigencia_fim IS NULL OR vigencia_fim > vigencia_inicio
  )
);

COMMENT ON COLUMN public.icms_uf_aliquotas.pct_difal IS
  'Percentual de DIFAL do destino, DADO DIRETO da planilha de precificação da '
  'Pé Vermeio (régua D-09). O FCP já está embutido onde existe — não somar '
  'nada por cima. A base é SIMPLES (D-08): DIFAL = receita × pct_difal.';
COMMENT ON COLUMN public.icms_uf_aliquotas.procedencia IS
  'nacional = interestadual 7%/12% por região. importado = 4% (Resolução SF '
  '13/2012). A soma aliq_interestadual + pct_difal é IGUAL nas duas — a '
  'diferença só aparece quando a UF não recolhe DIFAL, e aí são 8 pp de ICMS. '
  'Sem marcação de SKU, o consumidor usa nacional (D-11).';
COMMENT ON COLUMN public.icms_uf_aliquotas.confirmado_por IS
  'Qual FONTE confirmou esta linha (ex.: planilha_precificacao_2026). NULL = '
  'linha não confirmada — e enquanto nulo, o computeOrderTax (plano 222-03-R) '
  'devolve DIFAL null para a UF, nunca zero nem um valor calculado.';

-- ─── Garantia de uma só vigência por (UF, procedência) ──────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    ALTER TABLE public.icms_uf_aliquotas
      ADD CONSTRAINT icms_uf_aliquotas_sem_sobreposicao
      EXCLUDE USING gist (
        uf WITH =,
        procedencia WITH =,
        daterange(vigencia_inicio, COALESCE(vigencia_fim, 'infinity'::date), '[)') WITH &&
      );
  ELSE
    -- Fallback mais fraco: garante só que existe no máximo UMA vigência ATUAL
    -- por (uf, procedencia). Não impede sobreposição entre vigências
    -- históricas encerradas — btree_gist ausente neste projeto.
    CREATE UNIQUE INDEX IF NOT EXISTS icms_uf_aliquotas_uma_vigente_por_uf
      ON public.icms_uf_aliquotas (uf, procedencia)
      WHERE vigencia_fim IS NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS icms_uf_aliquotas_uf_idx
  ON public.icms_uf_aliquotas (uf, procedencia);

-- ─── Trigger de updated_at (mesmo molde do repo) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.icms_uf_aliquotas_stamp_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- CREATE OR REPLACE em vez de DROP + CREATE: regra da casa desde a Fase 220 é
-- não usar DROP em objeto de banco (DROP FUNCTION apaga a ACL, e a lição vale
-- por padrão para os demais objetos).
CREATE OR REPLACE TRIGGER icms_uf_aliquotas_updated_at
  BEFORE UPDATE ON public.icms_uf_aliquotas
  FOR EACH ROW
  EXECUTE FUNCTION public.icms_uf_aliquotas_stamp_updated_at();

-- ─── RLS — ligada na MESMA migration que cria a tabela, nunca depois ─────────
-- Regra da casa (feedback_tabela_de_execucao_nasce_sem_rls): tabela criada
-- fora deste padrão já nasceu aberta para `anon` nesta base antes (3 tabelas
-- da Fase 214, corrigidas depois — chave pública, escrita liberada).
ALTER TABLE public.icms_uf_aliquotas ENABLE ROW LEVEL SECURITY;

-- É dado de legislação estadual, não tem tenant — qualquer usuário autenticado
-- pode ler.
-- Idempotência sem DROP: só cria se ainda não existir.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'icms_uf_aliquotas'
       AND policyname = 'icms_uf_aliquotas select'
  ) THEN
    CREATE POLICY "icms_uf_aliquotas select"
      ON public.icms_uf_aliquotas FOR SELECT TO authenticated
      USING (true);
  END IF;
END $$;

-- Nenhuma policy de INSERT/UPDATE/DELETE: escrita fica exclusiva de
-- service_role, que ignora RLS.

REVOKE ALL ON public.icms_uf_aliquotas FROM anon;
GRANT SELECT ON public.icms_uf_aliquotas TO authenticated;

-- ─── Função de leitura vigente ────────────────────────────────────────────
-- SECURITY INVOKER é obrigatório — regra da casa (feedback_supabase_security_
-- invoker): função SECURITY DEFINER que lê tabela sob RLS com parâmetro de org
-- já causou IDOR neste repo.
--
-- Nome preservado (`aliquota_interna_vigente`) para não quebrar quem já
-- referencia, mas o retorno mudou junto com a régua: devolve o par
-- (interestadual, pct_difal) por procedência, não mais interna + FCP.
CREATE OR REPLACE FUNCTION public.aliquota_interna_vigente(p_data date DEFAULT CURRENT_DATE)
RETURNS TABLE (
  uf                 char(2),
  procedencia        text,
  aliq_interestadual numeric,
  pct_difal          numeric,
  confirmado         boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    t.uf,
    t.procedencia,
    t.aliq_interestadual,
    t.pct_difal,
    (t.confirmado_por IS NOT NULL) AS confirmado
  FROM public.icms_uf_aliquotas t
  WHERE t.vigencia_inicio <= p_data
    AND (t.vigencia_fim IS NULL OR t.vigencia_fim > p_data);
$$;

GRANT EXECUTE ON FUNCTION public.aliquota_interna_vigente(date) TO authenticated;

-- ─── Seed: 26 UFs × 2 procedências = 52 linhas ──────────────────────────────
-- Fonte: planilha de precificação da Pé Vermeio, colunas "DIFAL SAINDO DE SP
-- NACIONAL" e "DIFAL SAINDO DE SP IMPORTADO".
--
-- SP NÃO entra: origem igual a destino é operação interna, sem DIFAL.
--
-- SE e TO vão CORRIGIDOS (12% e 13%), não com os 7% e 8% da planilha. Prova:
-- `aliq_interestadual + pct_difal` tem de dar a mesma alíquota interna nas duas
-- procedências — fecha em 24 das 26 UFs, e só SE e TO não fechavam. Os valores
-- corretos batem com a coluna "saindo de MG" da própria planilha E com a folha
-- do contador. Três fontes independentes concordando. Ver D-09.
INSERT INTO public.icms_uf_aliquotas
  (uf, procedencia, vigencia_inicio, vigencia_fim, aliq_interestadual, pct_difal, fonte, observacao)
VALUES
  -- ── Nacional (interestadual 12% em MG/PR/RS/RJ/SC; 7% nas demais) ──
  ('AC','nacional', DATE '2026-01-01', NULL,  7.0000, 12.0000, 'planilha_precificacao_2026', NULL),
  ('AL','nacional', DATE '2026-01-01', NULL,  7.0000, 13.0000, 'planilha_precificacao_2026', 'Resolve a divergência AL das fontes secundárias: 7+13 = 20% interna, batendo com 19% + 1pp de FCP.'),
  ('AM','nacional', DATE '2026-01-01', NULL,  7.0000, 13.0000, 'planilha_precificacao_2026', NULL),
  ('AP','nacional', DATE '2026-01-01', NULL,  7.0000, 11.0000, 'planilha_precificacao_2026', NULL),
  ('BA','nacional', DATE '2026-01-01', NULL,  7.0000, 14.0000, 'planilha_precificacao_2026', 'Implica interna 21%; folha do contador propunha 20,5%. Wesley (13/08): seguir a planilha.'),
  ('CE','nacional', DATE '2026-01-01', NULL,  7.0000, 13.0000, 'planilha_precificacao_2026', NULL),
  ('DF','nacional', DATE '2026-01-01', NULL,  7.0000, 13.0000, 'planilha_precificacao_2026', NULL),
  ('ES','nacional', DATE '2026-01-01', NULL,  7.0000, 10.0000, 'planilha_precificacao_2026', NULL),
  ('GO','nacional', DATE '2026-01-01', NULL,  7.0000, 12.0000, 'planilha_precificacao_2026', NULL),
  ('MA','nacional', DATE '2026-01-01', NULL,  7.0000, 16.0000, 'planilha_precificacao_2026', NULL),
  ('MT','nacional', DATE '2026-01-01', NULL,  7.0000, 10.0000, 'planilha_precificacao_2026', NULL),
  ('MS','nacional', DATE '2026-01-01', NULL,  7.0000, 10.0000, 'planilha_precificacao_2026', NULL),
  ('MG','nacional', DATE '2026-01-01', NULL, 12.0000,  6.0000, 'planilha_precificacao_2026', 'Caso-prova da fase: pedido 2000017711929314, SP→MG.'),
  ('PA','nacional', DATE '2026-01-01', NULL,  7.0000, 12.0000, 'planilha_precificacao_2026', NULL),
  ('PB','nacional', DATE '2026-01-01', NULL,  7.0000, 13.0000, 'planilha_precificacao_2026', 'Implica interna 20%, sem os 2pp de FCP da folha do contador. Wesley (13/08): ignorar o FCP, seguir a planilha.'),
  ('PR','nacional', DATE '2026-01-01', NULL, 12.0000,  8.0000, 'planilha_precificacao_2026', 'Implica interna 20%; folha do contador propunha 19,5%. Wesley (13/08): seguir a planilha.'),
  ('PE','nacional', DATE '2026-01-01', NULL,  7.0000, 14.0000, 'planilha_precificacao_2026', 'Implica interna 21%; folha do contador propunha 20,5%. Wesley (13/08): seguir a planilha.'),
  ('PI','nacional', DATE '2026-01-01', NULL,  7.0000, 16.0000, 'planilha_precificacao_2026', 'Implica interna 23%; folha do contador propunha 22,5%. Wesley (13/08): seguir a planilha.'),
  ('RN','nacional', DATE '2026-01-01', NULL,  7.0000, 13.0000, 'planilha_precificacao_2026', NULL),
  ('RS','nacional', DATE '2026-01-01', NULL, 12.0000,  5.0000, 'planilha_precificacao_2026', NULL),
  ('RJ','nacional', DATE '2026-01-01', NULL, 12.0000, 10.0000, 'planilha_precificacao_2026', 'Resolve a divergência RJ das fontes secundárias: 12+10 = 22% interna, ou seja 20% + 2pp de FCP embutidos.'),
  ('RO','nacional', DATE '2026-01-01', NULL,  7.0000, 13.0000, 'planilha_precificacao_2026', 'Implica interna 20%; folha do contador propunha 19,5%. Wesley (13/08): seguir a planilha.'),
  ('RR','nacional', DATE '2026-01-01', NULL,  7.0000, 13.0000, 'planilha_precificacao_2026', NULL),
  ('SC','nacional', DATE '2026-01-01', NULL, 12.0000,  5.0000, 'planilha_precificacao_2026', NULL),
  ('SE','nacional', DATE '2026-01-01', NULL,  7.0000, 12.0000, 'planilha_precificacao_2026', 'CORRIGIDO: a planilha traz 7%, que não fecha com a coluna importado (4+15=19%). O valor certo é 12% — confirmado pela coluna importado, pela coluna saindo-de-MG e pela folha do contador. Ver D-09.'),
  ('TO','nacional', DATE '2026-01-01', NULL,  7.0000, 13.0000, 'planilha_precificacao_2026', 'CORRIGIDO: a planilha traz 8%, que não fecha com a coluna importado (4+16=20%). O valor certo é 13% — confirmado pela coluna importado, pela coluna saindo-de-MG e pela folha do contador. Ver D-09.'),

  -- ── Importado (interestadual 4% em todas — Resolução SF 13/2012) ──
  ('AC','importado', DATE '2026-01-01', NULL, 4.0000, 15.0000, 'planilha_precificacao_2026', NULL),
  ('AL','importado', DATE '2026-01-01', NULL, 4.0000, 16.0000, 'planilha_precificacao_2026', NULL),
  ('AM','importado', DATE '2026-01-01', NULL, 4.0000, 16.0000, 'planilha_precificacao_2026', NULL),
  ('AP','importado', DATE '2026-01-01', NULL, 4.0000, 14.0000, 'planilha_precificacao_2026', NULL),
  ('BA','importado', DATE '2026-01-01', NULL, 4.0000, 17.0000, 'planilha_precificacao_2026', NULL),
  ('CE','importado', DATE '2026-01-01', NULL, 4.0000, 16.0000, 'planilha_precificacao_2026', NULL),
  ('DF','importado', DATE '2026-01-01', NULL, 4.0000, 16.0000, 'planilha_precificacao_2026', NULL),
  ('ES','importado', DATE '2026-01-01', NULL, 4.0000, 13.0000, 'planilha_precificacao_2026', NULL),
  ('GO','importado', DATE '2026-01-01', NULL, 4.0000, 15.0000, 'planilha_precificacao_2026', NULL),
  ('MA','importado', DATE '2026-01-01', NULL, 4.0000, 19.0000, 'planilha_precificacao_2026', NULL),
  ('MT','importado', DATE '2026-01-01', NULL, 4.0000, 13.0000, 'planilha_precificacao_2026', NULL),
  ('MS','importado', DATE '2026-01-01', NULL, 4.0000, 13.0000, 'planilha_precificacao_2026', NULL),
  ('MG','importado', DATE '2026-01-01', NULL, 4.0000, 14.0000, 'planilha_precificacao_2026', NULL),
  ('PA','importado', DATE '2026-01-01', NULL, 4.0000, 15.0000, 'planilha_precificacao_2026', NULL),
  ('PB','importado', DATE '2026-01-01', NULL, 4.0000, 16.0000, 'planilha_precificacao_2026', NULL),
  ('PR','importado', DATE '2026-01-01', NULL, 4.0000, 16.0000, 'planilha_precificacao_2026', NULL),
  ('PE','importado', DATE '2026-01-01', NULL, 4.0000, 17.0000, 'planilha_precificacao_2026', NULL),
  ('PI','importado', DATE '2026-01-01', NULL, 4.0000, 19.0000, 'planilha_precificacao_2026', NULL),
  ('RN','importado', DATE '2026-01-01', NULL, 4.0000, 16.0000, 'planilha_precificacao_2026', NULL),
  ('RS','importado', DATE '2026-01-01', NULL, 4.0000, 13.0000, 'planilha_precificacao_2026', NULL),
  ('RJ','importado', DATE '2026-01-01', NULL, 4.0000, 18.0000, 'planilha_precificacao_2026', NULL),
  ('RO','importado', DATE '2026-01-01', NULL, 4.0000, 16.0000, 'planilha_precificacao_2026', NULL),
  ('RR','importado', DATE '2026-01-01', NULL, 4.0000, 16.0000, 'planilha_precificacao_2026', NULL),
  ('SC','importado', DATE '2026-01-01', NULL, 4.0000, 13.0000, 'planilha_precificacao_2026', NULL),
  ('SE','importado', DATE '2026-01-01', NULL, 4.0000, 15.0000, 'planilha_precificacao_2026', NULL),
  ('TO','importado', DATE '2026-01-01', NULL, 4.0000, 16.0000, 'planilha_precificacao_2026', NULL)
ON CONFLICT DO NOTHING;

-- A régua do negócio É a fonte de confirmação (D-08/D-09). Diferente da versão
-- anterior, aqui o seed nasce confirmado — mas por uma FONTE NOMEADA, nunca por
-- ausência de conferência. A guarda do computeOrderTax é a mesma: linha sem
-- confirmado_por não produz DIFAL.
UPDATE public.icms_uf_aliquotas
   SET confirmado_por = 'planilha_precificacao_2026',
       confirmado_em  = now()
 WHERE fonte = 'planilha_precificacao_2026'
   AND confirmado_por IS NULL;

-- ─── Guardas finais: falha alto em vez de aplicar pela metade ────────────────
DO $$
DECLARE
  v_total          integer;
  v_inconsistentes integer;
  v_se             numeric;
  v_to             numeric;
BEGIN
  SELECT count(*) INTO v_total
    FROM public.icms_uf_aliquotas
   WHERE fonte = 'planilha_precificacao_2026';

  IF v_total <> 52 THEN
    RAISE EXCEPTION 'seed do DIFAL incompleto: esperava 52 linhas (26 UFs x 2 procedências), encontrei %', v_total;
  END IF;

  -- Guarda de consistência: `interestadual + difal` tem de dar a MESMA alíquota
  -- interna do destino para nacional e importado. Foi exatamente esta conta que
  -- revelou os erros de digitação de SE e TO na planilha (13/08). Fica como
  -- guarda permanente: qualquer edição futura que quebre a identidade falha
  -- alto, em vez de gerar imposto plausível e errado.
  SELECT count(*) INTO v_inconsistentes
    FROM (
      SELECT t.uf
        FROM public.icms_uf_aliquotas t
       WHERE t.vigencia_fim IS NULL
       GROUP BY t.uf
      HAVING count(DISTINCT t.aliq_interestadual + t.pct_difal) > 1
    ) x;

  IF v_inconsistentes > 0 THEN
    RAISE EXCEPTION 'seed inconsistente: % UF(s) com alíquota interna divergente entre nacional e importado (interestadual + difal tem de fechar igual nas duas)', v_inconsistentes;
  END IF;

  -- SP não pode ter linha: origem = destino, operação interna, sem DIFAL.
  IF EXISTS (SELECT 1 FROM public.icms_uf_aliquotas WHERE uf = 'SP') THEN
    RAISE EXCEPTION 'SP não deve ter linha nesta tabela: origem igual a destino é operação interna, sem DIFAL';
  END IF;

  -- As duas correções de digitação têm de estar aplicadas.
  SELECT pct_difal INTO v_se FROM public.icms_uf_aliquotas
   WHERE uf = 'SE' AND procedencia = 'nacional' AND vigencia_fim IS NULL;
  SELECT pct_difal INTO v_to FROM public.icms_uf_aliquotas
   WHERE uf = 'TO' AND procedencia = 'nacional' AND vigencia_fim IS NULL;

  IF v_se <> 12 OR v_to <> 13 THEN
    RAISE EXCEPTION 'SE e TO precisam entrar corrigidos (12%% e 13%%), não com os valores digitados errado na planilha (7%% e 8%%). Encontrei SE=%, TO=%', v_se, v_to;
  END IF;
END $$;
