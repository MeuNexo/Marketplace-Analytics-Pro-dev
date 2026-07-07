/**
 * claimActions.test.ts — prova a regra LOCKED "Pende você" (Phase 90 Plan 01,
 * T-90-01). Cobre cada bullet do <behavior> do PLAN.md: mensagem mandatory,
 * mensagem opcional isolada, cada ação de decisão, prioridade combinada, e
 * ausência de respondent/available_actions.
 */
import { describe, it, expect } from "vitest";
import { deriveSellerAction } from "./claimActions";

function players(availableActions: unknown[]) {
  return [
    { role: "complainant", available_actions: [] },
    { role: "respondent", available_actions: availableActions },
  ];
}

describe("deriveSellerAction", () => {
  it("mandatory send_message_to_* -> pende, reply, com due_date", () => {
    const result = deriveSellerAction(
      players([{ action: "send_message_to_complainant", mandatory: true, due_date: "2026-07-10T00:00:00Z" }]),
    );
    expect(result.seller_action_required).toBe(true);
    expect(result.pending_action_type).toBe("reply");
    expect(result.action_due_date).toBe("2026-07-10T00:00:00Z");
  });

  it("optional send_message_to_* alone -> aguardando (not required, no type)", () => {
    const result = deriveSellerAction(
      players([{ action: "send_message_to_complainant", mandatory: false, due_date: "2026-07-10T00:00:00Z" }]),
    );
    expect(result.seller_action_required).toBe(false);
    expect(result.pending_action_type).toBeNull();
    expect(result.action_due_date).toBeNull();
  });

  it("allow_return -> return", () => {
    const result = deriveSellerAction(
      players([{ action: "allow_return", mandatory: true, due_date: "2026-07-11T00:00:00Z" }]),
    );
    expect(result.seller_action_required).toBe(true);
    expect(result.pending_action_type).toBe("return");
    expect(result.action_due_date).toBe("2026-07-11T00:00:00Z");
  });

  it("refund -> refund", () => {
    const result = deriveSellerAction(players([{ action: "refund", due_date: "2026-07-12T00:00:00Z" }]));
    expect(result.seller_action_required).toBe(true);
    expect(result.pending_action_type).toBe("refund");
    expect(result.action_due_date).toBe("2026-07-12T00:00:00Z");
  });

  it("allow_partial_refund -> refund", () => {
    const result = deriveSellerAction(players([{ action: "allow_partial_refund", due_date: "2026-07-13T00:00:00Z" }]));
    expect(result.seller_action_required).toBe(true);
    expect(result.pending_action_type).toBe("refund");
    expect(result.action_due_date).toBe("2026-07-13T00:00:00Z");
  });

  it("open_dispute -> dispute", () => {
    const result = deriveSellerAction(players([{ action: "open_dispute", due_date: "2026-07-14T00:00:00Z" }]));
    expect(result.seller_action_required).toBe(true);
    expect(result.pending_action_type).toBe("dispute");
    expect(result.action_due_date).toBe("2026-07-14T00:00:00Z");
  });

  it("combined priority: mandatory message + refund -> reply wins", () => {
    const result = deriveSellerAction(
      players([
        { action: "refund", due_date: "2026-07-15T00:00:00Z" },
        { action: "send_message_to_complainant", mandatory: true, due_date: "2026-07-16T00:00:00Z" },
      ]),
    );
    expect(result.seller_action_required).toBe(true);
    expect(result.pending_action_type).toBe("reply");
    expect(result.action_due_date).toBe("2026-07-16T00:00:00Z");
  });

  it("combined priority: return + refund + dispute -> return wins", () => {
    const result = deriveSellerAction(
      players([
        { action: "open_dispute", due_date: "2026-07-17T00:00:00Z" },
        { action: "refund", due_date: "2026-07-18T00:00:00Z" },
        { action: "allow_return", due_date: "2026-07-19T00:00:00Z" },
      ]),
    );
    expect(result.pending_action_type).toBe("return");
    expect(result.action_due_date).toBe("2026-07-19T00:00:00Z");
  });

  it("combined priority: refund + dispute -> refund wins", () => {
    const result = deriveSellerAction(
      players([
        { action: "open_dispute", due_date: "2026-07-20T00:00:00Z" },
        { action: "refund", due_date: "2026-07-21T00:00:00Z" },
      ]),
    );
    expect(result.pending_action_type).toBe("refund");
    expect(result.action_due_date).toBe("2026-07-21T00:00:00Z");
  });

  it("no respondent player -> not required, empty available_actions", () => {
    const result = deriveSellerAction([{ role: "complainant", available_actions: [{ action: "refund" }] }]);
    expect(result.seller_action_required).toBe(false);
    expect(result.pending_action_type).toBeNull();
    expect(result.action_due_date).toBeNull();
    expect(result.available_actions).toEqual([]);
  });

  it("empty available_actions on respondent -> not required", () => {
    const result = deriveSellerAction(players([]));
    expect(result.seller_action_required).toBe(false);
    expect(result.pending_action_type).toBeNull();
    expect(result.available_actions).toEqual([]);
  });

  it("null players -> not required, no throw", () => {
    const result = deriveSellerAction(null);
    expect(result.seller_action_required).toBe(false);
    expect(result.pending_action_type).toBeNull();
    expect(result.action_due_date).toBeNull();
    expect(result.available_actions).toEqual([]);
  });

  it("malformed players (not an array) -> not required, no throw", () => {
    const result = deriveSellerAction({ role: "respondent" });
    expect(result.seller_action_required).toBe(false);
    expect(result.available_actions).toEqual([]);
  });

  it("available_actions returned is the raw respondent action objects", () => {
    const actions = [{ action: "refund", due_date: "2026-07-22T00:00:00Z", extra: "keep-me" }];
    const result = deriveSellerAction(players(actions));
    expect(result.available_actions).toEqual(actions);
  });

  it("missing due_date on the winning action -> action_due_date null", () => {
    const result = deriveSellerAction(players([{ action: "open_dispute" }]));
    expect(result.seller_action_required).toBe(true);
    expect(result.pending_action_type).toBe("dispute");
    expect(result.action_due_date).toBeNull();
  });
});
