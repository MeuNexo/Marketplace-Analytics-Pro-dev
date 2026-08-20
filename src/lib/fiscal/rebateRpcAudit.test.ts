/**
 * rebateRpcAudit.test.ts — auditoria dos arquivos `.sql` do terceiro cenário
 * de MCO (Fase 223, plano 223-05, REB-02/REB-03/REB-04).
 *
 * O QUE ESTE TESTE PROTEGE: o efeito líquido do REBATE — o quanto perder o
 * rebate efetivamente CUSTA — tem UMA definição só (`rebate_efeito_liquido`,
 * 223-03). As duas RPCs de margem que passam a consumi-la são exatamente
 * onde se reintroduziria o defeito que o retrabalho 222-06-R/07-R fechou
 * para o DIFAL: somar o rebate cru sobre um lucro já pronto mostra imposto
 * MAIOR e MCO MENOR que o real. O rebate não custa o rebate cheio — custa o
 * rebate menos o quanto ele deixaria de gerar de crédito de PIS/COFINS.
 *
 * TAMBÉM PROTEGE A PREMISSA DE JUNÇÃO: a fase começou supondo carrinho com
 * N linhas em `orders` por pedido, exigindo ratear o rebate. Medido em
 * produção (223-01): `orders` é 1:1 com o pedido do ML — a junção com
 * `ml_order_sale_fee_captura` é direta pela chave
 * (organization_id, ml_order_id), sem rateio. No lugar do rateio entra uma
 * GUARDA DE CONFERÊNCIA: `sale_fee_net` só autoriza o rebate quando bate com
 * `orders.comissao × orders.quantidade` (não `comissao` sozinha — a
 * comissão gravada é POR UNIDADE, a tarifa da fatura é TOTAL do pedido; sem
 * o multiplicador, 62 pedidos bons da Pé Vermeio sairiam como divergentes) e
 * quando não há estorno por cancelamento (o `sale_fee` da fatura não enxerga
 * o cancelamento, medido).
 *
 * POR QUE ELE LÊ O ARQUIVO `.sql` EM VEZ DE CONSULTAR O BANCO: aplicar
 * migration é portão do orquestrador nesta fase (nenhuma migration da 223
 * foi aplicada em produção). Sem esta auditoria, uma segunda cópia da
 * aritmética, uma dupla contagem do rebate ou um rateio reintroduzido só
 * seriam pegos depois de o banco já estar escrito — e o defeito sai
 * PLAUSÍVEL: nenhum teste quebra, nenhuma tela pisca. Aqui ele é pego no
 * commit, no molde exato de `difalRpcAudit.test.ts` (222-15-R2).
 *
 * POR QUE ELE TAMBÉM AUDITA O `GRANT`: as duas RPCs mudam de tipo de
 * retorno, o que obriga a removê-las antes de recriar. Remover uma função
 * APAGA a lista de controle de acesso — este repositório já perdeu ACL
 * exatamente assim.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Caminhos relativos à RAIZ DO REPOSITÓRIO — `process.cwd()`, não
 * `import.meta.url`: a suíte roda em jsdom, onde `import.meta.url` é uma URL
 * `http://` do servidor do Vite e `fileURLToPath` recusa. Mesma nota de
 * `difalRpcAudit.test.ts`.
 */
const MIGRATIONS = "supabase/migrations";

const ARQ_FUNCAO = `${MIGRATIONS}/20260821101000_rebate_efeito_liquido.sql`;
const ARQ_MARGEM = `${MIGRATIONS}/20260821110000_margin_with_ads_rebate.sql`;
const ARQ_SERIE = `${MIGRATIONS}/20260821111000_orders_price_timeseries_rebate.sql`;

/** Os dois arquivos que CONSOMEM a função única — nenhum pode reescrevê-la. */
const ARQUIVOS_RPC = [
  ["margem por anúncio", ARQ_MARGEM],
  ["série de preço", ARQ_SERIE],
] as const;

function ler(caminho: string): string {
  return readFileSync(resolve(process.cwd(), caminho), "utf8");
}

