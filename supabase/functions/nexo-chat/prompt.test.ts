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

  // --- Phase 105: preços/competitivo/completude (FINALIZAÇÃO da milestone) ---

  it("preços/competitivo: cita as 4 tools novas de 105 na PERSONA", () => {
    expect(PERSONA).toContain("get_price_practiced");
    expect(PERSONA).toContain("get_competitive_price");
    expect(PERSONA).toContain("get_cost_gaps");
    expect(PERSONA).toContain("get_cancelled_revenue");
  });

  it("preços/competitivo: sugestão competitiva do ML = sinal, NÃO garantia nem preço do concorrente", () => {
    expect(PERSONA).toMatch(/sugestão competitiva.*(não .*garantia|não .*preço do concorrente)/i);
  });

  it("preços/competitivo: custo ausente pode ser LEGÍTIMO em conta de revenda", () => {
    expect(PERSONA).toMatch(/custo ausente.*(legítim|revenda)/i);
  });

  it("preços/competitivo: cancelado ≠ faturamento", () => {
    expect(PERSONA).toMatch(/cancelad[oa].*≠.*faturamento/i);
  });

  it("preços/competitivo: preço praticado é histórico derivado, meta MCO só do anúncio inteiro (não por variação)", () => {
    expect(PERSONA).toMatch(/preço praticado.*histórico derivado/i);
    expect(PERSONA).toMatch(/meta de MCO.*anúncio inteiro.*não por variação/i);
  });

  it("cobertura da milestone: PERSONA cita as 8 tools novas de 103+104+105 (finalização)", () => {
    const milestoneTools = [
      "get_replenishment",
      "get_purchase_suppliers",
      "get_dre_result",
      "get_dre_cash",
      "get_projected_balance",
      "get_taxes_paid",
      "get_price_practiced",
      "get_competitive_price",
    ];
    for (const tool of milestoneTools) {
      expect(PERSONA).toContain(tool);
    }
  });

  it("idioma: regra inviolável de PT-BR vem ANTES do raciocínio e proíbe frases em inglês", () => {
    // Wesley 2026-07-29: o Consultor respondeu partes em inglês numa conversa iniciada em PT.
    expect(PERSONA).toMatch(/IDIOMA \(inviolável\)/);
    expect(PERSONA).toMatch(/português do Brasil/);
    expect(PERSONA).toMatch(/NUNCA escreva frases, cabeçalhos ou marcadores em inglês/);
    // a regra precisa aparecer antes de COMO VOCÊ RACIOCINA (peso no topo do prompt)
    expect(PERSONA.indexOf("IDIOMA (inviolável)")).toBeLessThan(
      PERSONA.indexOf("COMO VOCÊ RACIOCINA"),
    );
    // dado em inglês vindo de tool não pode arrastar a resposta para o inglês
    expect(PERSONA).toMatch(/mesmo que o dado da tool.*venham em inglês/i);
  });

  it("memória (Phase 106): bloco entra entre a persona e os playbooks", () => {
    const bloco = "## MEMÓRIA DA OPERAÇÃO (fatos curados e aprovados pelo lojista)\n- (decisão travada) CMV: cheio";
    const comMemoria = buildSystemPrompt(bloco);
    const idxPersona = comMemoria.indexOf("Você é o Nexo");
    const idxMemoria = comMemoria.indexOf("MEMÓRIA DA OPERAÇÃO");
    const idxPlaybooks = comMemoria.indexOf("PLAYBOOKS ESTRATÉGICOS");
    expect(idxMemoria).toBeGreaterThan(idxPersona);
    expect(idxMemoria).toBeLessThan(idxPlaybooks);
  });

  it("memória vazia/ausente: bloco omitido inteiro (não gasta token)", () => {
    expect(buildSystemPrompt()).not.toMatch(/MEMÓRIA DA OPERAÇÃO/);
    expect(buildSystemPrompt("")).not.toMatch(/MEMÓRIA DA OPERAÇÃO/);
    expect(buildSystemPrompt("   ")).not.toMatch(/MEMÓRIA DA OPERAÇÃO/);
    // e o prompt sem memória continua idêntico ao contrato anterior
    expect(buildSystemPrompt()).toBe(buildSystemPrompt(undefined));
  });

  it("regressão: ordens/greps de 103/104 continuam válidos após finalização de 105", () => {
    const idxAnti = PERSONA.indexOf("REGRA ANTI-INVENÇÃO DE NÚMERO");
    const idxVerac = PERSONA.indexOf("VERACIDADE, FRESCURA E SEMÂNTICA");
    const idxUso = PERSONA.indexOf("USO DAS FERRAMENTAS");
    expect(idxVerac).toBeGreaterThan(idxAnti);
    expect(idxVerac).toBeLessThan(idxUso);
  });
});
