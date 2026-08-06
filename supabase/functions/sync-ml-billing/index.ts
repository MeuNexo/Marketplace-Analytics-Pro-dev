import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { aggregateMoves, type RawMove } from "./aggregate.ts";

// EdgeRuntime é global no runtime Supabase Edge — sem import necessário.
// Usado para o modo "daily" rodar em background (ver serve() abaixo) — evita o
// caller (pg_net do cron, Pattern B) segurar a conexão pela duração inteira do
// sync. Mesmo padrão de sync-mp-releases / sync-tiny-payables / sync-tiny-costs.
declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ML_API = "https://api.mercadolibre.com";

// ── ML fetch helper ───────────────────────────────────────────────────────────

async function mlFetch(path: string, accessToken: string, timeoutMs = 15_000) {
  const res = await fetch(`${ML_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`ML API error [${path}]:`, res.status, data?.message ?? "(no message)");
    throw new Error(data?.message || `ML API error: ${res.status}`);
  }
  return data;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Dispara a próxima rodada da MESMA fatura, que retoma do cursor persistido.
// Fire-and-forget: se falhar, o cron do dia seguinte retoma do mesmo ponto —
// nada é perdido, porque o progresso está no banco, não em memória.
async function continuarEmOutraInvocacao(body: Record<string, unknown>) {
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-ml-billing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    console.log(`sync-ml-billing: continuacao disparada para ${JSON.stringify(body)}`);
  } catch (e) {
    console.error("sync-ml-billing: falha ao disparar continuacao:", e instanceof Error ? e.message : String(e));
  }
}

// ── Resolve a invoice key + janela de consumo a partir de /periods ───────────
// Regra de domínio: fatura nomeada pelo mês de FECHAMENTO (consumo N → fatura N+1).
// O ciclo de cobrança da conta NÃO é mês-calendário (ex.: 06→05); a janela real
// vem de period.date_from/date_to. Para período OPEN o date_from vem anômalo
// (placeholder antigo) → deriva de date_to − 1 mês + 1 dia.
async function resolveInvoice(
  token: string, sellerId: string, periodMonth: string,
): Promise<{ key: string; from: string; to: string } | null> {
  // Fase 211 critério 2 — retry com backoff no 429.
  //
  // `fetchPage` (detalhes da fatura) já tinha backoff; ESTA chamada não tinha, e
  // era justamente onde o rate limit batia: medido em 05/08 como
  // `billing/periods failed: 429` nas duas contas ativas, reproduzido após 3
  // minutos de descanso. Sem retry, uma recusa aqui derruba o sync inteiro da
  // conta antes mesmo de saber qual fatura buscar.
  //
  // Respeita `Retry-After` quando o ML manda; senão cresce 2s, 4s, 6s, 8s. O
  // teto de 5 tentativas mantém a invocação dentro do orçamento da Edge
  // Function — insistir para sempre trocaria uma falha visível por um timeout
  // mudo, que é pior.
  let resp: Response | null = null;
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    resp = await fetch(
      `${ML_API}/billing/integration/monthly/periods?seller_id=${sellerId}&group=ML&document_type=BILL`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) },
    );
    if (resp.status !== 429 && resp.status < 500) break;
    const retryAfter = Number(resp.headers.get("retry-after") ?? 0);
    const esperaMs = retryAfter > 0 ? retryAfter * 1_000 : 2_000 * (tentativa + 1);
    console.warn(`billing/periods ${resp.status} (tentativa ${tentativa + 1}/5) — aguardando ${esperaMs}ms`);
    await sleep(esperaMs);
  }
  if (!resp) throw new Error("billing/periods: nenhuma resposta");
  if (!resp.ok) {
    if (resp.status === 404) return null;
    // A mensagem diz que JÁ tentou — senão o próximo a ler o erro reimplementa
    // o retry que já existe.
    throw new Error(`billing/periods failed: ${resp.status} (apos 5 tentativas com backoff)`);
  }
  const list: any[] = (await resp.json()).results ?? [];
  // chave da fatura = consumo + 1 mês
  const [py, pm] = periodMonth.split("-").map(Number);
  const invDate = new Date(Date.UTC(py, pm, 1));
  const month = `${invDate.getUTCFullYear()}-${String(invDate.getUTCMonth() + 1).padStart(2, "0")}`;
  const compact = month.replace("-", "");
  const period = list.find((p: any) => {
    const k = String(p.key ?? "");
    return k.startsWith(month) || k.substring(0, 7) === month || k.startsWith(compact);
  });
  if (!period?.key) return null;

  const rawFrom = String(period.period?.date_from ?? "");
  const rawTo = String(period.period?.date_to ?? "");
  let from = rawFrom || "";
  const to = rawTo || "";
  if (rawFrom && rawTo) {
    const fromMs = Date.parse(rawFrom), toMs = Date.parse(rawTo);
    if (Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs - fromMs > 60 * 86_400_000) {
      const d = new Date(toMs);
      d.setUTCMonth(d.getUTCMonth() - 1);
      d.setUTCDate(d.getUTCDate() + 1);
      from = d.toISOString().slice(0, 10);
    }
  }
  return { key: String(period.key), from, to };
}

// ── Paginação por cursor de /details (grupos ML + MP) ────────────────────────
// 2026-07-03 (fix rate-limit): trocado de offset (PAGE=200 + passada de
// reconciliação que dobrava as chamadas) para o cursor from_id/last_id
// recomendado pela doc oficial do ML ("Best Practices for Consuming Billing
// Reports APIs" — developers.mercadolibre.com.ar): offset é instável nesta
// API (perde/repete itens entre chamadas) e o ML recomenda from_id+limit=1000
// no lugar. Com limit=1000 uma fatura de 800+ movimentos cabe tipicamente em
// 1 página só, eliminando o cenário que estourava o rate-limit no offset 800.
// Dedup por detail_id continua como defesa (idempotente mesmo se a API
// devolver overlap entre páginas).
// 2026-08-06: a paginação virou RETOMÁVEL. Antes, todas as páginas do grupo eram
// buscadas dentro de uma invocação só; quando a fatura passou de 4 páginas de
// 1000 movimentos (1,4 MB cada), o acumulado estourou o orçamento da EF. Cada
// página isolada cabe folgadamente nos 25s — medido —, o problema era a soma.
// Agora cada rodada gasta um orçamento de páginas, grava o insumo em
// ml_billing_moves_stage (chave detail_id => reprocessar página não duplica) e
// guarda onde parou em ml_billing_page_cursor. Sem isso, cada rodada recomeçava
// da página 1 e a fatura NUNCA terminava, por mais que o cron rodasse.
async function fetchGroupPaginas(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any, token: string, sellerId: string, key: string, group: string,
  organizationId: string, ml_user_id: string, orcamentoPaginas: number,
): Promise<{ done: boolean; paginas: number }> {
  const PAGE = 1000; // limite recomendado pela doc do ML para paginação por from_id
  const fetchPage = async (fromId: number) => {
    let ultimoErro = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      let res: Response;
      try {
        res = await fetch(
          `${ML_API}/billing/integration/periods/key/${key}/group/${group}/details?document_type=BILL&limit=${PAGE}&from_id=${fromId}&sort_by=ID&order_by=ASC`,
          { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(25_000) },
        );
      } catch (e) {
        // 2026-08-06: ESTE era o buraco. `AbortSignal.timeout` lança exceção —
        // não devolve status — então "Signal timed out." escapava do laço de
        // retry abaixo, que só olhava 429/5xx, e derrubava a conta inteira sem
        // nenhuma segunda tentativa. Medido: falha reproduzida na fatura
        // 2026-08-01 nas duas contas, todo dia, desde 05/08.
        ultimoErro = e instanceof Error ? e.message : String(e);
        console.warn(`details ${group} from_id ${fromId}: ${ultimoErro} (tentativa ${attempt + 1}/5)`);
        await sleep(1_500 * (attempt + 1));
        continue;
      }
      // Backoff mais longo que o anterior (800ms×4) — defesa adicional caso a
      // API ainda rate-limite mesmo com muito menos chamadas por fatura.
      if (res.status === 429 || res.status >= 500) { await sleep(1_500 * (attempt + 1)); continue; }
      if (res.status === 404) return { results: [] as any[], lastId: null as number | null };
      if (!res.ok) throw new Error(`details ${group} ${res.status}`);
      const j = await res.json();
      const results = (j.results ?? []) as any[];
      // last_id pode vir no topo ou aninhado em paging; fallback: detail_id do
      // último item da página (defensivo — não depende só do shape exato da doc).
      const lastId = j.last_id != null
        ? Number(j.last_id)
        : j.paging?.last_id != null
        ? Number(j.paging.last_id)
        : results.length > 0
        ? Number(results[results.length - 1]?.charge_info?.detail_id) || null
        : null;
      return { results, lastId };
    }
    throw new Error(
      `details ${group} from_id ${fromId}: falhou apos 5 tentativas${ultimoErro ? ` (ultimo erro: ${ultimoErro})` : " (rate-limited)"}`,
    );
  };

  // Grava a página no insumo. Chave (org, conta, fatura, detail_id) => se a
  // mesma página for buscada de novo (retry, rodada repetida), o upsert
  // sobrescreve em vez de somar duas vezes.
  const gravarPagina = async (results: any[]) => {
    const vistos = new Set<number>();
    const linhas: Record<string, unknown>[] = [];
    for (const m of results) {
      const ci = m.charge_info ?? {};
      const id = Number(ci.detail_id);
      if (!id || vistos.has(id)) continue;
      vistos.add(id);
      const chargeDate = String(ci.creation_date_time ?? "").slice(0, 10);
      linhas.push({
        organization_id: organizationId, ml_user_id, invoice_key: key, detail_id: id,
        charge_date: chargeDate || null,
        charge_type: String(ci.detail_sub_type ?? ""),
        charge_label: String(ci.transaction_detail ?? ""),
        amount: Number(ci.detail_amount ?? 0),
        is_bonus: String(ci.detail_type ?? "") === "BONUS",
        sale_date: m.sales_info?.[0]?.sale_date_time ? String(m.sales_info[0].sale_date_time).slice(0, 10) : null,
      });
    }
    for (let i = 0; i < linhas.length; i += 500) {
      const { error } = await supabaseAdmin.from("ml_billing_moves_stage")
        .upsert(linhas.slice(i, i + 500), { onConflict: "organization_id,ml_user_id,invoice_key,detail_id" });
      if (error) throw new Error(`upsert ml_billing_moves_stage: ${error.message}`);
    }
  };

  const { data: cur } = await supabaseAdmin.from("ml_billing_page_cursor")
    .select("from_id, done, paginas")
    .eq("organization_id", organizationId).eq("ml_user_id", ml_user_id)
    .eq("invoice_key", key).eq("grp", group).maybeSingle();
  if (cur?.done) return { done: true, paginas: 0 };

  let fromId = Number(cur?.from_id ?? 0);
  let guard = Number(cur?.paginas ?? 0); // hard cap de páginas — nunca loopar infinitamente se a API repetir last_id
  let paginas = 0;
  let done = false;

  while (paginas < orcamentoPaginas) {
    const page = await fetchPage(fromId);
    await gravarPagina(page.results);
    paginas += 1;
    guard += 1;
    if (page.results.length === 0 || page.lastId == null || page.lastId === fromId) { done = true; break; }
    fromId = page.lastId;
    if (guard > 50) { // 50 × 1000 = 50k movimentos, bem acima de qualquer fatura real
      console.warn(`fetchGroupPaginas ${group} key=${key}: guard de páginas atingido (50) — encerrando paginação`);
      done = true;
      break;
    }
    await sleep(250);
  }

  const { error: curErr } = await supabaseAdmin.from("ml_billing_page_cursor").upsert({
    organization_id: organizationId, ml_user_id, invoice_key: key, grp: group,
    from_id: fromId, done, paginas: guard, updated_at: new Date().toISOString(),
  }, { onConflict: "organization_id,ml_user_id,invoice_key,grp" });
  if (curErr) throw new Error(`upsert ml_billing_page_cursor: ${curErr.message}`);

  return { done, paginas };
}

// Agrega uma fatura inteira (ML+MP) por (competência da venda, data de
// lançamento, tipo) — trilha de COMPETÊNCIA (Phase 84). competence_date =
// saleDate ?? charge_date; a exclusão `within` (janela de consumo da fatura)
// foi REMOVIDA nesta trilha — estornos de vendas fora da janela agora contam
// (sempre com sinal negativo). Núcleo puro de agregação vive em ./aggregate.ts
// (testável no vitest sem os imports Deno/URL deste arquivo). `inv.from`/`inv.to`
// não são mais usados aqui (mantidos na assinatura só por `inv.key`, usado por
// fetchGroupMoves) — a trilha `fetchBillingPeriod`/`ml_billing_monthly` (visão
// "igual à fatura ML") continua intacta e usa esses campos separadamente.
// Orçamento de páginas por INVOCAÇÃO (soma dos dois grupos). Medido em
// 06/08/2026: 3 páginas isoladas passam; o acumulado da fatura inteira (>4
// páginas × 1,4 MB) não. 2 deixa margem e converge em poucas rodadas.
const PAGINAS_POR_RODADA = 2;

// Devolve `complete: false` enquanto a fatura não terminou de paginar — e nesse
// caso o chamador NÃO pode apagar nem reescrever ml_billing_daily, senão o dado
// bom vira dado pela metade. Só agrega quando os dois grupos fecharam.
async function aggregateInvoice(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any, token: string, sellerId: string,
  inv: { key: string; from: string; to: string },
  organizationId: string, ml_user_id: string,
): Promise<{ complete: boolean; rows: Array<{ competence_date: string; charge_date: string; charge_type: string; charge_label: string; amount: number }> | null; paginas: number }> {
  let orcamento = PAGINAS_POR_RODADA;
  let paginasFeitas = 0;
  for (const group of ["ML", "MP"]) {
    if (orcamento <= 0) break;
    const r = await fetchGroupPaginas(supabaseAdmin, token, sellerId, inv.key, group, organizationId, ml_user_id, orcamento);
    orcamento -= r.paginas;
    paginasFeitas += r.paginas;
  }

  const { data: cursores } = await supabaseAdmin.from("ml_billing_page_cursor")
    .select("grp, done").eq("organization_id", organizationId)
    .eq("ml_user_id", ml_user_id).eq("invoice_key", inv.key);
  const fechado = (g: string) => (cursores ?? []).some((c: { grp: string; done: boolean }) => c.grp === g && c.done);
  if (!fechado("ML") || !fechado("MP")) return { complete: false, rows: null, paginas: paginasFeitas };

  // Lê o insumo de volta e agrega com a MESMA função pura de sempre — a régua de
  // competência continua existindo num lugar só (aggregate.ts).
  // PostgREST trunca em 1000: paginar com .range() é obrigatório aqui.
  const moves: RawMove[] = [];
  const PASSO = 1000;
  for (let offset = 0; ; offset += PASSO) {
    const { data, error } = await supabaseAdmin.from("ml_billing_moves_stage")
      .select("detail_id, charge_date, charge_type, charge_label, amount, is_bonus, sale_date")
      .eq("organization_id", organizationId).eq("ml_user_id", ml_user_id).eq("invoice_key", inv.key)
      .order("detail_id", { ascending: true }).range(offset, offset + PASSO - 1);
    if (error) throw new Error(`select ml_billing_moves_stage: ${error.message}`);
    const lote = data ?? [];
    for (const r of lote) {
      moves.push({
        detailId: Number(r.detail_id),
        date: r.charge_date ?? "",
        type: r.charge_type ?? "",
        label: r.charge_label ?? "",
        amount: Number(r.amount ?? 0),
        isBonus: Boolean(r.is_bonus),
        saleDate: r.sale_date ?? null,
      });
    }
    if (lote.length < PASSO) break;
  }
  return { complete: true, rows: aggregateMoves(moves), paginas: paginasFeitas };
}

// Zera cursor + insumo de uma fatura, para que a próxima rodada a reconstrua do
// zero. Chamado depois que ml_billing_daily recebeu o resultado agregado.
// deno-lint-ignore no-explicit-any
async function limparInsumo(supabaseAdmin: any, organizationId: string, ml_user_id: string, invoiceKey: string) {
  await supabaseAdmin.from("ml_billing_moves_stage").delete()
    .eq("organization_id", organizationId).eq("ml_user_id", ml_user_id).eq("invoice_key", invoiceKey);
  await supabaseAdmin.from("ml_billing_page_cursor").delete()
    .eq("organization_id", organizationId).eq("ml_user_id", ml_user_id).eq("invoice_key", invoiceKey);
}

// ── Billing period fetch (modo monthly — summary agregado, comportamento legado) ─

async function fetchBillingPeriod(
  token: string,
  sellerId: string,
  periodMonth: string,
): Promise<{
  cffe: number; cfonpn: number;
  charges: Array<{ type: string; label: string; amount: number }>;
  invoiceFrom: string | null; invoiceTo: string | null;
} | null> {
  const inv = await resolveInvoice(token, sellerId, periodMonth);
  if (!inv) return null;

  const detailResp = await fetch(
    `${ML_API}/billing/integration/periods/key/${inv.key}/summary/details?seller_id=${sellerId}&document_type=BILL`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) },
  );
  if (!detailResp.ok) {
    if (detailResp.status === 404) return null;
    throw new Error(`billing/summary/details failed: ${detailResp.status}`);
  }
  const data = await detailResp.json();
  const billIncludes = data.bill_includes ?? {};
  const charges: any[] = [...(billIncludes.charges ?? []), ...(billIncludes.bonuses ?? [])];
  const cffe = charges.filter((c: any) => String(c.type ?? "").includes("CFFE")).reduce((s, c) => s + Number(c.amount ?? 0), 0);
  const cfonpn = charges.filter((c: any) => String(c.type ?? "").includes("CFONPN")).reduce((s, c) => s + Number(c.amount ?? 0), 0);
  return {
    cffe, cfonpn,
    charges: charges.map((c: any) => ({ type: String(c.type ?? ""), label: String(c.label ?? ""), amount: Number(c.amount ?? 0) })),
    invoiceFrom: inv.from || null, invoiceTo: inv.to || null,
  };
}

// ── Modo daily: agrega movimentos por dia de lançamento em ml_billing_daily ──
// Sincroniza as DUAS faturas que tocam o mês-calendário pedido: a fatura do
// próprio mês (key = period_month, cobre os dias 01–05) e a do mês seguinte
// (key = period_month+1, cobre 06–fim). Full-resync idempotente por fatura.
// Extraída para função própria (2026-07-03) para poder rodar tanto inline
// (mode debug=1, usado para verificação síncrona) quanto em background via
// EdgeRuntime.waitUntil (caminho padrão — ver serve()).
async function runDailySync(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  accessToken: string,
  mlNumericId: string,
  organizationId: string,
  ml_user_id: string,
  period_month: string,
): Promise<{ synced: string[]; totalRows: number; pendentes: string[] }> {
  const [y, m] = period_month.split("-").map(Number);
  const nextMonth = `${new Date(Date.UTC(y, m, 1)).getUTCFullYear()}-${String(new Date(Date.UTC(y, m, 1)).getUTCMonth() + 1).padStart(2, "0")}`;
  const targets = [period_month, nextMonth]; // faturas que cobrem dias 01–05 e 06–fim do mês-calendário

  let totalRows = 0;
  const synced: string[] = [];
  const pendentes: string[] = [];
  for (const pm of targets) {
    const inv = await resolveInvoice(accessToken, mlNumericId, pm);
    if (!inv) continue; // fatura ainda não existe (ex.: mês muito à frente)
    const r = await gravarFatura(supabaseAdmin, accessToken, mlNumericId, organizationId, ml_user_id, inv);
    if (r.complete) { totalRows += r.rows; synced.push(inv.key); } else { pendentes.push(inv.key); }
  }
  return { synced, totalRows, pendentes };
}

// Pagina o que couber no orçamento desta rodada e, SÓ quando a fatura fecha,
// reescreve ml_billing_daily (full-resync idempotente por source_invoice_key).
// Enquanto não fecha, não encosta em ml_billing_daily — o dado anterior, mesmo
// velho, é melhor que um dado pela metade.
async function gravarFatura(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any, accessToken: string, mlNumericId: string,
  organizationId: string, ml_user_id: string, inv: { key: string; from: string; to: string },
): Promise<{ complete: boolean; rows: number; paginas: number }> {
  const { complete, rows, paginas } = await aggregateInvoice(supabaseAdmin, accessToken, mlNumericId, inv, organizationId, ml_user_id);
  if (!complete || !rows) {
    console.log(`sync-ml-billing: fatura ${inv.key} ainda paginando (+${paginas} pagina(s) nesta rodada)`);
    return { complete: false, rows: 0, paginas };
  }
  await supabaseAdmin.from("ml_billing_daily")
    .delete().eq("organization_id", organizationId).eq("ml_user_id", ml_user_id).eq("source_invoice_key", inv.key);
  if (rows.length > 0) {
    const payload = rows.map((r) => ({ organization_id: organizationId, ml_user_id, competence_date: r.competence_date, charge_date: r.charge_date, charge_type: r.charge_type, charge_label: r.charge_label, amount: r.amount, source_invoice_key: inv.key }));
    for (let i = 0; i < payload.length; i += 500) {
      const { error } = await supabaseAdmin.from("ml_billing_daily").insert(payload.slice(i, i + 500));
      if (error) throw new Error(`insert ml_billing_daily: ${error.message}`);
    }
  }
  await limparInsumo(supabaseAdmin, organizationId, ml_user_id, inv.key);
  return { complete: true, rows: rows.length, paginas };
}

// Sincroniza UMA fatura específica por key (Phase 84 — backfill resiliente).
// Motivo: quando a API do ML está lenta, `runDailySync` (2 faturas por chamada)
// estoura o teto de wall-clock da EF. Este caminho processa 1 fatura só,
// cabendo no limite mesmo com ML devagar. Full-resync idempotente por fatura
// (delete-by-source_invoice_key + insert). `from`/`to` não são usados na trilha
// de competência (aggregateInvoice ignora), então bastam a key.
async function syncSingleInvoice(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  accessToken: string,
  mlNumericId: string,
  organizationId: string,
  ml_user_id: string,
  invoiceKey: string,
): Promise<{ synced: string[]; totalRows: number; pendentes: string[] }> {
  const inv = { key: invoiceKey, from: "", to: "" };
  const r = await gravarFatura(supabaseAdmin, accessToken, mlNumericId, organizationId, ml_user_id, inv);
  return r.complete
    ? { synced: [inv.key], totalRows: r.rows, pendentes: [] }
    : { synced: [], totalRows: 0, pendentes: [inv.key] };
}

/** Mês-calendário anterior ao corrente (YYYY-MM, UTC). Usado pelo cron (Layer 3):
 *  ciclo de fatura ML é 06→05, então por volta do dia 6+ do mês corrente a
 *  fatura do mês anterior já está disponível/fechada. */
function previousCalendarMonth(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Fase 211 critério 5 — a falha passa a existir POR ESCRITO.
 *
 * Esta EF responde HTTP 202 {"success":true} ANTES de fazer o trabalho (o corpo
 * roda em EdgeRuntime.waitUntil), e `resync_billing_daily_current_month()`
 * dispara sem olhar a resposta. Sem isto aqui, uma conta falha por semanas e o
 * sistema inteiro responde "sucesso" — foi o que aconteceu com a conta Thales,
 * com ZERO dias de PADS e ninguém sabendo.
 *
 * `ultima_tentativa` sempre avança; `ultimo_sucesso` só na tentativa que deu
 * certo. A distância entre as duas é o alarme.
 *
 * Nunca lança: observabilidade que derruba o sync que ela observa é pior que
 * não ter observabilidade.
 */
// deno-lint-ignore no-explicit-any
async function registrarEstado(
  sb: any, organizationId: string, mlUserId: string, periodMonth: string,
  ok: boolean, linhas: number, erro: string | null,
): Promise<void> {
  try {
    const agora = new Date().toISOString();
    // deno-lint-ignore no-explicit-any
    const linha: Record<string, any> = {
      organization_id: organizationId,
      ml_user_id: mlUserId,
      period_month: periodMonth,
      ultima_tentativa: agora,
      ok,
      linhas,
      erro: erro ? erro.slice(0, 500) : null,
    };
    if (ok) linha.ultimo_sucesso = agora;
    await sb.from("ml_billing_sync_state").upsert(linha, { onConflict: "ml_user_id" });
  } catch (e) {
    console.error("registrarEstado falhou (nao derruba o sync):", e instanceof Error ? e.message : String(e));
  }
}

// ── Fan-out multi-conta (cron/Layer 3): varre ml_tokens e roda runDailySync
// para cada conta ativa. Só usado pelo caminho service-role sem ml_user_id no
// body (ver serve()) — nunca exposto a chamadas de usuário comum.
async function runAllAccountsDailySync(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  periodMonthOverride?: string,
): Promise<{ period_month: string; accounts: number; results: Array<{ ml_user_id: string; ok: boolean; rows?: number; error?: string }> }> {
  const periodMonth = periodMonthOverride ?? previousCalendarMonth();
  const { data: tokenRows, error } = await supabaseAdmin
    .from("ml_tokens")
    .select("ml_user_id, organization_id, access_token, updated_at")
    .not("access_token", "is", null)
    .not("organization_id", "is", null)
    // Interruptor central: conta fora de uso nao sincroniza, nao alarma e nao
    // gasta chamada de API. Sem ele, a exclusao viraria um seller_id hardcoded
    // espalhado por cada dispatcher — e o proximo dispatcher esqueceria.
    .eq("sync_enabled", true)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`ml_tokens fetch: ${error.message}`);

const seen = new Set<string>();
  const results: Array<{ ml_user_id: string; ok: boolean; rows?: number; error?: string }> = [];
  // deno-lint-ignore no-explicit-any
  for (const row of (tokenRows ?? []) as any[]) {
    const mlUserId = String(row.ml_user_id);
    if (seen.has(mlUserId)) continue; // dedup — linhas mais recentes (updated_at desc) vêm primeiro
    seen.add(mlUserId);
    try {
      const mlUser = await mlFetch("/users/me", row.access_token);
      const mlNumericId = String(mlUser.id);
      const { synced, totalRows, pendentes } = await runDailySync(supabaseAdmin, row.access_token, mlNumericId, row.organization_id, mlUserId, periodMonth);
      results.push({ ml_user_id: mlUserId, ok: true, rows: totalRows });
      console.log(`sync-ml-billing cron: ml_user_id=${mlUserId} period=${periodMonth} invoices=${synced.join(",")} rows=${totalRows} pendentes=${pendentes.join(",") || "-"}`);
      // Fatura pendente NÃO é sucesso: gravar ok=true aqui esconderia uma fatura
      // que nunca fecha, que foi exatamente como o dia 05/08 ficou pela metade
      // por 32h sem ninguém ver.
      await registrarEstado(
        supabaseAdmin, row.organization_id, mlUserId, periodMonth,
        pendentes.length === 0, totalRows,
        pendentes.length === 0 ? null : `paginacao em andamento: ${pendentes.join(",")}`,
      );
      if (pendentes.length > 0) await continuarEmOutraInvocacao({ mode: "daily", ml_user_id: mlUserId, period_month: periodMonth, invoice_key: pendentes[0] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ ml_user_id: mlUserId, ok: false, error: msg });
      console.error(`sync-ml-billing cron: ml_user_id=${mlUserId} period=${periodMonth} failed:`, msg);
      await registrarEstado(supabaseAdmin, row.organization_id, mlUserId, periodMonth, false, 0, msg);
    }
  }
  return { period_month: periodMonth, accounts: results.length, results };
}

// ── Body schema ────────────────────────────────────────────────────────────────
// ml_user_id e period_month são opcionais SÓ para o fan-out do cron (mode=daily,
// service-role, sem ml_user_id => varre todas as contas, ver serve()). Todo
// outro caminho (frontend, monthly) continua exigindo ambos — validado
// manualmente logo após o parse (zod não expressa bem esse "obrigatório
// condicional" sem refinar a árvore toda).

const BodySchema = z.object({
  ml_user_id: z.string().min(1).optional(),
  period_month: z.string().regex(/^\d{4}-\d{2}$/, "period_month must be YYYY-MM").optional(),
  mode: z.enum(["monthly", "daily"]).optional().default("monthly"),
  // Phase 84 — backfill resiliente: sincroniza SÓ esta fatura (1 por chamada,
  // evita o timeout do par de 2 faturas quando o ML está lento). Só honrado no
  // modo daily; exige ml_user_id + organização resolvida.
  invoice_key: z.string().min(1).optional(),
});

// ── Handler ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
    const isServiceRole = token === serviceKey;

    let userId: string | null = null;
    if (!isServiceRole) {
      const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(token);
      if (authErr || !authData?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      userId = authData.user.id;
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid input", details: parsed.error.flatten().fieldErrors }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { ml_user_id, period_month, mode, invoice_key } = parsed.data;

    // ── Fan-out multi-conta (Layer 3 — cron): mode=daily sem ml_user_id varre
    // TODAS as contas ativas (ml_tokens). Só service-role pode disparar — nunca
    // exposto a usuário comum (evitaria forçar sync de orgs alheias, mesmo sem
    // vazar dados). period_month opcional: default = mês-calendário anterior.
    if (mode === "daily" && !ml_user_id) {
      if (!isServiceRole) {
        return new Response(JSON.stringify({ error: "ml_user_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const bg = runAllAccountsDailySync(supabaseAdmin, period_month)
        .then((r) => console.log(`sync-ml-billing cron done: period=${r.period_month} accounts=${r.accounts}`))
        .catch((e: unknown) => console.error("sync-ml-billing cron failed:", e instanceof Error ? e.message : String(e)));
      EdgeRuntime.waitUntil(bg);
      return new Response(JSON.stringify({ success: true, mode: "daily", scope: "all-accounts", status: "enqueued" }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!ml_user_id) {
      return new Response(JSON.stringify({ error: "ml_user_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!period_month) {
      return new Response(JSON.stringify({ error: "period_month required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ME-04: ORDER BY updated_at DESC — determinístico em multi-tenant (token mais recente)
    const { data: tokenRow, error: tokenErr } = await supabaseAdmin
      .from("ml_tokens").select("access_token, organization_id, seller_id, updated_at")
      .eq("ml_user_id", ml_user_id).not("access_token", "is", null)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (tokenErr || !tokenRow?.access_token) {
      return new Response(JSON.stringify({ error: "No ML token found for this store" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const accessToken: string = tokenRow.access_token;
    const organizationId: string | null = tokenRow.organization_id ?? null;

    if (!isServiceRole) {
      if (!organizationId) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: isMember } = await supabaseAdmin.rpc("is_org_member", { _user_id: userId, _org_id: organizationId });
      if (!isMember) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const mlUser = await mlFetch("/users/me", accessToken);
    const mlNumericId = String(mlUser.id);

    // ── Modo daily ─────────────────────────────────────────────────────────────
    // 2026-07-03: por padrão roda em BACKGROUND (EdgeRuntime.waitUntil) — a fatura
    // ML+MP × 2 meses pode envolver várias chamadas sequenciais à API do ML
    // (paginação + backoff em caso de 429); rodar em background evita que o
    // caller (pg_net do cron, Pattern B — ver Layer 3) segure a conexão HTTP
    // pela duração inteira do sync. Mesmo padrão de sync-mp-releases/sync-tiny-*.
    // ?debug=1 roda inline (síncrono) e devolve o resultado completo — usado
    // para verificação manual (via net.http_post) sem precisar fazer polling.
    if (mode === "daily") {
      if (!organizationId) {
        return new Response(JSON.stringify({ success: true, daily: null, warning: "organization_id missing" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // Phase 84 — backfill resiliente: se invoice_key vier no body, sincroniza
      // SÓ aquela fatura (1 chamada ML, cabe no tempo mesmo com o ML lento).
      const dailyRunner = () => invoice_key
        ? syncSingleInvoice(supabaseAdmin, accessToken, mlNumericId, organizationId, ml_user_id, invoice_key)
        : runDailySync(supabaseAdmin, accessToken, mlNumericId, organizationId, ml_user_id, period_month);
      const isDebug = new URL(req.url).searchParams.get("debug") === "1";
      if (isDebug) {
        // Em debug (síncrono) NÃO há auto-continuação: quem chamou dirige o
        // laço e vê fatura a fatura. `pendentes` diz o que falta paginar.
        const { synced, totalRows, pendentes } = await dailyRunner();
        return new Response(JSON.stringify({ success: true, mode: "daily", period_month, invoices_synced: synced, rows: totalRows, pendentes }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const bg = dailyRunner()
        .then(async ({ synced, totalRows, pendentes }) => {
          console.log(`sync-ml-billing daily done: ml_user_id=${ml_user_id} period=${period_month} invoices=${synced.join(",")} rows=${totalRows} pendentes=${pendentes.join(",") || "-"}`);
          // A continuação também grava estado. Sem isto o `ok` ficaria `false`
          // para sempre: o fan-out do cron sempre termina com paginação em
          // andamento (ele começa do zero), e quem de fato FECHA a fatura é
          // esta cadeia. Alarme que grita sem motivo é tão ruim quanto alarme
          // que não grita — vira ruído e o próximo de verdade passa batido.
          await registrarEstado(
            supabaseAdmin, organizationId, ml_user_id, period_month,
            pendentes.length === 0, totalRows,
            pendentes.length === 0 ? null : `paginacao em andamento: ${pendentes.join(",")}`,
          );
          // Fatura que não coube no orçamento desta rodada continua NA PRÓXIMA
          // invocação, de onde parou (cursor persistido). Sem isso ela ficaria
          // esperando o cron do dia seguinte e nunca fechava. O teto de 50
          // páginas por (fatura, grupo) no cursor é o que impede laço infinito.
          if (pendentes.length > 0) await continuarEmOutraInvocacao({ mode: "daily", ml_user_id, period_month, invoice_key: pendentes[0] });
        })
        .catch((e: unknown) => {
          // Pitfall: sem try/catch a exceção do background morre silenciosamente
          // (sem log) quando chamada via EdgeRuntime.waitUntil.
          console.error(`sync-ml-billing daily bg failed: ml_user_id=${ml_user_id} period=${period_month}:`, e instanceof Error ? e.message : String(e));
        });
      EdgeRuntime.waitUntil(bg);
      return new Response(JSON.stringify({ success: true, mode: "daily", period_month, status: "enqueued" }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Modo monthly (legado): summary agregado em ml_billing_monthly ────────────
    const billing = await fetchBillingPeriod(accessToken, mlNumericId, period_month);
    if (!billing) {
      return new Response(JSON.stringify({ success: true, billing: null, message: "No billing data available for this period" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!organizationId) {
      return new Response(JSON.stringify({ success: true, billing: { cffe: billing.cffe, cfonpn: billing.cfonpn }, warning: "organization_id missing, upsert skipped" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { error: upsertErr } = await supabaseAdmin.from("ml_billing_monthly").upsert({
      organization_id: organizationId, ml_user_id, period_month, charges: billing.charges,
      resumo: {
        cffe: billing.cffe, cfonpn: billing.cfonpn,
        total_charges: billing.charges.reduce((s, c) => s + c.amount, 0),
        invoice_from: billing.invoiceFrom, invoice_to: billing.invoiceTo,
        synced_at: new Date().toISOString(),
      },
      synced_at: new Date().toISOString(),
    }, { onConflict: "organization_id,ml_user_id,period_month" });
    if (upsertErr) throw new Error(upsertErr.message);

    return new Response(JSON.stringify({ success: true, billing: { cffe: billing.cffe, cfonpn: billing.cfonpn, charges_count: billing.charges.length } }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("sync-ml-billing error:", message);
    return new Response(JSON.stringify({ success: false, error: message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
