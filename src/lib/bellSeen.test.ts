/**
 * Testes das funções puras do sino de atendimento (Phase 91-01):
 *   computeUnread · mergeAndPruneSeen · shouldSeed
 *
 * Cobre BELL-01 (badge = não-vistos), BELL-02 (abrir zera + persiste),
 * BELL-03 (prune de keys resolvidas) e o guard de prontidão (cold-start).
 *
 * Phase: 91-sino-da-navbar-marcar-notifica-es-como-lidas-badge-s-conta-n / Plan 01
 */

import { describe, it, expect } from "vitest";
import { computeUnread, mergeAndPruneSeen, shouldSeed } from "./bellSeen";

describe("mergeAndPruneSeen + computeUnread (semear zera)", () => {
  // Test A — "sem seen → semear zera"
  it("semear com as keys atuais faz o badge começar em 0", () => {
    const items = [{ key: "q-1" }, { key: "c-2" }];
    const seeded = mergeAndPruneSeen([], items);
    expect([...seeded].sort()).toEqual(["c-2", "q-1"]);
    expect(computeUnread(items, seeded)).toBe(0);
  });
});

describe("computeUnread (item novo → unread)", () => {
  // Test B — "item novo → unread"
  it("conta um item novo quando nada foi visto", () => {
    expect(computeUnread([{ key: "q-1" }], [])).toBe(1);
  });

  it("conta só o item não-visto num mix", () => {
    expect(computeUnread([{ key: "q-1" }, { key: "c-2" }], ["q-1"])).toBe(1);
  });

  // Test C — "já visto e ainda vivo não conta"
  it("não conta item já visto e ainda vivo", () => {
    expect(computeUnread([{ key: "q-1" }], ["q-1"])).toBe(0);
  });

  it("tolera keys duplicadas em seenKeys", () => {
    expect(computeUnread([{ key: "q-1" }, { key: "c-2" }], ["q-1", "q-1"])).toBe(1);
  });
});

describe("mergeAndPruneSeen (abrir zera + prune)", () => {
  // Test D — "abrir zera (merge)"
  it("após merge, unread é sempre 0 para qualquer seen/items", () => {
    const cases: Array<{ seen: string[]; items: { key: string }[] }> = [
      { seen: [], items: [{ key: "q-1" }] },
      { seen: ["q-1"], items: [{ key: "q-1" }, { key: "c-2" }] },
      { seen: ["x-9"], items: [] },
      { seen: ["q-1", "c-2"], items: [{ key: "c-2" }] },
    ];
    for (const { seen, items } of cases) {
      expect(computeUnread(items, mergeAndPruneSeen(seen, items))).toBe(0);
    }
  });

  // Test E — "prune de resolvidos"
  it("remove keys resolvidas (que saíram da lista) do conjunto visto", () => {
    const seen = ["q-1", "c-9"];
    const items = [{ key: "q-1" }];
    const next = mergeAndPruneSeen(seen, items);
    expect(next).toContain("q-1");
    expect(next).not.toContain("c-9");
  });
});

describe("shouldSeed (guard de prontidão / cold-start)", () => {
  // Test F — "não-pronto → não semeia"
  it("não semeia enquanto a query não está pronta, mesmo com orgId truthy", () => {
    expect(shouldSeed(null, "org-1", false)).toBe(false);
  });

  it("semeia quando pronto e sem registro", () => {
    expect(shouldSeed(null, "org-1", true)).toBe(true);
  });

  it("não re-semeia quando já há registro", () => {
    expect(shouldSeed(["q-1"], "org-1", true)).toBe(false);
  });

  it("não semeia sem org", () => {
    expect(shouldSeed(null, null, true)).toBe(false);
  });
});
