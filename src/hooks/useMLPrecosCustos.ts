import { useState, useEffect, useCallback, useMemo } from "react";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

// ── Types ────────────────────────────────────────────────────────────────────

export interface MLItemPrice {
  item_id: string;
  title: string;
  thumbnail: string;
  category_id: string;
  listing_type_id: string;
  price_standard: number;
  price_promo: number | null;
  price_sale: number;
  currency_id: string;
  last_updated: string | null;
  has_promotion: boolean;
}

export interface MLListingCost {
  listing_type_id: string;
  listing_type_name: string;
  listing_exposure: string;
  sale_fee_amount: number;
  percentage_fee: number;
  fixed_fee: number;
  financing_add_on_fee: number;
  currency_id: string;
}

/** Detalhe de sugestão competitiva para um item específico */
export interface MLItemSuggestion {
  item_id: string;
  status: string;
  currency_id: string;
  current_price: number;
  suggested_price: number | null;
  lowest_price: number | null;
  internal_price: number | null;
  percent_difference: number;
  applicable_suggestion: boolean;
  selling_fees: number;
  shipping_fees: number;
  graph: Array<{
    price: { amount: number };
    info: { title: string; sold_quantity: number };
  }>;
  compared_values: number;
  last_updated: string | null;
}

// ── Module-level cache ────────────────────────────────────────────────────────

interface PrecosCache {
  items: MLItemPrice[];
  itemsTotal: number;
  fetchedAt: number;
}

const cache = new Map<string, PrecosCache>();
const CACHE_TTL_MS = 60 * 1000; // 1 min — preços mudam com promoções

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface UseMLPrecosCustosResult {
  /** Lista de anúncios ativos — usada para o seletor de produto em Referências */
  items: MLItemPrice[];
  itemsTotal: number;
  loading: boolean;
  isRealData: boolean;
  connected: boolean;
  refresh: () => Promise<void>;
  refreshing: boolean;
  /** Busca sugestão competitiva de um item específico */
  fetchItemSuggestion: (itemId: string, mlUserId?: string) => Promise<{ suggestion: MLItemSuggestion | null; no_suggestion: boolean }>;
  /** Busca preço efetivo de venda incluindo promoções ativas */
  fetchSalePrice: (itemId: string, mlUserId?: string) => Promise<{ price_sale: number | null; price_regular: number | null }>;
  /** Busca comissões com parâmetros dinâmicos (para a Calculadora) */
  fetchCosts: (params: {
    price: number;
    categoryId?: string;
    logisticType?: string;
    shippingMode?: string;
  }) => Promise<MLListingCost[]>;
}

