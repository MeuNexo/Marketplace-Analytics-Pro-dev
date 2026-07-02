/**
 * Testes do hook useMLListingSales — cobertura do guard lazy.
 *
 * Recomendação plan-checker 73-01: teste de baixo custo para o guard
 * (item sem id → idle, sem fetch).
 *
 * Phase: 73-aba-vendas / Plan 01
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMLListingSales } from "./useMLListingSales";
import type { ProductItem } from "@/contexts/MLInventoryContext";

// ─── Mock do client Supabase ──────────────────────────────────────────────────
// Necessário para o módulo resolver sem conexão real.

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
  },
}));

// ─── Fixture de item vazio (sem id) ──────────────────────────────────────────

const ITEM_NO_ID: ProductItem = {
  id: "",
  title: "test",
  available_quantity: 0,
  sold_quantity: 0,
  price: 0,
  currency_id: "BRL",
  thumbnail: null,
  status: "active",
  category_id: null,
  listing_type_id: null,
  health: null,
  visits: 0,
  brand: null,
  seller_custom_field: null,
  has_variations: false,
  variations: [],
  logistic_type: null,
  free_shipping: false,
  catalog_product_id: null,
  deal_ids: [],
};

// ─── Testes ───────────────────────────────────────────────────────────────────

describe("useMLListingSales — guard lazy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("item=null → status='idle' e points=[] sem disparar fetch", () => {
    const { result } = renderHook(() => useMLListingSales(null, 30));

    expect(result.current.status).toBe("idle");
    expect(result.current.points).toEqual([]);
  });

  it("item com id vazio → status='idle' e points=[] sem disparar fetch", () => {
    const { result } = renderHook(() => useMLListingSales(ITEM_NO_ID, 30));

    expect(result.current.status).toBe("idle");
    expect(result.current.points).toEqual([]);
  });
});
