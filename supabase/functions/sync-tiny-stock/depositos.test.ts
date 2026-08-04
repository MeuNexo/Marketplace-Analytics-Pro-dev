// ============================================================================
// Fase 214 — Task 3: extracao pura de saldo por deposito.
//
// Os fixtures NAO sao inventados: sao respostas reais de GET /estoque/{id} da
// API do Tiny, medidas em 2026-08-04 e registradas em
// docs/superpowers/plans/tiny-shape-medicao.md. O desenho original do plano
// assumia um envelope `estoque` com wrapper `{ deposito: {...} }` que a API
// nao usa — os testes casam com a realidade, nao o contrario.
// ============================================================================
import { describe, it, expect } from "vitest";
import { extrairDepositos } from "./depositos";

describe("extrairDepositos", () => {
  it("extrai saldo e disponivel por deposito, na forma medida do Tiny", () => {
    // Resposta real de GET /estoque/807451772 (SKU 12011666PTO3360M), reduzida.
    const r = {
      id: 807451772, codigo: "12011666PTO3360M", saldo: 33, disponivel: 11,
      depositos: [
        { id: 829490646, nome: "CD Expedição", desconsiderar: false, saldo: 0, disponivel: -1 },
        { id: 790617378, nome: "Centro de distribuição", desconsiderar: false, saldo: 32, disponivel: 32 },
      ],
    };
    expect(extrairDepositos(r)).toEqual([
      { deposito: "CD Expedição", saldo: 0, disponivel: -1 },
      { deposito: "Centro de distribuição", saldo: 32, disponivel: 32 },
    ]);
  });

  it("preserva negativo sem arredondar — o piso e da Task 7", () => {
    const r = {
      saldo: -1,
      depositos: [
        { nome: "Mercado Livre Fullfilment", desconsiderar: false, saldo: -1, disponivel: -20 },
      ],
    };
    expect(extrairDepositos(r)).toEqual([
      { deposito: "Mercado Livre Fullfilment", saldo: -1, disponivel: -20 },
    ]);
  });

  it("descarta deposito marcado como desconsiderar", () => {
    const r = {
      saldo: 5,
      depositos: [
        { nome: "CD Expedição", desconsiderar: false, saldo: 5, disponivel: 5 },
        { nome: "Magazine Luiza Fullfilment", desconsiderar: true, saldo: 9, disponivel: 9 },
      ],
    };
    expect(extrairDepositos(r)).toEqual([{ deposito: "CD Expedição", saldo: 5, disponivel: 5 }]);
  });

  it("cai no saldo de topo quando nao ha depositos", () => {
    const r = { saldo: 4, disponivel: 4, depositos: [] };
    expect(extrairDepositos(r)).toEqual([{ deposito: "(sem deposito)", saldo: 4, disponivel: 4 }]);
  });

  it("devolve vazio para resposta malformada", () => {
    expect(extrairDepositos(null)).toEqual([]);
    expect(extrairDepositos({})).toEqual([]);
    expect(extrairDepositos("nao e objeto")).toEqual([]);
    expect(extrairDepositos(42)).toEqual([]);
  });

  it("trata saldo ausente como zero e nao quebra", () => {
    const r = { depositos: [{ nome: "CD Expedição", desconsiderar: false }] };
    expect(extrairDepositos(r)).toEqual([{ deposito: "CD Expedição", saldo: 0, disponivel: 0 }]);
  });

  it("usa saldo quando disponivel nao veio", () => {
    const r = { depositos: [{ nome: "CD Expedição", desconsiderar: false, saldo: 7 }] };
    expect(extrairDepositos(r)).toEqual([{ deposito: "CD Expedição", saldo: 7, disponivel: 7 }]);
  });

  it("aceita numero em string, como algumas respostas do Tiny devolvem", () => {
    const r = { depositos: [{ nome: "CD Expedição", desconsiderar: false, saldo: "12", disponivel: "9" }] };
    expect(extrairDepositos(r)).toEqual([{ deposito: "CD Expedição", saldo: 12, disponivel: 9 }]);
  });

  it("descarta deposito sem nome — nao da para somar o que nao se sabe onde esta", () => {
    const r = {
      depositos: [
        { nome: "   ", desconsiderar: false, saldo: 5 },
        { desconsiderar: false, saldo: 3 },
        { nome: "CD Expedição", desconsiderar: false, saldo: 1, disponivel: 1 },
      ],
    };
    expect(extrairDepositos(r)).toEqual([{ deposito: "CD Expedição", saldo: 1, disponivel: 1 }]);
  });

  it("ainda aceita o envelope antigo, por seguranca", () => {
    const r = {
      estoque: {
        saldo: 7,
        depositos: [
          { deposito: { nome: "CD Expedição", saldo: 7, disponivel: 7, desconsiderar: false } },
        ],
      },
    };
    expect(extrairDepositos(r)).toEqual([{ deposito: "CD Expedição", saldo: 7, disponivel: 7 }]);
  });

  it("nao inventa deposito quando a lista existe mas some inteira no filtro", () => {
    // Todos desconsiderados: o resultado e vazio, NAO o saldo de topo.
    // Cair no topo aqui somaria estoque que a origem mandou ignorar.
    const r = {
      saldo: 99,
      depositos: [{ nome: "Magazine Luiza Fullfilment", desconsiderar: true, saldo: 99 }],
    };
    expect(extrairDepositos(r)).toEqual([]);
  });
});
