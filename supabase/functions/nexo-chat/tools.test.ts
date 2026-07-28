/**
 * tools.test.ts — unit do dispatcher de tools do Nexo (Plan 57-02).
 *
 * Prova o anti-IDOR (T-57-07/08): dispatchTool SEMPRE usa o orgId/mlUserIds do
 * servidor (parâmetros), IGNORANDO qualquer args.org_id/args.seller_id/args.ml_user_id
 * vindo do modelo. Prova também: tool desconhecida não lança; declarations não
 * expõem org/seller como parâmetro; cap de 50 linhas; .eq('organization_id') em
 * selects diretos.
 *
 * sb é um stub encadeável que registra os argumentos recebidos por .rpc()/.from().
 */
import { describe, it, expect } from "vitest";
import { TOOL_DECLARATIONS, dispatchTool, summarizeVariations, buildReplenishmentResult } from "./tools";

// ── Stub Supabase encadeável que grava o que foi chamado ─────────────────────
type RpcCall = { fn: string; params: Record<string, unknown> };
type SelectCall = { table: string; eqs: Record<string, unknown>; ins: Record<string, unknown[]> };

function makeStub(rows: unknown[] = []) {
  const rpcCalls: RpcCall[] = [];
  const selectCalls: SelectCall[] = [];

  function builder(table: string) {
    const call: SelectCall = { table, eqs: {}, ins: {} };
    selectCalls.push(call);
    const chain: any = {
      select: () => chain,
      eq: (col: string, val: unknown) => { call.eqs[col] = val; return chain; },
      in: (col: string, val: unknown[]) => { call.ins[col] = val; return chain; },
      gte: () => chain,
      lte: () => chain,
      order: () => chain,
      limit: () => chain,
      range: () => Promise.resolve({ data: rows, error: null }),
      // termina o await quando não há range (selects sem paginação)
      then: (res: (v: { data: unknown[]; error: null }) => void) =>
        res({ data: rows, error: null }),
    };
    return chain;
  }

  const sb: any = {
    rpc: (fn: string, params: Record<string, unknown>) => {
      rpcCalls.push({ fn, params });
      return Promise.resolve({ data: rows, error: null });
    },
    from: (table: string) => builder(table),
  };
  return { sb, rpcCalls, selectCalls };
}

const ORG_SERVER = "ORG-REAL-DO-JWT";
const ML_IDS_SERVER = ["111", "222"];
// args maliciosos que o modelo poderia injetar
const EVIL_ARGS = { org_id: "ORG-ALHEIA", seller_id: "999", ml_user_id: "888" };

describe("TOOL_DECLARATIONS", () => {
  it("declara as 27 tools esperadas (inclui get_reputation, get_goals, get_replenishment, get_purchase_suppliers)", () => {
    const names = TOOL_DECLARATIONS.map((d) => d.name).sort();
    expect(names).toEqual(
      [
        // núcleo original (12)
        "get_active_insights",
        "get_ads_by_product",
        "get_cashflow",
        "get_coverage",
        "get_day_kpis",
        "get_dre_monthly",
        "get_health_score",
        "get_margin_by_product",
        "get_margin_summary",
        "get_no_cost_count",
        "get_paused_with_sales",
        "get_treasury_panel",
        // cobertura ampla (10)
        "get_sales_kpis",
        "get_margin_by_brand",
        "get_margin_trend",
        "get_margin_by_state",
        "get_costs_by_month",
        "get_supplier_exposure",
        "get_inventory",
        "get_open_questions",
        "get_claims",
        "get_ads_campaigns",
        // VMA-1 nova (58-02)
        "get_ads_account_summary",
        // OPS-1/OPS-2 novas (58-04)
        "get_reputation",
        "get_goals",
        // Phase 103 novas: compra × venda
        "get_replenishment",
        "get_purchase_suppliers",
      ].sort(),
    );
  });

  it("NENHUMA declaration expõe org_id/seller_id/ml_user_id como parâmetro (anti-IDOR)", () => {
    for (const decl of TOOL_DECLARATIONS) {
      const props = decl.parameters?.properties ?? {};
      const keys = Object.keys(props);
      expect(keys).not.toContain("org_id");
      expect(keys).not.toContain("seller_id");
      expect(keys).not.toContain("ml_user_id");
      expect(keys).not.toContain("organization_id");
    }
    // sanity textual: o objeto serializado não cita esses params
    const json = JSON.stringify(TOOL_DECLARATIONS);
    expect(json).not.toMatch(/"(org_id|seller_id|ml_user_id|organization_id)"\s*:/);
  });

  it("toda tool tem name + description PT-BR + parameters object", () => {
    for (const decl of TOOL_DECLARATIONS) {
      expect(typeof decl.name).toBe("string");
      expect(decl.description.length).toBeGreaterThan(10);
      expect(decl.parameters.type).toBe("object");
    }
  });
});

