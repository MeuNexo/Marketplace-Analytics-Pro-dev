/**
 * Testes do utilitário puro de agregação pós-ads (MCO) por marca/categoria e por anúncio.
 *
 * Cobre os casos obrigatórios do PLAN 83-01:
 *   1. aggregateMcoGroups por marca: agrupa por row.marca, ordena por revenue desc
 *   2. aggregateMcoGroups por categoria via itemsMap.category_id
 *   3. mcoPct do grupo = Σlucro_pos_ads ÷ Σreceita × 100 (não média de %)
 *   4. redCount conta anúncios do grupo com saúde 'vermelho'
 *   5. hasMissingCost = true quando algum anúncio do grupo tem has_cmv=false
 *   6. aggregateMcoItems: has_cmv=false → health='indefinido'
 *   7. aggregateMcoItems: acosPct null quando receita=0
 *   8. aggregateMcoItems: shareOfGroup soma 1 dentro do grupo
 *   9. aggregateMcoItems: ordenação por revenue desc
 *   10. PvMcoItem repassa fielmente os 6 campos do tooltip (cmv, comissao, frete, impostos, adsSpend, mcoReais)
 *
 * Phase: 83-produtos-vendidos-mco-redesign / Plan 01 (TDD RED → GREEN)
 */

import { describe, it, expect } from "vitest";
import { aggregateMcoGroups, aggregateMcoItems, curvasDaCarteira } from "./soldProductsMcoAgg";
import type { McoProductRow } from "./soldProductsMcoAgg";
import { ratearAdsDaCarteira } from "@/lib/adsRateio";
import type { AdsBillingSpend } from "@/lib/adsBillingSpend";

// ─── Dados de fixture ─────────────────────────────────────────────────────────

const makeRow = (overrides: Partial<McoProductRow> & { item_id: string }): McoProductRow => ({
  titulo: null,
  marca: null,
  receita: 0,
  unidades: 0,
  cmv: 0,
  comissao: 0,
  frete: 0,
  impostos: 0,
  ads_spend: 0,
  lucro: 0,
  lucro_pct: null,
  lucro_pos_ads: 0,
  lucro_pct_pos_ads: null,
  has_cmv: true,
  ...overrides,
});

const buildItemsMap = (entries: Array<{ id: string; category_id?: string | null; title?: string }>) => {
  const m = new Map<string, { category_id?: string | null; title?: string }>();
  entries.forEach((e) => m.set(e.id, { category_id: e.category_id, title: e.title }));
  return m;
};

// ─── Testes ──────────────────────────────────────────────────────────────────

describe("aggregateMcoGroups", () => {
  it("agrupa por row.marca e ordena por revenue desc", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 100, unidades: 2, lucro_pos_ads: 3, lucro_pct_pos_ads: 3 }),
      makeRow({ item_id: "MLB002", marca: "Marca B", receita: 500, unidades: 5, lucro_pos_ads: 50, lucro_pct_pos_ads: 10 }),
    ];
    const result = aggregateMcoGroups(rows, "marca", new Map());

    expect(result).toHaveLength(2);
    expect(result[0].key).toBe("Marca B");
    expect(result[0].revenue).toBe(500);
    expect(result[1].key).toBe("Marca A");
  });

  it("marca null vira chave \"\" com name \"Sem marca\"", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: null, receita: 100, unidades: 1, lucro_pos_ads: 10, lucro_pct_pos_ads: 10 }),
    ];
    const result = aggregateMcoGroups(rows, "marca", new Map());

    expect(result[0].key).toBe("");
    expect(result[0].name).toBe("Sem marca");
  });

  it("agrupa por category_id via itemsMap quando pvView='categoria'", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", receita: 200, unidades: 2, lucro_pos_ads: 20, lucro_pct_pos_ads: 10 }),
      makeRow({ item_id: "MLB002", receita: 300, unidades: 3, lucro_pos_ads: 30, lucro_pct_pos_ads: 10 }),
    ];
    const itemsMap = buildItemsMap([
      { id: "MLB001", category_id: "CAT_01" },
      { id: "MLB002", category_id: "CAT_02" },
    ]);

    const result = aggregateMcoGroups(rows, "categoria", itemsMap);

    expect(result).toHaveLength(2);
    expect(result[0].key).toBe("CAT_02");
    expect(result[1].key).toBe("CAT_01");
  });

  it("item não encontrado no itemsMap vira \"Sem categoria\"", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB_UNKNOWN", receita: 100, unidades: 1, lucro_pos_ads: 5, lucro_pct_pos_ads: 5 }),
    ];
    const result = aggregateMcoGroups(rows, "categoria", new Map());

    expect(result[0].key).toBe("");
    expect(result[0].name).toBe("Sem categoria");
  });

  it("mcoPct do grupo = Σlucro_pos_ads ÷ Σreceita × 100 (não média de %)", () => {
    // item1: receita 100, lucro_pos_ads 3 (pct=3%, vermelho)
    // item2: receita 200, lucro_pos_ads 30 (pct=15%, verde)
    // mcoPct grupo = (3+30)/(100+200)*100 = 11 (NÃO a média simples (3+15)/2=9)
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 100, unidades: 1, lucro_pos_ads: 3, lucro_pct_pos_ads: 3 }),
      makeRow({ item_id: "MLB002", marca: "Marca A", receita: 200, unidades: 1, lucro_pos_ads: 30, lucro_pct_pos_ads: 15 }),
    ];
    const result = aggregateMcoGroups(rows, "marca", new Map());

    expect(result).toHaveLength(1);
    expect(result[0].mcoPct).toBeCloseTo(11, 5);
  });

  it("mcoPct do grupo é null quando receita total = 0", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 0, unidades: 0, lucro_pos_ads: 0, lucro_pct_pos_ads: null }),
    ];
    const result = aggregateMcoGroups(rows, "marca", new Map());

    expect(result[0].mcoPct).toBeNull();
  });

  it("redCount conta anúncios do grupo com saúde vermelho", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 100, unidades: 1, lucro_pos_ads: 3, lucro_pct_pos_ads: 3 }), // vermelho (<=5)
      makeRow({ item_id: "MLB002", marca: "Marca A", receita: 200, unidades: 1, lucro_pos_ads: 30, lucro_pct_pos_ads: 15 }), // verde
      makeRow({ item_id: "MLB003", marca: "Marca A", receita: 50, unidades: 1, lucro_pos_ads: 1, lucro_pct_pos_ads: 2 }), // vermelho (<=5)
    ];
    const result = aggregateMcoGroups(rows, "marca", new Map());

    expect(result[0].redCount).toBe(2);
  });

  it("hasMissingCost = true quando algum anúncio do grupo tem has_cmv=false", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 100, unidades: 1, lucro_pos_ads: 10, lucro_pct_pos_ads: 10, has_cmv: true }),
      makeRow({ item_id: "MLB002", marca: "Marca A", receita: 200, unidades: 1, lucro_pos_ads: 20, lucro_pct_pos_ads: 10, has_cmv: false }),
    ];
    const result = aggregateMcoGroups(rows, "marca", new Map());

    expect(result[0].hasMissingCost).toBe(true);
  });

  it("hasMissingCost = false quando todos os anúncios do grupo têm has_cmv=true", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 100, unidades: 1, lucro_pos_ads: 10, lucro_pct_pos_ads: 10, has_cmv: true }),
    ];
    const result = aggregateMcoGroups(rows, "marca", new Map());

    expect(result[0].hasMissingCost).toBe(false);
  });

  it("rows vazio retorna array vazio", () => {
    expect(aggregateMcoGroups([], "marca", new Map())).toHaveLength(0);
  });
});

