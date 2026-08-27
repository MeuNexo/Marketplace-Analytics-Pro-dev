// ============================================================================
// 233-05 — Testes do saldo DECLARADO, agora contra a quantidade CERTA
//
// 🔴 POR QUE ESTE ARQUIVO FOI REESCRITO. A versão do 233-03 tinha 59 testes
// verdes — inclusive 500 trios pseudoaleatórios provando uma identidade de ida e
// volta — e o código que ela protegia estava ERRADO. A identidade
// `saldoExibido(inversa(X, e, s), e, s) === X` é matematicamente correta e não
// diz nada sobre o assunto: ela foi feita contra `entradas_hoje`/`saidas_hoje`,
// e o número que a tela de fluxo de caixa exibe não é feito dessas parcelas. Ele
// é o saldo da ÂNCORA (`balance_anchor_date = 2026-07-13`, 45 dias atrás) rolado
// por todo o movimento do intervalo.
//
// O defeito não apareceu em teste nenhum. Apareceu porque o Wesley digitou
// 37.430 e leu 29.301,42 na tela.
//
// 🔵 A CORREÇÃO CERTA NÃO É INVERTER CONTA NENHUMA — é MOVER A ÂNCORA para hoje,
// que é literalmente para isso que `balance_anchor_date` existe. Com a âncora em
// hoje o intervalo semiaberto `[âncora, hoje)` é vazio e
// `get_rolled_opening_balance` devolve o declarado ao centavo.
//
// 🔴 A REGRA QUE ESTE ARQUIVO PASSA A OBEDECER: um teste que só prova aritmética
// não protege nada. O teste central daqui é o de INSENSIBILIDADE — o valor
// declarado NÃO pode se mexer quando entradas e saídas mudam. É o único formato
// de teste que teria reprovado o 233-03.
// ============================================================================
import { describe, expect, it } from "vitest";
import {
  montarDeclaracao,
  numeroOuNulo,
  podeDeclarar,
  saldoExibido,
  type MovimentosDoDia,
} from "./saldoDeclarado";

const ORG = "7f615df7-7bac-45e5-8a93-827fb9ddeec7";
const HOJE = "2026-08-27";

// ---------------------------------------------------------------------------
// O que a tela mostra — a decomposição honesta, agora sobre a ABERTURA ROLADA
// ---------------------------------------------------------------------------

describe("saldoExibido — abertura + entradas − saídas", () => {
  it("🔴 o primeiro argumento é a ABERTURA ROLADA, não o campo cru", () => {
    // 27/08/2026 na Pé Vermeio: a abertura rolada era 29.301,42 (e NÃO os
    // 37.430,00 do campo cru, que é o saldo de 13/07). Depois da migration
    // 20260827190000, `get_daily_balance.saldo_inicial` devolve a rolada.
    expect(saldoExibido(29301.42, 14790.16, 9485.54)).toBe(34606.04);
  });

  it("dia sem movimento nenhum exibe a própria abertura", () => {
    expect(saldoExibido(29301.42, 0, 0)).toBe(29301.42);
  });

  it("arredonda UMA vez, na saída — não arredonda as parcelas antes de somar", () => {
    expect(saldoExibido(0.005, 0.005, 0)).toBe(0.01);
  });
});

// ---------------------------------------------------------------------------
// 🔴 O TESTE QUE TERIA PEGADO O 233-03
// ---------------------------------------------------------------------------

