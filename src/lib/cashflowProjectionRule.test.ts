// ============================================================================
// cashflowProjectionRule.test.ts — Fase 224 Plano 02, Task 1 (TDD)
// Gate de regressão estático: prova, sem credencial nenhuma, que a migration
// vigente de get_cashflow corta a injeção da média no NONO dia (não mais no
// sétimo), preserva a linha confirmada de accumulated_balance, não usa
// DROP FUNCTION nem SECURITY DEFINER, e reemite REVOKE/GRANT com a assinatura
// de quatro argumentos. Quem lê o disco é este teste — molde de
// migrationSecurityLint.test.ts (Test 11), que já lê supabase/migrations/
// diretamente com readdirSync/readFileSync.
// ============================================================================

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "../../supabase/migrations");

/**
 * Remove comentários de linha (`-- ...`) antes de qualquer contagem. A
 * migration cita a regra ANTIGA do sétimo dia de propósito, no cabeçalho
 * explicativo — um grep cru sobre o arquivo inteiro se auto-invalidaria
 * contando a própria explicação como se fosse código. Reaproveita a mesma
 * ideia de migrationSecurityLint.ts (que também descarta comentário antes de
 * casar padrão), mas não importa de lá — as classes daquele lint são outras
 * (RLS/DEFINER), não servem para o corte de dias desta regra.
 */
function semComentarios(sql: string): string {
  return sql
    .split("\n")
    .map((linha) => linha.replace(/--.*$/, ""))
    .join("\n");
}

function migrationsDeCashflow(): Array<{ nome: string; sql: string }> {
  const nomes = readdirSync(MIGRATIONS_DIR)
    .filter((n) => n.endsWith(".sql"))
    .sort();
  return nomes
    .map((nome) => ({
      nome,
      sql: readFileSync(resolve(MIGRATIONS_DIR, nome), "utf-8"),
    }))
    .filter((a) => /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_cashflow/i.test(a.sql));
}

describe("cashflowProjectionRule — get_cashflow para de injetar média em D+8/D+9", () => {
  it("Test 1: a migration mais recente que define get_cashflow é a desta fase (corte no nono dia)", () => {
    const arquivos = migrationsDeCashflow();
    expect(arquivos.length).toBeGreaterThan(0);
    const maisRecente = arquivos[arquivos.length - 1];
    expect(maisRecente.nome).toBe("20260817100000_get_cashflow_corte_d9.sql");
  });

  it("Test 2: fora de comentário, o corte da projeção aparece com o nono dia, exatamente duas vezes", () => {
    const arquivos = migrationsDeCashflow();
    const atual = arquivos[arquivos.length - 1];
    const semComent = semComentarios(atual.sql);
    const ocorrencias = (semComent.match(/v_today \+ 9\b/g) ?? []).length;
    expect(ocorrencias).toBe(2);
  });

  it("Test 3: fora de comentário, o corte antigo do sétimo dia não aparece nenhuma vez", () => {
    const arquivos = migrationsDeCashflow();
    const atual = arquivos[arquivos.length - 1];
    const semComent = semComentarios(atual.sql);
    const ocorrencias = (semComent.match(/v_today \+ 7\b/g) ?? []).length;
    expect(ocorrencias).toBe(0);
  });

  it("Test 4: o arquivo não contém instrução de remoção de função", () => {
    const arquivos = migrationsDeCashflow();
    const atual = arquivos[arquivos.length - 1];
    expect(semComentarios(atual.sql)).not.toMatch(/DROP\s+FUNCTION/i);
  });

  it("Test 5: o arquivo reemite REVOKE para PUBLIC e anon e GRANT para authenticated, com a assinatura de quatro argumentos", () => {
    const arquivos = migrationsDeCashflow();
    const atual = arquivos[arquivos.length - 1];
    expect(atual.sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.get_cashflow\(UUID,DATE,DATE,BOOLEAN\) FROM PUBLIC, anon/,
    );
    expect(atual.sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_cashflow\(UUID,DATE,DATE,BOOLEAN\) TO authenticated/,
    );
  });

  it("Test 6: a expressão da linha confirmada (accumulated_balance) continua idêntica à de 20260660000000_cashflow_dfc_alignment.sql", () => {
    const linhaConfirmada = "(v_initial + SUM(d.inc - d.exp) OVER (ORDER BY d.d_date ASC))::NUMERIC";
    const base = readFileSync(
      resolve(MIGRATIONS_DIR, "20260660000000_cashflow_dfc_alignment.sql"),
      "utf-8",
    );
    const arquivos = migrationsDeCashflow();
    const atual = arquivos[arquivos.length - 1];
    expect(base).toContain(linhaConfirmada);
    expect(atual.sql).toContain(linhaConfirmada);
  });

  it("Test 7: o arquivo não contém SECURITY DEFINER", () => {
    const arquivos = migrationsDeCashflow();
    const atual = arquivos[arquivos.length - 1];
    expect(semComentarios(atual.sql)).not.toMatch(/SECURITY DEFINER/i);
  });
});