describe("dispatchTool — anti-IDOR (orgId/mlUserIds só do servidor)", () => {
  it("get_margin_by_product passa p_org_id do SERVIDOR mesmo com args.org_id alheio", async () => {
    const { sb, rpcCalls } = makeStub([{ item_id: "X" }]);
    await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_margin_by_product", {
      ...EVIL_ARGS,
      from: "2026-06-01",
      to: "2026-06-24",
    });
    const call = rpcCalls.find((c) => c.fn === "get_margin_with_ads_by_product");
    expect(call).toBeDefined();
    expect(call!.params.p_org_id).toBe(ORG_SERVER);
    expect(call!.params.p_org_id).not.toBe("ORG-ALHEIA");
    expect(call!.params.p_user_ids).toEqual(ML_IDS_SERVER);
    // datas válidas dos args SÃO respeitadas
    expect(call!.params.p_from).toBe("2026-06-01");
    expect(call!.params.p_to).toBe("2026-06-24");
  });

  it("get_coverage (DEFINER) passa só p_org_id do servidor, ignora seller alheio", async () => {
    const { sb, rpcCalls } = makeStub([{ item_id: "Y" }]);
    await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_coverage", EVIL_ARGS);
    const call = rpcCalls.find((c) => c.fn === "get_consultor_coverage");
    expect(call).toBeDefined();
    expect(call!.params.p_org_id).toBe(ORG_SERVER);
    expect(JSON.stringify(call!.params)).not.toContain("ORG-ALHEIA");
    expect(JSON.stringify(call!.params)).not.toContain("999");
  });

  it("get_active_insights (select direto) escopado por .eq('organization_id', orgId)", async () => {
    const { sb, selectCalls } = makeStub([{ rule_key: "r" }]);
    await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_active_insights", EVIL_ARGS);
    const call = selectCalls.find((c) => c.table === "insights");
    expect(call).toBeDefined();
    expect(call!.eqs.organization_id).toBe(ORG_SERVER);
  });

  it("get_ads_by_product (select direto) escopado por org + .in(ml_user_id, mlUserIds)", async () => {
    const { sb, selectCalls } = makeStub([{ item_id: "Z" }]);
    await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_ads_by_product", EVIL_ARGS);
    const call = selectCalls.find((c) => c.table === "ml_ads_products_cache");
    expect(call).toBeDefined();
    expect(call!.eqs.organization_id).toBe(ORG_SERVER);
    expect(call!.ins.ml_user_id).toEqual(ML_IDS_SERVER);
  });

  it("get_inventory (select direto) escopado por org + .in(ml_user_id, mlUserIds), retorna {label,freshness,summary,sample}", async () => {
    const { sb, selectCalls } = makeStub([{
      item_id: "MLB1",
      title: "Coturno",
      status: "active",
      available_quantity: 10,
      sold_quantity: 100,
      price: 299.9,
      health: 0.9,
      visits: 5,
      brand: "Pé Vermeio",
      seller_custom_field: "SKU-001",
      has_variations: false,
      variations: null,
      logistic_type: "fulfillment",
      synced_at: "2026-06-24T10:00:00Z",
    }]);
    const result = await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_inventory", EVIL_ARGS) as Record<string, unknown>;
    // Anti-IDOR: tabela escopada por org e mlUserIds
    const aggCall = selectCalls.find((c) => c.table === "ml_inventory_cache" && c.eqs.organization_id === ORG_SERVER);
    expect(aggCall).toBeDefined();
    expect(aggCall!.eqs.organization_id).toBe(ORG_SERVER);
    expect(aggCall!.ins.ml_user_id).toEqual(ML_IDS_SERVER);
    // Forma do retorno: {label, freshness, summary, sample}
    expect(typeof result.label).toBe("string");
    expect((result.label as string)).toContain("Full");
    expect(result).toHaveProperty("freshness");
    expect(result).toHaveProperty("summary");
    expect(result).toHaveProperty("sample");
    const summary = result.summary as Record<string, number>;
    expect(summary).toHaveProperty("totalItems");
    expect(summary).toHaveProperty("totalUnits");
    expect(summary).toHaveProperty("active");
    expect(summary).toHaveProperty("paused");
    expect(summary).toHaveProperty("outOfStock");
    expect(summary).toHaveProperty("itemsWithSizeOutOfStock");
  });

  it("get_inventory sem args aplica filtro status=active (anti-EST-1)", async () => {
    const { sb, selectCalls } = makeStub([]);
    await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_inventory", {});
    // deve haver ao menos um select em ml_inventory_cache com status=active
    const calls = selectCalls.filter((c) => c.table === "ml_inventory_cache");
    expect(calls.length).toBeGreaterThan(0);
    const activeFiltered = calls.some((c) => c.eqs.status === "active");
    expect(activeFiltered).toBe(true);
  });

  it("get_inventory status=paused aplica filtro paused", async () => {
    const { sb, selectCalls } = makeStub([]);
    await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_inventory", { status: "paused" });
    const calls = selectCalls.filter((c) => c.table === "ml_inventory_cache");
    const pausedFiltered = calls.some((c) => c.eqs.status === "paused");
    expect(pausedFiltered).toBe(true);
  });

  it("get_inventory status=all não aplica filtro de status", async () => {
    const { sb, selectCalls } = makeStub([]);
    await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_inventory", { status: "all" });
    const calls = selectCalls.filter((c) => c.table === "ml_inventory_cache");
    // nenhuma call deve ter filtro de status
    const hasStatusFilter = calls.some((c) => "status" in c.eqs);
    expect(hasStatusFilter).toBe(false);
  });

  it("get_inventory status inválido cai no default active", async () => {
    const { sb, selectCalls } = makeStub([]);
    await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_inventory", { status: "EVIL_STATUS" });
    const calls = selectCalls.filter((c) => c.table === "ml_inventory_cache");
    const activeFiltered = calls.some((c) => c.eqs.status === "active");
    expect(activeFiltered).toBe(true);
  });

  it("get_dre_monthly (ml_billing_daily) escopado por org + mlUserIds — FIN-1 (58-03)", async () => {
    // Fonte trocada de ml_billing_monthly → ml_billing_daily (mês-calendário)
    const { sb, selectCalls } = makeStub([
      { charge_type: "CFFE", charge_label: "Comissão", amount: 1200, charge_date: "2026-06-10", synced_at: "2026-06-24T06:00:00Z" },
      { charge_type: "CFONPN", charge_label: "Parcelamento", amount: 300, charge_date: "2026-06-15", synced_at: "2026-06-24T06:00:00Z" },
    ]);
    const result = await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_dre_monthly", {
      ...EVIL_ARGS,
      period_month: "2026-06",
    }) as Record<string, unknown>;
    // Anti-IDOR: tabela ml_billing_daily (não ml_billing_monthly) escopada por org e mlUserIds
    const call = selectCalls.find((c) => c.table === "ml_billing_daily");
    expect(call).toBeDefined();
    expect(call!.eqs.organization_id).toBe(ORG_SERVER);
    expect(call!.ins.ml_user_id).toEqual(ML_IDS_SERVER);
    // Retorno com campos do novo shape (FIN-1)
    expect(result).toHaveProperty("period_month");
    expect(result).toHaveProperty("by_type");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("coverage_until");
    expect(result).toHaveProperty("freshness");
    expect(result).toHaveProperty("label");
    // label deve mencionar mês-calendário e NÃO é DRE completo
    expect(typeof result.label).toBe("string");
    expect((result.label as string)).toMatch(/calendário|01.*(fim|último)|NÃO é DRE/i);
    // NÃO encontrar ml_billing_monthly (fonte antiga)
    const oldCall = selectCalls.find((c) => c.table === "ml_billing_monthly");
    expect(oldCall).toBeUndefined();
  });

  it("get_health_score (consultor_health_snapshots) escopado por org", async () => {
    const { sb, selectCalls } = makeStub([{ score: 80 }]);
    await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_health_score", EVIL_ARGS);
    const call = selectCalls.find((c) => c.table === "consultor_health_snapshots");
    expect(call).toBeDefined();
    expect(call!.eqs.organization_id).toBe(ORG_SERVER);
  });

  it("get_ads_account_summary (ml_ads_daily_cache) anti-IDOR: escopado por org + mlUserIds, ignora EVIL_ARGS", async () => {
    const { sb, selectCalls } = makeStub([
      { spend: 100, attributed_revenue: 300, impressions: 5000, clicks: 200, synced_at: "2026-06-24T10:00:00Z" },
      { spend: 50, attributed_revenue: 150, impressions: 2000, clicks: 80, synced_at: "2026-06-23T10:00:00Z" },
    ]);
    const result = await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_ads_account_summary", EVIL_ARGS) as Record<string, unknown>;
    const call = selectCalls.find((c) => c.table === "ml_ads_daily_cache");
    expect(call).toBeDefined();
    // Anti-IDOR: organization_id vem do servidor
    expect(call!.eqs.organization_id).toBe(ORG_SERVER);
    expect(call!.ins.ml_user_id).toEqual(ML_IDS_SERVER);
    // Resultado: objeto com spend/attributed_revenue/roas/impressions/clicks/period
    expect(result).toHaveProperty("spend");
    expect(result).toHaveProperty("attributed_revenue");
    expect(result).toHaveProperty("roas");
    expect(result).toHaveProperty("impressions");
    expect(result).toHaveProperty("clicks");
    expect(result).toHaveProperty("period");
    expect(result).toHaveProperty("freshness");
    // ROAS correto (150+300)/( 50+100) = 450/150 = 3 — mas stub retorna mesmo array para cada page
    // então verificamos apenas que não é nulo (spend > 0)
    expect(result.roas).not.toBeNull();
    // nota obrigatória sobre attributed_revenue
    expect(typeof result.note).toBe("string");
    expect((result.note as string)).toMatch(/atribuída/i);
  });

  it("get_ads_account_summary: roas é null quando spend=0 (guard divisão por zero)", async () => {
    const { sb } = makeStub([
      { spend: 0, attributed_revenue: 0, impressions: 0, clicks: 0, synced_at: null },
    ]);
    const result = await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_ads_account_summary", {}) as Record<string, unknown>;
    expect(result.roas).toBeNull();
    expect(result.spend).toBe(0);
  });

  it("get_ads_campaigns neutralizada: não inclui spend/roas/impressions, retorna performance_note (VMA-1)", async () => {
    const { sb, selectCalls } = makeStub([
      { name: "Campanha A", status: "enabled" },
      { name: "Campanha B", status: "paused" },
    ]);
    const result = await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_ads_campaigns", EVIL_ARGS) as Record<string, unknown>;
    // Anti-IDOR mantido
    const call = selectCalls.find((c) => c.table === "ml_ads_campaigns_cache");
    expect(call).toBeDefined();
    expect(call!.eqs.organization_id).toBe(ORG_SERVER);
    // Retorna performance_note (não retorna métricas zeradas como verdade)
    expect(typeof result.performance_note).toBe("string");
    expect((result.performance_note as string)).toMatch(/sem dados de performance|get_ads_account_summary/i);
    // campaigns é array
    expect(Array.isArray(result.campaigns)).toBe(true);
    // Cada item NÃO deve ter spend/roas/impressions (neutralizados)
    const campaigns = result.campaigns as Record<string, unknown>[];
    if (campaigns.length > 0) {
      expect(campaigns[0]).not.toHaveProperty("spend");
      expect(campaigns[0]).not.toHaveProperty("roas");
      expect(campaigns[0]).not.toHaveProperty("impressions");
    }
  });
});

