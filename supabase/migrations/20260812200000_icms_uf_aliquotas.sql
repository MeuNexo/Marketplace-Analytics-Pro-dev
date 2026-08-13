-- Alíquota interna de ICMS e FCP por UF (Fase 222, FISC-03).
--
-- POR QUE ALÍQUOTA INTERNA E FCP SÃO COLUNAS SEPARADAS, SEMPRE:
-- duas fontes secundárias (agregadores de NFe, não SEFAZ/CONFAZ) foram cruzadas
-- no 222-RESEARCH.md (seção R3) e DIVERGEM entre si em 4 das 27 UFs (AL, PB, RJ,
-- SE) exatamente sobre se o FCP já está embutido no "número principal" ou é
-- somado à parte. Guardar um "número final" único herdaria essa ambiguidade
-- para sempre — é o Pitfall 4 do RESEARCH: "o valor sai plausível, só está
-- errado", e erra o DIFAL de um estado inteiro em silêncio. Por isso
-- `aliq_interna` é SEMPRE a alíquota sem o adicional de fundo de combate à
-- pobreza, e `aliq_fcp` é SEMPRE o adicional em coluna própria — nunca somados
-- para formar um terceiro valor persistido.
--
-- POR QUE A TABELA NASCE INTEIRA SEM CONFIRMAÇÃO HUMANA:
-- o seed vem de uma fonte não oficial (agregador de NFe). A Fase 220 já provou
-- que régua fiscal errada não grita — produz um número plausível
-- (`destino desconhecido` virando a alíquota intraestadual, a mais alta, por
-- 39 dos 45 pedidos de um dia inteiro, sem nenhum sinal visível). Aqui o raio
-- de dano é maior: um estado inteiro, não um pedido. Por isso o seed nasce com
-- `confirmado_por`/`confirmado_em` NULOS em todas as 27 linhas, por desenho —
-- é o que faz a guarda funcionar: o consumidor desta tabela (`computeOrderTax`,
-- plano 222-03) devolve DIFAL `null`, nunca zero nem um valor calculado, para
-- toda UF cuja linha não tiver confirmação humana registrada.
--
-- POR QUE É VERSIONADA POR VIGÊNCIA:
-- alíquota estadual muda por lei, não por decisão do sistema. 2024-2026 já
-- teve reajuste em vários estados (as duas fontes do R3 concordam nisso).
-- Uma tabela sem vigência exigiria UPDATE destrutivo a cada mudança de lei,
-- perdendo o valor histórico que já foi aplicado a pedidos passados.
--
-- Claude's Discretion do 222-CONTEXT.md: "versionada por vigência, auditável
-- e datada" — decisão deste plano.

