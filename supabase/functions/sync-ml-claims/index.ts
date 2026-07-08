/**
 * sync-ml-claims — scheduled edge function (cron-invoked)
 * verify_jwt = false (auth via Bearer service_role_key, enforced by requireServiceRole)
 *
 * Fetches ML claims for all active sellers (ml_tokens rows with refresh_token)
 * and upserts into ml_claims table.
 *
 * Dual-URL fallback (Pitfall 5): tries /v1/claims/search first, falls back to
 * /post-purchase/v1/claims/search if non-200.
 *
 * Backfill strategy (D-03): fetches status=opened and status=closed; client-side
 * filter to last 90 days applied to date_created.
 *
 * Type mapping (D-09): ML `type` field ('mediations'|'returns') → `tipo` column.
 *
 * Security (T-42-04): access_token and refresh_token are NEVER logged or returned.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { deriveSellerAction } from "../_shared/claimActions.ts";

const SUPABASE_URL     = (Deno.env.get("SUPABASE_URL") ?? "").trim();
const SERVICE_KEY      = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
const ML_APP_ID        = Deno.env.get("ML_APP_ID") ?? "";
const ML_CLIENT_SECRET = Deno.env.get("ML_CLIENT_SECRET") ?? "";
const ML_API           = "https://api.mercadolibre.com";

// D-03: backfill window — 90 days
const BACKFILL_DAYS = 90;

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

// ── Auth guard: only service role may invoke ──────────────────────────────────
// (T-42-06) cron passes Bearer service_role_key via vault — Pattern B.

function requireServiceRole(req: Request): Response | null {
  // Fail CLOSED: if the service key env is missing, reject rather than allow
  // unauthenticated access (a missing key must never bypass the guard).
  if (!SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== "Bearer " + SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  return null;
}

// ── Token refresh (same pattern as sync-ads) ──────────────────────────────────

async function getAccessToken(sb: ReturnType<typeof createClient>, mlUserId: string): Promise<string> {
  const { data: row } = await sb
    .from("ml_tokens")
    .select("access_token,refresh_token,expires_at")
    .eq("ml_user_id", mlUserId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) throw new Error("No ML token for ml_user_id=" + mlUserId);

  const expiresTs = row.expires_at ? new Date(row.expires_at).getTime() / 1000 : 0;
  const now       = Date.now() / 1000;
  if (row.access_token && expiresTs - now > 300) return row.access_token;

  if (!row.refresh_token) throw new Error("No refresh token for ml_user_id=" + mlUserId);
  if (!ML_APP_ID || !ML_CLIENT_SECRET) throw new Error("ML_APP_ID/ML_CLIENT_SECRET not set");

  const resp = await fetch(ML_API + "/oauth/token", {
    method:  "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type:    "refresh_token",
      client_id:     ML_APP_ID,
      client_secret: ML_CLIENT_SECRET,
      refresh_token: row.refresh_token,
    }),
  });
  if (!resp.ok) throw new Error("Token refresh " + resp.status + " for ml_user_id=" + mlUserId);

  const data         = await resp.json();
  const newExpiresAt = new Date(Date.now() + (data.expires_in || 21600) * 1000).toISOString();

  // Update token in DB — do NOT log access_token (T-42-04)
  await sb
    .from("ml_tokens")
    .update({
      access_token:  data.access_token,
      refresh_token: data.refresh_token ?? row.refresh_token,
      expires_at:    newExpiresAt,
    })
    .eq("ml_user_id", mlUserId);

  return data.access_token;
}

// ── ML GET with 429/5xx retry ─────────────────────────────────────────────────

async function mlGet(url: string, token: string): Promise<any> {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, {
      headers: { Authorization: "Bearer " + token, "api-version": "2" },
    });
    if (res.ok) return res.json();
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? "2");
      await new Promise(r => setTimeout(r, (wait || 2) * 1000));
      continue;
    }
    if (i < 2 && [500, 502, 503, 504].includes(res.status)) {
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      continue;
    }
    // Return null for non-OK responses to allow fallback (dual-URL logic)
    return null;
  }
  return null;
}

// ── Claims page fetch with dual-URL fallback (Pitfall 5) ─────────────────────

async function fetchClaimsPage(
  token: string,
  status: string,
  offset: number,
): Promise<{ items: any[]; total: number } | null> {
  const params = new URLSearchParams({
    role:   "respondent",
    status: status,
    limit:  "50",
    offset: String(offset),
  });

  // Primary URL
  const primaryUrl  = ML_API + "/v1/claims/search?" + params;
  const fallbackUrl = ML_API + "/post-purchase/v1/claims/search?" + params;

  for (const url of [primaryUrl, fallbackUrl]) {
    const res = await fetch(url, {
      headers: { Authorization: "Bearer " + token, "api-version": "2" },
    });
    if (res.ok) {
      const d = await res.json();
      // Response shape varies: data | claims | results
      const items: any[] = d?.data ?? d?.claims ?? d?.results ?? [];
      const total: number = d?.paging?.total ?? items.length;
      return { items, total };
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? "2");
      await new Promise(r => setTimeout(r, (wait || 2) * 1000));
    }
  }

  // Both URLs failed — return null (per-user error handled by caller)
  return null;
}

// ── Per-user claims sync ──────────────────────────────────────────────────────

async function syncUser(
  sb: ReturnType<typeof createClient>,
  row: { ml_user_id: string; user_id: string; organization_id: string; seller_id: string | null },
): Promise<{ claims: number; error?: string | null; reconciled?: number; reconcile_error?: string | null }> {
  const { ml_user_id: mlUserId, organization_id: orgId } = row;
  const token = await getAccessToken(sb, mlUserId);

  // D-03: fetch last 90 days — client-side filter since API may not support date params
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - BACKFILL_DAYS);
  const cutoffStr = cutoffDate.toISOString().substring(0, 10);

  const allRows: Record<string, unknown>[] = [];

  // (debug: claims-fechadas-presas-opened) claim_ids seen in a COMPLETE,
  // untruncated sweep of status=opened this run. Used below for
  // "reconciliation by absence" — see rationale where openedScanComplete is
  // consumed.
  const openedIdsSeen = new Set<string>();
  let openedScanComplete = false;

  // Safety bound so the EF always finishes inside the 150s wall-clock limit:
  // claims search returns newest-first, so once a full page falls outside the
  // 90-day window the rest are older too — stop. MAX_PAGES is a hard backstop
  // for accounts with very high recent-claim volume (cron re-runs every 30min).
  const MAX_PAGES_PER_STATUS = 6;
  for (const statusFilter of ["opened", "closed"]) {
    let offset = 0;
    let pages = 0;
    let naturalStop = false;   // reached a real end-of-results condition
    let fetchFailed = false;   // both primary+fallback URLs failed on some page
    while (pages < MAX_PAGES_PER_STATUS) {
      const result = await fetchClaimsPage(token, statusFilter, offset);
      if (!result) { fetchFailed = true; break; } // Both URLs failed

      const { items, total } = result;
      pages++;

      // Track every claim_id ML currently reports as 'opened' — BEFORE the
      // 90-day window filter below, so the completeness signal reflects what
      // ML actually returned, not what we chose to persist.
      if (statusFilter === "opened") {
        for (const c of items) {
          const id = String(c.id ?? "");
          if (id) openedIdsSeen.add(id);
        }
      }

      let inWindow = 0;

      for (const c of items) {
        // D-03: client-side date filter — only include claims from last 90 days
        const dateCreated = (c.date_created ?? "").substring(0, 10);
        if (dateCreated && dateCreated < cutoffStr) continue;
        inWindow++;

        allRows.push({
          organization_id: orgId,
          ml_user_id:      mlUserId,
          claim_id:        String(c.id ?? ""),
          order_id:        c.resource_id != null ? String(c.resource_id) : null,
          // D-09: ML `type` discriminates mediations vs returns → stored in `tipo`
          tipo:            c.type ?? "mediations",
          status:          c.status ?? "opened",
          motivo:          c.reason_id ?? null,
          data_abertura:   dateCreated || null,
          data_limite:     (c.resolution_due_date ?? "").substring(0, 10) || null,
          solucao:         c.resolution?.type ?? null,
          synced_at:       new Date().toISOString(),
          // T-90-01: default "não pendente" — só claims OPEN recebem o GET
          // individual (abaixo) que deriva os valores reais. Fechadas ficam
          // assim (design: "Fechadas não precisam", seller_action_required=false).
          seller_action_required: false,
          pending_action_type:    null,
          action_due_date:        null,
          available_actions:      null,
          stage:                  null,
        });
      }

      offset += items.length;
      // Stop when: no more items, past the reported total, or an entire page is
      // already older than the cutoff (newest-first → rest are older too).
      if (items.length === 0 || offset >= total || inWindow === 0) { naturalStop = true; break; }
      // T-42-07: 200ms sleep between pages (ML rate limit)
      await new Promise(r => setTimeout(r, 200));
    }

    if (statusFilter === "opened") {
      // Reconciliation by absence (below) is only safe to trust when this sweep
      // saw the ENTIRE current 'opened' result set from ML: no page-cap
      // truncation (a claim could be sitting on an unread page) and no
      // transport failure (both URLs down — we'd wrongly treat every DB row as
      // absent). naturalStop=false + fetchFailed=false means the while loop
      // exhausted MAX_PAGES_PER_STATUS without reaching a real end — truncated.
      openedScanComplete = naturalStop && !fetchFailed;
    }
  }

  // Traduz o motivo (reason_id → texto legível) uma vez por código, cacheado,
  // para a coluna motivo_texto aparecer já na tabela (sem abrir a reclamação).
  const reasonCache = new Map<string, string | null>();
  for (const r of allRows) {
    const code = r.motivo as string | null;
    if (!code) { r.motivo_texto = null; continue; }
    if (!reasonCache.has(code)) {
      const rd = await mlGet(ML_API + "/post-purchase/v1/claims/reasons/" + code, token);
      reasonCache.set(code, (rd?.detail as string | undefined) ?? null);
      await new Promise((res) => setTimeout(res, 120));
    }
    r.motivo_texto = reasonCache.get(code) ?? null;
  }

  // T-90-01: triagem "de quem é a vez" — o search resumido NÃO traz
  // `available_actions`, então buscamos o claim individual (dual-URL, mesmo
  // par usado pelo ml-webhook) só para as claims ABERTAS. Fechadas mantêm os
  // defaults seller_action_required=false / null definidos acima — sem GET
  // extra (T-90-04: mantém a EF dentro do orçamento de wall-clock).
  for (const r of allRows) {
    if (r.status === "closed") continue;
    const claimId = r.claim_id as string;
    let detail = await mlGet(ML_API + "/v1/claims/" + claimId, token);
    if (!detail) detail = await mlGet(ML_API + "/post-purchase/v1/claims/" + claimId, token);
    if (detail) {
      const derived = deriveSellerAction(detail.players);
      r.seller_action_required = derived.seller_action_required;
      r.pending_action_type    = derived.pending_action_type;
      r.action_due_date        = derived.action_due_date;
      r.available_actions      = derived.available_actions;
      r.stage                  = detail.stage ?? null;
    }
    // T-42-07: inter-request sleep (ML rate limit), same pattern as the
    // reason-cache lookups above (120-200ms).
    await new Promise((res) => setTimeout(res, 150));
  }

  // Dedupe by claim_id within this user's batch: the ML claims search can return
  // the same claim under both 'opened' and 'closed' iterations (or across pages),
  // and Postgres ON CONFLICT DO UPDATE rejects a batch that touches the same
  // conflict target row twice ("cannot affect row a second time"), which would
  // silently drop the ENTIRE seller's upsert. Keep the last occurrence per claim_id.
  const deduped = Array.from(
    new Map(allRows.map((r) => [r.claim_id, r])).values(),
  );

  let upsertError: string | null = null;
  if (deduped.length > 0) {
    // Blindagem contra defasagem do /claims/search (segue listando como 'opened'
    // claims já fechadas): 'closed' é terminal e sempre sobrescreve.
    const closed = deduped.filter((r) => r.status === "closed");
    const open   = deduped.filter((r) => r.status !== "closed");

    if (closed.length > 0) {
      const { error } = await sb
        .from("ml_claims")
        .upsert(closed, { onConflict: "organization_id,ml_user_id,claim_id" });
      if (error) { upsertError = error.message; console.error("sync-ml-claims upsert(closed) ml_user_id=" + mlUserId + ":", error.message); }
    }
    if (open.length > 0) {
      // T-90-01: as abertas precisam ATUALIZAR as colunas de triagem
      // (seller_action_required etc.), não só inserir — senão claims abertas
      // pré-existentes nunca recebem a triagem. Para não reabrir uma claim já
      // fechada no banco (defasagem do search resumido, que ainda a lista como
      // 'opened'), removemos do lote as que já estão 'closed' no banco e damos
      // upsert com MERGE nas demais (atualiza existentes + insere novas).
      const openIds = open.map((r) => r.claim_id as string);
      const { data: closedInDb } = await sb
        .from("ml_claims")
        .select("claim_id")
        .eq("organization_id", orgId)
        .eq("ml_user_id", mlUserId)
        .in("claim_id", openIds)
        .eq("status", "closed");
      const closedSet = new Set((closedInDb ?? []).map((r: any) => r.claim_id as string));
      const openToUpsert = open.filter((r) => !closedSet.has(r.claim_id as string));
      if (openToUpsert.length > 0) {
        const { error } = await sb
          .from("ml_claims")
          .upsert(openToUpsert, { onConflict: "organization_id,ml_user_id,claim_id" });
        if (error) { upsertError = error.message; console.error("sync-ml-claims upsert(open) ml_user_id=" + mlUserId + ":", error.message); }
      }
    }
  }

  // ── Reconciliation by absence ─────────────────────────────────────────────
  // Root cause (2026-07-08 debug session claims-fechadas-presas-opened):
  // ML's /v1/claims/search?status=closed reliably returns [] even when closed
  // claims exist (confirmed empirically against the live API) — so a claim
  // that closes on ML simply vanishes from the 'opened' scan and is never
  // seen again by this sync. The "Blindagem" above only overwrites a row when
  // ML hands us a status='closed' item, which never happens organically —
  // so claims stayed 'opened' in our DB forever once they closed on ML.
  //
  // Fix: treat "was 'opened' in our DB, absent from a COMPLETE current
  // 'opened' sweep, still inside the 90-day window this EF already covers"
  // as reliable evidence the claim closed. Gated on openedScanComplete so a
  // truncated (page-cap) or failed sweep never mass-closes real open claims.
  let reconciled = 0;
  let reconcileError: string | null = null;
  if (openedScanComplete) {
    const { data: staleOpened, error: staleErr } = await sb
      .from("ml_claims")
      .select("claim_id")
      .eq("organization_id", orgId)
      .eq("ml_user_id", mlUserId)
      .eq("status", "opened")
      .gte("data_abertura", cutoffStr);

    if (staleErr) {
      reconcileError = staleErr.message;
      console.error("sync-ml-claims reconcile-select ml_user_id=" + mlUserId + ":", staleErr.message);
    } else {
      const staleIds = (staleOpened ?? [])
        .map((r: any) => r.claim_id as string)
        .filter((id) => !openedIdsSeen.has(id));

      if (staleIds.length > 0) {
        const { error } = await sb
          .from("ml_claims")
          .update({ status: "closed", synced_at: new Date().toISOString() })
          .eq("organization_id", orgId)
          .eq("ml_user_id", mlUserId)
          .in("claim_id", staleIds);
        if (error) {
          reconcileError = error.message;
          console.error("sync-ml-claims reconcile-update ml_user_id=" + mlUserId + ":", error.message);
        } else {
          reconciled = staleIds.length;
        }
      }
    }
  }

  console.log(
    "sync-ml-claims done ml_user_id=" + mlUserId +
    ": fetched=" + allRows.length +
    " upserted=" + (upsertError ? 0 : deduped.length) +
    " reconciled_closed=" + reconciled +
    " opened_scan_complete=" + openedScanComplete +
    (reconcileError ? " reconcile_error=" + reconcileError : "")
  );
  // Report the count actually persisted (0 on error) so the caller/smoke is honest.
  return { claims: upsertError ? 0 : deduped.length, error: upsertError, reconciled, reconcile_error: reconcileError };
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const guard = requireServiceRole(req);
  if (guard) return guard;

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    // Fetch all ml_users with refresh_token (active sellers)
    const { data: tokenRows, error: tokErr } = await sb
      .from("ml_tokens")
      .select("ml_user_id,user_id,organization_id,seller_id")
      .not("refresh_token", "is", null);

    if (tokErr) return json({ ok: false, error: tokErr.message }, 500);
    if (!tokenRows || tokenRows.length === 0) return json({ ok: true, msg: "no active users" });

    const results: any[] = [];
    for (const row of tokenRows) {
      try {
        const counts = await syncUser(sb, row);
        results.push({ ml_user_id: row.ml_user_id, ...counts });
      } catch (e: any) {
        console.error("sync-ml-claims ml_user_id=" + row.ml_user_id + " error:", e.message);
        results.push({ ml_user_id: row.ml_user_id, error: e.message });
      }
    }

    return json({ ok: true, results });

  } catch (err: any) {
    console.error("sync-ml-claims error:", err);
    return json({ ok: false, error: err.message }, 500);
  }
});
