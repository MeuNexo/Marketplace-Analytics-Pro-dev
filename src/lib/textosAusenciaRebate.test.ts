/**
 * Os textos de ausência dizem o MOTIVO REAL — nunca uma confissão vaga.
 *
 * Decisão do Wesley em 21/08, com a tela publicada na frente: "o sistema não
 * pode dizer 'não sei' nem 'erro nosso'; ele tem que saber o que está
 * mostrando". Medido nos 30 dias anteriores (Pé Vermeio, 1.270 pedidos,
 * 1.240 capturados = 97,6%): ZERO ocorrências de conferência que não fecha, e
 * os 17 pedidos "não capturados" eram TODOS do próprio dia — o Mercado Livre
 * fatura com alguns dias de atraso. O estado sempre foi conhecido; o texto é
 * que não dizia.
 *
 * 🔴 O que NÃO muda: os estados internos continuam distintos
 * (`data-selo-promo` preserva os sete). O que muda é o que a tela mostra e
 * quais estados desaparecem dela. Nenhum número muda.
 */

import { describe, expect, it } from "vitest";
import { resolveSeloPromo } from "./seloPromo";
import { FRASE_REBATE_PARCIAL, fraseMotivoSemRebate } from "./rebateLinhaCenarios";

const VOCABULARIO_PROIBIDO = /erro nosso|não sei|nao sei/i;

describe("textos de ausência do rebate (Quick 260821-qps)", () => {
  it("'erro nosso' saiu do vocabulário de TODAS as frases de motivo", () => {
    const frases = [
      fraseMotivoSemRebate("sem_campanha_no_periodo"),
      fraseMotivoSemRebate("nao_capturado", 3),
      fraseMotivoSemRebate("conferencia_nao_fecha", 0, 2),
      fraseMotivoSemRebate("indisponivel"),
      FRASE_REBATE_PARCIAL(3, 0),
      FRASE_REBATE_PARCIAL(0, 2),
      FRASE_REBATE_PARCIAL(3, 2),
    ];

    for (const frase of frases) {
      if (frase === null) continue;
      expect(frase).not.toMatch(VOCABULARIO_PROIBIDO);
    }
  });

  it("pedido ainda não faturado diz o motivo REAL — o atraso da fatura do ML —, não 'não sei'", () => {
    const frase = fraseMotivoSemRebate("nao_capturado", 17)!;

    expect(frase).toMatch(/fatura/i);
    expect(frase).toMatch(/Mercado Livre/);
    expect(frase).toContain("17");
    expect(frase).not.toMatch(VOCABULARIO_PROIBIDO);
  });

  it("conferência pendente vira fato do processo, sem confessar defeito na tela onde se decide preço", () => {
    const frase = fraseMotivoSemRebate("conferencia_nao_fecha", 0, 2)!;

    expect(frase).toContain("2");
    expect(frase).not.toMatch(VOCABULARIO_PROIBIDO);
    // Continua sem culpar o ML — a causa segue nomeada como nossa conciliação.
    expect(frase).not.toMatch(/Mercado Livre errou|culpa do ML/i);
  });

  it("selo: 'sem venda 7d' vira CÉLULA VAZIA — não é lacuna nem erro, é um anúncio que não vendeu", () => {
    const selo = resolveSeloPromo({
      comissao: 0,
      rebateBruto: null,
      semVendaNaJanela: true,
      mediaPeriodoPct: 19.2,
    });

    expect(selo.estado).toBe("sem_venda_recente"); // estado preservado por dentro
    expect(selo.texto).toBe("");
  });

  it("selo: os três estados de ausência mostram o traço discreto, e a causa vive no tooltip", () => {
    const naoCapturado = resolveSeloPromo({
      comissao: 100,
      rebateBruto: null,
      pedidosSemCaptura: 4,
      pedidosNaoConferidos: 0,
      semVendaNaJanela: false,
    });
    const naoConferido = resolveSeloPromo({
      comissao: 100,
      rebateBruto: null,
      pedidosSemCaptura: 0,
      pedidosNaoConferidos: 3,
      semVendaNaJanela: false,
    });
    const indisponivel = resolveSeloPromo({
      comissao: 100,
      rebateBruto: null,
      semVendaNaJanela: false,
    });

    // Estados distintos por dentro — a distinção NÃO foi colapsada.
    expect(naoCapturado.estado).toBe("nao_capturado");
    expect(naoConferido.estado).toBe("conferencia_nao_fecha");
    expect(indisponivel.estado).toBe("indisponivel");

    for (const selo of [naoCapturado, naoConferido, indisponivel]) {
      expect(selo.texto).toBe("—");
      expect(selo.texto).not.toMatch(VOCABULARIO_PROIBIDO);
      expect(selo.titulo).not.toMatch(VOCABULARIO_PROIBIDO);
    }

    // E o tooltip do não capturado continua dizendo o motivo real.
    expect(naoCapturado.titulo).toMatch(/fatura/i);
  });
});
