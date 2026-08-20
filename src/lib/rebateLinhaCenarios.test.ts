/**
 * Testes de `resolveLinhaRebate` — o seletor por LINHA dos dois cenários de
 * rebate (Fase 223, plano 223-02).
 *
 * O que estes testes existem para impedir: uma tela exibir ZERO onde não há
 * segundo cenário, ou tratar "não capturamos ainda" como se fosse "medimos e
 * deu zero". A medição do 223-01 acrescentou um TERCEIRO jeito de não ter
 * segundo número: a tarifa que o ML cobrou não bate com a comissão que
 * gravamos — aí o erro é NOSSO, e o rebate daquele pedido não pode ser
 * afirmado. `conferencia_nao_fecha` tem precedência sobre `nao_capturado`
 * porque é a causa mais específica e a única acionável por nós.
 *
 * Existe um teste por valor de `motivo`, cada um provando que o segundo
 * número sai NULO e nunca zero.
 */
import { describe, it, expect } from "vitest";
import {
  cenariosRebateMargemReal,
  fraseMotivoSemRebate,
  resolveLinhaRebate,
  type LinhaMargemComRebate,
  type LinhaRebateInput,
  type MotivoSemRebate,
} from "./rebateLinhaCenarios";

/** Entrada mínima saudável — cada teste muda só o que quer provar. */
function entrada(over: Partial<LinhaRebateInput> = {}): LinhaRebateInput {
  return {
    comRebate: { valor: 21.9, pct: 6.1 },
    semRebate: { valor: 43.07, pct: 12.0 },
    rebateEfeito: 18.5,
    rebateBruto: 21.17,
    pedidosSemCaptura: 0,
    pedidosNaoConferidos: 0,
    ...over,
  };
}

describe("resolveLinhaRebate — caminho feliz", () => {
  it("devolve os dois pares intactos e motivo 'ok' quando o efeito foi apurado", () => {
    const r = resolveLinhaRebate(entrada());

    expect(r.motivo).toBe<MotivoSemRebate>("ok");
    expect(r.comRebate).toEqual({ valor: 21.9, pct: 6.1 });
    expect(r.semRebate).toEqual({ valor: 43.07, pct: 12.0 });
    expect(r.rebateEfeito).toBe(18.5);
  });

  it("não recalcula rebate nenhum: devolve exatamente os pares que recebeu", () => {
    const comRebate = { valor: 21.9, pct: 6.1 };
    const semRebate = { valor: 43.07, pct: 12.0 };
    const r = resolveLinhaRebate(entrada({ comRebate, semRebate }));

    expect(r.comRebate).toBe(comRebate);
    expect(r.semRebate).toBe(semRebate);
  });
});

