/**
 * difalRpcAudit.test.ts — auditoria dos arquivos `.sql` do segundo cenário de
 * MCO (Fase 222, plano 222-15-R2, FISC-04/FISC-07).
 *
 * O QUE ESTE TESTE PROTEGE: o efeito líquido do DIFAL — o quanto entrar com o
 * DIFAL efetivamente CUSTA — precisa ter UMA definição só. Ele já esteve
 * escrito à mão em dois lugares (o resumo agregado no banco e o helper de
 * cenários no navegador), e a terceira e a quarta cópia, que é o que as duas
 * RPCs de margem precisariam, são exatamente como se reintroduz o defeito que
 * o retrabalho 222-06-R/07-R fechou: somar `difal_amount` por cima de
 * `tax_amount` mostrava imposto MAIOR e MCO MENOR que o real, em R$ 3,85 por
 * pedido. O DIFAL não custa o DIFAL cheio — custa o DIFAL menos o quanto ele
 * derruba o débito de PIS/COFINS.
 *
 * POR QUE ELE LÊ O ARQUIVO `.sql` EM VEZ DE CONSULTAR O BANCO: aplicar
 * migration é portão humano nesta fase (nenhuma migration da 222 foi aplicada
 * em produção). Sem esta auditoria, uma segunda cópia da aritmética só seria
 * pega depois de o banco já estar escrito — e um DIFAL errado sai PLAUSÍVEL:
 * nenhum teste quebra, nenhuma tela pisca. Aqui ele é pego no commit.
 *
 * POR QUE ELE TAMBÉM AUDITA O `GRANT`: as duas RPCs de margem estão em
 * produção AGORA e mudam de tipo de retorno, o que obriga a removê-las antes
 * de recriar. Remover uma função APAGA a lista de controle de acesso — este
 * repositório já perdeu ACL exatamente assim. Um `DROP` sem `GRANT` no mesmo
 * arquivo derruba quatro telas e o chat do Consultor, para sempre.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Caminhos relativos à RAIZ DO REPOSITÓRIO — `process.cwd()`, não
 * `import.meta.url`: a suíte roda em jsdom, onde `import.meta.url` é uma URL
 * `http://` do servidor do Vite e `fileURLToPath` recusa. Mesma nota de
 * `icmsUfSeed.test.ts` (222-10-R2).
 */
const MIGRATIONS = "supabase/migrations";

const ARQ_FUNCAO = `${MIGRATIONS}/20260812225000_difal_efeito_liquido.sql`;
const ARQ_RESUMO = `${MIGRATIONS}/20260812230000_get_difal_summary.sql`;
const ARQ_MARGEM = `${MIGRATIONS}/20260819200000_margin_with_ads_difal.sql`;
const ARQ_SERIE = `${MIGRATIONS}/20260819201000_orders_price_timeseries_difal.sql`;

/** Os três arquivos que CONSOMEM a função única — nenhum pode reescrevê-la. */
const ARQUIVOS_RPC = [
  ["resumo agregado de DIFAL", ARQ_RESUMO],
  ["margem por anúncio", ARQ_MARGEM],
  ["série de preço", ARQ_SERIE],
] as const;

function ler(caminho: string): string {
  return readFileSync(resolve(process.cwd(), caminho), "utf8");
}

/**
 * Remove comentários de linha (`--` até o fim da linha). Sem isso, uma frase
 * de cabeçalho explicando o defeito de R$ 3,85 seria contada como se fosse a
 * aritmética que ela está justamente proibindo — a mesma colisão
 * prosa-versus-grep que já apareceu em quatro planos desta fase.
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
 * A aritmética PROIBIDA: a subtração direta dos dois débitos de PIS/COFINS
 * (com ou sem `COALESCE` em volta, com ou sem prefixo de alias). É essa
 * expressão, e só ela, que a função única passa a possuir.
 */
const SUBTRACAO_PROIBIDA =
  /pis_cofins_debito\s*(?:,\s*0\s*\))?\s*\)?\s*-\s*(?:COALESCE\s*\(\s*)?[\w."]*pis_cofins_debito_com_difal/i;

/**
 * Colunas da `RETURNS TABLE`, em ordem de declaração. Comentários são
 * removidos ANTES da leitura: as colunas novas vêm com um bloco explicando
 * por que existem, e uma linha de prosa contada como coluna faria o teste
 * mentir nas duas direções.
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

/**
 * Ordem e nomes das 20 colunas que `get_margin_with_ads_by_product` já
 * devolve hoje (migration `20260683000000_margin_with_ads_marca.sql`). O
 * consumidor mapeia por NOME, mas qualquer troca de posição ou de nome
 * quebraria também quem lê posicionalmente — e não há como saber quem lê.
 */
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
];

/** As 13 colunas que `orders_price_timeseries` já devolve hoje. */
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
];

