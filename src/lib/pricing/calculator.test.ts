import { computePricing, reversePrice, type ExtraDeduction, type PricingInput } from "./calculator";

/**
 * Guarda para o bug do rebate (debug simulador-rebate-deducao, 14/08/2026):
 * o rebate do Mercado Livre abate a PRÓPRIA COMISSÃO — nunca é dinheiro que sai
 * do preço de venda, ao contrário de cupom/afiliado/promo (que o vendedor
 * concede e por isso reduzem o que ele recebe).
 *
 * Medido contra a API de promoções + pedidos reais de produção:
 *   MLB7070651566  fora da promoção: preço 358,89 → comissão 39,48 (11,00%)
 *                  dentro da promoção: preço 358,89 → comissão real 21,90 (6,10%)
 * O rebate absorvido pelo ML nesse caso é 39,48 − 21,90 = 17,58.
 */

const noExtra: ExtraDeduction = { enabled: false, mode: "percent", value: 0 };

function baseInput(overrides: Partial<PricingInput> = {}): PricingInput {
  return {
    cost: 100,
    salePrice: 358.89,
    commissionPct: 11,
    fixedFee: 6,
    shippingCost: 0,
    taxPct: 0,
    difalEnabled: false,
    difalPct: 0,
    rebate: { ...noExtra },
    cupom: { ...noExtra },
    afiliado: { ...noExtra },
    promo: { ...noExtra },
    ...overrides,
  };
}

describe("computePricing — rebate ML abate comissão, não o preço", () => {
  it("sem nenhum extra: comissaoValor === comissaoBruta e deducoesExtras === 0", () => {
    const r = computePricing(baseInput());
    expect(r.comissaoBruta).toBeCloseTo(39.4779, 4);
    expect(r.comissaoValor).toBeCloseTo(r.comissaoBruta, 6);
    expect(r.rebateValor).toBe(0);
    expect(r.deducoesExtras).toBe(0);
  });

  it("caso real medido (MLB7070651566): rebate em R$ reproduz a comissão efetiva de produção (21,90)", () => {
    const rebateValor = 39.4779 - 21.9; // 17,5779 — abatimento medido na API
    const r = computePricing(
      baseInput({ rebate: { enabled: true, mode: "amount", value: rebateValor } }),
    );
    expect(r.comissaoBruta).toBeCloseTo(39.4779, 4);
    expect(r.rebateValor).toBeCloseTo(rebateValor, 4);
    expect(r.comissaoValor).toBeCloseTo(21.9, 2); // bate com o sale_fee real do pedido
  });

  it("rebate NÃO entra em deducoesExtras (diferente de cupom/afiliado/promo)", () => {
    const r = computePricing(
      baseInput({ rebate: { enabled: true, mode: "amount", value: 17.58 } }),
    );
    expect(r.deducoesExtras).toBe(0);
  });

  it("cupom/afiliado/promo continuam saindo do preço (deducoesExtras), comportamento inalterado", () => {
    const r = computePricing(
      baseInput({
        cupom: { enabled: true, mode: "amount", value: 5 },
        afiliado: { enabled: true, mode: "percent", value: 2 },
        promo: { enabled: true, mode: "amount", value: 3 },
      }),
    );
    const afiliadoValor = 358.89 * 0.02;
    expect(r.deducoesExtras).toBeCloseTo(5 + afiliadoValor + 3, 4);
    expect(r.comissaoValor).toBeCloseTo(r.comissaoBruta, 6); // rebate não afetado
  });

  it("rebate é BENEFÍCIO: receitaLiquida com rebate ativo é maior que sem rebate (nunca menor)", () => {
    const semRebate = computePricing(baseInput());
    const comRebate = computePricing(
      baseInput({ rebate: { enabled: true, mode: "amount", value: 17.58 } }),
    );
    expect(comRebate.receitaLiquida).toBeGreaterThan(semRebate.receitaLiquida);
    expect(comRebate.lucro).toBeGreaterThan(semRebate.lucro);
    expect(comRebate.margemPct).toBeGreaterThan(semRebate.margemPct);
  });

  it("rebate em modo percentual reduz proportionalPct (peso da comissão), não soma a ele", () => {
    const semRebate = computePricing(baseInput());
    const comRebate = computePricing(
      baseInput({ rebate: { enabled: true, mode: "percent", value: 4 } }),
    );
    expect(comRebate.proportionalPct).toBeCloseTo(semRebate.proportionalPct - 4, 6);
  });

  it("rebate em modo valor reduz fixedDeductions, não soma a ele", () => {
    const semRebate = computePricing(baseInput());
    const comRebate = computePricing(
      baseInput({ rebate: { enabled: true, mode: "amount", value: 17.58 } }),
    );
    expect(comRebate.fixedDeductions).toBeCloseTo(semRebate.fixedDeductions - 17.58, 6);
  });
});