describe("aggregateMcoItems", () => {
  it("mcoPct do item = lucro_pct_pos_ads (repassado do row)", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 100, unidades: 1, lucro_pos_ads: 12, lucro_pct_pos_ads: 12.34 }),
    ];
    const result = aggregateMcoItems(rows, "Marca A", "marca", new Map());

    expect(result[0].mcoPct).toBe(12.34);
    expect(result[0].mcoReais).toBe(12);
  });

  it("acosPct = ads_spend/receita*100; null quando receita=0", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 200, unidades: 1, ads_spend: 20, lucro_pos_ads: 10, lucro_pct_pos_ads: 5 }),
      makeRow({ item_id: "MLB002", marca: "Marca A", receita: 0, unidades: 0, ads_spend: 10, lucro_pos_ads: -10, lucro_pct_pos_ads: null }),
    ];
    const result = aggregateMcoItems(rows, "Marca A", "marca", new Map());

    const item1 = result.find((r) => r.item_id === "MLB001")!;
    const item2 = result.find((r) => r.item_id === "MLB002")!;

    expect(item1.acosPct).toBeCloseTo(10, 5);
    expect(item2.acosPct).toBeNull();
  });

  it("has_cmv=false → health='indefinido' (nunca zerar/inventar número)", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 100, unidades: 1, lucro_pos_ads: 10, lucro_pct_pos_ads: 10, has_cmv: false }),
    ];
    const result = aggregateMcoItems(rows, "Marca A", "marca", new Map());

    expect(result[0].health).toBe("indefinido");
    expect(result[0].hasCmv).toBe(false);
  });

  it("has_cmv=true classifica saúde via classifyMcoHealth", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 100, unidades: 1, lucro_pos_ads: 3, lucro_pct_pos_ads: 3, has_cmv: true }),
      makeRow({ item_id: "MLB002", marca: "Marca A", receita: 100, unidades: 1, lucro_pos_ads: 12, lucro_pct_pos_ads: 12, has_cmv: true }),
    ];
    const result = aggregateMcoItems(rows, "Marca A", "marca", new Map());

    const vermelho = result.find((r) => r.item_id === "MLB001")!;
    const verde = result.find((r) => r.item_id === "MLB002")!;

    expect(vermelho.health).toBe("vermelho");
    expect(verde.health).toBe("verde");
  });

  it("shareOfGroup soma 1.0 dentro do grupo (totalRevenue > 0)", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 200, unidades: 2, lucro_pos_ads: 20, lucro_pct_pos_ads: 10 }),
      makeRow({ item_id: "MLB002", marca: "Marca A", receita: 300, unidades: 3, lucro_pos_ads: 30, lucro_pct_pos_ads: 10 }),
      makeRow({ item_id: "MLB003", marca: "Marca B", receita: 500, unidades: 5, lucro_pos_ads: 50, lucro_pct_pos_ads: 10 }), // outro grupo
    ];
    const result = aggregateMcoItems(rows, "Marca A", "marca", new Map());

    expect(result).toHaveLength(2);
    const totalShare = result.reduce((sum, item) => sum + item.shareOfGroup, 0);
    expect(totalShare).toBeCloseTo(1.0, 10);

    // Ordenação por revenue desc: MLB002 (300) > MLB001 (200)
    expect(result[0].item_id).toBe("MLB002");
    expect(result[1].item_id).toBe("MLB001");
  });

  it("shareOfGroup = 0 quando totalRevenue = 0", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 0, unidades: 0, lucro_pos_ads: 0, lucro_pct_pos_ads: null }),
    ];
    const result = aggregateMcoItems(rows, "Marca A", "marca", new Map());

    expect(result[0].shareOfGroup).toBe(0);
  });

  it("título preferindo itemsMap.title, fallback row.titulo, fallback item_id", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", titulo: "Título do row", receita: 100, unidades: 1, lucro_pos_ads: 10, lucro_pct_pos_ads: 10 }),
      makeRow({ item_id: "MLB002", marca: "Marca A", titulo: null, receita: 50, unidades: 1, lucro_pos_ads: 5, lucro_pct_pos_ads: 5 }),
    ];
    const itemsMap = buildItemsMap([{ id: "MLB001", title: "Título do inventory" }]);

    const result = aggregateMcoItems(rows, "Marca A", "marca", itemsMap);

    const item1 = result.find((r) => r.item_id === "MLB001")!;
    const item2 = result.find((r) => r.item_id === "MLB002")!;

    expect(item1.title).toBe("Título do inventory");
    expect(item2.title).toBe("MLB002"); // fallback item_id (titulo null)
  });

  it("repassa fielmente os 6 campos do tooltip (cmv, comissao, frete, impostos, adsSpend, mcoReais)", () => {
    const rows: McoProductRow[] = [
      makeRow({
        item_id: "MLB001",
        marca: "Marca A",
        receita: 100,
        unidades: 1,
        cmv: 30,
        comissao: 12,
        frete: 6.5,
        impostos: 9,
        ads_spend: 8.1,
        lucro_pos_ads: 34.4,
        lucro_pct_pos_ads: 34.4,
      }),
    ];
    const result = aggregateMcoItems(rows, "Marca A", "marca", new Map());

    expect(result[0].cmv).toBe(30);
    expect(result[0].comissao).toBe(12);
    expect(result[0].frete).toBe(6.5);
    expect(result[0].impostos).toBe(9);
    expect(result[0].adsSpend).toBe(8.1);
    expect(result[0].mcoReais).toBe(34.4);
  });

  it("filtra por categoria quando pvView='categoria'", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", receita: 100, unidades: 1, lucro_pos_ads: 10, lucro_pct_pos_ads: 10 }),
      makeRow({ item_id: "MLB002", receita: 200, unidades: 1, lucro_pos_ads: 20, lucro_pct_pos_ads: 10 }),
    ];
    const itemsMap = buildItemsMap([
      { id: "MLB001", category_id: "CAT_01" },
      { id: "MLB002", category_id: "CAT_02" },
    ]);

    const result = aggregateMcoItems(rows, "CAT_01", "categoria", itemsMap);

    expect(result).toHaveLength(1);
    expect(result[0].item_id).toBe("MLB001");
  });
});