describe("🔴 INSENSIBILIDADE — declarar é ancorar, não inverter", () => {
  const mov = (e: number, s: number, ab: number = 29301.42): MovimentosDoDia => ({
    saldoInicial: ab,
    entradas: e,
    saidas: s,
  });

  it("o valor digitado atravessa INTACTO para a âncora", () => {
    const r = montarDeclaracao(ORG, HOJE, 37430, mov(14790.16, 9485.54));
    expect(r?.saldoParaAncora).toBe(37430);
  });

  it("🔴 o mesmo número digitado com movimentos DIFERENTES ancora igual", () => {
    // Este é o teste. A versão do 233-03 devolveria 32.125,38 no primeiro caso e
    // 37.430 no segundo — e foi essa dependência do movimento do dia que fez a
    // correção não funcionar contra o número que a tela realmente exibe.
    const a = montarDeclaracao(ORG, HOJE, 37430, mov(14790.16, 9485.54));
    const b = montarDeclaracao(ORG, HOJE, 37430, mov(0, 0));
    const c = montarDeclaracao(ORG, HOJE, 37430, mov(999999.99, 123456.78));

    expect(a?.saldoParaAncora).toBe(37430);
    expect(b?.saldoParaAncora).toBe(37430);
    expect(c?.saldoParaAncora).toBe(37430);
    expect(a?.saldoParaAncora).toBe(c?.saldoParaAncora);
  });

  it("a âncora também não se move quando a ABERTURA anterior muda", () => {
    const a = montarDeclaracao(ORG, HOJE, 37430, mov(14790.16, 9485.54, 29301.42));
    const b = montarDeclaracao(ORG, HOJE, 37430, mov(14790.16, 9485.54, 46000));
    expect(a?.saldoParaAncora).toBe(b?.saldoParaAncora);
  });

  it("saldo declarado negativo atravessa igual — caixa estourado é estado real", () => {
    const r = montarDeclaracao(ORG, HOJE, -1234.56, mov(500, 700));
    expect(r?.saldoParaAncora).toBe(-1234.56);
  });

  it("arredonda a duas casas na saída, sem viés de sinal", () => {
    expect(montarDeclaracao(ORG, HOJE, 1.005, mov(0, 0))?.saldoParaAncora).toBe(1.01);
    expect(montarDeclaracao(ORG, HOJE, -1.005, mov(0, 0))?.saldoParaAncora).toBe(-1.01);
  });

  it("🔴 o módulo NÃO exporta mais nenhuma inversa contra os movimentos do dia", async () => {
    // Código obsoleto que compila é a próxima pessoa usando de novo. A inversa
    // saiu do arquivo, não ficou marcada como depreciada.
    const mod = await import("./saldoDeclarado");
    const nomes = Object.keys(mod);
    expect(nomes.filter((n) => /initialBalance/i.test(n))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// O retrato do erro do dia zero
// ---------------------------------------------------------------------------

describe("montarDeclaracao — o retrato ANTERIOR à correção", () => {
  const movHoje: MovimentosDoDia = {
    saldoInicial: 29301.42, // a abertura ROLADA que a tela exibia
    entradas: 14790.16,
    saidas: 9485.54,
  };

  it("`saldo_exibido` é o que a tela mostrava ANTES — abertura rolada + movimentos", () => {
    const r = montarDeclaracao(ORG, HOJE, 37430, movHoje);
    expect(r?.declaracao.saldo_exibido).toBe(34606.04);
    expect(r?.declaracao.initial_balance).toBe(29301.42);
    expect(r?.declaracao.entradas_do_dia).toBe(14790.16);
    expect(r?.declaracao.saidas_do_dia).toBe(9485.54);
  });

  it("o erro do dia zero fica medido na linha: exibido − real", () => {
    const r = montarDeclaracao(ORG, HOJE, 37430, movHoje)!;
    const erro = r.declaracao.saldo_exibido! - r.declaracao.saldo_real;
    expect(Number(erro.toFixed(2))).toBe(-2823.96);
  });

  it("carrega organization_id e data_declarada explícitos (T-224-07-01)", () => {
    const r = montarDeclaracao(ORG, HOJE, 37430, movHoje);
    expect(r?.declaracao.organization_id).toBe(ORG);
    expect(r?.declaracao.data_declarada).toBe(HOJE);
  });

  it("devolve null sem org, sem data, com valor sujo ou com movimentos ausentes", () => {
    expect(montarDeclaracao("", HOJE, 37430, movHoje)).toBeNull();
    expect(montarDeclaracao(ORG, "", 37430, movHoje)).toBeNull();
    expect(montarDeclaracao(ORG, HOJE, "abc", movHoje)).toBeNull();
    expect(montarDeclaracao(ORG, HOJE, 37430, null)).toBeNull();
    expect(
      montarDeclaracao(ORG, HOJE, 37430, { saldoInicial: 1, entradas: null, saidas: 2 }),
    ).toBeNull();
  });

  it("abertura anterior ausente não impede a declaração — vira null, nunca zero", () => {
    const r = montarDeclaracao(ORG, HOJE, 37430, {
      saldoInicial: null,
      entradas: 10,
      saidas: 5,
    });
    expect(r?.saldoParaAncora).toBe(37430);
    expect(r?.declaracao.saldo_exibido).toBeNull();
    expect(r?.declaracao.initial_balance).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// O bloqueio, preservado sem mexer (233-03)
// ---------------------------------------------------------------------------

describe("🔴 podeDeclarar — o bloqueio quando os movimentos não carregaram", () => {
  it("bloqueia enquanto está carregando", () => {
    expect(podeDeclarar({ saldoInicial: 1, entradas: 2, saidas: 3 }, true).pode).toBe(false);
  });

  it("bloqueia quando os movimentos são nulos", () => {
    expect(podeDeclarar(null).pode).toBe(false);
    expect(podeDeclarar(undefined).motivo).toBeTruthy();
  });

  it("bloqueia quando entradas ou saídas são ausentes — nunca trata como zero", () => {
    expect(podeDeclarar({ saldoInicial: 1, entradas: null, saidas: 3 }).pode).toBe(false);
    expect(podeDeclarar({ saldoInicial: 1, entradas: 2, saidas: undefined }).pode).toBe(false);
  });

  it("ZERO LEGÍTIMO passa — dia sem movimento é um dia válido", () => {
    const v = podeDeclarar({ saldoInicial: 0, entradas: 0, saidas: 0 });
    expect(v.pode).toBe(true);
    expect(v.motivo).toBeNull();
  });

  it("🔵 o bloqueio existe pelo `saldo_exibido`, não mais pela inversa", () => {
    // Depois do 233-05 a âncora não depende dos movimentos. O que ainda depende
    // é o RETRATO do erro do dia zero: sem entradas e saídas não há
    // `saldo_exibido` para registrar, e a linha nasceria sem o que ela mede.
    expect(podeDeclarar({ saldoInicial: 29301.42, entradas: 0, saidas: 0 }).pode).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Entrada suja — preservado sem mexer (233-03)
// ---------------------------------------------------------------------------

describe("🔴 entrada suja devolve null, NUNCA NaN", () => {
  const sujos: unknown[] = ["", "  ", "abc", "R$ 1.000", {}, [], true, NaN, Infinity, null, undefined];

  it("numeroOuNulo rejeita tudo que não é número finito", () => {
    for (const v of sujos) expect(numeroOuNulo(v)).toBeNull();
  });

  it("montarDeclaracao nunca produz NaN — devolve null e o chamador não grava", () => {
    for (const v of sujos) {
      const r = montarDeclaracao(ORG, HOJE, v, { saldoInicial: 1, entradas: 2, saidas: 3 });
      expect(r === null || Number.isFinite(r.saldoParaAncora)).toBe(true);
    }
  });

  it("string numérica com vírgula decimal é aceita — é como o campo devolve", () => {
    expect(numeroOuNulo("37430,55")).toBe(37430.55);
    expect(
      montarDeclaracao(ORG, HOJE, "37430,55", { saldoInicial: 1, entradas: 2, saidas: 3 })
        ?.saldoParaAncora,
    ).toBe(37430.55);
  });
});
