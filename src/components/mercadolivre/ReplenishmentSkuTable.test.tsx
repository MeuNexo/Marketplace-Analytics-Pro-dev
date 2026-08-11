/**
 * Testes de regressão — `ReplenishmentSkuTable` usa `group.item_id` cru como
 * React key e como identidade de expansão, em vez de `chaveGrupo()`
 * (`useReplenishmentBySku.ts`).
 *
 * SKU que só existe no Tiny (sem anúncio ML ativo) tem `item_id: null`. No
 * dataset real da Pé Vermeio, 503 dos 781 grupos caem nesse caso — todos
 * compartilham a mesma key `null` (o React normaliza para a string "null")
 * e a mesma identidade no `Set<string>` `expandedIds` da tabela.
 *
 * Ver .planning/debug/compras-grupos-key-nula.md
 */

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ReplenishmentSkuTable } from "./ReplenishmentSkuTable";
import type {
  GroupedReplenishmentRow,
  ReplenishmentSkuRow,
} from "@/hooks/useReplenishmentBySku";

// jsdom não implementa ResizeObserver; os primitivos Radix (Collapsible/Tooltip) o usam.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserverMock;

// ─── Fixtures ────────────────────────────────────────────────────────────────

function sku(over: Partial<ReplenishmentSkuRow>): ReplenishmentSkuRow {
  return {
    item_id: null,
    variation_id: null,
    title: null,
    brand: null,
    sku_code: null,
    attribute_combinations: null,
    attribute_combinations_label: "",
    logistic_type: null,
    sku_stock: 0,
    estoque_full: 0,
    estoque_cd: 0,
    estoque_centro: 0,
    tem_anuncio_ativo: true,
    origem_catalogo: "tiny",
    divergencia_full: null,
    venda_dia: 0,
    cobertura_atual: null,
    ponto_reposicao: 0,
    alvo: 0,
    compra_sugerida: 0,
    valor_estimado: null,
    custo_ausente: false,
    sem_giro: false,
    gatilho_ativo: false,
    param_lead_time: 7,
    param_cobertura: 15,
    param_safety: 3,
    param_moq: 1,
    param_pack: 1,
    param_origem: "global",
    qtd_a_caminho: 0,
    data_proxima_chegada: null,
    venda_dia_origem: "simples",
    lead_time_origem: "param",
    tendencia: "~",
    fator_sazonal: null,
    lead_time_real: null,
    venda_simples: 0,
    venda_inteligente: null,
    status_esgotado: "com_giro",
    ...over,
  };
}

function grupo(
  skus: ReplenishmentSkuRow[],
  over: Partial<GroupedReplenishmentRow> = {},
): GroupedReplenishmentRow {
  return {
    item_id: null,
    title: skus[0]?.title ?? null,
    brand: skus[0]?.brand ?? null,
    logistic_type: null,
    skus,
    total_compra_sugerida: skus.reduce((s, r) => s + r.compra_sugerida, 0),
    total_valor_estimado: null,
    any_gatilho_ativo: skus.some((s) => s.gatilho_ativo),
    any_custo_ausente: skus.some((s) => s.custo_ausente),
    total_a_caminho: 0,
    ...over,
  };
}

// Grupo A — SKU só-Tiny "Camisa Country A", 2 variações, item_id null
const grupoA = grupo(
  [
    sku({ sku_code: "SKU-A-P", attribute_combinations_label: "Azul / P", title: "Camisa Country A" }),
    sku({ sku_code: "SKU-A-M", attribute_combinations_label: "Azul / M", title: "Camisa Country A" }),
  ],
  { title: "Camisa Country A", brand: "Marca A" },
);

// Grupo B — SKU só-Tiny "Bota Country B", 2 variações, item_id null
const grupoB = grupo(
  [
    sku({ sku_code: "SKU-B-38", attribute_combinations_label: "Marrom / 38", title: "Bota Country B" }),
    sku({ sku_code: "SKU-B-40", attribute_combinations_label: "Marrom / 40", title: "Bota Country B" }),
  ],
  { title: "Bota Country B", brand: "Marca B" },
);

// Grupo C — só aparece DEPOIS do filtro (simula troca de Marca no MLCompras),
// nunca foi clicado pelo usuário.
const grupoC = grupo(
  [
    sku({ sku_code: "SKU-C-U1", attribute_combinations_label: "Verde / Único", title: "Chapéu Country C" }),
    sku({ sku_code: "SKU-C-U2", attribute_combinations_label: "Verde / P", title: "Chapéu Country C" }),
  ],
  { title: "Chapéu Country C", brand: "Marca C" },
);