// ============================================================================
// Fase 212 — a agregação em cima da publicidade RATEADA
//
// Prova de ponta a ponta do caminho que a tela Produtos Vendidos percorre:
// fatura do ML → `ratearAdsDaCarteira` → linhas de margem → `aggregateMcoItems`.
// Os números são os medidos em produção (Pé Vermeio, MLB7060842760, 05/07 a
// 04/08/2026): fatura PADS+BPAD 9.474,36 · cache do período 14.790,21 · cache
// do anúncio 751,88 · receita 20.686,52 · lucro pré-ads 4.035,49 · 48 unidades.
// ============================================================================

describe("agregação com publicidade rateada da fatura (Fase 212)", () => {
  const FATURA: AdsBillingSpend = {
    daily: [{ date: "2026-07-05", spend: 9474.36 }],
    total: 9474.36,
    rowCount: 31,
    coverageFrom: "2026-07-05",
    coverageTo: "2026-08-04",
  };

  /** Reproduz o que `useMLMarginWithAds` faz: rateia e reescreve as linhas. */
  function comRateio(
    fatura: AdsBillingSpend | null,
    brutas: Array<McoProductRow & { lucroPreAds: number }>,
  ): McoProductRow[] {
    const rateio = ratearAdsDaCarteira(
      fatura,
      brutas.map((r) => ({ itemId: r.item_id, cacheSpend: r.ads_spend })),
    );
    return brutas.map((r) => {
      const ads = rateio.porItem.get(r.item_id) ?? 0;
      const lucro = r.lucroPreAds - ads;
      return {
        ...r,
        ads_spend: ads,
        lucro_pos_ads: lucro,
        lucro_pct_pos_ads: r.receita > 0 ? Math.round((lucro / r.receita) * 10000) / 100 : null,
      };
    });
  }

  const brutas = [
    {
      item_id: "MLB7060842760",
      titulo: "Chapéu Pralana Arizona",
      marca: "Pralana",
      receita: 20686.52,
      unidades: 48,
      cmv: 0,
      comissao: 0,
      frete: 0,
      impostos: 0,
      ads_spend: 751.88, // cache — a CHAVE, nunca o valor exibido
      lucroPreAds: 4035.49,
      lucro: 4035.49,
      lucro_pct: 19.51,
      lucro_pos_ads: 0,
      lucro_pct_pos_ads: null,
      has_cmv: true,
    },
    {
      // O resto da carteira, inclusive anúncios sem venda: é o denominador.
      item_id: "MLB0000000001",
      titulo: "Resto da carteira",
      marca: "Pralana",
      receita: 100000,
      unidades: 500,
      cmv: 0,
      comissao: 0,
      frete: 0,
      impostos: 0,
      ads_spend: 14790.21 - 751.88,
      lucroPreAds: 20000,
      lucro: 20000,
      lucro_pct: 20,
      lucro_pos_ads: 0,
      lucro_pct_pos_ads: null,
      has_cmv: true,
    },
  ];

  it("o anúncio medido mostra 481,64 de Ads (e não os 751,88 do cache)", () => {
    const rows = comRateio(FATURA, brutas);
    const itens = aggregateMcoItems(rows, "Pralana", "marca", new Map());
    const alvo = itens.find((i) => i.item_id === "MLB7060842760")!;

    expect(alvo.adsSpend).toBe(481.64);
    // %Ads exibido: 2,3% (era 3,6% na régua velha do cache)
    expect(alvo.acosPct!.toFixed(1)).toBe("2.3");
    // MCO% exibido: 17,2% (era 15,9% na régua velha do cache)
    expect(alvo.mcoPct!.toFixed(1)).toBe("17.2");
  });

  it("o MCO% do grupo também sobe, porque o grupo soma o lucro pós-ads rateado", () => {
    const rows = comRateio(FATURA, brutas);
    const semRateio = brutas.map((r) => ({
      ...r,
      lucro_pos_ads: r.lucroPreAds - r.ads_spend,
    })) as McoProductRow[];

    const grupoRateado = aggregateMcoGroups(rows, "marca", new Map())[0];
    const grupoCache = aggregateMcoGroups(semRateio, "marca", new Map())[0];

    expect(grupoRateado.mcoPct!).toBeGreaterThan(grupoCache.mcoPct!);
  });

  it("sem fatura no período, a tela continua no cache — 751,88, sem zerar ads", () => {
    const rows = comRateio(null, brutas);
    const itens = aggregateMcoItems(rows, "Pralana", "marca", new Map());
    const alvo = itens.find((i) => i.item_id === "MLB7060842760")!;

    expect(alvo.adsSpend).toBe(751.88);
  });
});

