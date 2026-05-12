/**
 * React Query wrappers for ML cache data.
 * Replaces manual useState/useCallback in useMLDataLoader.
 */
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import { fetchDailyCache, fetchHourlyCache, fetchUserCache, fetchStateDailyCache } from "@/services/mlCacheService";
import { mapDailyRow, mapHourlyRow } from "@/types/mlCache";
import type { DailyBreakdown, HourlyBreakdown, MLUser, StateDailyRow } from "@/types/mlCache";
import type { ProductSalesRow } from "@/components/mercadolivre/TopSellingProducts";

export type { DailyBreakdown, HourlyBreakdown, MLUser };

// ── Query key factories ─────────────────────────────────────────────────────

export const mlKeys = {
  daily: (userId: string, mlIds: string[], from: string, to: string, store: string) =>
    ["ml", "daily", userId, mlIds, from, to, store] as const,
  hourly: (userId: string, mlIds: string[], store: string, targetDate: string | null) =>
    ["ml", "hourly", userId, mlIds, store, targetDate] as const,
  products: (userId: string, mlIds: string[], from: string, to: string, store: string) =>
    ["ml", "products", userId, mlIds, from, to, store] as const,
  userInfo: (userId: string, mlIds: string[], store: string) =>
    ["ml", "userInfo", userId, mlIds, store] as const,
  state: (userId: string, mlIds: string[], from: string, to: string, store: string) =>
    ["ml", "state", userId, mlIds, from, to, store] as const,
};

// ── useMLDailyQuery ─────────────────────────────────────────────────────────

