import { describe, it, expect } from "vitest";
import { applyTemplate } from "./applyTemplate";

describe("applyTemplate", () => {
  it("substitui {{nome}}/{{produto}}/{{pedido}} pelos valores informados", () => {
    const result = applyTemplate("Olá {{nome}}, sobre {{produto}} (pedido {{pedido}})", {
      nome: "Isadelle",
      produto: "Chapéu",
      pedido: "200...",
    });
    expect(result).toBe("Olá Isadelle, sobre Chapéu (pedido 200...)");
  });

  it("mantém variável desconhecida literal", () => {
    expect(applyTemplate("Oi {{foo}}", { nome: "x" })).toBe("Oi {{foo}}");
  });

  it("variável conhecida ausente (undefined) também fica literal", () => {
    expect(applyTemplate("Olá {{nome}}", { produto: "x" })).toBe("Olá {{nome}}");
  });

  it("substitui todas as ocorrências repetidas", () => {
    expect(applyTemplate("{{nome}} e {{nome}} de novo", { nome: "Ana" })).toBe("Ana e Ana de novo");
  });

  it("corpo vazio retorna string vazia", () => {
    expect(applyTemplate("", { nome: "Ana" })).toBe("");
  });

  it("sem vars retorna o corpo inalterado", () => {
    expect(applyTemplate("Olá {{nome}}")).toBe("Olá {{nome}}");
  });

  it("valor vazio ('') é uma substituição válida, não é tratado como ausente", () => {
    expect(applyTemplate("Olá {{nome}}!", { nome: "" })).toBe("Olá !");
  });
});
