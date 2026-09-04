// ============================================================================
// migrationSeparadorPendurado.test.ts — Fase 225 Plano 11
//
// 🔴 POR QUE ESTE GATE EXISTE, e ele nasceu de um defeito real desta fase.
//
// A migration `20260904160000_caixa_soma_so_entrada_da_org.sql` recria as
// dezesseis funções que leem `cash_inflows`, e os corpos NÃO são transcritos à
// mão: um script lê o `pg_get_functiondef` do banco vivo e injeta o predicado.
// Isso é a defesa certa contra a regressão de R$ 30.372,11 em `get_cashflow`,
// que veio de clonar corpo do repositório.
//
// Mas trocou uma classe de erro por outra. O script acertou quinze corpos e
// errou um: ao acrescentar duas colunas ao fim da lista de um `select`, deixou
// vírgula na última — `ci.motivo_fora_do_caixa,` seguido de `from`. O Postgres
// recusou o arquivo inteiro com `syntax error at or near "from"`, e a
// aplicação reverteu em transação sem tocar nenhuma das dezesseis.
//
// A lição, do lado do GERADOR e não do gate: **quem injeta por script precisa
// de verificação de forma sobre a saída do script.** Revisar o diff função por
// função não pega isto — a linha inserida está visualmente correta; o que está
// errado é a pontuação da linha ANTERIOR a ela.
//
// ⚠️ Este gate é de FORMA, não de semântica. Ele não sabe se o SQL faz o que
// deveria; sabe que um separador pendurado antes de palavra-chave nunca compila.
// Rodado contra todo o histórico de migrations deste repositório no dia em que
// foi escrito: ZERO achados. O denominador não é zero (há dezenas de arquivos e
// milhares de linhas terminadas em vírgula) — ele simplesmente não dispara em
// SQL válido, que é a propriedade que o torna utilizável.
// ============================================================================

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "../../supabase/migrations");

/** Palavra-chave que nunca pode vir logo depois de um separador pendurado. */
const PALAVRA_CHAVE = /^\s*(from|where|group\s+by|order\s+by|having|union|\)|;)\b/i;

export interface SeparadorPendurado {
  arquivo: string;
  linha: number;
  texto: string;
  seguidoDe: string;
}

/**
 * Acha vírgula ao fim de linha cuja PRÓXIMA linha significativa começa por
 * palavra-chave. Comentários e linhas em branco são pulados de propósito: um
 * comentário entre a coluna e o `from` não conserta a vírgula, e um gerador
 * que insira comentário no meio esconderia o defeito de um casamento ingênuo.
 */
export function separadoresPendurados(nome: string, sql: string): SeparadorPendurado[] {
  const linhas = sql.split("\n");
  const achados: SeparadorPendurado[] = [];

  for (let i = 0; i < linhas.length - 1; i++) {
    const semComentario = linhas[i].split("--")[0].trimEnd();
    if (!semComentario.endsWith(",")) continue;

    let j = i + 1;
    while (j < linhas.length && (linhas[j].trim() === "" || linhas[j].trimStart().startsWith("--"))) {
      j++;
    }
    if (j < linhas.length && PALAVRA_CHAVE.test(linhas[j])) {
      achados.push({
        arquivo: nome,
        linha: i + 1,
        texto: linhas[i].trim(),
        seguidoDe: linhas[j].trim(),
      });
    }
  }
  return achados;
}

function migrations(): Array<{ nome: string; sql: string }> {
  return readdirSync(MIGRATIONS_DIR)
    .filter((n) => n.endsWith(".sql"))
    .sort()
    .map((nome) => ({ nome, sql: readFileSync(resolve(MIGRATIONS_DIR, nome), "utf-8") }));
}

describe("migrationSeparadorPendurado — separador pendurado antes de palavra-chave", () => {
  it("o denominador não é zero: há migrations no disco para examinar", () => {
    // 🔴 Gate que aprova por não ter achado nada para olhar não é aprovação.
    // Se o diretório sumir ou o filtro errar, este teste falha ANTES do que
    // conta zero achados e se declara verde.
    const arquivos = migrations();
    expect(arquivos.length, "nenhuma migration lida — a varredura não está enxergando o disco").toBeGreaterThan(20);
    const linhasComVirgula = arquivos
      .flatMap((a) => a.sql.split("\n"))
      .filter((l) => l.split("--")[0].trimEnd().endsWith(",")).length;
    expect(
      linhasComVirgula,
      "nenhuma linha terminada em vírgula no histórico — o casamento está quebrado, não o SQL",
    ).toBeGreaterThan(100);
  });

  it("nenhuma migration tem separador pendurado antes de FROM/WHERE/GROUP/ORDER/HAVING/UNION/)/;", () => {
    const achados = migrations().flatMap((a) => separadoresPendurados(a.nome, a.sql));
    const descricao = achados
      .map((a) => `${a.arquivo}:${a.linha} — \`${a.texto}\` seguido de \`${a.seguidoDe}\``)
      .join("\n");
    expect(
      achados,
      `separador pendurado (o Postgres recusa o arquivo inteiro):\n${descricao}`,
    ).toHaveLength(0);
  });

  it("a regra MORDE — um caso sintético com vírgula órfã é reprovado", () => {
    // Verde sem esta prova não vale nada: um casamento quebrado também devolve
    // zero achados. Este é o defeito exato que a fase encontrou.
    const defeituoso = [
      "select",
      "         (o.ml_order_id is null)  as sem_pedido,",
      "         ci.entra_no_caixa,",
      "         ci.motivo_fora_do_caixa,",
      "    from public.cash_inflows ci",
    ].join("\n");
    const achados = separadoresPendurados("sintetico.sql", defeituoso);
    expect(achados).toHaveLength(1);
    expect(achados[0].texto).toContain("motivo_fora_do_caixa");
    expect(achados[0].seguidoDe).toMatch(/^from/i);
  });

  it("a regra NÃO morde SQL válido — vírgula seguida de outra coluna passa", () => {
    const valido = [
      "select",
      "         ci.entra_no_caixa,",
      "         -- um comentário no meio não conserta nem inventa defeito",
      "         ci.motivo_fora_do_caixa",
      "    from public.cash_inflows ci",
      "   where ci.organization_id = p_org_id",
    ].join("\n");
    expect(separadoresPendurados("valido.sql", valido)).toHaveLength(0);
  });

  it("vírgula dentro de comentário não conta — a prosa não é código", () => {
    const comentado = [
      "select ci.entra_no_caixa -- antes daqui vinha uma vírgula,",
      "    from public.cash_inflows ci",
    ].join("\n");
    expect(separadoresPendurados("comentado.sql", comentado)).toHaveLength(0);
  });
});
