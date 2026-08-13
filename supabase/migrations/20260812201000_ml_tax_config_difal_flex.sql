-- Config por loja ML: UFs recolhidas, UFs cobradas pelo ML e custo de
-- entrega Flex (Fase 222, FISC-04, FISC-07, FLEX-04).
--
-- ALTER TABLE simples com IF NOT EXISTS: nenhum DROP, nenhuma alteração de
-- coluna existente, nenhum toque no trigger de cálculo de alíquota efetiva
-- nem na coluna que ele carimba (é o preview de catálogo, fora do escopo
-- desta fase).
ALTER TABLE public.ml_tax_config
  ADD COLUMN IF NOT EXISTS difal_ufs_recolhidas text[] NULL,
  ADD COLUMN IF NOT EXISTS difal_ufs_cobradas_pelo_ml text[] NULL,
  ADD COLUMN IF NOT EXISTS flex_custo_entrega numeric(10,2) NULL;

-- ─── Semântica de três estados, escrita no próprio banco ─────────────────────
-- Isto é a parte que ninguém consegue adivinhar depois — quem consultar a
-- coluna daqui a um ano precisa achar a regra aqui, não em código que pode
-- ter mudado.

COMMENT ON COLUMN public.ml_tax_config.difal_ufs_recolhidas IS
  'UFs que ESTA loja recolhe DIFAL por conta própria (decisão D-02 do '
  '222-CONTEXT.md). Semântica de três estados: NULL = régua ainda não '
  'configurada, e então o cenário "com DIFAL" usa o DIFAL devido integral '
  '(teto conservador, coerente com a medição de que o MCO de hoje está '
  'otimista em ~4,2pp). Array vazio = a loja declarou explicitamente que não '
  'recolhe nenhuma UF. Array com siglas = só essas entram no cenário "com '
  'DIFAL". NULL e array vazio NÃO são a mesma coisa — mesma lição do frete '
  'zero que virou NULL e apagou 13,2% dos pedidos do Junior (Fase 219).';

COMMENT ON COLUMN public.ml_tax_config.difal_ufs_cobradas_pelo_ml IS
  'UFs em que o próprio Mercado Livre já recolhe e cobra o DIFAL na fatura '
  '(conceito CDIFAL, decisão D-07 do 222-CONTEXT.md — medido: R$ 7.458,82 em '
  '89 lançamentos, mar-ago/2026, só na Pé Vermeio). Semântica de três '
  'estados: NULL = o cruzamento fatura↔pedidos ainda não foi feito, e então '
  'NENHUM pedido é marcado como cobrado e o valor da fatura NÃO pode ser '
  'somado ao calculado (seria contagem dupla — o erro que esta fase existe '
  'para não cometer). Array vazio = cruzamento feito e nenhuma UF é cobrada '
  'pelo ML. Array com siglas = nesses destinos o valor que vale é o COBRADO '
  '(fato, orders.difal_fonte), e o calculado do pedido fica como previsão '
  'informativa, nunca somado ao cobrado no mesmo pedido. Consumido por '
  'orders.difal_fonte (planos 222-03/222-05) e get_difal_summary (222-07).';

COMMENT ON COLUMN public.ml_tax_config.flex_custo_entrega IS
  'Custo de uma entrega própria de Flex, em reais por entrega (decisão '
  'FLEX-04 do ROADMAP). NULL significa "o dono da conta ainda não '
  'informou" — enquanto for NULL, o MCO do pedido Flex fica declaradamente '
  'inflado: a saída nomeia essa ausência, nunca inventa um número no lugar '
  '(Deferred Ideas do 222-CONTEXT.md). Copiado para orders.custo_entrega no '
  'momento do sync (plano 222-04). Nunca tratar NULL como zero.';

-- ─── CHECKs de sigla válida nos dois arrays ───────────────────────────────────
-- NOT VALID para não travar linhas existentes (as colunas nascem NULL em
-- todas as linhas já cadastradas, então a validação futura não teria nada
-- para reprovar, mas NOT VALID evita a varredura de validação imediata).
ALTER TABLE public.ml_tax_config
  ADD CONSTRAINT ml_tax_config_difal_ufs_recolhidas_validas CHECK (
    difal_ufs_recolhidas IS NULL
    OR difal_ufs_recolhidas <@ ARRAY[
      'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
      'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'
    ]::text[]
  ) NOT VALID;

ALTER TABLE public.ml_tax_config
  ADD CONSTRAINT ml_tax_config_difal_ufs_cobradas_pelo_ml_validas CHECK (
    difal_ufs_cobradas_pelo_ml IS NULL
    OR difal_ufs_cobradas_pelo_ml <@ ARRAY[
      'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
      'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'
    ]::text[]
  ) NOT VALID;

ALTER TABLE public.ml_tax_config
  ADD CONSTRAINT ml_tax_config_flex_custo_entrega_nao_negativo CHECK (
    flex_custo_entrega IS NULL OR flex_custo_entrega >= 0
  ) NOT VALID;

-- ─── Guarda final: falha alto em vez de aplicar pela metade ──────────────────
DO $$
DECLARE
  v_faltando text[] := ARRAY[]::text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'ml_tax_config'
       AND column_name = 'difal_ufs_recolhidas'
  ) THEN
    v_faltando := v_faltando || 'difal_ufs_recolhidas';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'ml_tax_config'
       AND column_name = 'difal_ufs_cobradas_pelo_ml'
  ) THEN
    v_faltando := v_faltando || 'difal_ufs_cobradas_pelo_ml';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'ml_tax_config'
       AND column_name = 'flex_custo_entrega'
  ) THEN
    v_faltando := v_faltando || 'flex_custo_entrega';
  END IF;

  IF array_length(v_faltando, 1) > 0 THEN
    RAISE EXCEPTION 'coluna(s) nao criada(s) em ml_tax_config: %', array_to_string(v_faltando, ', ');
  END IF;
END $$;
