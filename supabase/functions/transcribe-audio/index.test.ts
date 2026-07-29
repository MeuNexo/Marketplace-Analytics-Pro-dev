/**
 * transcribe-audio — unit dos helpers puros e do contrato do prompt.
 *
 * O handler HTTP em si é provado por smoke em produção (401/OPTIONS) e pelo E2E com
 * áudio real; aqui ficam as partes puras (helpers.ts), que são as que erram em silêncio.
 */
import { describe, it, expect } from "vitest";
import { normalizarMime, mimeAceito, PROMPT_TRANSCRICAO, MAX_BASE64_LEN } from "./helpers";

describe("normalizarMime", () => {
  it("descarta parâmetros do mime (codecs)", () => {
    expect(normalizarMime("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(normalizarMime("AUDIO/WEBM")).toBe("audio/webm");
  });
  it("aceita vazio sem quebrar", () => {
    expect(normalizarMime("")).toBe("");
  });
});

describe("mimeAceito", () => {
  it("aceita o que os navegadores realmente gravam", () => {
    // Chrome/Firefox gravam webm/opus; Safari grava mp4
    expect(mimeAceito("audio/webm;codecs=opus")).toBe(true);
    expect(mimeAceito("audio/webm")).toBe(true);
    expect(mimeAceito("audio/mp4")).toBe(true);
    expect(mimeAceito("audio/ogg;codecs=opus")).toBe(true);
  });
  it("rejeita o que não é áudio", () => {
    expect(mimeAceito("video/mp4")).toBe(false);
    expect(mimeAceito("application/json")).toBe(false);
    expect(mimeAceito("")).toBe(false);
  });
});

describe("PROMPT_TRANSCRICAO", () => {
  it("pede transcrição literal em pt-BR, sem comentário e sem tradução", () => {
    expect(PROMPT_TRANSCRICAO).toMatch(/português do Brasil/i);
    expect(PROMPT_TRANSCRICAO).toMatch(/APENAS a transcrição literal/);
    expect(PROMPT_TRANSCRICAO).toMatch(/sem tradução/i);
  });

  it("carrega o glossário do negócio — sem ele a transcrição erra justo o que importa", () => {
    for (const termo of ["Pralana", "Mercado Livre", "SKU", "MCO", "ROAS", "CMV", "DRE"]) {
      expect(PROMPT_TRANSCRICAO).toContain(termo);
    }
  });

  it("manda devolver vazio quando o áudio é inaudível (em vez de inventar)", () => {
    expect(PROMPT_TRANSCRICAO).toMatch(/vazio ou inaudível.*string vazia/i);
  });
});

describe("MAX_BASE64_LEN", () => {
  it("teto de tamanho protege custo e a EF", () => {
    expect(MAX_BASE64_LEN).toBe(8_000_000);
  });
});
