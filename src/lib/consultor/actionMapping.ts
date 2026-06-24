/**
 * actionMapping — pure module that converts a Consultor `insight` into a
 * `proposed_actions` Insert row.
 *
 * No Supabase, no React — fully unit-testable (see actionMapping.test.ts).
 *
 * Two product decisions are encoded here (Plan 54-02 <phase_decisions>):
 *
 *  - D-A4: RULE_TO_ACTION maps each insight `rule_key` to the action_type the
 *    executor knows how to run. This map is the product decision A4 and is OPEN
 *    to Wesley's review/extension. A rule_key absent from the map is NOT turned
 *    into a silent action — buildActionFromInsight throws.
 *
 *  - D-A2: the insight does NOT carry the target value (e.g. the new price). The
 *    `proposedValue` is an INPUT to buildActionFromInsight (it comes from the
 *    owner's modal input in plan 54-03). For pause/activate it is a fixed
 *    status object; only update_price / update_ads_budget need a number.
 *    `estimated_impact_brl` is ALWAYS `insight.impact_brl` (NEVER recalculated —
 *    REQUIREMENTS:19).
 */

import type { Database } from "@/integrations/supabase/types";
import type { InsightRow } from "@/hooks/useConsultorInsights";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Mirrors the CHECK constraint on proposed_actions.action_type (Phase 52). */
export type ActionType =
  | "update_price"
  | "pause_listing"
  | "activate_listing"
  | "pause_ads_campaign"
  | "update_ads_budget";

export type ProposedActionInsert =
  Database["public"]["Tables"]["proposed_actions"]["Insert"];

/** The proposed_value column is `Json`; callers pass a structured object. */
export type ProposedValue = Database["public"]["Tables"]["proposed_actions"]["Insert"]["proposed_value"];

// ─── rule_key → action_type (D-A4) ──────────────────────────────────────────
// Open to Wesley's review/extension. Centralised + tested so it never drifts.

export const RULE_TO_ACTION: Record<string, ActionType> = {
  // Margin rules → adjust the listing price
  margin_critical: "update_price",
  margin_alert: "update_price",
  // Ads bleeding margin / no sale → pause the ads campaign
  ads_eating_margin: "pause_ads_campaign",
  tacos_high: "pause_ads_campaign",
  ads_no_sale: "pause_ads_campaign",
  // Inactive / stale listing rules → toggle listing status
  listing_inactive: "activate_listing",
  listing_no_movement: "pause_listing",
};

// ─── target_ref extraction ──────────────────────────────────────────────────

/**
 * Extracts the ML item id from the insight's `action_href` `?items=` param.
 *
 * The `insights` table has NO `item_id` column — the deep-link `action_href`
 * (e.g. `/anuncios?items=MLB123`) is the ONLY source of truth for target_ref
 * (see 54-RESEARCH 190/196). Never reference `insight.item_id`.
 *
 * Returns null when there is no `?items=` param.
 */
export function targetRefFromInsight(insight: InsightRow): string | null {
  const query = (insight.action_href ?? "").split("?")[1] ?? "";
  return new URLSearchParams(query).get("items");
}

// ─── build the Insert row ───────────────────────────────────────────────────

/**
 * Builds the `proposed_actions` Insert from an insight + the owner's input.
 *
 * @param insight        the source insight (provides rule_key, ml_user_id,
 *                        impact_brl, action_href → target_ref).
 * @param orgId          current organization id.
 * @param userId         the proposing user (RLS also enforces auth.uid()).
 * @param proposedValue  the action's target value (D-A2) — fixed for pause/activate,
 *                        a number for update_price/update_ads_budget.
 *
 * @throws when `rule_key` is not in RULE_TO_ACTION (no silent action).
 * @throws when `target_ref` cannot be resolved (no `?items=` in action_href).
 */
export function buildActionFromInsight(
  insight: InsightRow,
  orgId: string,
  userId: string,
  proposedValue: ProposedValue,
): ProposedActionInsert {
  const actionType = RULE_TO_ACTION[insight.rule_key];
  if (!actionType) {
    throw new Error(`Insight sem ação mapeada (rule_key: ${insight.rule_key})`);
  }

  const targetRef = targetRefFromInsight(insight);
  if (!targetRef) {
    throw new Error(
      `Insight sem target_ref (action_href: ${insight.action_href ?? "null"})`,
    );
  }

  return {
    organization_id: orgId,
    proposed_by: userId,
    status: "proposed",
    action_type: actionType,
    target_ref: targetRef,
    proposed_value: proposedValue,
    // current_value is filled by the dry_run / executor pre-flight — never here.
    current_value: null,
    estimated_impact_brl: insight.impact_brl,
    ml_user_id: insight.ml_user_id,
    insight_id: insight.id,
    rule_key: insight.rule_key,
  };
}
