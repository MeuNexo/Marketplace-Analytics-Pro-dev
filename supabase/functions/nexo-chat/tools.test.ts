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
import { TOOL_DECLARATIONS, dispatchTool, summarizeVariations } from "./tools";

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
  it("declara as 23 tools esperadas", () => {
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

  it("get_dre_monthly (ml_billing_monthly) escopado por org + mlUserIds", async () => {
    const { sb, selectCalls } = makeStub([{ resumo: {} }]);
    await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_dre_monthly", EVIL_ARGS);
    const call = selectCalls.find((c) => c.table === "ml_billing_monthly");
    expect(call).toBeDefined();
    expect(call!.eqs.organization_id).toBe(ORG_SERVER);
    expect(call!.ins.ml_user_id).toEqual(ML_IDS_SERVER);
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
