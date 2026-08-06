/**
 * aggregate.test.ts — unit do core puro de sync-ads (Phase 219, Plan 219-01).
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
import { parseMetricsSummary, dedupeProductMetrics, normalizeMetrics, type ItemMetricRow } from "./aggregate";

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
