// ============================================================================
// useMLAdsDerivedMetrics.test.ts — Fase 213, Plano 02, Task 2
//
// Cobre o <behavior> do plano:
//   CR-02 — o breakeven de ACoS passa a ser margem de CONTRIBUIÇÃO (`lucro_pct`
//   pré-ads, vindo do mapa de margem de `useMLMarginWithAds`), nunca margem
//   bruta. Fica indefinido sem CMV cadastrado ou sem receita no período — nunca
//   um número inflado por custo zero.
//   AV-10 — o campo hoje chamado de "TACoS" por produto é o gasto do produto
//   sobre a receita da LOJA inteira: é share de gasto, não TACoS (que é a
//   métrica GLOBAL). Renomeado para `spend_share_pct`, sem semáforo de 8%.
//   AV-11 — `organic_revenue` não tem consumidor (confirmado por grep) e sai
//   do retorno global.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { AdsProductStat } from "./useMLAds";
import type { ProductMarginWithAds } from "./useMLMarginWithAds";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn() },
}));

vi.mock("@/contexts/MLStoreContext", () => ({
  useMLStore: vi.fn(() => ({ resolvedMLUserIds: ["123456789"] })),
}));

vi.mock("@/contexts/OrganizationContext", () => ({
  useOrganization: vi.fn(() => ({ currentOrg: { id: "org-uuid-test-1234" } })),
}));

// ─── Import hook under test ──────────────────────────────────────────────────

import { useMLAdsDerivedMetrics } from "./useMLAdsDerivedMetrics";

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeProduct(overrides: Partial<AdsProductStat> = {}): AdsProductStat {
  return {
    item_id: "MLB111",
    title: "Produto teste",
    thumbnail: null,
    impressions: 1000,
    clicks: 50,
    spend: 0,
    attributed_revenue: 0,
    attributed_orders: 0,
    cpc: 0,
    ctr: 5,
    roas: 0,
    ...overrides,
  };
}

/** Linha de margem completa — a RPC devolve todos os campos; cada teste só
 *  sobrescreve o que importa para o caso (has_cmv, lucro_pct, sku,
 *  lucro_pct_sem_rebate — 223-07). */
function makeMarginRow(overrides: Partial<ProductMarginWithAds> = {}): ProductMarginWithAds {
  return {
    item_id: "MLB111",
    titulo: "Produto teste",
    sku: null,
    listing_type: null,
    receita: 0,
    cmv: 0,
    comissao: 0,
    frete: 0,
    impostos: 0,
    lucro: 0,
    lucro_pct: null,
    pedidos: 0,
    unidades: 0,
    has_cmv: false,
    ads_spend: 0,
    ads_attributed_orders: 0,
    lucro_pos_ads: 0,
    lucro_pct_pos_ads: null,
    ads_no_sale: false,
    marca: null,
    // ── DIFAL (222-15-R2) — required no tipo, sem consumidor neste hook. ──
    difal_efeito: null,
    pedidos_difal_indefinido: 0,
    lucro_com_difal: null,
    lucro_pct_com_difal: null,
    lucro_pos_ads_com_difal: null,
    lucro_pct_pos_ads_com_difal: null,
    // ── Rebate (223-05/223-07) — o que este hook consome no breakeven. ──
    rebate_bruto: null,
    rebate_efeito: null,
    pedidos_sem_captura_rebate: 0,
    pedidos_rebate_nao_conferido: 0,
    lucro_sem_rebate: null,
    lucro_pct_sem_rebate: null,
    lucro_pos_ads_sem_rebate: null,
    lucro_pct_pos_ads_sem_rebate: null,
    ...overrides,
  };
}

/** Encadeia o mock do supabase-js para a query de `ml_daily_cache`
 *  (`.from().select().eq().in().gte().lte()`), terminando numa Promise —
 *  a única leitura de banco que sobra no hook depois que `ml_product_costs`
 *  sai (CR-02). */