// ============================================================================
// Fase 213, Plano 06 — MCO pré-ads, breakeven de ACoS e curva do período
//
// As duas margens juntas respondem perguntas diferentes: a pré-ads diz se o
// PRODUTO é bom, a pós-ads diz se ele é bom depois do que se gastou para
// vendê-lo. O breakeven de ACoS é a margem pré-ads — a mesma régua do CR-02 já
// adotada em `/publicidade` (`useMLAdsDerivedMetrics`), sem segunda
// implementação a partir de preço e CMV.
//
// A curva é da CARTEIRA, nunca do grupo: se cada marca tivesse a própria Curva
// A, a coluna deixaria de significar "concentração de receita da operação".
// ============================================================================

describe("MCO pré-ads e breakeven de ACoS (Fase 213-06)", () => {
  it("o item carrega o MCO pré-ads em reais e em percentual, vindos do lucro operacional", () => {
    const rows: McoProductRow[] = [
      makeRow({
        item_id: "MLB001",
        marca: "Marca A",
        receita: 1000,
        unidades: 10,
        lucro: 250,
        lucro_pct: 25,
        ads_spend: 100,
        lucro_pos_ads: 150,
        lucro_pct_pos_ads: 15,
      }),
    ];
    const [item] = aggregateMcoItems(rows, "Marca A", "marca", new Map());

    expect(item.mcoPreAdsReais).toBe(250);
    expect(item.mcoPreAdsPct).toBe(25);
    // O pós-ads não muda: continua sendo o número principal da tela.
    expect(item.mcoReais).toBe(150);
    expect(item.mcoPct).toBe(15);
  });

  it("o breakeven de ACoS é a margem operacional pré-ads em percentual", () => {
    const rows: McoProductRow[] = [
      makeRow({
        item_id: "MLB001",
        marca: "Marca A",
        receita: 1000,
        unidades: 10,
        lucro: 250,
        lucro_pct: 25,
        lucro_pos_ads: 150,
        lucro_pct_pos_ads: 15,
      }),
    ];
    const [item] = aggregateMcoItems(rows, "Marca A", "marca", new Map());

    // Régua da contribuição (CR-02): 25%, nunca a margem bruta nem o pós-ads.
    expect(item.breakevenAcosPct).toBe(25);
    expect(item.breakevenAcosPct).not.toBe(item.mcoPct);
  });

  it("item sem custo cadastrado tem MCO pré-ads e breakeven indefinidos, nunca zero", () => {
    const rows: McoProductRow[] = [
      makeRow({
        item_id: "MLB001",
        marca: "Marca A",
        receita: 1000,
        unidades: 10,
        // Sem CMV a RPC devolve lucro inflado (custo entra como zero) — usar
        // esse número seria trocar um erro por outro.
        lucro: 900,
        lucro_pct: 90,
        lucro_pos_ads: 900,
        lucro_pct_pos_ads: 90,
        has_cmv: false,
      }),
    ];
    const [item] = aggregateMcoItems(rows, "Marca A", "marca", new Map());

    expect(item.mcoPreAdsReais).toBeNull();
    expect(item.mcoPreAdsPct).toBeNull();
    expect(item.breakevenAcosPct).toBeNull();
    expect(item.health).toBe("indefinido");
  });

  it("receita zero deixa o percentual pré-ads e o breakeven indefinidos", () => {
    const rows: McoProductRow[] = [
      makeRow({
        item_id: "MLB001",
        marca: "Marca A",
        receita: 0,
        unidades: 0,
        lucro: -30,
        lucro_pct: null,
        lucro_pos_ads: -30,
        lucro_pct_pos_ads: null,
      }),
    ];
    const [item] = aggregateMcoItems(rows, "Marca A", "marca", new Map());

    expect(item.mcoPreAdsPct).toBeNull();
    expect(item.breakevenAcosPct).toBeNull();
  });

  it("arredonda o breakeven a duas casas, como `/publicidade` (CR-02)", () => {
    const rows: McoProductRow[] = [
      makeRow({
        item_id: "MLB001",
        marca: "Marca A",
        receita: 300,
        unidades: 3,
        lucro: 40,
        lucro_pct: 13.333333333,
        lucro_pos_ads: 30,
        lucro_pct_pos_ads: 10,
      }),
    ];
    const [item] = aggregateMcoItems(rows, "Marca A", "marca", new Map());

    expect(item.breakevenAcosPct).toBe(13.33);
  });
});

