// ============================================================================
// 225-05 Task 3 — o portão que o `grep` não consegue ser
//
// Três proibições deste plano são sobre AUSÊNCIA de elemento renderizado, e
// ausência não se prova com busca de texto no arquivo: o botão pode estar
// escrito no código e não ser renderizado, ou estar renderizado num ramo que o
// grep não distingue. Estas asserções montam o componente de verdade e
// perguntam à árvore acessível o que existe na tela.
//
// O que está sendo protegido, em uma frase cada:
//   · caso NÃO acionável não pode oferecer caminho para virar chamado — hoje é
//     quase todo caso (régua de valor a menor desligada, ausência a verificar);
//   · "resolvido sozinho" não é botão em lugar nenhum;
//   · a fila "Nosso erro" não tem dossiê nem desfecho nem prazo.
// ============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { CasoConciliacaoRow } from "@/hooks/useConciliacao";

const marcarDesfecho = vi.fn();
let podeEscrever = true;

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useCasoDesfecho", async () => {
  const real = await vi.importActual<typeof import("@/hooks/useCasoDesfecho")>(
    "@/hooks/useCasoDesfecho",
  );
  return {
    ...real,
    useCasoDesfecho: () => ({
      marcarDesfecho,
      podeEscrever,
      papel: podeEscrever ? "owner" : "viewer",
      ocupado: false,
      erro: null,
    }),
  };
});

import { CasoConciliacaoSheet } from "../CasoConciliacaoSheet";
import { CasoNossoErroSheet } from "../CasoNossoErroSheet";

const CASO: CasoConciliacaoRow = {
  caso_id: null,
  ml_order_id: "2000017817648050",
  tipo_caso: "repasse_a_menor",
  fila: "ml",
  acionavel: true,
  motivo: "repasse_a_menor_confirmado",
  estado: "aberto",
  titulo: "Chapéu Country Pralana Aba 10",
  sku: "PRL-CH-0010",
  quantidade: 2,
  retido_de_fato: 123.45,
  cobranca_declarada: 100.4,
  residuo_ml: 23.05,
  esperado_nosso: 420.5,
  recebido: 397.45,
  residuo_nosso: 23.05,
  diferenca: 23.05,
  data_pedido: "2026-08-07",
  data_evento: "2026-08-10",
  dias_restantes: 5,
  n_pagamentos: 2,
  payment_ids: ["172656733528", "171656032162"],
  release_date_max: "2026-08-25",
  valor_estimado: false,
};

function abrir(caso: Partial<CasoConciliacaoRow>) {
  render(
    <CasoConciliacaoSheet
      caso={{ ...CASO, ...caso } as CasoConciliacaoRow}
      ingestaoInicio="2026-01-28"
      onOpenChange={() => {}}
    />,
  );
}

const ROTULOS_DE_DESFECHO = [
  /Marcar como contestado/i,
  /Marcar como ganho/i,
  /Marcar como negado/i,
];

function nenhumBotaoDeDesfecho() {
  for (const r of ROTULOS_DE_DESFECHO) {
    expect(screen.queryByRole("button", { name: r })).toBeNull();
  }
}

beforeEach(() => {
  podeEscrever = true;
  marcarDesfecho.mockReset();
  cleanup();
});

describe("🔴 o dossiê oferece ação SÓ no caso acionável", () => {
  it("1 — caso acionável e aberto oferece contestar e o dossiê", () => {
    abrir({});
    expect(screen.getByRole("button", { name: /Marcar como contestado/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Copiar dossiê/i })).toBeTruthy();
  });

  it("2 — caso contestado troca para ganho e negado, e some o contestar", () => {
    abrir({ estado: "contestado" });
    expect(screen.getByRole("button", { name: /Marcar como ganho/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Marcar como negado/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Marcar como contestado/i })).toBeNull();
  });

  it("3 — 🔴 caso NÃO acionável não tem NENHUM botão de desfecho, e diz o motivo", () => {
    // Hoje é quase todo caso: os 5 candidatos a ausência em 75 dias eram 5/5
    // contestação de cartão, e a régua de valor a menor está desligada.
    abrir({ acionavel: false, motivo: "ausencia_a_verificar", tipo_caso: "repasse_ausente" });
    nenhumBotaoDeDesfecho();
    expect(screen.getByText(/ainda não é acionável/i)).toBeTruthy();
    // O aviso medido em C-06 aparece na tela, não só no texto copiado.
    expect(screen.getByText(/5 de 5 pedidos sem repasse/i)).toBeTruthy();
  });

  it("4 — caso da régua desligada também não oferece ação", () => {
    abrir({ acionavel: false, motivo: "regua_nao_liberada" });
    nenhumBotaoDeDesfecho();
    expect(screen.getByText(/55,3%/)).toBeTruthy();
  });

  it("5 — sem permissão de escrita não há botão de desfecho, mas o dossiê fica", () => {
    podeEscrever = false;
    abrir({});
    nenhumBotaoDeDesfecho();
    expect(screen.getByRole("button", { name: /Copiar dossiê/i })).toBeTruthy();
  });
});