async function mockDailyCache(rows: Array<{ approved_revenue: number; qty_orders: number }>) {
  const { supabase } = await import("@/integrations/supabase/client");
  const lte = vi.fn().mockResolvedValue({ data: rows, error: null });
  const gte = vi.fn(() => ({ lte }));
  const inFn = vi.fn(() => ({ gte }));
  const eq = vi.fn(() => ({ in: inFn }));
  const select = vi.fn(() => ({ eq }));
  (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ select });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await mockDailyCache([]); // receita da loja = 0 por padrão; testes de share sobrescrevem
});

// ─── CR-02: breakeven = margem de contribuição, não margem bruta ───────────

describe("useMLAdsDerivedMetrics — CR-02: breakeven de ACoS", () => {
  it("usa a margem operacional pré-ads (lucro_pct) como breakeven, não a margem bruta", async () => {
    // Preço médio R$100, custo unitário R$45 daria margem BRUTA de 55%
    // ((100-45)/100) — a conta que o código antigo fazia. A margem de
    // CONTRIBUIÇÃO (depois de comissão, frete e imposto) é 20%: é ela que
    // tem que sair como breakeven.
    const products = [
      makeProduct({ item_id: "MLB111", spend: 350, attributed_revenue: 1000, attributed_orders: 10 }),
    ];
    const marginByItem = new Map<string, ProductMarginWithAds>([
      ["MLB111", makeMarginRow({ item_id: "MLB111", has_cmv: true, lucro_pct: 20, receita: 1000, sku: "SKU-1" })],
    ]);

    const { result } = renderHook(
      () => useMLAdsDerivedMetrics(products, 350, "2026-07-01", "2026-07-31", marginByItem),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      const p = result.current.enriched[0];
      expect(p.acos_breakeven).toBe(20);
      expect(p.acos_breakeven).not.toBe(55);
    });

    // ACoS observado (35%) fica ENTRE os dois breakevens: com o antigo
    // (bruto, 55%) o anúncio passava no filtro "ACoS Crítico" da tela
    // (`acos > acos_breakeven`); com o novo (contribuição, 20%) ele é
    // sinalizado — exatamente o caso que o CR-02 corrige.
    const p = result.current.enriched[0];
    expect(p.acos).toBe(35);
    expect(p.acos! > p.acos_breakeven!).toBe(true);
  });

  it("breakeven é indefinido quando o anúncio não tem custo cadastrado (has_cmv=false)", async () => {
    const products = [
      makeProduct({ item_id: "MLB222", spend: 100, attributed_revenue: 500, attributed_orders: 5 }),
    ];
    const marginByItem = new Map<string, ProductMarginWithAds>([
      // has_cmv=false mesmo com lucro_pct preenchido: sem custo cadastrado o
      // número da RPC vem inflado (o custo entra como zero) e não pode virar
      // breakeven — mesma disciplina do has_cmv em /produtos-vendidos.
      ["MLB222", makeMarginRow({ item_id: "MLB222", has_cmv: false, lucro_pct: 90, receita: 500 })],
    ]);

    const { result } = renderHook(
      () => useMLAdsDerivedMetrics(products, 100, "2026-07-01", "2026-07-31", marginByItem),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.enriched[0].acos_breakeven).toBeNull();
    });
  });

  it("breakeven é indefinido quando o anúncio não teve receita no período (lucro_pct null)", async () => {
    const products = [
      makeProduct({ item_id: "MLB333", spend: 80, attributed_revenue: 0, attributed_orders: 0 }),
    ];
    const marginByItem = new Map<string, ProductMarginWithAds>([
      // has_cmv=true (tem custo cadastrado) mas lucro_pct null — a RPC devolve
      // null quando a receita do período de margem é zero.
      ["MLB333", makeMarginRow({ item_id: "MLB333", has_cmv: true, lucro_pct: null, receita: 0 })],
    ]);

    const { result } = renderHook(
      () => useMLAdsDerivedMetrics(products, 80, "2026-07-01", "2026-07-31", marginByItem),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.enriched[0].acos_breakeven).toBeNull();
    });
  });

  it("breakeven é indefinido quando o anúncio não aparece no mapa de margem", async () => {
    const products = [
      makeProduct({ item_id: "MLB999", spend: 10, attributed_revenue: 100, attributed_orders: 1 }),
    ];
    const marginByItem = new Map<string, ProductMarginWithAds>(); // vazio — anúncio sem linha de margem

    const { result } = renderHook(
      () => useMLAdsDerivedMetrics(products, 10, "2026-07-01", "2026-07-31", marginByItem),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.enriched[0].acos_breakeven).toBeNull();
      expect(result.current.enriched[0].seller_sku).toBeNull();
    });
  });

  it("documenta o filtro de ACoS crítico: só dispara quando acos E acos_breakeven estão definidos", async () => {
    // A tela (MLPublicidade.tsx) filtra com
    // `p.acos != null && p.acos_breakeven != null && p.acos > p.acos_breakeven`.
    // Este teste prova a metade que é responsabilidade do hook: sem custo
    // cadastrado, `acos_breakeven` sai null de verdade — nunca 0 nem um
    // número fictício — para o filtro nunca marcar por acidente.
    const products = [
      makeProduct({ item_id: "MLB444", spend: 200, attributed_revenue: 400, attributed_orders: 4 }),
    ];
    const marginByItem = new Map<string, ProductMarginWithAds>([
      ["MLB444", makeMarginRow({ item_id: "MLB444", has_cmv: false, lucro_pct: null, receita: 400 })],
    ]);

    const { result } = renderHook(
      () => useMLAdsDerivedMetrics(products, 200, "2026-07-01", "2026-07-31", marginByItem),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      const p = result.current.enriched[0];
      expect(p.acos).toBe(50); // tem ACoS observado...
      expect(p.acos_breakeven).toBeNull(); // ...mas sem breakeven definido
      const passaNoFiltroCritico = p.acos != null && p.acos_breakeven != null && p.acos > p.acos_breakeven;
      expect(passaNoFiltroCritico).toBe(false);
    });
  });

  it("seller_sku vem do campo sku do mapa de margem, não de uma leitura própria de custos", async () => {
    const products = [
      makeProduct({ item_id: "MLB555", spend: 10, attributed_revenue: 100, attributed_orders: 1 }),
    ];
    const marginByItem = new Map<string, ProductMarginWithAds>([
      ["MLB555", makeMarginRow({ item_id: "MLB555", has_cmv: true, lucro_pct: 15, receita: 100, sku: "CAM-AZUL-M" })],
    ]);

    const { result } = renderHook(
      () => useMLAdsDerivedMetrics(products, 10, "2026-07-01", "2026-07-31", marginByItem),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.enriched[0].seller_sku).toBe("CAM-AZUL-M");
    });
  });
});

