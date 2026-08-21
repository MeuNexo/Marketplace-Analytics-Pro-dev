/**
 * Testes da aba "Indicadores" do modal do anúncio (Quick task 260821-nof,
 * D-selo-03/D-selo-04). Não existia teste desta aba antes deste plano.
 *
 * Cobre:
 *  - a margem real aparece EXATAMENTE uma vez (o defeito que abriu o plano:
 *    hoje aparece duas — uma em cada componente de par)
 *  - os dois cenários hipotéticos, cada um com rótulo próprio
 *  - os cinco motivos de ausência continuam alcançáveis
 *  - o selo do estado atual, alimentado por UMA série diária sob demanda
 *  - a data de início da promoção vigente, e a forma "pelo menos" na borda
 *  - margem ausente não consulta série nenhuma
 *
 * A chamada de rede (`orders_price_timeseries`) entra falsificada — este
 * teste não toca banco.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { format, subDays } from "date-fns";
import { ListingIndicatorsTab } from "./ListingIndicatorsTab";
import type { ProductItem } from "@/contexts/MLInventoryContext";
import type { ProductMarginWithAds } from "@/hooks/useMLMarginWithAds";

// ─── Mocks ──────────────────────────────────────────────────────────────────

let rpcRows: unknown[] = [];
const rpcMock = vi.fn().mockImplementation(() => Promise.resolve({ data: rpcRows, error: null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

vi.mock("./useMLListingHealth", () => ({
  useMLListingHealth: () => ({ status: "idle" as const, data: null }),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_ITEM: ProductItem = {
  id: "MLB6977801882",
  title: "Anúncio de teste",
  available_quantity: 10,
  sold_quantity: 5,
  price: 100,
  currency_id: "BRL",
  thumbnail: null,
  status: "active",
  category_id: null,
  listing_type_id: null,
  health: null,
  visits: 0,
  brand: null,
  seller_custom_field: null,
  has_variations: false,
  variations: [],
  logistic_type: null,
  free_shipping: false,
  catalog_product_id: null,
  deal_ids: [],
  _ml_user_id: "1639558873",
};

/** Nomes conferidos contra `useMLMarginWithAds.ts` — `ProductMarginWithAds`. */
const makeMargin = (overrides: Partial<ProductMarginWithAds> = {}): ProductMarginWithAds => ({
  item_id: BASE_ITEM.id,
  titulo: BASE_ITEM.title,
  sku: null,
  listing_type: null,
  receita: 1000,
  cmv: 300,
  comissao: 120,
  frete: 50,
  impostos: 80,
  lucro: 450,
  lucro_pct: 45,
  pedidos: 5,
  unidades: 5,
  has_cmv: true,
  ads_spend: 30,
  ads_attributed_orders: 2,
  lucro_pos_ads: 420,
  lucro_pct_pos_ads: 42,
  ads_no_sale: false,
  marca: "Pralana",
  difal_efeito: null,
  pedidos_difal_indefinido: 0,
  lucro_com_difal: null,
  lucro_pct_com_difal: null,
  lucro_pos_ads_com_difal: null,
  lucro_pct_pos_ads_com_difal: null,
  rebate_bruto: null,
  rebate_efeito: null,
  pedidos_sem_captura_rebate: 0,
  pedidos_rebate_nao_conferido: 0,
  lucro_sem_rebate: null,
  lucro_pct_sem_rebate: null,
  lucro_pos_ads_sem_rebate: null,
  lucro_pct_pos_ads_sem_rebate: null,
  ...overrides,
});

/** Nomes conferidos contra `precoMcoSeries.ts` — a RPC `orders_price_timeseries`. */
const rpcRow = (daysAgo: number, opts: { qtd?: number; comissao?: number; rebateBruto?: number | null }) => ({
  bucket: format(subDays(new Date(), daysAgo), "yyyy-MM-dd"),
  qtd: opts.qtd ?? 1,
  total: 100,
  cmv: 30,
  comissao: opts.comissao ?? 20,
  frete: 5,
  qtd_sem_custo: 0,
  impostos: 8,
  qtd_sem_imposto: 0,
  rebate_bruto: opts.rebateBruto ?? null,
  rebate_efeito: opts.rebateBruto ?? null,
  pedidos_sem_captura_rebate: 0,
  pedidos_rebate_nao_conferido: 0,
});