/**
 * Remove comentários de linha (`--` até o fim da linha). Sem isso, uma frase
 * de cabeçalho explicando a dupla contagem proibida seria contada como se
 * fosse a aritmética que ela está justamente proibindo — a mesma colisão
 * prosa-versus-grep que já apareceu em planos anteriores desta fase.
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
 * A divisão PROIBIDA fora da função única: `credito_pc_comissao / comissao`
 * (com ou sem alias, com ou sem espaços). É essa razão, e só ela, que
 * `rebate_efeito_liquido` tem direito de escrever.
 */
const DIVISAO_CREDITO_PROIBIDA = /credito_pc_comissao\s*\/\s*[\w."]*comissao/i;

/**
 * Qualquer divisão POR comissão nos arquivos de RPC é proibida — é a
 * assinatura de um rateio do rebate (dividir o rebate, ou qualquer outra
 * grandeza, pela comissão total do anúncio/intervalo). A única divisão por
 * comissão que existe no repositório mora dentro de `rebate_efeito_liquido`,
 * fora destes dois arquivos.
 */
const DIVISAO_POR_COMISSAO = /\/\s*[\w."]*comissao\b/i;

/**
 * A subtração PROIBIDA: descontar o rebate de `comissao` em qualquer
 * expressão. `orders.comissao` já É o valor líquido do rebate (medido em
 * 223-01: é o `sale_fee.net`, não o `gross`) — descontar de novo é dupla
 * contagem, e já aconteceu uma vez nesta casa.
 */
const SUBTRACAO_REBATE_DE_COMISSAO =
  /comissao\s*(?:,\s*0\s*\))?\s*\)?\s*-\s*(?:COALESCE\s*\(\s*)?[\w."]*rebate/i;

/**
 * A expressão que PROVA a presença do multiplicador `quantidade` na
 * conferência: `sale_fee_net` comparado contra `comissao` MULTIPLICADA por
 * `quantidade`, nunca contra `comissao` sozinha.
 */
const CONFERENCIA_COM_MULTIPLICADOR =
  /sale_fee_net\s*-\s*COALESCE\s*\(\s*[\w."]*comissao\s*,\s*0\s*\)\s*\*\s*[\w."]*quantidade/i;

/**
 * A guarda de estorno DENTRO da mesma decisão que afirma o rebate: o `WHEN`
 * que testa `status = 'ok'` precisa também testar `tem_estorno = false`
 * antes de chegar ao `THEN` que devolve `sale_fee_rebate`.
 */
const GUARDA_ESTORNO_NA_DECISAO =
  /WHEN\s+c\.status\s*=\s*'ok'[\s\S]{0,160}tem_estorno\s*=\s*false[\s\S]{0,160}THEN\s+c\.sale_fee_rebate/i;

/**
 * Colunas da `RETURNS TABLE`, em ordem de declaração. Comentários são
 * removidos ANTES da leitura — mesmo helper de `difalRpcAudit.test.ts`.
 */
function colunasDoRetorno(sqlBruto: string): string[] {
  const sql = semComentarios(sqlBruto);
  const m = /RETURNS\s+TABLE\s*\(([\s\S]*?)\)\s*LANGUAGE/i.exec(sql);
  if (!m) return [];
  const corpo = m[1];
  const colunas: string[] = [];
  let profundidade = 0;
  let atual = "";
  for (const ch of corpo) {
    if (ch === "(") profundidade++;
    if (ch === ")") profundidade--;
    if (ch === "," && profundidade === 0) {
      colunas.push(atual);
      atual = "";
    } else {
      atual += ch;
    }
  }
  colunas.push(atual);
  return colunas
    .map((c) => c.trim().split(/\s+/)[0])
    .filter((c) => c.length > 0);
}

/** As 26 colunas que `get_margin_with_ads_by_product` já devolvia antes desta rodada (20 originais + 6 do par DIFAL, 222-15-R2). */
const MARGEM_COLUNAS_ANTIGAS = [
  "item_id",
  "titulo",
  "sku",
  "listing_type",
  "receita",
  "cmv",
  "comissao",
  "frete",
  "impostos",
  "lucro",
  "lucro_pct",
  "pedidos",
  "unidades",
  "has_cmv",
  "ads_spend",
  "ads_attributed_orders",
  "lucro_pos_ads",
  "lucro_pct_pos_ads",
  "ads_no_sale",
  "marca",
  "difal_efeito",
  "pedidos_difal_indefinido",
  "lucro_com_difal",
  "lucro_pct_com_difal",
  "lucro_pos_ads_com_difal",
  "lucro_pct_pos_ads_com_difal",
];

/** As 15 colunas que `orders_price_timeseries` já devolvia antes desta rodada (13 originais + 2 do par DIFAL). */
const SERIE_COLUNAS_ANTIGAS = [
  "bucket",
  "preco_medio",
  "preco_min",
  "preco_max",
  "qtd",
  "total",
  "orders",
  "cmv",
  "comissao",
  "frete",
  "qtd_sem_custo",
  "impostos",
  "qtd_sem_imposto",
  "difal_efeito",
  "pedidos_difal_indefinido",
];

/** Os oito números do terceiro cenário na margem por anúncio, no fim. */
const MARGEM_COLUNAS_NOVAS = [
  "rebate_bruto",
  "rebate_efeito",
  "pedidos_sem_captura_rebate",
  "pedidos_rebate_nao_conferido",
  "lucro_sem_rebate",
  "lucro_pct_sem_rebate",
  "lucro_pos_ads_sem_rebate",
  "lucro_pct_pos_ads_sem_rebate",
];

/** O que a série de preço ganha: o insumo bruto/efeito e as duas contagens. */
const SERIE_COLUNAS_NOVAS = [
  "rebate_bruto",
  "rebate_efeito",
  "pedidos_sem_captura_rebate",
  "pedidos_rebate_nao_conferido",
];

// ─── A função única ──────────────────────────────────────────────────────────

describe("rebate_efeito_liquido — a definição única do custo de perder o rebate", () => {
  const sql = ler(ARQ_FUNCAO);

  it("existe em arquivo próprio e cria a função com o nome esperado", () => {
    expect(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.rebate_efeito_liquido/i.test(sql)).toBe(
      true,
    );
  });

  it("é declarada IMMUTABLE — o mesmo pedido não pode produzir dois custos", () => {
    expect(/\bIMMUTABLE\b/.test(semComentarios(sql))).toBe(true);
  });

  it("declara CALLED ON NULL INPUT: argumento nulo é ausência de parcela, nunca erro nem resultado nulo silencioso", () => {
    const corpo = semComentarios(sql);
    expect(/\bCALLED\s+ON\s+NULL\s+INPUT\b/i.test(corpo)).toBe(true);
    expect(/\bRETURNS\s+NULL\s+ON\s+NULL\s+INPUT\b/i.test(corpo)).toBe(false);
    expect(/\)\s*RETURNS\s+numeric[\s\S]*?\bSTRICT\b/i.test(corpo)).toBe(false);
  });

  it("é a ÚNICA a escrever a razão credito_pc_comissao / comissao", () => {
    expect(DIVISAO_CREDITO_PROIBIDA.test(semComentarios(sql))).toBe(true);
  });

  it("concede execução ao papel autenticado — as duas RPCs a chamam sob privilégio de invocador", () => {
    expect(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.rebate_efeito_liquido[\s\S]*?TO\s+authenticated/i.test(
        sql,
      ),
    ).toBe(true);
  });

  it("é aplicada ANTES das duas RPCs que passam a consumi-la (ordem por nome de arquivo)", () => {
    expect(ARQ_FUNCAO < ARQ_MARGEM).toBe(true);
    expect(ARQ_FUNCAO < ARQ_SERIE).toBe(true);
  });
});

// ─── Fonte única: nenhuma RPC reescreve a aritmética, nem inventa rateio ─────

describe("as duas RPCs consomem a função única e não a reescrevem", () => {
  it.each(ARQUIVOS_RPC)("%s referencia rebate_efeito_liquido pelo nome", (_nome, caminho) => {
    expect(semComentarios(ler(caminho))).toContain("rebate_efeito_liquido");
  });

  it.each(ARQUIVOS_RPC)(
    "%s NÃO reescreve a divisão credito_pc_comissao / comissao fora de comentário",
    (_nome, caminho) => {
      expect(DIVISAO_CREDITO_PROIBIDA.test(semComentarios(ler(caminho)))).toBe(false);
    },
  );

  it.each(ARQUIVOS_RPC)(
    "%s NÃO contém nenhuma divisão por comissão — não há rateio do rebate nesta fase",
    (_nome, caminho) => {
      expect(DIVISAO_POR_COMISSAO.test(semComentarios(ler(caminho)))).toBe(false);
    },
  );

  it.each(ARQUIVOS_RPC)(
    "%s NÃO subtrai o rebate de comissao em nenhuma expressão — comissao já é líquida",
    (_nome, caminho) => {
      expect(SUBTRACAO_REBATE_DE_COMISSAO.test(semComentarios(ler(caminho)))).toBe(false);
    },
  );

  it.each(ARQUIVOS_RPC)(
    "%s compara sale_fee_net contra comissao MULTIPLICADA por quantidade, nunca sozinha",
    (_nome, caminho) => {
      expect(CONFERENCIA_COM_MULTIPLICADOR.test(semComentarios(ler(caminho)))).toBe(true);
    },
  );

  it.each(ARQUIVOS_RPC)(
    "%s traz a guarda de estorno (tem_estorno = false) na mesma decisão que afirma o rebate",
    (_nome, caminho) => {
      expect(GUARDA_ESTORNO_NA_DECISAO.test(semComentarios(ler(caminho)))).toBe(true);
    },
  );

  it.each(ARQUIVOS_RPC)(
    "%s junta a captura pela chave do pedido (organization_id + ml_order_id), sem rateio",
    (_nome, caminho) => {
      const corpo = semComentarios(ler(caminho));
      expect(/LEFT\s+JOIN\s+public\.ml_order_sale_fee_captura/i.test(corpo)).toBe(true);
      expect(/ml_order_id\s*=\s*[\w."]*ml_order_id/i.test(corpo)).toBe(true);
    },
  );
});

// ─── A ACL não pode morrer no DROP ───────────────────────────────────────────

describe("todo arquivo que remove e recria função reemite a concessão de execução", () => {
  it.each(ARQUIVOS_RPC)("%s", (_nome, caminho) => {
    const sql = ler(caminho);
    const corpo = semComentarios(sql);
    const alvos = [...corpo.matchAll(/DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?public\.(\w+)/gi)].map(
      (m) => m[1],
    );
    for (const alvo of alvos) {
      const concede = new RegExp(
        `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${alvo}[\\s\\S]*?TO\\s+authenticated`,
        "i",
      );
      expect(concede.test(corpo)).toBe(true);
    }
    expect(alvos.length).toBeGreaterThan(0);
  });
});

// ─── Retrocompatibilidade das listas de retorno ──────────────────────────────

describe("margem por anúncio — colunas novas no FIM, antigas intocadas", () => {
  const sql = ler(ARQ_MARGEM);
  const colunas = colunasDoRetorno(sql);

  it("preserva as 26 colunas antigas, no mesmo nome e na mesma posição", () => {
    expect(colunas.slice(0, MARGEM_COLUNAS_ANTIGAS.length)).toEqual(MARGEM_COLUNAS_ANTIGAS);
  });

  it("acrescenta os oito números do terceiro cenário (rebate), no fim", () => {
    expect(colunas.slice(MARGEM_COLUNAS_ANTIGAS.length)).toEqual(MARGEM_COLUNAS_NOVAS);
  });

  it("mantém a assinatura de argumentos (UUID, TEXT[], DATE, DATE)", () => {
    expect(
      /DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.get_margin_with_ads_by_product\s*\(\s*UUID\s*,\s*TEXT\[\]\s*,\s*DATE\s*,\s*DATE\s*\)/i.test(
        sql,
      ),
    ).toBe(true);
    expect(
      /p_org_id\s+UUID[\s\S]*?p_user_ids\s+TEXT\[\][\s\S]*?p_from\s+DATE[\s\S]*?p_to\s+DATE/i.test(
        sql,
      ),
    ).toBe(true);
  });

  it("deriva lucro_sem_rebate da MESMA expressão de lucro, sem misturar com o termo de DIFAL", () => {
    const corpo = semComentarios(sql);
    expect(
      /SUM\s*\(\s*p\.lucro_antes_imposto\s*-\s*p\.imposto_sem_difal\s*-\s*COALESCE\s*\(\s*p\.rebate_efeito_pedido/i.test(
        corpo,
      ),
    ).toBe(true);
    // A mesma linha nunca referencia o termo de imposto COM DIFAL — as duas
    // réguas fiscais (rebate e DIFAL) não se cruzam na mesma expressão.
    const linhaLucroSemRebate = corpo
      .split("\n")
      .find((l) => l.includes("lucro_sem_rebate_bruto"));
    expect(linhaLucroSemRebate ?? "").not.toContain("imposto_com_difal");
  });

  it("expõe lucro_sem_rebate como NULL quando rebate_efeito é NULL — ausência nunca vira zero", () => {
    const corpo = semComentarios(sql);
    expect(/WHEN\s+o\.rebate_efeito\s+IS\s+NULL\s+THEN\s+NULL/i.test(corpo)).toBe(true);
  });

  it("soma rebate_bruto e rebate_efeito sem substituir nulo por zero", () => {
    const corpo = semComentarios(sql);
    expect(/SUM\s*\(\s*p\.rebate_do_pedido\s*\)\s*AS\s*rebate_bruto/i.test(corpo)).toBe(true);
    expect(/SUM\s*\(\s*p\.rebate_efeito_pedido\s*\)\s*AS\s*rebate_efeito/i.test(corpo)).toBe(true);
    // Nenhum COALESCE(..., 0) envolvendo diretamente essas duas somas.
    expect(/COALESCE\s*\(\s*SUM\s*\(\s*p\.rebate_do_pedido/i.test(corpo)).toBe(false);
    expect(/COALESCE\s*\(\s*SUM\s*\(\s*p\.rebate_efeito_pedido/i.test(corpo)).toBe(false);
  });

  it("continua com privilégio de invocador — nenhum bypass de tenant entra junto", () => {
    expect(/SECURITY\s+INVOKER/i.test(sql)).toBe(true);
    expect(/SECURITY\s+DEFINER/i.test(semComentarios(sql))).toBe(false);
  });
});

describe("série de preço — colunas novas no FIM, antigas intocadas", () => {
  const sql = ler(ARQ_SERIE);
  const colunas = colunasDoRetorno(sql);

  it("preserva as 15 colunas antigas, no mesmo nome e na mesma posição", () => {
    expect(colunas.slice(0, SERIE_COLUNAS_ANTIGAS.length)).toEqual(SERIE_COLUNAS_ANTIGAS);
  });

  it("acrescenta o insumo do terceiro cenário (rebate), no fim", () => {
    expect(colunas.slice(SERIE_COLUNAS_ANTIGAS.length)).toEqual(SERIE_COLUNAS_NOVAS);
  });

  it("preserva os seis argumentos, inclusive o filtro de variação no fim", () => {
    expect(
      /DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.orders_price_timeseries\s*\(\s*text\s*,\s*text\[\]\s*,\s*date\s*,\s*date\s*,\s*text\s*,\s*text\s*\)/i.test(
        sql,
      ),
    ).toBe(true);
    expect(/_sku\s+text\s+DEFAULT\s+NULL/i.test(sql)).toBe(true);
  });

  it("NÃO calcula lucro nem cenário pronto: entrega insumo, a composição continua no navegador", () => {
    expect(colunas).not.toContain("lucro");
    expect(colunas).not.toContain("lucro_sem_rebate");
    expect(ler(ARQ_SERIE)).toMatch(/insumo/i);
  });

  it("soma rebate_bruto e rebate_efeito sem substituir nulo por zero", () => {
    const corpo = semComentarios(sql);
    expect(/SUM\s*\(\s*p\.rebate_do_pedido\s*\)::numeric\s*AS\s*rebate_bruto/i.test(corpo)).toBe(
      true,
    );
    expect(
      /SUM\s*\(\s*p\.rebate_efeito_pedido\s*\)::numeric\s*AS\s*rebate_efeito/i.test(corpo),
    ).toBe(true);
  });

  it("continua com privilégio de invocador, sem parâmetro de organização", () => {
    expect(/SECURITY\s+INVOKER/i.test(sql)).toBe(true);
    expect(/SECURITY\s+DEFINER/i.test(semComentarios(sql))).toBe(false);
    expect(semComentarios(sql)).not.toContain("p_org_id");
  });
});