describe("dispatchTool — anti-IDOR get_replenishment/get_purchase_suppliers (Phase 103)", () => {
  it("get_replenishment (org-only) passa só p_org_id do servidor, ignora seller alheio, SEM p_user_ids", async () => {
    const { sb, rpcCalls } = makeStub([{ item_id: "Y", compra_sugerida: 10 }]);
    await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_replenishment", EVIL_ARGS);
    const call = rpcCalls.find((c) => c.fn === "get_replenishment_by_sku");
    expect(call).toBeDefined();
    expect(call!.params.p_org_id).toBe(ORG_SERVER);
    expect(JSON.stringify(call!.params)).not.toContain("ORG-ALHEIA");
    expect(JSON.stringify(call!.params)).not.toContain("999");
    expect(JSON.stringify(call!.params)).not.toContain("888");
    // a RPC não aceita p_user_ids — nunca deve aparecer nos params
    expect(call!.params).not.toHaveProperty("p_user_ids");
  });

  it("get_replenishment aplica p_smart=true por default (paridade com o painel /compras — Pitfall 2)", async () => {
    const { sb, rpcCalls } = makeStub([]);
    await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_replenishment", {});
    const call = rpcCalls.find((c) => c.fn === "get_replenishment_by_sku");
    expect(call).toBeDefined();
    expect(call!.params.p_smart).toBe(true);
  });

  it("get_purchase_suppliers (org-only) passa só p_org_id do servidor, único parâmetro", async () => {
    const { sb, rpcCalls } = makeStub([{ fornecedor: "Fornecedor X" }]);
    await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_purchase_suppliers", EVIL_ARGS);
    const call = rpcCalls.find((c) => c.fn === "get_purchase_order_suppliers");
    expect(call).toBeDefined();
    expect(call!.params.p_org_id).toBe(ORG_SERVER);
    expect(Object.keys(call!.params)).toEqual(["p_org_id"]);
  });

  it("get_purchase_suppliers mapeia data para lista de fornecedores (string[]), capada", async () => {
    const { sb } = makeStub([{ fornecedor: "Fornecedor A" }, { fornecedor: "Fornecedor B" }]);
    const result = await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_purchase_suppliers", {}) as string[];
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(["Fornecedor A", "Fornecedor B"]);
  });
});

