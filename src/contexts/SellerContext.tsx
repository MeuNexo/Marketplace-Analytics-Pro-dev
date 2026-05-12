import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { Seller, SellerStore, ALL_MARKETPLACES, buildSeller, generateInitials } from "@/types/seller";

interface AddStoreInput {
  marketplace: string;
  store_name: string;
  external_id?: string;
}

type MarketplaceEntry = typeof ALL_MARKETPLACES[number];

interface SellerContextType {
  sellers: Seller[];
  activeSellers: Seller[];
  selectedSeller: Seller | null;
  setSelectedSeller: (sellerId: string) => void;
  loading: boolean;
  // Marketplace selection (global, per-seller persisted)
  selectedMarketplace: string;
  setSelectedMarketplace: (id: string) => void;
  availableMarketplaces: MarketplaceEntry[];
  // Multi-store selection ([] = all stores)
  selectedStoreIds: string[];
  setSelectedStoreIds: (ids: string[]) => void;
  toggleStoreId: (id: string) => void;
  refreshSellers: () => Promise<void>;
  // Seller CRUD
  addSeller: (name: string) => Promise<Seller | null>;
  updateSeller: (id: string, data: { name?: string; is_active?: boolean; logo_url?: string | null }) => Promise<void>;
  deleteSeller: (id: string) => Promise<boolean>;
  // Store CRUD
  addStore: (sellerId: string, input: AddStoreInput) => Promise<SellerStore | null>;
  updateStore: (storeId: string, data: { store_name?: string; external_id?: string; is_active?: boolean }) => Promise<void>;
  deleteStore: (storeId: string) => Promise<void>;
  // Legacy helpers
  getActiveMarketplaces: () => MarketplaceEntry[];
  getMarketplaceById: (id: string) => MarketplaceEntry | undefined;
  toggleSellerActive: (id: string) => Promise<void>;
}

const SELECTED_SELLER_KEY = "selected_seller_id_v3";

function sellerMktKey(sellerId: string) {
  return `sel_${sellerId}_mkt`;
}

function sellerStoreIdsKey(sellerId: string) {
  return `sel_${sellerId}_storeIds`;
}

const SellerContext = createContext<SellerContextType | undefined>(undefined);