/** As 11 colunas que o resumo agregado já devolvia antes desta rodada. */
const RESUMO_COLUNAS_ANTIGAS = [
  "difal_calculado",
  "fcp_calculado",
  "difal_recolhido_pela_loja",
  "difal_cobrado_ml",
  "difal_previsto_nas_ufs_cobradas",
  "reducao_pc_por_difal",
  "pedidos_com_difal",
  "pedidos_difal_indefinido",
  "pedidos_nao_conciliados",
  "regua_recolhimento_configurada",
  "regua_cobranca_configurada",
];

/** Os quatro números do segundo cenário da margem por anúncio, no fim. */
const MARGEM_COLUNAS_NOVAS = [
  "difal_efeito",
  "pedidos_difal_indefinido",
  "lucro_com_difal",
  "lucro_pct_com_difal",
  "lucro_pos_ads_com_difal",
  "lucro_pct_pos_ads_com_difal",
];

/** O que a série de preço ganha: o efeito do intervalo e a contagem em aberto. */
const SERIE_COLUNAS_NOVAS = ["difal_efeito", "pedidos_difal_indefinido"];

// ─── A função única ──────────────────────────────────────────────────────────

describe("difal_efeito_liquido — a definição única do custo do DIFAL", () => {
  const sql = ler(ARQ_FUNCAO);

  it("existe em arquivo próprio e cria a função com o nome esperado", () => {
    expect(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.difal_efeito_liquido/i.test(sql)).toBe(
      true,
    );
  });

  it("é declarada IMMUTABLE — o mesmo pedido não pode produzir dois custos", () => {
    expect(/\bIMMUTABLE\b/.test(semComentarios(sql))).toBe(true);
  });

  it("declara CALLED ON NULL INPUT: argumento nulo é ausência de parcela, nunca erro nem resultado nulo silencioso", () => {
    const corpo = semComentarios(sql);
    expect(/\bCALLED\s+ON\s+NULL\s+INPUT\b/i.test(corpo)).toBe(true);
    // `STRICT` / `RETURNS NULL ON NULL INPUT` faria a função devolver NULL
    // inteiro sempre que UM insumo faltasse — e um NULL somado a um total vira
    // total nulo, que a tela leria como "sem DIFAL". É o oposto do que se quer.
    expect(/\bRETURNS\s+NULL\s+ON\s+NULL\s+INPUT\b/i.test(corpo)).toBe(false);
    expect(/\)\s*RETURNS\s+numeric[\s\S]*?\bSTRICT\b/i.test(corpo)).toBe(false);
  });

  it("trata cada termo ausente como zero, sem nunca deixar o resultado virar nulo", () => {
    const corpo = semComentarios(sql);
    expect(/COALESCE\s*\(\s*p_difal\s*,\s*0\s*\)/i.test(corpo)).toBe(true);
    expect(/COALESCE\s*\(\s*p_fcp\s*,\s*0\s*\)/i.test(corpo)).toBe(true);
  });

  it("é a ÚNICA a escrever a subtração dos dois débitos de PIS/COFINS", () => {
    // Aqui a subtração aparece sobre os PARÂMETROS da função, que é o único
    // lugar do repositório onde ela tem direito de existir. Nos três arquivos
    // de RPC, a mesma conta sobre as COLUNAS é proibida (bloco abaixo).
    expect(/p_pc_debito\s*-\s*p_pc_debito_com_difal/i.test(semComentarios(sql))).toBe(true);
  });

  it("é aplicada ANTES do resumo agregado que passa a consumi-la (ordem por nome de arquivo)", () => {
    // O resumo é corrigido NA ORIGEM em vez de ganhar migration corretiva por
    // cima — o que só é possível porque nada da fase foi aplicado ainda.
    expect(ARQ_FUNCAO < ARQ_RESUMO).toBe(true);
  });

  it("concede execução ao papel autenticado — as três RPCs a chamam sob privilégio de invocador", () => {
    expect(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.difal_efeito_liquido[\s\S]*?TO\s+authenticated/i.test(sql)).toBe(
      true,
    );
  });
});

// ─── Fonte única: nenhuma RPC reescreve a aritmética ─────────────────────────

describe("as três RPCs consomem a função única e não a reescrevem", () => {
  it.each(ARQUIVOS_RPC)("%s referencia difal_efeito_liquido pelo nome", (_nome, caminho) => {
    expect(semComentarios(ler(caminho))).toContain("difal_efeito_liquido");
  });

  it.each(ARQUIVOS_RPC)(
    "%s NÃO reescreve a subtração dos dois débitos de PIS/COFINS fora de comentário",
    (_nome, caminho) => {
      expect(SUBTRACAO_PROIBIDA.test(semComentarios(ler(caminho)))).toBe(false);
    },
  );

  it.each(ARQUIVOS_RPC)(
    "%s declara no cabeçalho que a aplicação é portão humano",
    (_nome, caminho) => {
      expect(/port[aã]o humano/i.test(ler(caminho))).toBe(true);
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
    // Não é obrigatório remover — mas quem remove tem de reconceder.
    for (const alvo of alvos) {
      const concede = new RegExp(
        `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${alvo}[\\s\\S]*?TO\\s+authenticated`,
        "i",
      );
      expect(concede.test(corpo)).toBe(true);
    }
    // E os três reconcedem, de fato: nenhum deles pode sair deste plano sem
    // GRANT, porque os três recriam a própria função.
    expect(alvos.length).toBeGreaterThan(0);
  });
});