// ─── AV-10: share de gasto (não é TACoS) ────────────────────────────────────

describe("useMLAdsDerivedMetrics — AV-10: share de gasto por produto", () => {
  it("spend_share_pct é o gasto do produto sobre a receita TOTAL da loja, e o campo não se chama mais tacos", async () => {
    await mockDailyCache([
      { approved_revenue: 6000, qty_orders: 60 },
      { approved_revenue: 4000, qty_orders: 40 },
    ]); // receita da loja no período = 10.000

    const products = [
      makeProduct({ item_id: "MLB666", spend: 500, attributed_revenue: 1000, attributed_orders: 8 }),
    ];
    const marginByItem = new Map<string, ProductMarginWithAds>();

    const { result } = renderHook(
      () => useMLAdsDerivedMetrics(products, 500, "2026-07-01", "2026-07-31", marginByItem),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      const p = result.current.enriched[0];
      expect(p.spend_share_pct).toBe(5); // 500 / 10.000 × 100
      expect(p).not.toHaveProperty("tacos"); // o campo com nome trocado não existe mais
    });
  });
});

// ─── Fase 223, plano 223-07: break-even nos DOIS cenários de rebate ────────
// (fecha a D-218-03, aberta desde 06/08: o ROAS de equilíbrio muda de lugar
// quando a comissão é a cheia e não a promocional).

