import { supabase } from "@/integrations/supabase/client";
import type { DailyRow, HourlyRow, ProductDailyRow, MLUserCacheRow, StateDailyRow } from "@/types/mlCache";

// ── Fetch functions ────────────────────────────────────────────────────────────

export type { DailyRow, HourlyRow, ProductDailyRow, MLUserCacheRow, StateDailyRow };

type ScopeColumn = "user_id" | "organization_id";

type RowWithSync = {
  synced_at?: string | null;
  ml_user_id?: string | null;
  date?: string | null;
  hour?: number | null;
  item_id?: string | null;
  uf?: string | null;
};

function dedupeLatestRows<T extends RowWithSync>(rows: T[], getKey: (row: T) => string): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const row of rows) {
    const key = getKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }

  return deduped;
}

async function fetchScopedRows<T extends RowWithSync>(params: {
  userId: string;
  organizationId?: string | null;
  buildQuery: (scopeColumn: ScopeColumn, scopeValue: string) => any;
  dedupeKey?: (row: T) => string;
}): Promise<T[]> {
  const { userId, organizationId, buildQuery, dedupeKey } = params;

  const { data: ownRows, error: ownError } = await buildQuery("user_id", userId);
  if (ownError) throw ownError;

  const ownList = (ownRows || []) as T[];
  if (ownList.length > 0 || !organizationId) {
    return ownList;
  }

  const { data: orgRows, error: orgError } = await buildQuery("organization_id", organizationId);
  if (orgError) throw orgError;

  const orgList = (orgRows || []) as T[];
  return dedupeKey ? dedupeLatestRows(orgList, dedupeKey) : orgList;
}

export async function fetchDailyCache(
  userId: string,
  organizationId: string | null | undefined,
  mlUserIds: string[],
  dateFrom: string,
  dateTo: string,
  selectedStore: string,
): Promise<DailyRow[]> {
  const rows = await fetchScopedRows<DailyRow & RowWithSync>({
    userId,
    organizationId,
    buildQuery: (scopeColumn, scopeValue) => {
      let query = (supabase as any)
        .from("ml_daily_cache")
        .select("*")
        .eq(scopeColumn, scopeValue)
        .gte("date", dateFrom)
        .lte("date", dateTo)
        .order("date", { ascending: false })
        .order("synced_at", { ascending: false })
        .limit(2000);

      if (selectedStore !== "all") {
        query = query.eq("ml_user_id", selectedStore);
      } else {
        query = query.in("ml_user_id", mlUserIds);
      }

      return query;
    },
    dedupeKey: (row) => `${row.ml_user_id ?? ""}:${row.date ?? ""}`,
  });

  return rows as DailyRow[];
}

export async function fetchHourlyCache(
  userId: string,
  organizationId: string | null | undefined,
  mlUserIds: string[],
  selectedStore: string,
  targetDate: string | null,
): Promise<HourlyRow[]> {
  const scopedLimit = targetDate
    ? 24 * Math.max(mlUserIds.length, 1) * 5
    : 1000;

  const rows = await fetchScopedRows<HourlyRow & RowWithSync>({
    userId,
    organizationId,
    buildQuery: (scopeColumn, scopeValue) => {
      let query = (supabase as any)
        .from("ml_hourly_cache")
        .select("*")
        .eq(scopeColumn, scopeValue);

      if (selectedStore !== "all") {
        query = query.eq("ml_user_id", selectedStore);
      } else {
        query = query.in("ml_user_id", mlUserIds);
      }

      query = query
        .order("date", { ascending: false })
        .order("synced_at", { ascending: false })
        .order("hour", { ascending: true });

      if (targetDate) {
        query = query.eq("date", targetDate).limit(scopedLimit);
      } else {
        query = query.limit(scopedLimit);
      }

      return query;
    },
    dedupeKey: (row) => `${row.ml_user_id ?? ""}:${row.date ?? ""}:${row.hour ?? ""}`,
  });

  return rows as HourlyRow[];
}

export async function fetchProductDailyCache(
  userId: string,
  organizationId: string | null | undefined,
  mlUserIds: string[],
  dateFrom: string,
  dateTo: string,
  selectedStore: string,
): Promise<ProductDailyRow[]> {
  const rows = await fetchScopedRows<(ProductDailyRow & RowWithSync & Record<string, any>)>({
    userId,
    organizationId,
    buildQuery: (scopeColumn, scopeValue) => {
      let query = (supabase as any)
        .from("ml_product_daily_cache")
        .select("*")
        .eq(scopeColumn, scopeValue)
        .gte("date", dateFrom)
        .lte("date", dateTo)
        .order("revenue", { ascending: false })
        .order("synced_at", { ascending: false })
        .limit(5000);

      if (selectedStore !== "all") {
        query = query.eq("ml_user_id", selectedStore);
      } else {
        query = query.in("ml_user_id", mlUserIds);
      }

      return query;
    },
    dedupeKey: (row) => `${row.ml_user_id ?? ""}:${row.date ?? ""}:${row.item_id ?? ""}`,
  });

  return rows.map((r: any) => ({
    item_id: r.item_id,
    date: r.date,
    title: r.title || "",
    thumbnail: r.thumbnail,
    qty_sold: Number(r.qty_sold || 0),
    revenue: Number(r.revenue || 0),
    ml_user_id: r.ml_user_id,
  }));
}

