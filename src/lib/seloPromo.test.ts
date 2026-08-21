/**
 * Testes da régua do estado ATUAL do rebate (Quick task 260821-nof, D-selo-04).
 *
 * Cobre `janelaEstadoAtual` (o recorte), `resolveSeloPromo` (os sete estados,
 * tabela (a)-(j)), `estadoAtualDaSerie` (agregação sobre série diária) e
 * `inicioPromocaoVigente` (a data de início da faixa vigente, para o detalhe).
 */
import { describe, it, expect } from "vitest";
import {
  JANELA_ESTADO_ATUAL_DIAS,
  janelaEstadoAtual,
  resolveSeloPromo,
  estadoAtualDaSerie,
  inicioPromocaoVigente,
  type PontoSerieRebate,
  type SeloPromoInput,
} from "./seloPromo";
import { resolveLinhaRebate } from "./rebateLinhaCenarios";

// ─── janelaEstadoAtual ────────────────────────────────────────────────────────

describe("janelaEstadoAtual", () => {
  it("período de 30 dias terminando em 19/08 devolve 13/08 a 19/08 — sete dias ancorados no FIM", () => {
    const janela = janelaEstadoAtual({ from: "2026-07-21", to: "2026-08-19" });
    expect(janela).toEqual({ from: "2026-08-13", to: "2026-08-19" });
  });

  it("período de 3 dias devolve o período inteiro — a janela é grampeada", () => {
    const janela = janelaEstadoAtual({ from: "2026-08-17", to: "2026-08-19" });
    expect(janela).toEqual({ from: "2026-08-17", to: "2026-08-19" });
  });

  it("período de exatamente 7 dias devolve ele mesmo", () => {
    const janela = janelaEstadoAtual({ from: "2026-08-13", to: "2026-08-19" });
    expect(janela).toEqual({ from: "2026-08-13", to: "2026-08-19" });
  });

  it("nunca busca fora do recorte original, mesmo com dias > duração do período", () => {
    const janela = janelaEstadoAtual({ from: "2026-08-18", to: "2026-08-19" }, 30);
    expect(janela.from).toBe("2026-08-18");
  });
});

// ─── resolveSeloPromo — os dez casos da tabela (a)-(j) ─────────────────────────

