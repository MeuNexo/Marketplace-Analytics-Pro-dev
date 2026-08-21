/**
 * snapshot-cashflow-forecast — job diário (CASH-224-06 / ERR-02)
 * Congela, uma vez por dia, o que public.get_cashflow está dizendo — para
 * que a curva de erro deixe de depender de uma reconstrução por created_at.
 *
 * MOLDE: sync-mp-releases/index.ts — guarda de service role, EdgeRuntime.waitUntil
 * com resposta 202 imediata, modo ?debug=1 síncrono, try/catch obrigatório em
 * todo o corpo do background (Pitfall 4: exceção em background morre sem log
 * se não capturada).
 *
 * A LIÇÃO DA FASE 211, LITERAL (20260805020000_billing_sync_state.sql:1-22):
 * `sync-ml-billing` respondia sucesso ANTES de fazer o trabalho e descartava o
 * `results` — uma conta podia falhar por semanas com o sistema dizendo
 * sucesso. Aqui o resultado por organização (linhas montadas, linhas
 * inseridas, valores inválidos, deflator, erro) é acumulado e devolvido no
 * modo de depuração — nunca descartado.
 *
 * INSERÇÃO SEMPRE COM CONFLITO IGNORADO (`ignoreDuplicates: true`), NUNCA
 * com atualização — é a expressão literal da D-5 no nível do código. O banco
 * reforça isso com REVOKE UPDATE/DELETE/TRUNCATE de service_role
 * (20260821180000_cashflow_forecast_snapshot.sql).
 *
 * Supabase project: ckcdevcxgvueywivefgx (NÃO usar gionpsuunfkkzzjdubfy).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { montarLinhasDeSnapshot, type LinhaCashflowRpc } from "./snapshotRows.ts";

// EdgeRuntime é global no runtime Supabase Edge — sem import necessário.
declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void };

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").trim();
const SERVICE_KEY  = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();

// Faixa congelada por dia: hoje até hoje+30 (mesma janela que a tela mostra
// e a mesma que o 224-05 valida). horizon_days do banco vai de 0 a 30.
const DIAS_DE_HORIZONTE = 30;
// Span do deflator: mesmo default que get_cashflow usa internamente
// (224-05: COALESCE(get_estorno_deflator(p_org_id, 30), 1)) — o snapshot
// grava o MESMO deflator vigente que a tela aplicou, não um recálculo à parte.
const SPAN_DEFLATOR = 30;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function requireServiceRole(req: Request): Response | null {
  if (!SERVICE_KEY) return null;
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== "Bearer " + SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  return null;
}

/** Data de hoje no fuso de Brasília, no formato AAAA-MM-DD. */
function hojeBrt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().substring(0, 10);
}

interface ResultadoOrg {
  organization_id: string;
  linhas_montadas: number;
  linhas_inseridas: number;
  valores_invalidos: number;
  deflator: number | null;
  erro?: string;
}

/**
 * Processa uma organização: busca a previsão (get_cashflow), o deflator
 * vigente (get_estorno_deflator), monta as linhas com o helper puro e
 * insere com conflito ignorado. Nunca lança — erro vira campo `erro` no
 * resultado, para que a conta seguinte continue sendo processada.
 */
async function processarOrg(
  sb: ReturnType<typeof createClient>,
  orgId: string,
  snapshotDate: string,
): Promise<ResultadoOrg> {
  try {
    const fim = addDays(snapshotDate, DIAS_DE_HORIZONTE);

    const { data: linhasCashflow, error: cfErr } = await sb.rpc("get_cashflow", {
      p_org_id: orgId,
      p_start_date: snapshotDate,
      p_end_date: fim,
      p_include_purchase_forecasts: false,
    });
    if (cfErr) throw new Error("get_cashflow: " + cfErr.message);

    const { data: deflatorBruto, error: defErr } = await sb.rpc("get_estorno_deflator", {
      p_org_id: orgId,
      p_span_dias: SPAN_DEFLATOR,
    });
    if (defErr) throw new Error("get_estorno_deflator: " + defErr.message);
    const deflator =
      deflatorBruto === null || deflatorBruto === undefined ? null : Number(deflatorBruto);

    const { linhas, valoresInvalidos } = montarLinhasDeSnapshot(
      orgId,
      snapshotDate,
      linhasCashflow as LinhaCashflowRpc[] | null,
      deflator,
    );

    if (linhas.length === 0) {
      return {
        organization_id: orgId,
        linhas_montadas: 0,
        linhas_inseridas: 0,
        valores_invalidos: valoresInvalidos,
        deflator,
      };
    }

    // ON CONFLICT DO NOTHING — nunca DO UPDATE (D-5). `.select("fonte")`
    // devolve só as linhas efetivamente inseridas (RETURNING não repete as
    // ignoradas pelo conflito), o que dá a contagem real de idempotência.
    const { data: inseridas, error: insErr } = await sb
      .from("cashflow_forecast_snapshot")
      .upsert(linhas, {
        onConflict: "organization_id,snapshot_date,target_date,fonte",
        ignoreDuplicates: true,
      })
      .select("fonte");
    if (insErr) throw new Error("insert cashflow_forecast_snapshot: " + insErr.message);

    return {
      organization_id: orgId,
      linhas_montadas: linhas.length,
      linhas_inseridas: inseridas?.length ?? 0,
      valores_invalidos: valoresInvalidos,
      deflator,
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      organization_id: orgId,
      linhas_montadas: 0,
      linhas_inseridas: 0,
      valores_invalidos: 0,
      deflator: null,
      erro: message,
    };
  }
}

