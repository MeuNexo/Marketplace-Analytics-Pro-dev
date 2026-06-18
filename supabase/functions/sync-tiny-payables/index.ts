// ── sync-tiny-payables ────────────────────────────────────────────────────────
// Ingere contas a pagar do Tiny ERP (/contas-pagar) em cash_outflows.
//
// CASH-02 (Wesley 2026-06-18): saídas de caixa vêm do Tiny, não de lançamento manual.
//
// Fluxo:
//   1. Buscar todas as lojas com Tiny conectado (ml_tokens WHERE tiny_access_token IS NOT NULL)
//   2. Para cada loja: getTinyToken(ml_user_id) → refresh automático se expirado
//   3. GET /contas-pagar com janela [hoje-90d, hoje+90d] — paginando até esgotar
//      CRÍTICO: NÃO enviar parâmetro "situacao" — Tiny v3 rejeita o enum (A5)
//   4. Normalizar situacao client-side: pago/quitado/2 → 'paid'; resto → 'pending'
//   5. outflow_date = dataPagamento (se disponível e status='paid') ou dataVencimento[:10]
//   6. UPSERT em cash_outflows onConflict (organization_id, tiny_payable_id)
//      ignoreDuplicates: false — status pode mudar de 'pending' para 'paid' entre syncs
//
// Autenticação: verify_jwt=false no config.toml; guard interno requireServiceRole().
// Chamada por pg_cron (Pattern B) a cada 6h.
//
// Analog: supabase/functions/sync-tiny-costs/index.ts (padrão EXATO reutilizado)
// ─────────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").trim();
const SERVICE_KEY  = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
const TINY_API     = "https://api.tiny.com.br/public-api/v3";

// Tiny rate limit: ~100 req/min — usar 600ms entre páginas de paginação
const PAGE_SLEEP_MS = 600;

// Janela de busca (dias)
const DAYS_BACK    = 90;  // histórico de contas pagas
const DAYS_FORWARD = 90;  // contas a vencer no futuro

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Guard: somente service role pode chamar esta EF (cron Pattern B) ──────────

function requireServiceRole(req: Request): Response | null {
  if (!SERVICE_KEY) return null; // dev local sem key configurada — permitir
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== "Bearer " + SERVICE_KEY) {
    return jsonResp({ error: "Unauthorized" }, 401);
  }
  return null;
}

// ── Token management (IDÊNTICO ao sync-tiny-costs) ───────────────────────────

async function getTinyToken(mlUserId: string): Promise<string> {
  const { data: tok, error } = await sb
    .from("ml_tokens")
    .select("tiny_access_token, tiny_refresh_token, tiny_expires_at")
    .eq("ml_user_id", mlUserId)
    .maybeSingle();

  if (error || !tok) {
    throw new Error(`Conta ML ${mlUserId} não encontrada em ml_tokens`);
  }

  if (!tok.tiny_access_token) {
    throw new Error(`Tiny ERP não conectado para a loja ${mlUserId}. Conecte em /integracoes.`);
  }

  const now = Math.floor(Date.now() / 1000);
  if (tok.tiny_expires_at && tok.tiny_expires_at - now > 300) {
    // Token ainda válido (mais de 5 min de margem)
    return tok.tiny_access_token;
  }

  if (!tok.tiny_refresh_token) {
    throw new Error(`Token Tiny expirado e sem refresh_token para ${mlUserId}. Reconecte em /integracoes.`);
  }

  // Refresh via EF tiny-oauth (action=refresh_token)
  const refreshResp = await fetch(`${SUPABASE_URL}/functions/v1/tiny-oauth`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({
      action: "refresh_token",
      refresh_token: tok.tiny_refresh_token,
      ml_user_id: mlUserId,
    }),
  });

  const refreshData = await refreshResp.json();
  if (!refreshResp.ok || !refreshData.success) {
    throw new Error(`Falha ao renovar token Tiny para ${mlUserId}: ${refreshData.error ?? "desconhecido"}`);
  }

  return refreshData.access_token as string;
}

// ── Tiny API helper (IDÊNTICO ao sync-tiny-costs) ────────────────────────────