export async function fetchStateDailyCache(
  userId: string,
  organizationId: string | null | undefined,
  mlUserIds: string[],
  dateFrom: string,
  dateTo: string,
  selectedStore: string,
): Promise<StateDailyRow[]> {
  const rows = await fetchScopedRows<(StateDailyRow & RowWithSync & Record<string, any>)>({
    userId,
    organizationId,
    buildQuery: (scopeColumn, scopeValue) => {
      let query = (supabase as any)
        .from("ml_state_daily_cache")
        .select("*")
        .eq(scopeColumn, scopeValue)
        .gte("date", dateFrom)
        .lte("date", dateTo)
        .order("date", { ascending: false })
        .order("synced_at", { ascending: false })
        .limit(5000);

      if (selectedStore !== "all") {
        query = query.eq("ml_user_id", selectedStore);
      } else {
        query = query.in("ml_user_id", mlUserIds);
      }

      return query;
    },
    dedupeKey: (row) => `${row.ml_user_id ?? ""}:${row.date ?? ""}:${row.uf ?? ""}`,
  });

  return rows.map((r: any) => ({
    date: r.date,
    uf: r.uf,
    state_name: r.state_name || "",
    qty_orders: Number(r.qty_orders || 0),
    revenue: Number(r.revenue || 0),
    approved_revenue: Number(r.approved_revenue || 0),
    ml_user_id: r.ml_user_id,
  }));
}

export async function fetchUserCache(
  userId: string,
  organizationId: string | null | undefined,
  mlUserIds: string[],
  selectedStore: string,
): Promise<MLUserCacheRow | null> {
  const applyStoreFilters = (query: any) => {
    if (selectedStore !== "all") {
      return query.eq("ml_user_id", Number(selectedStore));
    }

    if (mlUserIds.length > 0) {
      return query.in("ml_user_id", mlUserIds.map(Number));
    }

    return query;
  };

  const ownQuery = applyStoreFilters(
    (supabase as any)
      .from("ml_user_cache")
      .select("*")
      .eq("user_id", userId)
      .order("synced_at", { ascending: false })
      .limit(1),
  );
  const { data: ownData, error: ownError } = await ownQuery.maybeSingle();
  if (ownError) throw ownError;
  if (ownData || !organizationId) return ownData as MLUserCacheRow | null;

  const orgQuery = applyStoreFilters(
    (supabase as any)
      .from("ml_user_cache")
      .select("*")
      .eq("organization_id", organizationId)
      .order("synced_at", { ascending: false })
      .limit(1),
  );
  const { data: orgData, error: orgError } = await orgQuery.maybeSingle();
  if (orgError) throw orgError;
  return orgData as MLUserCacheRow | null;
}

// ── Sync (Edge Function invocation) ────────────────────────────────────────────

export async function syncMLData(params: {
  mlUserId: string;
  dateFrom: string;
  dateTo: string;
  sellerId: string | null;
}) {
  const { data, error } = await supabase.functions.invoke("mercado-libre-integration", {
    body: {
      ml_user_id: params.mlUserId,
      date_from: params.dateFrom,
      date_to: params.dateTo,
      seller_id: params.sellerId,
    },
  });

  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || "Sync failed");
  return data;
}

export async function fetchInventory(mlUserId: string) {
  const { data, error } = await supabase.functions.invoke("ml-inventory", {
    body: { ml_user_id: mlUserId },
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

// ── Upsert (frontend → DB, used by saveToCache) ──────────────────────────────

export async function upsertDailyCache(
  userId: string,
  mlUserIdStr: string,
  dailyRows: Array<{
    date: string;
    total: number;
    approved: number;
    qty: number;
    cancelled: number;
    shipped: number;
    unique_visits: number;
    unique_buyers: number;
  }>,
) {
  const syncedAt = new Date().toISOString();
  const rows = dailyRows.map((d) => ({
    user_id: userId,
    ml_user_id: mlUserIdStr,
    date: d.date,
    total_revenue: d.total,
    approved_revenue: d.approved,
    qty_orders: d.qty,
    cancelled_orders: d.cancelled || 0,
    shipped_orders: d.shipped || 0,
    unique_visits: d.unique_visits || 0,
    unique_buyers: d.unique_buyers || 0,
    synced_at: syncedAt,
  }));

  for (let i = 0; i < rows.length; i += 200) {
    await supabase
      .from("ml_daily_cache")
      .upsert(rows.slice(i, i + 200), { onConflict: "user_id,ml_user_id,date" });
  }
}

export async function upsertSyncLog(
  userId: string,
  mlUserId: string,
  dateFrom: string,
  dateTo: string,
  daysCount: number,
) {
  const now = new Date().toISOString();
  await supabase.from("ml_sync_log").upsert(
    {
      user_id: userId,
      ml_user_id: mlUserId,
      date_from: dateFrom,
      date_to: dateTo,
      days_synced: daysCount,
      source: "auto",
      synced_at: now,
    },
    { onConflict: "user_id,ml_user_id,date_from,date_to,source" },
  );
}
