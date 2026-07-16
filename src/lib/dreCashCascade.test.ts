// ============================================================================
// dreCashCascade.test.ts — Phase 99 Plan 02, Task 1 (TDD)
// Testa a função pura que monta a cascata do DRE Caixa a partir das linhas
// cruas da RPC get_dre_cash (Plano 99-01): recebimento líquido MP → resultado
// operacional de caixa → resultado de caixa do mês, com badge-resposta e
// previsão de imposto null-safe.
//
// Espelho estrutural de src/lib/dreCascade.test.ts (Phase 88), adaptado para
// a régua LOCKED do 99-CONTEXT: seção entrada (informativa, base = liquido),
// seção saida (6 blocos operacionais fixos + financeiro fora do operacional +
// excluido nunca somado), seção previsao (imposto, null-safe).
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  buildDreCashCascade,
  computePrevisaoDesvio,
  SAIDA_BLOCOS,
  type DreCashRow,
} from "./dreCashCascade";

// Formatação pt-BR idêntica à usada internamente pela lib — usada nos testes
// para não hardcodar string de formatação (evita acoplamento a locale do CI).
const fmtBR = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2 });

// Helpers para montar DreCashRow por seção, com defaults sensatos.
function entradaRow(categoria: string, total: number | null, n = 1): DreCashRow {
  return { secao: "entrada", bloco: null, categoria, total, n };
}
function saidaRow(bloco: string, categoria: string, total: number, n = 1): DreCashRow {
  return { secao: "saida", bloco, categoria, total, n };
}
function previsaoRow(categoria: string, total: number | null, n = 1): DreCashRow {
  return { secao: "previsao", bloco: null, categoria, total, n };
}

describe("buildDreCashCascade — Test 1: guardrail entrada/previsao (excluido/fornecedores SOMA)", () => {
  it("linhas de entrada/previsao NUNCA entram na soma de saídas, mas o bloco excluido (fornecedores) SOMA", () => {
    const saidaRows: DreCashRow[] = [
      saidaRow("pessoal", "Salários", 5000),
      saidaRow("estrutura", "Aluguéis e condomínio", 2000),
    ];
    const cSemFornecedores = buildDreCashCascade(saidaRows);

    const rowsComFornecedores: DreCashRow[] = [
      ...saidaRows,
      entradaRow("bruto", 100000),
      entradaRow("liquido", 90000),
      entradaRow("a_liberar", 3000),
      previsaoRow("imposto_previsto", 3000),
      previsaoRow("imposto_guia_paga", 3200),
      previsaoRow("faturamento_mes", 90000),
      saidaRow("excluido", "Fornecedores", 50000),
    ];
    const cComFornecedores = buildDreCashCascade(rowsComFornecedores);

    const totalSaidasSem = cSemFornecedores.saidas.reduce((s, b) => s + b.total, 0);
    const totalSaidasCom = cComFornecedores.saidas.reduce((s, b) => s + b.total, 0);
    // Sem linhas de refunds nos rows, a linha "estornos" fica com total 0 —
    // não altera a soma.
    expect(totalSaidasSem).toBe(7000);
    // [AJUSTE Wesley 2026-07-16] Fornecedores (bloco `excluido`) É saída —
    // soma 50000 a mais no total de saídas, nunca contaminado por
    // entrada/previsao (que ficam de fora independentemente).
    expect(totalSaidasCom).toBe(totalSaidasSem + 50000);
    expect(totalSaidasCom).toBe(57000);

    // "excluido" aparece como PRIMEIRA linha de saída da cascata, com o
    // rótulo "Fornecedores (compras)".
    expect(cComFornecedores.saidas[0].bloco).toBe("excluido");
    expect(cComFornecedores.saidas[0].label).toBe("Fornecedores (compras)");
    expect(cComFornecedores.saidas[0].total).toBe(50000);
    expect(cComFornecedores.saidas.map((b) => b.bloco)).toContain("excluido");

    // resultadoOperacional desconta os 50000 de fornecedores.
    expect(cComFornecedores.resultadoOperacional).toBe(90000 - 7000 - 50000);
  });
});

