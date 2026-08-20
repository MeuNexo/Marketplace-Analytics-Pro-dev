/**
 * batchUpsertColunasAlinhadas.test.ts — prova posicional offline do TERCEIRO
 * DEFEITO ESTRUTURAL da Fase 222 (Quick 260820-4kk).
 *
 * O DEFEITO: em `public.batch_upsert_orders`, a lista de COLUNAS do `INSERT`
 * e a lista de VALORES do `SELECT` (as chaves `r->>'...'` lidas do payload)
 * estão desalinhadas por uma posição no bloco fiscal — a coluna
 * `pis_cofins_debito_com_difal` recebe, na prática, o valor que a projeção
 * calculou para `credito_pc_comissao`, e as três colunas seguintes (
 * `credito_pc_comissao`, `credito_pc_frete`, `credito_icms_frete`) também
 * saem uma posição deslocadas. `tax_amount` não é afetado — vem de
 * `breakdown.taxAmount`, coluna própria. Quem quebra de verdade é
 * `difal_efeito_liquido`, que lê `pis_cofins_debito_com_difal`: o segundo
 * número (cenário COM DIFAL) das 12 telas sairia PLAUSÍVEL e ERRADO.
 *
 * POR QUE ESTE TESTE LÊ OS ARQUIVOS `.sql` EM VEZ DE CONSULTAR O BANCO:
 * aplicar migration é portão humano nesta fase — nenhuma migration da 222
 * foi aplicada em produção. Um componente fiscal trocado sai PLAUSÍVEL:
 * nenhuma tela pisca, nenhum outro teste quebra. Se este portão não for
 * offline, o defeito só aparece depois de o banco já estar escrito — que foi
 * exatamente o que aconteceu com a sentinela do 8B em 20/08. Aqui ele é pego
 * no commit, sem depender de nada ter sido aplicado.
 *
 * Caminhos relativos à RAIZ DO REPOSITÓRIO via `process.cwd()`, nunca
 * `import.meta.url` — a suíte roda em jsdom, onde `import.meta.url` é uma URL
 * `http://` do servidor do Vite e `fileURLToPath` recusa (mesma nota de
 * `difalRpcAudit.test.ts`, 222-15-R2).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS = "supabase/migrations";

/** Onde o defeito NASCE — já aplicada em produção. Leitura apenas, jamais editar. */
const ARQ_FUNCAO_HISTORICA = `${MIGRATIONS}/20260812210000_orders_flex_e_componentes_fiscais.sql`;

/** A correção — migration NOVA (Task 2 deste plano). Pode não existir ainda (RED). */
const ARQ_MIGRATION_NOVA = `${MIGRATIONS}/20260820220000_batch_upsert_orders_alinhamento_fiscal.sql`;

function ler(caminho: string): string {
  return readFileSync(resolve(process.cwd(), caminho), "utf8");
}

function existe(caminho: string): boolean {
  return existsSync(resolve(process.cwd(), caminho));
}

/**
 * Remove comentários de linha (`--` até o fim da linha). Sem isso, uma frase
 * de cabeçalho citando um nome de coluna contaria como se fosse a lista real
 * — a mesma colisão prosa-versus-grep de `difalRpcAudit.test.ts`.
 */
function semComentarios(sql: string): string {
  return sql
    .split("\n")
    .map((linha) => {
      const i = linha.indexOf("--");
      return i === -1 ? linha : linha.slice(0, i);
    })
    .join("\n");
}

/**
 * Captura o texto entre os delimitadores `$function$` de
 * `CREATE OR REPLACE FUNCTION public.batch_upsert_orders`. É esse texto, e só
 * ele, que vira `prosrc` no banco — a mesma superfície que a guarda da
 * migration (Task 2, BLOCO 2) audita.
 */
function corpoDaFuncao(sqlBruto: string): string {
  const m = /\$function\$([\s\S]*?)\$function\$/.exec(sqlBruto);
  if (!m) {
    throw new Error("corpo de batch_upsert_orders não encontrado entre delimitadores $function$");
  }
  return m[1];
}

/**
 * Lista de colunas do `INSERT`, em ordem. A lista não tem parênteses
 * internos, então a captura até o primeiro `)` é exata.
 */
function colunasDoInsert(corpo: string): string[] {
  const sem = semComentarios(corpo);
  const m = /INSERT INTO public\.orders \(([^)]*)\)/.exec(sem);
  if (!m) {
    throw new Error("lista de colunas do INSERT INTO public.orders não encontrada");
  }
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Chaves `r->>'...'` da projeção do `SELECT`, em ordem. Cada uma das 44
 * expressões da projeção contém exatamente uma, e `r->>` não aparece em
 * nenhum outro lugar do corpo (verificado) — inclusive dentro de
 * `NULLIF(r->>'campo', '')::tipo`, que a expressão captura igual.
 */
function chavesDaProjecao(corpo: string): string[] {
  const sem = semComentarios(corpo);
  return [...sem.matchAll(/r->>'([a-z_]+)'/g)].map((m) => m[1]);
}

interface Divergencia {
  posicao: number;
  coluna: string;
  chave: string;
}

/**
 * Laço posicional: no primeiro índice divergente, nomeia a posição (1-based,
 * a MESMA numeração que o loop `1..44` da guarda SQL da migration usa), a
 * coluna do INSERT e a chave que ela estaria recebendo. `null` quando as
 * duas listas casam nome a nome, posição a posição.
 */
