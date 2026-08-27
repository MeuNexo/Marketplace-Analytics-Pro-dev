// ============================================================================
// 233-03 — A conta inversa do saldo declarado
//
// 🔴 O DEFEITO que estes testes travam, medido em 27/08/2026:
//
//   initial_balance (digitado) ...  R$ 46.000,00
//   + entradas de hoje ..........   R$ 14.790,16
//   − saídas de hoje ............   R$  9.485,54
//   = saldo exibido .............   R$ 51.304,62
//   saldo REAL (Wesley) .........   R$ 37.430,00
//
// A tela pede a PARCELA (`initial_balance`, o saldo ANTES dos movimentos do dia)
// e a chama de saldo. O Wesley digita o valor que quer ver, os movimentos entram
// por cima e movem o alvo — palavras dele: *"tenho que ficar inserindo valores e
// atualizando até o saldo do dia chegar no real que temos"*.
//
// 🔵 O TESTE QUE IMPORTA É O DE IDA E VOLTA. Ele prova a IDENTIDADE em vez de
// conferir um caso, e é o que impede alguém de "simplificar" a conta invertendo
// um sinal — o erro mais provável aqui, e o mais silencioso.
// ============================================================================
import { describe, expect, it } from "vitest";
import {
  initialBalanceParaSaldo,
  montarDeclaracao,
  podeDeclarar,
  saldoExibido,
} from "./saldoDeclarado";

describe("saldoExibido — a conta direta, a mesma do get_cashflow", () => {
  it("reproduz o que a tela exibiu em 27/08: 46.000 + 14.790,16 − 9.485,54", () => {
    expect(saldoExibido(46000, 14790.16, 9485.54)).toBe(51304.62);
  });

  it("dia sem movimento nenhum exibe o próprio saldo inicial", () => {
    expect(saldoExibido(37430, 0, 0)).toBe(37430);
  });
});

describe("initialBalanceParaSaldo — a inversa que resolve", () => {
  it("🔴 o caso REAL de 27/08: para exibir 37.430, grava 32.125,38", () => {
    expect(initialBalanceParaSaldo(37430, 14790.16, 9485.54)).toBe(32125.38);
  });

  it("sem movimentos, o que se grava é o próprio saldo desejado", () => {
    expect(initialBalanceParaSaldo(37430, 0, 0)).toBe(37430);
  });

  it("saída maior que entrada empurra o initial_balance para CIMA", () => {
    // desejado 1.000, entrou 100, saiu 400 → precisou partir de 1.300
    expect(initialBalanceParaSaldo(1000, 100, 400)).toBe(1300);
  });

  it("aceita saldo desejado negativo — caixa estourado é um estado real", () => {
    expect(initialBalanceParaSaldo(-500, 200, 100)).toBe(-600);
  });
});

describe("🔵 IDA E VOLTA — a identidade que trava o sinal invertido", () => {
  const casos: Array<[number, number, number]> = [
    [37430, 14790.16, 9485.54],   // o caso real de 27/08
    [0, 0, 0],
    [1, 0.01, 0.02],
    [-1234.56, 987.65, 4321.09],
    [51304.62, 0, 9485.54],
    [999999.99, 123456.78, 87654.32],
    [250.5, 250.5, 0],
    [10, 0, 1000000],
  ];

  it.each(casos)(
    "saldoExibido(initialBalanceParaSaldo(%s, %s, %s)) devolve o próprio saldo",
    (desejado, entradas, saidas) => {
      const ib = initialBalanceParaSaldo(desejado, entradas, saidas);
      expect(ib).not.toBeNull();
      expect(saldoExibido(ib as number, entradas, saidas)).toBe(desejado);
    },
  );

  it("a identidade vale para 500 trios pseudoaleatórios de duas casas", () => {
    // Gerador determinístico: um teste que muda de resultado a cada execução
    // não prova nada — ele só falha em dias diferentes.
    let seed = 20260827;
    const proximo = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return Math.round(((seed / 2147483648) * 200000 - 100000) * 100) / 100;
    };

    for (let i = 0; i < 500; i++) {
      const desejado = proximo();
      const entradas = Math.abs(proximo());
      const saidas = Math.abs(proximo());
      const ib = initialBalanceParaSaldo(desejado, entradas, saidas);
      expect(saldoExibido(ib as number, entradas, saidas)).toBe(desejado);
    }
  });
});

describe("🔴 entrada suja devolve null, NUNCA NaN", () => {
  // `NaN` gravado no `initial_balance` faz o saldo sumir da tela sem erro
  // nenhum — um estado PIOR que o defeito atual, porque é mudo.
  const sujas: unknown[] = [null, undefined, "", "  ", "abc", NaN, Infinity, -Infinity, {}, []];

  it.each(sujas.map((v) => [String(v === "" ? "(vazio)" : v), v] as [string, unknown]))(
    "initialBalanceParaSaldo rejeita %s no saldo desejado",
    (_rotulo, valor) => {
      expect(initialBalanceParaSaldo(valor, 100, 50)).toBeNull();
    },
  );

  it.each(sujas.map((v) => [String(v === "" ? "(vazio)" : v), v] as [string, unknown]))(
    "initialBalanceParaSaldo rejeita %s nas entradas",
    (_rotulo, valor) => {
      expect(initialBalanceParaSaldo(1000, valor, 50)).toBeNull();
    },
  );

  it.each(sujas.map((v) => [String(v === "" ? "(vazio)" : v), v] as [string, unknown]))(
    "initialBalanceParaSaldo rejeita %s nas saídas",
    (_rotulo, valor) => {
      expect(initialBalanceParaSaldo(1000, 100, valor)).toBeNull();
    },
  );

  it("saldoExibido segue a mesma régua", () => {
    expect(saldoExibido(NaN, 100, 50)).toBeNull();
    expect(saldoExibido(1000, null, 50)).toBeNull();
    expect(saldoExibido(1000, 100, "x")).toBeNull();
  });

  it("nunca devolve NaN — o valor de retorno é número finito ou null", () => {
    for (const v of sujas) {
      const r = initialBalanceParaSaldo(v, v, v);
      expect(r === null || Number.isFinite(r)).toBe(true);
      expect(Number.isNaN(r as number)).toBe(false);
    }
  });

  it("string numérica com vírgula decimal é aceita — é como o campo devolve", () => {
    expect(initialBalanceParaSaldo("37430", "14790,16", "9485,54")).toBe(32125.38);
  });
});

