-- ============================================================================
-- Fase 211, critério 5: falha de sync de billing deixa de ser silenciosa.
--
-- O PROBLEMA, medido em 2026-08-05:
--
-- `sync-ml-billing` responde **HTTP 202 {"success":true,"status":"enqueued"}`
-- ANTES de fazer o trabalho — o corpo roda em `EdgeRuntime.waitUntil`. E
-- `resync_billing_daily_current_month()` dispara a chamada sem nunca olhar a
-- resposta. Resultado: uma conta pode falhar por semanas e o sistema inteiro
-- responde "sucesso".
--
-- Foi o que aconteceu. Medido nesta data, desde 31/07:
--   · Pé Vermeio ... 5 dias de PADS, até 04/08, 122 linhas
--   · Junior ....... 2 dias de PADS, para em 03/08, 26 linhas
--   · Thales ....... ZERO dias de PADS, 1 linha no total
--
-- Nenhum alarme. Nenhum log lido. O `results` com ok/erro por conta JÁ existe
-- dentro da EF — só era descartado.
--
-- Esta tabela dá a ele um lugar para pousar. Não muda o fluxo do sync: muda o
-- fato de a falha existir por escrito.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ml_billing_sync_state (
  organization_id  uuid        REFERENCES public.organizations(id) ON DELETE CASCADE,
  ml_user_id       text        NOT NULL,
  period_month     text,
  -- Toda tentativa atualiza `ultima_tentativa`. Só a que deu certo mexe em
  -- `ultimo_sucesso` — a distância entre as duas É o alarme.
  ultima_tentativa timestamptz NOT NULL DEFAULT now(),
  ultimo_sucesso   timestamptz,
  ok               boolean     NOT NULL DEFAULT false,
  linhas           integer     NOT NULL DEFAULT 0,
  erro             text,
  PRIMARY KEY (ml_user_id)
);

ALTER TABLE public.ml_billing_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing sync state select"
  ON public.ml_billing_sync_state FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND public.is_org_member(auth.uid(), organization_id));

-- Escrita é da Edge Function com service_role. Nenhum usuário autenticado grava.

-- ============================================================================
-- A view que responde "alguma conta parou de sincronizar?" numa linha.
-- ============================================================================

CREATE OR REPLACE VIEW public.ml_billing_sync_health AS
SELECT
  s.organization_id,
  o.name AS organizacao,
  s.ml_user_id,
  s.ultima_tentativa,
  s.ultimo_sucesso,
  s.ok,
  s.linhas,
  s.erro,
  -- Duas formas de estar quebrado, e elas são diferentes:
  --   · nunca teve sucesso  -> nasceu quebrado, ninguém percebeu
  --   · teve e parou        -> quebrou em algum momento, ninguém percebeu
  (s.ultimo_sucesso IS NULL)                                        AS nunca_sincronizou,
  (s.ultimo_sucesso IS NOT NULL
     AND s.ultimo_sucesso < now() - interval '48 hours')            AS parado_ha_mais_de_48h,
  (s.ultimo_sucesso IS NULL
     OR s.ultimo_sucesso < now() - interval '48 hours')             AS precisa_atencao
FROM public.ml_billing_sync_state s
LEFT JOIN public.organizations o ON o.id = s.organization_id;

REVOKE ALL ON public.ml_billing_sync_health FROM PUBLIC;
REVOKE ALL ON public.ml_billing_sync_health FROM anon;
GRANT SELECT ON public.ml_billing_sync_health TO authenticated;
GRANT SELECT ON public.ml_billing_sync_health TO service_role;
