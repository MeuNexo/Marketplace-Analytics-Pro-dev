import { useState, useCallback, useRef, useEffect, useSyncExternalStore } from "react";
import { format, startOfDay, subMonths } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useToast } from "@/hooks/use-toast";
import { useInvalidateMLQueries } from "./useMLQueries";
import type { DateRange } from "./useMLFilters";

const LAST_ML_SYNC_KEY = "ml_last_synced_at";
const SYNC_CHUNK_DAYS = 1;
const SYNC_COOLDOWN_MS = 30_000;

// ── Module-level singleton: sync survives component unmounts ──────────────────

interface SyncState {
  syncing: boolean;
  progress: { current: number; total: number } | null;
  lastSyncedAt: string | null;
}

let _state: SyncState = {
  syncing: false,
  progress: null,
  lastSyncedAt: localStorage.getItem(LAST_ML_SYNC_KEY),
};
let _listeners = new Set<() => void>();
let _lastSyncStart = 0;
let _activePromise: Promise<void> | null = null;

function _getSnapshot() {
  return _state;
}
function _subscribe(cb: () => void) {
  _listeners.add(cb);
  return () => { _listeners.delete(cb); };
}
function _emit(partial: Partial<SyncState>) {
  _state = { ..._state, ...partial };
  _listeners.forEach((l) => l());
}

// ── Hook ──────────────────────────────────────────────────────────────────────

interface UseMLSyncOptions {
  customRange: DateRange;
  period: number;
  setSellerReputation: (r: any) => void;
}