describe("resolveSeloPromo", () => {
  it("(caso medido) rebate bruto 562,10 sobre comissão real 515,48 dá com_promo ≈52,2% — o caso do MLB6977801882", () => {
    // 🔴 No agregado do período este anúncio lia 19,2% — ESSE é o número
    // ERRADO para o selo: ele dilui 3 semanas sem promoção com 1 semana com a
    // tarifa subsidiada pela metade. O selo tem de ler o estado ATUAL: 52,2%.
    const resultado = resolveSeloPromo({
      comissao: 515.48,
      rebateBruto: 562.1,
      semVendaNaJanela: false,
      mediaPeriodoPct: 19.2,
    });

    expect(resultado.estado).toBe("com_promo");
    expect(resultado.pct).not.toBeNull();
    expect(resultado.pct!).toBeCloseTo(52.16, 1);
    expect(resultado.texto).toBe("52% promo");
    expect(resultado.texto).not.toContain("19");
  });

  it("(a) anúncio ausente da janela recente: sem_venda_recente, pct nulo, titulo com a média do período E a frase de estado desconhecido — NUNCA o percentual do período como se fosse o atual", () => {
    const resultado = resolveSeloPromo({
      comissao: 0,
      rebateBruto: null,
      semVendaNaJanela: true,
      mediaPeriodoPct: 19.2,
    });

    expect(resultado.estado).toBe("sem_venda_recente");
    expect(resultado.pct).toBeNull();
    // [260821-qss] Célula vazia — o estado e o título sobrevivem, a marca não.
    expect(resultado.texto).toBe("");
    expect(resultado.texto).not.toMatch(/%/);
    expect(resultado.titulo).toContain("19.2%");
    expect(resultado.titulo).toMatch(/desconhecid/i);
  });

  it("(b) insumo ausente com pedido não conferido: conferencia_nao_fecha", () => {
    const resultado = resolveSeloPromo({
      comissao: 100,
      rebateBruto: null,
      pedidosSemCaptura: 0,
      pedidosNaoConferidos: 3,
      semVendaNaJanela: false,
    });
    expect(resultado.estado).toBe("conferencia_nao_fecha");
    expect(resultado.pct).toBeNull();
    expect(resultado.texto).toBe("—");
    expect(resultado.titulo).toMatch(/conciliada/i);
  });

  it("(c) insumo ausente com pedido sem captura: nao_capturado", () => {
    const resultado = resolveSeloPromo({
      comissao: 100,
      rebateBruto: null,
      pedidosSemCaptura: 4,
      pedidosNaoConferidos: 0,
      semVendaNaJanela: false,
    });
    expect(resultado.estado).toBe("nao_capturado");
    expect(resultado.pct).toBeNull();
    expect(resultado.texto).toBe("—");
    expect(resultado.titulo).toMatch(/fatura/i);
  });

  it("(d) insumo ausente, sem contagem nenhuma: indisponivel", () => {
    const resultado = resolveSeloPromo({
      comissao: 100,
      rebateBruto: null,
      semVendaNaJanela: false,
    });
    expect(resultado.estado).toBe("indisponivel");
    expect(resultado.pct).toBeNull();
    expect(resultado.texto).toBe("—");
  });

  it("(e) comissaoCheia <= 0: indisponivel", () => {
    const resultado = resolveSeloPromo({
      comissao: -10,
      rebateBruto: 5,
      semVendaNaJanela: false,
    });
    expect(resultado.estado).toBe("indisponivel");
  });

  it("(e) rebateBruto < 0: indisponivel", () => {
    const resultado = resolveSeloPromo({
      comissao: 100,
      rebateBruto: -5,
      semVendaNaJanela: false,
    });
    expect(resultado.estado).toBe("indisponivel");
  });

  it("(f) rebate zero com pedido não conferido: conferencia_nao_fecha vence — precedência da 223-02", () => {
    const resultado = resolveSeloPromo({
      comissao: 100,
      rebateBruto: 0,
      pedidosSemCaptura: 2,
      pedidosNaoConferidos: 1,
      semVendaNaJanela: false,
    });
    expect(resultado.estado).toBe("conferencia_nao_fecha");
  });

  it("(g) rebate zero com pedido sem captura (sem não-conferido): nao_capturado", () => {
    const resultado = resolveSeloPromo({
      comissao: 100,
      rebateBruto: 0,
      pedidosSemCaptura: 2,
      pedidosNaoConferidos: 0,
      semVendaNaJanela: false,
    });
    expect(resultado.estado).toBe("nao_capturado");
  });

  it("(h) rebate bruto zero, sem lacuna: sem_promo, texto travessão, sem caractere de porcentagem", () => {
    const resultado = resolveSeloPromo({
      comissao: 100,
      rebateBruto: 0,
      pedidosSemCaptura: 0,
      pedidosNaoConferidos: 0,
      semVendaNaJanela: false,
    });
    expect(resultado.estado).toBe("sem_promo");
    expect(resultado.pct).toBeNull();
    expect(resultado.texto).toBe("—");
    expect(resultado.texto).not.toMatch(/%/);
  });

  it("(i) rebate positivo com lacuna aberta: com_promo_parcial, texto termina em asterisco, titulo com contagem e causa", () => {
    const resultado = resolveSeloPromo({
      comissao: 90,
      rebateBruto: 10,
      pedidosSemCaptura: 3,
      pedidosNaoConferidos: 0,
      semVendaNaJanela: false,
    });
    expect(resultado.estado).toBe("com_promo_parcial");
    expect(resultado.texto.endsWith("*")).toBe(true);
    expect(resultado.titulo).toContain("3");
    expect(resultado.titulo).toMatch(/ainda não faturado/i);
  });

  it("(j) rebate positivo, sem lacuna: com_promo", () => {
    const resultado = resolveSeloPromo({
      comissao: 90,
      rebateBruto: 10,
      pedidosSemCaptura: 0,
      pedidosNaoConferidos: 0,
      semVendaNaJanela: false,
    });
    expect(resultado.estado).toBe("com_promo");
    expect(resultado.texto.endsWith("*")).toBe(false);
  });

  it("percentual de 0,4% vira '<1% promo'", () => {
    // comissao 995,6 + rebateBruto 4 → 4/999,6 = 0,4003%
    const resultado = resolveSeloPromo({
      comissao: 995.6,
      rebateBruto: 4,
      semVendaNaJanela: false,
    });
    expect(resultado.pct!).toBeGreaterThan(0);
    expect(resultado.pct!).toBeLessThan(1);
    expect(resultado.texto).toBe("<1% promo");
  });

  it("entradas nulas não lançam (strictNullChecks desligado; contagens chegam nulas de linha de RPC antiga)", () => {
    expect(() =>
      resolveSeloPromo({
        comissao: 100,
        rebateBruto: 10,
        pedidosSemCaptura: null,
        pedidosNaoConferidos: null,
        semVendaNaJanela: false,
        mediaPeriodoPct: null,
      } as SeloPromoInput),
    ).not.toThrow();
  });

  it("nenhum dos dez casos produz texto igual a '0% promo'", () => {
    const casos: SeloPromoInput[] = [
      { comissao: 515.48, rebateBruto: 562.1, semVendaNaJanela: false },
      { comissao: 0, rebateBruto: null, semVendaNaJanela: true, mediaPeriodoPct: 19.2 },
      { comissao: 100, rebateBruto: null, pedidosNaoConferidos: 3, semVendaNaJanela: false },
      { comissao: 100, rebateBruto: null, pedidosSemCaptura: 4, semVendaNaJanela: false },
      { comissao: 100, rebateBruto: null, semVendaNaJanela: false },
      { comissao: -10, rebateBruto: 5, semVendaNaJanela: false },
      { comissao: 100, rebateBruto: -5, semVendaNaJanela: false },
      { comissao: 100, rebateBruto: 0, pedidosNaoConferidos: 1, semVendaNaJanela: false },
      { comissao: 100, rebateBruto: 0, pedidosSemCaptura: 2, semVendaNaJanela: false },
      { comissao: 100, rebateBruto: 0, semVendaNaJanela: false },
      { comissao: 90, rebateBruto: 10, pedidosSemCaptura: 3, semVendaNaJanela: false },
      { comissao: 90, rebateBruto: 10, semVendaNaJanela: false },
    ];

    for (const caso of casos) {
      const resultado = resolveSeloPromo(caso);
      expect(resultado.texto).not.toBe("0% promo");
    }
  });

  it("paridade com a 223-02: para toda entrada em que resolveLinhaRebate devolve motivo != ok, resolveSeloPromo devolve estado sem percentual", () => {
    const entradasAusencia = [
      {
        linhaRebate: {
          comRebate: { valor: 10, pct: 5 },
          semRebate: null,
          rebateEfeito: null,
          rebateBruto: null,
          pedidosSemCaptura: 0,
          pedidosNaoConferidos: 5,
        },
        selo: {
          comissao: 100,
          rebateBruto: null,
          pedidosNaoConferidos: 5,
          semVendaNaJanela: false,
        },
      },
      {
        linhaRebate: {
          comRebate: { valor: 10, pct: 5 },
          semRebate: null,
          rebateEfeito: null,
          rebateBruto: null,
          pedidosSemCaptura: 7,
          pedidosNaoConferidos: 0,
        },
        selo: {
          comissao: 100,
          rebateBruto: null,
          pedidosSemCaptura: 7,
          semVendaNaJanela: false,
        },
      },
      {
        linhaRebate: {
          comRebate: { valor: 10, pct: 5 },
          semRebate: null,
          rebateEfeito: null,
          rebateBruto: null,
          pedidosSemCaptura: 0,
          pedidosNaoConferidos: 0,
        },
        selo: { comissao: 100, rebateBruto: null, semVendaNaJanela: false },
      },
    ] as const;

    for (const { linhaRebate, selo } of entradasAusencia) {
      const linha = resolveLinhaRebate(linhaRebate);
      expect(linha.motivo).not.toBe("ok");

      const resultado = resolveSeloPromo(selo);
      expect(resultado.pct).toBeNull();
    }
  });
});