describe("useMLAdsDerivedMetrics — 223-07: break-even sem rebate (tarifa cheia)", () => {
  it("com margem apurada e custo cadastrado, o ACoS de equilíbrio do segundo cenário sai da margem pré-ads sem rebate da mesma linha", async () => {
    const products = [
      makeProduct({ item_id: "MLB700", spend: 200, attributed_revenue: 1000, attributed_orders: 10 }),
    ];
    const marginByItem = new Map<string, ProductMarginWithAds>([
      [
        "MLB700",
        makeMarginRow({
          item_id: "MLB700", has_cmv: true, receita: 1000,
          lucro_pct: 30, lucro_pct_sem_rebate: 18,
        }),
      ],
    ]);

    const { result } = renderHook(
      () => useMLAdsDerivedMetrics(products, 200, "2026-08-01", "2026-08-31", marginByItem),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      const p = result.current.enriched[0];
      expect(p.acos_breakeven).toBe(30);
      expect(p.acos_breakeven_sem_rebate).toBe(18);
      expect(p.acos_breakeven_sem_rebate).not.toBe(p.acos_breakeven);
    });
  });

  it("sem custo cadastrado, os DOIS break-evens ficam indefinidos — nunca zero, nunca só um deles definido", async () => {
    const products = [
      makeProduct({ item_id: "MLB701", spend: 100, attributed_revenue: 500, attributed_orders: 5 }),
    ];
    const marginByItem = new Map<string, ProductMarginWithAds>([
      [
        "MLB701",
        makeMarginRow({
          item_id: "MLB701", has_cmv: false, receita: 500,
          lucro_pct: 90, lucro_pct_sem_rebate: 60,
        }),
      ],
    ]);

    const { result } = renderHook(
      () => useMLAdsDerivedMetrics(products, 100, "2026-08-01", "2026-08-31", marginByItem),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      const p = result.current.enriched[0];
      expect(p.acos_breakeven).toBeNull();
      expect(p.acos_breakeven_sem_rebate).toBeNull();
    });
  });

  it("sem apuração de rebate, só o break-even do primeiro cenário existe; o segundo é ausente", async () => {
    const products = [
      makeProduct({ item_id: "MLB702", spend: 50, attributed_revenue: 400, attributed_orders: 4 }),
    ];
    const marginByItem = new Map<string, ProductMarginWithAds>([
      [
        "MLB702",
        makeMarginRow({
          item_id: "MLB702", has_cmv: true, receita: 400,
          lucro_pct: 20, lucro_pct_sem_rebate: null,
        }),
      ],
    ]);

    const { result } = renderHook(
      () => useMLAdsDerivedMetrics(products, 50, "2026-08-01", "2026-08-31", marginByItem),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      const p = result.current.enriched[0];
      expect(p.acos_breakeven).toBe(20);
      expect(p.acos_breakeven_sem_rebate).toBeNull();
    });
  });

  it("o ROAS de equilíbrio é o inverso do ACoS de equilíbrio, nos dois cenários, e é indefinido quando o ACoS de equilíbrio é indefinido ou não positivo", async () => {
    const products = [
      makeProduct({ item_id: "MLB703", spend: 100, attributed_revenue: 1000, attributed_orders: 10 }),
      makeProduct({ item_id: "MLB704", spend: 100, attributed_revenue: 1000, attributed_orders: 10 }),
      makeProduct({ item_id: "MLB705", spend: 100, attributed_revenue: 1000, attributed_orders: 10 }),
    ];
    const marginByItem = new Map<string, ProductMarginWithAds>([
      // ACoS de equilíbrio positivo nos dois cenários (25% e 20%) → ROAS = 4 e 5.
      ["MLB703", makeMarginRow({ item_id: "MLB703", has_cmv: true, receita: 1000, lucro_pct: 25, lucro_pct_sem_rebate: 20 })],
      // Margem negativa (ACoS de equilíbrio negativo) → ROAS indefinido.
      ["MLB704", makeMarginRow({ item_id: "MLB704", has_cmv: true, receita: 1000, lucro_pct: -5, lucro_pct_sem_rebate: -10 })],
      // Sem custo cadastrado → os dois ACoS de equilíbrio são null → os dois ROAS também.
      ["MLB705", makeMarginRow({ item_id: "MLB705", has_cmv: false, receita: 1000, lucro_pct: 50, lucro_pct_sem_rebate: 40 })],
    ]);

    const { result } = renderHook(
      () => useMLAdsDerivedMetrics(products, 300, "2026-08-01", "2026-08-31", marginByItem),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      const [a, b, c] = result.current.enriched;
      expect(a.roas_breakeven).toBeCloseTo(4, 5); // 100/25
      expect(a.roas_breakeven_sem_rebate).toBeCloseTo(5, 5); // 100/20
      expect(b.acos_breakeven).toBe(-5);
      expect(b.roas_breakeven).toBeNull();
      expect(b.roas_breakeven_sem_rebate).toBeNull();
      expect(c.acos_breakeven).toBeNull();
      expect(c.roas_breakeven).toBeNull();
      expect(c.roas_breakeven_sem_rebate).toBeNull();
    });
  });

  it("um anúncio cujo ACoS real fica entre os dois break-evens é identificável — só fecha a conta enquanto a promoção durar", async () => {
    // ACoS observado 20%: passa no breakeven REAL (30%) mas NÃO passa no
    // breakeven da tarifa cheia (15%) — é exatamente o anúncio que a D-218-03
    // existe para sinalizar.
    const products = [
      makeProduct({ item_id: "MLB706", spend: 200, attributed_revenue: 1000, attributed_orders: 10 }),
    ];
    const marginByItem = new Map<string, ProductMarginWithAds>([
      [
        "MLB706",
        makeMarginRow({
          item_id: "MLB706", has_cmv: true, receita: 1000,
          lucro_pct: 30, lucro_pct_sem_rebate: 15,
        }),
      ],
    ]);

    const { result } = renderHook(
      () => useMLAdsDerivedMetrics(products, 200, "2026-08-01", "2026-08-31", marginByItem),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      const p = result.current.enriched[0];
      expect(p.acos).toBe(20);
      expect(p.acos_breakeven).toBe(30);
      expect(p.acos_breakeven_sem_rebate).toBe(15);
      // Passa no real, não passa na tarifa cheia — a régua de cor (MLPublicidade.tsx)
      // continua contra o real (T-223-63); é a informação, não o alerta, que muda.
      expect(p.acos! <= p.acos_breakeven!).toBe(true);
      expect(p.acos! > p.acos_breakeven_sem_rebate!).toBe(true);
    });
  });

  it("as duas contagens de lacuna do anúncio atravessam do mapa de margem, null quando o anúncio não tem linha", async () => {
    const products = [
      makeProduct({ item_id: "MLB707", spend: 10, attributed_revenue: 100, attributed_orders: 1 }),
      makeProduct({ item_id: "MLB708", spend: 10, attributed_revenue: 100, attributed_orders: 1 }),
    ];
    const marginByItem = new Map<string, ProductMarginWithAds>([
      [
        "MLB707",
        makeMarginRow({
          item_id: "MLB707", has_cmv: true, receita: 100,
          pedidos_sem_captura_rebate: 2, pedidos_rebate_nao_conferido: 1,
        }),
      ],
      // MLB708 fica sem entrada no mapa — anúncio sem linha de margem.
    ]);

    const { result } = renderHook(
      () => useMLAdsDerivedMetrics(products, 20, "2026-08-01", "2026-08-31", marginByItem),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      const [a, b] = result.current.enriched;
      expect(a.pedidos_rebate_sem_captura).toBe(2);
      expect(a.pedidos_rebate_nao_conferido).toBe(1);
      expect(b.pedidos_rebate_sem_captura).toBeNull();
      expect(b.pedidos_rebate_nao_conferido).toBeNull();
    });
  });
});

// ─── AV-11: organic_revenue sem consumidor, removido do retorno global ─────

describe("useMLAdsDerivedMetrics — AV-11: organic_revenue removido", () => {
  it("o objeto global não tem mais o campo organic_revenue", async () => {
    await mockDailyCache([{ approved_revenue: 1000, qty_orders: 10 }]);
    const products = [makeProduct()];
    const marginByItem = new Map<string, ProductMarginWithAds>();

    const { result } = renderHook(
      () => useMLAdsDerivedMetrics(products, 0, "2026-07-01", "2026-07-31", marginByItem),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.global.total_revenue).toBe(1000);
    });
    expect(result.current.global).not.toHaveProperty("organic_revenue");
  });
});
