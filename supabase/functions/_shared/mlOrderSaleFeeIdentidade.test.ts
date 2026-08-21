/**
 * mlOrderSaleFeeIdentidade.test.ts — prova a identidade de TRÊS parcelas do
 * `sale_fee` (Fase 223, quick 260821-inn) e audita a migration que a
 * substitui no banco.
 *
 * O DEFEITO QUE ESTE TESTE FECHA: a restrição
 * `ml_order_sale_fee_captura_identidade_gross_rebate_net`, aplicada em
 * 20/08, exige `gross - rebate == net`. Nasceu de uma amostra de 7 pedidos
 * em que `discount` valia exatamente ZERO em 7/7 — a parcela que faltava era
 * invisível. Contraexemplo medido ao vivo em 21/08, pedido
 * `2000015317143520`: `gross 49,00 · net 46,55 · rebate 0 · discount 2,45`.
 * `49,00 - 0 = 49,00 ≠ 46,55` (regra de DUAS parcelas, QUEBRA);
 * `49,00 - 0 - 2,45 = 46,55` (regra de TRÊS parcelas, FECHA ao centavo). É
 * essa linha que travou o backfill de 6.295 pedidos em produção.
 *
 * BLOCO 4 (auditoria do `.sql`) É O VERMELHO REAL DESTA CORREÇÃO: este plano
 * não aplica migration contra o banco (é portão do orquestrador), então não
 * existe teste de banco a ficar vermelho. Enquanto o arquivo de migration
 * não existir em disco, este bloco falha — molde exato de
 * `src/lib/fiscal/rebateSqlAudit.test.ts`, que existe pelo mesmo motivo. Os
 * blocos 1 a 3 são EVIDÊNCIA (passam assim que a amostra/fixture entram no
 * disco), não TDD — declarado de propósito, não fingir vermelho onde não há.
 *
 * Molde de leitura de arquivo: `readFileSync` + `resolve(process.cwd(), ...)`,
 * NUNCA `import.meta.url` — a suíte roda em jsdom, onde `import.meta.url` é
 * uma URL `http://` do servidor do Vite e `fileURLToPath` recusa (mesma nota
 * de `rebateSqlAudit.test.ts` / `mlOrderSaleFeeContrato.test.ts`).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ResultadoPedidoSaleFee, SaleFee } from "./mlOrderSaleFeeContrato";

const AMOSTRA_CAMINHO =
  "supabase/functions/_shared/__fixtures__/mlOrderSaleFee.amostra.json";
const DESCONTO_CAMINHO =
  "supabase/functions/_shared/__fixtures__/mlOrderSaleFee.desconto.json";
const MIGRATION_APLICADA_CAMINHO =
  "supabase/migrations/20260821100000_ml_order_sale_fee.sql";
const MIGRATION_NOVA_CAMINHO =
  "supabase/migrations/20260821130000_ml_order_sale_fee_identidade_discount.sql";

const PEDIDO_DESCONTO = 2000015317143520;

interface AmostraSaleFee {
  medido_em: string;
  results: ResultadoPedidoSaleFee[];
}

interface AmostraDescontoArquivo {
  medido_em: string;
  procedencia: string;
  results: ResultadoPedidoSaleFee[];
}

function lerArquivo(caminho: string): string {
  return readFileSync(resolve(process.cwd(), caminho), "utf8");
}

function lerAmostra(): AmostraSaleFee {
  return JSON.parse(lerArquivo(AMOSTRA_CAMINHO)) as AmostraSaleFee;
}

function lerDesconto(): AmostraDescontoArquivo {
  return JSON.parse(lerArquivo(DESCONTO_CAMINHO)) as AmostraDescontoArquivo;
}

/**
 * Remove comentários de linha (`--` até o fim da linha) — mesmo helper de
 * `rebateSqlAudit.test.ts`. Sem isso, a prosa do cabeçalho (que CITA a
 * fórmula para explicá-la) seria confundida com a expressão que ela
 * documenta.
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

/** Tolerância de centavo — mesmo helper dos irmãos `_shared`. */
const closeCents = (received: number | null, expected: number) => {
  expect(received).not.toBeNull();
  expect(Math.abs((received as number) - expected)).toBeLessThan(0.01);
};