describe("curva ABC do período na tabela de resultado (Fase 213-06, CR-06)", () => {
  // Carteira: um anúncio domina a receita; os dois pequenos são cauda.
  //   MLB_BIG  10.000  (Marca B, CAT_X)
  //   MLB_A1      100  (Marca A, CAT_X)
  //   MLB_A2       50  (Marca A, CAT_Y)
  const carteira: McoProductRow[] = [
    makeRow({ item_id: "MLB_BIG", marca: "Marca B", receita: 10000, unidades: 100, lucro: 2000, lucro_pct: 20, lucro_pos_ads: 1800, lucro_pct_pos_ads: 18 }),
    makeRow({ item_id: "MLB_A1", marca: "Marca A", receita: 100, unidades: 1, lucro: 20, lucro_pct: 20, lucro_pos_ads: 18, lucro_pct_pos_ads: 18 }),
    makeRow({ item_id: "MLB_A2", marca: "Marca A", receita: 50, unidades: 1, lucro: 10, lucro_pct: 20, lucro_pos_ads: 9, lucro_pct_pos_ads: 18 }),
  ];

  const mapaCategorias = buildItemsMap([
    { id: "MLB_BIG", category_id: "CAT_X" },
    { id: "MLB_A1", category_id: "CAT_X" },
    { id: "MLB_A2", category_id: "CAT_Y" },
  ]);

  it("a curva é da carteira inteira, não do grupo selecionado", () => {
    const itens = aggregateMcoItems(carteira, "Marca A", "marca", new Map());

    // Dentro do grupo "Marca A", MLB_A1 seria o maior e viraria curva A. Na
    // carteira ele é cauda: 98,5% da receita já foi acumulada pelo MLB_BIG.
    expect(itens.find((i) => i.item_id === "MLB_A1")!.curva).toBe("C");
    expect(itens.find((i) => i.item_id === "MLB_A2")!.curva).toBe("C");

    // E o dominante da carteira é curva A no grupo dele.
    const grupoB = aggregateMcoItems(carteira, "Marca B", "marca", new Map());
    expect(grupoB[0].curva).toBe("A");
  });

  it("trocar de marca para categoria não muda a curva de um anúncio", () => {
    const porMarca = aggregateMcoItems(carteira, "Marca A", "marca", new Map());
    const porCategoria = aggregateMcoItems(carteira, "CAT_X", "categoria", mapaCategorias);

    const a1Marca = porMarca.find((i) => i.item_id === "MLB_A1")!;
    const a1Categoria = porCategoria.find((i) => i.item_id === "MLB_A1")!;

    expect(a1Marca.curva).toBe(a1Categoria.curva);
    expect(a1Marca.curva).toBe("C");
  });

  it("carteira com receita total zero não produz curva A para ninguém", () => {
    const semReceita: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 0, unidades: 0 }),
      makeRow({ item_id: "MLB002", marca: "Marca A", receita: 0, unidades: 0 }),
    ];
    const itens = aggregateMcoItems(semReceita, "Marca A", "marca", new Map());

    expect(itens.every((i) => i.curva === "C")).toBe(true);
  });

  it("curvasDaCarteira devolve um mapa de anúncio para curva sobre todas as linhas", () => {
    const mapa = curvasDaCarteira(carteira);

    expect(mapa.size).toBe(3);
    expect(mapa.get("MLB_BIG")).toBe("A");
    expect(mapa.get("MLB_A1")).toBe("C");
    expect(mapa.get("MLB_A2")).toBe("C");
  });

  it("curvasDaCarteira com carteira vazia devolve mapa vazio", () => {
    expect(curvasDaCarteira([]).size).toBe(0);
  });
});

// ─── Segundo cenário: com DIFAL (Fase 222, plano 222-15-R2) ──────────────────
//
// A régua travada na fase 83 vale igual para o segundo cenário: o percentual do
// GRUPO é razão de somas, nunca média simples dos percentuais dos itens. E a
// ausência do segundo cenário (RPC antiga, janela de publicação) aparece como
// ausência declarada, nunca como zero.

