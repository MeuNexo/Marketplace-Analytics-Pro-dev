import { describe, it, expect } from "vitest";
import { qualityScoreBand, aggregateLogisticType, logisticTypeLabel } from "./listingIndicators";
import type { LogisticBucket, QualityBand } from "./listingIndicators";

// ─── qualityScoreBand ─────────────────────────────────────────────────────────

describe("qualityScoreBand", () => {
  it("retorna band=sem_dado quando health é null", () => {
    const result: QualityBand = qualityScoreBand(null);
    expect(result.pct).toBeNull();
    expect(result.band).toBe("sem_dado");
    expect(result.label).toBe("Sem dado");
  });

  it("retorna band=bom para health >= 0.8 (ex: 0.92 → pct=92)", () => {
    const result: QualityBand = qualityScoreBand(0.92);
    expect(result.pct).toBe(92);
    expect(result.band).toBe("bom");
    expect(result.label).toBe("Boa");
  });

  it("retorna band=bom no limite exato 0.8 (pct=80)", () => {
    const result: QualityBand = qualityScoreBand(0.8);
    expect(result.pct).toBe(80);
    expect(result.band).toBe("bom");
  });

  it("retorna band=medio para health >= 0.5 e < 0.8 (ex: 0.6 → pct=60)", () => {
    const result: QualityBand = qualityScoreBand(0.6);
    expect(result.pct).toBe(60);
    expect(result.band).toBe("medio");
    expect(result.label).toBe("Regular");
  });

  it("retorna band=medio no limite exato 0.5 (pct=50)", () => {
    const result: QualityBand = qualityScoreBand(0.5);
    expect(result.pct).toBe(50);
    expect(result.band).toBe("medio");
  });

  it("retorna band=ruim para health < 0.5 (ex: 0.3 → pct=30)", () => {
    const result: QualityBand = qualityScoreBand(0.3);
    expect(result.pct).toBe(30);
    expect(result.band).toBe("ruim");
    expect(result.label).toBe("Baixa");
  });

  it("arredonda pct para inteiro (0.756 → 76)", () => {
    const result: QualityBand = qualityScoreBand(0.756);
    expect(result.pct).toBe(76);
  });
});

// ─── logisticTypeLabel ────────────────────────────────────────────────────────

describe("logisticTypeLabel", () => {
  it("mapeia fulfillment → Full", () => {
    expect(logisticTypeLabel("fulfillment")).toBe("Full");
  });

  it("mapeia cross_docking → Cross-docking", () => {
    expect(logisticTypeLabel("cross_docking")).toBe("Cross-docking");
  });

  it("mapeia self_service → Flex", () => {
    expect(logisticTypeLabel("self_service")).toBe("Flex");
  });

  it("mapeia drop_off → Agência/Correios", () => {
    expect(logisticTypeLabel("drop_off")).toBe("Agência/Correios");
  });

  it("retorna Sem info para tipo desconhecido ou sem_info", () => {
    expect(logisticTypeLabel("sem_info")).toBe("Sem info");
    expect(logisticTypeLabel("unknown_type")).toBe("Sem info");
  });
});

// ─── aggregateLogisticType ────────────────────────────────────────────────────

describe("aggregateLogisticType", () => {
  it("sem variações: retorna bucket único com logistic_type e available_quantity do item", () => {
    const item = {
      logistic_type: "fulfillment",
      available_quantity: 42,
      variations: [],
    };
    const buckets: LogisticBucket[] = aggregateLogisticType(item);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].type).toBe("fulfillment");
    expect(buckets[0].label).toBe("Full");
    expect(buckets[0].stock).toBe(42);
  });

  it("com variações: soma available_quantity de todas as variações em um único bucket", () => {
    const item = {
      logistic_type: "cross_docking",
      available_quantity: 30, // estoque do item (não usado quando há variações)
      variations: [
        { available_quantity: 10, sold_quantity: 5, variation_id: "v1", price: 100, picture_id: null, seller_custom_field: null, attribute_combinations: [] },
        { available_quantity: 20, sold_quantity: 3, variation_id: "v2", price: 100, picture_id: null, seller_custom_field: null, attribute_combinations: [] },
        { available_quantity: 5,  sold_quantity: 1, variation_id: "v3", price: 100, picture_id: null, seller_custom_field: null, attribute_combinations: [] },
      ],
    };
    const buckets: LogisticBucket[] = aggregateLogisticType(item);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].type).toBe("cross_docking");
    expect(buckets[0].label).toBe("Cross-docking");
    expect(buckets[0].stock).toBe(35); // 10 + 20 + 5
  });

  it("logistic_type null: cria bucket com type=sem_info", () => {
    const item = {
      logistic_type: null,
      available_quantity: 7,
      variations: [],
    };
    const buckets: LogisticBucket[] = aggregateLogisticType(item);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].type).toBe("sem_info");
    expect(buckets[0].label).toBe("Sem info");
  });

  it("logistic_type string vazia: cria bucket com type=sem_info", () => {
    const item = {
      logistic_type: "",
      available_quantity: 3,
      variations: [],
    };
    const buckets: LogisticBucket[] = aggregateLogisticType(item);
    expect(buckets[0].type).toBe("sem_info");
  });

  it("retorna array ordenado por stock desc", () => {
    // Com variações e estoque alto
    const item = {
      logistic_type: "self_service",
      available_quantity: 0,
      variations: [
        { available_quantity: 15, sold_quantity: 0, variation_id: "v1", price: 50, picture_id: null, seller_custom_field: null, attribute_combinations: [] },
        { available_quantity: 8,  sold_quantity: 0, variation_id: "v2", price: 50, picture_id: null, seller_custom_field: null, attribute_combinations: [] },
      ],
    };
    const buckets: LogisticBucket[] = aggregateLogisticType(item);
    expect(buckets[0].stock).toBeGreaterThanOrEqual(buckets[buckets.length - 1].stock);
  });
});