describe("resolveLinhaRebate — um teste por motivo de ausência", () => {
  it("'indisponivel': efeito nulo e nenhum pedido sem captura — o cenário não carregou", () => {
    const r = resolveLinhaRebate(
      entrada({ rebateEfeito: null, rebateBruto: null, semRebate: null, pedidosSemCaptura: 0, pedidosNaoConferidos: 0 }),
    );

    expect(r.motivo).toBe<MotivoSemRebate>("indisponivel");
    expect(r.semRebate).toBeNull();
    expect(fraseMotivoSemRebate("indisponivel")).toMatch(/não carregou/);
  });

  it("'nao_capturado': efeito nulo e pedidos sem captura maiores que zero — traz a contagem", () => {
    const r = resolveLinhaRebate(
      entrada({ rebateEfeito: null, rebateBruto: null, semRebate: null, pedidosSemCaptura: 12, pedidosNaoConferidos: 0 }),
    );

    expect(r.motivo).toBe<MotivoSemRebate>("nao_capturado");
    expect(r.semRebate).toBeNull();
    expect(r.pedidosSemCaptura).toBe(12);
    const frase = fraseMotivoSemRebate("nao_capturado", 12);
    expect(frase).toContain("12");
  });

  it("'conferencia_nao_fecha': efeito nulo e pedidos não conferidos maiores que zero — erro nosso, com contagem", () => {
    const r = resolveLinhaRebate(
      entrada({ rebateEfeito: null, rebateBruto: null, semRebate: null, pedidosSemCaptura: 0, pedidosNaoConferidos: 5 }),
    );

    expect(r.motivo).toBe<MotivoSemRebate>("conferencia_nao_fecha");
    expect(r.semRebate).toBeNull();
    expect(r.pedidosNaoConferidos).toBe(5);
    const frase = fraseMotivoSemRebate("conferencia_nao_fecha", 0, 5);
    expect(frase).toContain("5");
    // O erro é nosso — a frase não pode culpar o Mercado Livre.
    expect(frase).not.toMatch(/Mercado Livre errou|culpa do ML/i);
    expect(frase).toMatch(/nosso/i);
  });

  it("conferência que não fecha ganha PRECEDÊNCIA sobre captura ausente", () => {
    // A causa mais específica, e a única acionável por nós, vence quando as
    // duas lacunas coexistem na mesma linha.
    const r = resolveLinhaRebate(
      entrada({ rebateEfeito: null, rebateBruto: null, semRebate: null, pedidosSemCaptura: 9, pedidosNaoConferidos: 3 }),
    );

    expect(r.motivo).toBe<MotivoSemRebate>("conferencia_nao_fecha");
    expect(r.pedidosSemCaptura).toBe(9);
    expect(r.pedidosNaoConferidos).toBe(3);
  });

  it("'sem_campanha_no_periodo': efeito zero, captura completa e conferência fechada", () => {
    const r = resolveLinhaRebate(
      entrada({
        rebateEfeito: 0,
        rebateBruto: 0,
        semRebate: { valor: 62.76, pct: 12.0 },
        pedidosSemCaptura: 0,
        pedidosNaoConferidos: 0,
      }),
    );

    expect(r.motivo).toBe<MotivoSemRebate>("sem_campanha_no_periodo");
    expect(r.semRebate).toBeNull();
    expect(r.efeitoNulo).toBe(true);
    expect(fraseMotivoSemRebate("sem_campanha_no_periodo")).toMatch(/nenhum pedido/i);
  });

  it("efeito zero MAS com pedidos sem captura: fica 'ok', não 'sem_campanha_no_periodo'", () => {
    // Não se pode afirmar "sem campanha" com lacuna — os dois números
    // aparecem e a contagem da lacuna vem junto.
    const r = resolveLinhaRebate(
      entrada({
        rebateEfeito: 0,
        rebateBruto: 0,
        semRebate: { valor: 62.76, pct: 12.0 },
        pedidosSemCaptura: 4,
        pedidosNaoConferidos: 0,
      }),
    );

    expect(r.motivo).toBe<MotivoSemRebate>("ok");
    expect(r.semRebate).not.toBeNull();
    expect(r.pedidosSemCaptura).toBe(4);
  });

  it("efeito zero MAS com pedidos não conferidos: também fica 'ok'", () => {
    const r = resolveLinhaRebate(
      entrada({
        rebateEfeito: 0,
        rebateBruto: 0,
        semRebate: { valor: 62.76, pct: 12.0 },
        pedidosSemCaptura: 0,
        pedidosNaoConferidos: 2,
      }),
    );

    expect(r.motivo).toBe<MotivoSemRebate>("ok");
    expect(r.semRebate).not.toBeNull();
    expect(r.pedidosNaoConferidos).toBe(2);
  });

  it("'indisponivel': efeito apurado maior que zero mas segundo par ausente (janela de publicação)", () => {
    // Acontece entre publicar o frontend e aplicar a migration: os campos do
    // segundo cenário chegam ausentes. Mostra-se o primeiro cenário, nunca
    // quebra a página.
    const r = resolveLinhaRebate(entrada({ semRebate: null }));

    expect(r.motivo).toBe<MotivoSemRebate>("indisponivel");
    expect(r.semRebate).toBeNull();
    expect(r.comRebate).toEqual({ valor: 21.9, pct: 6.1 });
  });

  it("nenhum caminho de ausência devolve zero no lugar de nulo", () => {
    const ausencias: LinhaRebateInput[] = [
      entrada({ rebateEfeito: null, rebateBruto: null, semRebate: null, pedidosSemCaptura: 0, pedidosNaoConferidos: 0 }),
      entrada({ rebateEfeito: null, rebateBruto: null, semRebate: null, pedidosSemCaptura: 3, pedidosNaoConferidos: 0 }),
      entrada({ rebateEfeito: null, rebateBruto: null, semRebate: null, pedidosSemCaptura: 0, pedidosNaoConferidos: 1 }),
      entrada({ semRebate: null }),
      entrada({ rebateEfeito: 0, rebateBruto: 0, semRebate: { valor: 62.76, pct: 12.0 } }),
    ];

    for (const caso of ausencias) {
      const r = resolveLinhaRebate(caso);
      expect(r.motivo).not.toBe("ok");
      expect(r.semRebate).toBeNull();
      expect(r.semRebate).not.toBe(0);
    }
  });
});