describe("computePricing — teto do rebate (decisão do Wesley, 14/08): nunca abate mais que a comissão bruta", () => {
  it("rebate ABAIXO da comissão: sem corte, sem aviso", () => {
    const r = computePricing(
      baseInput({ commissionPct: 11, rebate: { enabled: true, mode: "amount", value: 17.5779 } }),
    );
    expect(r.rebateExcedeComissao).toBe(false);
    expect(r.rebateValor).toBeCloseTo(17.5779, 4);
    expect(r.comissaoValor).toBeCloseTo(r.comissaoBruta - 17.5779, 4);
  });

  it("rebate EXATAMENTE igual à comissão: caso de borda, sem aviso", () => {
    const r = computePricing(
      baseInput({ salePrice: 100, commissionPct: 10, rebate: { enabled: true, mode: "amount", value: 10 } }),
    );
    expect(r.comissaoBruta).toBeCloseTo(10, 6);
    expect(r.rebateValor).toBeCloseTo(10, 6);
    expect(r.rebateExcedeComissao).toBe(false); // igual não é "excede"
    expect(r.comissaoValor).toBeCloseTo(0, 6);
  });

  it("rebate ACIMA da comissão: trava no teto, sinaliza, e comissaoValor nunca fica negativo", () => {
    const r = computePricing(
      baseInput({ salePrice: 100, commissionPct: 10, rebate: { enabled: true, mode: "amount", value: 50 } }),
    );
    expect(r.comissaoBruta).toBeCloseTo(10, 6);
    expect(r.rebateExcedeComissao).toBe(true);
    expect(r.rebateValor).toBeCloseTo(10, 6); // travado na comissão bruta, não 50
    expect(r.comissaoValor).toBeCloseTo(0, 6); // nunca negativo
    expect(r.receitaLiquida).toBeLessThanOrEqual(r.receitaBruta); // nunca "ganha" além do preço
  });

  it("rebate percentual acima de commissionPct também trava (mesmo teto, modo %)", () => {
    const r = computePricing(
      baseInput({ salePrice: 100, commissionPct: 10, rebate: { enabled: true, mode: "percent", value: 25 } }),
    );
    expect(r.rebateExcedeComissao).toBe(true);
    expect(r.comissaoValor).toBeCloseTo(0, 6);
    expect(r.rebateValor).toBeCloseTo(10, 6); // travado em 10% de 100, não 25%
  });

  it("teto reflete em proportionalPct e fixedDeductions, não só em comissaoValor: reconstrução bate com totalDeducoes", () => {
    // price*proportionalPct/100 + fixedDeductions precisa reconstruir
    // EXATAMENTE totalDeducoes — senão breakEven e o preço sugerido
    // (reversePrice) divergem do resultado exibido na tela, a mesma classe
    // de bug que este debug corrigiu para o preço.
    const r = computePricing(
      baseInput({
        salePrice: 100, commissionPct: 10, fixedFee: 3, shippingCost: 2, taxPct: 0,
        rebate: { enabled: true, mode: "amount", value: 50 }, // corta (comissão bruta = 10)
      }),
    );
    expect(r.rebateExcedeComissao).toBe(true);
    const reconstructed = (r.receitaBruta * r.proportionalPct) / 100 + r.fixedDeductions;
    expect(reconstructed).toBeCloseTo(r.totalDeducoes, 6);
  });

  it("mesma reconstrução, sem corte (rebate cabe na comissão) — identidade vale nos dois regimes", () => {
    const r = computePricing(
      baseInput({
        salePrice: 100, commissionPct: 10, fixedFee: 3, shippingCost: 2, taxPct: 0,
        rebate: { enabled: true, mode: "amount", value: 4 }, // não corta (comissão bruta = 10)
      }),
    );
    expect(r.rebateExcedeComissao).toBe(false);
    const reconstructed = (r.receitaBruta * r.proportionalPct) / 100 + r.fixedDeductions;
    expect(reconstructed).toBeCloseTo(r.totalDeducoes, 6);
  });
});

