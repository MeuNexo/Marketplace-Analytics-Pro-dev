// ============================================================================
// anuncioMargens.test.ts — Fase 213, Plano 03, Task 1 (CR-08, AV-04)
//
// Prova de que a margem teórica do catálogo é UMA implementação só, e que ela
// nunca finge um número que não existe: custo ausente e alíquota ausente
// produzem margem indefinida, nunca zero. O teste central é o de paridade —
// monta a entrada como o ramo mobile a montaria e como o ramo desktop a
// montaria, para o mesmo anúncio, e exige igualdade estrita do resultado.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  calcularMargensDoAnuncio,
  difalPctReferencia,
  JANELA_DIFAL_REFERENCIA_DIAS,
  precoPromocionalAplicavel,
  type EntradaMargemAnuncio,
} from "./anuncioMargens";

// ─── calcularMargensDoAnuncio ──────────────────────────────────────────────

describe("calcularMargensDoAnuncio", () => {
  it("Test 1: com custo, comissão real e imposto conhecidos, calcula a margem líquida completa", () => {
    const r = calcularMargensDoAnuncio({
      precoTabela: 100,
      usarPromocao: false,
      custo: 40,
      aliquotaEfetivaPct: 12,
      comissaoRealPct: 11.5,
      tipoAnuncio: "MLB_gold_special",
    });

    expect(r.precoEfetivo).toBe(100);
    expect(r.comissaoReal).toBe(true);
    expect(r.comissaoPct).toBe(11.5);
    expect(r.comissaoValor).toBeCloseTo(11.5, 6);
    expect(r.impostoValor).toBeCloseTo(12, 6);
    // margem bruta = (100 - 40) / 100 * 100 = 60
    expect(r.margemBruta).toBeCloseTo(60, 6);
    // margem líquida = (100 - 40 - 11.5 - 12) / 100 * 100 = 36.5
    expect(r.margemLiquida).toBeCloseTo(36.5, 6);
  });

  it("Test 2: sem custo cadastrado, margem bruta e margem líquida são indefinidas — nunca zero", () => {
    const r = calcularMargensDoAnuncio({
      precoTabela: 150,
      usarPromocao: false,
      custo: null,
      aliquotaEfetivaPct: 10,
      comissaoRealPct: 12,
      tipoAnuncio: null,
    });

    expect(r.margemBruta).toBeNull();
    expect(r.margemLiquida).toBeNull();
    // o resto do cálculo continua acontecendo normalmente — a ausência é só do custo
    expect(r.comissaoValor).toBeCloseTo(18, 6);
    expect(r.impostoValor).toBeCloseTo(15, 6);
  });

  it("Test 3: sem comissão real da API, cai para a tabela estática por tipo de anúncio e marca estimada", () => {
    const classico = calcularMargensDoAnuncio({
      precoTabela: 100,
      usarPromocao: false,
      custo: 40,
      aliquotaEfetivaPct: 10,
      comissaoRealPct: null,
      tipoAnuncio: null, // sem tipo → cai no fallback "clássico"
    });
    expect(classico.comissaoReal).toBe(false);
    expect(classico.comissaoPct).toBeCloseTo(11.5, 6); // LISTING_TYPE_RATES.classic = 0.115

    const premium = calcularMargensDoAnuncio({
      precoTabela: 100,
      usarPromocao: false,
      custo: 40,
      aliquotaEfetivaPct: 10,
      comissaoRealPct: undefined,
      tipoAnuncio: "MLB2226568_premium",
    });
    expect(premium.comissaoReal).toBe(false);
    expect(premium.comissaoPct).toBeCloseTo(16.5, 6); // LISTING_TYPE_RATES.premium = 0.165
  });

  it("Test 4: comissão real igual a 0% não é confundida com ausência — permanece real", () => {
    const r = calcularMargensDoAnuncio({
      precoTabela: 100,
      usarPromocao: false,
      custo: 40,
      aliquotaEfetivaPct: 10,
      comissaoRealPct: 0,
      tipoAnuncio: "MLB_gold_special",
    });

    expect(r.comissaoReal).toBe(true);
    expect(r.comissaoPct).toBe(0);
    expect(r.comissaoValor).toBe(0);
  });

  it("Test 5: sem alíquota configurada, o imposto é indefinido e a margem líquida também — o defeito do ramo mobile", () => {
    const r = calcularMargensDoAnuncio({
      precoTabela: 100,
      usarPromocao: false,
      custo: 40,
      aliquotaEfetivaPct: null,
      comissaoRealPct: 11.5,
      tipoAnuncio: null,
    });

    expect(r.impostoValor).toBeNull();
    expect(r.margemLiquida).toBeNull();
    // margem bruta não depende de imposto — continua calculada
    expect(r.margemBruta).toBeCloseTo(60, 6);
  });

  it("Test 6: alíquota configurada em 0% é uma alíquota válida, não ausência", () => {
    const r = calcularMargensDoAnuncio({
      precoTabela: 100,
      usarPromocao: false,
      custo: 40,
      aliquotaEfetivaPct: 0,
      comissaoRealPct: 11.5,
      tipoAnuncio: null,
    });

    expect(r.impostoValor).toBe(0);
    // margem líquida = (100 - 40 - 11.5 - 0) / 100 * 100 = 48.5
    expect(r.margemLiquida).toBeCloseTo(48.5, 6);
  });

  it("Test 7: preço efetivo usa a promoção quando pedida e ela é menor que o preço de tabela", () => {
    const r = calcularMargensDoAnuncio({
      precoTabela: 100,
      precoPromocional: 80,
      usarPromocao: true,
      custo: 40,
      aliquotaEfetivaPct: 10,
      comissaoRealPct: 10,
      tipoAnuncio: null,
    });

    expect(r.precoEfetivo).toBe(80);
  });

  it("Test 8: preço efetivo ignora a promoção quando o chamador não pediu", () => {
    const r = calcularMargensDoAnuncio({
      precoTabela: 100,
      precoPromocional: 80,
      usarPromocao: false,
      custo: 40,
      aliquotaEfetivaPct: 10,
      comissaoRealPct: 10,
      tipoAnuncio: null,
    });

    expect(r.precoEfetivo).toBe(100);
  });

  it("Test 9: preço efetivo ignora a promoção quando ela não é menor que o preço de tabela", () => {
    const maior = calcularMargensDoAnuncio({
      precoTabela: 100,
      precoPromocional: 110,
      usarPromocao: true,
      custo: 40,
      aliquotaEfetivaPct: 10,
      comissaoRealPct: 10,
      tipoAnuncio: null,
    });
    expect(maior.precoEfetivo).toBe(100);

    const igual = calcularMargensDoAnuncio({
      precoTabela: 100,
      precoPromocional: 100,
      usarPromocao: true,
      custo: 40,
      aliquotaEfetivaPct: 10,
      comissaoRealPct: 10,
      tipoAnuncio: null,
    });
    expect(igual.precoEfetivo).toBe(100);
  });

  it("Test 10: preço efetivo zero ou negativo devolve margens indefinidas, sem divisão por zero", () => {
    const zero = calcularMargensDoAnuncio({
      precoTabela: 0,
      usarPromocao: false,
      custo: 10,
      aliquotaEfetivaPct: 5,
      comissaoRealPct: 10,
      tipoAnuncio: null,
    });
    expect(zero.margemBruta).toBeNull();
    expect(zero.margemLiquida).toBeNull();
    expect(Number.isFinite(zero.comissaoValor)).toBe(true);
    expect(Number.isNaN(zero.comissaoValor)).toBe(false);
    expect(Number.isFinite(zero.impostoValor as number)).toBe(true);

    const negativo = calcularMargensDoAnuncio({
      precoTabela: -50,
      usarPromocao: false,
      custo: 10,
      aliquotaEfetivaPct: 5,
      comissaoRealPct: 10,
      tipoAnuncio: null,
    });
    expect(negativo.margemBruta).toBeNull();
    expect(negativo.margemLiquida).toBeNull();
    expect(Number.isNaN(negativo.margemBruta as unknown as number)).toBe(false);
  });

  // ─── Paridade mobile × desktop (o teste central deste plano) ────────────

  describe("paridade entre a entrada do ramo mobile e a do ramo desktop", () => {
    // Fixture compartilhada: um único anúncio, como ele existe de verdade no
    // app — preço de tabela, custo keyado por item_id OU por SKU (sync do
    // Tiny), alíquota por loja, comissão real em cache, e cache de preço
    // promocional. As duas funções abaixo replicam, de forma independente, a
    // resolução que cada ramo de MLAnuncios.tsx faz a partir dessas fontes.

    const item = {
      id: "MLB111",
      price: 259.9,
      listing_type_id: "gold_special",
      seller_custom_field: "CAM-AZUL-M",
      _ml_user_id: "1639558873",
    };
    const custosPorItemId = new Map<string, { cost: number; tax_rate: number | null }>([
      ["MLB111", { cost: 120, tax_rate: null }],
    ]);
    const custosPorSku = new Map<string, { cost: number; tax_rate: number | null }>();
    const taxMap = new Map<string, { effective_rate: number }>([["1639558873", { effective_rate: 9.25 }]]);
    const commCache = new Map<string, { pct: number; amount: number }>([["MLB111", { pct: 12.0, amount: 31.19 }]]);
    const dealPriceCache = new Map<string, number>(); // sem promoção ativa
    const usePromoPrice = false;

    // Réplica da resolução do ramo MOBILE (pós-fix AV-05: usa seller_custom_field)
    function construirEntradaMobile(): EntradaMargemAnuncio {
      const productCost = custosPorItemId.get(item.id) ?? custosPorSku.get(item.seller_custom_field ?? "");
      const cost = productCost?.cost ?? null;
      const taxEntry = item._ml_user_id ? taxMap.get(item._ml_user_id) : undefined;
      const effectiveTaxRate = taxEntry != null ? Math.max(0, taxEntry.effective_rate) : (productCost?.tax_rate ?? null);
      const commCached = commCache.get(item.id);
      return {
        precoTabela: item.price,
        precoPromocional: dealPriceCache.get(item.id) ?? null,
        usarPromocao: usePromoPrice,
        custo: cost,
        aliquotaEfetivaPct: effectiveTaxRate,
        comissaoRealPct: commCached?.pct ?? null,
        tipoAnuncio: item.listing_type_id,
      };
    }

    // Réplica da resolução do ramo DESKTOP (a fórmula que já estava certa)
    function construirEntradaDesktop(): EntradaMargemAnuncio {
      const sku = item.seller_custom_field || null;
      const productCost = custosPorItemId.get(item.id) ?? (sku ? custosPorSku.get(sku) : undefined);
      const cost = productCost?.cost ?? null;
      const taxEntry = item._ml_user_id ? taxMap.get(item._ml_user_id) : undefined;
      const effectiveTaxRate = taxEntry != null ? Math.max(0, taxEntry.effective_rate) : (productCost?.tax_rate ?? null);
      const commCached = commCache.get(item.id);
      return {
        precoTabela: item.price,
        precoPromocional: dealPriceCache.get(item.id) ?? null,
        usarPromocao: usePromoPrice,
        custo: cost,
        aliquotaEfetivaPct: effectiveTaxRate,
        comissaoRealPct: commCached?.pct ?? null,
        tipoAnuncio: item.listing_type_id,
      };
    }

    it("Test 11: caso simples — comissão real, sem promoção — devolve exatamente o mesmo resultado nos dois ramos", () => {
      const resultadoMobile = calcularMargensDoAnuncio(construirEntradaMobile());
      const resultadoDesktop = calcularMargensDoAnuncio(construirEntradaDesktop());

      // Sanidade: o teste não pode passar porque os dois lados são null/vazios
      expect(resultadoMobile.margemLiquida).not.toBeNull();
      expect(resultadoMobile.comissaoReal).toBe(true);

      expect(resultadoMobile).toEqual(resultadoDesktop);
    });

    it("Test 12: caso AV-05 — custo cadastrado SÓ por SKU (nunca por item_id), com promoção ativa e comissão caindo pro fallback — ainda assim os dois ramos batem", () => {
      // Anúncio diferente: custo só existe em ml_product_costs por seller_sku
      // (é exatamente o caso que o mobile, antes do fix, nunca enxergava —
      // ele lia item.seller_sku, campo que não existe no tipo ProductItem).
      const item2 = {
        id: "MLB222",
        price: 199.9,
        listing_type_id: null as string | null, // sem tipo → fallback estático
        seller_custom_field: "BON-VERM-U",
        _ml_user_id: "1639558873",
      };
      const custosPorItemId2 = new Map<string, { cost: number; tax_rate: number | null }>(); // vazio de propósito
      const custosPorSku2 = new Map<string, { cost: number; tax_rate: number | null }>([
        ["BON-VERM-U", { cost: 65, tax_rate: null }],
      ]);
      const commCache2 = new Map<string, { pct: number; amount: number }>(); // cache ainda não respondeu
      const dealPriceCache2 = new Map<string, number>([["MLB222", 159.9]]); // promoção ativa
      const usarPromocao2 = true;

      function construirEntradaMobile2(): EntradaMargemAnuncio {
        const productCost = custosPorItemId2.get(item2.id) ?? custosPorSku2.get(item2.seller_custom_field ?? "");
        const cost = productCost?.cost ?? null;
        const taxEntry = item2._ml_user_id ? taxMap.get(item2._ml_user_id) : undefined;
        const effectiveTaxRate = taxEntry != null ? Math.max(0, taxEntry.effective_rate) : (productCost?.tax_rate ?? null);
        const commCached = commCache2.get(item2.id);
        return {
          precoTabela: item2.price,
          precoPromocional: dealPriceCache2.get(item2.id) ?? null,
          usarPromocao: usarPromocao2,
          custo: cost,
          aliquotaEfetivaPct: effectiveTaxRate,
          comissaoRealPct: commCached?.pct ?? null,
          tipoAnuncio: item2.listing_type_id,
        };
      }

      function construirEntradaDesktop2(): EntradaMargemAnuncio {
        const sku = item2.seller_custom_field || null;
        const productCost = custosPorItemId2.get(item2.id) ?? (sku ? custosPorSku2.get(sku) : undefined);
        const cost = productCost?.cost ?? null;
        const taxEntry = item2._ml_user_id ? taxMap.get(item2._ml_user_id) : undefined;
        const effectiveTaxRate = taxEntry != null ? Math.max(0, taxEntry.effective_rate) : (productCost?.tax_rate ?? null);
        const commCached = commCache2.get(item2.id);
        const effectivePrice = usarPromocao2 ? (dealPriceCache2.get(item2.id) ?? item2.price) : item2.price;
        return {
          precoTabela: item2.price,
          precoPromocional: dealPriceCache2.get(item2.id) ?? null,
          usarPromocao: usarPromocao2,
          custo: cost,
          aliquotaEfetivaPct: effectiveTaxRate,
          comissaoRealPct: commCached?.pct ?? null,
          tipoAnuncio: item2.listing_type_id,
        };
      }

      const resultadoMobile = calcularMargensDoAnuncio(construirEntradaMobile2());
      const resultadoDesktop = calcularMargensDoAnuncio(construirEntradaDesktop2());

      // Sanidade: custo foi encontrado (prova que a resolução por SKU funcionou
      // nos dois lados) e a comissão caiu mesmo para a estimativa
      expect(resultadoMobile.margemBruta).not.toBeNull();
      expect(resultadoMobile.comissaoReal).toBe(false);
      expect(resultadoMobile.precoEfetivo).toBe(159.9); // promoção aplicada

      expect(resultadoMobile).toEqual(resultadoDesktop);
    });
  });
});