describe("buildDreCashCascade — Test 2: matemática da cascata", () => {
  it("resultadoOperacional = liquido − Σ(8 linhas, incl. fornecedores + estornos); resultadoCaixa = resultadoOperacional − financeiro", () => {
    const rows: DreCashRow[] = [
      entradaRow("bruto", 120000),
      entradaRow("descontos_fonte", 5000),
      entradaRow("refunds", -2000),
      entradaRow("liquido", 113000),
      entradaRow("a_liberar", 8000),
      saidaRow("excluido", "Fornecedores", 30000),
      saidaRow("impostos_venda", "Imposto Venda - ICMS", 4000),
      saidaRow("pessoal", "Salários", 27852),
      saidaRow("estrutura", "Aluguéis e condomínio", 3000),
      saidaRow("servicos", "Contabilidade", 2103),
      saidaRow("operacional", "Insumos", 15715),
      saidaRow("nao_classificado", "Outros", 7360),
      saidaRow("financeiro", "Empréstimo", 20027),
    ];
    const c = buildDreCashCascade(rows);

    expect(c.entradas.bruto).toBe(120000);
    expect(c.entradas.descontosFonte).toBe(5000);
    // [FIX 2] `refunds` não existe mais em `entradas` — virou linha de saída.
    expect((c.entradas as Record<string, unknown>).refunds).toBeUndefined();
    expect(c.entradas.liquido).toBe(113000);
    expect(c.entradas.aLiberar).toBe(8000);

    // 7 blocos padrão + estornos (ABS de -2000 = 2000)
    const totalOitoLinhas = 30000 + 2000 + 4000 + 27852 + 3000 + 2103 + 15715 + 7360; // 92030
    expect(c.resultadoOperacional).toBe(113000 - totalOitoLinhas); // 20970
    expect(c.financeiro).toBe(20027);
    expect(c.resultadoCaixa).toBe(20970 - 20027); // 943

    // As 8 linhas de saída SEMPRE aparecem, mesmo blocos sem dados (total 0).
    // "excluido" (Fornecedores) é a 1ª linha; "estornos" a 2ª, logo em seguida.
    expect(c.saidas.map((b) => b.bloco)).toEqual([
      "excluido",
      "estornos",
      ...SAIDA_BLOCOS.filter((b) => b !== "excluido"),
    ]);
    expect(c.saidas[0].bloco).toBe("excluido");
    expect(c.saidas[1].bloco).toBe("estornos");
    expect(c.saidas[1].total).toBe(2000);
    expect(c.saidas[1].label).toBe("Estornos (devoluções MP)");
    expect(c.saidas[1].drillable).toBe(false);
    expect(c.saidas.every((b) => typeof b.total === "number")).toBe(true);
  });

  it("blocos sem linhas aparecem com total 0 — a cascata sempre mostra as 8 linhas", () => {
    const rows: DreCashRow[] = [
      entradaRow("liquido", 1000),
      saidaRow("pessoal", "Salários", 500),
    ];
    const c = buildDreCashCascade(rows);
    expect(c.saidas).toHaveLength(8);
    const fornecedores = c.saidas.find((b) => b.bloco === "excluido");
    expect(fornecedores?.total).toBe(0);
    expect(fornecedores?.categorias).toEqual([]);
    const estornos = c.saidas.find((b) => b.bloco === "estornos");
    expect(estornos?.total).toBe(0);
    expect(estornos?.categorias).toEqual([]);
    expect(estornos?.drillable).toBe(false);
    const naoClass = c.saidas.find((b) => b.bloco === "nao_classificado");
    expect(naoClass?.total).toBe(0);
    expect(naoClass?.categorias).toEqual([]);
  });
});

describe("buildDreCashCascade — Test 3: badge positivo", () => {
  it("resultadoCaixa > 0 → tone positive e texto contendo 'sobrou' com o valor", () => {
    const rows: DreCashRow[] = [
      entradaRow("liquido", 10000),
      saidaRow("pessoal", "Salários", 3000),
    ];
    const c = buildDreCashCascade(rows);
    expect(c.resultadoCaixa).toBe(7000);
    expect(c.badge.tone).toBe("positive");
    expect(c.badge.texto).toContain("sobrou");
    expect(c.badge.texto).toContain(fmtBR(7000));
  });
});

