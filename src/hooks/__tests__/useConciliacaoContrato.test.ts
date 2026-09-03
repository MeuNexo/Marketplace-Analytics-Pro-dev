// ============================================================================
// 225-03 Task 2 — o contrato dos hooks de conciliação, provado por FORMA
//
// ⚠️ POR QUE FORMA E NÃO COMPORTAMENTO: a prova de comportamento exigiria o
// banco, e as três RPCs desta fase são `SECURITY INVOKER` — sem sessão
// autenticada elas não devolvem linha. O executor não alcança o banco. Então
// este portão prova o que dá para provar sem ele, e prova as quatro coisas que
// já quebraram esta base antes:
//
//   1. os nomes das RPCs batem com o contrato da 225-02 (typo = tela vazia);
//   2. `.bind(supabase)` existe (o `this` perdido, defeito de 27/08/2026);
//   3. há laço de paginação (o PostgREST trunca em 1000 EM SILÊNCIO e há
//      1.351 linhas em 30 dias hoje — medido, não previsto);
//   4. a organização entra na `queryKey` (o número de uma loja na tela da
//      outra já aconteceu nesta base — T-224-07-01).
//
// 🔴 Comentários são removidos ANTES de contar. A prosa que explica o padrão
// proibido não pode fazer o portão reprovar o arquivo que ela documenta
// (lição do 231-04: prosa cede ao portão).
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CAMINHO = join(__dirname, "..", "useConciliacao.ts");

/** Remove `//` de linha e `/* *\/` de bloco — conta código, não prosa. */
function semComentarios(fonte: string): string {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");
}

const CODIGO = semComentarios(readFileSync(CAMINHO, "utf-8"));

describe("🔴 PORTÃO — o contrato de useConciliacao com as RPCs da 225-02", () => {
  it("1/4 — chama as duas RPCs pelos nomes EXATOS do contrato", () => {
    expect(CODIGO, "a lista vem de get_casos_conciliacao").toContain("get_casos_conciliacao");
    expect(CODIGO, "o resumo vem de get_conciliacao_resumo").toContain("get_conciliacao_resumo");
  });

  it("2/4 — nenhuma chamada de RPC aparece sem `.bind(supabase)`", () => {
    // `supabase.rpc` é `return this.rest.rpc(...)`. Desacoplado do objeto, em
    // ESM strict o `this` vira undefined e a tela mostra
    // `Cannot read properties of undefined (reading 'rest')`.
    expect(CODIGO).toContain("bind(supabase)");

    // ⚠️ Mais largo que o portão de `rpcBind.test.ts` de propósito: aquele só
    // varre `= supabase.rpc` e deixa passar `return supabase.rpc`, que
    // desacopla o método exatamente do mesmo jeito. Medido: com o `.bind`
    // removido daqui, o portão do repositório continuou VERDE.
    const ofensores = CODIGO.split("\n").filter(
      (l) => /\bsupabase\.rpc\b/.test(l) && !l.includes(".bind"),
    );
    expect(ofensores, "supabase.rpc referenciado sem .bind na mesma linha").toEqual([]);
  });

  it("3/4 — há laço de paginação de verdade, não uma chamada só", () => {
    const paginado = /\.range\(/.test(CODIGO) || /p_offset/.test(CODIGO);
    expect(paginado, "sem p_offset nem .range: a lista trunca em 1000").toBe(true);

    const temLaco = /for\s*\(/.test(CODIGO) || /while\s*\(/.test(CODIGO);
    expect(temLaco, "paginar exige laço — uma chamada só não pagina").toBe(true);
  });

  it("4/4 — a organização entra na queryKey (IDOR de cache entre lojas)", () => {
    const chaves = CODIGO.match(/queryKey:\s*\[[^\]]*\]/g) ?? [];
    expect(chaves.length, "nenhuma queryKey encontrada").toBeGreaterThanOrEqual(2);
    for (const k of chaves) {
      expect(k, `queryKey sem organização: ${k}`).toMatch(/orgId|organization/i);
    }
  });
});

describe("🔴 PORTÃO — nenhuma régua do banco reescrita no front", () => {
  it("o piso de materialidade não é constante no hook", () => {
    // O piso vive em `conciliacao_config` e é ecoado pela RPC. Repetir 5.00
    // aqui criaria a segunda régua para o mesmo número.
    expect(CODIGO).not.toMatch(/piso[A-Za-z_]*\s*=\s*[0-9]/);
    expect(CODIGO).not.toMatch(/=\s*5\.0{1,2}\b/);
  });

  it("a janela de 30 dias não é constante no hook", () => {
    // `p_janela_dias` é opcional e a RPC resolve pelo config quando vem nulo.
    expect(CODIGO).not.toMatch(/janela[A-Za-z_]*\s*=\s*30\b/);
    expect(CODIGO).not.toMatch(/p_janela_dias:\s*30\b/);
  });

  it("os cortes de dias (7/14/15) não aparecem no hook — são da lib pura", () => {
    expect(CODIGO).not.toMatch(/dias_restantes\s*<=?\s*(7|14|15)\b/);
  });
});

describe("a página de paginação tem teto — laço não pode girar para sempre", () => {
  it("existe um limite de páginas nomeado", () => {
    expect(CODIGO).toMatch(/MAX_PAGINAS|TETO_PAGINAS|maxPaginas/);
  });

  it("a página é menor ou igual a 200 (o teto duro da RPC é 1000)", () => {
    const m = CODIGO.match(/PAGINA\s*=\s*(\d+)/);
    expect(m, "constante PAGINA não encontrada").not.toBeNull();
    expect(Number(m?.[1])).toBeLessThanOrEqual(200);
  });
});

describe("erro da RPC vira exceção, nunca lista vazia silenciosa", () => {
  it("todo `error` lido é relançado com a mensagem original", () => {
    expect(CODIGO).toMatch(/throw new Error\(/);
    // Uma lista vazia devolvida no lugar de um erro faz a tela dizer
    // "nenhuma divergência" quando na verdade ela não conseguiu ler nada —
    // a pior das três ausências, porque parece a melhor.
    const relancos = CODIGO.match(/throw new Error\(/g) ?? [];
    expect(relancos.length).toBeGreaterThanOrEqual(2);
  });
});