describe("ReplenishmentSkuTable — key nula em grupos sem anúncio (Fase 214)", () => {
  it("expandir um grupo sem anúncio não expande os demais grupos sem anúncio (isolamento)", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<ReplenishmentSkuTable grouped={[grupoA, grupoB]} />);

    // Nenhuma variação visível antes do clique
    expect(screen.queryByText("Azul / P")).not.toBeInTheDocument();
    expect(screen.queryByText("Marrom / 38")).not.toBeInTheDocument();

    // Expande SOMENTE o grupo A (primeiro botão de expandir)
    const botoes = screen.getAllByLabelText("Expandir variações");
    expect(botoes.length).toBe(2);
    fireEvent.click(botoes[0]);

    // Variações do grupo A aparecem
    expect(screen.getByText("Azul / P")).toBeInTheDocument();
    expect(screen.getByText("Azul / M")).toBeInTheDocument();

    // Variações do grupo B NÃO deveriam aparecer — um clique não deveria
    // expandir um grupo diferente. Falha aqui é o bug: expandedIds.has(null)
    // é verdadeiro para os DOIS grupos (item_id null em ambos).
    expect(screen.queryByText("Marrom / 38")).not.toBeInTheDocument();
    expect(screen.queryByText("Marrom / 40")).not.toBeInTheDocument();

    // Suporte: ATUALIZADO no ciclo de fix de VariationRow (ver
    // .planning/debug/compras-grupos-key-nula.md). Quando este teste foi
    // escrito, `expect(...).toBe(true)` passava — mas por uma causa
    // ALTERNATIVA à testada aqui: a key de VariationRow também colidia em
    // `null` dentro de grupoA (variation_id/item_id nulos nas 2 variações),
    // um bug irmão só descoberto depois. Agora que os DOIS pontos (groupKey
    // aqui E a key de VariationRow) usam identidade estável, não deveria
    // sobrar nenhum aviso de key duplicada neste cenário.
    const avisoKeyDuplicada = consoleError.mock.calls.some((call) =>
      String(call[0]).includes("same key"),
    );
    expect(avisoKeyDuplicada).toBe(false);

    consoleError.mockRestore();
  });

  it("filtro que troca os grupos exibidos não deve herdar estado de expansão de um grupo diferente", () => {
    const { rerender } = render(<ReplenishmentSkuTable grouped={[grupoA, grupoB]} />);

    // Expande o grupo A
    fireEvent.click(screen.getAllByLabelText("Expandir variações")[0]);
    expect(screen.getByText("Azul / P")).toBeInTheDocument();

    // Simula filtro (ex: trocar Marca no MLCompras): grupoA e grupoB saem da
    // lista renderizada, entra grupoC — que nunca foi clicado.
    rerender(<ReplenishmentSkuTable grouped={[grupoC]} />);

    // A linha mestre do grupo C deve aparecer
    expect(screen.getByText("Chapéu Country C")).toBeInTheDocument();

    // Mas suas variações NÃO deveriam estar expandidas — grupoC deveria
    // nascer FECHADO. Falha aqui é o bug: expandedIds ainda contém `null`
    // (do clique no grupo A) e grupoC.item_id também é null.
    expect(screen.queryByText("Verde / Único")).not.toBeInTheDocument();
    expect(screen.queryByText("Verde / P")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Expandir variações")).toBeInTheDocument();
  });
});

// Grupo D — UM ÚNICO anúncio (sem colisão possível ENTRE grupos), com 3
// variações que são todas SKUs só-Tiny dentro do mesmo anúncio: item_id
// null E variation_id null nas 3. sku_code é distinto entre elas (isso é
// permitido porque o teste passa `grouped` já pronto para o componente —
// não passa pelas funções de agrupamento reais, que segregariam por
// sku_code quando item_id é null). Reproduz o padrão irmão descrito em
// .planning/debug/compras-grupos-key-nula.md, Evidence "VariationRow".
const grupoD = grupo(
  [
    sku({ sku_code: "SKU-D-1", attribute_combinations_label: "Preto / Único", title: "Chinelo Country D" }),
    sku({ sku_code: "SKU-D-2", attribute_combinations_label: "Cinza / Único", title: "Chinelo Country D" }),
    sku({ sku_code: "SKU-D-3", attribute_combinations_label: "Bege / Único", title: "Chinelo Country D" }),
  ],
  { title: "Chinelo Country D", brand: "Marca D" },
);