-- ─── Extensão para a garantia de vigência sem sobreposição ──────────────────
-- btree_gist habilita EXCLUDE USING gist com igualdade (uf) + faixa
-- (daterange). Se a extensão não puder ser criada neste projeto, o índice
-- único parcial abaixo (fallback) garante uma vigência ATUAL por UF, mas não
-- impede sobreposição de vigências históricas — comentado no próprio índice.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ─── Tabela ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.icms_uf_aliquotas (
  id               uuid          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  uf               char(2)       NOT NULL,
  vigencia_inicio  date          NOT NULL,
  vigencia_fim     date          NULL,  -- null = vigente até segunda ordem

  -- Alíquota interna do ICMS do destino, SEM o adicional de FCP.
  aliq_interna     numeric(6,4)  NOT NULL,
  -- Adicional de Fundo de Combate à Pobreza, SEMPRE em coluna própria —
  -- nunca somado a aliq_interna para formar um terceiro valor persistido.
  aliq_fcp         numeric(6,4)  NOT NULL DEFAULT 0,

  fonte            text          NOT NULL,  -- de onde o número veio; obrigatória
  observacao       text          NULL,      -- usada para registrar divergência entre fontes

  confirmado_por   text          NULL,
  confirmado_em    timestamptz   NULL,

  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT icms_uf_aliquotas_uf_valida CHECK (
    uf IN ('AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
           'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO')
  ),
  CONSTRAINT icms_uf_aliquotas_aliq_interna_faixa CHECK (
    aliq_interna >= 0 AND aliq_interna <= 40
  ),
  CONSTRAINT icms_uf_aliquotas_aliq_fcp_faixa CHECK (
    aliq_fcp >= 0 AND aliq_fcp <= 5
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
  'Alíquota interna de ICMS do destino, SEM o adicional de FCP. Nunca somar '
  'com aliq_fcp para formar um terceiro valor — as duas fontes secundárias '
  'cruzadas no 222-RESEARCH.md (R3) divergem exatamente sobre isso em 4 UFs '
  '(AL, PB, RJ, SE).';
COMMENT ON COLUMN public.icms_uf_aliquotas.aliq_fcp IS
  'Adicional de Fundo de Combate à Pobreza do destino, SEMPRE em coluna '
  'própria. Em vários estados o FCP só incide sobre categorias específicas '
  '(bebida, fumo, cosmético, supérfluo) — para o catálogo de moda/vestuário '
  'da Pé Vermeio o valor correto pode ser zero mesmo em UF que "tem FCP" '
  'cadastrado. Ver 222-UF-TABELA.md.';
COMMENT ON COLUMN public.icms_uf_aliquotas.confirmado_por IS
  'NULL = linha NÃO confirmada por um humano. O seed inicial desta tabela '
  'nasce inteiro com este campo nulo, por desenho — enquanto nulo, o módulo '
  'de cálculo (computeOrderTax, plano 222-03) devolve DIFAL null para a UF, '
  'nunca um valor calculado. Preencher só depois que o contador do Wesley '
  'confirmar a linha na folha 222-UF-TABELA.md.';

-- ─── Garantia de uma só vigência por UF (sem sobreposição) ───────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    ALTER TABLE public.icms_uf_aliquotas
      ADD CONSTRAINT icms_uf_aliquotas_sem_sobreposicao
      EXCLUDE USING gist (
        uf WITH =,
        daterange(vigencia_inicio, COALESCE(vigencia_fim, 'infinity'::date), '[)') WITH &&
      );
  ELSE
    -- Fallback mais fraco: garante só que existe no máximo UMA vigência ATUAL
    -- (vigencia_fim IS NULL) por UF. Não impede sobreposição entre vigências
    -- históricas encerradas — btree_gist ausente neste projeto.
    CREATE UNIQUE INDEX IF NOT EXISTS icms_uf_aliquotas_uma_vigente_por_uf
      ON public.icms_uf_aliquotas (uf)
      WHERE vigencia_fim IS NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS icms_uf_aliquotas_uf_idx
  ON public.icms_uf_aliquotas (uf);

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

CREATE TRIGGER icms_uf_aliquotas_updated_at
  BEFORE UPDATE ON public.icms_uf_aliquotas
  FOR EACH ROW
  EXECUTE FUNCTION public.icms_uf_aliquotas_stamp_updated_at();

-- ─── RLS — ligada na MESMA migration que cria a tabela, nunca depois ─────────
-- Regra da casa (feedback_tabela_de_execucao_nasce_sem_rls): tabela criada
-- fora deste padrão já nasceu aberta para `anon` nesta base antes (3 tabelas
-- da Fase 214, corrigidas depois — chave pública, escrita liberada). Não
-- repetir aqui.
ALTER TABLE public.icms_uf_aliquotas ENABLE ROW LEVEL SECURITY;

-- É dado público de legislação estadual, não tem tenant — qualquer usuário
-- autenticado pode ler.
CREATE POLICY "icms_uf_aliquotas select"
  ON public.icms_uf_aliquotas FOR SELECT TO authenticated
  USING (true);

-- Nenhuma policy de INSERT/UPDATE/DELETE: escrita fica exclusiva de
-- service_role, que ignora RLS. Alterar alíquota exige acesso de serviço,
-- não sessão de usuário comum.

REVOKE ALL ON public.icms_uf_aliquotas FROM anon;
GRANT SELECT ON public.icms_uf_aliquotas TO authenticated;

-- ─── Função de leitura vigente ────────────────────────────────────────────
-- SECURITY INVOKER é obrigatório — regra da casa (feedback_supabase_security_
-- invoker): função SECURITY DEFINER que lê tabela sob RLS com parâmetro de
-- org já causou IDOR neste repo. Esta função não tem parâmetro de tenant
-- (dado é público), mas a regra vale por padrão.
CREATE OR REPLACE FUNCTION public.aliquota_interna_vigente(p_data date DEFAULT CURRENT_DATE)
RETURNS TABLE (
  uf             char(2),
  aliq_interna   numeric,
  aliq_fcp       numeric,
  confirmado     boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    t.uf,
    t.aliq_interna,
    t.aliq_fcp,
    (t.confirmado_por IS NOT NULL) AS confirmado
  FROM public.icms_uf_aliquotas t
  WHERE t.vigencia_inicio <= p_data
    AND (t.vigencia_fim IS NULL OR t.vigencia_fim > p_data);
$$;

GRANT EXECUTE ON FUNCTION public.aliquota_interna_vigente(date) TO authenticated;

-- ─── Seed das 27 UFs — Fonte A do 222-RESEARCH.md (R3), NÃO CONFIRMADO ───────
-- vigencia_inicio = 2026-01-01, vigencia_fim = NULL (vigente até segunda
-- ordem). confirmado_por/confirmado_em deixados NULOS deliberadamente — não
-- preencher, nunca, neste seed. Para AL/PB/RJ/SE a `observacao` nomeia a
-- divergência exata contra a Fonte B (ver 222-RESEARCH.md R3 e
-- 222-UF-TABELA.md).
INSERT INTO public.icms_uf_aliquotas
  (uf, vigencia_inicio, vigencia_fim, aliq_interna, aliq_fcp, fonte, observacao)
VALUES
  ('AC', DATE '2026-01-01', NULL, 19.0000, 0, 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL', NULL),
  ('AL', DATE '2026-01-01', NULL, 19.0000, 1.0000, 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL',
    'Fonte A: 19% + FCP 1%. Fonte B (simtax.com.br): 20,5% sem citar FCP. A diferença (1,5pp) não bate exatamente com o FCP de 1% da Fonte A — caso inconclusivo, ver 222-UF-TABELA.md.'),
  ('AM', DATE '2026-01-01', NULL, 20.0000, 0, 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL', NULL),
  ('AP', DATE '2026-01-01', NULL, 18.0000, 0, 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL', NULL),
  ('BA', DATE '2026-01-01', NULL, 20.5000, 0, 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL', NULL),
  ('CE', DATE '2026-01-01', NULL, 20.0000, 0, 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL', NULL),
  ('DF', DATE '2026-01-01', NULL, 20.0000, 0, 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL', NULL),
  ('ES', DATE '2026-01-01', NULL, 17.0000, 0, 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL', NULL),
  ('GO', DATE '2026-01-01', NULL, 19.0000, 0, 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL', NULL),
  ('MA', DATE '2026-01-01', NULL, 23.0000, 0, 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL', NULL),
  ('MG', DATE '2026-01-01', NULL, 18.0000, 0, 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL', NULL),
  ('MS', DATE '2026-01-01', NULL, 17.0000, 0, 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL', NULL),
  ('MT', DATE '2026-01-01', NULL, 17.0000, 0, 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL', NULL),
  ('PA', DATE '2026-01-01', NULL, 19.0000, 0, 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL', NULL),
  ('PB', DATE '2026-01-01', NULL, 20.0000, 2.0000, 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL',
    'Fonte A: 20% + FCP 2% (à parte). Fonte B (simtax.com.br): 20,00% sem mencionar FCP — ambíguo se os 2% de FCP já estão incluídos no 20% da Fonte B ou se somam por cima. Ver 222-UF-TABELA.md.'),
  ('PE', DATE '2026-01-01', NULL, 20.5000, 0, 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL', NULL),
  ('PI', DATE '2026-01-01', NULL, 22.5000, 0, 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL', NULL),
  ('PR', DATE '2026-01-01', NULL, 19.5000, 0, 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL', NULL),
  ('RJ', DATE '2026-01-01', NULL, 20.0000, 2.0000, 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL',
    'Fonte A: 20% + FCP 2% (à parte). Fonte B (simtax.com.br): 22,00% — bate exatamente com 20+2, forte hipótese de que a Fonte B já soma o FCP dentro do número informado. Ver 222-UF-TABELA.md.'),
  ('RN', DATE '2026-01-01', NULL, 20.0000, 0, 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL', NULL),
  ('RO', DATE '2026-01-01', NULL, 19.5000, 0, 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL', NULL),
  ('RR', DATE '2026-01-01', NULL, 20.0000, 0, 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL', NULL),
  ('RS', DATE '2026-01-01', NULL, 17.0000, 0, 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL', NULL),
  ('SC', DATE '2026-01-01', NULL, 17.0000, 0, 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL', NULL),
  ('SE', DATE '2026-01-01', NULL, 19.0000, 1.0000, 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL',
    'Fonte A: 19% + FCP 1% (à parte). Fonte B (simtax.com.br): 20,00% — bate exatamente com 19+1, forte hipótese de que a Fonte B já soma o FCP dentro do número informado. Ver 222-UF-TABELA.md.'),
  ('SP', DATE '2026-01-01', NULL, 18.0000, 0, 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL', NULL),
  ('TO', DATE '2026-01-01', NULL, 20.0000, 0, 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL', NULL)
ON CONFLICT DO NOTHING;

-- ─── Guarda final: falha alto em vez de aplicar pela metade ──────────────────
-- Melhor não aplicar do que aplicar pela metade (mesmo padrão da migration
-- 20260806233000_batch_upsert_orders_preserva_imposto.sql).
DO $$
DECLARE
  v_total       integer;
  v_confirmadas integer;
BEGIN
  SELECT count(*) INTO v_total
    FROM public.icms_uf_aliquotas
   WHERE fonte = 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL';

  IF v_total <> 27 THEN
    RAISE EXCEPTION 'seed das UFs incompleto: esperava 27 linhas, encontrei %', v_total;
  END IF;

  SELECT count(*) INTO v_confirmadas
    FROM public.icms_uf_aliquotas
   WHERE fonte = 'agregador NFe (R3 do 222-RESEARCH.md) — NAO OFICIAL'
     AND confirmado_por IS NOT NULL;

  IF v_confirmadas <> 0 THEN
    RAISE EXCEPTION 'seed das UFs veio com % linha(s) já confirmada(s) — o seed tem que nascer inteiro sem confirmação humana, por desenho', v_confirmadas;
  END IF;
END $$;
