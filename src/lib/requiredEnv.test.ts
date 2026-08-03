import { assertRequiredEnv } from "./requiredEnv";

const COHERENT_ENV = {
  VITE_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "publishable-key-de-marcacao",
  VITE_SUPABASE_PROJECT_ID: "abcdefghijklmnopqrst",
};

describe("assertRequiredEnv", () => {
  it("com todas as obrigatórias presentes e coerentes, retorna sem lançar", () => {
    expect(() => assertRequiredEnv(COHERENT_ENV)).not.toThrow();
  });

  it("faltando VITE_SUPABASE_URL, lança e a mensagem nomeia essa variável", () => {
    const { VITE_SUPABASE_URL, ...rest } = COHERENT_ENV;
    expect(() => assertRequiredEnv(rest)).toThrow(/VITE_SUPABASE_URL/);
  });

  it("faltando VITE_SUPABASE_PUBLISHABLE_KEY, lança e a mensagem nomeia essa variável", () => {
    const { VITE_SUPABASE_PUBLISHABLE_KEY, ...rest } = COHERENT_ENV;
    expect(() => assertRequiredEnv(rest)).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY/);
  });

  it("faltando VITE_SUPABASE_PROJECT_ID, lança e a mensagem nomeia essa variável", () => {
    const { VITE_SUPABASE_PROJECT_ID, ...rest } = COHERENT_ENV;
    expect(() => assertRequiredEnv(rest)).toThrow(/VITE_SUPABASE_PROJECT_ID/);
  });

  it("faltando mais de uma, a mensagem nomeia todas as ausentes, não só a primeira", () => {
    try {
      assertRequiredEnv({});
      throw new Error("deveria ter lançado");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toMatch(/VITE_SUPABASE_URL/);
      expect(message).toMatch(/VITE_SUPABASE_PUBLISHABLE_KEY/);
      expect(message).toMatch(/VITE_SUPABASE_PROJECT_ID/);
    }
  });

  it("string vazia conta como ausente, não como valor", () => {
    expect(() =>
      assertRequiredEnv({ ...COHERENT_ENV, VITE_SUPABASE_PUBLISHABLE_KEY: "" }),
    ).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY/);
  });

  it("string só de espaços conta como ausente, não como valor", () => {
    expect(() =>
      assertRequiredEnv({ ...COHERENT_ENV, VITE_SUPABASE_PUBLISHABLE_KEY: "   " }),
    ).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY/);
  });

  it("se o host de VITE_SUPABASE_URL não corresponder a VITE_SUPABASE_PROJECT_ID, lança apontando a incoerência", () => {
    expect(() =>
      assertRequiredEnv({
        ...COHERENT_ENV,
        VITE_SUPABASE_URL: "https://projeto-certo.supabase.co",
        VITE_SUPABASE_PROJECT_ID: "projeto-errado",
      }),
    ).toThrow(/VITE_SUPABASE_URL/);
  });

  it("mensagem de erro começa com 'Build abortado:'", () => {
    expect(() => assertRequiredEnv({})).toThrow(/^Build abortado:/);
  });
});
