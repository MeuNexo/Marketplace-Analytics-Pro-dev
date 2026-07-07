/**
 * Testes da lib pura de anexos de reclamação (Phase 92-02):
 *   normalizeClaimAttachments · isImageAttachment
 *
 * Cobre normalização tolerante (item string vs objeto vs vazio/ausente) e a
 * decisão imagem-vs-arquivo (por MIME type ou fallback por extensão do filename).
 *
 * Phase: 92-anexos-nas-mensagens-de-reclama-o-exibi-o / Plan 02 (ATTACH-01/02)
 */

import { describe, it, expect } from "vitest";
import { normalizeClaimAttachments, isImageAttachment } from "./claimAttachments";

describe("normalizeClaimAttachments", () => {
  it("devolve [] para undefined", () => {
    expect(normalizeClaimAttachments(undefined)).toEqual([]);
  });

  it("devolve [] para array vazio", () => {
    expect(normalizeClaimAttachments([])).toEqual([]);
  });

  it("devolve [] para não-array (null, string, objeto)", () => {
    expect(normalizeClaimAttachments(null)).toEqual([]);
    expect(normalizeClaimAttachments("abc")).toEqual([]);
    expect(normalizeClaimAttachments({ id: "x" })).toEqual([]);
  });

  it("tolera item string → { id, filename=string, type=null }", () => {
    expect(normalizeClaimAttachments(["abc_1.jpeg"])).toEqual([
      { id: "abc_1.jpeg", filename: "abc_1.jpeg", type: null },
    ]);
  });

  it("preserva os três campos de um item objeto", () => {
    expect(
      normalizeClaimAttachments([{ id: "x", filename: "nota.pdf", type: "application/pdf" }]),
    ).toEqual([{ id: "x", filename: "nota.pdf", type: "application/pdf" }]);
  });

  it("resolve id a partir de attachment_id/filename quando id ausente", () => {
    expect(
      normalizeClaimAttachments([{ filename: "foto.jpg", type: "image/jpeg" }]),
    ).toEqual([{ id: "foto.jpg", filename: "foto.jpg", type: "image/jpeg" }]);
  });

  it("descarta itens sem id resolvível", () => {
    expect(normalizeClaimAttachments([{ type: "image/jpeg" }, null, 42])).toEqual([]);
  });
});

describe("isImageAttachment", () => {
  it("true quando type começa com image/", () => {
    expect(isImageAttachment({ type: "image/jpeg" })).toBe(true);
    expect(isImageAttachment({ type: "image/png" })).toBe(true);
  });

  it("false para type não-imagem (pdf)", () => {
    expect(isImageAttachment({ type: "application/pdf" })).toBe(false);
  });

  it("fallback por extensão do filename (case-insensitive) quando type ausente", () => {
    expect(isImageAttachment({ type: null, filename: "foto.PNG" })).toBe(true);
    expect(isImageAttachment({ type: null, filename: "a.jpg" })).toBe(true);
    expect(isImageAttachment({ type: null, filename: "a.jpeg" })).toBe(true);
    expect(isImageAttachment({ type: null, filename: "a.gif" })).toBe(true);
    expect(isImageAttachment({ type: null, filename: "a.webp" })).toBe(true);
    expect(isImageAttachment({ type: null, filename: "a.heic" })).toBe(true);
  });

  it("false por extensão não-imagem (pdf)", () => {
    expect(isImageAttachment({ type: null, filename: "nota.pdf" })).toBe(false);
  });

  it("false quando não há type nem filename", () => {
    expect(isImageAttachment({ type: null, filename: null })).toBe(false);
    expect(isImageAttachment({})).toBe(false);
  });
});