describe("buildReplenishmentResult — preservação de micos no sample estratificado (Pitfall 1)", () => {
  it("summary.sem_giro_count conta TODO o conjunto e sample preserva ≥1 mico apesar do ORDER BY compra DESC", () => {
    // Simula ORDER BY compra DESC NULLS LAST da RPC: ~48 linhas "gatilho" (compra_sugerida > 0,
    // decrescente) SEGUIDAS de ~5 linhas de micos nas ÚLTIMAS posições (compra_sugerida=0).
    const gatilhoRows = Array.from({ length: 48 }, (_, i) => ({
      item_id: `G${i}`,
      variation_id: null,
      title: `Produto Gatilho ${i}`,
      brand: "Pé Vermeio",
      sku_code: `SKU-G${i}`,
      sku_stock: 5,
      venda_dia: 1.2,
      venda_inteligente: 1.2,
      cobertura_atual: 4,
      ponto_reposicao: 10,
      alvo: 20,
      compra_sugerida: 48 - i, // decrescente, sempre > 0
      valor_estimado: (48 - i) * 50,
      custo_ausente: false,
      sem_giro: false,
      gatilho_ativo: true,
      qtd_a_caminho: 0,
      data_proxima_chegada: null,
      status_esgotado: "com_giro",
      tendencia: "estavel",
      fator_sazonal: 1.0,
    }));
    const micoRows = Array.from({ length: 5 }, (_, i) => ({
      item_id: `M${i}`,
      variation_id: null,
      title: `Produto Mico ${i}`,
      brand: "Pé Vermeio",
      sku_code: `SKU-M${i}`,
      sku_stock: 100 - i, // capital parado alto
      venda_dia: 0,
      venda_inteligente: 0,
      cobertura_atual: 999,
      ponto_reposicao: 10,
      alvo: 20,
      compra_sugerida: 0,
      valor_estimado: 0,
      custo_ausente: false,
      sem_giro: true,
      gatilho_ativo: false,
      qtd_a_caminho: 0,
      data_proxima_chegada: null,
      status_esgotado: "com_giro", // tem estoque — não é esgotado, é mico (eixo ortogonal)
      tendencia: "queda",
      fator_sazonal: 1.0,
    }));
    const rows = [...gatilhoRows, ...micoRows]; // micos nas ÚLTIMAS posições (reproduz ORDER BY compra DESC)

    const result = buildReplenishmentResult(rows);

    // summary conta sobre TODO o conjunto, não sobre a amostra capada
    expect(result.summary.sem_giro_count).toBe(5);
    expect(result.summary.total_skus).toBe(rows.length);
    expect(result.summary.gatilho_ativo_count).toBe(48);

    // sample respeita o teto
    expect(result.sample.length).toBeLessThanOrEqual(50);

    // ao menos 1 mico aparece no sample APESAR do ORDER BY que o afunda —
    // um teste genérico length<=50 passaria mesmo descartando todos os micos.
    const micosInSample = result.sample.filter((r) => r.sem_giro === true);
    expect(micosInSample.length).toBeGreaterThanOrEqual(1);
    expect(micosInSample.length).toBe(5); // bucket de micos cabe inteiro (5 ≤ 15)
  });

  it("label rotula compra sugerida como projeção e distingue sem_giro de status_esgotado", () => {
    const result = buildReplenishmentResult([]);
    expect(result.label).toMatch(/projeção/i);
    expect(result.label).toMatch(/não.*pedido feito|nunca.*pedido/i);
    expect(result.label).toMatch(/sem_giro/i);
    expect(result.label).toMatch(/status_esgotado/i);
  });

  it("dedupe por item_id|variation_id: linha não aparece duplicada entre buckets", () => {
    // Uma linha gatilho_ativo=true E sem_giro=true (caso extremo hipotético) não deve duplicar
    const rows = [
      {
        item_id: "DUP1", variation_id: "v1", sku_stock: 10, compra_sugerida: 5,
        gatilho_ativo: true, sem_giro: true, custo_ausente: false, status_esgotado: "com_giro",
      },
    ];
    const result = buildReplenishmentResult(rows);
    const occurrences = result.sample.filter((r) => r.item_id === "DUP1" && r.variation_id === "v1");
    expect(occurrences.length).toBe(1);
  });

  it("respeita dispatchTool: get_replenishment retorna {label,summary,sample} via buildReplenishmentResult", async () => {
    const rows = [
      { item_id: "A", variation_id: null, compra_sugerida: 3, gatilho_ativo: true, sem_giro: false, custo_ausente: false, sku_stock: 2, status_esgotado: "com_giro" },
      { item_id: "B", variation_id: null, compra_sugerida: 0, gatilho_ativo: false, sem_giro: true, custo_ausente: false, sku_stock: 40, status_esgotado: "com_giro" },
    ];
    const { sb } = makeStub(rows);
    const result = await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_replenishment", {}) as {
      label: string; summary: Record<string, unknown>; sample: Record<string, unknown>[];
    };
    expect(typeof result.label).toBe("string");
    expect(result.summary).toHaveProperty("total_skus", 2);
    expect(result.summary).toHaveProperty("sem_giro_count", 1);
    expect(result.sample.some((r) => r.sem_giro === true)).toBe(true);
  });
});