/**
 * O trabalho do job: uma passada por organização com linha em
 * financial_settings — é o conjunto para o qual get_cashflow significa
 * alguma coisa, já que o saldo inicial é o ponto de partida da projeção.
 * Todo o corpo dentro de try/catch (Pitfall 4).
 */
async function runSnapshot(snapshotDateOverride?: string): Promise<unknown> {
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const snapshotDate = snapshotDateOverride ?? hojeBrt();

    const { data: orgsRows, error: orgErr } = await sb
      .from("financial_settings")
      .select("organization_id");

    if (orgErr) {
      console.error("snapshot-cashflow-forecast runSnapshot error: financial_settings:", orgErr.message);
      return { ok: false, error: orgErr.message };
    }

    if (!orgsRows || orgsRows.length === 0) {
      console.log("snapshot-cashflow-forecast: nenhuma organização com financial_settings");
      return { ok: true, snapshot_date: snapshotDate, results: [] };
    }

    // Resultado por organização acumulado e devolvido — nunca descartado
    // (lição da Fase 211: sucesso reportado sobre resultado silenciado).
    const results: ResultadoOrg[] = [];
    for (const row of orgsRows as { organization_id: string }[]) {
      const r = await processarOrg(sb, row.organization_id, snapshotDate);
      results.push(r);
      if (r.erro) {
        console.error("snapshot-cashflow-forecast: org=" + row.organization_id + " erro: " + r.erro);
      } else {
        console.log(
          "snapshot-cashflow-forecast: org=" + row.organization_id +
          " linhas_montadas=" + r.linhas_montadas +
          " linhas_inseridas=" + r.linhas_inseridas +
          " valores_invalidos=" + r.valores_invalidos,
        );
      }
    }

    return { ok: true, snapshot_date: snapshotDate, results };
  } catch (err: unknown) {
    // Pitfall 4: sem este catch, exceção em background morre silenciosamente
    // (sem log) quando chamado via EdgeRuntime.waitUntil.
    const message = err instanceof Error ? err.message : String(err);
    console.error("snapshot-cashflow-forecast runSnapshot error:", message);
    return { ok: false, error: message };
  }
}

// ── Main handler ──────────────────────────────────────────────────────────
// requireServiceRole() roda ANTES de qualquer trabalho em segundo plano
// (a guarda não pode se mover para depois do waitUntil).

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const guard = requireServiceRole(req);
  if (guard) return guard;

  let body: any = {};
  try { body = await req.json(); } catch { /* sem body */ }

  const isDebug = new URL(req.url).searchParams.get("debug") === "1";
  const snapshotDateOverride = typeof body.snapshot_date === "string" ? body.snapshot_date : undefined;

  // Modo debug síncrono: roda tudo em linha e devolve o diagnóstico no
  // corpo — é o que permite ao orquestrador provar a gravação sem depender
  // de log (mesmo padrão de sync-mp-releases).
  if (isDebug) {
    const diag = await runSnapshot(snapshotDateOverride);
    return json({ ok: true, mode: "debug-sync", diag }, 200);
  }

  EdgeRuntime.waitUntil(runSnapshot(snapshotDateOverride));
  return json({ ok: true, msg: "snapshot enqueued" }, 202);
});
