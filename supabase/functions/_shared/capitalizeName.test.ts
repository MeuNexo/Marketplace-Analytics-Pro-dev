/**
 * capitalizeName.test.ts — prova o normalizador de `buyer.first_name`
 * (Phase 90 Plan 02, T-90-02).
 */
import { describe, it, expect } from "vitest";
import { capitalizeName } from "./capitalizeName";

describe("capitalizeName", () => {
  it("uppercased single word -> Titlecase", () => {
    expect(capitalizeName("ISADELLE")).toBe("Isadelle");
  });

  it("empty string -> null", () => {
    expect(capitalizeName("")).toBeNull();
  });

  it("whitespace-only string -> null", () => {
    expect(capitalizeName("   ")).toBeNull();
  });

  it("missing (undefined) -> null", () => {
    expect(capitalizeName(undefined)).toBeNull();
  });

  it("missing (null) -> null", () => {
    expect(capitalizeName(null)).toBeNull();
  });

  it("non-string value -> null", () => {
    expect(capitalizeName(123)).toBeNull();
  });

  it("multi-word name -> each word capitalized", () => {
    expect(capitalizeName("MARIA DA SILVA")).toBe("Maria Da Silva");
  });

  it("already mixed-case input is normalized", () => {
    expect(capitalizeName("jOaO")).toBe("Joao");
  });

  it("trims surrounding whitespace", () => {
    expect(capitalizeName("  isadelle  ")).toBe("Isadelle");
  });
});