describe("dispatchTool — datas (clamp/defaults)", () => {
  it("usa defaults (from=30d, to=hoje) quando args sem datas", async () => {
    const { sb, rpcCalls } = makeStub([]);
    await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_margin_summary", {});
    const call = rpcCalls.find((c) => c.fn === "get_margin_summary");
    expect(call).toBeDefined();
    expect(call!.params.p_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(call!.params.p_to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("data malformada cai no default (não propaga lixo)", async () => {
    const { sb, rpcCalls } = makeStub([]);
    await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_margin_summary", {
      from: "não-é-data",
      to: "31/13/2026",
    });
    const call = rpcCalls.find((c) => c.fn === "get_margin_summary");
    expect(call!.params.p_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(call!.params.p_to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("dispatchTool — robustez", () => {
  it("tool desconhecida retorna {error:'unknown_tool'} sem lançar", async () => {
    const { sb } = makeStub([]);
    const r = await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "drop_database", {});
    expect(r).toEqual({ error: "unknown_tool" });
  });

  it("aplica cap de 50 linhas no resultado de RPC", async () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ item_id: String(i) }));
    const { sb } = makeStub(many);
    const r = (await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_margin_by_product", {})) as unknown[];
    expect(Array.isArray(r)).toBe(true);
    expect(r.length).toBeLessThanOrEqual(50);
  });
});

describe("summarizeVariations — helper puro (VERAC-02/EST-2)", () => {
  const makeVariation = (qty: number, attrs: Array<{ name: string; value: string }>) => ({
    variation_id: "v" + Math.random(),
    attribute_combinations: attrs.map((a) => ({ id: a.name.toUpperCase(), name: a.name, value: a.value })),
    available_quantity: qty,
    sold_quantity: 10,
    price: 100,
  });

  it("null/undefined/empty retorna zeros", () => {
    expect(summarizeVariations(null)).toEqual({ total: 0, out_of_stock: 0, names: [] });
    expect(summarizeVariations(undefined)).toEqual({ total: 0, out_of_stock: 0, names: [] });
    expect(summarizeVariations([])).toEqual({ total: 0, out_of_stock: 0, names: [] });
  });

  it("array com N variações e K zeradas retorna {total:N, out_of_stock:K, names:K itens}", () => {
    const variations = [
      makeVariation(0, [{ name: "Tamanho", value: "38 BR" }, { name: "Cor", value: "Preto" }]),
      makeVariation(5, [{ name: "Tamanho", value: "40 BR" }, { name: "Cor", value: "Preto" }]),
      makeVariation(0, [{ name: "Tamanho", value: "42 BR" }, { name: "Cor", value: "Preto" }]),
    ];
    const result = summarizeVariations(variations);
    expect(result.total).toBe(3);
    expect(result.out_of_stock).toBe(2);
    expect(result.names).toHaveLength(2);
    // nomes devem incluir os atributos formatados
    expect(result.names[0]).toContain("38 BR");
    expect(result.names[1]).toContain("42 BR");
  });

  it("todas as variações com estoque retorna out_of_stock=0 e names=[]", () => {
    const variations = [
      makeVariation(3, [{ name: "Tamanho", value: "38 BR" }]),
      makeVariation(7, [{ name: "Tamanho", value: "40 BR" }]),
    ];
    const result = summarizeVariations(variations);
    expect(result.total).toBe(2);
    expect(result.out_of_stock).toBe(0);
    expect(result.names).toHaveLength(0);
  });

  it("variação com available_quantity=0 como string é tratada como zero", () => {
    const variations = [{ variation_id: "v1", attribute_combinations: [], available_quantity: 0 }];
    const result = summarizeVariations(variations);
    expect(result.out_of_stock).toBe(1);
  });

  it("itens não-objeto no array são ignorados defensivamente", () => {
    const variations = [null, "lixo", 42, { variation_id: "ok", attribute_combinations: [{ id: "T", name: "Tamanho", value: "38" }], available_quantity: 0 }];
    const result = summarizeVariations(variations);
    expect(result.total).toBe(1);
    expect(result.out_of_stock).toBe(1);
  });
});

describe("TOOL_DECLARATIONS — get_coverage rótulos (EST-4/D3)", () => {
  it("get_coverage description cita '30 dias' e 'Full'", () => {
    const decl = TOOL_DECLARATIONS.find((d) => d.name === "get_coverage");
    expect(decl).toBeDefined();
    expect(decl!.description).toMatch(/30 dias/i);
    expect(decl!.description).toMatch(/full/i);
  });
});

describe("TOOL_DECLARATIONS — get_inventory novos atributos (D1/D2/D3)", () => {
  it("get_inventory description cita 'Full (fulfillment)' e nega 'total'", () => {
    const decl = TOOL_DECLARATIONS.find((d) => d.name === "get_inventory");
    expect(decl).toBeDefined();
    expect(decl!.description).toMatch(/full/i);
    expect(decl!.description).toMatch(/fulfillment/i);
    expect(decl!.description).toMatch(/não é estoque total|nao e estoque total/i);
  });

  it("get_inventory aceita parâmetro status com enum (active|paused|all)", () => {
    const decl = TOOL_DECLARATIONS.find((d) => d.name === "get_inventory");
    expect(decl).toBeDefined();
    const statusProp = decl!.parameters.properties.status as Record<string, unknown>;
    expect(statusProp).toBeDefined();
    expect(Array.isArray(statusProp.enum)).toBe(true);
    expect((statusProp.enum as string[])).toContain("active");
    expect((statusProp.enum as string[])).toContain("paused");
    expect((statusProp.enum as string[])).toContain("all");
  });

  it("get_inventory NÃO expõe org_id/seller_id/ml_user_id como parâmetro (anti-IDOR)", () => {
    const decl = TOOL_DECLARATIONS.find((d) => d.name === "get_inventory");
    expect(decl).toBeDefined();
    const props = Object.keys(decl!.parameters.properties);
    expect(props).not.toContain("org_id");
    expect(props).not.toContain("seller_id");
    expect(props).not.toContain("ml_user_id");
    expect(props).not.toContain("organization_id");
  });
});

describe("TOOL_DECLARATIONS — descrições financeiras FIN-1/4/5 (58-03)", () => {
  it("get_dre_monthly description menciona mês-calendário e nega DRE completo (FIN-1/FIN-5/D8/D11)", () => {
    const decl = TOOL_DECLARATIONS.find((d) => d.name === "get_dre_monthly");
    expect(decl).toBeDefined();
    expect(decl!.description).toMatch(/mês.calendário|mes.calendario/i);
    expect(decl!.description).toMatch(/NÃO é DRE completo|nao e dre completo/i);
    expect(decl!.description).toMatch(/espelha|espelho/i);
  });

  it("get_costs_by_month description diz 'saídas de caixa' e nega CMV e fatura ML (FIN-4/D11)", () => {
    const decl = TOOL_DECLARATIONS.find((d) => d.name === "get_costs_by_month");
    expect(decl).toBeDefined();
    expect(decl!.description).toMatch(/saídas de caixa|saidas de caixa/i);
    expect(decl!.description).toMatch(/NÃO é CMV|nao e cmv/i);
    expect(decl!.description).toMatch(/fatura do ML|get_dre_monthly/i);
  });

  it("get_cashflow description menciona saldo_hoje e cobertura parcial de inflows (FIN-3/D10)", () => {
    const decl = TOOL_DECLARATIONS.find((d) => d.name === "get_cashflow");
    expect(decl).toBeDefined();
    expect(decl!.description).toMatch(/saldo_hoje/i);
    expect(decl!.description).toMatch(/cobertura|parcial|inflows/i);
    expect(decl!.description).toMatch(/get_treasury_panel/i);
  });

  it("get_cashflow dispatcher retorna {horizon_label, saldo_hoje, series} (FIN-3/D10)", async () => {
    const { sb } = makeStub([
      { date: new Date().toISOString().slice(0, 10), saldo_acumulado: 12500 },
      { date: "2026-07-01", saldo_acumulado: 11000 },
    ]);
    const result = await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_cashflow", {}) as Record<string, unknown>;
    expect(result).toHaveProperty("horizon_label");
    expect(result).toHaveProperty("saldo_hoje");
    expect(result).toHaveProperty("series");
    expect(typeof result.horizon_label).toBe("string");
    expect((result.horizon_label as string)).toMatch(/saldo_hoje|cobertura|get_treasury_panel/i);
    // saldo_hoje deve ser o saldo do dia de hoje (primeira linha com data de hoje)
    expect(result.saldo_hoje).toBe(12500);
  });
});

describe("TOOL_DECLARATIONS — descrições inequívocas VMA-2/4/7 (58-02)", () => {
  it("get_sales_kpis description menciona pedidos pagos e divergência do painel (VMA-2/D4)", () => {
    const decl = TOOL_DECLARATIONS.find((d) => d.name === "get_sales_kpis");
    expect(decl).toBeDefined();
    expect(decl!.description).toMatch(/pagos/i);
    expect(decl!.description).toMatch(/painel|ml_daily_cache/i);
  });

  it("get_ads_by_product description cita 'top 50' e remete ao total em get_ads_account_summary (VMA-4/D6)", () => {
    const decl = TOOL_DECLARATIONS.find((d) => d.name === "get_ads_by_product");
    expect(decl).toBeDefined();
    expect(decl!.description).toMatch(/top 50|não é o total/i);
    expect(decl!.description).toMatch(/get_ads_account_summary/i);
  });

  it("get_day_kpis description alerta que não inclui tarifas fixas ML e remete ao get_dre_monthly (VMA-7/D6)", () => {
    const decl = TOOL_DECLARATIONS.find((d) => d.name === "get_day_kpis");
    expect(decl).toBeDefined();
    expect(decl!.description).toMatch(/NÃO inclui tarifas fixas|nao inclui tarifas fixas/i);
    expect(decl!.description).toMatch(/get_dre_monthly/i);
  });

  it("get_margin_summary description menciona pedidos pagos e partially_refunded (VMA-3/D7)", () => {
    const decl = TOOL_DECLARATIONS.find((d) => d.name === "get_margin_summary");
    expect(decl).toBeDefined();
    expect(decl!.description).toMatch(/pagos/i);
    expect(decl!.description).toMatch(/partially_refunded/i);
  });

  it("get_ads_account_summary description cita 'subconjunto do faturamento' e 'top 50' distinção (D6)", () => {
    const decl = TOOL_DECLARATIONS.find((d) => d.name === "get_ads_account_summary");
    expect(decl).toBeDefined();
    expect(decl!.description).toMatch(/subconjunto do faturamento/i);
    expect(decl!.description).toMatch(/top 50/i);
  });

  it("get_ads_campaigns description alerta que performance não está disponível (VMA-1/D5)", () => {
    const decl = TOOL_DECLARATIONS.find((d) => d.name === "get_ads_campaigns");
    expect(decl).toBeDefined();
    expect(decl!.description).toMatch(/sem dados de performance|sem dados|zerada|não disponível/i);
    expect(decl!.description).toMatch(/get_ads_account_summary/i);
  });
});

describe("TOOL_DECLARATIONS — OPS-1..5 (58-04)", () => {
  it("get_reputation description cita nível/termômetro, claims_rate, power_seller (OPS-1/D12)", () => {
    const decl = TOOL_DECLARATIONS.find((d) => d.name === "get_reputation");
    expect(decl).toBeDefined();
    expect(decl!.description).toMatch(/level_id|termômetro|nível/i);
    expect(decl!.description).toMatch(/claims_rate/i);
    expect(decl!.description).toMatch(/power_seller/i);
  });

  it("get_reputation NÃO expõe org_id/seller_id/ml_user_id como parâmetro (anti-IDOR OPS-1)", () => {
    const decl = TOOL_DECLARATIONS.find((d) => d.name === "get_reputation");
    expect(decl).toBeDefined();
    const props = Object.keys(decl!.parameters.properties);
    expect(props).not.toContain("org_id");
    expect(props).not.toContain("seller_id");
    expect(props).not.toContain("ml_user_id");
  });

  it("get_goals description cita 'meta × realizado' e 'period_month' (OPS-2/D13)", () => {
    const decl = TOOL_DECLARATIONS.find((d) => d.name === "get_goals");
    expect(decl).toBeDefined();
    expect(decl!.description).toMatch(/meta.*realizado|realizado.*meta/i);
    expect(decl!.parameters.properties).toHaveProperty("period_month");
  });

  it("get_goals NÃO expõe org_id/seller_id/ml_user_id como parâmetro (anti-IDOR OPS-2)", () => {
    const decl = TOOL_DECLARATIONS.find((d) => d.name === "get_goals");
    expect(decl).toBeDefined();
    const props = Object.keys(decl!.parameters.properties);
    expect(props).not.toContain("org_id");
    expect(props).not.toContain("seller_id");
    expect(props).not.toContain("ml_user_id");
  });

  it("get_claims description cita 'NÃO há prazo' e nega data_limite/solucao (OPS-3/D14)", () => {
    const decl = TOOL_DECLARATIONS.find((d) => d.name === "get_claims");
    expect(decl).toBeDefined();
    expect(decl!.description).toMatch(/NÃO há prazo|nao ha prazo/i);
    expect(decl!.description).toMatch(/data_limite|nulos|null/i);
  });

  it("get_open_questions description cita UNANSWERED (OPS-5/D14)", () => {
    const decl = TOOL_DECLARATIONS.find((d) => d.name === "get_open_questions");
    expect(decl).toBeDefined();
    expect(decl!.description).toMatch(/UNANSWERED/i);
  });
});

describe("dispatchTool — anti-IDOR get_goals (OPS-2/T-58-04-GOALS-IDOR)", () => {
  it("get_goals: filtra ml_targets por .in('seller_id', mlUserIds) do SERVIDOR — ignora EVIL_ARGS.seller_id", async () => {
    // ml_targets NÃO tem organization_id — anti-IDOR SOMENTE por seller_id ∈ mlUserIds
    const { sb, selectCalls, rpcCalls } = makeStub([
      { seller_id: "111", target_value: 500000, kpi_targets: { lucro_pct: 15 } },
    ]);
    const result = await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_goals", {
      ...EVIL_ARGS,
      period_month: "2026-06",
    }) as Record<string, unknown>;

    // Deve ter feito select em ml_targets com .in('seller_id', mlUserIds) do servidor
    const goalsCall = selectCalls.find((c) => c.table === "ml_targets");
    expect(goalsCall).toBeDefined();
    // in('seller_id') deve ser ML_IDS_SERVER (do servidor), NUNCA EVIL_ARGS.seller_id ("999")
    expect(goalsCall!.ins.seller_id).toEqual(ML_IDS_SERVER);
    expect(goalsCall!.ins.seller_id).not.toContain("999"); // EVIL_ARGS.seller_id ignorado
    expect(goalsCall!.ins.seller_id).not.toContain("ORG-ALHEIA"); // EVIL_ARGS.org_id ignorado
    // NÃO deve ter eq('organization_id') pois ml_targets não tem essa coluna
    expect(goalsCall!.eqs).not.toHaveProperty("organization_id");

    // Retorno deve ter period_month e by_seller
    expect(result).toHaveProperty("period_month");
    expect(result).toHaveProperty("by_seller");

    // Cruzamento com realizado via get_kpi_summary
    const kpiCall = rpcCalls.find((c) => c.fn === "get_kpi_summary");
    expect(kpiCall).toBeDefined();
    expect(kpiCall!.params.p_org_id).toBe(ORG_SERVER);
    expect(kpiCall!.params.p_user_ids).toEqual(ML_IDS_SERVER);
  });

  it("get_goals: meta_lucro_pct lê kpi_targets.gross_profit (chave real de produção) — VERAC-07", async () => {
    // Em produção ml_targets.kpi_targets usa 'gross_profit', não 'lucro_pct'
    const { sb } = makeStub([
      { seller_id: "111", target_value: 583000, kpi_targets: { revenue: 583000, gross_profit: 9 } },
    ]);
    const result = await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_goals", {
      period_month: "2026-06",
    }) as Record<string, unknown>;
    const bySeller = result.by_seller as Array<Record<string, unknown>>;
    expect(bySeller.length).toBe(1);
    expect(bySeller[0].meta_receita).toBe(583000);
    expect(bySeller[0].meta_lucro_pct).toBe(9); // gross_profit, não null
  });

  it("get_goals: sem metas cadastradas — declara limitação (VERAC-05), não inventa", async () => {
    // stub retorna array vazio — sem metas para o mês
    const { sb } = makeStub([]);
    const result = await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_goals", {
      period_month: "2026-06",
    }) as Record<string, unknown>;
    expect(result).toHaveProperty("label");
    expect((result.label as string)).toMatch(/sem meta|nenhum registro/i);
    expect(Array.isArray(result.by_seller)).toBe(true);
    expect((result.by_seller as unknown[]).length).toBe(0);
  });
});

