import { describe, it, expect } from "vitest";
import { htmlToText } from "./htmlToText";

describe("htmlToText", () => {
  it("vazio/null → string vazia", () => {
    expect(htmlToText(null)).toBe("");
    expect(htmlToText("")).toBe("");
  });
  it("remove tags e decodifica acentos PT-BR", () => {
    const html = '<p dir="ltr">Ol&aacute;, P&eacute; Vermeio!</p>';
    expect(htmlToText(html)).toBe("Olá, Pé Vermeio!");
  });
  it("converte parágrafos em quebras de linha (parágrafo = linha em branco)", () => {
    const html = "<p>Linha 1</p>\n<p>Linha 2</p>";
    expect(htmlToText(html)).toBe("Linha 1\n\nLinha 2");
  });
  it("decodifica entidades numéricas e <br>", () => {
    expect(htmlToText("A&#233;<br>B")).toBe("Aé\nB");
  });
  it("não deixa tags passarem (segurança)", () => {
    expect(htmlToText('<img src=x onerror=alert(1)>texto')).toBe("texto");
    expect(htmlToText("<script>alert(1)</script>oi")).toBe("alert(1)oi");
  });
});
