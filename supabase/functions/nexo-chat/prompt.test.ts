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

  // --- Phase 103: compra × venda (Consultor CCO) ---

  it("compra-venda: cita get_replenishment e get_purchase_suppliers na PERSONA", () => {
    expect(PERSONA).toContain("get_replenishment");
    expect(PERSONA).toContain("get_purchase_suppliers");
  });

  it("compra-venda: rótulo de compra sugerida = projeção, não pedido feito", () => {
    expect(PERSONA).toMatch(/compra sugerida.*(projeção|não .*pedido feito)/i);
  });

  it("compra-venda: distingue sem_giro (capital parado) de status_esgotado (SKU zerado)", () => {
    expect(PERSONA).toContain("sem_giro");
    expect(PERSONA).toMatch(/status_esgotado|esgotado/i);
  });

  it("compra-venda: instrui raciocínio compra × venda cruzando velocidade × estoque × cobertura × caixa", () => {
    expect(PERSONA).toMatch(/velocidade de venda.*estoque.*cobertura.*caixa/i);
  });

  // --- Phase 104: DRE real & caixa (Consultor CCO) ---

  it("DRE real & caixa: cita as 4 tools novas na PERSONA", () => {
    expect(PERSONA).toContain("get_dre_result");
    expect(PERSONA).toContain("get_dre_cash");
    expect(PERSONA).toContain("get_projected_balance");
    expect(PERSONA).toContain("get_taxes_paid");
  });

  it("DRE real & caixa: rotula que get_dre_result sozinho NÃO é o resultado completo", () => {
    expect(PERSONA).toMatch(/get_dre_result sozinho NÃO é o resultado completo/i);
  });

  it("DRE real & caixa: rotula imposto guia real ≠ imposto estimado (total_tax)", () => {
    expect(PERSONA).toMatch(/imposto guia real.*≠.*(estimado|total_tax)/i);
  });

  it("DRE real & caixa: saldo projetado = 2 cenários (pessimista/realista), sem menção a 'otimista' perto da projeção", () => {
    expect(PERSONA).toMatch(/2 cenários|pessimista.*realista/i);
    const idx = PERSONA.indexOf("saldo projetado");
    expect(idx).toBeGreaterThan(-1);
    const trecho = PERSONA.slice(Math.max(0, idx - 100), idx + 200);
    expect(trecho).not.toMatch(/otimista/i);
  });

  it("DRE real & caixa: distingue regime de caixa (get_dre_cash) de regime de competência (get_dre_result)", () => {
    expect(PERSONA).toMatch(/regime de caixa.*≠.*regime de competência/i);
  });
});
