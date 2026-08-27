// ============================================================================
// 233-06 — Testes do saldo declarado, agora contra a quantidade CERTA CERTA
//
// 🔴 POR QUE ESTE ARQUIVO FOI REESCRITO DE NOVO, e o motivo é diferente do
// anterior. O 233-05 escreveu estes testes sob o **D-07**: o valor digitado era
// a ABERTURA do dia e atravessava intacto para a âncora. O Wesley derrubou o
// D-07 no mesmo dia (**D-10**): *"hoje o saldo já considerando a liberação já é
// o que passei, 37430"*. Ele declara olhando o EXTRATO — o número já inclui
// tudo que liquidou até aquela hora.
//
// O estrago do D-07, medido em produção: gravado como abertura, o sistema somou
// o dia por cima e contou **R$ 13.157,27 duas vezes** (fechamento previsto
// R$ 42.457,04 contra os R$ 38.785,31 corretos).
//
// 🔵 A INVERSA VOLTA — mas contra a quantidade certa. O 233-03 inverteu contra
// `entradas_hoje`/`saidas_hoje` INTEIRAS e errou; o certo é só a parte **já
// liquidada** (`approved` + `refunded` nas entradas, `paid` nas saídas):
//
//     abertura = declarado − entradas_liquidadas + saidas_pagas
//
// 🔴 A REGRA QUE ESTE ARQUIVO OBEDECE, e ela MUDOU DE ALVO: o 233-05 media
// INSENSIBILIDADE a tudo. Agora a insensibilidade é **ao NÃO-liquidado** (o
// `in_mediation` e a saída cancelada não movem a âncora) e existe uma
// SENSIBILIDADE DIRIGIDA ao liquidado (Δ move a âncora em exatamente −Δ). É esse
// trio que reprova as DUAS regressões opostas — usar o total de novo, ou parar
// de descontar o liquidado. Forma sozinha não basta: o 233-03 teve 59 testes
// verdes provando aritmética correta sobre a variável errada.
// ============================================================================
import { describe, expect, it } from "vitest";
import {
  aberturaAncorada,
  montarDeclaracao,
  numeroOuNulo,
  podeDeclarar,
  saldoExibido,
  type MovimentosDoDia,
} from "./saldoDeclarado";

const ORG = "7f615df7-7bac-45e5-8a93-827fb9ddeec7";
const HOJE = "2026-08-27";

/**
 * Os movimentos de 27/08/2026 na Pé Vermeio, medidos em produção.
 *
 * ⚠️ Estes números são CENÁRIO, não critério. Entre planejar e executar o
 * 233-05, `entradas_hoje` caiu de 14.790,16 para 14.512,58 porque o MP remanejou
 * release no meio do dia (M-07). Toda prova aqui é contra a INVARIANTE.
 */
function mov(over: Partial<MovimentosDoDia> = {}): MovimentosDoDia {
  return {
    saldoInicial: 33758.27, // a abertura
    entradas: 14512.58, // o TOTAL do dia
    saidas: 9485.54,
    entradasLiquidadas: 13157.27, // approved + refunded
    saidasPagas: 9485.54, // paid
    entradasPendentes: 1355.31, // in_mediation — ainda pode entrar
    saidasCanceladas: 0, // cancelled — não vai sair nunca
    saldoAgora: 37430, // vem do BANCO, não é composto aqui
    ...over,
  };
}

// ---------------------------------------------------------------------------
// A decomposição do dia — inalterada
// ---------------------------------------------------------------------------

describe("saldoExibido — abertura + entradas − saídas", () => {
  it("🔴 o primeiro argumento é a ABERTURA ROLADA, não o campo cru", () => {
    expect(saldoExibido(33758.27, 14512.58, 9485.54)).toBe(38785.31);
  });

  it("dia sem movimento nenhum exibe a própria abertura", () => {
    expect(saldoExibido(33758.27, 0, 0)).toBe(33758.27);
  });

  it("arredonda UMA vez, na saída — não arredonda as parcelas antes de somar", () => {
    expect(saldoExibido(0.005, 0.005, 0)).toBe(0.01);
  });
});

// ---------------------------------------------------------------------------
// 🔴 O TRIO DE SENSIBILIDADE DIRIGIDA — o único formato que reprova as duas
//    regressões opostas
// ---------------------------------------------------------------------------

