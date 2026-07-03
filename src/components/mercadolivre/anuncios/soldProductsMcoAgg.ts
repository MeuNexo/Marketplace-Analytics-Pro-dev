/**
 * Utilitário puro de agregação pós-ads (MCO) por marca/categoria e por anúncio.
 *
 * Zero dependências de React, Supabase ou rede — 100% testável isoladamente.
 *
 * Fonte dos dados: linhas de `get_margin_with_ads_by_product` (via useMLMarginWithAds),
 * já pós-ads (`lucro_pos_ads` / `lucro_pct_pos_ads`) e com `marca` (Phase 83-01 migration).
 * MCO principal = COM ads, decisão travada (Phase 83 CONTEXT, item "MCO exibido").
 *
 * STUB — RED phase (TDD). Implementação real vem no commit GREEN.
 *
 * Phase: 83-produtos-vendidos-mco-redesign / Plan 01
 */

import type { McoHealth } from "@/lib/mcoHealth";

export interface McoProductRow {
  item_id: string;
  titulo: string | null;
  marca: string | null;
  receita: number;
  unidades: number;
  cmv: number;
  comissao: number;
  frete: number;
  impostos: number;
  ads_spend: number;
  lucro_pos_ads: number;
  lucro_pct_pos_ads: number | null;
  has_cmv: boolean;
}

export interface PvMcoGroup {
  key: string;
  name: string;
  revenue: number;
  qty: number;
  mcoPct: number | null;
  redCount: number;
  hasMissingCost: boolean;
}

export interface PvMcoItem {
  item_id: string;
  title: string;
  qty: number;
  revenue: number;
  mcoReais: number;
  mcoPct: number | null;
  acosPct: number | null;
  hasCmv: boolean;
  health: McoHealth;
  shareOfGroup: number;
  cmv: number;
  comissao: number;
  frete: number;
  impostos: number;
  adsSpend: number;
}

export function aggregateMcoGroups(
  _rows: McoProductRow[],
  _pvView: "marca" | "categoria",
  _itemsMap: Map<string, { category_id?: string | null; title?: string; thumbnail?: string }>,
): PvMcoGroup[] {
  throw new Error("not implemented");
}

export function aggregateMcoItems(
  _rows: McoProductRow[],
  _pvSelected: string,
  _pvView: "marca" | "categoria",
  _itemsMap: Map<string, { category_id?: string | null; title?: string; thumbnail?: string }>,
): PvMcoItem[] {
  throw new Error("not implemented");
}