/** `gross - rebate - COALESCE(discount, 0)`, dentro de um centavo, contra `net`. */
function fechaTresParcelas(saleFee: SaleFee): boolean {
  const { gross, net, rebate, discount } = saleFee;
  if (gross === null || net === null || rebate === null) return false;
  const descontoTratado = discount ?? 0;
  return Math.abs(gross - rebate - descontoTratado - net) <= 0.01;
}

const amostra = lerAmostra();
const desconto = lerDesconto();

function pedidoDesconto(): ResultadoPedidoSaleFee {
  const encontrado = desconto.results.find((r) => r.order_id === PEDIDO_DESCONTO);
  if (!encontrado) {
    throw new Error(`pedido ${PEDIDO_DESCONTO} não está na fixture do desconto`);
  }
  return encontrado;
}

// ─── Bloco 1 — a regra certa: TRÊS parcelas fecham nas DUAS amostras ───────

describe("identidade de TRÊS parcelas — gross - rebate - COALESCE(discount, 0) == net", () => {
  it.each(amostra.results)(
    "amostra de 20/08, pedido $order_id: fecha com a regra de três parcelas",
    (r: ResultadoPedidoSaleFee) => {
      expect(fechaTresParcelas(r.sale_fee)).toBe(true);
    },
  );

  it("pedido 2000015317143520 (fixture do desconto, medido em 21/08): fecha com a regra de três parcelas", () => {
    const { sale_fee } = pedidoDesconto();
    expect(fechaTresParcelas(sale_fee)).toBe(true);
    closeCents(
      (sale_fee.gross as number) - (sale_fee.rebate as number) - (sale_fee.discount ?? 0),
      sale_fee.net as number,
    );
  });
});

// ─── Bloco 2 — o contraexemplo: DUAS parcelas NÃO fecham no pedido do desconto ─

describe("contraexemplo — a regra de DUAS parcelas (gross - rebate == net) quebra no pedido com discount", () => {
  it("pedido 2000015317143520: gross - rebate difere de net em mais de um centavo — é 2,45", () => {
    const { gross, net, rebate, discount } = pedidoDesconto().sale_fee;
    expect(gross).not.toBeNull();
    expect(net).not.toBeNull();
    expect(rebate).not.toBeNull();

    const diferencaDuasParcelas = Math.abs((gross as number) - (rebate as number) - (net as number));
    // Esta é exatamente a linha que a restrição
    // ml_order_sale_fee_captura_identidade_gross_rebate_net (aplicada em
    // 20/08) recusava — e que travou o backfill de 6.295 pedidos.
    expect(diferencaDuasParcelas).toBeGreaterThan(0.01);
    closeCents(diferencaDuasParcelas, 2.45);
    closeCents(discount, 2.45);
  });

  it("a mesma linha fecha com o desconto entrando como terceira parcela", () => {
    const { gross, net, rebate, discount } = pedidoDesconto().sale_fee;
    const diferencaTresParcelas = Math.abs(
      (gross as number) - (rebate as number) - (discount as number) - (net as number),
    );
    expect(diferencaTresParcelas).toBeLessThan(0.01);
  });
});

// ─── Bloco 3 — a cegueira da amostra: discount é 0 em 7/7 em 20/08 ─────────