// ─── estadoAtualDaSerie ─────────────────────────────────────────────────────────

describe("estadoAtualDaSerie", () => {
  const PERIODO = { from: "2026-07-21", to: "2026-08-19" };

  it("agrega só os pontos dentro da janela e devolve a entrada de resolveSeloPromo", () => {
    const serie: PontoSerieRebate[] = [
      // Fora da janela (antes de 13/08) — não pode contar.
      { bucket: "2026-08-01", qtd: 5, comissao: 1000, rebateBruto: 0 },
      // Dentro da janela.
      { bucket: "2026-08-14", qtd: 2, comissao: 100, rebateBruto: 20 },
      { bucket: "2026-08-19", qtd: 3, comissao: 150, rebateBruto: 30 },
    ];

    const resultado = estadoAtualDaSerie(serie, PERIODO, 5.0);

    // comissaoCheia = (100+150) + (20+30) = 300; pct = 50/300*100 = 16,67%
    expect(resultado.estado).toBe("com_promo");
    expect(resultado.pct!).toBeCloseTo(16.67, 1);
  });

  it("série cujos últimos sete dias não têm venda nenhuma produz sem_venda_recente", () => {
    const serie: PontoSerieRebate[] = [
      { bucket: "2026-08-01", qtd: 5, comissao: 1000, rebateBruto: 100 },
      { bucket: "2026-08-10", qtd: 2, comissao: 100, rebateBruto: 20 },
    ];

    const resultado = estadoAtualDaSerie(serie, PERIODO, 12.0);
    expect(resultado.estado).toBe("sem_venda_recente");
    expect(resultado.titulo).toContain("12.0%");
  });

  it("ausência de rebate_bruto em qualquer ponto da janela propaga — nunca soma só os apurados", () => {
    const serie: PontoSerieRebate[] = [
      { bucket: "2026-08-14", qtd: 2, comissao: 100, rebateBruto: 20 },
      { bucket: "2026-08-15", qtd: 1, comissao: 50, rebateBruto: null },
    ];

    const resultado = estadoAtualDaSerie(serie, PERIODO);
    expect(resultado.pct).toBeNull();
    expect(["nao_capturado", "conferencia_nao_fecha", "indisponivel"]).toContain(resultado.estado);
  });
});