beforeEach(() => {
  rpcRows = [];
  rpcMock.mockClear();
});

// ─── Testes ──────────────────────────────────────────────────────────────────

describe("ListingIndicatorsTab — a margem real aparece UMA vez (D-selo-03)", () => {
  it("um lucro pós-ads reconhecível (R$ 777,77) aparece exatamente uma vez no DOM", async () => {
    const margin = makeMargin({ lucro_pos_ads: 777.77, lucro_pct_pos_ads: 42 });
    render(<ListingIndicatorsTab item={BASE_ITEM} margin={margin} />);

    await waitFor(() => expect(rpcMock).toHaveBeenCalled());

    const ocorrencias = screen.getAllByText((_, node) => (node?.textContent ?? "").includes("777,77"))
      .filter((el) => (el.textContent ?? "").includes("777,77") && el.children.length === 0);
    expect(ocorrencias).toHaveLength(1);
  });
});

describe("ListingIndicatorsTab — os dois cenários hipotéticos, rotulados", () => {
  it("mostra os rótulos que distinguem o cenário com DIFAL do cenário de tarifa cheia", async () => {
    const margin = makeMargin({
      lucro_com_difal: 100,
      lucro_pct_com_difal: 10,
      lucro_pos_ads_com_difal: 90,
      lucro_pct_pos_ads_com_difal: 9,
      difal_efeito: 20,
      rebate_bruto: 30,
      rebate_efeito: 25,
      lucro_sem_rebate: 100,
      lucro_pct_sem_rebate: 10,
      lucro_pos_ads_sem_rebate: 95,
      lucro_pct_pos_ads_sem_rebate: 9.5,
    });
    render(<ListingIndicatorsTab item={BASE_ITEM} margin={margin} />);
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());

    expect(screen.getByText(/cenário com DIFAL recolhido/i)).toBeInTheDocument();
    expect(screen.getByText(/cenário sem a promoção \(tarifa cheia\)/i)).toBeInTheDocument();
  });

  it("quando o cenário com DIFAL é ausente, a frase de fraseMotivoSemDifal aparece", async () => {
    // Rebate presente e OK, para a frase de ausência ser inequivocamente a
    // do DIFAL (as duas réguas usam a mesma palavra "não carregou" quando
    // ambas ficam indisponíveis, e este teste checa uma coisa de cada vez).
    const margin = makeMargin({
      lucro_com_difal: null,
      lucro_pos_ads_com_difal: null,
      rebate_bruto: 30,
      rebate_efeito: 25,
      lucro_sem_rebate: 100,
      lucro_pos_ads_sem_rebate: 95,
      lucro_pct_pos_ads_sem_rebate: 9.5,
    });
    render(<ListingIndicatorsTab item={BASE_ITEM} margin={margin} />);
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());

    expect(screen.getByText(/não carregou/i)).toBeInTheDocument();
  });

  it("quando o cenário de rebate é ausente, a frase de fraseMotivoSemRebate aparece", async () => {
    const margin = makeMargin({ rebate_bruto: null, rebate_efeito: null, lucro_pos_ads_sem_rebate: null });
    render(<ListingIndicatorsTab item={BASE_ITEM} margin={margin} />);
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());

    // Sem contagem de lacuna nenhuma: motivo "indisponivel" — mesma frase que
    // o par de DIFAL usa para o mesmo motivo (fonte única, 223-02).
    const frasesNaoCarregou = screen.getAllByText(/não carregou/i);
    expect(frasesNaoCarregou.length).toBeGreaterThanOrEqual(2);
  });

  it("os cinco motivos de ausência da 223-02 continuam alcançáveis (conferência que não fecha)", async () => {
    const margin = makeMargin({
      rebate_bruto: null,
      rebate_efeito: null,
      lucro_pos_ads_sem_rebate: null,
      pedidos_rebate_nao_conferido: 4,
    });
    render(<ListingIndicatorsTab item={BASE_ITEM} margin={margin} />);
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());

    expect(screen.getByText(/nosso/i)).toBeInTheDocument();
  });
});

