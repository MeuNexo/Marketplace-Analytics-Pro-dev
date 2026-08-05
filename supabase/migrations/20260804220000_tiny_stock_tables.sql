-- ============================================================================
-- Fase 214 — Task 2: tabelas de catalogo, estoque por deposito e cursor
--
-- Alimentam a reposicao como fonte unica de compras. Hoje a tela ve 86 de 681
-- SKUs porque a RPC nasce de `ml_inventory_cache WHERE status='active'`: item
-- sem anuncio some, inclusive o que pausou sozinho por ruptura. Estas tabelas
-- trazem o catalogo do Tiny inteiro e o estoque por deposito.
--
-- CHAVE POR tiny_id, NAO POR sku. Medido em 2026-08-04 contra a API do Tiny
-- (docs/superpowers/plans/tiny-shape-medicao.md, achado 4): o SKU
-- `K6CBS2345SORG3` tem DOIS registros, um com saldo 337 e outro com -1.
-- Chavear por sku faria a varredura gravar 337 ou -1 conforme a ordem das
-- paginas. O dado bruto fica fiel aqui; o desempate D-7 (vence o de maior
-- saldo) e aplicado na LEITURA, na RPC da Task 7.
-- ============================================================================

-- Catalogo do Tiny: todo SKU, tenha ou nao anuncio no ML.
CREATE TABLE IF NOT EXISTS public.tiny_products (
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ml_user_id      text        NOT NULL,
  tiny_id         text        NOT NULL,
  sku             text        NOT NULL,
  nome            text,
  situacao        text,
  -- 'P' (pai), 'V' (variacao) ou 'N'. Medido: os tres existem, e ~84% do
  -- catalogo e 'V'. A varredura NUNCA filtra por 'P' -- e na variacao que
  -- vive o SKU da operacao (ex.: 11011273-PTO3360G).
  tipo_variacao   text,
  synced_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, tiny_id)
);

CREATE INDEX IF NOT EXISTS tiny_products_org_idx
  ON public.tiny_products (organization_id);

-- Busca por SKU nao e mais servida pela PK: precisa de indice proprio.
CREATE INDEX IF NOT EXISTS tiny_products_org_sku_idx
  ON public.tiny_products (organization_id, sku);

-- Estoque por deposito. Uma linha por (tiny_id, deposito).
-- Os quatro depositos medidos: 'CD Expedição', 'Centro de distribuição',
-- 'Magazine Luiza Fullfilment' (desconsiderar=true, descartado na extracao) e
-- 'Mercado Livre Fullfilment' (fora do calculo por D-2: o Full vem do ML).
CREATE TABLE IF NOT EXISTS public.tiny_stock (
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ml_user_id      text        NOT NULL,
  tiny_id         text        NOT NULL,
  sku             text        NOT NULL,
  deposito        text        NOT NULL,
  -- Guardados crus, negativos inclusive (medidos: disponivel -1 e -20).
  -- O piso em zero (D-6) e aplicado na leitura, nao aqui: a tabela nao mente
  -- sobre o que a origem respondeu.
  saldo           numeric     NOT NULL DEFAULT 0,
  disponivel      numeric     NOT NULL DEFAULT 0,
  synced_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, tiny_id, deposito)
);

CREATE INDEX IF NOT EXISTS tiny_stock_org_sku_idx
  ON public.tiny_stock (organization_id, sku);

-- Cursor da varredura. Uma linha por (organization_id, ml_user_id).
-- A volta so reinicia depois de FECHAR por inteiro -- nunca por virada de
-- data. O sync equivalente do nexo-mcp reseta com `snapshot_date <> today` e
-- por isso cobre ~15% do catalogo e nunca fecha uma volta.
CREATE TABLE IF NOT EXISTS public.tiny_sync_cursor (
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ml_user_id       text        NOT NULL,
  fase             text        NOT NULL DEFAULT 'catalogo',
  fila             jsonb       NOT NULL DEFAULT '[]',
  indice           integer     NOT NULL DEFAULT 0,
  volta_iniciada   timestamptz,
  volta_completa   timestamptz,
  erros            integer     NOT NULL DEFAULT 0,
  ultimo_erro      text,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, ml_user_id)
);

ALTER TABLE public.tiny_products    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiny_stock       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiny_sync_cursor ENABLE ROW LEVEL SECURITY;

-- Leitura: apenas membros da organizacao dona da linha.
-- Sem policy de INSERT/UPDATE/DELETE de proposito: quem escreve e a Edge
-- Function com service_role, que passa por cima da RLS. Nenhum usuario
-- autenticado escreve nestas tabelas.
CREATE POLICY "tiny_products select"
  ON public.tiny_products FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "tiny_stock select"
  ON public.tiny_stock FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "tiny_sync_cursor select"
  ON public.tiny_sync_cursor FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));