describe("🔴 'resolvido sozinho' e 'expirado' são do sistema — nunca botão", () => {
  it("6 — resolvido sozinho: sem ações, com a nota explicativa", () => {
    abrir({ estado: "resolvido_sozinho" });
    nenhumBotaoDeDesfecho();
    expect(screen.getByText(/fechado automaticamente/i)).toBeTruthy();
  });

  it("7 — em NENHUM estado existe um botão que crie 'resolvido sozinho'", () => {
    for (const estado of ["aberto", "contestado", "ganho", "negado", "expirado"]) {
      cleanup();
      abrir({ estado });
      expect(
        screen.queryByRole("button", { name: /resolvido sozinho/i }),
        `estado ${estado} ofereceu 'resolvido sozinho' como ação`,
      ).toBeNull();
    }
  });

  it("8 — expirado: sem ações, e visualmente distinto de 'ainda dá tempo'", () => {
    abrir({ estado: "expirado", dias_restantes: -3 });
    nenhumBotaoDeDesfecho();
    expect(screen.getByText(/janela de ressarcimento deste caso fechou/i)).toBeTruthy();
  });
});

describe("🔴 cada ícone de copiar tem rótulo acessível NOMEANDO o campo", () => {
  it("9 — todo botão de copiar tem nome, e há mais de um campo copiável", () => {
    abrir({});
    const botoes = screen.getAllByRole("button", { name: /^Copiar / });
    expect(botoes.length).toBeGreaterThanOrEqual(4);
    for (const b of botoes) {
      const nome = b.getAttribute("aria-label") ?? b.textContent ?? "";
      expect(nome.trim().length, "ícone de copiar mudo").toBeGreaterThan("Copiar ".length);
    }
  });

  it("10 — os dois identificadores de pagamento aparecem, não só o primeiro", () => {
    abrir({});
    expect(screen.getByText("172656733528")).toBeTruthy();
    expect(screen.getByText("171656032162")).toBeTruthy();
  });

  it("11 — as duas fontes aparecem NOMEADAS na tela", () => {
    abrir({});
    expect(screen.getByText(/Mercado Pago \(retido de fato\)/)).toBeTruthy();
    expect(screen.getByText(/Fatura do Mercado Livre \(cobrança declarada\)/)).toBeTruthy();
  });

  it("12 — valor nulo aparece como 'não apurado', nunca como R$ 0,00", () => {
    abrir({ retido_de_fato: null, cobranca_declarada: null, diferenca: null });
    expect(screen.getAllByText(/não apurado/).length).toBeGreaterThan(0);
    expect(screen.queryByText("R$ 0,00")).toBeNull();
  });
});

describe("🔴 a fila 'Nosso erro' não tem caminho para virar chamado", () => {
  function abrirNosso(caso: Partial<CasoConciliacaoRow> = {}) {
    render(
      <CasoNossoErroSheet
        caso={
          {
            ...CASO,
            fila: "nosso",
            acionavel: false,
            motivo: "divergencia_da_nossa_base",
            ...caso,
          } as CasoConciliacaoRow
        }
        ingestaoInicio="2026-01-28"
        onOpenChange={() => {}}
      />,
    );
  }

  it("13 — sem dossiê e sem nenhum botão de desfecho", () => {
    abrirNosso();
    expect(screen.queryByRole("button", { name: /Copiar dossiê/i })).toBeNull();
    nenhumBotaoDeDesfecho();
  });

  it("14 — sem selo de prazo: aqui não corre relógio de ressarcimento", () => {
    abrirNosso({ dias_restantes: 3 });
    expect(screen.queryByText(/Expira em/i)).toBeNull();
    expect(screen.queryByText(/Expira hoje/i)).toBeNull();
  });

  it("15 — diz, com todas as letras, que nada sai daqui", () => {
    abrirNosso();
    expect(screen.getByText(/Nada aqui é enviado para fora/i)).toBeTruthy();
  });
});
