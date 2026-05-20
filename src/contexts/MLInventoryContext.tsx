import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useToast } from "@/hooks/use-toast";

export interface ProductVariation {
  variation_id: string;
  attribute_combinations: { id: string; name: string; value: string }[];
  available_quantity: number;
  sold_quantity: number;
  price: number;
  picture_id: string | null;
  seller_custom_field: string | null;
}

export interface ProductItem {
  id: string;
  title: string;
  available_quantity: number;
  sold_quantity: number;
  price: number;
  currency_id: string;
  thumbnail: string | null;
  status: string;
  category_id: string | null;
  listing_type_id: string | null;
  health: number | null;
  visits: number;
  brand: string | null;
  seller_custom_field: string | null;
  has_variations: boolean;
  variations: ProductVariation[];
  logistic_type: string | null;
  free_shipping: boolean;
  catalog_product_id: string | null;
  deal_ids: string[];
  _ml_user_id?: string;
}

interface InventorySummary {
  totalItems: number;
  totalStock: number;
  outOfStock: number;
  lowStock: number;
}

interface MLInventoryState {
  items: ProductItem[];
  summary: InventorySummary | null;
  loading: boolean;
  syncing: boolean;
  hasToken: boolean | null;
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
  syncNow: () => Promise<void>;
}

const MLInventoryContext = createContext<MLInventoryState | null>(null);

function rowToItem(row: any): ProductItem {
  const rawVars: any[] = Array.isArray(row.variations) ? row.variations : [];
  return {
    id:                  row.item_id,
    title:               row.title ?? "",
    available_quantity:  row.available_quantity ?? 0,
    sold_quantity:       row.sold_quantity ?? 0,
    price:               row.price ?? 0,
    currency_id:         row.currency_id ?? "BRL",
    thumbnail:           row.thumbnail ?? null,
    status:              row.status ?? "unknown",
    category_id:         row.category_id ?? null,
    listing_type_id:     row.listing_type_id ?? null,
    health:              row.health ?? null,
    visits:              row.visits ?? 0,
    brand:               row.brand ?? null,
    seller_custom_field: row.seller_custom_field ?? null,
    has_variations:      row.has_variations ?? false,
    variations:          rawVars.map((v: any) => ({
      variation_id:          String(v.variation_id ?? ""),
      attribute_combinations: Array.isArray(v.attribute_combinations) ? v.attribute_combinations : [],
      available_quantity:    v.available_quantity ?? 0,
      sold_quantity:         v.sold_quantity ?? 0,
      price:                 v.price ?? 0,
      picture_id:            v.picture_id ?? null,
      seller_custom_field:   v.seller_custom_field ?? null,
    })),
    logistic_type:       row.logistic_type ?? null,
    free_shipping:       row.free_shipping ?? false,
    catalog_product_id:  row.catalog_product_id ?? null,
    deal_ids:            Array.isArray(row.deal_ids) ? row.deal_ids : [],
    _ml_user_id:         row.ml_user_id,
  };
}

export function MLInventoryProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { stores, selectedStore, scopeKey, hasMLConnection } = useMLStore();
  const { toast } = useToast();

  const [items, setItems]           = useState<ProductItem[]>([]);
  const [summary, setSummary]       = useState<InventorySummary | null>(null);
  const [loading, setLoading]       = useState(false);
  const [syncing, setSyncing]       = useState(false);
  const [hasToken, setHasToken]     = useState<boolean | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const getMLUserIds = useCallback(() => {
    if (selectedStore === "all") return stores.map((s) => s.ml_user_id);
    const store = stores.find((s) => s.ml_user_id === selectedStore);
    return store ? [store.ml_user_id] : [];
  }, [stores, selectedStore]);

  // Read from ml_inventory_cache (DB-first — no live API calls)
  const refresh = useCallback(async () => {
    if (!user) return;
    const mlUserIds = getMLUserIds();
    if (mlUserIds.length === 0) { setHasToken(false); return; }

    setHasToken(true);
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("ml_inventory_cache")
        .select("*")
        .in("ml_user_id", mlUserIds);

      if (error) throw error;

      const rows = data ?? [];
      const allItems = rows.map(rowToItem);

      const mergedSummary: InventorySummary = {
        totalItems:  allItems.length,
        totalStock:  allItems.reduce((s, i) => s + i.available_quantity, 0),
        outOfStock:  allItems.filter((i) => i.available_quantity === 0).length,
        lowStock:    allItems.filter((i) => i.available_quantity > 0 && i.available_quantity <= 5).length,
      };

      allItems.sort((a, b) => a.available_quantity - b.available_quantity || b.sold_quantity - a.sold_quantity);

      setItems(allItems);
      setSummary(mergedSummary);

      // lastUpdated = most recent synced_at across all rows
      const latestSyncedAt = rows.reduce<string | null>((latest, r) => {
        if (!r.synced_at) return latest;
        if (!latest) return r.synced_at;
        return r.synced_at > latest ? r.synced_at : latest;
      }, null);
      setLastUpdated(latestSyncedAt ? new Date(latestSyncedAt) : null);
    } catch (err: any) {
      console.error("ML inventory cache read error:", err);
      toast({ title: "Erro ao carregar estoque", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [user, getMLUserIds, toast]);

  // Trigger a fresh sync from ML API for each store, then re-read cache
  const syncNow = useCallback(async () => {
    if (!user || syncing) return;
    const mlUserIds = getMLUserIds();
    if (mlUserIds.length === 0) return;

    setSyncing(true);
    try {
      await Promise.all(
        mlUserIds.map((mlUserId) =>
          supabase.functions.invoke("sync-ml-inventory", { body: { ml_user_id: mlUserId } })
        )
      );
      await refresh();
      toast({ title: "Estoque sincronizado", description: "Dados atualizados com sucesso." });
    } catch (err: any) {
      console.error("ML inventory sync error:", err);
      toast({ title: "Erro ao sincronizar", description: err.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }, [user, syncing, getMLUserIds, refresh, toast]);

  // Reset on scope change
  useEffect(() => {
    setItems([]);
    setSummary(null);
    setLastUpdated(null);
    setHasToken(hasMLConnection ? true : null);
  }, [scopeKey, hasMLConnection]);

  // Load from cache on mount / scope change
  useEffect(() => {
    if (stores.length === 0) return;
    refresh();
  }, [stores.length, scopeKey]);

  return (
    <MLInventoryContext.Provider value={{ items, summary, loading, syncing, hasToken, lastUpdated, refresh, syncNow }}>
      {children}
    </MLInventoryContext.Provider>
  );
}

export function useMLInventory() {
  const ctx = useContext(MLInventoryContext);
  if (!ctx) throw new Error("useMLInventory must be used within MLInventoryProvider");
  return ctx;
}
