import { useState, useEffect, useCallback, useMemo } from "react";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  type ReputationSummary,
  type ReputationLevel,
  type FeedbackEntry,
} from "@/data/reputacaoMockData";

export type { ReputationSummary, ReputationLevel, FeedbackEntry };

export interface MLReputationData {
  /** Raw ML API seller_reputation object */
  raw: any;
  /** Normalized for display */
  level_id: string;
  level: ReputationLevel;
  levelLabel: string;
  score: number;
  power_seller_status: string | null;
  claims_rate: number | null;
  delayed_handling_rate: number | null;
  cancellation_rate: number | null;
  positive_rating: number | null;
  negative_rating: number | null;
  neutral_rating: number | null;
  transactions_completed: number;
}

export interface UseMLReputationResult {
  reputation: MLReputationData | null;
  /** Real feedback entries from ml-reputation EF (empty array before first fetch or when unavailable) */
  feedbacks: FeedbackEntry[];
  loading: boolean;
  isRealData: boolean;
  refresh: () => Promise<void>;
}

const LEVEL_MAP: Record<string, { level: ReputationLevel; label: string; score: number }> = {
  "1_red":        { level: "red",         label: "Vermelho",    score: 10 },
  "2_orange":     { level: "orange",      label: "Laranja",     score: 30 },
  "3_yellow":     { level: "yellow",      label: "Amarelo",     score: 50 },
  "4_light_green":{ level: "light_green", label: "Verde Claro", score: 70 },
  "5_green":      { level: "green",       label: "Verde",       score: 90 },
};

function normalizeReputation(raw: any, powerSeller: string | null): MLReputationData {
  const levelId = raw?.level_id || "3_yellow";
  const mapping = LEVEL_MAP[levelId] || LEVEL_MAP["3_yellow"];

  const metrics = raw?.metrics || {};
  const transactions = raw?.transactions || {};
  const ratings = transactions.ratings || {};

  return {
    raw,
    level_id: levelId,
    level: mapping.level,
    levelLabel: mapping.label,
    score: mapping.score,
    power_seller_status: powerSeller,
    claims_rate: metrics.claims?.rate ?? null,
    delayed_handling_rate: metrics.delayed_handling_time?.rate ?? null,
    cancellation_rate: metrics.cancellations?.rate ?? null,
    positive_rating: ratings.positive ?? null,
    negative_rating: ratings.negative ?? null,
    neutral_rating: ratings.neutral ?? null,
    transactions_completed: transactions.completed ?? 0,
  };
}

/**
 * Normalizes a raw ML feedback entry's `fulfilled` field (Pitfall 3):
 * fulfilled can be "positive" | "negative" | true | false | null
 */
function normalizeFulfilled(fulfilled: any): "positive" | "negative" {
  return (fulfilled === "positive" || fulfilled === true) ? "positive" : "negative";
}

export function useMLReputation(): UseMLReputationResult {
  const { stores, selectedStore, loading: storeLoading } = useMLStore();
  const { user } = useAuth();
  const [reputation, setReputation] = useState<MLReputationData | null>(null);
  const [feedbacks, setFeedbacks] = useState<FeedbackEntry[]>([]);
  const [isRealData, setIsRealData] = useState(false);
  const [loading, setLoading] = useState(false);

  const storeId = useMemo(() => {
    if (selectedStore !== "all" && selectedStore) return selectedStore;
    if (stores.length > 0) return stores[0].ml_user_id;
    return null;
  }, [selectedStore, stores]);

  const connected = stores.length > 0;

  const fetchReputation = useCallback(async () => {
    if (!connected || !user || !storeId) return;

    setLoading(true);
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const url = `https://${projectId}.supabase.co/functions/v1/ml-reputation?ml_user_id=${encodeURIComponent(storeId)}`;

      const session = await supabase.auth.getSession();
      const accessToken = session.data.session?.access_token;
      if (!accessToken) return;

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "",
        },
      });

      if (!res.ok) {
        console.warn(`ml-reputation: ${res.status}`);
        return;
      }

      const data = await res.json();

      // Parse seller reputation
      if (data.seller_reputation) {
        setReputation(normalizeReputation(data.seller_reputation, data.power_seller_status));
        setIsRealData(true);
      }

      // Parse feedbacks — treat missing or empty as [] (Pitfall 7: never throw)
      const rawFeedbacks: any[] = Array.isArray(data.feedbacks) ? data.feedbacks : [];
      setFeedbacks(rawFeedbacks.map((f: any): FeedbackEntry => ({
        id: String(f.id ?? ""),
        date: f.date_created ?? "",
        rating: normalizeFulfilled(f.fulfilled),
        comment: f.message ?? "",
        item_title: f.item?.title ?? "",
        fulfilled_by: f.fulfilled_by ?? "seller",
      })));
    } catch (err) {
      console.warn("ml-reputation error:", err);
      // On error keep feedbacks as [] — sparse/empty series is valid (D-07)
    } finally {
      setLoading(false);
    }
  }, [connected, user, storeId]);

  useEffect(() => {
    setReputation(null);
    setFeedbacks([]);
    setIsRealData(false);
    fetchReputation();
  }, [fetchReputation]);

  return {
    reputation,
    feedbacks,
    loading: storeLoading || loading,
    isRealData,
    refresh: fetchReputation,
  };
}
