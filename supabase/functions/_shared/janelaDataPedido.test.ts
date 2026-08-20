/**
 * janelaDataPedido.test.ts — a janela de um dia que hoje varre ZERO pedidos
 * (Quick 260820-jic, D-jic-01).
 *
 * O DEFEITO, MEDIDO EM PRODUÇÃO EM 20/08: chamar `recalc-order-costs` com
 * `date_from = date_to = "2026-02-10"` devolve `success: true, scanned: 0`.
 * `orders.data_pedido` é TEXT neste banco (DEBT-04) e o histórico traz carimbo
 * de hora — `'2026-02-10 00:00:00+00' <= '2026-02-10'` é FALSO por comparação
 * de string. Passando o dia seguinte como fim, a MESMA chamada varre 59.
 *
 * O limite INFERIOR já funciona hoje por esse mesmo mecanismo (prefixo igual,
 * string mais longa é maior). Este módulo não inventa comportamento novo —
 * estende para o limite superior o que o inferior já prova em produção.
 *
 * Sem rede, sem banco, sem `Date` local: a aritmética do dia seguinte é UTC
 * pura e a comparação continua sendo de STRING (converter para `Date`
 * reintroduziria o desvio de fuso do pedido de 30/06 às 22h BRT, exatamente o
 * que `taxConfigVigente.ts` documenta e evita).
 */
import { describe, it, expect } from "vitest";
import {
  inicioInclusivoDataPedido,
  fimExclusivoDataPedido,
  dentroDaJanelaDataPedido,
} from "./janelaDataPedido";

// Carimbos REAIS do banco. Os dois formatos que o histórico tem.
const CARIMBO_ESPACO = "2026-02-10 00:00:00+00";
const CARIMBO_T = "2026-02-10T23:59:59+00:00";

describe("fimExclusivoDataPedido — o dia seguinte, por aritmética UTC pura", () => {
  it("2026-02-10 vira 2026-02-11 — é o limite que faz a janela de um dia parar de varrer zero", () => {
    expect(fimExclusivoDataPedido("2026-02-10")).toBe("2026-02-11");
  });

  it("vira de mês: 2026-01-31 vira 2026-02-01", () => {
    expect(fimExclusivoDataPedido("2026-01-31")).toBe("2026-02-01");
  });

  it("fevereiro de ano NÃO bissexto: 2026-02-28 vira 2026-03-01", () => {
    expect(fimExclusivoDataPedido("2026-02-28")).toBe("2026-03-01");
  });

  it("vira de ano: 2026-12-31 vira 2027-01-01", () => {
    expect(fimExclusivoDataPedido("2026-12-31")).toBe("2027-01-01");
  });

  it("aceita carimbo de hora nos dois formatos do histórico e devolve o dia seguinte do DIA", () => {
    expect(fimExclusivoDataPedido(CARIMBO_ESPACO)).toBe("2026-02-11");
    expect(fimExclusivoDataPedido(CARIMBO_T)).toBe("2026-02-11");
    expect(fimExclusivoDataPedido("2026-02-10T00:00:00Z")).toBe("2026-02-11");
  });

  it.each([
    ["vazio", ""],
    ["nulo", null],
    ["indefinido", undefined],
    ["formato brasileiro", "10/02/2026"],
    ["mês sem zero à esquerda", "2026-2-10"],
    ["palavra", "ontem"],
    ["mês 13 e dia 45", "2026-13-45"],
    ["31 de fevereiro", "2026-02-31"],
  ])("ilegível é null, nunca aproximação: %s", (_nome, valor) => {
    expect(fimExclusivoDataPedido(valor as unknown)).toBeNull();
  });
});

describe("inicioInclusivoDataPedido — normaliza o limite INFERIOR também", () => {
  it("2026-02-10 continua 2026-02-10", () => {
    expect(inicioInclusivoDataPedido("2026-02-10")).toBe("2026-02-10");
  });

  it("chamador que não fatiou: 2026-02-10T00:00:00Z vira 2026-02-10", () => {
    // Sem esta normalização, o `>=` compararia contra a string com `T`, que
    // ordena DEPOIS do espaço — e o dia inteiro sumiria em silêncio.
    expect(inicioInclusivoDataPedido("2026-02-10T00:00:00Z")).toBe("2026-02-10");
  });

  it.each([
    ["vazio", ""],
    ["nulo", null],
    ["formato brasileiro", "10/02/2026"],
    ["mês 13 e dia 45", "2026-13-45"],
  ])("ilegível é null: %s", (_nome, valor) => {
    expect(inicioInclusivoDataPedido(valor as unknown)).toBeNull();
  });
});