// ─── precoPromocionalAplicavel ─────────────────────────────────────────────

describe("precoPromocionalAplicavel", () => {
  it("Test 13: sem promoção ativa no pai, devolve ausência", () => {
    expect(precoPromocionalAplicavel(null, 100, 100)).toBeNull();
    expect(precoPromocionalAplicavel(undefined, 100, 100)).toBeNull();
  });

  it("Test 14: variação que parte do mesmo preço de tabela do pai recebe o preço promocional do pai", () => {
    expect(precoPromocionalAplicavel(80, 100, 100)).toBe(80);
  });

  it("Test 15: variação com preço próprio diferente do pai devolve ausência — nem desconto, nem selo fabricado", () => {
    // variação mais cara que o pai
    expect(precoPromocionalAplicavel(80, 100, 120)).toBeNull();
    // variação mais barata que o pai
    expect(precoPromocionalAplicavel(80, 100, 90)).toBeNull();
  });
});

// ─── Segundo cenário da margem TEÓRICA (Fase 222, plano 222-15-R2) ──────────
//
// A margem teórica não conhece pedido nenhum: ela usa a alíquota INTRAESTADUAL,
// e operação intraestadual não tem DIFAL. O segundo cenário desta tela é uma
// alíquota de REFERÊNCIA medida na mistura de estados realmente vendidos — e a
// tela é obrigada a dizer isso, senão o número aparenta uma precisão por
// anúncio que ele não tem.