export function useMLDailyQuery(fetchFrom: string, fetchTo: string) {
  const { user } = useAuth();
  const { currentOrg } = useOrganization();
  const { selectedStore, resolvedMLUserIds } = useMLStore();
  const userId = user?.id ?? "";
  const orgId = currentOrg?.id ?? null;

  return useQuery({
    queryKey: mlKeys.daily(userId, resolvedMLUserIds, fetchFrom, fetchTo, selectedStore),
    queryFn: async () => {
      const rows = await fetchDailyCache(userId, orgId, resolvedMLUserIds, fetchFrom, fetchTo, selectedStore);
      return rows.map(mapDailyRow);
    },
    enabled: !!userId && resolvedMLUserIds.length > 0 && !!fetchFrom,
    staleTime: 2 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

// ── useMLHourlyQuery ────────────────────────────────────────────────────────

export function useMLHourlyQuery(
  isHourlyAvailable: boolean,
  hourlyTargetDate: string | null,
) {
  const { user } = useAuth();
  const { currentOrg } = useOrganization();
  const { selectedStore, resolvedMLUserIds } = useMLStore();
  const userId = user?.id ?? "";
  const orgId = currentOrg?.id ?? null;
  const targetDate = isHourlyAvailable && hourlyTargetDate ? hourlyTargetDate : null;

  return useQuery({
    queryKey: mlKeys.hourly(userId, resolvedMLUserIds, selectedStore, targetDate),
    queryFn: async () => {
      const rows = await fetchHourlyCache(userId, orgId, resolvedMLUserIds, selectedStore, targetDate);
      return rows.map(mapHourlyRow);
    },
    enabled: !!userId && resolvedMLUserIds.length > 0,
    staleTime: 2 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

// ── useMLProductsQuery (via Edge Function) ──────────────────────────────────

export function useMLProductsQuery(dateFrom: string, dateTo: string) {
  const { user } = useAuth();
  const { selectedStore, resolvedMLUserIds } = useMLStore();
  const userId = user?.id ?? "";

  const mlUserIds =
    selectedStore !== "all" ? [selectedStore] : resolvedMLUserIds;

  return useQuery({
    queryKey: mlKeys.products(userId, mlUserIds, dateFrom, dateTo, selectedStore),
    queryFn: async (): Promise<(ProductSalesRow & { date?: string })[]> => {
      const { data, error } = await supabase.functions.invoke(
        "ml-products-aggregated",
        {
          body: {
            date_from: dateFrom,
            date_to: dateTo,
            ml_user_ids: mlUserIds,
            limit: 50,
            offset: 0,
          },
        },
      );
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Products query failed");
      return data.products as ProductSalesRow[];
    },
    enabled: !!userId && mlUserIds.length > 0 && !!dateFrom && !!dateTo,
    staleTime: 3 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

// ── useMLUserQuery ──────────────────────────────────────────────────────────

export function useMLUserQuery() {
  const { user } = useAuth();
  const { currentOrg } = useOrganization();
  const { selectedStore, resolvedMLUserIds } = useMLStore();
  const userId = user?.id ?? "";
  const orgId = currentOrg?.id ?? null;

  return useQuery({
    queryKey: mlKeys.userInfo(userId, resolvedMLUserIds, selectedStore),
    queryFn: async (): Promise<MLUser | null> => {
      const data = await fetchUserCache(userId, orgId, resolvedMLUserIds, selectedStore);
      if (!data) return null;
      return {
        id: data.ml_user_id,
        nickname: data.nickname ?? "",
        country: data.country ?? "",
        permalink: data.permalink ?? "",
      };
    },
    enabled: !!userId && resolvedMLUserIds.length > 0,
    staleTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

// ── useMLMonthlyDailyQuery ──────────────────────────────────────────────────
// Always fetches the full current month regardless of the period filter.
// Used exclusively by GoalsCard so "Metas do Mês" always shows month-to-date.

export function useMLMonthlyDailyQuery() {
  const { user } = useAuth();
  const { currentOrg } = useOrganization();
  const { selectedStore, resolvedMLUserIds } = useMLStore();
  const userId = user?.id ?? "";
  const orgId = currentOrg?.id ?? null;

  const today = new Date();
  const monthFrom = format(new Date(today.getFullYear(), today.getMonth(), 1), "yyyy-MM-dd");
  const monthTo = format(today, "yyyy-MM-dd");

  return useQuery({
    queryKey: mlKeys.daily(userId, resolvedMLUserIds, monthFrom, monthTo, selectedStore),
    queryFn: async () => {
      const rows = await fetchDailyCache(userId, orgId, resolvedMLUserIds, monthFrom, monthTo, selectedStore);
      return rows.map(mapDailyRow);
    },
    enabled: !!userId && resolvedMLUserIds.length > 0,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

// ── useMLStateQuery ─────────────────────────────────────────────────────────

export function useMLStateQuery(dateFrom: string, dateTo: string) {
  const { user } = useAuth();
  const { currentOrg } = useOrganization();
  const { selectedStore, resolvedMLUserIds } = useMLStore();
  const userId = user?.id ?? "";
  const orgId = currentOrg?.id ?? null;

  return useQuery({
    queryKey: mlKeys.state(userId, resolvedMLUserIds, dateFrom, dateTo, selectedStore),
    queryFn: async (): Promise<StateDailyRow[]> => {
      return fetchStateDailyCache(userId, orgId, resolvedMLUserIds, dateFrom, dateTo, selectedStore);
    },
    enabled: !!userId && resolvedMLUserIds.length > 0 && !!dateFrom && !!dateTo,
    staleTime: 3 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

// ── Invalidation helper ─────────────────────────────────────────────────────

export function useInvalidateMLQueries() {
  const queryClient = useQueryClient();
  return {
    invalidateAll: () => queryClient.invalidateQueries({ queryKey: ["ml"] }),
    invalidateDaily: () => queryClient.invalidateQueries({ queryKey: ["ml", "daily"] }),
    invalidateHourly: () => queryClient.invalidateQueries({ queryKey: ["ml", "hourly"] }),
    invalidateProducts: () => queryClient.invalidateQueries({ queryKey: ["ml", "products"] }),
    invalidateUser: () => queryClient.invalidateQueries({ queryKey: ["ml", "userInfo"] }),
  };
}