// ─── inicioPromocaoVigente ──────────────────────────────────────────────────────

describe("inicioPromocaoVigente", () => {
  it("série com rebate zero até 11/08 e positivo de 12/08 a 19/08 devolve 12/08, truncada falsa", () => {
    const serie: PontoSerieRebate[] = [
      { bucket: "2026-08-09", qtd: 3, comissao: 100, rebateBruto: 0 },
      { bucket: "2026-08-10", qtd: 2, comissao: 100, rebateBruto: 0 },
      { bucket: "2026-08-11", qtd: 4, comissao: 100, rebateBruto: 0 },
      { bucket: "2026-08-12", qtd: 3, comissao: 100, rebateBruto: 15 },
      { bucket: "2026-08-15", qtd: 2, comissao: 100, rebateBruto: 20 },
      { bucket: "2026-08-19", qtd: 1, comissao: 100, rebateBruto: 10 },
    ];

    const resultado = inicioPromocaoVigente(serie);
    expect(resultado.data).toBe("2026-08-12");
    expect(resultado.truncada).toBe(false);
  });

  it("um dia SEM VENDA no meio da faixa não a quebra", () => {
    const serie: PontoSerieRebate[] = [
      { bucket: "2026-08-12", qtd: 3, comissao: 100, rebateBruto: 15 },
      { bucket: "2026-08-13", qtd: 0, comissao: 0, rebateBruto: null },
      { bucket: "2026-08-14", qtd: 2, comissao: 100, rebateBruto: 20 },
      { bucket: "2026-08-19", qtd: 1, comissao: 100, rebateBruto: 10 },
    ];

    const resultado = inicioPromocaoVigente(serie);
    expect(resultado.data).toBe("2026-08-12");
  });

  it("um dia COM venda e rebate zero no meio quebra a faixa: a data é a do reinício", () => {
    const serie: PontoSerieRebate[] = [
      { bucket: "2026-08-10", qtd: 3, comissao: 100, rebateBruto: 15 },
      { bucket: "2026-08-13", qtd: 2, comissao: 100, rebateBruto: 0 },
      { bucket: "2026-08-14", qtd: 2, comissao: 100, rebateBruto: 20 },
      { bucket: "2026-08-19", qtd: 1, comissao: 100, rebateBruto: 10 },
    ];

    const resultado = inicioPromocaoVigente(serie);
    expect(resultado.data).toBe("2026-08-14");
    expect(resultado.truncada).toBe(false);
  });

  it("faixa que começa no primeiro ponto da série volta com truncada verdadeira", () => {
    const serie: PontoSerieRebate[] = [
      { bucket: "2026-07-23", qtd: 2, comissao: 100, rebateBruto: 10 },
      { bucket: "2026-08-01", qtd: 3, comissao: 100, rebateBruto: 15 },
      { bucket: "2026-08-19", qtd: 1, comissao: 100, rebateBruto: 10 },
    ];

    const resultado = inicioPromocaoVigente(serie);
    expect(resultado.data).toBe("2026-07-23");
    expect(resultado.truncada).toBe(true);
  });

  it("dia mais recente com venda sem rebate devolve nulo — não há promoção vigente", () => {
    const serie: PontoSerieRebate[] = [
      { bucket: "2026-08-10", qtd: 2, comissao: 100, rebateBruto: 15 },
      { bucket: "2026-08-19", qtd: 1, comissao: 100, rebateBruto: 0 },
    ];

    const resultado = inicioPromocaoVigente(serie);
    expect(resultado.data).toBeNull();
    expect(resultado.truncada).toBe(false);
  });

  it("série vazia devolve nulo sem lançar", () => {
    expect(() => inicioPromocaoVigente([])).not.toThrow();
    expect(inicioPromocaoVigente([])).toEqual({ data: null, truncada: false });
  });
});

export {}; // garante que o arquivo é tratado como módulo mesmo sem `describe` no topo