describe("calcularMargensDoAnuncio — alíquota de referência do DIFAL", () => {
  const base = {
    precoTabela: 100,
    usarPromocao: false,
    custo: 40,
    aliquotaEfetivaPct: 10,
    comissaoRealPct: 12,
    tipoAnuncio: "gold_special",
  } as const;

  it("sem referência informada, o resultado é o de hoje — os campos novos saem nulos", () => {
    const hoje = calcularMargensDoAnuncio({ ...base });

    expect(hoje).toEqual({
      precoEfetivo: 100,
      comissaoValor: 12,
      comissaoPct: 12,
      comissaoReal: true,
      impostoValor: 10,
      margemBruta: 60,
      margemLiquida: 38,
      impostoValorComDifal: null,
      margemLiquidaComDifal: null,
    });
  });

  it("com referência, o segundo conjunto sai da MESMA expressão, com a alíquota somada", () => {
    const r = calcularMargensDoAnuncio({ ...base, difalPctReferencia: 4 });

    // Primeiro cenário intocado.
    expect(r.impostoValor).toBe(10);
    expect(r.margemLiquida).toBe(38);
    // Segundo: alíquota 10 + 4 = 14 ⇒ imposto 14 ⇒ (100 − 40 − 12 − 14)/100.
    expect(r.impostoValorComDifal).toBeCloseTo(14, 10);
    expect(r.margemLiquidaComDifal).toBeCloseTo(34, 10);
  });

  it("referência sobre o preço PROMOCIONAL quando é ele que vale", () => {
    const r = calcularMargensDoAnuncio({
      ...base,
      precoPromocional: 80,
      usarPromocao: true,
      difalPctReferencia: 5,
    });

    expect(r.precoEfetivo).toBe(80);
    expect(r.impostoValorComDifal).toBeCloseTo(12, 10); // 80 × 15%
  });

  it("sem alíquota da loja configurada, o segundo cenário também é indefinido", () => {
    // Somar a referência a uma alíquota inexistente afirmaria que a loja paga
    // só o DIFAL — que é exatamente o defeito do ramo mobile que o CR-08
    // fechou, na versão fiscal.
    const r = calcularMargensDoAnuncio({
      ...base,
      aliquotaEfetivaPct: null,
      difalPctReferencia: 4,
    });

    expect(r.impostoValor).toBeNull();
    expect(r.impostoValorComDifal).toBeNull();
    expect(r.margemLiquidaComDifal).toBeNull();
  });

  it("sem custo cadastrado, a margem líquida com DIFAL fica indefinida — nunca zero", () => {
    const r = calcularMargensDoAnuncio({ ...base, custo: null, difalPctReferencia: 4 });

    expect(r.margemLiquida).toBeNull();
    expect(r.margemLiquidaComDifal).toBeNull();
    // ...mas o imposto do segundo cenário existe: ele não depende do custo.
    expect(r.impostoValorComDifal).toBeCloseTo(14, 10);
  });

  it("referência de ZERO é resultado medido: os dois cenários coincidem, sem virar ausência", () => {
    const r = calcularMargensDoAnuncio({ ...base, difalPctReferencia: 0 });

    expect(r.impostoValorComDifal).toBe(10);
    expect(r.margemLiquidaComDifal).toBe(38);
  });
});

describe("difalPctReferencia — a razão que vira ponto percentual", () => {
  it("é o efeito líquido dividido pela receita base dos MESMOS pedidos", () => {
    expect(difalPctReferencia(1200, 30000)).toBeCloseTo(4, 10);
  });

  it("sem receita medida na janela, a referência é AUSENTE — nunca 0%", () => {
    // 0% seria lido como "o DIFAL não custa nada", que é o oposto de "não há
    // venda medida no período".
    expect(difalPctReferencia(0, 0)).toBeNull();
    expect(difalPctReferencia(1200, 0)).toBeNull();
    expect(difalPctReferencia(1200, null)).toBeNull();
    expect(difalPctReferencia(null, 30000)).toBeNull();
  });

  it("efeito líquido zero com receita medida é 0% de verdade — resultado, não ausência", () => {
    expect(difalPctReferencia(0, 30000)).toBe(0);
  });

  it("a janela da medição existe como constante nomeada", () => {
    expect(JANELA_DIFAL_REFERENCIA_DIAS).toBe(90);
  });
});