describe("dentroDaJanelaDataPedido — o caso medido em produção", () => {
  it("date_from = date_to = 2026-02-10: o carimbo real 2026-02-10 00:00:00+00 está DENTRO", () => {
    // Este é exatamente o caso que hoje devolve scanned: 0.
    expect(dentroDaJanelaDataPedido(CARIMBO_ESPACO, "2026-02-10", "2026-02-10")).toBe(true);
  });

  it("date_from = date_to = 2026-02-10: 2026-02-11 00:00:00+00 está FORA", () => {
    expect(dentroDaJanelaDataPedido("2026-02-11 00:00:00+00", "2026-02-10", "2026-02-10")).toBe(false);
  });

  it("os DOIS formatos do histórico entram na janela de 10/02", () => {
    expect(dentroDaJanelaDataPedido(CARIMBO_ESPACO, "2026-02-10", "2026-02-10")).toBe(true);
    expect(dentroDaJanelaDataPedido(CARIMBO_T, "2026-02-10", "2026-02-10")).toBe(true);
  });

  it("os DOIS formatos do histórico ficam FORA da janela de 09/02", () => {
    expect(dentroDaJanelaDataPedido(CARIMBO_ESPACO, "2026-02-09", "2026-02-09")).toBe(false);
    expect(dentroDaJanelaDataPedido(CARIMBO_T, "2026-02-09", "2026-02-09")).toBe(false);
  });

  it("fronteira exata: 2026-02-11 cru está FORA da janela de 10/02 e DENTRO da de 11/02", () => {
    expect(dentroDaJanelaDataPedido("2026-02-11", "2026-02-10", "2026-02-10")).toBe(false);
    expect(dentroDaJanelaDataPedido("2026-02-11", "2026-02-11", "2026-02-11")).toBe(true);
  });

  it("normalização do limite inferior: date_from com carimbo NÃO perde o dia", () => {
    expect(
      dentroDaJanelaDataPedido(CARIMBO_ESPACO, "2026-02-10T00:00:00Z", "2026-02-10"),
    ).toBe(true);
  });

  it("janela de mês inteiro cobre o primeiro e o último dia, com carimbo", () => {
    expect(dentroDaJanelaDataPedido("2026-02-01 03:00:00+00", "2026-02-01", "2026-02-28")).toBe(true);
    expect(dentroDaJanelaDataPedido("2026-02-28 23:10:00+00", "2026-02-01", "2026-02-28")).toBe(true);
    expect(dentroDaJanelaDataPedido("2026-03-01 00:00:00+00", "2026-02-01", "2026-02-28")).toBe(false);
    expect(dentroDaJanelaDataPedido("2026-01-31 23:59:59+00", "2026-02-01", "2026-02-28")).toBe(false);
  });

  it("limite ILEGÍVEL em qualquer extremo devolve false — nunca janela silenciosamente aberta", () => {
    expect(dentroDaJanelaDataPedido(CARIMBO_ESPACO, "2026-02-10", "2026-02-lixo")).toBe(false);
    expect(dentroDaJanelaDataPedido(CARIMBO_ESPACO, "ontem", "2026-02-10")).toBe(false);
  });

  it("data do pedido ausente devolve false, sem lançar", () => {
    expect(dentroDaJanelaDataPedido(null, "2026-02-10", "2026-02-10")).toBe(false);
    expect(dentroDaJanelaDataPedido(undefined, "2026-02-10", "2026-02-10")).toBe(false);
  });

  it("janela invertida NÃO lança: devolve vazia, e quem decide o que fazer é a edge function", () => {
    expect(() =>
      dentroDaJanelaDataPedido(CARIMBO_ESPACO, "2026-02-20", "2026-02-10"),
    ).not.toThrow();
    expect(dentroDaJanelaDataPedido(CARIMBO_ESPACO, "2026-02-20", "2026-02-10")).toBe(false);
    expect(dentroDaJanelaDataPedido("2026-02-15 00:00:00+00", "2026-02-20", "2026-02-10")).toBe(false);
  });
});