describe("🔴 aberturaAncorada — a inversa contra o LIQUIDADO, e só ele", () => {
  it("a identidade do D-10, fechada em produção: 37.430 − 13.157,27 + 9.485,54 = 33.758,27", () => {
    expect(aberturaAncorada(37430, mov())).toBe(33758.27);
  });

  it("🔴 (i) INSENSIBILIDADE ao pendente — mexer no `in_mediation` NÃO move a âncora", () => {
    // O que ainda está em mediação NÃO entrou no extrato, então não está dentro
    // do número que o Wesley digitou. Se ele passar a mover a âncora, a inversa
    // voltou a usar o total do dia — o defeito do 233-03.
    const a = aberturaAncorada(37430, mov({ entradasPendentes: 1355.31 }));
    const b = aberturaAncorada(37430, mov({ entradasPendentes: 0 }));
    const c = aberturaAncorada(37430, mov({ entradasPendentes: 999999.99 }));
    expect(a).toBe(33758.27);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("🔴 (ii) INSENSIBILIDADE à saída cancelada — cancelada não saiu do caixa (D-12)", () => {
    const a = aberturaAncorada(37430, mov({ saidasCanceladas: 0 }));
    const b = aberturaAncorada(37430, mov({ saidasCanceladas: 8030.12 }));
    expect(b).toBe(a);
  });

  it("🔴 (ii-b) INSENSIBILIDADE aos TOTAIS do dia — é a regressão do 233-03 por nome", () => {
    const a = aberturaAncorada(37430, mov({ entradas: 14512.58, saidas: 9485.54 }));
    const b = aberturaAncorada(37430, mov({ entradas: 0, saidas: 0 }));
    const c = aberturaAncorada(37430, mov({ entradas: 999999.99, saidas: 123456.78 }));
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("🔴 (iii) SENSIBILIDADE DIRIGIDA — Δ no liquidado move a âncora em exatamente −Δ", () => {
    // 🔵 É esta asserção que reprova a regressão OPOSTA: um executor que ignore
    // o liquidado e volte a gravar o declarado cru passaria em todas as de
    // insensibilidade acima e falharia aqui.
    const base = aberturaAncorada(37430, mov())!;
    for (const delta of [0.01, 1, 250.75, 13157.27]) {
      const comMais = aberturaAncorada(
        37430,
        mov({ entradasLiquidadas: 13157.27 + delta }),
      )!;
      expect(Number((comMais - base).toFixed(2))).toBe(Number((-delta).toFixed(2)));
    }
  });

  it("🔴 (iii-b) SENSIBILIDADE DIRIGIDA — Δ na saída PAGA move a âncora em exatamente +Δ", () => {
    const base = aberturaAncorada(37430, mov())!;
    for (const delta of [0.01, 1, 250.75, 9485.54]) {
      const comMais = aberturaAncorada(37430, mov({ saidasPagas: 9485.54 + delta }))!;
      expect(Number((comMais - base).toFixed(2))).toBe(Number(delta.toFixed(2)));
    }
  });

  it("🔵 a RECOMPOSIÇÃO fecha dos dois lados — abertura + liquidado − pago volta ao declarado", () => {
    const ab = aberturaAncorada(37430, mov())!;
    expect(Number((ab + 13157.27 - 9485.54).toFixed(2))).toBe(37430);
  });

  it("redeclarar o mesmo valor com o mesmo par liquidado dá a mesma âncora, ainda que os totais tenham mudado no meio", () => {
    // ⚠️ M-07: `entradas_hoje` caiu 14.790,16 → 14.512,58 durante o dia. É essa
    // instabilidade que fazia a conta do 233-03 dar resultado diferente para o
    // mesmo número digitado.
    const a = aberturaAncorada(37430, mov({ entradas: 14790.16 }));
    const b = aberturaAncorada(37430, mov({ entradas: 14512.58 }));
    expect(b).toBe(a);
  });

  it("devolve null — nunca NaN — quando qualquer parcela liquidada está suja", () => {
    expect(aberturaAncorada(37430, mov({ entradasLiquidadas: null }))).toBeNull();
    expect(aberturaAncorada(37430, mov({ saidasPagas: "abc" }))).toBeNull();
    expect(aberturaAncorada("xyz", mov())).toBeNull();
    expect(aberturaAncorada(37430, null)).toBeNull();
  });

  it("caixa estourado é estado real — abertura negativa atravessa", () => {
    expect(
      aberturaAncorada(-1000, mov({ entradasLiquidadas: 0, saidasPagas: 0 })),
    ).toBe(-1000);
  });

  it("arredonda a duas casas UMA vez, sem viés de sinal", () => {
    expect(aberturaAncorada(1.005, mov({ entradasLiquidadas: 0, saidasPagas: 0 }))).toBe(1.01);
    expect(aberturaAncorada(-1.005, mov({ entradasLiquidadas: 0, saidasPagas: 0 }))).toBe(-1.01);
  });
});

// ---------------------------------------------------------------------------
// 🔴 OS TRÊS CASOS DO 233-05 — mediam a regra que o D-10 DERRUBOU
// ---------------------------------------------------------------------------

describe("🔴 o que o 233-05 media e por que caiu", () => {
  it("o D-07 dizia que o valor digitado atravessava INTACTO para a âncora — e isso é FALSO desde o D-10", () => {
    // A versão do 233-05 tinha três casos: o mesmo 37.430 com os movimentos
    // `(14.790,16 / 9.485,54)`, `(0 / 0)` e `(999.999,99 / 123.456,78)`,
    // exigindo âncora 37.430 nos três. Aquilo media a regra do D-07 (o declarado
    // É a abertura), e o Wesley a derrubou horas depois: ele declara olhando o
    // extrato. Gravar 37.430 como abertura fez o sistema somar o dia por cima e
    // contar R$ 13.157,27 duas vezes.
    //
    // O caso não foi apagado — ele foi INVERTIDO: com liquidado > 0 a âncora
    // NÃO pode ser o digitado.
    const r = montarDeclaracao(ORG, HOJE, 37430, mov());
    expect(r?.saldoParaAncora).not.toBe(37430);
    expect(r?.saldoParaAncora).toBe(33758.27);
  });

  it("🔵 mas o D-07 continua valendo no DIA SEM MOVIMENTO LIQUIDADO — e aí os dois desenhos coincidem", () => {
    const r = montarDeclaracao(
      ORG,
      HOJE,
      37430,
      mov({ entradasLiquidadas: 0, saidasPagas: 0 }),
    );
    expect(r?.saldoParaAncora).toBe(37430);
  });

  it("🔴 o valor DIGITADO continua atravessando intacto — mas para `saldo_real`, não para a âncora", () => {
    // É esta distinção que o D-07 confundia. `saldo_real` é o saldo de AGORA
    // (o do extrato); `saldoParaAncora` é a abertura decomposta. Trocá-los é o
    // defeito do D-07 de volta.
    const r = montarDeclaracao(ORG, HOJE, 37430, mov());
    expect(r?.declaracao.saldo_real).toBe(37430);
    expect(r?.saldoParaAncora).toBe(33758.27);
    expect(r?.declaracao.saldo_real).not.toBe(r?.saldoParaAncora);
  });
});

// ---------------------------------------------------------------------------
// O retrato completo
// ---------------------------------------------------------------------------

describe("montarDeclaracao — o retrato que permite escolher o comparador DEPOIS", () => {
  it("grava as quatro parcelas do retrato junto com o declarado", () => {
    const r = montarDeclaracao(ORG, HOJE, 37430, mov());
    expect(r?.declaracao.abertura_ancorada).toBe(33758.27);
    expect(r?.declaracao.entradas_liquidadas).toBe(13157.27);
    expect(r?.declaracao.saidas_pagas).toBe(9485.54);
    expect(r?.declaracao.entradas_pendentes).toBe(1355.31);
  });

  it("🔵 `entradas_pendentes` é a diferença entre o declarado e a previsão de fechamento", () => {
    // Em 27/08: 38.785,31 (fechamento) − 37.430,00 (declarado) = 1.355,31, que é
    // exatamente o `in_mediation`. É este número que a dívida do comparador da
    // curva pesa — e é por isso que ele fica gravado.
    const r = montarDeclaracao(ORG, HOJE, 37430, mov())!;
    const fechamento = saldoExibido(r.saldoParaAncora, 14512.58, 9485.54)!;
    expect(Number((fechamento - r.declaracao.saldo_real).toFixed(2))).toBe(1355.31);
  });

  it("`saldo_exibido` e `initial_balance` continuam sendo o retrato ANTERIOR à correção", () => {
    const r = montarDeclaracao(ORG, HOJE, 37430, mov());
    expect(r?.declaracao.saldo_exibido).toBe(38785.31);
    expect(r?.declaracao.initial_balance).toBe(33758.27);
    expect(r?.declaracao.entradas_do_dia).toBe(14512.58);
    expect(r?.declaracao.saidas_do_dia).toBe(9485.54);
  });

  it("carrega organization_id e data_declarada explícitos (T-224-07-01)", () => {
    const r = montarDeclaracao(ORG, HOJE, 37430, mov());
    expect(r?.declaracao.organization_id).toBe(ORG);
    expect(r?.declaracao.data_declarada).toBe(HOJE);
  });

  it("devolve null sem org, sem data, com valor sujo ou sem as parcelas liquidadas", () => {
    expect(montarDeclaracao("", HOJE, 37430, mov())).toBeNull();
    expect(montarDeclaracao(ORG, "", 37430, mov())).toBeNull();
    expect(montarDeclaracao(ORG, HOJE, "abc", mov())).toBeNull();
    expect(montarDeclaracao(ORG, HOJE, 37430, null)).toBeNull();
    expect(montarDeclaracao(ORG, HOJE, 37430, mov({ entradasLiquidadas: null }))).toBeNull();
  });

  it("abertura anterior ausente não impede a declaração — vira null, nunca zero", () => {
    const r = montarDeclaracao(ORG, HOJE, 37430, mov({ saldoInicial: null }));
    expect(r?.saldoParaAncora).toBe(33758.27);
    expect(r?.declaracao.saldo_exibido).toBeNull();
    expect(r?.declaracao.initial_balance).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// O bloqueio — o motivo mudou DE NOVO
// ---------------------------------------------------------------------------

describe("🔴 podeDeclarar — agora as parcelas LIQUIDADAS são obrigatórias", () => {
  it("bloqueia enquanto está carregando", () => {
    expect(podeDeclarar(mov(), true).pode).toBe(false);
  });

  it("bloqueia quando os movimentos são nulos", () => {
    expect(podeDeclarar(null).pode).toBe(false);
    expect(podeDeclarar(undefined).motivo).toBeTruthy();
  });

  it("bloqueia quando entradas ou saídas totais são ausentes — nunca trata como zero", () => {
    expect(podeDeclarar(mov({ entradas: null })).pode).toBe(false);
    expect(podeDeclarar(mov({ saidas: undefined })).pode).toBe(false);
  });

  it("🔴 bloqueia SEM as parcelas liquidadas — sem elas a decomposição gravaria o declarado como abertura (o D-07 silencioso)", () => {
    expect(podeDeclarar(mov({ entradasLiquidadas: null })).pode).toBe(false);
    expect(podeDeclarar(mov({ saidasPagas: undefined })).pode).toBe(false);
    expect(podeDeclarar(mov({ entradasLiquidadas: null })).motivo).toBeTruthy();
  });

  it("ZERO LEGÍTIMO passa — dia sem movimento liquidado é um dia válido", () => {
    const v = podeDeclarar(
      mov({ entradas: 0, saidas: 0, entradasLiquidadas: 0, saidasPagas: 0 }),
    );
    expect(v.pode).toBe(true);
    expect(v.motivo).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Entrada suja — preservado
// ---------------------------------------------------------------------------

describe("🔴 entrada suja devolve null, NUNCA NaN", () => {
  const sujos: unknown[] = ["", "  ", "abc", "R$ 1.000", {}, [], true, NaN, Infinity, null, undefined];

  it("numeroOuNulo rejeita tudo que não é número finito", () => {
    for (const v of sujos) expect(numeroOuNulo(v)).toBeNull();
  });

  it("montarDeclaracao nunca produz NaN — devolve null e o chamador não grava", () => {
    for (const v of sujos) {
      const r = montarDeclaracao(ORG, HOJE, v, mov());
      expect(r === null || Number.isFinite(r.saldoParaAncora)).toBe(true);
    }
  });

  it("string numérica com vírgula decimal é aceita — é como o campo devolve", () => {
    expect(numeroOuNulo("37430,55")).toBe(37430.55);
    expect(montarDeclaracao(ORG, HOJE, "37430,55", mov())?.declaracao.saldo_real).toBe(37430.55);
  });
});
