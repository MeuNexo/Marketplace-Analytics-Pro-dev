/**
 * Testes de `resolveLinhaCenarios` — o seletor por LINHA dos dois cenários de
 * MCO (Fase 222, plano 222-15-R2).
 *
 * O que estes testes existem para impedir: uma tela exibir ZERO onde não há
 * segundo cenário. Zero é um número; ausência não é. Um MCO "com DIFAL" igual
 * ao "sem DIFAL", sem nenhuma palavra explicando por quê, é indistinguível de
 * um DIFAL que não carregou — e a Fase 220 já provou que régua fiscal errada
 * não grita: ela serve um número plausível.
 *
 * Existe um teste por valor de `motivo`, cada um provando que o segundo número
 * sai NULO e não zerado.
 */
import { describe, it, expect } from "vitest";
import {
  resolveLinhaCenarios,
  type LinhaCenariosInput,
  type MotivoSemDifal,
} from "./mcoLinhaCenarios";
import { DIFAL_ESTIMATIVA_LABEL } from "./mcoCenarios";

/** Entrada mínima saudável — cada teste muda só o que quer provar. */
function entrada(over: Partial<LinhaCenariosInput> = {}): LinhaCenariosInput {
  return {
    semDifal: { valor: 84.2, pct: 12.15 },
    comDifal: { valor: 33.49, pct: 4.83 },
    difalEfeito: 50.71,
    pedidosDifalIndefinido: 0,
    temOperacaoInterestadual: true,
    regimeAplicaDifal: true,
    ...over,
  };
}

describe("resolveLinhaCenarios — caminho feliz", () => {
  it("devolve os dois cenários e motivo 'ok' quando o DIFAL foi apurado", () => {
    const r = resolveLinhaCenarios(entrada());

    expect(r.motivo).toBe<MotivoSemDifal>("ok");
    expect(r.semDifal).toEqual({ valor: 84.2, pct: 12.15 });
    expect(r.comDifal).toEqual({ valor: 33.49, pct: 4.83 });
    expect(r.difalEfeito).toBe(50.71);
  });

  it("não recalcula MCO nenhum: devolve exatamente os pares que recebeu", () => {
    // A régua é de quem apurou (o banco, nas telas de margem real; o módulo de
    // MCO, na Análise de Preços). Este seletor só ESCOLHE o que exibir.
    const semDifal = { valor: -12.5, pct: -3.1 };
    const comDifal = { valor: -40.2, pct: -10.4 };
    const r = resolveLinhaCenarios(entrada({ semDifal, comDifal }));

    expect(r.semDifal).toBe(semDifal);
    expect(r.comDifal).toBe(comDifal);
  });

  it("percentual nulo (receita zero no recorte) atravessa como nulo, não como zero", () => {
    const r = resolveLinhaCenarios(
      entrada({ semDifal: { valor: 0, pct: null }, comDifal: { valor: 0, pct: null } }),
    );

    expect(r.motivo).toBe("ok");
    expect(r.semDifal.pct).toBeNull();
    expect(r.comDifal?.pct).toBeNull();
  });
});

describe("resolveLinhaCenarios — os dois cenários coincidem por RESULTADO", () => {
  it("efeito zero COM operação interestadual é 'ok': é resultado apurado, não ausência", () => {
    const r = resolveLinhaCenarios(
      entrada({
        difalEfeito: 0,
        comDifal: { valor: 84.2, pct: 12.15 },
        temOperacaoInterestadual: true,
      }),
    );

    expect(r.motivo).toBe("ok");
    expect(r.comDifal).not.toBeNull();
    expect(r.comDifal!.valor).toBe(84.2);
    // O efeito zero fica declarado, para a tela poder dizer em palavras por que
    // os dois números são iguais — dois números iguais mudos são proibidos.
    expect(r.difalEfeito).toBe(0);
    expect(r.efeitoNulo).toBe(true);
  });
});