describe("ReplenishmentSkuTable — key nula ENTRE variações do mesmo grupo (VariationRow)", () => {
  it("cada linha de variação mostra o próprio conteúdo após um rerender que remove uma variação do meio (sanidade de emparelhamento)", () => {
    const { rerender } = render(<ReplenishmentSkuTable grouped={[grupoD]} />);

    // Único grupo na tela → único botão de expandir.
    fireEvent.click(screen.getByLabelText("Expandir variações"));

    // As 3 variações aparecem no primeiro render, cada uma emparelhada com
    // o próprio sku_code (não misturado com o de outra).
    const linhaD1Antes = screen.getByText("Preto / Único").closest("tr");
    const linhaD2Antes = screen.getByText("Cinza / Único").closest("tr");
    const linhaD3Antes = screen.getByText("Bege / Único").closest("tr");
    expect(linhaD1Antes).not.toBeNull();
    expect(linhaD2Antes).not.toBeNull();
    expect(linhaD3Antes).not.toBeNull();
    expect(within(linhaD1Antes as HTMLElement).getByText("SKU-D-1")).toBeInTheDocument();
    expect(within(linhaD2Antes as HTMLElement).getByText("SKU-D-2")).toBeInTheDocument();
    expect(within(linhaD3Antes as HTMLElement).getByText("SKU-D-3")).toBeInTheDocument();

    // Rerender removendo a variação do MEIO (D2) — mantendo D1 na posição 0
    // (identidade do grupo não muda, já que groupKey deriva de
    // group.skus[0]).
    const grupoDFiltrado = grupo(
      [grupoD.skus[0], grupoD.skus[2]],
      { title: grupoD.title, brand: grupoD.brand },
    );
    rerender(<ReplenishmentSkuTable grouped={[grupoDFiltrado]} />);

    // D2 saiu da lista — seu conteúdo não deve mais existir em lugar nenhum.
    expect(screen.queryByText("Cinza / Único")).not.toBeInTheDocument();
    expect(screen.queryByText("SKU-D-2")).not.toBeInTheDocument();

    // D1 e D3 devem seguir emparelhadas com o PRÓPRIO sku_code — não com o
    // de D2 (removida) nem trocadas entre si por reaproveitamento de nó.
    const linhaD1Depois = screen.getByText("Preto / Único").closest("tr");
    const linhaD3Depois = screen.getByText("Bege / Único").closest("tr");
    expect(linhaD1Depois).not.toBeNull();
    expect(linhaD3Depois).not.toBeNull();
    expect(within(linhaD1Depois as HTMLElement).getByText("SKU-D-1")).toBeInTheDocument();
    expect(within(linhaD3Depois as HTMLElement).getByText("SKU-D-3")).toBeInTheDocument();

    // NOTA HONESTA (medida por execução real, não teórica): esta asserção
    // de conteúdo JÁ PASSA hoje, mesmo com `key={sku.variation_id ??
    // sku.item_id}` colidindo em `null` para as 3 variações. VariationRow
    // não tem estado local (é puro em `sku`), então mesmo quando o React
    // reconcilia o fiber errado por posição, ele sempre chama o componente
    // de novo com as props corretas da posição atual e o texto final fica
    // certo. A key nula NÃO corrompe conteúdo aqui — o sintoma real e
    // reproduzível é só o warning do React (ver teste abaixo), que é
    // "unsupported behavior" pela própria mensagem do React e um risco
    // latente (quebra se VariationRow ganhar estado local no futuro).
  });

  it("NÃO deve disparar o aviso do React de key duplicada ('same key') entre variações do mesmo grupo", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { rerender } = render(<ReplenishmentSkuTable grouped={[grupoD]} />);
    fireEvent.click(screen.getByLabelText("Expandir variações"));

    // Rerender que também exercita o caminho de update (não só o mount),
    // já que a reconciliação por key entra em jogo entre renders.
    const grupoDFiltrado = grupo(
      [grupoD.skus[0], grupoD.skus[2]],
      { title: grupoD.title, brand: grupoD.brand },
    );
    rerender(<ReplenishmentSkuTable grouped={[grupoDFiltrado]} />);

    const avisoKeyDuplicada = consoleError.mock.calls.some((call) =>
      /same key|duplicate key/i.test(String(call[0])),
    );
    // Asserção principal (RED hoje): as 3 variações de grupoD têm
    // variation_id E item_id nulos — `sku.variation_id ?? sku.item_id`
    // colide em `null` para todas. React deveria acusar, mas não deveria.
    expect(avisoKeyDuplicada).toBe(false);

    consoleError.mockRestore();
  });
});
