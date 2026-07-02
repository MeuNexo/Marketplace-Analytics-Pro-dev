/**
 * Testes do utilitário puro de agregação de vendas por dia.
 *
 * Cobre 6 casos obrigatórios do PLAN 73-01:
 *   1. janela de 30 dias com today fixo gera exatamente 30 pontos contíguos
 *   2. múltiplas linhas no mesmo dia somam quantidade e receita
 *   3. dia sem venda no meio da janela aparece com unidades=0 e receita=0
 *   4. linha com data fora da janela é ignorada
 *   5. array vazio retorna windowDays pontos todos zerados
 *   6. label formata DD/MM em pt-BR
 *
 * Phase: 73-aba-vendas / Plan 01 (TDD RED → GREEN)
 */

import { describe, it, expect } from "vitest";
import { aggregateListingSales } from "./listingSalesAgg";
import type { SalesRow } from "./listingSalesAgg";

// Data canônica fixa — 2024-06-30 (UTC), garante determinismo independente de fuso
const TODAY = new Date("2024-06-30T00:00:00.000Z");

describe("aggregateListingSales", () => {
  // ── Test 1: comprimento e contiguidade ────────────────────────────────────
  it("janela de 30 dias com today fixo gera exatamente 30 pontos contíguos", () => {
    const result = aggregateListingSales([], 30, TODAY);

    expect(result).toHaveLength(30);

    // Ponto mais antigo: today - 29 dias = 2024-06-01
    expect(result[0].date).toBe("2024-06-01");
    // Ponto mais recente: today
    expect(result[29].date).toBe("2024-06-30");

    // Verifica contiguidade — cada ponto dista exatamente 1 dia do anterior
    for (let i = 1; i < result.length; i++) {
      const prev = new Date(result[i - 1].date + "T00:00:00.000Z");
      const curr = new Date(result[i].date + "T00:00:00.000Z");
      expect(curr.getTime() - prev.getTime()).toBe(86_400_000); // 1 dia em ms
    }
  });

  // ── Test 2: soma por dia ──────────────────────────────────────────────────
  it("múltiplas linhas no mesmo dia somam quantidade e receita", () => {
    const rows: SalesRow[] = [
      { data_pedido: "2024-06-28", quantidade: 3, receita_bruta: 300 },
      // data_pedido com timestamp — slice(0,10) deve extrair a chave do dia
      { data_pedido: "2024-06-28T10:00:00.000Z", quantidade: 2, receita_bruta: 200 },
    ];
    const result = aggregateListingSales(rows, 30, TODAY);
    const day = result.find((p) => p.date === "2024-06-28");

    expect(day).toBeDefined();
    expect(day!.unidades).toBe(5);
    expect(day!.receita).toBe(500);
  });

  // ── Test 3: dia sem venda → zeros, não ausência ───────────────────────────
  it("dia sem venda no meio da janela aparece com unidades=0 e receita=0", () => {
    const rows: SalesRow[] = [
      { data_pedido: "2024-06-25", quantidade: 1, receita_bruta: 100 },
      // 2024-06-26 deliberadamente ausente
      { data_pedido: "2024-06-27", quantidade: 1, receita_bruta: 100 },
    ];
    const result = aggregateListingSales(rows, 30, TODAY);
    const missing = result.find((p) => p.date === "2024-06-26");

    expect(missing).toBeDefined();
    expect(missing!.unidades).toBe(0);
    expect(missing!.receita).toBe(0);
  });

  // ── Test 4: data fora da janela → ignorada ────────────────────────────────
  it("linha com data fora da janela é ignorada", () => {
    // Janela 30d a partir de 2024-06-30: de 2024-06-01 até 2024-06-30
    // 2024-05-31 é um dia antes do início → deve ser ignorada
    const rows: SalesRow[] = [
      { data_pedido: "2024-05-31", quantidade: 99, receita_bruta: 9_900 },
    ];
    const result = aggregateListingSales(rows, 30, TODAY);
    const total = result.reduce((acc, p) => acc + p.unidades, 0);

    expect(total).toBe(0);
  });

  // ── Test 5: array vazio → todos os pontos zerados ─────────────────────────
  it("array vazio retorna windowDays pontos todos zerados", () => {
    const result = aggregateListingSales([], 30, TODAY);

    expect(result).toHaveLength(30);
    result.forEach((p) => {
      expect(p.unidades).toBe(0);
      expect(p.receita).toBe(0);
    });
  });

  // ── Test 6: formato do label DD/MM ────────────────────────────────────────
  it("label formata DD/MM em pt-BR", () => {
    const result = aggregateListingSales([], 30, TODAY);

    // Ponto[0] = 2024-06-01 → "01/06"
    expect(result[0].label).toBe("01/06");
    // Ponto[29] = 2024-06-30 → "30/06"
    expect(result[29].label).toBe("30/06");
  });
});