describe("resolveLinhaCenarios — um teste por motivo de ausência", () => {
  it("'sem_operacao_interestadual': efeito zero e nenhuma venda para fora do estado", () => {
    const r = resolveLinhaCenarios(
      entrada({ difalEfeito: 0, temOperacaoInterestadual: false, comDifal: { valor: 84.2, pct: 12.15 } }),
    );

    expect(r.motivo).toBe<MotivoSemDifal>("sem_operacao_interestadual");
    expect(r.comDifal).toBeNull();
    expect(r.comDifal).not.toEqual({ valor: 0, pct: 0 });
  });

  it("'regime_nao_aplicavel': loja no Simples Nacional não tem DIFAL a estimar", () => {
    const r = resolveLinhaCenarios(entrada({ regimeAplicaDifal: false }));

    expect(r.motivo).toBe<MotivoSemDifal>("regime_nao_aplicavel");
    expect(r.comDifal).toBeNull();
  });

  it("'regime_nao_aplicavel' vence até quando há efeito apurado na linha", () => {
    // Uma linha do Simples nunca deveria trazer efeito; se trouxer, o regime
    // manda — exibir o número seria afirmar um imposto que a loja não paga.
    const r = resolveLinhaCenarios(entrada({ regimeAplicaDifal: false, difalEfeito: 99 }));

    expect(r.motivo).toBe("regime_nao_aplicavel");
    expect(r.comDifal).toBeNull();
  });

  it("'uf_nao_confirmada': efeito NULO com pedidos interestaduais fora da conta", () => {
    const r = resolveLinhaCenarios(
      entrada({ difalEfeito: null, pedidosDifalIndefinido: 7, comDifal: null }),
    );

    expect(r.motivo).toBe<MotivoSemDifal>("uf_nao_confirmada");
    expect(r.comDifal).toBeNull();
    // A contagem sai junto: é ela que torna a lacuna visível na tela.
    expect(r.pedidosDifalIndefinido).toBe(7);
  });

  it("'indisponivel': efeito NULO e nenhuma contagem — o dado não carregou", () => {
    const r = resolveLinhaCenarios(
      entrada({ difalEfeito: null, pedidosDifalIndefinido: 0, comDifal: null }),
    );

    expect(r.motivo).toBe<MotivoSemDifal>("indisponivel");
    expect(r.comDifal).toBeNull();
    expect(r.difalEfeito).toBeNull();
  });

  it("'indisponivel' também quando o efeito veio mas o segundo cenário não foi apurado", () => {
    // Acontece durante a janela de publicação: a RPC nova ainda não está no
    // banco, então os campos do segundo cenário chegam ausentes. A tela mostra
    // o primeiro cenário e diz que o segundo não carregou — nunca quebra e
    // nunca exibe zero.
    const r = resolveLinhaCenarios(entrada({ comDifal: null }));

    expect(r.motivo).toBe("indisponivel");
    expect(r.comDifal).toBeNull();
  });

  it("nenhum caminho de ausência devolve zero no lugar de nulo", () => {
    const ausencias: LinhaCenariosInput[] = [
      entrada({ regimeAplicaDifal: false }),
      entrada({ difalEfeito: null, pedidosDifalIndefinido: 3, comDifal: null }),
      entrada({ difalEfeito: null, pedidosDifalIndefinido: 0, comDifal: null }),
      entrada({ difalEfeito: 0, temOperacaoInterestadual: false }),
      entrada({ comDifal: undefined }),
    ];

    for (const caso of ausencias) {
      const r = resolveLinhaCenarios(caso);
      expect(r.motivo).not.toBe("ok");
      expect(r.comDifal).toBeNull();
      expect(r.comDifal).not.toBe(0);
    }
  });
});

describe("resolveLinhaCenarios — tolerância de entrada (strictNullChecks desligado)", () => {
  it("contagem ausente vira zero, e ausência de contagem nunca inventa motivo", () => {
    const r = resolveLinhaCenarios(entrada({ pedidosDifalIndefinido: null }));

    expect(r.pedidosDifalIndefinido).toBe(0);
    expect(r.motivo).toBe("ok");
  });

  it("pedidos indefinidos convivem com um segundo cenário legítimo", () => {
    // Efeito apurado sobre os pedidos que TÊM alíquota, mais uma contagem de
    // pedidos que ficaram de fora: o número existe e a lacuna também.
    const r = resolveLinhaCenarios(entrada({ pedidosDifalIndefinido: 4 }));

    expect(r.motivo).toBe("ok");
    expect(r.comDifal).not.toBeNull();
    expect(r.pedidosDifalIndefinido).toBe(4);
  });

  it("regime desconhecido não bloqueia o segundo cenário", () => {
    // A maioria dos chamadores não sabe o regime linha a linha. Ausência de
    // informação não pode virar afirmação de que o regime não se aplica.
    const r = resolveLinhaCenarios(entrada({ regimeAplicaDifal: undefined }));

    expect(r.motivo).toBe("ok");
  });

  it("efeito zero com operação interestadual DESCONHECIDA continua 'ok'", () => {
    // Não sabemos que não houve venda para fora do estado — afirmar isso seria
    // inventar. Fica 'ok' com o efeito nulo declarado, e a tela explica.
    const r = resolveLinhaCenarios(
      entrada({ difalEfeito: 0, temOperacaoInterestadual: undefined, comDifal: { valor: 84.2, pct: 12.15 } }),
    );

    expect(r.motivo).toBe("ok");
    expect(r.efeitoNulo).toBe(true);
  });
});

describe("resolveLinhaCenarios — fronteiras do módulo", () => {
  it("a ressalva de estimativa continua vindo da constante compartilhada", () => {
    // Este módulo não redeclara o texto (D-12): duas telas divergirem no que
    // afirmam sobre a mesma régua é o começo de um número sem dono.
    expect(DIFAL_ESTIMATIVA_LABEL).toBe("estimativa");
  });
});
