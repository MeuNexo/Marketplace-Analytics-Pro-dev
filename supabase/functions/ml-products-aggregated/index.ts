import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const QuerySchema = z.object({
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ml_user_ids: z.array(z.string().min(1)).min(1),
  limit: z.number().int().min(1).max(200).optional().default(50),
  offset: z.number().int().min(0).max(10000).optional().default(0),
});

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !userData?.user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const userId = userData.user.id;

    const { data: orgMemberships, error: orgMembershipsError } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", userId);
    if (orgMembershipsError) {
      console.error("Organization membership lookup error:", orgMembershipsError);
      return jsonResponse({ error: "Organization lookup failed" }, 500);
    }
    const organizationIds = Array.from(
      new Set((orgMemberships || []).map((row: any) => row.organization_id).filter(Boolean)),
    );

    // Parse and validate body
    const body = await req.json();
    const parsed = QuerySchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse({ error: "Invalid input", details: parsed.error.flatten().fieldErrors }, 400);
    }

    const { date_from, date_to, ml_user_ids, limit, offset } = parsed.data;

    // Fetch ALL daily rows in the period across all selected stores, paginating
    // to bypass the default 1000-row limit. We must NOT order by revenue and
    // slice, otherwise stores with higher per-day revenue (e.g. SP) crowd out
    // smaller stores (e.g. MG) before aggregation.
    const PAGE = 1000;
    const MAX_ROWS = 50000;
    const data: Array<{
      item_id: string;
      title: string | null;
      thumbnail: string | null;
      qty_sold: number | null;
      revenue: number | null;
      ml_user_id: string | null;
      date: string;
      synced_at?: string | null;
    }> = [];
    // Guard: if no scope filters can be built, return empty immediately
    const orFilterParts: string[] = [];
    if (ml_user_ids.length > 0) orFilterParts.push(`ml_user_id.in.(${ml_user_ids.join(",")})`);
    if (organizationIds.length > 0) orFilterParts.push(`organization_id.in.(${organizationIds.join(",")})`);
    if (orFilterParts.length === 0) {
      return jsonResponse({ success: true, products: [], total_raw_rows: 0, deduped_rows: 0, aggregated_count: 0 });
    }
    const orFilter = orFilterParts.join(",");

    let from = 0;
    while (from < MAX_ROWS) {
      const { data: page, error } = await supabase
        .from("ml_product_daily_cache")
        .select("item_id, title, thumbnail, qty_sold, revenue, ml_user_id, date, synced_at")
        .or(orFilter)
        .gte("date", date_from)
        .lte("date", date_to)
        .order("date", { ascending: true })
        .order("synced_at", { ascending: false })
        .range(from, from + PAGE - 1);

      if (error) {
        console.error("Query error:", error);
        return jsonResponse({ error: "Database query failed" }, 500);
      }

      if (!page || page.length === 0) break;
      data.push(...(page as any));
      if (page.length < PAGE) break;
      from += PAGE;
    }

    // ── Global dedup ────────────────────────────────────────────────────────────
    // The per-chunk seen-Set inside the while loop only deduplicates within a
    // single iteration.  When the dual-scope query (user + org) returns
    // overlapping rows across different pagination offsets, or when null-org
    // rows (from pre-org syncs) coexist with org-scoped rows for the same
    // product/day, duplicate (ml_user_id, date, item_id) entries can slip
    // through into `data` and inflate qty_sold / revenue in aggMap.
    //
    // Fix: one final pass that keeps only the most-recently-synced row per
    // (ml_user_id, date, item_id) before aggregating.
    const globalDedup = new Map<string, typeof data[0]>();
    for (const row of data) {
      const key = `${row.ml_user_id || ""}:${row.date}:${row.item_id}`;
      const existing = globalDedup.get(key);
      if (!existing || String(row.synced_at || "") > String(existing.synced_at || "")) {
        globalDedup.set(key, row);
      }
    }
    const dedupedData = Array.from(globalDedup.values());

    // Aggregate in-memory (server-side, not client-side)
    const aggMap: Record<string, {
      item_id: string;
      title: string;
      thumbnail: string | null;
      qty_sold: number;
      revenue: number;
      ml_user_id: string;
    }> = {};

    for (const row of dedupedData) {
      const key = row.item_id;
      if (!aggMap[key]) {
        aggMap[key] = {
          item_id: row.item_id,
          title: row.title || "",
          thumbnail: row.thumbnail,
          qty_sold: 0,
          revenue: 0,
          ml_user_id: row.ml_user_id || "",
        };
      }
      aggMap[key].qty_sold += Number(row.qty_sold || 0);
      aggMap[key].revenue += Number(row.revenue || 0);
    }

    const aggregated = Object.values(aggMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);

    return jsonResponse({
      success: true,
      products: aggregated,
      total_raw_rows: data.length,
      deduped_rows: dedupedData.length,
      aggregated_count: aggregated.length,
    });
  } catch (err: any) {
    console.error("ml-products-aggregated error:", err);
    return jsonResponse({ error: err.message || "Internal error" }, 500);
  }
});