describe("aggregateMcoGroups — cenário com DIFAL", () => {
  it("o MCO% do grupo no segundo cenário é RAZÃO DE SOMAS, não média de percentuais", () => {
    const rows: McoProductRow[] = [
      makeRow({
        item_id: "MLB001",
        marca: "Marca A",
        receita: 100,
        lucro_pos_ads: 20,
        lucro_pct_pos_ads: 20,
        lucro_pos_ads_com_difal: 10,
        lucro_pct_pos_ads_com_difal: 10,
        difal_efeito: 10,
      }),
      makeRow({
        item_id: "MLB002",
        marca: "Marca A",
        receita: 900,
        lucro_pos_ads: 90,
        lucro_pct_pos_ads: 10,
        lucro_pos_ads_com_difal: 45,
        lucro_pct_pos_ads_com_difal: 5,
        difal_efeito: 45,
      }),
    ];

    const [grupo] = aggregateMcoGroups(rows, "marca", new Map());

    // Razão de somas: (10 + 45) ÷ (100 + 900) × 100 = 5,5%.
    expect(grupo.mcoComDifalReais).toBe(55);
    expect(grupo.mcoPctComDifal).toBeCloseTo(5.5, 10);
    // A média simples dos percentuais dos itens daria 7,5% — o número que um
    // anúncio de R$ 100 e um de R$ 900 não têm direito de produzir juntos.
    expect(grupo.mcoPctComDifal).not.toBeCloseTo(7.5, 3);
    expect(grupo.difalEfeito).toBe(55);
  });

  it("o primeiro cenário do grupo continua sendo razão de somas, inalterado", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 100, lucro_pos_ads: 20, lucro_pct_pos_ads: 20 }),
      makeRow({ item_id: "MLB002", marca: "Marca A", receita: 900, lucro_pos_ads: 90, lucro_pct_pos_ads: 10 }),
    ];

    const [grupo] = aggregateMcoGroups(rows, "marca", new Map());

    expect(grupo.mcoPct).toBeCloseTo(11, 10);
  });

  it("um item sem segundo cenário derruba o grupo para AUSÊNCIA, nunca para zero", () => {
    // Somar só os itens apurados produziria um numerador que não corresponde ao
    // denominador — um percentual otimista e inexplicável.
    const rows: McoProductRow[] = [
      makeRow({
        item_id: "MLB001",
        marca: "Marca A",
        receita: 100,
        lucro_pos_ads: 20,
        lucro_pos_ads_com_difal: 10,
      }),
      makeRow({ item_id: "MLB002", marca: "Marca A", receita: 900, lucro_pos_ads: 90 }),
    ];

    const [grupo] = aggregateMcoGroups(rows, "marca", new Map());

    expect(grupo.mcoPctComDifal).toBeNull();
    expect(grupo.mcoComDifalReais).toBeNull();
    expect(grupo.difalEfeito).toBeNull();
  });

  it("a contagem de pedidos fora da conta por UF não confirmada soma no grupo", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 100, pedidos_difal_indefinido: 2 }),
      makeRow({ item_id: "MLB002", marca: "Marca A", receita: 900, pedidos_difal_indefinido: 5 }),
    ];

    const [grupo] = aggregateMcoGroups(rows, "marca", new Map());

    expect(grupo.pedidosDifalIndefinido).toBe(7);
  });

  it("efeito de DIFAL igual a zero é RESULTADO apurado, não ausência", () => {
    const rows: McoProductRow[] = [
      makeRow({
        item_id: "MLB001",
        marca: "Marca A",
        receita: 100,
        lucro_pos_ads: 20,
        lucro_pos_ads_com_difal: 20,
        difal_efeito: 0,
      }),
    ];

    const [grupo] = aggregateMcoGroups(rows, "marca", new Map());

    expect(grupo.difalEfeito).toBe(0);
    expect(grupo.mcoPctComDifal).toBeCloseTo(20, 10);
  });
});

describe("aggregateMcoItems — cenário com DIFAL", () => {
  it("repassa os quatro números do segundo cenário sem recalcular nenhum", () => {
    const rows: McoProductRow[] = [
      makeRow({
        item_id: "MLB001",
        marca: "Marca A",
        receita: 1000,
        lucro: 150,
        lucro_pct: 15,
        lucro_pos_ads: 120,
        lucro_pct_pos_ads: 12,
        lucro_com_difal: 100,
        lucro_pct_com_difal: 10,
        lucro_pos_ads_com_difal: 70,
        lucro_pct_pos_ads_com_difal: 7,
        difal_efeito: 50,
        has_cmv: true,
      }),
    ];

    const [item] = aggregateMcoItems(rows, "Marca A", "marca", new Map());

    expect(item.mcoComDifalReais).toBe(70);
    expect(item.mcoPctComDifal).toBe(7);
    expect(item.mcoPreAdsComDifalReais).toBe(100);
    expect(item.mcoPreAdsPctComDifal).toBe(10);
    expect(item.breakevenAcosPctComDifal).toBe(10);
    expect(item.difalEfeito).toBe(50);
  });

  it("sem CMV, o pré-ads COM DIFAL fica indefinido — mesma disciplina do primeiro", () => {
    const rows: McoProductRow[] = [
      makeRow({
        item_id: "MLB001",
        marca: "Marca A",
        receita: 1000,
        lucro_pct: 15,
        lucro_pct_com_difal: 10,
        has_cmv: false,
      }),
    ];

    const [item] = aggregateMcoItems(rows, "Marca A", "marca", new Map());

    expect(item.mcoPreAdsPct).toBeNull();
    expect(item.mcoPreAdsPctComDifal).toBeNull();
    expect(item.breakevenAcosPctComDifal).toBeNull();
  });

  it("linha vinda da RPC antiga não inventa segundo cenário", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 1000, lucro_pos_ads: 120 }),
    ];

    const [item] = aggregateMcoItems(rows, "Marca A", "marca", new Map());

    expect(item.mcoComDifalReais).toBeNull();
    expect(item.mcoPctComDifal).toBeNull();
    expect(item.difalEfeito).toBeNull();
    expect(item.pedidosDifalIndefinido).toBe(0);
    // ...e o primeiro cenário segue intacto.
    expect(item.mcoReais).toBe(120);
  });
});