// deno-lint-ignore no-explicit-any
async function tinyGet(token: string, path: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`${TINY_API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (resp.status === 429) throw new Error("Tiny 429 rate limit");
  if (!resp.ok) throw new Error(`Tiny ${path} HTTP ${resp.status}`);
  const res = await resp.json();
  return res.data ?? res;
}

// ── Normalização de situação (client-side — A5: NÃO enviar param à API) ──────

function normalizeSituacao(raw: unknown): "pending" | "paid" {
  const s = String(raw ?? "").toLowerCase().trim();
  if (["pago", "quitado", "2"].includes(s)) return "paid";
  return "pending";
}

// ── Formatar data YYYY-MM-DD (puro — sem conversão de timezone) ───────────────

function toDateStr(value: unknown): string | null {
  if (!value) return null;
  return String(value).slice(0, 10); // YYYY-MM-DD[:10]
}

// ── Interface interna ─────────────────────────────────────────────────────────

interface TinyPayable {
  id: string | number;
  valor?: unknown;
  dataVencimento?: unknown;
  dataPagamento?: unknown;
  historico?: unknown;
  descricao?: unknown;
  contato?: { nome?: unknown };
  nomeFornecedor?: unknown;
  situacao?: unknown;
  tipo?: unknown;
  tipoOrdem?: unknown;
  numeroDocumento?: unknown;
  numero?: unknown;
}

// ── Buscar contas a pagar paginando (CRÍTICO: sem parâmetro "situacao") ───────

async function fetchPayables(
  token: string,
  dateFrom: string,
  dateTo: string,
  mlUserId: string,
): Promise<TinyPayable[]> {
  let page = 1;
  const allItems: TinyPayable[] = [];

  while (true) {
    // CRÍTICO: NÃO adicionar parâmetro "situacao" aqui (A5 do RESEARCH)
    // O Tiny v3 rejeita/ignora o enum — filtrar client-side após normalização.
    const data = await tinyGet(token, "/contas-pagar", {
      dataVencimentoInicial: dateFrom,
      dataVencimentoFinal:   dateTo,
      pagina:                String(page),
      limit:                 "100",
    });

    // A API Tiny v3 pode retornar: { itens: [...] } | { data: [...] } | array direto
    // deno-lint-ignore no-explicit-any
    const itens: any[] = Array.isArray(data) ? data : (data?.itens ?? data?.data ?? []);

    // Log do status da 1ª chamada (smoke — premissa A3)
    if (page === 1) {
      console.log(`[sync-tiny-payables] ml_user_id=${mlUserId} página 1: ${itens.length} itens recebidos do Tiny`);
    }

    if (!itens.length) break;
    allItems.push(...itens);

    // Parar se retornou menos de 100 (última página)
    if (itens.length < 100) break;

    page++;
    await sleep(PAGE_SLEEP_MS);
  }

  return allItems;
}

// ── Processar uma loja (ml_user_id) ──────────────────────────────────────────

async function processLoja(
  mlUserId: string,
  organizationId: string,
  dateFrom: string,
  dateTo: string,
): Promise<{ synced: number; errors: number }> {
  const token = await getTinyToken(mlUserId);
  const itens = await fetchPayables(token, dateFrom, dateTo, mlUserId);

  if (!itens.length) {
    console.log(`[sync-tiny-payables] ml_user_id=${mlUserId}: 0 contas a pagar no período`);
    return { synced: 0, errors: 0 };
  }

  const syncAt = new Date().toISOString();

  // Mapear itens → rows de cash_outflows
  // deno-lint-ignore no-explicit-any
  const rows: any[] = [];

  for (const item of itens) {
    const tinyPayableId = String(item.id ?? "").trim();
    if (!tinyPayableId) continue; // sem ID = ignorar (não seria idempotente)

    const statusNorm = normalizeSituacao(item.situacao);
    const contato = item.contato ?? {};

    // outflow_date: preferir dataPagamento se status='paid' e campo disponível (A7)
    // Fallback: dataVencimento (premissa A7 do RESEARCH)
    const dataPagamento = toDateStr(item.dataPagamento);
    const dataVencimento = toDateStr(item.dataVencimento);
    const outflowDate = (statusNorm === "paid" && dataPagamento) ? dataPagamento : (dataVencimento ?? syncAt.slice(0, 10));

    rows.push({
      organization_id: organizationId,
      outflow_date:    outflowDate,
      amount:          Number(item.valor ?? 0),
      description:     String(item.historico ?? item.descricao ?? "").trim() || `Conta #${tinyPayableId}`,
      supplier:        String(contato.nome ?? item.nomeFornecedor ?? "").trim() || null,
      category:        String(item.tipo ?? item.tipoOrdem ?? "").trim() || null,
      status:          statusNorm,
      document_number: String(item.numeroDocumento ?? item.numero ?? "").trim() || null,
      source:          "tiny",
      tiny_payable_id: tinyPayableId,
      synced_at:       syncAt,
      updated_at:      syncAt,
    });
  }

  if (!rows.length) {
    return { synced: 0, errors: 0 };
  }

  // UPSERT idempotente por (organization_id, tiny_payable_id)
  // ignoreDuplicates: false → atualiza status (em_aberto→pago) quando reencontrado
  const { error: upsertErr } = await sb
    .from("cash_outflows")
    .upsert(rows, {
      onConflict: "organization_id,tiny_payable_id",
      ignoreDuplicates: false,
    });

  if (upsertErr) {
    console.error(`[sync-tiny-payables] ml_user_id=${mlUserId} upsert error:`, upsertErr.message);
    return { synced: 0, errors: rows.length };
  }

  console.log(`[sync-tiny-payables] ml_user_id=${mlUserId}: ${rows.length} saídas sincronizadas em cash_outflows`);
  return { synced: rows.length, errors: 0 };
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authError = requireServiceRole(req);
  if (authError) return authError;

  try {
    // Calcular janela de datas
    const now     = new Date();
    const dateFrom = new Date(now.getTime() - DAYS_BACK    * 86400000).toISOString().slice(0, 10);
    const dateTo   = new Date(now.getTime() + DAYS_FORWARD * 86400000).toISOString().slice(0, 10);

    console.log(`[sync-tiny-payables] Iniciando sync. Janela: ${dateFrom} → ${dateTo}`);

    // MULTI-TENANT: buscar todas as lojas com Tiny conectado
    const { data: tokenRows, error: tokErr } = await sb
      .from("ml_tokens")
      .select("ml_user_id, organization_id")
      .not("tiny_access_token", "is", null);

    if (tokErr) throw new Error(`Erro ao buscar ml_tokens: ${tokErr.message}`);
    if (!tokenRows?.length) {
      return jsonResp({ ok: true, msg: "Nenhuma loja com Tiny conectado", synced: 0 });
    }

    console.log(`[sync-tiny-payables] ${tokenRows.length} loja(s) com Tiny conectado`);

    let totalSynced = 0;
    let totalErrors = 0;
    const lojaResults: Record<string, { synced: number; errors: number }> = {};

    for (const row of tokenRows) {
      const mlUserId       = String(row.ml_user_id);
      const organizationId = String(row.organization_id);
      try {
        const res = await processLoja(mlUserId, organizationId, dateFrom, dateTo);
        lojaResults[mlUserId] = res;
        totalSynced += res.synced;
        totalErrors += res.errors;
      } catch (lojaErr: unknown) {
        const msg = lojaErr instanceof Error ? lojaErr.message : String(lojaErr);
        console.error(`[sync-tiny-payables] ml_user_id=${mlUserId} ERRO:`, msg);
        lojaResults[mlUserId] = { synced: 0, errors: -1 };
        totalErrors++;
      }
    }

    return jsonResp({
      ok: true,
      synced:       totalSynced,
      errors:       totalErrors,
      lojas:        tokenRows.length,
      loja_results: lojaResults,
      window:       { from: dateFrom, to: dateTo },
      msg:          `${totalSynced} saídas sincronizadas em cash_outflows (source='tiny')`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync-tiny-payables] ERROR:", message);
    return jsonResp({ error: message }, 500);
  }
});