describe("resolveLinhaRebate — zero é medição, ausência é lacuna: nunca um pelo outro", () => {
  it("compara os dois casos lado a lado e exige motivos diferentes", () => {
    const zeroMediado = resolveLinhaRebate(
      entrada({
        rebateEfeito: 0,
        rebateBruto: 0,
        semRebate: { valor: 62.76, pct: 12.0 },
        pedidosSemCaptura: 0,
        pedidosNaoConferidos: 0,
      }),
    );
    const naoCapturado = resolveLinhaRebate(
      entrada({ rebateEfeito: null, rebateBruto: null, semRebate: null, pedidosSemCaptura: 1, pedidosNaoConferidos: 0 }),
    );

    expect(zeroMediado.motivo).toBe("sem_campanha_no_periodo");
    expect(naoCapturado.motivo).toBe("nao_capturado");
    expect(zeroMediado.motivo).not.toBe(naoCapturado.motivo);
    // O zero medido preserva o segundo par NULO (é ausência de segundo
    // cenário por decisão de negócio, não zero exibido como número).
    expect(zeroMediado.semRebate).toBeNull();
    expect(naoCapturado.semRebate).toBeNull();
    // Mas o efeito em si é diferente: zero é conhecido, ausência não é.
    expect(zeroMediado.rebateEfeito).toBe(0);
    expect(naoCapturado.rebateEfeito).toBeNull();
  });
});

describe("resolveLinhaRebate — tolerância de entrada (strictNullChecks desligado)", () => {
  it("contagens ausentes viram zero, e ausência de contagem nunca inventa motivo", () => {
    const r = resolveLinhaRebate(entrada({ pedidosSemCaptura: null, pedidosNaoConferidos: null }));

    expect(r.pedidosSemCaptura).toBe(0);
    expect(r.pedidosNaoConferidos).toBe(0);
    expect(r.motivo).toBe("ok");
  });
});

describe("cenariosRebateMargemReal — projeção de linha de RPC, sem aritmética", () => {
  const linha: LinhaMargemComRebate = {
    lucro: 84.2,
    lucro_pct: 12.15,
    lucro_pos_ads: 60.1,
    lucro_pct_pos_ads: 8.7,
    lucro_sem_rebate: 33.49,
    lucro_pct_sem_rebate: 4.83,
    lucro_pos_ads_sem_rebate: 20.0,
    lucro_pct_pos_ads_sem_rebate: 2.9,
    rebate_efeito: 50.71,
    rebate_bruto: 55.0,
    pedidos_sem_captura_rebate: 0,
    pedidos_rebate_nao_conferido: 0,
  };

  it("modo preAds: os valores saem iguais aos campos de entrada, zero aritmética", () => {
    const r = cenariosRebateMargemReal(linha, "preAds");

    expect(r.comRebate).toEqual({ valor: 84.2, pct: 12.15 });
    expect(r.semRebate).toEqual({ valor: 33.49, pct: 4.83 });
    expect(r.rebateEfeito).toBe(50.71);
    expect(r.motivo).toBe("ok");
  });

  it("modo posAds: troca só o par de campos, mesma regra", () => {
    const r = cenariosRebateMargemReal(linha, "posAds");

    expect(r.comRebate).toEqual({ valor: 60.1, pct: 8.7 });
    expect(r.semRebate).toEqual({ valor: 20.0, pct: 2.9 });
  });

  it("linha ausente não quebra: motivo sai 'indisponivel'", () => {
    const r = cenariosRebateMargemReal(null, "preAds");

    expect(r.motivo).toBe("indisponivel");
    expect(r.semRebate).toBeNull();
  });

  // [223-06] Guarda de regressão: os nomes de campo de `LinhaMargemComRebate`
  // divergiam dos nomes reais da RPC (`pedidos_rebate_sem_captura` em vez de
  // `pedidos_sem_captura_rebate`, e a mesma inversão no outro campo) — as duas
  // contagens de lacuna caíam silenciosamente para zero em qualquer linha de
  // verdade, porque o campo lido nunca existia no objeto. Este teste propaga
  // um valor NÃO-zero pelas duas contagens para provar que o nome lido é o
  // nome escrito.
  it("propaga as duas contagens de lacuna sem perdê-las por nome de campo divergente", () => {
    const r = cenariosRebateMargemReal(
      { ...linha, pedidos_sem_captura_rebate: 4, pedidos_rebate_nao_conferido: 7 },
      "preAds",
    );

    expect(r.pedidosSemCaptura).toBe(4);
    expect(r.pedidosNaoConferidos).toBe(7);
  });
});