describe("arredondamento acontece UMA vez, na saída", () => {
  it("não arredonda as parcelas antes de somar", () => {
    // 0,004 + 0,004 + 0,004 = 0,012 → 0,01. Arredondar cada parcela daria 0,00.
    expect(initialBalanceParaSaldo(0.008, 0, 0.004)).toBe(0.01);
  });

  it("a saída tem no máximo duas casas", () => {
    const r = initialBalanceParaSaldo(1 / 3, 1 / 7, 1 / 11) as number;
    expect(r).toBe(Math.round(r * 100) / 100);
  });
});

describe("🔴 podeDeclarar — o bloqueio quando os movimentos não carregaram", () => {
  it("bloqueia enquanto está carregando", () => {
    const v = podeDeclarar({ saldoInicial: 46000, entradas: 0, saidas: 0 }, true);
    expect(v.pode).toBe(false);
    expect(v.motivo).toMatch(/carregando/i);
  });

  it("bloqueia quando os movimentos são nulos", () => {
    expect(podeDeclarar(null).pode).toBe(false);
    expect(podeDeclarar(undefined).pode).toBe(false);
  });

  it("bloqueia quando entradas ou saídas são ausentes — nunca trata como zero", () => {
    expect(podeDeclarar({ saldoInicial: 46000, entradas: null, saidas: 100 }).pode).toBe(false);
    expect(podeDeclarar({ saldoInicial: 46000, entradas: 100, saidas: undefined }).pode).toBe(false);
    expect(podeDeclarar({ saldoInicial: 46000, entradas: NaN, saidas: 100 }).pode).toBe(false);
  });

  it("ZERO LEGÍTIMO passa — dia sem movimento é um dia válido", () => {
    const v = podeDeclarar({ saldoInicial: 46000, entradas: 0, saidas: 0 });
    expect(v).toEqual({ pode: true, motivo: null });
  });
});

describe("montarDeclaracao — o par (gravar, declarar)", () => {
  const ORG = "7f615df7-7bac-45e5-8a93-827fb9ddeec7";
  const MOV = { saldoInicial: 46000, entradas: 14790.16, saidas: 9485.54 };

  it("🔴 reproduz 27/08 inteiro: grava 32.125,38 e declara o estado ANTERIOR", () => {
    const r = montarDeclaracao(ORG, "2026-08-27", 37430, MOV);
    expect(r).not.toBeNull();
    expect(r!.initialBalanceAGravar).toBe(32125.38);
    expect(r!.declaracao).toEqual({
      organization_id: ORG,
      data_declarada: "2026-08-27",
      saldo_real: 37430,
      saldo_exibido: 51304.62,   // o que a tela mostrava ANTES
      initial_balance: 46000,    // o que vigorava ANTES
      entradas_do_dia: 14790.16,
      saidas_do_dia: 9485.54,
    });
  });

  it("o erro do dia zero fica medido na linha: exibido − real = 13.874,62", () => {
    const r = montarDeclaracao(ORG, "2026-08-27", 37430, MOV)!;
    expect(r.declaracao.saldo_exibido! - r.declaracao.saldo_real).toBeCloseTo(13874.62, 2);
  });

  it("gravar o initial_balance devolvido faz a tela exibir o valor digitado", () => {
    const r = montarDeclaracao(ORG, "2026-08-27", 37430, MOV)!;
    expect(saldoExibido(r.initialBalanceAGravar, MOV.entradas, MOV.saidas)).toBe(37430);
  });

  it("devolve null sem org, sem data, com valor sujo ou com movimentos ausentes", () => {
    expect(montarDeclaracao(null, "2026-08-27", 37430, MOV)).toBeNull();
    expect(montarDeclaracao(ORG, null, 37430, MOV)).toBeNull();
    expect(montarDeclaracao(ORG, "2026-08-27", "", MOV)).toBeNull();
    expect(montarDeclaracao(ORG, "2026-08-27", 37430, null)).toBeNull();
    expect(
      montarDeclaracao(ORG, "2026-08-27", 37430, { saldoInicial: 1, entradas: null, saidas: 2 }),
    ).toBeNull();
  });

  it("saldo inicial ausente não impede a declaração — vira null, nunca zero", () => {
    const r = montarDeclaracao(ORG, "2026-08-27", 37430, {
      saldoInicial: null, entradas: 14790.16, saidas: 9485.54,
    })!;
    expect(r.declaracao.saldo_exibido).toBeNull();
    expect(r.declaracao.initial_balance).toBeNull();
    expect(r.initialBalanceAGravar).toBe(32125.38);
  });
});