describe("a cegueira que produziu o defeito — discount vale 0 em 7/7 na amostra de 20/08", () => {
  it("todos os 7 pedidos de 20/08 têm discount exatamente 0 — a terceira parcela existia e era invisível", () => {
    expect(amostra.results).toHaveLength(7);
    for (const r of amostra.results) {
      expect(r.sale_fee.discount).toBe(0);
    }
  });

  // Este teste existe para a próxima pessoa não repetir o caminho: a regra
  // de duas parcelas era verdadeira NA AMOSTRA e falsa NO MUNDO — mesmo
  // mecanismo que já derrubou SUBTIPOS_COMISSAO (CVVFN, quick 260821-hap).
  it("logo, gross - rebate == net e gross - rebate - discount == net são INDISTINGUÍVEIS dentro da amostra de 20/08", () => {
    for (const r of amostra.results) {
      const { gross, net, rebate } = r.sale_fee;
      const duasParcelas = Math.abs((gross as number) - (rebate as number) - (net as number));
      expect(duasParcelas).toBeLessThan(0.01); // regra de duas parcelas TAMBÉM fecha aqui
      expect(fechaTresParcelas(r.sale_fee)).toBe(true); // e a de três também
    }
  });
});

// ─── Bloco 4 — auditoria do arquivo de migration que ainda não existe ─────

