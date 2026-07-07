/**
 * Testes da lib pura de validação de upload de anexo (Phase 93-02).
 *
 * Espelha as constantes/regras da EF `ml-claim-attachment-upload` (autoridade):
 * JPG/PNG/PDF, ≤ 5 MB, nome ≤ 125 chars, só [a-zA-Z0-9_.-]. Aqui o objetivo é
 * feedback rápido no cliente antes de subir.
 *
 * Phase: 93-enviar-anexo-na-resposta-da-reclama-o-upload / Plan 02 (SEND-ATT-01)
 */

import { describe, it, expect } from "vitest";
import {
  validateUploadFile,
  ALLOWED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  FILENAME_MAX_CHARS,
} from "./attachmentUploadValidation";

describe("constantes espelhadas da EF", () => {
  it("ALLOWED_UPLOAD_TYPES = jpeg/png/pdf", () => {
    expect([...ALLOWED_UPLOAD_TYPES]).toEqual(["image/jpeg", "image/png", "application/pdf"]);
  });
  it("MAX_UPLOAD_BYTES = 5 MB", () => {
    expect(MAX_UPLOAD_BYTES).toBe(5 * 1024 * 1024);
  });
  it("FILENAME_MAX_CHARS = 125", () => {
    expect(FILENAME_MAX_CHARS).toBe(125);
  });
});

describe("validateUploadFile — aceitos", () => {
  it("aceita image/jpeg dentro dos limites", () => {
    expect(validateUploadFile({ name: "foto_1.jpg", type: "image/jpeg", size: 1024 })).toEqual({ ok: true });
  });
  it("aceita image/png dentro dos limites", () => {
    expect(validateUploadFile({ name: "print.png", type: "image/png", size: 2048 })).toEqual({ ok: true });
  });
  it("aceita application/pdf dentro dos limites", () => {
    expect(validateUploadFile({ name: "nota-fiscal.pdf", type: "application/pdf", size: 500 })).toEqual({ ok: true });
  });
  it("aceita exatamente no limite de 5 MB", () => {
    expect(validateUploadFile({ name: "grande.jpg", type: "image/jpeg", size: MAX_UPLOAD_BYTES })).toEqual({ ok: true });
  });
});

describe("validateUploadFile — rejeitados", () => {
  it("rejeita tipo não permitido (gif)", () => {
    const r = validateUploadFile({ name: "anim.gif", type: "image/gif", size: 1024 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(typeof r.error).toBe("string");
  });

  it("rejeita tipo não permitido (text/plain)", () => {
    const r = validateUploadFile({ name: "doc.txt", type: "text/plain", size: 1024 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });

  it("rejeita arquivo acima de 5 MB (5MB + 1)", () => {
    const r = validateUploadFile({ name: "grande.jpg", type: "image/jpeg", size: MAX_UPLOAD_BYTES + 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });

  it("rejeita nome com mais de 125 caracteres", () => {
    const longName = "a".repeat(FILENAME_MAX_CHARS + 1) + ".jpg";
    const r = validateUploadFile({ name: longName, type: "image/jpeg", size: 1024 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });

  it("rejeita nome com caractere inseguro (espaço)", () => {
    const r = validateUploadFile({ name: "minha foto.jpg", type: "image/jpeg", size: 1024 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });

  it("rejeita nome com acento", () => {
    const r = validateUploadFile({ name: "notaçã.pdf", type: "application/pdf", size: 1024 });
    expect(r.ok).toBe(false);
  });

  it("rejeita nome com barra (path)", () => {
    const r = validateUploadFile({ name: "pasta/foto.jpg", type: "image/jpeg", size: 1024 });
    expect(r.ok).toBe(false);
  });

  it("rejeita nome vazio", () => {
    const r = validateUploadFile({ name: "", type: "image/jpeg", size: 1024 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });
});
