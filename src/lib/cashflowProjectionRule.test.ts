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
  it("Test 1: a migration mais recente que define get_cashflow é a do deflator (224-05)", () => {
    // [224-05] Era a do corte no nono dia (20260821140000). O deflator veio
    // depois e reescreveu a função inteira A PARTIR DO CORPO VIVO, preservando
    // o corte — por isso este gate segue apontando para a última, e não para
    // uma versão escolhida à mão. Ancorar em versão superada foi o defeito que
    // deixou a regressão de 21/08 passar (ver Test 6).
    const arquivos = migrationsDeCashflow();
    expect(arquivos.length).toBeGreaterThan(0);
    const maisRecente = arquivos[arquivos.length - 1];
    expect(maisRecente.nome).toBe("20260821170000_get_cashflow_deflator.sql");
  });

  it("Test 2: o corte do nono dia aparece TRÊS vezes — duas do 224-02 e a fronteira do deflator", () => {
    // [224-05] Eram duas (daily_projection e accumulated_balance_sma). A
    // terceira é a fronteira do deflator: ele só se aplica de D+1 a D+9,
    // porque de D+10 em diante a agenda já subestima e deflacionar aumenta a
    // falta (R-01: WAPE piora nos seis horizontes seguintes, sem exceção).
    const arquivos = migrationsDeCashflow();
    const atual = arquivos[arquivos.length - 1];
    const semComent = semComentarios(atual.sql);
    const ocorrencias = (semComent.match(/v_today \+ 9\b/g) ?? []).length;
    expect(ocorrencias).toBe(3);
  });

  it("Test 2b: o deflator é chamado, tem clamp, e NÃO toca o piso da média", () => {
    // [224-05] O dia em que alguém remover a chamada, este teste fica vermelho
    // — é o requisito do plano de que o gate passe a cobrir o deflator.
    const arquivos = migrationsDeCashflow();
    const atual = arquivos[arquivos.length - 1];
    const semComent = semComentarios(atual.sql);

    // 1. Janela móvel, nunca constante gravada (critério 3 do ROADMAP).
    expect(semComent).toContain("public.get_estorno_deflator(p_org_id, 30)");
    // 2. Clamp: estorno nunca AUMENTA o que entra, então 1,0 é teto.
    expect(semComent).toMatch(/LEAST\(1\.0,\s*GREATEST\(0\.80/);
    // 3. A multiplicação existe e está atrás da guarda de faixa.
    expect(semComent).toMatch(/d_date > v_today AND d\.d_date <= v_today \+ 9/);
    expect(semComent).toContain("* v_deflator");
    // 4. 🔴 O piso NÃO é deflacionado (M-01: bruto vence em 5 de 6 horizontes;
    //    deflacioná-lo faria a previsão subestimar o caixa em ~10%).
    expect(semComent).not.toMatch(/v_sma\s*\*\s*v_deflator/);
    expect(semComent).toContain("GREATEST(d.inc, v_sma)");
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

  it("Test 6: a linha confirmada preserva o saldo ROLADO e não conta o dia corrente duas vezes", () => {
    // 🔴 [21/08/2026] Este teste ancorava em 20260660000000_cashflow_dfc_alignment.sql
    // e por isso NÃO pegou a regressão que chegou a produção: aquela migration é
    // ANTERIOR a 20260713132524_cashflow_anchor_absolute_today, que trocou
    // `financial_settings.initial_balance` por `get_rolled_opening_balance()` e
    // passou a excluir o dia corrente das somas acumuladas (o saldo rolado já o
    // inclui). Ancorar o gate numa versão superada é o mesmo que não ter gate:
    // ele aprovava exatamente a expressão que a correção de julho tinha aposentado.
    // Medido ao vivo: o saldo confirmado em D+30 saltou R$ 30.372,11.
    const arquivos = migrationsDeCashflow();
    const atual = arquivos[arquivos.length - 1];
    const corpo = semComentarios(atual.sql);

    // 1. O saldo inicial vem do saldo rolado, nunca da leitura crua da tabela.
    expect(corpo).toContain("public.get_rolled_opening_balance(p_org_id)");
    expect(corpo).not.toMatch(/financial_settings/);

    // 2. As DUAS somas acumuladas excluem o dia corrente.
    const guardaDiaCorrente = (corpo.match(/CASE WHEN d\.d_date > v_today/g) ?? []).length;
    expect(guardaDiaCorrente).toBe(2);

    // 3. A linha confirmada segue sendo (inc - exp), sem termo de média.
    expect(corpo).toContain("THEN (d.inc - d.exp) ELSE 0 END");
  });

  it("Test 7: o arquivo não contém SECURITY DEFINER", () => {
    const arquivos = migrationsDeCashflow();
    const atual = arquivos[arquivos.length - 1];
    expect(semComentarios(atual.sql)).not.toMatch(/SECURITY DEFINER/i);
  });
});
