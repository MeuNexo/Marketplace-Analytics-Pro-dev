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

/**
 * 🔴 [225-11] O CORPO DE UMA FUNCAO, não o arquivo inteiro.
 *
 * Até aqui este gate lia `atual.sql` cru, porque a migration mais recente que
 * definia `get_cashflow` só definia `get_cashflow`. Essa premissa deixou de
 * valer: o 225-11 recria as DEZESSEIS funções que leem `cash_inflows` num
 * arquivo só, porque a guarda de cobertura dele exige que nenhuma fique sem o
 * filtro e sem marcador de dispensa.
 *
 * Com a premissa quebrada, três asserções deste gate viraram falso positivo — e
 * o pior é que as três induziam a correção ERRADA:
 *
 * - `financial_settings` passou a aparecer porque `get_cashflow_data_health`
 *   lê essa tabela. A "correção" óbvia seria tirar aquela função do arquivo, o
 *   que reprovaria a guarda de cobertura do 225-11.
 * - `SECURITY DEFINER` passou a aparecer porque `_backtest_errors_raw` É
 *   definidora desde a Fase 230, de propósito, sem grant. A "correção" óbvia
 *   seria torná-la INVOKER — uma mudança de segurança real, feita por engano,
 *   para calar um gate.
 * - O par de permissões era casado por TEXTO RENDERIZADO (`REVOKE EXECUTE ...
 *   (UUID,DATE,DATE,BOOLEAN)`), e `revoke all ... (p_org_id uuid, ...)` é mais
 *   forte e não casa. Mesma classe de defeito que o 225-10 já corrigiu nesta
 *   fase: assinatura casada por grafia falha quando a grafia muda.
 *
 * A regra que estas asserções sempre quiseram proteger é sobre `get_cashflow`.
 * Então é o corpo dela que elas passam a ler. Os Testes 2, 2b, 3 e 4 continuam
 * lendo o arquivo inteiro e continuam verdes — foram eles que provaram que a
 * correção do 224-05 sobreviveu à substituição pelo corpo vivo.
 */
function corpoDeGetCashflow(sql: string): string {
  const m = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_cashflow\s*\(/i.exec(sql);
  if (!m) return "";
  const resto = sql.slice(m.index);
  const abre = /AS\s+(\$[a-z_]*\$)/i.exec(resto);
  if (!abre) return resto;
  const tag = abre[1];
  const fim = resto.indexOf(tag, abre.index + abre[0].length);
  return fim === -1 ? resto : resto.slice(0, fim + tag.length);
}

describe("cashflowProjectionRule — get_cashflow para de injetar média em D+8/D+9", () => {
  it("Test 1: a migration mais recente que define get_cashflow é a do deflator (224-05)", () => {
    // [224-05] Era a do corte no nono dia (20260821140000). O deflator veio
    // depois e reescreveu a função inteira A PARTIR DO CORPO VIVO, preservando
    // o corte — por isso este gate segue apontando para a última, e não para
    // uma versão escolhida à mão. Ancorar em versão superada foi o defeito que
    // deixou a regressão de 21/08 passar (ver Test 6).
    // 🔴 [225-11] O literal do NOME saiu. Ele reprovava toda migration
    // legítima posterior — e o próprio comentário acima diz que ancorar em
    // versão superada é o defeito. O que este teste protege de verdade é que a
    // migration do deflator continue NA CADEIA e que a mais recente não seja
    // anterior a ela; o conteúdo é vigiado pelos Testes 2, 2b, 3 e 6, que leem
    // sempre a última. Um nome fixo aqui obrigaria a editar o gate a cada
    // correção correta, e gate que se edita por rotina para de ser lido.
    const arquivos = migrationsDeCashflow();
    expect(arquivos.length).toBeGreaterThan(0);
    const nomes = arquivos.map((a) => a.nome);
    expect(nomes, "a migration do deflator (224-05) sumiu da cadeia de get_cashflow").toContain(
      "20260821170000_get_cashflow_deflator.sql",
    );
    const maisRecente = arquivos[arquivos.length - 1];
    expect(
      maisRecente.nome >= "20260821170000_get_cashflow_deflator.sql",
      `a mais recente (${maisRecente.nome}) é anterior à do deflator — a correção do 224-05 seria sobrescrita por uma versão velha`,
    ).toBe(true);
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
    // 🔴 [225-11] Casado por INVARIANTE, não por grafia. `revoke all ... from
    // public` + `... from anon` é MAIS forte que `REVOKE EXECUTE ... FROM
    // PUBLIC, anon`, e a assinatura com nomes de parâmetro é a que o
    // `pg_get_function_identity_arguments` devolve. A forma antiga reprovava as
    // duas coisas por serem escritas diferente.
    const linhas = atual.sql
      .split("\n")
      .filter((l) => /public\.get_cashflow\s*\(/i.test(l) && !/^\s*--/.test(l));
    const revogaPublic = linhas.some((l) => /\brevoke\b/i.test(l) && /\bpublic\s*;/i.test(l));
    const revogaAnon = linhas.some((l) => /\brevoke\b/i.test(l) && /\banon\b/i.test(l));
    const concede = linhas.some((l) => /\bgrant\s+execute\b/i.test(l) && /\bauthenticated\b/i.test(l));
    expect(revogaPublic, "o REVOKE de PUBLIC não foi reemitido para get_cashflow").toBe(true);
    expect(revogaAnon, "o REVOKE de anon não foi reemitido — revogar de PUBLIC não desfaz o grant direto").toBe(true);
    expect(concede, "o GRANT para authenticated não foi reemitido — a tela de caixa quebraria inteira").toBe(true);
    // E a assinatura continua sendo a de QUATRO argumentos, em qualquer grafia.
    const quatroArgs = linhas.some((l) =>
      /uuid[^)]*\bdate\b[^)]*\bdate\b[^)]*\bboolean\b/i.test(l),
    );
    expect(quatroArgs, "as permissões não citam a assinatura de quatro argumentos").toBe(true);
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
    // 🔴 [225-11] Escopo no CORPO de get_cashflow. Lendo o arquivo inteiro,
    // `financial_settings` aparecia por causa de get_cashflow_data_health — e a
    // "correção" seria tirar aquela função do arquivo, reprovando a guarda de
    // cobertura do 225-11. A regra sempre foi sobre get_cashflow.
    const corpo = semComentarios(corpoDeGetCashflow(atual.sql));
    expect(corpo.length, "não achei o corpo de get_cashflow no arquivo").toBeGreaterThan(0);

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
    // 🔴 [225-11] Escopo no CORPO de get_cashflow. No arquivo inteiro o termo
    // aparece por causa de `_backtest_errors_raw`, que é definidora desde a
    // Fase 230, de propósito e sem grant. A "correção" óbvia seria torná-la
    // INVOKER — uma mudança de segurança real, feita por engano, para calar um
    // gate. O que este teste quer dizer é que get_cashflow é de tenant e não
    // pode virar definidora com p_org_id, que é IDOR.
    expect(semComentarios(corpoDeGetCashflow(atual.sql))).not.toMatch(/SECURITY DEFINER/i);
  });
});
