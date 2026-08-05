-- ============================================================================
-- Sync de pedidos: o dia CORRENTE também precisa entrar.
--
-- O PROBLEMA, medido em 2026-08-05:
--
-- `dispatch_orders_jobs()` despachava só `CURRENT_DATE - 1`, e o cron rodava
-- uma vez por dia às 09:00 UTC. Consequência: durante TODO o dia de hoje, as
-- telas de receita mostravam o dia corrente vazio ou pela metade — e sem dizer
-- que estava pela metade.
--
-- Foi o que aconteceu em 04/08: o Wesley vendeu R$ 19.040,25 e a tela mostrava
-- R$ 13-14 mil. Não era cálculo errado; era dado incompleto apresentado como
-- final, que é pior, porque parece certo.
--
-- Aumentar só a frequência do cron não resolveria: rodaria de hora em hora
-- buscando ontem de novo.
--
-- O DESENHO:
--   · `p_incluir_hoje = true`  -> despacha HOJE. É o que o cron horário chama.
--   · `p_incluir_hoje = false` -> despacha ONTEM. Continua rodando 1x/dia como
--     varredura de fechamento: captura o que mudou depois da meia-noite
--     (aprovação tardia, cancelamento, mudança de status).
--
-- A guarda de duplicidade original é preservada: um job pending/running para o
-- mesmo (seller, tipo, data) impede o enfileiramento de outro. Sem ela, o cron
-- horário empilharia jobs de um dia que ainda está sendo processado.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dispatch_orders_jobs(p_incluir_hoje boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r    RECORD;
  alvo date := CASE WHEN p_incluir_hoje THEN CURRENT_DATE ELSE CURRENT_DATE - 1 END;
BEGIN
  FOR r IN
    SELECT DISTINCT ml_user_id, organization_id
    FROM public.ml_tokens
    WHERE access_token IS NOT NULL
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.sync_jobs
      WHERE ml_user_id = r.ml_user_id
        AND job_type   = 'orders'
        AND date_from  = alvo
        AND status IN ('pending', 'running')
    ) THEN
      INSERT INTO public.sync_jobs (ml_user_id, organization_id, job_type, status, date_from, date_to)
      VALUES (r.ml_user_id, r.organization_id, 'orders', 'pending', alvo, alvo);
    END IF;
  END LOOP;
END;
$function$;

-- Disciplina de privilégio: SECURITY DEFINER precisa de REVOKE explícito.
REVOKE ALL ON FUNCTION public.dispatch_orders_jobs(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dispatch_orders_jobs(boolean) FROM anon;
REVOKE ALL ON FUNCTION public.dispatch_orders_jobs(boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_orders_jobs(boolean) TO service_role;

-- ============================================================================
-- Frescor dos pedidos: a tela precisa poder dizer "até que horas isto vale".
--
-- A pergunta certa não é "tem dado?", é "o dado está fechado?". O smoke da
-- fase 208 passava com dado velho justamente por perguntar a primeira.
-- ============================================================================

CREATE OR REPLACE VIEW public.orders_sync_health AS
SELECT
  o.organization_id,
  MAX(o.synced_at)                                    AS ultimo_sync,
  MAX(o.data_pedido)                                  AS pedido_mais_recente,
  -- O dia corrente é parcial por natureza até o fim do dia. A tela usa isto
  -- para avisar em vez de apresentar um recorte como total.
  (MAX(o.synced_at) < now() - interval '2 hours')     AS sync_atrasado,
  COUNT(*) FILTER (
    WHERE LEFT(o.data_pedido, 10) = CURRENT_DATE::text
  )                                                   AS pedidos_hoje
FROM public.orders o
GROUP BY o.organization_id;

REVOKE ALL ON public.orders_sync_health FROM PUBLIC;
REVOKE ALL ON public.orders_sync_health FROM anon;
GRANT SELECT ON public.orders_sync_health TO authenticated;
GRANT SELECT ON public.orders_sync_health TO service_role;
