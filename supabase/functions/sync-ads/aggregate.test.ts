/**
 * aggregate.test.ts — unit do core puro de sync-ads (Phase 219, Plan 219-01;
 * Phase 221, Plan 221-01).
 * Importa de `./aggregate.ts` (nunca de `./index.ts`, que tem imports
 * `https://deno.land/...` inválidos para o resolvedor ESM do Node — mesmo
 * padrão já estabelecido em `sync-ml-billing/aggregate.test.ts`).
 *
 * Prova o bug real medido em CONTEXT.md (Frente 1, dia 05/08, advertiser
 * 361626, site MLB):
 * - `metrics_summary` da resposta = {"cost": 198.27, "prints": 81574,
 *   "total_amount": 7016.13, "units_quantity": 17} — bate ao centavo com o
 *   painel do ML. `parseMetricsSummary` tem que devolver exatamente esses
 *   quatro números, com `clicks` ausente virando 0 (nunca NaN).
 * - `MLB4393816141` aparece 2x na mesma campanha com valores IDÊNTICOS
 *   (custo 2.03|2.03, prints 646|646) — soma linha a linha duplicava;
 *   `dedupeProductMetrics` tem que devolver 1 linha, nunca a soma.
 */
import { describe, it, expect } from "vitest";
import {
  parseMetricsSummary,
  dedupeProductMetrics,
  normalizeMetrics,
  parsePartialMetrics,
  sumCampaignPages,
  buildDailyTotals,
  type ItemMetricRow,
  type CampaignPage,
  type SummaryTotals,
} from "./aggregate";

describe("parseMetricsSummary — escolha do total diário (Phase 219)", () => {
  it("objeto real do CONTEXT.md (cost/prints/total_amount/units_quantity, sem clicks) → clicks vira 0, nunca NaN", () => {
    const result = parseMetricsSummary({
      cost: 198.27,
      prints: 81574,
      total_amount: 7016.13,
      units_quantity: 17,
    });
    expect(result).toEqual({
      spend: 198.27,
      impressions: 81574,
      revenue: 7016.13,
      orders: 17,
      clicks: 0,
    });
  });

  it("aceita o formato array-de-{key,value} (mesmo shape que metrics por item já usa)", () => {
    const result = parseMetricsSummary([
      { key: "cost", value: 198.27 },
      { key: "prints", value: 81574 },
      { key: "total_amount", value: 7016.13 },
      { key: "units_quantity", value: 17 },
      { key: "clicks", value: 340 },
    ]);
    expect(result).toEqual({
      spend: 198.27,
      impressions: 81574,
      revenue: 7016.13,
      orders: 17,
      clicks: 340,
    });
  });

  it("entrada ausente, undefined ou objeto vazio → null, nunca zeros acidentais", () => {
    expect(parseMetricsSummary(undefined)).toBeNull();
    expect(parseMetricsSummary(null)).toBeNull();
    expect(parseMetricsSummary({})).toBeNull();
  });
});

describe("dedupeProductMetrics — dedup por item_id (Phase 219)", () => {
  function row(overrides: Partial<ItemMetricRow>): ItemMetricRow {
    return {
      key: "2026-08-05|MLB0000000000",
      title: "",
      thumbnail: null,
      impressions: 0,
      clicks: 0,
      spend: 0,
      revenue: 0,
      orders: 0,
      ...overrides,
    };
  }

  it("caso real MLB4393816141 duplicado (custo 2.03/prints 646 nas duas linhas) → 1 entrada, spend 2.03 — NUNCA 4.06", () => {
    const key = "2026-08-05|MLB4393816141";
    const result = dedupeProductMetrics([
      row({ key, title: "Anúncio X", spend: 2.03, impressions: 646 }),
      row({ key, title: "Anúncio X", spend: 2.03, impressions: 646 }),
    ]);
    expect(result.size).toBe(1);
    expect(result.get(key)).toMatchObject({ spend: 2.03, impressions: 646 });
  });

  it("item_id diferentes mantém as duas linhas, cada uma com seu próprio valor", () => {
    const result = dedupeProductMetrics([
      row({ key: "2026-08-05|MLB111", spend: 10, impressions: 100 }),
      row({ key: "2026-08-05|MLB222", spend: 20, impressions: 200 }),
    ]);
    expect(result.size).toBe(2);
    expect(result.get("2026-08-05|MLB111")).toMatchObject({ spend: 10, impressions: 100 });
    expect(result.get("2026-08-05|MLB222")).toMatchObject({ spend: 20, impressions: 200 });
  });

  it("lista vazia devolve Map vazio", () => {
    const result = dedupeProductMetrics([]);
    expect(result.size).toBe(0);
  });
});