describe("ListingIndicatorsTab — o selo do estado atual (D-selo-04)", () => {
  it("com rebate positivo na janela recente, o selo carrega data-selo-promo com o estado com_promo", async () => {
    rpcRows = [rpcRow(0, { comissao: 90, rebateBruto: 10 })];
    const margin = makeMargin();
    const { container } = render(<ListingIndicatorsTab item={BASE_ITEM} margin={margin} />);

    await waitFor(() => {
      expect(container.querySelector("[data-selo-promo]")).not.toBeNull();
    });
    expect(container.querySelector("[data-selo-promo]")?.getAttribute("data-selo-promo")).toBe(
      "com_promo",
    );
  });

  it("sem venda na janela recente, o selo é sem_venda_recente — nunca a média do período", async () => {
    // Só um ponto há 20 dias — fora da janela recente de 7 dias.
    rpcRows = [rpcRow(20, { comissao: 90, rebateBruto: 10 })];
    const margin = makeMargin({ comissao: 500, rebate_bruto: 100, rebate_efeito: 80 });
    const { container } = render(<ListingIndicatorsTab item={BASE_ITEM} margin={margin} />);

    await waitFor(() => {
      expect(container.querySelector("[data-selo-promo]")).not.toBeNull();
    });
    expect(container.querySelector("[data-selo-promo]")?.getAttribute("data-selo-promo")).toBe(
      "sem_venda_recente",
    );
  });

  it("enquanto a série não chega, o selo NÃO aparece (nunca um estado provisório)", async () => {
    rpcRows = [rpcRow(0, { comissao: 90, rebateBruto: 10 })];
    const margin = makeMargin();
    const { container } = render(<ListingIndicatorsTab item={BASE_ITEM} margin={margin} />);

    // Antes do fetch resolver (síncrono, sem waitFor): nenhum selo ainda.
    expect(container.querySelector("[data-selo-promo]")).toBeNull();

    // Deixa o fetch em curso resolver antes do teste terminar, para não
    // vazar uma atualização de estado fora de act() para o próximo teste.
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
  });
});

describe("ListingIndicatorsTab — a data de início da promoção vigente", () => {
  it("com a promoção começando 8 dias atrás, a aba escreve a data de início", async () => {
    rpcRows = [
      rpcRow(20, { comissao: 90, rebateBruto: 0 }),
      rpcRow(8, { comissao: 90, rebateBruto: 15 }),
      rpcRow(0, { comissao: 90, rebateBruto: 10 }),
    ];
    const margin = makeMargin();
    render(<ListingIndicatorsTab item={BASE_ITEM} margin={margin} />);

    const dataEsperada = format(subDays(new Date(), 8), "dd/MM/yy");
    await waitFor(() => {
      expect(screen.getByText(new RegExp(`Promoção ativa desde ${dataEsperada}`))).toBeInTheDocument();
    });
  });

  it("quando a faixa alcança a borda da série, escreve a forma de 'pelo menos'", async () => {
    // Toda a janela de 60 dias com rebate positivo — a faixa nunca quebra.
    rpcRows = [
      rpcRow(59, { comissao: 90, rebateBruto: 10 }),
      rpcRow(0, { comissao: 90, rebateBruto: 10 }),
    ];
    const margin = makeMargin();
    render(<ListingIndicatorsTab item={BASE_ITEM} margin={margin} />);

    await waitFor(() => {
      expect(screen.getByText(/ativa desde pelo menos/i)).toBeInTheDocument();
    });
  });
});

describe("ListingIndicatorsTab — margem ausente não consulta série nenhuma", () => {
  it("sem margem (undefined), rende o texto de sempre e NÃO chama a RPC", () => {
    // `getAllByText` porque o Scoreboard de qualidade (item.health=null)
    // também rende "—" — este teste confere só que o marcador de ausência
    // continua alcançável, não a contagem exata de "—" na tela inteira.
    render(<ListingIndicatorsTab item={BASE_ITEM} margin={null} />);

    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("margem sem vendas no período (pct nulo), rende o texto de sempre e NÃO chama a RPC", () => {
    const margin = makeMargin({ lucro_pct: null, lucro_pct_pos_ads: null });
    render(<ListingIndicatorsTab item={BASE_ITEM} margin={margin} />);

    expect(screen.getByText(/Sem vendas no período/i)).toBeInTheDocument();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