// ─── Terceiro cenário: SEM REBATE, tarifa cheia (Fase 223, plano 223-06) ─────
//
// Mesma disciplina travada do par de DIFAL: o percentual do GRUPO é razão de
// somas, nunca média simples dos percentuais dos itens; ausência de QUALQUER
// item propaga para o grupo inteiro (um agregado parcial é indistinguível de
// um agregado completo); zero aritmética de margem — os oito campos já vêm
// prontos da RPC (223-05), a agregação só soma e divide pela receita.
//
// Duas contagens de lacuna, NUNCA misturadas: pedidos sem captura (não
// sabemos ainda) e pedidos com conferência que não fecha (sabemos, e o erro é
// nosso) — 223-CONTRATO-SALE-FEE.md.

describe("aggregateMcoItems — cenário sem rebate (tarifa cheia)", () => {
  it("linha sem os campos de rebate produz item com o par ausente — nunca zero", () => {
    const rows: McoProductRow[] = [
      makeRow({
        item_id: "MLB001",
        marca: "Marca A",
        receita: 1000,
        unidades: 1,
        lucro_pos_ads: 120,
        lucro_pct_pos_ads: 12,
      }),
    ];

    const [item] = aggregateMcoItems(rows, "Marca A", "marca", new Map());

    expect(item.mcoSemRebateReais).toBeNull();
    expect(item.mcoPctSemRebate).toBeNull();
    expect(item.mcoPreAdsSemRebateReais).toBeNull();
    expect(item.mcoPreAdsPctSemRebate).toBeNull();
    expect(item.breakevenAcosPctSemRebate).toBeNull();
    expect(item.rebateEfeito).toBeNull();
    expect(item.rebateBruto).toBeNull();
    expect(item.pedidosSemCapturaRebate).toBe(0);
    expect(item.pedidosRebateNaoConferido).toBe(0);
    // ...e o primeiro cenário segue intacto.
    expect(item.mcoReais).toBe(120);
  });

  it("item com rebate apurado produz margem pré e pós-ads na tarifa cheia, e o breakeven do segundo cenário sai do pré-ads sem rebate", () => {
    const rows: McoProductRow[] = [
      makeRow({
        item_id: "MLB001",
        marca: "Marca A",
        receita: 1000,
        unidades: 5,
        lucro: 150,
        lucro_pct: 15,
        lucro_pos_ads: 120,
        lucro_pct_pos_ads: 12,
        lucro_sem_rebate: 100,
        lucro_pct_sem_rebate: 10,
        lucro_pos_ads_sem_rebate: 70,
        lucro_pct_pos_ads_sem_rebate: 7,
        rebate_efeito: 50,
        rebate_bruto: 55,
        has_cmv: true,
      }),
    ];

    const [item] = aggregateMcoItems(rows, "Marca A", "marca", new Map());

    expect(item.mcoSemRebateReais).toBe(70);
    expect(item.mcoPctSemRebate).toBe(7);
    expect(item.mcoPreAdsSemRebateReais).toBe(100);
    expect(item.mcoPreAdsPctSemRebate).toBe(10);
    // Breakeven do segundo cenário = margem PRÉ-ads sem rebate, nunca o pós-ads.
    expect(item.breakevenAcosPctSemRebate).toBe(10);
    expect(item.breakevenAcosPctSemRebate).not.toBe(item.mcoPctSemRebate);
    expect(item.rebateEfeito).toBe(50);
    expect(item.rebateBruto).toBe(55);
  });

  it("item sem custo cadastrado tem breakeven indefinido nos DOIS cenários — a disciplina de custo ausente não muda por causa do rebate", () => {
    const rows: McoProductRow[] = [
      makeRow({
        item_id: "MLB001",
        marca: "Marca A",
        receita: 1000,
        lucro_pct: 15,
        lucro_pct_sem_rebate: 10,
        has_cmv: false,
      }),
    ];

    const [item] = aggregateMcoItems(rows, "Marca A", "marca", new Map());

    expect(item.mcoPreAdsPct).toBeNull();
    expect(item.breakevenAcosPct).toBeNull();
    expect(item.mcoPreAdsPctSemRebate).toBeNull();
    expect(item.breakevenAcosPctSemRebate).toBeNull();
  });

  it("linha vinda da RPC antiga não inventa terceiro cenário", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 1000, lucro_pos_ads: 120 }),
    ];

    const [item] = aggregateMcoItems(rows, "Marca A", "marca", new Map());

    expect(item.mcoSemRebateReais).toBeNull();
    expect(item.mcoPctSemRebate).toBeNull();
    expect(item.rebateEfeito).toBeNull();
    expect(item.rebateBruto).toBeNull();
    expect(item.pedidosSemCapturaRebate).toBe(0);
    expect(item.pedidosRebateNaoConferido).toBe(0);
    // ...e o primeiro cenário segue intacto.
    expect(item.mcoReais).toBe(120);
  });
});