describe("buildDreCashCascade — Test 4: badge negativo", () => {
  it("resultadoCaixa < 0 → tone negative e texto contendo 'Faltou' com o valor absoluto", () => {
    const rows: DreCashRow[] = [
      entradaRow("liquido", 3000),
      saidaRow("pessoal", "Salários", 5000),
    ];
    const c = buildDreCashCascade(rows);
    expect(c.resultadoCaixa).toBe(-2000);
    expect(c.badge.tone).toBe("negative");
    expect(c.badge.texto).toContain("Faltou");
    expect(c.badge.texto).toContain(fmtBR(2000));
  });
});

describe("buildDreCashCascade — Test 5: mês vazio", () => {
  it("rows [] → todos os totais 0, badge neutro 'sem movimentação' (hasMovimento false)", () => {
    const c = buildDreCashCascade([]);
    expect(c.entradas.liquido).toBe(0);
    expect(c.entradas.bruto).toBe(0);
    expect(c.resultadoOperacional).toBe(0);
    expect(c.financeiro).toBe(0);
    expect(c.resultadoCaixa).toBe(0);
    expect(c.hasMovimento).toBe(false);
    expect(c.badge.tone).toBe("neutral");
    expect(c.badge.texto.toLowerCase()).toContain("movimentação");
  });
});

describe("buildDreCashCascade — Test 6: previsão null", () => {
  it("linha imposto_previsto com total null → previsao.impostoPrevisto null e desvioPct null", () => {
    const rows: DreCashRow[] = [
      previsaoRow("imposto_previsto", null),
      previsaoRow("imposto_guia_paga", 1200),
      previsaoRow("faturamento_mes", 50000),
    ];
    const c = buildDreCashCascade(rows);
    expect(c.previsao.impostoPrevisto).toBeNull();
    expect(c.previsao.impostoGuiaPaga).toBe(1200);
    expect(c.previsao.faturamentoMes).toBe(50000);
    expect(c.previsao.desvioPct).toBeNull();
    expect(c.previsao.alert).toBe(false);
  });
});

describe("computePrevisaoDesvio — Test 7: desvio de previsão", () => {
  it("previsto=1000, guiaPaga=1300 → desvioPct 30 e alert true (limiar 20%)", () => {
    expect(computePrevisaoDesvio(1000, 1300)).toEqual({ desvioPct: 30, alert: true });
  });

  it("previsto=1000, guiaPaga=1050 → desvioPct 5 e alert false", () => {
    expect(computePrevisaoDesvio(1000, 1050)).toEqual({ desvioPct: 5, alert: false });
  });

  it("previsto 0 ou null → desvioPct null, alert false", () => {
    expect(computePrevisaoDesvio(0, 500)).toEqual({ desvioPct: null, alert: false });
    expect(computePrevisaoDesvio(null, 500)).toEqual({ desvioPct: null, alert: false });
  });
});

describe("buildDreCashCascade — Test 8: nao_classificado gate", () => {
  it("rows com bloco nao_classificado total > 0 → naoClassificadoTotal > 0 exposta", () => {
    const rows: DreCashRow[] = [
      entradaRow("liquido", 5000),
      saidaRow("nao_classificado", "Outros", 1500),
    ];
    const c = buildDreCashCascade(rows);
    expect(c.naoClassificadoTotal).toBe(1500);
    expect(c.naoClassificadoTotal).toBeGreaterThan(0);
  });

  it("sem linhas nao_classificado → naoClassificadoTotal 0", () => {
    const rows: DreCashRow[] = [entradaRow("liquido", 5000)];
    const c = buildDreCashCascade(rows);
    expect(c.naoClassificadoTotal).toBe(0);
  });
});