// ─── Retrocompatibilidade das listas de retorno ──────────────────────────────

describe("margem por anúncio — colunas novas no FIM, antigas intocadas", () => {
  const sql = ler(ARQ_MARGEM);
  const colunas = colunasDoRetorno(sql);

  it("preserva as 20 colunas antigas, no mesmo nome e na mesma posição", () => {
    expect(colunas.slice(0, MARGEM_COLUNAS_ANTIGAS.length)).toEqual(MARGEM_COLUNAS_ANTIGAS);
  });

  it("acrescenta o efeito líquido, a contagem em aberto e os quatro números do segundo cenário, no fim", () => {
    expect(colunas.slice(MARGEM_COLUNAS_ANTIGAS.length)).toEqual(MARGEM_COLUNAS_NOVAS);
  });

  it("mantém a assinatura de argumentos (UUID, TEXT[], DATE, DATE)", () => {
    expect(
      /DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.get_margin_with_ads_by_product\s*\(\s*UUID\s*,\s*TEXT\[\]\s*,\s*DATE\s*,\s*DATE\s*\)/i.test(
        sql,
      ),
    ).toBe(true);
    expect(/p_org_id\s+UUID[\s\S]*?p_user_ids\s+TEXT\[\][\s\S]*?p_from\s+DATE[\s\S]*?p_to\s+DATE/i.test(sql)).toBe(
      true,
    );
  });

  it("deriva os dois lucros da MESMA expressão, trocando só o termo de imposto", () => {
    const corpo = semComentarios(sql);
    // Um único termo de lucro antes do imposto, e dois termos de imposto —
    // é isso que impede a segunda expressão de divergir da primeira.
    expect(corpo).toContain("lucro_antes_imposto");
    expect(corpo).toContain("imposto_sem_difal");
    expect(corpo).toContain("imposto_com_difal");
    expect(
      /SUM\s*\(\s*p\.lucro_antes_imposto\s*-\s*p\.imposto_sem_difal\s*\)/i.test(corpo),
    ).toBe(true);
    expect(
      /SUM\s*\(\s*p\.lucro_antes_imposto\s*-\s*p\.imposto_com_difal\s*\)/i.test(corpo),
    ).toBe(true);
  });

  it("continua com privilégio de invocador — nenhum bypass de tenant entra junto", () => {
    expect(/SECURITY\s+INVOKER/i.test(sql)).toBe(true);
    expect(/SECURITY\s+DEFINER/i.test(semComentarios(sql))).toBe(false);
  });
});

describe("série de preço — colunas novas no FIM, antigas intocadas", () => {
  const sql = ler(ARQ_SERIE);
  const colunas = colunasDoRetorno(sql);

  it("preserva as 13 colunas antigas, no mesmo nome e na mesma posição", () => {
    expect(colunas.slice(0, SERIE_COLUNAS_ANTIGAS.length)).toEqual(SERIE_COLUNAS_ANTIGAS);
  });

  it("acrescenta o efeito líquido do intervalo e a contagem em aberto, no fim", () => {
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

  it("NÃO calcula lucro: a composição dessa tela é no navegador e continua sendo", () => {
    expect(colunas).not.toContain("lucro");
    expect(colunas).not.toContain("lucro_com_difal");
  });
});

describe("resumo agregado — corrigido na origem, com o denominador da alíquota de referência", () => {
  const sql = ler(ARQ_RESUMO);
  const colunas = colunasDoRetorno(sql);

  it("preserva as 11 colunas antigas, no mesmo nome e na mesma posição", () => {
    expect(colunas.slice(0, RESUMO_COLUNAS_ANTIGAS.length)).toEqual(RESUMO_COLUNAS_ANTIGAS);
  });

  it("devolve receita_base no fim — sem denominador não há alíquota de referência", () => {
    expect(colunas.slice(RESUMO_COLUNAS_ANTIGAS.length)).toEqual(["receita_base"]);
  });

  it("tira a receita base dos MESMOS pedidos, não de uma segunda consulta", () => {
    const corpo = semComentarios(sql);
    // A soma sai do mesmo CTE `pedidos` que já produz o DIFAL — dois recortes
    // diferentes dariam uma razão que não é razão de nada.
    expect(/SUM\s*\(\s*(?:COALESCE\s*\(\s*)?p\.receita_bruta/i.test(corpo)).toBe(true);
  });
});