describe("aggregateMcoGroups — cenário sem rebate (tarifa cheia)", () => {
  it("o MCO% do grupo no cenário sem rebate é RAZÃO DE SOMAS, não média de percentuais", () => {
    const rows: McoProductRow[] = [
      makeRow({
        item_id: "MLB001",
        marca: "Marca A",
        receita: 100,
        lucro_pos_ads: 20,
        lucro_pct_pos_ads: 20,
        lucro_pos_ads_sem_rebate: 10,
        lucro_pct_pos_ads_sem_rebate: 10,
        rebate_efeito: 10,
      }),
      makeRow({
        item_id: "MLB002",
        marca: "Marca A",
        receita: 900,
        lucro_pos_ads: 90,
        lucro_pct_pos_ads: 10,
        lucro_pos_ads_sem_rebate: 45,
        lucro_pct_pos_ads_sem_rebate: 5,
        rebate_efeito: 45,
      }),
    ];

    const [grupo] = aggregateMcoGroups(rows, "marca", new Map());

    // Razão de somas: (10 + 45) ÷ (100 + 900) × 100 = 5,5%.
    expect(grupo.mcoSemRebateReais).toBe(55);
    expect(grupo.mcoPctSemRebate).toBeCloseTo(5.5, 10);
    // A média simples dos percentuais dos itens daria 7,5% — o número que um
    // anúncio de R$ 100 e um de R$ 900 não têm direito de produzir juntos.
    expect(grupo.mcoPctSemRebate).not.toBeCloseTo(7.5, 3);
    expect(grupo.rebateEfeito).toBe(55);
  });

  it("o primeiro cenário do grupo continua sendo razão de somas, inalterado por rebate", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 100, lucro_pos_ads: 20, lucro_pct_pos_ads: 20 }),
      makeRow({ item_id: "MLB002", marca: "Marca A", receita: 900, lucro_pos_ads: 90, lucro_pct_pos_ads: 10 }),
    ];

    const [grupo] = aggregateMcoGroups(rows, "marca", new Map());

    expect(grupo.mcoPct).toBeCloseTo(11, 10);
  });

  it("um item não apurado derruba o grupo para AUSÊNCIA, nunca para zero, e soma a contagem de sem-captura dos itens", () => {
    // Somar só os itens apurados produziria um numerador que não corresponde
    // ao denominador — um percentual otimista e inexplicável.
    const rows: McoProductRow[] = [
      makeRow({
        item_id: "MLB001",
        marca: "Marca A",
        receita: 100,
        lucro_pos_ads: 20,
        lucro_pos_ads_sem_rebate: 10,
        pedidos_sem_captura_rebate: 2,
      }),
      makeRow({
        item_id: "MLB002",
        marca: "Marca A",
        receita: 900,
        lucro_pos_ads: 90,
        pedidos_sem_captura_rebate: 3,
      }),
    ];

    const [grupo] = aggregateMcoGroups(rows, "marca", new Map());

    expect(grupo.mcoPctSemRebate).toBeNull();
    expect(grupo.mcoSemRebateReais).toBeNull();
    expect(grupo.rebateEfeito).toBeNull();
    expect(grupo.pedidosSemCapturaRebate).toBe(5);
  });

  it("a soma de rebate do grupo é soma dos efeitos dos itens, e as duas contagens de lacuna somam sem se misturar", () => {
    const rows: McoProductRow[] = [
      makeRow({
        item_id: "MLB001",
        marca: "Marca A",
        receita: 100,
        lucro_pos_ads_sem_rebate: 10,
        rebate_efeito: 10,
        pedidos_sem_captura_rebate: 2,
        pedidos_rebate_nao_conferido: 1,
      }),
      makeRow({
        item_id: "MLB002",
        marca: "Marca A",
        receita: 900,
        lucro_pos_ads_sem_rebate: 45,
        rebate_efeito: 45,
        pedidos_sem_captura_rebate: 0,
        pedidos_rebate_nao_conferido: 4,
      }),
    ];

    const [grupo] = aggregateMcoGroups(rows, "marca", new Map());

    expect(grupo.rebateEfeito).toBe(55);
    expect(grupo.pedidosSemCapturaRebate).toBe(2);
    expect(grupo.pedidosRebateNaoConferido).toBe(5);
  });

  it("efeito de rebate igual a zero é RESULTADO apurado, não ausência", () => {
    const rows: McoProductRow[] = [
      makeRow({
        item_id: "MLB001",
        marca: "Marca A",
        receita: 100,
        lucro_pos_ads: 20,
        lucro_pos_ads_sem_rebate: 20,
        lucro_pct_pos_ads_sem_rebate: 20,
        rebate_efeito: 0,
      }),
    ];

    const [grupo] = aggregateMcoGroups(rows, "marca", new Map());

    expect(grupo.rebateEfeito).toBe(0);
    expect(grupo.mcoPctSemRebate).toBeCloseTo(20, 10);
  });
});

describe("regressão — entrada sem campos de rebate produz os mesmos números de hoje (Fase 222)", () => {
  it("itens e grupos do primeiro cenário não mudam quando a linha não tem os oito campos novos", () => {
    const rows: McoProductRow[] = [
      makeRow({
        item_id: "MLB001",
        marca: "Marca A",
        receita: 100,
        unidades: 1,
        lucro: 5,
        lucro_pct: 5,
        lucro_pos_ads: 3,
        lucro_pct_pos_ads: 3,
      }),
      makeRow({
        item_id: "MLB002",
        marca: "Marca A",
        receita: 900,
        unidades: 3,
        lucro: 100,
        lucro_pct: 11.11,
        lucro_pos_ads: 90,
        lucro_pct_pos_ads: 10,
      }),
    ];

    const grupos = aggregateMcoGroups(rows, "marca", new Map());
    const itens = aggregateMcoItems(rows, "Marca A", "marca", new Map());

    expect(grupos[0].revenue).toBe(1000);
    expect(grupos[0].mcoPct).toBeCloseTo(9.3, 5);
    expect(itens.find((i) => i.item_id === "MLB002")!.mcoReais).toBe(90);
    expect(itens.find((i) => i.item_id === "MLB001")!.mcoReais).toBe(3);

    // O terceiro cenário existe no tipo, mas AUSENTE — não contamina o primeiro.
    expect(grupos[0].mcoSemRebateReais).toBeNull();
    expect(itens[0].mcoSemRebateReais).toBeNull();
  });
});