describe("normalizeMetrics — reaproveitada de index.ts, sem duplicar lógica (Phase 219)", () => {
  it("continua resolvendo metrics_summary como array-de-{key,value} (comportamento pré-existente)", () => {
    const result = normalizeMetrics({ metrics_summary: [{ key: "cost", value: 5 }] });
    expect(result).toEqual({ cost: 5 });
  });

  it("continua caindo no próprio item quando nada reconhecível existe (comportamento pré-existente)", () => {
    const item = { foo: "bar" };
    const result = normalizeMetrics(item);
    expect(result).toEqual(item);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 221 — total diário vem do endpoint de campanhas (product_ads/campaigns/search),
// com paginação coberta. Números reais medidos em 06/08/2026, advertiser 361626,
// site MLB, conta Pé Vermeio (ml_user_id 1639558873):
//   campanhas (= o painel): cost 220.65, clicks 701, prints 61694, total_amount 4873.06, units_quantity 14
//   anúncios (o que gravávamos até a Fase 220): cost 172.95, clicks 549, prints 61793
//   armadilha: metrics_summary com limit=1 na 1ª de 6 campanhas devolveu cost 18.67
// ═══════════════════════════════════════════════════════════════════════════

describe("parsePartialMetrics — bloco parcial, ausência vira null por métrica (Phase 221)", () => {
  it("bloco real das campanhas de 06/08 (cost/clicks/prints/total_amount/units_quantity completos)", () => {
    const result = parsePartialMetrics({
      cost: 220.65,
      clicks: 701,
      prints: 61694,
      total_amount: 4873.06,
      units_quantity: 14,
    });
    expect(result).toEqual({
      spend: 220.65,
      clicks: 701,
      impressions: 61694,
      revenue: 4873.06,
      orders: 14,
    });
  });

  it("bloco só com cost → spend numérico, as outras quatro métricas ficam null (nunca zero)", () => {
    const result = parsePartialMetrics({ cost: 18.67 });
    expect(result).toEqual({
      spend: 18.67,
      clicks: null,
      impressions: null,
      revenue: null,
      orders: null,
    });
  });

  it("undefined, null e objeto vazio → null", () => {
    expect(parsePartialMetrics(undefined)).toBeNull();
    expect(parsePartialMetrics(null)).toBeNull();
    expect(parsePartialMetrics({})).toBeNull();
  });

  it("aceita o formato array-de-{key,value}, igual ao que parseMetricsSummary já aceita", () => {
    const result = parsePartialMetrics([
      { key: "cost", value: 220.65 },
      { key: "clicks", value: 701 },
      { key: "prints", value: 61694 },
      { key: "total_amount", value: 4873.06 },
      { key: "units_quantity", value: 14 },
    ]);
    expect(result).toEqual({
      spend: 220.65,
      clicks: 701,
      impressions: 61694,
      revenue: 4873.06,
      orders: 14,
    });
  });
});

describe("sumCampaignPages — total diário somado sobre TODAS as páginas, com guarda de cobertura (Phase 221)", () => {
  it("caso real feliz: UMA página com o bloco de 220,65 e campaigns:6, pagingTotal:6 → spend 220.65", () => {
    const pages: CampaignPage[] = [
      {
        metricsSummary: { cost: 220.65, clicks: 701, prints: 61694, total_amount: 4873.06, units_quantity: 14 },
        campaigns: 6,
      },
    ];
    const result = sumCampaignPages(pages, 6);
    expect(result).not.toBeNull();
    expect(result!.spend).toBe(220.65);
  });

  it("A ARMADILHA: página de limit=1 (cost:18.67, campaigns:1) com pagingTotal:6 → null, JAMAIS 18.67", () => {
    const pages: CampaignPage[] = [
      { metricsSummary: { cost: 18.67, clicks: 100, prints: 5000, total_amount: 500, units_quantity: 1 }, campaigns: 1 },
    ];
    const result = sumCampaignPages(pages, 6);
    expect(result).toBeNull();
  });

  it("paginação real: DUAS páginas (18.67/1camp + 201.98/5camps), pagingTotal:6 → spend ≈ 220.65", () => {
    const pages: CampaignPage[] = [
      { metricsSummary: { cost: 18.67, clicks: 100, prints: 5000, total_amount: 500, units_quantity: 1 }, campaigns: 1 },
      { metricsSummary: { cost: 201.98, clicks: 601, prints: 56694, total_amount: 4373.06, units_quantity: 13 }, campaigns: 5 },
    ];
    const result = sumCampaignPages(pages, 6);
    expect(result).not.toBeNull();
    expect(result!.spend).toBeCloseTo(220.65, 2);
  });

  it("página sem bloco de métricas reconhecível → null (não soma o que conhece e chama de total)", () => {
    const pages: CampaignPage[] = [{ metricsSummary: {}, campaigns: 6 }];
    const result = sumCampaignPages(pages, 6);
    expect(result).toBeNull();
  });

  it("lista de páginas vazia e pagingTotal 0 → null (dia sem campanha fica de fora, não vira gasto zero)", () => {
    const result = sumCampaignPages([], 0);
    expect(result).toBeNull();
  });

  it("ausência propaga por métrica: total_amount falta em UMA página → revenue do resultado é null mesmo com as outras trazendo o campo", () => {
    const pages: CampaignPage[] = [
      { metricsSummary: { cost: 18.67, clicks: 100, prints: 5000, units_quantity: 1 }, campaigns: 1 }, // sem total_amount
      { metricsSummary: { cost: 201.98, clicks: 601, prints: 56694, total_amount: 4373.06, units_quantity: 13 }, campaigns: 5 },
    ];
    const result = sumCampaignPages(pages, 6);
    expect(result).not.toBeNull();
    expect(result!.revenue).toBeNull();
    expect(result!.spend).toBeCloseTo(220.65, 2);
  });
});

describe("buildDailyTotals — composição campanhas + fallback de anúncios, nunca o custo errado (Phase 221)", () => {
  it("caso real feliz: campanhas completas de 06/08 → totals das campanhas, source campaigns, nada vem do resumo de anúncios", () => {
    const campanhas: ReturnType<typeof parsePartialMetrics> = {
      spend: 220.65, clicks: 701, impressions: 61694, revenue: 4873.06, orders: 14,
    };
    const anuncios: SummaryTotals = {
      spend: 172.95, clicks: 549, impressions: 61793, revenue: 4873.06, orders: 14,
    };
    const result = buildDailyTotals(campanhas, anuncios);
    expect(result).toEqual({
      totals: { spend: 220.65, clicks: 701, impressions: 61694, revenue: 4873.06, orders: 14 },
      source: "campaigns",
    });
  });

  it("fallback permitido: campanhas sem total_amount/units_quantity + resumo de anúncios → revenue/orders vêm do resumo, spend/clicks/impressions das campanhas, nunca 172.95", () => {
    const campanhas: ReturnType<typeof parsePartialMetrics> = {
      spend: 220.65, clicks: 701, impressions: 61694, revenue: null, orders: null,
    };
    const anuncios: SummaryTotals = {
      spend: 172.95, clicks: 549, impressions: 61793, revenue: 4873.06, orders: 14,
    };
    const result = buildDailyTotals(campanhas, anuncios);
    expect(result).not.toBeNull();
    expect(result!.totals.spend).toBe(220.65);
    expect(result!.totals.clicks).toBe(701);
    expect(result!.totals.impressions).toBe(61694);
    expect(result!.totals.revenue).toBe(4873.06);
    expect(result!.totals.orders).toBe(14);
    expect(result!.source).toBe("campaigns+ads");
    expect(result!.totals.spend).not.toBe(172.95);
  });

  it("a PROIBIÇÃO: campanhas null + resumo de anúncios presente → null, jamais cai de volta no custo do endpoint de anúncios", () => {
    const anuncios: SummaryTotals = {
      spend: 172.95, clicks: 549, impressions: 61793, revenue: 4873.06, orders: 14,
    };
    const result = buildDailyTotals(null, anuncios);
    expect(result).toBeNull();
  });

  it("campanhas com spend mas sem clicks → null (as três métricas medidas divergentes só podem vir das campanhas)", () => {
    const campanhas: ReturnType<typeof parsePartialMetrics> = {
      spend: 220.65, clicks: null, impressions: 61694, revenue: 4873.06, orders: 14,
    };
    const result = buildDailyTotals(campanhas, null);
    expect(result).toBeNull();
  });

  it("campanhas com spend mas sem impressions → null", () => {
    const campanhas: ReturnType<typeof parsePartialMetrics> = {
      spend: 220.65, clicks: 701, impressions: null, revenue: 4873.06, orders: 14,
    };
    const result = buildDailyTotals(campanhas, null);
    expect(result).toBeNull();
  });

  it("nem campanhas nem anúncios resolvem revenue/orders → null (linha de total com receita desconhecida não substitui a linha que já existe)", () => {
    const campanhas: ReturnType<typeof parsePartialMetrics> = {
      spend: 220.65, clicks: 701, impressions: 61694, revenue: null, orders: null,
    };
    const result = buildDailyTotals(campanhas, null);
    expect(result).toBeNull();
  });
});

describe("não-regressão Fase 219 (Phase 221 não pode quebrar o núcleo existente)", () => {
  it("parseMetricsSummary, dedupeProductMetrics, normalizeMetrics continuam exportados e funcionando", () => {
    expect(typeof parseMetricsSummary).toBe("function");
    expect(typeof dedupeProductMetrics).toBe("function");
    expect(typeof normalizeMetrics).toBe("function");
  });
});
