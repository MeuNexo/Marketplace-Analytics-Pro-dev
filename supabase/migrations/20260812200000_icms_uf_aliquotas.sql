-- Alíquota interna de ICMS por UF e procedência (Fase 222, FISC-03/FISC-05,
-- régua D-R2-02/D-R2-03). O DIFAL NÃO é armazenado: é derivado.
--
-- QUAL É A FONTE:
-- a planilha oficial de precificação da Pé Vermeio
-- (Google Sheets 1hBuMpmTHFl2Y53uAtbGIqjqAsRbI5bU5bqlWzTE_D4g), conferida
-- célula a célula, 27/27, contra o módulo fiscal da versão do dashboard que a
-- CONTADORA APROVOU (19/08/2026). Ela entrega ALÍQUOTA INTERNA por UF — não
-- percentual de DIFAL pronto.
--
-- POR QUE A VERSÃO ANTERIOR DESTE ARQUIVO FOI DESCARTADA:
-- ela vinha da planilha de precificação ANTIGA e errava a alíquota interna em
-- SETE UFs — RJ 22→20, BA 21→20,5, PE 21→20,5, PI 23→22,5, PR 20→19,5,
-- RO 20→19,5 e AL 20→20,5. Em SEIS delas o DIFAL saía SUPERESTIMADO (RJ por
-- 2 pontos inteiros). Enquanto a fonte fosse a folha antiga, todo pedido
-- interestadual para essas UFs produzia imposto plausível e errado. Ver D-R2-02.
--
-- POR QUE O FCP VIROU PARCELA PRÓPRIA (D-R2-03):
-- o desenho anterior (D-09) embutia o FCP no percentual e presumia 2 pp de FCP
-- no Rio de Janeiro — foi assim que 22% virou a "interna" do RJ. A planilha
-- oficial diz que a interna do RJ é 20 e NÃO tem coluna de FCP: a presunção era
-- falsa. Corrigir a interna sem separar o FCP só trocaria um erro por outro,
-- então o FCP passa a ser coluna própria, DEFAULT 0, preenchida apenas quando
-- uma fonte confirmar. Isto REVOGA o trecho do 222-RETRABALHO que mandava não
-- reintroduzir o FCP como componente separado, e a exceção deliberada de PB
-- deixa de ser exceção (a planilha já diz PB = 20, sem FCP).
--
-- POR QUE O PERCENTUAL DE DIFAL É DERIVADO NA FUNÇÃO, E NÃO ARMAZENADO:
--  1. a fonte entrega a INTERNA; guardar só a derivada jogaria fora a
--     rastreabilidade — a conferência contra a planilha vira célula a célula,
--     não 52 subtrações refeitas à mão a cada revisão de legislação;
--  2. D-R2-03 obriga a mexer no schema de qualquer forma (o FCP precisa de
--     coluna) — mexer uma vez, na origem, custa menos que mexer duas;
--  3. ninguém faz JOIN nesta tabela: os únicos leitores são esta migration, a
--     função `aliquota_interna_vigente` e, através dela, `tabelaUf.ts` e as
--     duas edge functions de escrita do imposto;
--  4. esta migration NUNCA foi aplicada (`to_regclass` nulo em 19/08/2026), e
--     é isso que torna a troca barata: `CREATE OR REPLACE FUNCTION` não muda a
--     lista de colunas de um `RETURNS TABLE`, e uma migration corretiva por
--     cima exigiria DROP FUNCTION — proibido pela regra da casa, porque apaga
--     a ACL. Corrigindo na origem, a função nasce uma vez, já com a assinatura
--     final;
--  5. sem coluna gerada: `GENERATED ALWAYS AS ... STORED` não tem um único
--     precedente neste repositório, e a derivação vive na função, que é código
--     igual ao resto;
--  6. a guarda de consistência fica mais FORTE: antes era indireta
--     (`interestadual + difal` tinha de fechar igual nas duas procedências),
--     agora é direta — `aliq_interna` tem de ser A MESMA para nacional e
--     importado da mesma UF.
--
-- POR QUE PROCEDÊNCIA É PARTE DA CHAVE:
-- produto importado sai a 4% de alíquota interestadual (Resolução SF 13/2012),
-- não 7%/12%. Como a interna do destino é a mesma, o DIFAL derivado é MAIOR na
-- procedência importado exatamente na diferença de alíquota interestadual, e o
-- total recolhido fecha igual. Tratar importado como nacional só erra quando a
-- UF não recolhe DIFAL — e aí erra por 8 pp de ICMS, para MAIS. Ver D-11.
--
-- POR QUE `confirmado_por` REGISTRA A FONTE:
-- o campo não é "um humano conferiu esta linha", e sim QUAL FONTE confirmou. A
-- guarda do computeOrderTax é a mesma de sempre — linha sem confirmação produz
-- DIFAL null, nunca zero.
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
  -- Alíquota INTERNA do destino — o número que a fonte oficial entrega, um por
  -- UF, idêntico nas duas procedências. O percentual de DIFAL não mora aqui:
  -- sai de `aliq_interna - aliq_interestadual` dentro da função de leitura.
  aliq_interna        numeric(6,4)  NOT NULL,
  -- Fundo de Combate à Pobreza — parcela PRÓPRIA (D-R2-03), nunca embutida na
  -- interna. Zero é o único valor honesto enquanto nenhuma fonte confirmar.
  fcp                 numeric(6,4)  NOT NULL DEFAULT 0,

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
  CONSTRAINT icms_uf_aliquotas_interna_faixa CHECK (
    aliq_interna >= 0 AND aliq_interna <= 40
  ),
  CONSTRAINT icms_uf_aliquotas_fcp_faixa CHECK (
    fcp >= 0 AND fcp <= 10
  ),
  -- É este CHECK que garante que a derivação nunca produz percentual negativo.
  -- Substitui, com mais força, o antigo CHECK de não-negatividade do percentual
  -- armazenado: lá a garantia era sobre o resultado já digitado; aqui é sobre
  -- as duas parcelas que o produzem.
  CONSTRAINT icms_uf_aliquotas_interna_ge_interestadual CHECK (
    aliq_interna >= aliq_interestadual
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

COMMENT ON COLUMN public.icms_uf_aliquotas.aliq_interna IS
  'Alíquota INTERNA de ICMS do estado de destino, como a planilha oficial da '
  'Pé Vermeio a entrega (D-R2-02). É UM número por UF: idêntico para nacional '
  'e importado — a procedência muda a alíquota interestadual, nunca a interna. '
  'O percentual de DIFAL não é armazenado; sai de aliq_interna - '
  'aliq_interestadual dentro de aliquota_interna_vigente(date).';
COMMENT ON COLUMN public.icms_uf_aliquotas.fcp IS
  'Fundo de Combate à Pobreza como parcela PRÓPRIA, padrão zero, preenchida só '
  'quando uma fonte confirmar (D-R2-03). Isto REVOGA o desenho de FCP embutido '
  'do 222-RETRABALHO (D-09), que presumia 2 pp em RJ — a planilha oficial diz '
  'que a interna do RJ é 20 e não tem coluna de FCP: era presunção errada.';
COMMENT ON COLUMN public.icms_uf_aliquotas.procedencia IS
  'nacional = interestadual 7%/12% por região. importado = 4% (Resolução SF '
  '13/2012). A soma aliq_interestadual + pct_difal é IGUAL nas duas — a '
  'diferença só aparece quando a UF não recolhe DIFAL, e aí são 8 pp de ICMS. '
  'Sem marcação de SKU, o consumidor usa nacional (D-11).';
COMMENT ON COLUMN public.icms_uf_aliquotas.confirmado_por IS
  'Qual FONTE confirmou esta linha (ex.: planilha_oficial_2026). NULL = '
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
-- A função é INVOKER, jamais DEFINER — regra da casa
-- (feedback_supabase_security_invoker): função DEFINER que lê tabela sob RLS
-- com parâmetro de org já causou IDOR neste repo.
--
-- Nome e formato do retorno visto por `tabelaUf.ts` preservados: `pct_difal`
-- continua CHEGANDO como campo, só deixa de ser armazenado — passa a ser a
-- expressão `aliq_interna - aliq_interestadual`, calculada aqui. `aliq_interna`
-- e `fcp` entram como campos novos do retorno.
CREATE OR REPLACE FUNCTION public.aliquota_interna_vigente(p_data date DEFAULT CURRENT_DATE)
RETURNS TABLE (
  uf                 char(2),
  procedencia        text,
  aliq_interestadual numeric,
  aliq_interna       numeric,
  pct_difal          numeric,
  fcp                numeric,
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
    t.aliq_interna,
    (t.aliq_interna - t.aliq_interestadual) AS pct_difal,
    t.fcp,
    (t.confirmado_por IS NOT NULL) AS confirmado
  FROM public.icms_uf_aliquotas t
  WHERE t.vigencia_inicio <= p_data
    AND (t.vigencia_fim IS NULL OR t.vigencia_fim > p_data);
$$;

GRANT EXECUTE ON FUNCTION public.aliquota_interna_vigente(date) TO authenticated;

-- ─── Seed: 26 UFs × 2 procedências = 52 linhas ──────────────────────────────
-- Fonte: planilha OFICIAL de precificação da Pé Vermeio, coluna de alíquota
-- interna por estado — validada 27/27 em 19/08/2026 contra o módulo fiscal
-- aprovado pela contadora.
--
-- SP NÃO entra: origem igual a destino é operação interna, sem DIFAL.
--
-- `aliq_interestadual` saindo de SP: 12 para MG, PR, RJ, RS e SC; 7 para todas
-- as demais na procedência nacional (ES entre as de 7); 4 em todas na
-- procedência importado (Resolução SF 13/2012).
--
-- `fcp` fica em 0 nas 52 linhas — nenhuma fonte confirmou FCP para nenhuma UF.
INSERT INTO public.icms_uf_aliquotas
  (uf, procedencia, vigencia_inicio, vigencia_fim, aliq_interestadual, aliq_interna, fcp, fonte, observacao)
VALUES
  -- ── Nacional (interestadual 12% em MG/PR/RJ/RS/SC; 7% nas demais) ──
  ('AC','nacional', DATE '2026-01-01', NULL,  7.0000, 19.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('AL','nacional', DATE '2026-01-01', NULL,  7.0000, 20.5000, 0.0000, 'planilha_oficial_2026', 'D-R2-02: interna corrigida de 20 para 20,5 — a folha antiga SUBestimava o DIFAL de AL em 0,5 pp.'),
  ('AM','nacional', DATE '2026-01-01', NULL,  7.0000, 20.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('AP','nacional', DATE '2026-01-01', NULL,  7.0000, 18.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('BA','nacional', DATE '2026-01-01', NULL,  7.0000, 20.5000, 0.0000, 'planilha_oficial_2026', 'D-R2-02: interna corrigida de 21 para 20,5 — a folha antiga superestimava o DIFAL de BA em 0,5 pp.'),
  ('CE','nacional', DATE '2026-01-01', NULL,  7.0000, 20.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('DF','nacional', DATE '2026-01-01', NULL,  7.0000, 20.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('ES','nacional', DATE '2026-01-01', NULL,  7.0000, 17.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('GO','nacional', DATE '2026-01-01', NULL,  7.0000, 19.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('MA','nacional', DATE '2026-01-01', NULL,  7.0000, 23.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('MT','nacional', DATE '2026-01-01', NULL,  7.0000, 17.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('MS','nacional', DATE '2026-01-01', NULL,  7.0000, 17.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('MG','nacional', DATE '2026-01-01', NULL, 12.0000, 18.0000, 0.0000, 'planilha_oficial_2026', 'Caso-prova da fase: pedido 2000017711929314, SP→MG. 18 − 12 = 6% de DIFAL — o número NÃO muda com D-R2-02.'),
  ('PA','nacional', DATE '2026-01-01', NULL,  7.0000, 19.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('PB','nacional', DATE '2026-01-01', NULL,  7.0000, 20.0000, 0.0000, 'planilha_oficial_2026', 'A exceção deliberada de PB deixou de ser exceção (D-R2-03): a planilha oficial já diz 20, sem FCP.'),
  ('PR','nacional', DATE '2026-01-01', NULL, 12.0000, 19.5000, 0.0000, 'planilha_oficial_2026', 'D-R2-02: interna corrigida de 20 para 19,5 — a folha antiga superestimava o DIFAL de PR em 0,5 pp.'),
  ('PE','nacional', DATE '2026-01-01', NULL,  7.0000, 20.5000, 0.0000, 'planilha_oficial_2026', 'D-R2-02: interna corrigida de 21 para 20,5 — a folha antiga superestimava o DIFAL de PE em 0,5 pp.'),
  ('PI','nacional', DATE '2026-01-01', NULL,  7.0000, 22.5000, 0.0000, 'planilha_oficial_2026', 'D-R2-02: interna corrigida de 23 para 22,5 — a folha antiga superestimava o DIFAL de PI em 0,5 pp.'),
  ('RN','nacional', DATE '2026-01-01', NULL,  7.0000, 20.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('RS','nacional', DATE '2026-01-01', NULL, 12.0000, 17.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('RJ','nacional', DATE '2026-01-01', NULL, 12.0000, 20.0000, 0.0000, 'planilha_oficial_2026', 'D-R2-02/D-R2-03: interna corrigida de 22 para 20 — os 2 pp a mais eram FCP presumido, e a planilha oficial diz que ele não existe. Era o maior erro da tabela.'),
  ('RO','nacional', DATE '2026-01-01', NULL,  7.0000, 19.5000, 0.0000, 'planilha_oficial_2026', 'D-R2-02: interna corrigida de 20 para 19,5 — a folha antiga superestimava o DIFAL de RO em 0,5 pp.'),
  ('RR','nacional', DATE '2026-01-01', NULL,  7.0000, 20.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('SC','nacional', DATE '2026-01-01', NULL, 12.0000, 17.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('SE','nacional', DATE '2026-01-01', NULL,  7.0000, 19.0000, 0.0000, 'planilha_oficial_2026', 'A correção de digitação de SE (D-09) virou caso particular da guarda das 26 internas: 19 − 7 = 12%, o mesmo valor.'),
  ('TO','nacional', DATE '2026-01-01', NULL,  7.0000, 20.0000, 0.0000, 'planilha_oficial_2026', 'A correção de digitação de TO (D-09) virou caso particular da guarda das 26 internas: 20 − 7 = 13%, o mesmo valor.'),

  -- ── Importado (interestadual 4% em todas — Resolução SF 13/2012) ──
  ('AC','importado', DATE '2026-01-01', NULL,  4.0000, 19.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('AL','importado', DATE '2026-01-01', NULL,  4.0000, 20.5000, 0.0000, 'planilha_oficial_2026', NULL),
  ('AM','importado', DATE '2026-01-01', NULL,  4.0000, 20.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('AP','importado', DATE '2026-01-01', NULL,  4.0000, 18.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('BA','importado', DATE '2026-01-01', NULL,  4.0000, 20.5000, 0.0000, 'planilha_oficial_2026', NULL),
  ('CE','importado', DATE '2026-01-01', NULL,  4.0000, 20.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('DF','importado', DATE '2026-01-01', NULL,  4.0000, 20.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('ES','importado', DATE '2026-01-01', NULL,  4.0000, 17.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('GO','importado', DATE '2026-01-01', NULL,  4.0000, 19.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('MA','importado', DATE '2026-01-01', NULL,  4.0000, 23.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('MT','importado', DATE '2026-01-01', NULL,  4.0000, 17.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('MS','importado', DATE '2026-01-01', NULL,  4.0000, 17.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('MG','importado', DATE '2026-01-01', NULL,  4.0000, 18.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('PA','importado', DATE '2026-01-01', NULL,  4.0000, 19.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('PB','importado', DATE '2026-01-01', NULL,  4.0000, 20.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('PR','importado', DATE '2026-01-01', NULL,  4.0000, 19.5000, 0.0000, 'planilha_oficial_2026', NULL),
  ('PE','importado', DATE '2026-01-01', NULL,  4.0000, 20.5000, 0.0000, 'planilha_oficial_2026', NULL),
  ('PI','importado', DATE '2026-01-01', NULL,  4.0000, 22.5000, 0.0000, 'planilha_oficial_2026', NULL),
  ('RN','importado', DATE '2026-01-01', NULL,  4.0000, 20.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('RS','importado', DATE '2026-01-01', NULL,  4.0000, 17.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('RJ','importado', DATE '2026-01-01', NULL,  4.0000, 20.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('RO','importado', DATE '2026-01-01', NULL,  4.0000, 19.5000, 0.0000, 'planilha_oficial_2026', NULL),
  ('RR','importado', DATE '2026-01-01', NULL,  4.0000, 20.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('SC','importado', DATE '2026-01-01', NULL,  4.0000, 17.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('SE','importado', DATE '2026-01-01', NULL,  4.0000, 19.0000, 0.0000, 'planilha_oficial_2026', NULL),
  ('TO','importado', DATE '2026-01-01', NULL,  4.0000, 20.0000, 0.0000, 'planilha_oficial_2026', NULL)
ON CONFLICT DO NOTHING;

-- A planilha oficial É a fonte de confirmação. O seed nasce confirmado — mas
-- por uma FONTE NOMEADA, nunca por ausência de conferência. A guarda do
-- computeOrderTax é a mesma: linha sem confirmado_por não produz DIFAL.
UPDATE public.icms_uf_aliquotas
   SET confirmado_por = 'planilha_oficial_2026',
       confirmado_em  = now()
 WHERE fonte = 'planilha_oficial_2026'
   AND confirmado_por IS NULL;

-- ─── Guardas finais: falha alto em vez de aplicar pela metade ────────────────
DO $$
DECLARE
  v_total            integer;
  v_inconsistentes   integer;
  v_cobertas         integer;
  v_com_fcp          integer;
  v_uf_divergente    text;
  v_interna_no_banco numeric;
  v_interna_oficial  numeric;
BEGIN
  -- (1) O seed tem de estar inteiro.
  SELECT count(*) INTO v_total
    FROM public.icms_uf_aliquotas
   WHERE fonte = 'planilha_oficial_2026';

  IF v_total <> 52 THEN
    RAISE EXCEPTION 'seed do DIFAL incompleto: esperava 52 linhas (26 UFs x 2 procedências), encontrei %', v_total;
  END IF;

  -- (2) A interna é propriedade do DESTINO, não da procedência: tem de ser
  -- idêntica para nacional e importado da mesma UF. É a versão direta da
  -- guarda que antes era feita pela soma `interestadual + difal`.
  SELECT count(*) INTO v_inconsistentes
    FROM (
      SELECT t.uf
        FROM public.icms_uf_aliquotas t
       WHERE t.vigencia_fim IS NULL
       GROUP BY t.uf
      HAVING count(DISTINCT t.aliq_interna) > 1
    ) x;

  IF v_inconsistentes > 0 THEN
    RAISE EXCEPTION 'seed inconsistente: % UF(s) com aliq_interna divergente entre nacional e importado — a alíquota interna é do destino, a procedência só muda a interestadual', v_inconsistentes;
  END IF;

  -- (3) SP não pode ter linha: origem = destino, operação interna, sem DIFAL.
  IF EXISTS (SELECT 1 FROM public.icms_uf_aliquotas WHERE uf = 'SP') THEN
    RAISE EXCEPTION 'SP não deve ter linha nesta tabela: origem igual a destino é operação interna, sem DIFAL';
  END IF;

  -- (4) As 26 internas, conferidas UMA A UMA contra a folha oficial escrita
  -- aqui dentro. Substitui a guarda pontual de SE/TO, que virou caso
  -- particular desta. Uma edição do seed que não passe também por esta lista
  -- falha alto, em vez de gerar imposto plausível e errado.
  WITH oficial (uf, interna) AS (
    VALUES
      ('AC', 19.0), ('AL', 20.5), ('AM', 20.0), ('AP', 18.0), ('BA', 20.5),
      ('CE', 20.0), ('DF', 20.0), ('ES', 17.0), ('GO', 19.0), ('MA', 23.0),
      ('MT', 17.0), ('MS', 17.0), ('MG', 18.0), ('PA', 19.0), ('PB', 20.0),
      ('PR', 19.5), ('PE', 20.5), ('PI', 22.5), ('RN', 20.0), ('RS', 17.0),
      ('RJ', 20.0), ('RO', 19.5), ('RR', 20.0), ('SC', 17.0), ('SE', 19.0),
      ('TO', 20.0)
  )
  SELECT count(*) INTO v_cobertas
    FROM public.icms_uf_aliquotas t
    JOIN oficial o ON o.uf = t.uf
   WHERE t.vigencia_fim IS NULL;

  IF v_cobertas <> 52 THEN
    RAISE EXCEPTION 'a folha oficial das 26 UFs não cobre o seed: casei % linhas de 52 — alguma UF do seed não está na lista oficial (ou vice-versa)', v_cobertas;
  END IF;

  WITH oficial (uf, interna) AS (
    VALUES
      ('AC', 19.0), ('AL', 20.5), ('AM', 20.0), ('AP', 18.0), ('BA', 20.5),
      ('CE', 20.0), ('DF', 20.0), ('ES', 17.0), ('GO', 19.0), ('MA', 23.0),
      ('MT', 17.0), ('MS', 17.0), ('MG', 18.0), ('PA', 19.0), ('PB', 20.0),
      ('PR', 19.5), ('PE', 20.5), ('PI', 22.5), ('RN', 20.0), ('RS', 17.0),
      ('RJ', 20.0), ('RO', 19.5), ('RR', 20.0), ('SC', 17.0), ('SE', 19.0),
      ('TO', 20.0)
  )
  SELECT t.uf, t.aliq_interna, o.interna
    INTO v_uf_divergente, v_interna_no_banco, v_interna_oficial
    FROM public.icms_uf_aliquotas t
    JOIN oficial o ON o.uf = t.uf
   WHERE t.vigencia_fim IS NULL
     AND t.aliq_interna <> o.interna
   ORDER BY t.uf
   LIMIT 1;

  IF v_uf_divergente IS NOT NULL THEN
    RAISE EXCEPTION 'alíquota interna fora da folha oficial: % está com %, a folha diz %', v_uf_divergente, v_interna_no_banco, v_interna_oficial;
  END IF;

  -- (5) Nenhum FCP diferente de zero no seed inicial: enquanto nenhuma fonte
  -- confirmar um FCP, zero é o único valor honesto (D-R2-03).
  SELECT count(*) INTO v_com_fcp
    FROM public.icms_uf_aliquotas
   WHERE fonte = 'planilha_oficial_2026'
     AND fcp <> 0;

  IF v_com_fcp > 0 THEN
    RAISE EXCEPTION 'o seed inicial não pode nascer com FCP: % linha(s) com fcp diferente de zero, e nenhuma fonte confirmou FCP para UF nenhuma', v_com_fcp;
  END IF;
END $$;