export function useMLPrecosCustos(): UseMLPrecosCustosResult {
  const { stores, selectedStore, loading: storeLoading, scopeKey } = useMLStore();
  const { user } = useAuth();

  const [items, setItems] = useState<MLItemPrice[]>([]);
  const [itemsTotal, setItemsTotal] = useState(0);
  const [isRealData, setIsRealData] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const connected = stores.length > 0;

  const storeId = useMemo(() => {
    if (selectedStore !== "all" && selectedStore) return selectedStore;
    if (stores.length > 0) return stores[0].ml_user_id;
    return null;
  }, [selectedStore, stores]);

  const cacheKey = `${scopeKey}:precos-custos`;

  const getAuthHeaders = useCallback(async () => {
    const session = await supabase.auth.getSession();
    const accessToken = session.data.session?.access_token;
    if (!accessToken) return null;
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    return {
      Authorization: `Bearer ${accessToken}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "",
      _baseUrl: `https://${projectId}.supabase.co/functions/v1/ml-precos-custos`,
    };
  }, []);

  const callEdgeFn = useCallback(
    async (type: string, extraParams?: Record<string, string>, mlUserIdOverride?: string) => {
      const effectiveId = mlUserIdOverride ?? storeId;
      if (!effectiveId) return null;
      const auth = await getAuthHeaders();
      if (!auth) return null;

      const { _baseUrl, ...headers } = auth;
      const params = new URLSearchParams({ ml_user_id: effectiveId, type, ...extraParams });
      const res = await fetch(`${_baseUrl}?${params}`, { headers });
      if (!res.ok) {
        console.warn(`ml-precos-custos [${type}]: ${res.status}`);
        return null;
      }
      return res.json();
    },
    [storeId, getAuthHeaders],
  );

  const fetchAll = useCallback(
    async (force = false) => {
      if (!connected || !user || !storeId) return;

      const cached = cache.get(cacheKey);
      const cacheValid = !!(cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS);
      if (cacheValid && !force) {
        setItems(cached.items);
        setItemsTotal(cached.itemsTotal);
        setIsRealData(true);
        return;
      }

      setLoading(true);
      try {
        // type=items: leve (2 requests), ideal para popular o seletor
        const data = await callEdgeFn("items");
        const newItems: MLItemPrice[] = data?.items ?? [];
        const newTotal: number = data?.total ?? 0;

        setItems(newItems);
        setItemsTotal(newTotal);
        setIsRealData(true);
        cache.set(cacheKey, {
          items: newItems,
          itemsTotal: newTotal,
          fetchedAt: Date.now(),
        });
        console.log(`ml-precos-custos: loaded ${newItems.length} items`);
      } catch (err) {
        console.warn("ml-precos-custos: fetch error", err);
      } finally {
        setLoading(false);
      }
    },
    [connected, user, storeId, cacheKey, callEdgeFn],
  );

  /** Busca sugestão competitiva de preço para um item específico */
  const fetchItemSuggestion = useCallback(
    async (itemId: string, mlUserId?: string): Promise<{ suggestion: MLItemSuggestion | null; no_suggestion: boolean }> => {
      const data = await callEdgeFn("references", { item_id: itemId }, mlUserId);
      if (!data) return { suggestion: null, no_suggestion: true };
      return {
        suggestion: data.reference ?? null,
        no_suggestion: data.no_suggestion ?? !data.reference,
      };
    },
    [callEdgeFn],
  );

  /** Busca preço efetivo de venda incluindo promoções ativas de canal */
  const fetchSalePrice = useCallback(
    async (itemId: string, mlUserId?: string): Promise<{ price_sale: number | null; price_regular: number | null }> => {
      const data = await callEdgeFn("sale_price", { item_id: itemId }, mlUserId);
      if (!data) return { price_sale: null, price_regular: null };
      return { price_sale: data.price_sale ?? null, price_regular: data.price_regular ?? null };
    },
    [callEdgeFn],
  );

  /** Busca comissões com parâmetros dinâmicos (para a Calculadora) */
  const fetchCosts = useCallback(
    async ({
      price,
      categoryId,
      logisticType,
      shippingMode,
    }: {
      price: number;
      categoryId?: string;
      logisticType?: string;
      shippingMode?: string;
    }): Promise<MLListingCost[]> => {
      const extra: Record<string, string> = { price: String(price) };
      if (categoryId) extra.category_id = categoryId;
      if (logisticType) extra.logistic_type = logisticType;
      if (shippingMode) extra.shipping_mode = shippingMode;

      const data = await callEdgeFn("costs", extra);
      return data?.costs ?? [];
    },
    [callEdgeFn],
  );

  // Reset when store/seller changes
  useEffect(() => {
    setItems([]);
    setItemsTotal(0);
    setIsRealData(false);
  }, [scopeKey]);

  // Auto-fetch on mount
  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll(true);
    setRefreshing(false);
  }, [fetchAll]);

  return {
    items,
    itemsTotal,
    loading: storeLoading || loading,
    isRealData,
    connected,
    refresh,
    refreshing,
    fetchItemSuggestion,
    fetchSalePrice,
    fetchCosts,
  };
}
