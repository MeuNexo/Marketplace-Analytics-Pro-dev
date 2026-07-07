/**
 * Testes da lib pura de validação + higienização de upload de anexo (Phase 93-02,
 * fix 93-03). Regras do ML: JPG/PNG/PDF, ≤ 5 MB, nome ≤ 125 chars, só
 * [a-zA-Z0-9_.-]. O nome NÃO é mais rejeitado — é higienizado (`sanitizeFilename`);
 * a validação só barra TIPO e TAMANHO.
 */

import { describe, it, expect } from "vitest";
import {
  validateUploadFile,
  sanitizeFilename,
  ALLOWED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  FILENAME_MAX_CHARS,
} from "./attachmentUploadValidation";

const SAFE_RE = /^[a-zA-Z0-9_.-]+$/;

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

describe("sanitizeFilename — produz sempre nome aceito pelo ML", () => {
  it("troca espaços por underscore preservando extensão", () => {
    expect(sanitizeFilename("minha foto.jpg")).toBe("minha_foto.jpg");
  });
  it("remove acentos", () => {
    expect(sanitizeFilename("notação.pdf")).toBe("notacao.pdf");
  });
  it("nome típico de WhatsApp vira seguro", () => {
    const out = sanitizeFilename("WhatsApp Image 2026-07-07 at 12.34.56.jpeg");
    expect(SAFE_RE.test(out)).toBe(true);
    expect(out.endsWith(".jpeg")).toBe(true);
  });
  it("print com acento e espaço (pt-BR) vira seguro", () => {
    const out = sanitizeFilename("Captura de tela 2026-07-07 às 12h.png");
    expect(SAFE_RE.test(out)).toBe(true);
    expect(out.endsWith(".png")).toBe(true);
  });
  it("colapsa underscores repetidos e apara pontas", () => {
    expect(sanitizeFilename("  ((foto))  .jpg")).toBe("foto.jpg");
  });
  it("barra de path some (não vira separador)", () => {
    const out = sanitizeFilename("pasta/sub/foto.jpg");
    expect(SAFE_RE.test(out)).toBe(true);
    expect(out.includes("/")).toBe(false);
  });
  it("nome vazio → 'arquivo'", () => {
    expect(sanitizeFilename("")).toBe("arquivo");
  });
  it("só caracteres inválidos → 'arquivo' + extensão", () => {
    expect(sanitizeFilename("@@@.png")).toBe("arquivo.png");
  });
  it("trunca a 125 chars preservando extensão", () => {
    const out = sanitizeFilename("a".repeat(200) + ".jpg");
    expect(out.length).toBeLessThanOrEqual(FILENAME_MAX_CHARS);
    expect(out.endsWith(".jpg")).toBe(true);
    expect(SAFE_RE.test(out)).toBe(true);
  });
  it("é idempotente", () => {
    const once = sanitizeFilename("Minha Foto (1).JPG");
    expect(sanitizeFilename(once)).toBe(once);
    expect(SAFE_RE.test(once)).toBe(true);
  });
});

describe("validateUploadFile — aceitos (nome não importa mais)", () => {
  it("aceita image/jpeg dentro dos limites", () => {
    expect(validateUploadFile({ name: "foto_1.jpg", type: "image/jpeg", size: 1024 })).toEqual({ ok: true });
  });
  it("aceita mesmo com nome cheio de espaço/acento (higienizado depois)", () => {
    expect(validateUploadFile({ name: "minha foto às 12h.png", type: "image/png", size: 2048 })).toEqual({ ok: true });
  });
  it("aceita application/pdf", () => {
    expect(validateUploadFile({ name: "nota fiscal (2).pdf", type: "application/pdf", size: 500 })).toEqual({ ok: true });
  });
  it("aceita exatamente no limite de 5 MB", () => {
    expect(validateUploadFile({ name: "grande.jpg", type: "image/jpeg", size: MAX_UPLOAD_BYTES })).toEqual({ ok: true });
  });
});

describe("validateUploadFile — rejeita só TIPO e TAMANHO", () => {
  it("rejeita tipo não permitido (gif)", () => {
    const r = validateUploadFile({ name: "anim.gif", type: "image/gif", size: 1024 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });
  it("rejeita HEIC (iPhone) com mensagem clara", () => {
    const r = validateUploadFile({ name: "IMG_0001.heic", type: "image/heic", size: 1024 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.toLowerCase()).toContain("heic");
  });
  it("rejeita text/plain", () => {
    const r = validateUploadFile({ name: "doc.txt", type: "text/plain", size: 1024 });
    expect(r.ok).toBe(false);
  });
  it("rejeita acima de 5 MB", () => {
    const r = validateUploadFile({ name: "grande.jpg", type: "image/jpeg", size: MAX_UPLOAD_BYTES + 1 });
    expect(r.ok).toBe(false);
  });
});