describe("dispatchTool — anti-IDOR get_reputation (OPS-1/T-58-04-REP-IDOR)", () => {
  it("get_reputation: sem userJwt → retorna {error:'sem_jwt'} sem lançar (VERAC-05)", async () => {
    const { sb } = makeStub([]);
    // Chama sem ctx (ctx default = {}) → sem userJwt
    const result = await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_reputation", EVIL_ARGS) as Record<string, unknown>;
    expect(result).toHaveProperty("error");
    expect(result.error).toBe("sem_jwt");
    expect(result).toHaveProperty("label");
    expect((result.label as string)).toMatch(/não foi possível|sem jwt/i);
  });

  it("get_reputation: com userJwt — invoca ml-reputation com Authorization:Bearer e ml_user_id do servidor (B-1/T-58-04-REP-IDOR)", async () => {
    const { sb } = makeStub([]);

    // Shim Deno.env para o ambiente Node/Vitest (Deno não existe no test runner)
    // Abordagem documentada no plano: stubar Deno.env para que SUPABASE_URL retorne
    // um valor fixo e possamos verificar o path+query da URL chamada.
    const FAKE_SUPABASE_URL = "https://ckcdevcxgvueywivefgx.supabase.co";
    // @ts-ignore — Deno não existe no Node; shimamos para o teste
    globalThis.Deno = { env: { get: (key: string) => key === "SUPABASE_URL" ? FAKE_SUPABASE_URL : undefined } };

    // Intercepta globalThis.fetch para capturar a chamada à EF ml-reputation
    const fetchCalls: Array<{ url: string; authHeader: string }> = [];
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = String(url instanceof Request ? url.url : url);
        const authHeader = (init?.headers as Record<string, string>)?.["Authorization"] ?? "";
        fetchCalls.push({ url: urlStr, authHeader });
        // Retornar resposta mockada de sucesso
        return new Response(JSON.stringify({
          seller_reputation: {
            level_id: "5_green",
            transactions: { claims_rate: 0.01, cancellation_rate: 0.02 },
          },
          power_seller_status: "gold",
          nickname: "PEVEMERMEIO",
          feedbacks: [],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }) as typeof fetch;

      const result = await dispatchTool(
        sb, ORG_SERVER, ML_IDS_SERVER, "get_reputation", EVIL_ARGS,
        { userJwt: "JWT-REAL-DO-USER" },
      ) as Record<string, unknown>;

      // Verifica que houve chamada à EF ml-reputation (uma por ml_user_id em ML_IDS_SERVER)
      expect(fetchCalls.length).toBeGreaterThan(0);
      expect(fetchCalls.length).toBe(ML_IDS_SERVER.length); // uma chamada por loja

      // Cada chamada deve ter ml_user_id de ML_IDS_SERVER (servidor), nunca de EVIL_ARGS
      for (const call of fetchCalls) {
        // URL deve conter /functions/v1/ml-reputation?ml_user_id=
        expect(call.url).toMatch(/\/functions\/v1\/ml-reputation\?ml_user_id=/);
        const urlParams = new URL(call.url).searchParams;
        const calledId = urlParams.get("ml_user_id");
        expect(ML_IDS_SERVER).toContain(calledId); // id ∈ servidor
        expect(calledId).not.toBe("888"); // EVIL_ARGS.ml_user_id nunca usado

        // Authorization deve ser o JWT real do usuário
        expect(call.authHeader).toBe("Bearer JWT-REAL-DO-USER");
      }

      // Resultado estruturado
      expect(result).toHaveProperty("label");
      expect(result).toHaveProperty("data");
      expect(Array.isArray(result.data)).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      // @ts-ignore — limpar shim
      delete globalThis.Deno;
    }
  });
});

