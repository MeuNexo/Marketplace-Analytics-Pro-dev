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
import { TOOL_DECLARATIONS, dispatchTool } from "./tools";

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
  it("declara as 12 tools esperadas", () => {
    const names = TOOL_DECLARATIONS.map((d) => d.name).sort();
    expect(names).toEqual(
      [
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
