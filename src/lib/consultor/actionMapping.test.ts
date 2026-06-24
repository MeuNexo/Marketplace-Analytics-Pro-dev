/**
 * Unit tests for actionMapping — pure module (no Supabase mock).
 *
 * Covers <behavior> of Plan 54-02 Task 1:
 *   - RULE_TO_ACTION map (D-A4)
 *   - targetRefFromInsight: extracts `?items=` from action_href; null when absent
 *     (insights has NO item_id column — action_href is the only source)
 *   - buildActionFromInsight: builds the proposed_actions Insert with proposed_value
 *     passed in (D-A2), estimated_impact_brl = insight.impact_brl (NOT recalculated),
 *     and throws for unknown rule_key.
 *
 * Phase: 54-pipeline-de-a-es-com-aprova-o / Plan 02
 */

import { describe, it, expect } from "vitest";
import {
  RULE_TO_ACTION,
  targetRefFromInsight,
  buildActionFromInsight,
  type ActionType,
} from "./actionMapping";
import type { InsightRow } from "@/hooks/useConsultorInsights";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeInsight(overrides: Partial<InsightRow> = {}): InsightRow {
  return {
    id: "insight-1",
    organization_id: "org-1",
    ml_user_id: "123456789",
    ml_user_id_key: "123456789",
    rule_key: "margin_critical",
    severity: "critical",
    category: "margin",
    title: "Margem crítica",
    body: "Esse anúncio está com margem negativa.",
    impact_brl: 1234.56,
    action_href: "/anuncios?items=MLB123",
    action_label: "Revisar preço",
    status: "active",
    snooze_count: 0,
    snoozed_until: null,
    dismissed_at: null,
    resolved_at: null,
    created_at: "2026-06-24T00:00:00Z",
    updated_at: "2026-06-24T00:00:00Z",
    ...overrides,
  };
}

// ─── RULE_TO_ACTION map (D-A4) ─────────────────────────────────────────────────

describe("RULE_TO_ACTION map (D-A4)", () => {
  it("maps margin_critical → update_price", () => {
    expect(RULE_TO_ACTION["margin_critical"]).toBe("update_price");
  });

  it("maps ads_no_sale → pause_ads_campaign", () => {
    expect(RULE_TO_ACTION["ads_no_sale"]).toBe("pause_ads_campaign");
  });

  it("contains only valid ActionType values", () => {
    const valid: ActionType[] = [
      "update_price",
      "pause_listing",
      "activate_listing",
      "pause_ads_campaign",
      "update_ads_budget",
    ];
    for (const action of Object.values(RULE_TO_ACTION)) {
      expect(valid).toContain(action);
    }
  });
});

// ─── targetRefFromInsight ──────────────────────────────────────────────────────

describe("targetRefFromInsight", () => {
  it("extracts the item id from ?items= in action_href", () => {
    expect(
      targetRefFromInsight(makeInsight({ action_href: "/anuncios?items=MLB123" })),
    ).toBe("MLB123");
  });

  it("returns null when action_href has no ?items=", () => {
    expect(
      targetRefFromInsight(makeInsight({ action_href: "/anuncios" })),
    ).toBeNull();
  });

  it("returns null when action_href is empty", () => {
    expect(targetRefFromInsight(makeInsight({ action_href: "" }))).toBeNull();
  });
});

// ─── buildActionFromInsight ────────────────────────────────────────────────────

describe("buildActionFromInsight", () => {
  it("builds the proposed_actions Insert with proposed_value passed in (D-A2)", () => {
    const insight = makeInsight({ rule_key: "ads_no_sale", action_href: "/anuncios?items=MLB999" });
    const row = buildActionFromInsight(insight, "org-1", "user-1", { status: "paused" });

    expect(row.organization_id).toBe("org-1");
    expect(row.proposed_by).toBe("user-1");
    expect(row.status).toBe("proposed");
    expect(row.action_type).toBe("pause_ads_campaign");
    expect(row.target_ref).toBe("MLB999");
    expect(row.proposed_value).toEqual({ status: "paused" });
    expect(row.ml_user_id).toBe(insight.ml_user_id);
    expect(row.insight_id).toBe(insight.id);
    expect(row.rule_key).toBe("ads_no_sale");
  });

  it("sets estimated_impact_brl = insight.impact_brl (NOT recalculated)", () => {
    const insight = makeInsight({ impact_brl: 9876.54 });
    const row = buildActionFromInsight(insight, "org-1", "user-1", { price: 99.9 });
    expect(row.estimated_impact_brl).toBe(9876.54);
    expect(row.estimated_impact_brl).toBe(insight.impact_brl);
  });

  it("passes through a numeric proposed_value for update_price", () => {
    const insight = makeInsight({ rule_key: "margin_critical" });
    const row = buildActionFromInsight(insight, "org-1", "user-1", { price: 149.9 });
    expect(row.action_type).toBe("update_price");
    expect(row.proposed_value).toEqual({ price: 149.9 });
  });

  it("throws for an unknown rule_key (no silent action)", () => {
    const insight = makeInsight({ rule_key: "totally_unknown_rule" });
    expect(() => buildActionFromInsight(insight, "org-1", "user-1", { status: "paused" })).toThrow();
  });

  it("throws when target_ref cannot be resolved (no ?items=)", () => {
    const insight = makeInsight({ rule_key: "margin_critical", action_href: "/anuncios" });
    expect(() => buildActionFromInsight(insight, "org-1", "user-1", { price: 10 })).toThrow();
  });
});