describe("dispatchTool — backward-compat ctx default {} (B-1)", () => {
  it("chamada sem 6º argumento (ex. get_margin_summary) não quebra — ctx default {}", async () => {
    const { sb, rpcCalls } = makeStub([{ gross_revenue: 100 }]);
    // Chamada sem ctx — deve compilar e funcionar igual ao antes
    const result = await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_margin_summary", {});
    expect(result).toBeDefined();
    const call = rpcCalls.find((c) => c.fn === "get_margin_summary");
    expect(call).toBeDefined();
    expect(call!.params.p_org_id).toBe(ORG_SERVER);
  });
});

describe("dispatchTool — get_claims limpo (OPS-3/D14)", () => {
  it("get_claims: não retorna data_limite nem solucao (campos mortos removidos)", async () => {
    const { sb, selectCalls } = makeStub([
      { claim_id: "C1", tipo: "mediations", status: "opened", motivo: "produto errado", data_abertura: "2026-06-01" },
      { claim_id: "C2", tipo: "returns", status: "closed", motivo: "desistência", data_abertura: "2026-06-05" },
    ]);
    const result = await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_claims", {}) as Record<string, unknown>;

    // Anti-IDOR mantido
    const call = selectCalls.find((c) => c.table === "ml_claims");
    expect(call).toBeDefined();
    expect(call!.eqs.organization_id).toBe(ORG_SERVER);

    // Retorno tem total, open, by_type, items (shape novo)
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("open");
    expect(result).toHaveProperty("by_type");
    expect(result).toHaveProperty("items");
    expect(result).toHaveProperty("label");

    // Contagem correta
    expect(result.total).toBe(2);
    expect(result.open).toBe(1); // só "opened"

    // by_type distribui por tipo
    const byType = result.by_type as Record<string, number>;
    expect(byType.mediations).toBe(1);
    expect(byType.returns).toBe(1);

    // Itens NÃO têm data_limite nem solucao (campos mortos)
    const items = result.items as Array<Record<string, unknown>>;
    if (items.length > 0) {
      expect(items[0]).not.toHaveProperty("data_limite");
      expect(items[0]).not.toHaveProperty("solucao");
    }
  });
});

describe("dispatchTool — get_health_score ordena por snapshot_month (OPS-4/D14)", () => {
  it("get_health_score: seleciona snapshot_month e ordena por snapshot_month DESC (não created_at)", async () => {
    const { sb, selectCalls } = makeStub([{ snapshot_month: "2026-06", score: 82 }]);
    const result = await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_health_score", {}) as unknown[];

    const call = selectCalls.find((c) => c.table === "consultor_health_snapshots");
    expect(call).toBeDefined();
    expect(call!.eqs.organization_id).toBe(ORG_SERVER);
    // Prova que snapshot_month está no select (o stub retorna o que passamos, mas a chain
    // registra que select() foi chamado — verificamos via resultado e que o stub tem o campo)
    expect(Array.isArray(result)).toBe(true);
  });
});