export function SellerProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { currentOrg } = useOrganization();
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSellerId, setSelectedSellerId] = useState<string | null>(
    () => localStorage.getItem(SELECTED_SELLER_KEY)
  );
  const [selectedMarketplace, setSelectedMarketplaceState] = useState<string>(() => {
    const savedSellerId = localStorage.getItem(SELECTED_SELLER_KEY);
    return savedSellerId ? (localStorage.getItem(sellerMktKey(savedSellerId)) ?? "all") : "all";
  });
  const [selectedStoreIds, setSelectedStoreIdsState] = useState<string[]>(() => {
    const savedSellerId = localStorage.getItem(SELECTED_SELLER_KEY);
    if (!savedSellerId) return [];
    try {
      const raw = localStorage.getItem(sellerStoreIdsKey(savedSellerId));
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const loadedRef = useRef(false);
  const prevSellerIdRef = useRef<string | null>(null);

  const loadSellers = useCallback(async () => {
    if (!user || !currentOrg) {
      setSellers([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [{ data: sellerRows }, { data: storeRows }] = await Promise.all([
        supabase
          .from("sellers" as any)
          .select("id, name, initials, logo_url, is_active, created_at")
          .eq("organization_id", currentOrg.id)
          .order("created_at", { ascending: true }),
        supabase
          .from("seller_stores" as any)
          .select("id, seller_id, marketplace, store_name, external_id, is_active, created_at")
          .eq("organization_id", currentOrg.id)
          .order("created_at", { ascending: true }),
      ]);

      const storesBySeller: Record<string, SellerStore[]> = {};
      for (const s of (storeRows as any[]) || []) {
        if (!storesBySeller[s.seller_id]) storesBySeller[s.seller_id] = [];
        storesBySeller[s.seller_id].push(s as SellerStore);
      }

      const built = ((sellerRows as any[]) || []).map((row) =>
        buildSeller(row, storesBySeller[row.id] || [])
      );

      setSellers(built);
    } catch (err) {
      console.error("Failed to load sellers:", err);
    } finally {
      setLoading(false);
    }
  }, [user, currentOrg]);

  useEffect(() => {
    if (!loadedRef.current) {
      loadedRef.current = true;
      loadSellers();
    }
  }, [loadSellers]);

  useEffect(() => {
    loadedRef.current = false;
    loadSellers();
  }, [user?.id, currentOrg?.id]);

  // Persist selected seller id
  useEffect(() => {
    if (selectedSellerId) {
      localStorage.setItem(SELECTED_SELLER_KEY, selectedSellerId);
    }
  }, [selectedSellerId]);

  const activeSellers = sellers.filter((s) => s.is_active);

  const selectedSeller: Seller | null =
    sellers.find((s) => s.id === selectedSellerId) ??
    activeSellers[0] ??
    sellers[0] ??
    null;

  // When seller changes, validate marketplace is still valid for new seller
  useEffect(() => {
    if (!selectedSeller) return;
    if (prevSellerIdRef.current === selectedSeller.id) return;
    prevSellerIdRef.current = selectedSeller.id;
    if (selectedMarketplace === "all") return;
    const validIds = [
      ...selectedSeller.stores.map((s) => s.marketplace),
      ...selectedSeller.stores.map((s) => s.id),
    ];
    if (!validIds.includes(selectedMarketplace)) {
      setSelectedMarketplaceState("all");
      const sid = selectedSeller.id;
      localStorage.setItem(sellerMktKey(sid), "all");
    }
  });

  const setSelectedSeller = useCallback((sellerId: string) => {
    setSelectedSellerId(sellerId);
    // Restore this seller's saved marketplace preference
    const saved = localStorage.getItem(sellerMktKey(sellerId));
    setSelectedMarketplaceState(saved ?? "all");
    // Reset multi-store selection on seller change
    setSelectedStoreIdsState([]);
    localStorage.setItem(sellerStoreIdsKey(sellerId), JSON.stringify([]));
  }, []);

  const setSelectedMarketplace = useCallback((id: string) => {
    setSelectedMarketplaceState(id);
    const sid = localStorage.getItem(SELECTED_SELLER_KEY);
    if (sid) localStorage.setItem(sellerMktKey(sid), id);
  }, []);

  const setSelectedStoreIds = useCallback((ids: string[]) => {
    setSelectedStoreIdsState(ids);
    const sid = localStorage.getItem(SELECTED_SELLER_KEY);
    if (sid) localStorage.setItem(sellerStoreIdsKey(sid), JSON.stringify(ids));
  }, []);

  const toggleStoreId = useCallback((id: string) => {
    setSelectedStoreIds(
      selectedStoreIds.includes(id)
        ? selectedStoreIds.filter((s) => s !== id)
        : [...selectedStoreIds, id]
    );
  }, [selectedStoreIds, setSelectedStoreIds]);

  // Marketplaces available for the currently selected seller
  const availableMarketplaces = (ALL_MARKETPLACES as unknown as MarketplaceEntry[]).filter((mp) =>
    selectedSeller?.stores.some((s) => s.marketplace === mp.id)
  );

  const addSeller = useCallback(async (name: string): Promise<Seller | null> => {
    if (!user || !currentOrg) return null;
    const initials = generateInitials(name);
    const { data, error } = await supabase
      .from("sellers" as any)
      .insert({ user_id: user.id, name, initials, is_active: true, organization_id: currentOrg.id })
      .select()
      .single();
    if (error || !data) { console.error(error); return null; }
    const newSeller = buildSeller(data as any, []);
    setSellers((prev) => [...prev, newSeller]);
    return newSeller;
  }, [user, currentOrg]);

  const updateSeller = useCallback(async (id: string, data: { name?: string; is_active?: boolean; logo_url?: string | null }) => {
    const updates: any = { ...data };
    if (data.name) updates.initials = generateInitials(data.name);
    const { error } = await supabase.from("sellers" as any).update(updates).eq("id", id);
    if (error) { console.error(error); return; }
    setSellers((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        return buildSeller(
          { ...s, ...updates, is_active: data.is_active ?? s.is_active },
          s.stores
        );
      })
    );
  }, []);

  const toggleSellerActive = useCallback(async (id: string) => {
    const seller = sellers.find((s) => s.id === id);
    if (!seller) return;
    await updateSeller(id, { is_active: !seller.is_active });
  }, [sellers, updateSeller]);

  const deleteSeller = useCallback(async (id: string): Promise<boolean> => {
    if (sellers.length <= 1) return false;
    const { error } = await supabase.from("sellers" as any).delete().eq("id", id);
    if (error) { console.error(error); return false; }
    setSellers((prev) => prev.filter((s) => s.id !== id));
    if (selectedSellerId === id) {
      const remaining = sellers.filter((s) => s.id !== id);
      setSelectedSellerId(remaining[0]?.id ?? null);
    }
    return true;
  }, [sellers, selectedSellerId]);

  const addStore = useCallback(async (sellerId: string, input: AddStoreInput): Promise<SellerStore | null> => {
    if (!currentOrg) return null;
    const { data, error } = await supabase
      .from("seller_stores" as any)
      .insert({
        seller_id: sellerId,
        marketplace: input.marketplace,
        store_name: input.store_name,
        external_id: input.external_id ?? null,
        is_active: true,
        organization_id: currentOrg.id,
      })
      .select()
      .single();
    if (error || !data) { console.error(error); return null; }
    const newStore = data as unknown as SellerStore;
    setSellers((prev) =>
      prev.map((s) => {
        if (s.id !== sellerId) return s;
        return buildSeller({ ...s }, [...s.stores, newStore]);
      })
    );
    return newStore;
  }, []);

  const updateStore = useCallback(async (
    storeId: string,
    data: { store_name?: string; external_id?: string; is_active?: boolean }
  ) => {
    const { error } = await supabase.from("seller_stores" as any).update(data).eq("id", storeId);
    if (error) { console.error(error); return; }
    setSellers((prev) =>
      prev.map((s) => {
        const storeIdx = s.stores.findIndex((st) => st.id === storeId);
        if (storeIdx === -1) return s;
        const updatedStores = s.stores.map((st) =>
          st.id === storeId ? { ...st, ...data } : st
        );
        return buildSeller({ ...s }, updatedStores);
      })
    );
  }, []);

  const deleteStore = useCallback(async (storeId: string) => {
    const { error } = await supabase.from("seller_stores" as any).delete().eq("id", storeId);
    if (error) { console.error(error); return; }
    setSellers((prev) =>
      prev.map((s) => {
        const has = s.stores.some((st) => st.id === storeId);
        if (!has) return s;
        return buildSeller({ ...s }, s.stores.filter((st) => st.id !== storeId));
      })
    );
  }, []);

  const getActiveMarketplaces = useCallback(() => {
    const mpIds = new Set(selectedSeller?.stores.map((s) => s.marketplace) ?? []);
    return (ALL_MARKETPLACES as unknown as MarketplaceEntry[]).filter((mp) => mpIds.has(mp.id));
  }, [selectedSeller]);

  const getMarketplaceById = useCallback((id: string) => {
    return (ALL_MARKETPLACES as unknown as MarketplaceEntry[]).find((mp) => mp.id === id);
  }, []);

  return (
    <SellerContext.Provider
      value={{
        sellers,
        activeSellers,
        selectedSeller,
        setSelectedSeller,
        loading,
        selectedMarketplace,
        setSelectedMarketplace,
        availableMarketplaces,
        selectedStoreIds,
        setSelectedStoreIds,
        toggleStoreId,
        refreshSellers: loadSellers,
        addSeller,
        updateSeller,
        deleteSeller,
        addStore,
        updateStore,
        deleteStore,
        getActiveMarketplaces,
        getMarketplaceById,
        toggleSellerActive,
      }}
    >
      {children}
    </SellerContext.Provider>
  );
}

export function useSeller() {
  const context = useContext(SellerContext);
  if (context === undefined) throw new Error("useSeller must be used within a SellerProvider");
  return context;
}
