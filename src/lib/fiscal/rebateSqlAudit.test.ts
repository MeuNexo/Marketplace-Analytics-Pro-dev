/**
 * rebateSqlAudit.test.ts — auditoria dos arquivos `.sql` do rebate por
 * pedido (Fase 223, plano 223-03, Task 3).
 *
 * O QUE ESTE TESTE PROTEGE: o custo líquido de perder o rebate — perder o
 * rebate NÃO custa o rebate cheio, porque a comissão maior gera crédito
 * maior de PIS/COFINS — precisa ter UMA definição só, no molde exato de
 * `difal_efeito_liquido` (222-15-R2). Uma segunda cópia da mesma aritmética
 * já custou R$ 3,85 por pedido no retrabalho 222-06-R/07-R.
 *
 * POR QUE ELE LÊ O ARQUIVO `.sql` EM VEZ DE CONSULTAR O BANCO: aplicar
 * migration é portão do orquestrador nesta fase — nenhuma migration da 223
 * foi aplicada em produção. Sem esta auditoria, uma segunda cópia da
 * aritmética, ou uma tabela sem RLS, só seriam pegas depois de o banco já
 * estar escrito — e ambas saem PLAUSÍVEIS: nenhum teste quebra, nenhuma tela
 * pisca. Aqui são pegas no commit. Molde: `difalRpcAudit.test.ts` (222-15-R2).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Caminhos relativos à RAIZ DO REPOSITÓRIO — `process.cwd()`, não
 * `import.meta.url`: a suíte roda em jsdom, onde `import.meta.url` é uma URL
 * `http://` do servidor do Vite e `fileURLToPath` recusa (mesma nota de
 * `difalRpcAudit.test.ts`/`icmsUfSeed.test.ts`).
 */
const MIGRATIONS = "supabase/migrations";

const ARQ_TABELAS = `${MIGRATIONS}/20260821100000_ml_order_sale_fee.sql`;
const ARQ_FUNCAO = `${MIGRATIONS}/20260821101000_rebate_efeito_liquido.sql`;

const ARQUIVOS_DA_FASE = [ARQ_TABELAS, ARQ_FUNCAO] as const;

function ler(caminho: string): string {
  return readFileSync(resolve(process.cwd(), caminho), "utf8");
}

/**
 * Remove comentários de linha (`--` até o fim da linha). Sem isso, uma frase
 * de cabeçalho explicando a aritmética seria contada como se FOSSE a
 * aritmética que ela está justamente proibindo/documentando — a mesma
 * colisão prosa-versus-grep de `difalRpcAudit.test.ts`.
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
 * A divisão do crédito pela comissão — o coração da fórmula do efeito
 * líquido. É essa expressão, e só ela, que a função única tem direito de
 * possuir; nenhum outro arquivo da fase pode reescrevê-la.
 */
const DIVISAO_CREDITO_POR_COMISSAO = /p_credito_pc_comissao\s*\/\s*p_comissao/g;

/** Expressão de RATEIO proibida: rebate dividido por comissão/total, ou o inverso. */
const RATEIO_PROIBIDO =
  /(?:sale_fee_)?rebate\w*\s*\/\s*\w*comiss[aã]o|comiss[aã]o\w*\s*\/\s*\w*rebate/i;

/** Colunas de VALOR novas cujo comentário precisa declarar a unidade. */
const COLUNAS_DE_VALOR_COM_UNIDADE = [
  { tabela: "ml_order_sale_fee", coluna: "detail_amount" },
  { tabela: "ml_order_sale_fee_captura", coluna: "sale_fee_gross" },
  { tabela: "ml_order_sale_fee_captura", coluna: "sale_fee_net" },
  { tabela: "ml_order_sale_fee_captura", coluna: "sale_fee_rebate" },
  { tabela: "ml_order_sale_fee_captura", coluna: "comissao_linhas" },
] as const;

// ─── A função única do efeito líquido ───────────────────────────────────────