function primeiraDivergencia(cols: string[], chaves: string[]): Divergencia | null {
  const n = Math.max(cols.length, chaves.length);
  for (let i = 0; i < n; i++) {
    if (cols[i] !== chaves[i]) {
      return { posicao: i + 1, coluna: cols[i], chave: chaves[i] };
    }
  }
  return null;
}

function mensagemDivergencia(d: Divergencia): string {
  return `posicao ${d.posicao}: coluna '${d.coluna}' recebe o valor de '${d.chave}'`;
}

/**
 * Lê a substituição declarada na migration nova entre os marcadores
 * `-- gsd:padrao-inicio` / `-- gsd:padrao-fim` e devolve os dois literais SQL
 * (`padrao`, `troca`) como strings JS. O teste aplica
 * `corpo.replace(new RegExp(padrao), troca)` sobre o MESMO corpo histórico —
 * assim o teste e a migration não podem divergir: mexeu num, o outro acusa.
 */
function padraoDaMigration(): { padrao: string; troca: string } {
  const sql = ler(ARQ_MIGRATION_NOVA);
  const m = /--\s*gsd:padrao-inicio([\s\S]*?)--\s*gsd:padrao-fim/.exec(sql);
  if (!m) {
    throw new Error(
      "marcadores -- gsd:padrao-inicio / -- gsd:padrao-fim não encontrados em " + ARQ_MIGRATION_NOVA,
    );
  }
  const bloco = m[1];
  const literais = [...bloco.matchAll(/:=\s*'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1]);
  if (literais.length < 2) {
    throw new Error(
      `esperava 2 literais (padrao, troca) entre os marcadores, achou ${literais.length}`,
    );
  }
  return { padrao: literais[0], troca: literais[1] };
}

// ─── Test 1 — pino histórico ─────────────────────────────────────────────

describe("batch_upsert_orders — as 44 colunas do INSERT vs as 44 chaves da projeção", () => {
  const corpoHistorico = corpoDaFuncao(ler(ARQ_FUNCAO_HISTORICA));
  const colsHistorico = colunasDoInsert(corpoHistorico);
  const chavesHistorico = chavesDaProjecao(corpoHistorico);

  it(
    "pino histórico: 20260812210000 (já aplicada, NUNCA editar) desalinha na " +
      "posicao 36 -- pis_cofins_debito_com_difal recebe o valor de credito_pc_comissao",
    () => {
      const d = primeiraDivergencia(colsHistorico, chavesHistorico);
      expect(d).not.toBeNull();
      expect(d).toEqual({
        posicao: 36,
        coluna: "pis_cofins_debito_com_difal",
        chave: "credito_pc_comissao",
      });
      // Molde exigido pelo plano: a mensagem nomeia posição, coluna e chave.
      expect(mensagemDivergencia(d as Divergencia)).toBe(
        "posicao 36: coluna 'pis_cofins_debito_com_difal' recebe o valor de 'credito_pc_comissao'",
      );
    },
  );

  // ─── Test 3 — não vazio ─────────────────────────────────────────────────
  it("Test 3: as duas listas extraídas da migração histórica têm exatamente 44 elementos", () => {
    // Sem esta exigência, uma extração truncada devolveria duas listas
    // vazias (ou de mesmo tamanho menor), que são trivialmente iguais em
    // qualquer posição comparada — a prova passaria sem ter provado nada.
    expect(colsHistorico.length).toBe(44);
    expect(chavesHistorico.length).toBe(44);
  });

  // ─── Test 2 — o alvo (GREEN quando a migration nova existir) ───────────
  it("Test 2 (RED até a migration existir): a substituição declarada em 20260820220000 alinha as 44 posições", () => {
    expect(existe(ARQ_MIGRATION_NOVA)).toBe(true);

    const { padrao, troca } = padraoDaMigration();
    const corpoCorrigido = corpoHistorico.replace(new RegExp(padrao), troca);

    // A substituição realmente precisa ter acontecido -- senão o corpo
    // "corrigido" é byte a byte igual ao histórico e este teste passaria por
    // vacuidade, não por correção.
    expect(corpoCorrigido).not.toBe(corpoHistorico);

    const colsCorrigidas = colunasDoInsert(corpoCorrigido);
    const chavesCorrigidas = chavesDaProjecao(corpoCorrigido);

    expect(colsCorrigidas.length).toBe(44);
    expect(chavesCorrigidas.length).toBe(44);

    const d = primeiraDivergencia(colsCorrigidas, chavesCorrigidas);
    expect(d).toBeNull();
  });

  // ─── Test 4 — anti-drift (skip enquanto a migration não existir) ───────
  // `skipIf` em vez de deixar estourar ENOENT: enquanto a migration nova não
  // existe (RED da Task 1), não há nada para auditar aqui -- é diferente de
  // "falhou". A Task 2 faz este teste rodar de verdade.
  it.skipIf(!existe(ARQ_MIGRATION_NOVA))(
    "Test 4: o padrão lido do arquivo .sql não usa construção exclusiva do motor de regex do Postgres (\\m \\M \\y)",
    () => {
      const { padrao } = padraoDaMigration();
      // `\m`/`\M`/`\y` são limites de palavra da regex AVANÇADA do Postgres
      // -- não existem no motor de regex do JavaScript. Se a migration
      // usasse alguma dessas, `new RegExp(padrao)` aqui casaria diferente do
      // que `regexp_replace` casa no banco, e este teste provaria uma
      // substituição diferente da que o banco vai executar.
      expect(padrao).not.toMatch(/\\[mMy]/);
    },
  );
});