describe("buildDreCashCascade — Test 9: fornecedores (bloco excluido) no badge", () => {
  it("[AJUSTE Wesley 2026-07-16] entradas 100, saidas com fornecedores 150 → badge vermelho faltou 50", () => {
    const rows: DreCashRow[] = [
      entradaRow("liquido", 100),
      saidaRow("excluido", "Fornecedores", 100),
      saidaRow("pessoal", "Salários", 50),
    ];
    const c = buildDreCashCascade(rows);
    expect(c.resultadoOperacional).toBe(-50);
    expect(c.resultadoCaixa).toBe(-50);
    expect(c.badge.tone).toBe("negative");
    expect(c.badge.texto).toContain("Faltou");
    expect(c.badge.texto).toContain(fmtBR(50));
  });

  it("rótulo do bloco excluido é sempre 'Fornecedores (compras)', nunca 'excluído'", () => {
    const rows: DreCashRow[] = [
      entradaRow("liquido", 1000),
      saidaRow("excluido", "Fornecedores", 300),
    ];
    const c = buildDreCashCascade(rows);
    const fornecedores = c.saidas.find((b) => b.bloco === "excluido");
    expect(fornecedores?.label).toBe("Fornecedores (compras)");
    expect(fornecedores?.label.toLowerCase()).not.toContain("exclu");
  });
});

describe("buildDreCashCascade — Test 10: FIX 2 (2026-07-16) — entrada cheia + estorno como saída", () => {
  it("`refunds` (negativo, seção entrada) vira linha de SAÍDA 'Estornos (devoluções MP)' com valor ABS, logo após Fornecedores", () => {
    const rows: DreCashRow[] = [
      entradaRow("liquido", 100000),
      entradaRow("refunds", -5000),
      saidaRow("excluido", "Fornecedores", 30000),
      saidaRow("pessoal", "Salários", 20000),
    ];
    const c = buildDreCashCascade(rows);

    const estornos = c.saidas.find((b) => b.bloco === "estornos");
    expect(estornos).toBeDefined();
    expect(estornos?.label).toBe("Estornos (devoluções MP)");
    expect(estornos?.total).toBe(5000);
    expect(estornos?.drillable).toBe(false);
    expect(estornos?.categorias).toEqual([]);

    // Posição: logo após "excluido" (Fornecedores).
    expect(c.saidas.findIndex((b) => b.bloco === "excluido")).toBe(0);
    expect(c.saidas.findIndex((b) => b.bloco === "estornos")).toBe(1);

    // `entradas` não expõe mais `refunds` — a base já chega cheia da RPC.
    expect((c.entradas as Record<string, unknown>).refunds).toBeUndefined();
    expect(c.entradas.liquido).toBe(100000);

    // Estornos somam no resultado operacional junto com os demais blocos.
    expect(c.resultadoOperacional).toBe(100000 - 30000 - 5000 - 20000);
  });

  it("cenário real de junho: entrada 193.476,52, estornos 33.837,64, outras saídas 204.305,54 → resultado −44.666,66", () => {
    const rows: DreCashRow[] = [
      entradaRow("liquido", 193476.52),
      entradaRow("refunds", -33837.64),
      saidaRow("excluido", "Fornecedores", 100000),
      saidaRow("impostos_venda", "Imposto Venda - ICMS", 30000),
      saidaRow("pessoal", "Salários", 40000),
      saidaRow("estrutura", "Aluguéis", 15000),
      saidaRow("servicos", "Contabilidade", 10000),
      saidaRow("operacional", "Insumos", 9305.54),
      // 100000 + 30000 + 40000 + 15000 + 10000 + 9305,54 = 204.305,54
    ];
    const c = buildDreCashCascade(rows);

    const estornos = c.saidas.find((b) => b.bloco === "estornos");
    expect(estornos?.total).toBe(33837.64);

    const outrasSaidas = c.saidas.reduce((s, b) => s + b.total, 0) - (estornos?.total ?? 0);
    expect(outrasSaidas).toBeCloseTo(204305.54, 2);

    expect(c.resultadoOperacional).toBeCloseTo(-44666.66, 2);
    expect(c.resultadoCaixa).toBeCloseTo(-44666.66, 2);
    expect(c.badge.tone).toBe("negative");
    expect(c.badge.texto).toContain("Faltou");
  });
});
