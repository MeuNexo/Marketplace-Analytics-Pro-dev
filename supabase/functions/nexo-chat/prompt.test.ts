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

  // --- VERAC-04 / VERAC-05 / VERAC-06 assertions ---

  it("VERAC-06: bloco VERACIDADE, FRESCURA E SEMÂNTICA presente na string PERSONA (inviolável)", () => {
    // Prova que a regra está DENTRO da string PERSONA (não em comentário)
    expect(PERSONA).toContain("VERACIDADE, FRESCURA E SEMÂNTICA");
    expect(prompt).toContain("VERACIDADE, FRESCURA E SEMÂNTICA");
  });

  it("VERAC-06: instrui usar fonte certa por pergunta — get_sales_kpis, get_dre_monthly, get_inventory", () => {
    expect(PERSONA).toContain("FONTE CERTA POR PERGUNTA");
    expect(PERSONA).toContain("get_sales_kpis");
    expect(PERSONA).toContain("get_dre_monthly");
    expect(PERSONA).toContain("get_inventory");
  });

  it("VERAC-06: rotula parcial explicitamente — estoque Full ≠ total, attributed ≠ faturamento, vendido ≠ estoque, passado ≠ projeção", () => {
    expect(PERSONA).toContain("estoque Full");
    expect(PERSONA).toContain("attributed_revenue");
    expect(PERSONA).toContain("sold_quantity");
    expect(PERSONA).toContain("cashflow é projeção");
    expect(PERSONA).toContain("PARCIAL É ROTULADO, NUNCA ABSOLUTO");
  });

  it("VERAC-05: instrui declarar limitação em vez de inventar ou dizer 'não configurado'", () => {
    expect(PERSONA).toContain("DECLARE A LIMITAÇÃO");
    expect(PERSONA).toContain("não configurado");  // citado para proibir, não para usar
    expect(PERSONA).toContain("sem meta cadastrada para este mês");
  });

  it("VERAC-04: instrui sinalizar frescura (freshness/coverage_until/synced_at)", () => {
    expect(PERSONA).toContain("SINALIZE FRESCURA");
    expect(PERSONA).toContain("freshness");
    expect(PERSONA).toContain("coverage_until");
    expect(PERSONA).toContain("synced_at");
  });

  it("regra anti-invenção de número preservada (não enfraquecida)", () => {
    expect(PERSONA).toContain("REGRA ANTI-INVENÇÃO DE NÚMERO");
    expect(PERSONA).toContain("NUNCA invente");
    // bloco VERACIDADE aparece DEPOIS de ANTI-INVENÇÃO (reforço natural)
    const idxAnti = PERSONA.indexOf("REGRA ANTI-INVENÇÃO DE NÚMERO");
    const idxVerac = PERSONA.indexOf("VERACIDADE, FRESCURA E SEMÂNTICA");
    expect(idxVerac).toBeGreaterThan(idxAnti);
  });

  it("bloco VERACIDADE aparece antes de USO DAS FERRAMENTAS (posicionamento correto)", () => {
    const idxVerac = PERSONA.indexOf("VERACIDADE, FRESCURA E SEMÂNTICA");
    const idxUso = PERSONA.indexOf("USO DAS FERRAMENTAS");
    expect(idxVerac).toBeGreaterThan(0);
    expect(idxVerac).toBeLessThan(idxUso);
  });
});
