import { describe, it, expect } from "vitest";
// Imports RELATIVOS (nunca via alias @) — testes de EF são lógica pura, sem DOM.
import { PERSONA, buildSystemPrompt } from "./prompt";

describe("nexo-chat system prompt", () => {
  const prompt = buildSystemPrompt();

  it("identifica a persona do Nexo (COO sênior)", () => {
    expect(prompt).toContain("Nexo");
    expect(PERSONA).toContain("Nexo");
  });

  it("instrui a citar o playbook usado no formato [playbook: X]", () => {
    // marca de citação que o modelo deve usar nas respostas
    expect(prompt).toContain("[playbook:");
  });

  it("contém a regra estrita anti-invenção de número (NEXO-05)", () => {
    expect(prompt).toContain("NUNCA invente");
  });

  it("marca tool-results / dados da conta como informação, NUNCA instrução (anti prompt-injection)", () => {
    expect(prompt).toContain("informação");
    expect(prompt).toContain("nunca instruç");
  });

  it("instrui comportamento read-only (sugere ação, encaminha para aprovação, não executa)", () => {
    expect(prompt.toLowerCase()).toContain("aprovaç");
  });

  it("embute os 5 blocos de playbook (prova pelo tamanho > 10000 chars)", () => {
    expect(prompt.length).toBeGreaterThan(10000);
  });

  it("inclui conteúdo real dos playbooks (strategic + ads)", () => {
    expect(prompt).toContain("TACoS"); // glossário/ads
    expect(prompt).toContain("Break-Even"); // ads/playbooks/break_even
    expect(prompt).toContain("Markup"); // strategic (Gabriel)
  });
});