describe("reversePrice — teto do rebate em modo R$ (dependência circular resolvida)", () => {
  it("SEM corte: rebate pequeno cabe na comissão bruta do preço resolvido — comportamento igual ao de antes", () => {
    const input = baseInput({ commissionPct: 20, cost: 100, rebate: { enabled: true, mode: "amount", value: 5 } });
    const { salePrice: _drop, ...rest } = input;
    const price = reversePrice(rest, 20, "margin");
    expect(price).not.toBeNull();

    // Autoconsistência: aplicar o preço resolvido de volta no computePricing
    // não deve mostrar corte (comissão bruta nesse preço cobre os 5 pedidos).
    const back = computePricing({ ...input, salePrice: price as number });
    expect(back.rebateExcedeComissao).toBe(false);
    expect(back.margemPct).toBeCloseTo(20, 4);
  });

  it("COM corte: rebate grande não cabe na comissão bruta — reversePrice re-resolve no regime travado, e o preço devolvido bate com computePricing (a mesma margem-alvo)", () => {
    const input = baseInput({ commissionPct: 10, cost: 100, taxPct: 0, fixedFee: 0, shippingCost: 0, rebate: { enabled: true, mode: "amount", value: 50 } });
    const { salePrice: _drop, ...rest } = input;
    const price = reversePrice(rest, 20, "margin");
    expect(price).not.toBeNull();
    expect(price as number).toBeCloseTo(125, 2); // verificado manualmente: teto bate, comissão líquida = 0

    // Acceptance bar: alimentar o preço de volta no computePricing precisa
    // bater EXATAMENTE com a margem-alvo. Se divergir, o teto está errado.
    const back = computePricing({ ...input, salePrice: price as number });
    expect(back.rebateExcedeComissao).toBe(true); // confirma que o teto realmente bateu
    expect(back.comissaoValor).toBeCloseTo(0, 4); // comissão líquida travada em 0
    expect(back.margemPct).toBeCloseTo(20, 4); // a mesma margem-alvo pedida a reversePrice
  });

  it("COM corte, modo markup: preço devolvido também bate com computePricing na re-alimentação", () => {
    const input = baseInput({ commissionPct: 10, cost: 100, taxPct: 0, fixedFee: 0, shippingCost: 0, rebate: { enabled: true, mode: "amount", value: 50 } });
    const { salePrice: _drop, ...rest } = input;
    const price = reversePrice(rest, 50, "markup"); // markup 50% sobre o custo
    expect(price).not.toBeNull();

    const back = computePricing({ ...input, salePrice: price as number });
    expect(back.markupPct).toBeCloseTo(50, 3);
  });

  it("comissão zero: rebate em R$ não tem nada pra abater — contribui 0, sem quebrar reversePrice", () => {
    const input = baseInput({ commissionPct: 0, cost: 100, taxPct: 0, fixedFee: 0, shippingCost: 0, rebate: { enabled: true, mode: "amount", value: 50 } });
    const { salePrice: _drop, ...rest } = input;
    const price = reversePrice(rest, 20, "margin");
    const semRebate = reversePrice({ ...rest, rebate: { enabled: false, mode: "amount", value: 0 } }, 20, "margin");
    expect(price).toBeCloseTo(semRebate as number, 6);
  });
});

describe("reversePrice — rebate reduz o preço mínimo necessário para a mesma margem", () => {
  it("preço mínimo com rebate ativo é MENOR que sem rebate, para a mesma margem-alvo", () => {
    const input = baseInput({ commissionPct: 16, taxPct: 6 });
    const { salePrice: _drop, ...rest } = input;
    const semRebate = reversePrice(rest, 20, "margin");
    const comRebate = reversePrice(
      { ...rest, rebate: { enabled: true, mode: "percent", value: 4 } },
      20,
      "margin",
    );
    expect(semRebate).not.toBeNull();
    expect(comRebate).not.toBeNull();
    expect(comRebate as number).toBeLessThan(semRebate as number);
  });

  it("cupom/afiliado/promo continuam elevando o preço mínimo (comportamento inalterado)", () => {
    const input = baseInput({ commissionPct: 16, taxPct: 6 });
    const { salePrice: _drop, ...rest } = input;
    const semExtra = reversePrice(rest, 20, "margin");
    const comCupom = reversePrice(
      { ...rest, cupom: { enabled: true, mode: "percent", value: 4 } },
      20,
      "margin",
    );
    expect(semExtra).not.toBeNull();
    expect(comCupom).not.toBeNull();
    expect(comCupom as number).toBeGreaterThan(semExtra as number);
  });
});