describe("migration 20260821130000 — auditoria do arquivo (o vermelho real desta correção)", () => {
  // 🔴 Leitura DELIBERADAMENTE preguiçosa, dentro de cada `it`, não no corpo
  // do `describe`: se o arquivo ainda não existe, `readFileSync` lança
  // durante a COLETA do describe (sincrona) e derruba o arquivo de teste
  // INTEIRO — inclusive os blocos 1 a 3, que precisam continuar verdes. É
  // esta leitura, e só ela, que fica vermelha enquanto a migration não
  // existe (o vermelho real desta correção).
  function lerMigrationNova(): { sqlBruto: string; corpo: string } {
    const sqlBruto = lerArquivo(MIGRATION_NOVA_CAMINHO);
    return { sqlBruto, corpo: semComentarios(sqlBruto) };
  }

  it("deriva a restrição antiga pelo nome, com remoção condicional a existir", () => {
    const { corpo } = lerMigrationNova();
    expect(
      /ALTER\s+TABLE\s+public\.ml_order_sale_fee_captura\s+DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+ml_order_sale_fee_captura_identidade_gross_rebate_net/i.test(
        corpo,
      ),
    ).toBe(true);
  });

  it("cria a restrição nova com nome novo — não reaproveita o nome antigo, que mentiria a fórmula", () => {
    const { corpo } = lerMigrationNova();
    expect(
      /ADD\s+CONSTRAINT\s+ml_order_sale_fee_captura_identidade_sale_fee\s+CHECK/i.test(corpo),
    ).toBe(true);
    expect(corpo).not.toMatch(
      /ADD\s+CONSTRAINT\s+ml_order_sale_fee_captura_identidade_gross_rebate_net/i,
    );
  });

  it("a expressão da restrição nova cita as três colunas de valor e segue condicionada a status <> 'ok'", () => {
    const { corpo } = lerMigrationNova();
    expect(/sale_fee_gross/.test(corpo)).toBe(true);
    expect(/sale_fee_rebate/.test(corpo)).toBe(true);
    expect(/sale_fee_discount/.test(corpo)).toBe(true);
    expect(/sale_fee_net/.test(corpo)).toBe(true);
    expect(/status\s*<>\s*'ok'/i.test(corpo)).toBe(true);
  });

  it("o desconto SEMPRE entra dentro de COALESCE na expressão — sem isso a restrição vira sempre-verdadeira (D-inn-03)", () => {
    const { corpo } = lerMigrationNova();
    expect(/COALESCE\s*\(\s*sale_fee_discount\s*,\s*0\s*\)/i.test(corpo)).toBe(true);
    // Casa a coluna precedida de subtração SEM COALESCE — não pode ocorrer.
    const descontoSemCoalesce = /[-−]\s*sale_fee_discount\b(?!\s*,\s*0\s*\))/;
    // A única forma aceitável é dentro de COALESCE( sale_fee_discount, 0 ) —
    // qualquer subtração direta da coluna fora desse envelope reprova.
    const semCoalesceEnvolvido = corpo.replace(
      /COALESCE\s*\(\s*sale_fee_discount\s*,\s*0\s*\)/gi,
      "",
    );
    expect(descontoSemCoalesce.test(semCoalesceEnvolvido)).toBe(false);
  });

  it("nenhum INSERT INTO — o arquivo não semeia dado", () => {
    const { corpo } = lerMigrationNova();
    expect(/^\s*INSERT\s+INTO\s+/im.test(corpo)).toBe(false);
  });

  it("existe guarda com RAISE EXCEPTION — falha alto se linha gravada violar a regra nova", () => {
    const { corpo } = lerMigrationNova();
    expect(/RAISE\s+EXCEPTION/i.test(corpo)).toBe(true);
  });

  it("nenhum UPDATE nem DELETE — a migration nunca ajusta nem apaga linha para a restrição entrar", () => {
    const { corpo } = lerMigrationNova();
    expect(/^\s*UPDATE\s+/im.test(corpo)).toBe(false);
    expect(/^\s*DELETE\s+FROM\s+/im.test(corpo)).toBe(false);
  });

  it("o único verbo de remoção do arquivo é sobre restrição — nada de tabela, coluna, função, política, índice ou view", () => {
    const { corpo } = lerMigrationNova();
    const drops = corpo.match(/DROP\s+\w+/gi) ?? [];
    expect(drops.length).toBeGreaterThan(0);
    for (const d of drops) {
      expect(/^DROP\s+CONSTRAINT$/i.test(d.trim())).toBe(true);
    }
    expect(/DROP\s+TABLE/i.test(corpo)).toBe(false);
    expect(/DROP\s+COLUMN/i.test(corpo)).toBe(false);
    expect(/DROP\s+FUNCTION/i.test(corpo)).toBe(false);
    expect(/DROP\s+POLICY/i.test(corpo)).toBe(false);
    expect(/DROP\s+INDEX/i.test(corpo)).toBe(false);
    expect(/DROP\s+VIEW/i.test(corpo)).toBe(false);
  });

  it("o texto bruto (com comentários) cita o pedido do contraexemplo — a procedência mora no arquivo, não só no commit", () => {
    const { sqlBruto } = lerMigrationNova();
    expect(sqlBruto).toContain(String(PEDIDO_DESCONTO));
  });

  it("comenta a restrição nova com a identidade certa", () => {
    const { sqlBruto } = lerMigrationNova();
    expect(
      /COMMENT\s+ON\s+CONSTRAINT\s+ml_order_sale_fee_captura_identidade_sale_fee/i.test(sqlBruto),
    ).toBe(true);
  });

  it("comenta a coluna do desconto com a palavra de unidade TOTAL do pedido", () => {
    const { sqlBruto } = lerMigrationNova();
    const regex =
      /COMMENT\s+ON\s+COLUMN\s+public\.ml_order_sale_fee_captura\.sale_fee_discount\s+IS\s*\n?([\s\S]*?);/i;
    const m = regex.exec(sqlBruto);
    expect(m, "comentário de sale_fee_discount não encontrado").not.toBeNull();
    const textoComentario = (m as RegExpExecArray)[1];
    expect(/TOTAL do pedido/i.test(textoComentario)).toBe(true);
  });

  it("o nome do arquivo novo ordena depois do da migration aplicada de 20/08", () => {
    expect(MIGRATION_NOVA_CAMINHO > MIGRATION_APLICADA_CAMINHO).toBe(true);
  });
});

describe("a migration aplicada de 20/08 permanece intacta (não é editada por esta correção)", () => {
  it("segue existindo e contém a restrição antiga que a migration nova deriva", () => {
    const sqlAplicada = lerArquivo(MIGRATION_APLICADA_CAMINHO);
    expect(sqlAplicada).toContain(
      "ml_order_sale_fee_captura_identidade_gross_rebate_net",
    );
  });
});
