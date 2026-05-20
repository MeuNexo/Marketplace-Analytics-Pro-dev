/**
 * sync-ml-inventory — background inventory sync edge function
 * Fetches all active+paused items from ML API for a given ml_user_id and
 * upserts the results into ml_inventory_cache.
 *
 * Auth: Bearer service-role-key OR X-Cron-Secret (via get_cron_secret() RPC).
 * Called by process-sync-job when processing inventory job_type.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ML_API       = "https://api.mercadolibre.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function mlFetch(path: string, accessToken: string) {
  const res = await fetch(`${ML_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `ML API error: ${res.status}`);
  return data;
}

async function fetchItemIdsByStatus(sellerId: number, status: string, token: string): Promise<string[]> {
  const ids: string[] = [];
  let offset = 0;
  const PAGE_SIZE = 100;
  while (true) {
    const search = await mlFetch(
      `/users/${sellerId}/items/search?status=${status}&limit=${PAGE_SIZE}&offset=${offset}`,
      token,
    );
    const results: string[] = search.results || [];
    ids.push(...results);
    const total: number = search.paging?.total || 0;
    offset += PAGE_SIZE;
    if (results.length < PAGE_SIZE || offset >= total || offset >= 10000) break;
  }
  return ids;
}

// Returns null = authorized, Response = denied.
// Accepted forms:
//   1. Bearer service-role-key (pg_cron / process-sync-job)
//   2. X-Cron-Secret from vault (pg_cron alternate)
//   3. Bearer user JWT (frontend manual sync) → returns the authenticated user id
async function authenticate(req: Request): Promise<{ error: Response } | { userId: string | null }> {
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!svcKey) return { userId: null }; // dev local — skip guard

  const auth = req.headers.get("authorization") ?? "";

  // Form 1: service role key
  if (auth === "Bearer " + svcKey) return { userId: null };

  // Form 2: X-Cron-Secret
  const xCronSecret = req.headers.get("x-cron-secret") ?? "";
  if (xCronSecret) {
    try {
      const sb = createClient(SUPABASE_URL, svcKey);
      const { data: cronSecret } = await sb.rpc("get_cron_secret");
      if (cronSecret && xCronSecret === cronSecret) return { userId: null };
    } catch (e) {
      console.error("sync-ml-inventory vault lookup error:", e);
    }
  }

  // Form 3: authenticated user JWT (frontend manual sync button)
  if (auth.startsWith("Bearer ") && auth !== "Bearer " + svcKey) {
    const sb = createClient(SUPABASE_URL, svcKey);
    const { data: authData } = await sb.auth.getUser(auth.replace("Bearer ", ""));
    if (authData?.user?.id) return { userId: authData.user.id };
  }

  return { error: new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { ...CORS, "Content-Type": "application/json" },
  }) };
}

async function checkAndIncrementQuota(sb: ReturnType<typeof createClient>, organizationId: string): Promise<Response | null> {
  const today = new Date().toISOString().slice(0, 10);

  // Get plan limit
  const { data: plan } = await sb
    .from("organization_plans")
    .select("sync_interval_minutes")
    .eq("organization_id", organizationId)
    .maybeSingle();

  // -1 = unlimited (enterprise); null = no plan = treat as unlimited for safety
  const limit = plan?.sync_interval_minutes ?? -1;
  if (limit === -1) return null; // enterprise: no quota check

  // Upsert today's count and check
  const { data: quota } = await sb
    .from("sync_quota_daily")
    .upsert({ organization_id: organizationId, date: today, sync_count: 1 }, {
      onConflict: "organization_id,date",
      ignoreDuplicates: false,
    })
    .select("sync_count")
    .maybeSingle();

  // Simple limit: 1440/sync_interval_minutes syncs per day
  const dailyLimit = Math.max(1, Math.floor(1440 / limit));
  if (quota && quota.sync_count > dailyLimit) {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    return new Response(JSON.stringify({
      error: "sync_limit_reached",
      resets_at: tomorrow.toISOString(),
    }), { status: 429, headers: { ...CORS, "Content-Type": "application/json" } });
  }
  return null;
}

const resolveSku = (obj: any): string | null =>
  obj.seller_custom_field
    ?? (obj.attributes as any[] | undefined)?.find((a: any) => a.id === "SELLER_SKU")?.value_name
    ?? null;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const authResult = await authenticate(req);
  if ("error" in authResult) return authResult.error;

  let body: { ml_user_id?: string };
  try { body = await req.json(); } catch { body = {}; }
  const ml_user_id = body.ml_user_id;
  if (!ml_user_id) return json({ error: "ml_user_id is required" }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // Lookup token
  const { data: tokenRow } = await sb
    .from("ml_tokens")
    .select("access_token, organization_id")
    .eq("ml_user_id", ml_user_id)
    .not("access_token", "is", null)
    .limit(1)
    .maybeSingle();

  if (!tokenRow?.access_token) {
    return json({ error: "No ML token found", ml_user_id }, 404);
  }

  const { access_token, organization_id } = tokenRow;

  // If triggered by a user (not service role), validate org membership + quota
  if (authResult.userId) {
    const { data: isMember } = await sb.rpc("is_org_member", {
      _user_id: authResult.userId,
      _org_id:  organization_id,
    });
    if (!isMember) return json({ error: "Forbidden" }, 403);

    const quotaErr = await checkAndIncrementQuota(sb, organization_id);
    if (quotaErr) return quotaErr;
  }

  const sellerId = Number(ml_user_id);

  // Fetch item IDs (active + paused)
  const activeIds = await fetchItemIdsByStatus(sellerId, "active", access_token);
  let pausedIds: string[] = [];
  try { pausedIds = await fetchItemIdsByStatus(sellerId, "paused", access_token); } catch { /* non-fatal */ }
  const allItemIds = [...new Set([...activeIds, ...pausedIds])];

  console.log(`sync-ml-inventory: ${ml_user_id} — ${activeIds.length} active + ${pausedIds.length} paused = ${allItemIds.length} total`);

  // Multi-get details in batches of 20
  const rows: any[] = [];
  for (let i = 0; i < allItemIds.length; i += 20) {
    const batch = allItemIds.slice(i, i + 20);
    const multiGet = await mlFetch(
      `/items?ids=${batch.join(",")}&attributes=id,title,available_quantity,sold_quantity,price,currency_id,thumbnail,status,category_id,listing_type_id,health,variations,attributes,seller_custom_field,shipping,catalog_product_id,deal_ids`,
      access_token,
    );
    for (const entry of multiGet) {
      if (entry.code === 200 && entry.body) {
        const b = entry.body;
        const brandAttr = (b.attributes || []).find((a: any) => a.id === "BRAND");
        const rawVars: any[] = b.variations || [];
        const variations = rawVars.map((v: any) => ({
          variation_id: String(v.id),
          attribute_combinations: (v.attribute_combinations || []).map((a: any) => ({
            id: a.id, name: a.name, value: a.value_name,
          })),
          available_quantity: v.available_quantity ?? 0,
          sold_quantity:      v.sold_quantity ?? 0,
          price:              v.price ?? b.price ?? 0,
          picture_id:         v.picture_ids?.[0] ?? null,
          seller_custom_field: resolveSku(v),
        }));
        rows.push({
          organization_id,
          ml_user_id,
          item_id:             b.id,
          title:               b.title ?? null,
          status:              b.status ?? null,
          available_quantity:  b.available_quantity ?? 0,
          sold_quantity:       b.sold_quantity ?? 0,
          price:               b.price ?? null,
          currency_id:         b.currency_id ?? "BRL",
          thumbnail:           b.thumbnail ?? null,
          category_id:         b.category_id ?? null,
          listing_type_id:     b.listing_type_id ?? null,
          health:              b.health ?? null,
          visits:              0,
          brand:               brandAttr?.value_name ?? null,
          seller_custom_field: resolveSku(b),
          has_variations:      rawVars.length > 1,
          variations,
          logistic_type:       b.shipping?.logistic_type ?? null,
          free_shipping:       b.shipping?.free_shipping ?? false,
          catalog_product_id:  b.catalog_product_id ?? null,
          deal_ids:            Array.isArray(b.deal_ids) ? b.deal_ids : [],
          synced_at:           new Date().toISOString(),
        });
      }
    }
  }

  // Upsert in batches of 100
  let upserted = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { error } = await sb
      .from("ml_inventory_cache")
      .upsert(batch, { onConflict: "organization_id,ml_user_id,item_id" });
    if (error) throw new Error(`upsert error: ${error.message}`);
    upserted += batch.length;
  }

  return json({ ok: true, ml_user_id, upserted, total_items: allItemIds.length });
});