describe("rebate_efeito_liquido — a definição única do custo líquido de perder o rebate", () => {
  const sql = ler(ARQ_FUNCAO);

  it("existe em arquivo próprio e cria a função com o nome esperado", () => {
    expect(
      /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.rebate_efeito_liquido/i.test(sql),
    ).toBe(true);
  });

  it("é declarada IMMUTABLE — o mesmo pedido não pode produzir dois custos", () => {
    expect(/\bIMMUTABLE\b/.test(semComentarios(sql))).toBe(true);
  });

  it("declara CALLED ON NULL INPUT: argumento nulo é ausência de parcela, nunca erro", () => {
    const corpo = semComentarios(sql);
    expect(/\bCALLED\s+ON\s+NULL\s+INPUT\b/i.test(corpo)).toBe(true);
    // STRICT / RETURNS NULL ON NULL INPUT faria a função devolver NULL
    // inteiro sempre que UM insumo faltasse — e um NULL somado ao total de
    // um pedido vira total nulo, lido como "sem rebate". O oposto do que se
    // quer (mesma régua de difal_efeito_liquido).
    expect(/\bRETURNS\s+NULL\s+ON\s+NULL\s+INPUT\b/i.test(corpo)).toBe(false);
    expect(/\)\s*RETURNS\s+numeric[\s\S]*?\bSTRICT\b/i.test(corpo)).toBe(false);
  });

  it("trata rebate ausente como zero, sem nunca deixar o resultado virar nulo", () => {
    expect(/COALESCE\s*\(\s*p_rebate\s*,\s*0\s*\)/i.test(semComentarios(sql))).toBe(true);
  });

  it("comissão nula, zero, ou crédito ausente produz ZERO de desconto — nunca desconto estimado", () => {
    const corpo = semComentarios(sql);
    expect(/p_comissao\s+IS\s+NULL/i.test(corpo)).toBe(true);
    expect(/p_comissao\s*=\s*0/i.test(corpo)).toBe(true);
    expect(/p_credito_pc_comissao\s+IS\s+NULL/i.test(corpo)).toBe(true);
  });

  it("é a ÚNICA a escrever a divisão do crédito pela comissão", () => {
    // Aqui a divisão aparece sobre os PARÂMETROS da função — o único lugar do
    // repositório onde ela tem direito de existir.
    expect(DIVISAO_CREDITO_POR_COMISSAO.test(semComentarios(sql))).toBe(true);
  });

  it("declara a unidade dos três argumentos e do retorno, nesta ordem: p_rebate, p_comissao, p_credito_pc_comissao", () => {
    const corpo = sql; // aqui a unidade é documentada NO comentário, então lê o bruto
    const posRebate = corpo.indexOf("p_rebate");
    const posComissao = corpo.indexOf("p_comissao", posRebate + 1);
    const posCredito = corpo.indexOf("p_credito_pc_comissao", posComissao + 1);
    expect(posRebate).toBeGreaterThanOrEqual(0);
    expect(posComissao).toBeGreaterThan(posRebate);
    expect(posCredito).toBeGreaterThan(posComissao);
    expect(/TOTAL do pedido/i.test(corpo)).toBe(true);
    expect(/POR UNIDADE/i.test(corpo)).toBe(true);
  });

  it("concede execução ao papel autenticado", () => {
    expect(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.rebate_efeito_liquido[\s\S]*?TO\s+authenticated/i.test(
        sql,
      ),
    ).toBe(true);
  });

  it("é aplicada ANTES das RPCs do 223-05 que a consomem (ordem por nome de arquivo)", () => {
    expect(ARQ_TABELAS < ARQ_FUNCAO).toBe(true);
  });
});

// ─── Nenhum arquivo desta fase remove objeto de banco existente ────────────

describe("nenhum arquivo desta fase remove objeto de banco existente", () => {
  it.each(ARQUIVOS_DA_FASE)("%s não contém DROP fora de comentário", (caminho) => {
    const corpo = semComentarios(ler(caminho));
    expect(/^\s*DROP\s+/im.test(corpo)).toBe(false);
  });
});

// ─── A migration das tabelas: sem dado semeado, sem staging, sem rateio ────

describe("migration das tabelas — sem dado semeado, sem staging, sem rateio", () => {
  const sql = ler(ARQ_TABELAS);
  const corpo = semComentarios(sql);

  it("não contém nenhuma inserção de dado — a configuração nasce vazia", () => {
    expect(/^\s*INSERT\s+INTO\s+/im.test(corpo)).toBe(false);
  });

  it("não menciona as duas tabelas de staging não versionadas (D-223-04)", () => {
    expect(corpo).not.toContain("ml_billing_moves_stage");
    expect(corpo).not.toContain("ml_billing_page_cursor");
  });

  it("não contém expressão de rateio: nenhuma divisão de rebate por comissão/total", () => {
    expect(RATEIO_PROIBIDO.test(corpo)).toBe(false);
  });

  it("liga RLS nas três tabelas, e cada policy passa pela checagem de organização", () => {
    const ligamentos = corpo.match(/ALTER\s+TABLE\s+public\.\w+\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi) ?? [];
    expect(ligamentos.length).toBe(3);
    const policies = corpo.match(/CREATE\s+POLICY[\s\S]*?USING\s*\([\s\S]*?\);/gi) ?? [];
    expect(policies.length).toBeGreaterThanOrEqual(3);
    for (const p of policies) {
      expect(/is_org_member/i.test(p)).toBe(true);
    }
  });
});

// ─── Toda coluna de valor nova declara a unidade no comentário ─────────────

describe("toda coluna de valor nova declara a unidade (TOTAL do pedido ou POR UNIDADE)", () => {
  const sqlBruto = ler(ARQ_TABELAS); // aqui a unidade é o TEXTO do comentário — não remover

  it.each(COLUNAS_DE_VALOR_COM_UNIDADE)(
    "$tabela.$coluna tem comentário com a palavra de unidade",
    ({ tabela, coluna }) => {
      const regex = new RegExp(
        `COMMENT\\s+ON\\s+COLUMN\\s+public\\.${tabela}\\.${coluna}\\s+IS\\s*\\n?([\\s\\S]*?);`,
        "i",
      );
      const m = regex.exec(sqlBruto);
      expect(m, `comentário de ${tabela}.${coluna} não encontrado`).not.toBeNull();
      const textoComentario = (m as RegExpExecArray)[1];
      expect(/TOTAL do pedido|POR UNIDADE/i.test(textoComentario)).toBe(true);
    },
  );
});

// ─── Fonte única: a divisão do crédito pela comissão aparece UMA vez só ────

describe("fonte única — a divisão do crédito pela comissão aparece uma única vez nos .sql da fase", () => {
  it("fora de comentário, em todos os arquivos .sql desta fase combinados", () => {
    const total = ARQUIVOS_DA_FASE.reduce((acc, caminho) => {
      const corpo = semComentarios(ler(caminho));
      const ocorrencias = corpo.match(DIVISAO_CREDITO_POR_COMISSAO) ?? [];
      return acc + ocorrencias.length;
    }, 0);
    expect(total).toBe(1);
  });
});