export function useMLSync(opts: UseMLSyncOptions) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { stores, resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();
  const invalidate = useInvalidateMLQueries();

  // Subscribe to module-level state
  const state = useSyncExternalStore(_subscribe, _getSnapshot);

  // Keep latest refs so the async closure always sees current values
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;
  const storesRef = useRef(stores);
  storesRef.current = stores;
  const mlUserIdsRef = useRef(resolvedMLUserIds);
  mlUserIdsRef.current = resolvedMLUserIds;
  const userRef = useRef(user);
  userRef.current = user;
  const orgIdRef = useRef<string | null>(currentOrg?.id ?? null);
  orgIdRef.current = currentOrg?.id ?? null;

  const syncFromAPI = useCallback(
    (syncOpts?: { from?: Date; to?: Date; periodDays?: number }) => {
      const currentUser = userRef.current;
      if (!currentUser) return;

      const now = Date.now();
      if (now - _lastSyncStart < SYNC_COOLDOWN_MS) {
        toastRef.current({ title: "Aguarde", description: "Sincronização em andamento, tente novamente em alguns segundos." });
        return;
      }
      if (_activePromise) return; // already running

      _lastSyncStart = now;

      // Capture values at call time
      const capturedOpts = { ...optsRef.current };
      const capturedStores = [...storesRef.current];
      const capturedMLUserIds = [...mlUserIdsRef.current];
      const userId = currentUser.id;
      const orgId = orgIdRef.current;
      if (!orgId) {
        toastRef.current({ title: "Erro", description: "Selecione uma organização antes de sincronizar.", variant: "destructive" });
        return;
      }

      const run = async () => {
        _emit({ syncing: true, progress: null });

        try {
          if (capturedMLUserIds.length === 0) return;

          const today = startOfDay(new Date());
          let rangeStart = new Date(today);
          let rangeEnd = new Date(today);

          const effectiveFrom = syncOpts?.from ?? capturedOpts.customRange?.from;
          const effectiveTo = syncOpts?.to ?? capturedOpts.customRange?.to ?? capturedOpts.customRange?.from;

          if (effectiveFrom) {
            rangeStart = startOfDay(effectiveFrom);
            rangeEnd = startOfDay(effectiveTo ?? effectiveFrom);
          } else {
            const days = syncOpts?.periodDays ?? (capturedOpts.period > 0 ? capturedOpts.period : 1);
            rangeStart = new Date(today);
            rangeStart.setDate(today.getDate() - days);
          }

          const fromDateStr = format(rangeStart, "yyyy-MM-dd");
          const toDateStr = format(rangeEnd, "yyyy-MM-dd");

          const totalDays = Math.round((rangeEnd.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
          const totalChunks = Math.ceil(totalDays / SYNC_CHUNK_DAYS) * capturedMLUserIds.length;
          let chunksDone = 0;
          _emit({ progress: { current: 0, total: totalChunks } });

          for (const mlUserId of capturedMLUserIds) {
            let cursor = new Date(rangeStart);
            while (cursor <= rangeEnd) {
              const chunkStart = new Date(cursor);
              const chunkEnd = new Date(cursor);
              chunkEnd.setDate(chunkEnd.getDate() + (SYNC_CHUNK_DAYS - 1));
              if (chunkEnd > rangeEnd) chunkEnd.setTime(rangeEnd.getTime());

              const { data: syncData, error: syncError } = await supabase.functions.invoke(
                "mercado-libre-integration",
                {
                  body: {
                    ml_user_id: mlUserId,
                    date_from: format(chunkStart, "yyyy-MM-dd"),
                    date_to: format(chunkEnd, "yyyy-MM-dd"),
                    seller_id: capturedStores.find(s => s.ml_user_id === mlUserId)?.seller_id || null,
                  },
                },
              );

              if (syncError) throw syncError;
              if (!syncData?.success) throw new Error(syncData?.error || "Sync failed");
              if (syncData.seller_reputation) {
                try { optsRef.current.setSellerReputation(syncData.seller_reputation); } catch {}
              }

              // Sync orders para este chunk (non-fatal — não aborta o sync principal)
              try {
                await supabase.functions.invoke("sync-ml-orders", {
                  body: {
                    ml_user_id: mlUserId,
                    date_from: format(chunkStart, "yyyy-MM-dd"),
                    date_to: format(chunkEnd, "yyyy-MM-dd"),
                    seller_id: capturedStores.find(s => s.ml_user_id === mlUserId)?.seller_id || null,
                  },
                });
              } catch (ordersErr) {
                console.warn("sync-ml-orders (non-fatal):", ordersErr);
              }

              chunksDone++;
              _emit({ progress: { current: chunksDone, total: totalChunks } });
              cursor.setDate(cursor.getDate() + SYNC_CHUNK_DAYS);
            }
          }

          // Sync billing (CFFE/CFONPN) para o mês corrente E o anterior — non-fatal.
          // O mês anterior precisa de re-sync mesmo já tendo row: a fatura dele só
          // fecha no início do mês seguinte (consumo N → fatura N+1), então dados
          // sincronizados mid-month ficam parciais até a fatura fechar.
          const now = startOfDay(new Date());
          const billingMonths = [format(now, "yyyy-MM"), format(subMonths(now, 1), "yyyy-MM")];
          for (const mlUserId of capturedMLUserIds) {
            for (const periodMonth of billingMonths) {
              try {
                await supabase.functions.invoke("sync-ml-billing", {
                  body: { ml_user_id: mlUserId, period_month: periodMonth },
                });
              } catch (billingErr) {
                console.warn("sync-ml-billing (non-fatal):", billingErr);
              }
            }
          }

          // Invalidate React Query caches
          try { await invalidateRef.current.invalidateAll(); } catch {}

          const nowIso = new Date().toISOString();
          _emit({ lastSyncedAt: nowIso });
          localStorage.setItem(LAST_ML_SYNC_KEY, nowIso);
          localStorage.setItem("ml_last_synced_ts", String(Date.now()));

          // Log sync
          const daysCount = Math.round((rangeEnd.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
          for (const mlUserId of capturedMLUserIds) {
            await supabase.from("ml_sync_log").upsert(
              {
                user_id: userId,
                organization_id: orgId,
                ml_user_id: mlUserId,
                date_from: fromDateStr,
                date_to: toDateStr,
                days_synced: daysCount,
                source: "auto",
                synced_at: nowIso,
              },
              { onConflict: "user_id,ml_user_id,date_from,date_to,source" },
            );
          }

          toastRef.current({ title: "Sincronizado", description: `Dados atualizados: ${fromDateStr} → ${toDateStr}.` });
        } catch (err: any) {
          toastRef.current({ title: "Erro", description: err.message, variant: "destructive" });
        } finally {
          _emit({ syncing: false, progress: null });
          _activePromise = null;
        }
      };

      _activePromise = run();
    },
    [], // stable — all deps via refs
  );

  const resetSync = useCallback(() => {
    _emit({ lastSyncedAt: null });
  }, []);

  return {
    syncing: state.syncing,
    lastSyncedAt: state.lastSyncedAt,
    setLastSyncedAt: (v: string | null) => _emit({ lastSyncedAt: v }),
    syncProgress: state.progress,
    syncFromAPI,
    resetSync,
  };
}
