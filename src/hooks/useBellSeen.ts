import { useCallback, useEffect, useMemo, useState } from "react";
import { useOrganization } from "@/contexts/OrganizationContext";
import { computeUnread, mergeAndPruneSeen, shouldSeed } from "@/lib/bellSeen";

/**
 * Estado "visto" do sino de atendimento, chaveado por org (Phase 91-01).
 *
 * O badge conta NOVIDADES não vistas (não o total). Abrir o sino marca tudo como
 * visto e persiste em localStorage (`bell-seen:{orgId}`); ele só volta a subir
 * quando chega algo genuinamente novo via o refetch de 45s de
 * `useAtendimentoPendencias`.
 *
 * A semeadura na 1ª visita começa em 0 (badge não "explode" com pendências
 * antigas) e é gateada por `shouldSeed` — só ocorre DEPOIS que a query ficou
 * pronta (`isReady`), nunca na janela fria com query desabilitada e items=[].
 */

const KEY_PREFIX = "bell-seen:";

function loadSeen(orgId: string): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${KEY_PREFIX}${orgId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((k): k is string => typeof k === "string");
    return null;
  } catch {
    return null; // JSON corrompido / security → cai para "semear" (badge 0)
  }
}

function saveSeen(orgId: string, keys: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${KEY_PREFIX}${orgId}`, JSON.stringify(keys));
  } catch {
    /* ignore quota/security errors */
  }
}

export function useBellSeen(
  items: { key: string }[],
  isReady: boolean,
): { unreadCount: number; markAllSeen: () => void } {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  // null = ainda não semeado para esta org.
  const [seen, setSeen] = useState<string[] | null>(null);

  // Chave estável derivada das keys: `items` (query.data ?? []) muda de
  // identidade a cada render; itemsKey evita churn nos efeitos/callback.
  const itemsKey = useMemo(() => items.map((i) => i.key).join("|"), [items]);

  // (1) Recarrega o registro quando a org muda.
  useEffect(() => {
    if (!orgId) {
      setSeen(null);
      return;
    }
    setSeen(loadSeen(orgId)); // null se não há registro (pendente de semeadura)
  }, [orgId]);

  // (2) Semeadura gateada por prontidão: começa em 0 na 1ª visita.
  useEffect(() => {
    if (!shouldSeed(seen, orgId, isReady)) return;
    const seeded = items.map((i) => i.key);
    setSeen(seeded);
    if (orgId) saveSeen(orgId, seeded);
    // itemsKey no lugar da identidade de `items`; guard seen===null já protege.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen, orgId, isReady, itemsKey]);

  const unreadCount = seen === null ? 0 : computeUnread(items, seen);

  const markAllSeen = useCallback(() => {
    if (!orgId) return;
    const next = mergeAndPruneSeen(seen ?? [], items);
    setSeen(next);
    saveSeen(orgId, next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, seen, itemsKey]);

  return { unreadCount, markAllSeen };
}
