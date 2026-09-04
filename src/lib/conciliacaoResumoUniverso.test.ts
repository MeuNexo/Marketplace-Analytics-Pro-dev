/**
 * conciliacaoResumoUniverso.test.ts — auditoria estática da correção de G-02 e
 * G-03 do `225-VERIFICATION.md` (Fase 225, passagem corretiva 225-07).
 *
 * 🔴 G-02 — O AVISO DE LISTA INCOMPLETA VIROU CÓDIGO MORTO.
 *
 * O plano 06 acrescentou `conciliacao_frete_linhas` ao `get_casos_conciliacao`
 * (union all) e NÃO ao `get_conciliacao_resumo`. Os dois passaram a descrever
 * universos diferentes: o resumo conta só a base (1.926 linhas medidas em S-06)
 * enquanto a lista carrega base + frete (~3.167, com as 1.241 de F-02). Como a
 * tela compara `linhas.length` contra `resumo.linhas_total`, a conta
 * `faltamLinhas = totalReal − linhas.length` NUNCA pode ser positiva, e o Alert
 * "A lista não está completa" ficou permanentemente inerte.
 *
 * Ele existia para uma coisa só: D-225-16, *"nenhum caso expira sem eu ter
 * olhado"*. Uma guarda que não pode disparar não protege nada — é pior que não
 * ter guarda, porque a tela parece vigiada.
 *
 * Efeito colateral no mesmo lugar: `valor_desconhecido_n` subconta as linhas de
 * frete sem valor apurado, e a nota de rodapé diz um número menor que o que a
 * própria lista mostra.
 *
 * 🔴 G-03 — PAGINAÇÃO POR `OFFSET` SOBRE ORDENAÇÃO SEM DESEMPATE.
 *
 * `get_casos_conciliacao` ordenava por `dias_restantes asc nulls last,
 * diferenca desc nulls last` e nada mais. O hook pagina por OFFSET em até 40
 * chamadas INDEPENDENTES, cada uma reexecutando a função inteira, e há 1.188
 * linhas `frete_sem_vigencia_na_venda` com `diferenca` NULA — empate maciço. Se
 * a ordem variar entre duas chamadas (plano diferente, linha nova gravada pelo
 * `sync-mp-releases` que roda de 3 em 3 horas), uma linha repete numa página e
 * some de outra. S-07 mediu duplicata DENTRO de uma consulta, nunca ENTRE
 * páginas — o modo de falha que D-225-16 proíbe, por um caminho que nenhuma
 * sonda desta fase exercitou.
 *
 * ⚠️ POR QUE LER O `.sql` DO DISCO: aplicar migration é portão do orquestrador
 * nesta fase — o executor não alcança `ckcdevcxgvueywivefgx`. Esta auditoria
 * prova a FORMA. A prova de COMPORTAMENTO está DENTRO da própria migration, em
 * duas invariantes que rodam contra produção e abortam a aplicação: o total do
 * resumo conferido contra a contagem do universo unido, e a unicidade da chave
 * de ordenação medida linha a linha.
 *
 * Molde: `conciliacaoSqlAudit.test.ts` (225-02) e `conciliacaoEstadoDerivado`
 * (225-05) — comentários `--` são removidos antes de qualquer contagem, para
 * que a prosa que explica o padrão proibido não seja contada como se FOSSE o
 * padrão proibido.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ARQ = "supabase/migrations/20260904130000_conciliacao_resumo_universo_e_desempate.sql";

/** As migrations JÁ APLICADAS. Elas não se editam — o que está no ar só muda
 *  por migration nova. Estão aqui para provar que continuam intactas. */
const APLICADAS = [
  "supabase/migrations/20260903130000_conciliacao_modelo_e_rpcs.sql",
  "supabase/migrations/20260903140000_conciliacao_acl_e_totais.sql",
  "supabase/migrations/20260904110000_conciliacao_frete_prometido.sql",
  "supabase/migrations/20260904120000_conciliacao_estado_derivado.sql",
];

function semComentarios(sql: string): string {
  return sql
    .split("\n")
    .map((linha) => {
      const i = linha.indexOf("--");
      return i === -1 ? linha : linha.slice(0, i);
    })
    .join("\n");
}

const bruto = readFileSync(resolve(process.cwd(), ARQ), "utf8");
const corpo = semComentarios(bruto);

/** As 26 colunas do contrato de `get_conciliacao_resumo`, na ordem. Os planos
 *  03 e 05 leem por NOME; qualquer uma que sumisse apagaria um bloco da tela. */
const COLUNAS_RESUMO = [
  "casos_urgentes",
  "soma_urgente",
  "proximo_prazo_dias",
  "acionaveis_n",
  "vazamento_total",
  "sub_piso_n",
  "sub_piso_soma",
  "nosso_erro_n",
  "nosso_erro_soma",
  "fora_escopo_n",
  "fora_escopo_soma",
  "entradas_sem_origem_n",
  "entradas_sem_origem_soma",
  "a_verificar_n",
  "a_verificar_soma",
  "recuperado_total",
  "saidas_auditadas",
  "ingestao_inicio",
  "piso_materialidade",
  "acusar_valor_a_menor",
  "dias_aguardando",
  "dias_ausente",
  "ultima_sync",
  "linhas_total",
  "teto_da_lista",
  "valor_desconhecido_n",
] as const;

/** As 24 colunas de `get_casos_conciliacao`. */
const COLUNAS_CASOS = [
  "caso_id",
  "ml_order_id",
  "tipo_caso",
  "fila",
  "acionavel",
  "motivo",
  "estado",
  "titulo",
  "sku",
  "quantidade",
  "retido_de_fato",
  "cobranca_declarada",
  "residuo_ml",
  "esperado_nosso",
  "recebido",
  "residuo_nosso",
  "diferenca",
  "data_pedido",
  "data_evento",
  "dias_restantes",
  "n_pagamentos",
  "payment_ids",
  "release_date_max",
  "valor_estimado",
] as const;

/** O bloco `returns table (...)` da função pedida. */
function blocoDeRetorno(fn: string): string {
  const i = corpo.search(
    new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\b`, "i"),
  );
  expect(i, `${fn} não é recriada nesta migration`).toBeGreaterThan(-1);
  const trecho = corpo.slice(i);
  const m = /returns\s+table\s*\(([\s\S]*?)\)\s*language/i.exec(trecho);
  expect(m, `${fn} sem bloco returns table`).toBeTruthy();
  return m[1];
}

// ─── 1. G-02 — os dois universos voltam a ser o mesmo ───────────────────────

describe("🔴 G-02 — o resumo passa a descrever a MESMA lista que a tela carrega", () => {
  it("1 — `get_conciliacao_resumo` é recriada nesta migration", () => {
    expect(
      /create\s+or\s+replace\s+function\s+public\.get_conciliacao_resumo/i.test(corpo),
    ).toBe(true);
  });

  it("2 — 🔴 o CTE do resumo une a base COM as linhas de frete", () => {
    // Este é o defeito inteiro: o wrapper unia, o resumo não.
    const i = corpo.search(/create\s+or\s+replace\s+function\s+public\.get_conciliacao_resumo/i);
    const trechoResumo = corpo.slice(i);
    const uniao =
      /\bb\s+as\s*\([\s\S]{0,400}?conciliacao_base_linhas[\s\S]{0,200}?union\s+all[\s\S]{0,200}?conciliacao_frete_linhas/i;
    expect(uniao.test(trechoResumo), "o resumo continua agregando só sobre a base").toBe(true);
  });

  it("3 — a janela vai IGUAL para as duas funções do union", () => {
    // Universos com janelas diferentes seriam o mesmo defeito com outra cara.
    const chamadas = corpo.match(/conciliacao_(base|frete)_linhas\(p_org_id,\s*p_janela_dias\)/gi) ?? [];
    expect(chamadas.length, "alguma chamada não repassa p_janela_dias").toBeGreaterThanOrEqual(2);
  });

  it("4 — 🔴 o contrato de 26 colunas fica INTACTO, na mesma ordem", () => {
    const bloco = blocoDeRetorno("get_conciliacao_resumo");
    const nomes = bloco
      .split(",")
      .map((l) => l.trim().split(/\s+/)[0])
      .filter((n) => n.length > 0);
    expect(nomes).toEqual([...COLUNAS_RESUMO]);
  });

  it("5 — `linhas_total` continua contado SEM teto, e `teto_da_lista` continua ecoado", () => {
    expect(/count\(\*\)::int\s+as\s+linhas_total/i.test(corpo)).toBe(true);
    expect(/\bas\s+teto_da_lista/i.test(corpo)).toBe(true);
  });

  it("6 — `valor_desconhecido_n` continua contando o que NÃO tem valor apurado", () => {
    expect(
      /count\(\*\)\s*filter\s*\(\s*where\s+b\.diferenca\s+is\s+null\s*\)::int\s+as\s+valor_desconhecido_n/i.test(
        corpo,
      ),
    ).toBe(true);
  });

  it("7 — os dois campos que são 'não sei' continuam SEM coalesce", () => {
    // Nulo é a ausência de afirmação; zero é uma afirmação. A onda 2 removeu o
    // coalesce de propósito e reunir os universos não pode desfazer isso.
    for (const campo of ["nosso_erro_soma", "fora_escopo_soma"]) {
      const i = corpo.indexOf(`as ${campo}`);
      expect(i, `campo ${campo} não encontrado`).toBeGreaterThan(0);
      const expressao = corpo.slice(corpo.lastIndexOf("\n", i), i);
      expect(/coalesce/i.test(expressao), `${campo} ganhou coalesce`).toBe(false);
    }
  });
});

// ─── 2. G-03 — a ordenação ganha desempate único ────────────────────────────

describe("🔴 G-03 — paginação por OFFSET exige ordem total, não parcial", () => {
  it("8 — `get_casos_conciliacao` é recriada e continua ordenando por PRAZO primeiro", () => {
    // D-225-03: a fila ordena por dias restantes, nunca por valor. O desempate
    // entra DEPOIS; se entrasse antes, mudaria a régua da tela inteira.
    expect(
      /order\s+by\s+t\.dias_restantes\s+asc\s+nulls\s+last\s*,\s*t\.diferenca\s+desc\s+nulls\s+last/i.test(
        corpo,
      ),
    ).toBe(true);
  });

  it("9 — 🔴 o ORDER BY termina com a chave que torna a ordem TOTAL", () => {
    const m = /order\s+by([\s\S]*?)limit/i.exec(corpo);
    expect(m, "ORDER BY não encontrado").toBeTruthy();
    const ordem = m[1];
    for (const chave of ["ml_order_id", "tipo_caso", "payment_ids"]) {
      expect(ordem, `desempate sem ${chave}`).toContain(chave);
    }
  });

  it("10 — todo termo do desempate declara o lugar do nulo", () => {
    // Sem `nulls last` explícito, a posição do nulo muda com a direção — e
    // `ml_order_id` é NULO em entrada que não é venda do ML.
    const m = /order\s+by([\s\S]*?)limit/i.exec(corpo);
    const termos = m[1].split(",").map((t) => t.trim()).filter((t) => t.length > 0);
    expect(termos.length, "desempate insuficiente").toBeGreaterThanOrEqual(5);
    for (const t of termos) {
      expect(t, `termo sem posição de nulo declarada: ${t}`).toMatch(/nulls\s+(first|last)/i);
    }
  });

  it("11 — o teto duro de 1000 e o offset continuam de pé", () => {
    expect(/limit\s+least\s*\(\s*coalesce\s*\(\s*p_limite[\s\S]{0,40}?1000\s*\)/i.test(corpo)).toBe(
      true,
    );
    expect(/offset\s+greatest\s*\(\s*coalesce\s*\(\s*p_offset/i.test(corpo)).toBe(true);
  });

  it("12 — o contrato de 24 colunas fica INTACTO, na mesma ordem", () => {
    const bloco = blocoDeRetorno("get_casos_conciliacao");
    const nomes = bloco
      .split(",")
      .map((l) => l.trim().split(/\s+/)[0])
      .filter((n) => n.length > 0);
    expect(nomes).toEqual([...COLUNAS_CASOS]);
  });

  it("13 — o wrapper continua unindo base e frete (o 225-06 não é desfeito)", () => {
    const i = corpo.search(/create\s+or\s+replace\s+function\s+public\.get_casos_conciliacao/i);
    const trecho = corpo.slice(i);
    expect(/conciliacao_base_linhas/i.test(trecho)).toBe(true);
    expect(/conciliacao_frete_linhas/i.test(trecho)).toBe(true);
  });
});

// ─── 3. As duas provas de comportamento, dentro da própria migration ────────

describe("🔴 as invariantes rodam contra PRODUÇÃO e abortam a aplicação", () => {
  it("14 — a invariante de G-02 confere o total do resumo contra a contagem do universo", () => {
    // Uma guarda que só procurasse o texto `conciliacao_frete_linhas` no corpo
    // aprovaria uma união escrita errado. Esta mede o EFEITO.
    // (`feedback_gate_por_invariante_nao_por_literal`)
    expect(corpo).toContain("INVARIANTE REPROVADA");
    expect(/v_resumo\s+is\s+distinct\s+from\s+v_uniao/i.test(corpo)).toBe(true);
  });

  it("15 — a invariante de G-03 mede a unicidade da chave de ordenação, linha a linha", () => {
    expect(/group\s+by[\s\S]{0,200}?having\s+count\(\*\)\s*>\s*1/i.test(corpo)).toBe(true);
    expect(/v_empates\s*>\s*0/i.test(corpo)).toBe(true);
  });

  it("16 — 🔴 recusa aprovar sem ter exercitado nada (gate vazio não é gate)", () => {
    expect(corpo).toContain("Guarda vazia nao aprova migration");
  });

  it("17 — a guarda de deriva confere o corpo VIVO antes de substituir", () => {
    // `feedback_corpo_vivo_de_rpc_vem_do_banco`: clonar corpo de RPC a partir do
    // repositório já regrediu produção nesta casa (`get_cashflow`, R$ 30.372,11).
    expect(/pg_get_functiondef/i.test(corpo)).toBe(true);
    expect(/producao divergiu do repositorio/i.test(corpo)).toBe(true);
  });

  it("18 — a ACL é reemitida com `anon` NOMEADO nas duas funções", () => {
    for (const fn of ["get_conciliacao_resumo", "get_casos_conciliacao"]) {
      expect(
        new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${fn}\\s*\\([^)]*\\)\\s+from\\s+anon`, "i").test(
          corpo,
        ),
        `${fn} sem revoke de anon`,
      ).toBe(true);
      expect(
        new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${fn}\\s*\\([^)]*\\)\\s+to\\s+authenticated`, "i").test(
          corpo,
        ),
        `${fn} sem grant para authenticated`,
      ).toBe(true);
    }
    expect(/has_function_privilege\s*\(\s*'anon'/i.test(corpo)).toBe(true);
    expect(/has_function_privilege\s*\(\s*'authenticated'/i.test(corpo)).toBe(true);
  });

  it("19 — nenhuma função é REMOVIDA: DROP FUNCTION apagaria a ACL", () => {
    expect(/DROP\s+FUNCTION/i.test(corpo)).toBe(false);
  });
});

// ─── 4. 🔴 O que esta passagem NÃO pode mexer ───────────────────────────────

describe("🔴 os dois portões calibrados continuam DESLIGADOS", () => {
  it("20 — a migration não LIGA nenhuma das duas acusações", () => {
    // O verificador foi explícito: ligá-las antes do passo (c) de C-03c e de
    // F-02 ter amostra desfaria o melhor trabalho que esta fase fez — uma régua
    // que se recusou a acusar depois de reprovar na calibração.
    expect(/update\s+public\.conciliacao_config/i.test(corpo)).toBe(false);
    expect(/set\s+acusar_valor_a_menor\s*=\s*true/i.test(corpo)).toBe(false);
    expect(/set\s+acusar_frete_a_maior\s*=\s*true/i.test(corpo)).toBe(false);
  });

  it("21 — e ainda ABORTA se alguém as tiver ligado por fora", () => {
    expect(/acusar_valor_a_menor/i.test(corpo)).toBe(true);
    expect(/acusar_frete_a_maior/i.test(corpo)).toBe(true);
    expect(/raise\s+exception[^;]*acusar/i.test(corpo)).toBe(true);
  });

  it("22 — não toca `conciliacao_base_linhas` nem `conciliacao_frete_linhas`", () => {
    // As duas funções de régua ficam INTOCADAS: esta passagem corrige o
    // AGREGADO e a ORDEM, nunca o número que cada linha carrega.
    for (const fn of ["conciliacao_base_linhas", "conciliacao_frete_linhas"]) {
      expect(
        new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\b`, "i").test(corpo),
        `${fn} foi recriada — a régua não é desta passagem`,
      ).toBe(false);
    }
  });

  it("23 — não INSERE nem APAGA dado nenhum", () => {
    expect(/^\s*INSERT\s+INTO\s+/im.test(corpo)).toBe(false);
    expect(/^\s*DELETE\s+FROM\s+/im.test(corpo)).toBe(false);
  });
});

// ─── 5. As regras transversais da fase valem aqui também ────────────────────

describe("regras transversais — valem em toda migration da fase", () => {
  it("24 — não usa o campo POR UNIDADE nem o que herda o defeito dele", () => {
    // `orders.comissao` é POR UNIDADE enquanto `receita_bruta` é TOTAL (bug
    // ativo da Fase 234). A régua desta fase é ML-contra-ML de propósito.
    expect(/\bcomissao\b/i.test(corpo)).toBe(false);
    expect(/\breceita_liquida\b/i.test(corpo)).toBe(false);
  });

  it("25 — não contém SECURITY DEFINER, e guarda contra ele", () => {
    expect(/\bSECURITY\s+DEFINER\b/i.test(corpo)).toBe(false);
    expect(/\bSECURITY\s+INVOKER\b/i.test(corpo)).toBe(true);
    expect(/prosecdef/i.test(corpo)).toBe(true);
  });

  it("26 — toda função fixa o search_path", () => {
    const invokers = corpo.match(/\bSECURITY\s+INVOKER\b/gi) ?? [];
    const paths = corpo.match(/\bSET\s+search_path\s*=\s*public\b/gi) ?? [];
    expect(paths.length).toBeGreaterThanOrEqual(invokers.length);
  });

  it("27 — 🔴 não contém UUID literal — UUID não se completa por prefixo nesta casa", () => {
    // A organização das invariantes é DERIVADA de `conciliacao_config`, que só
    // foi semeada para a Pé Vermeio (D-225-14). Literal aqui seria o caminho
    // curto que já pôs o número de uma loja na tela da outra.
    expect(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(corpo)).toBe(false);
    expect(/from\s+public\.conciliacao_config/i.test(corpo)).toBe(true);
  });

  it("28 — não menciona nenhuma função de caixa da Fase 237", () => {
    for (const fn of ["get_dre_cash", "get_daily_balance", "get_cashflow"]) {
      expect(bruto.includes(fn), `menciona ${fn}`).toBe(false);
    }
  });

  it("29 — nunca filtra por `data_pagamento` (coluna morta, 100% NULL)", () => {
    expect(/where[\s\S]{0,400}?\bdata_pagamento\b\s*(is\s+not\s+null|>=|<=|<|>|=)/i.test(corpo)).toBe(
      false,
    );
  });

  it("30 — as migrations já aplicadas continuam intactas no repositório", () => {
    // O que está no ar só muda por migration nova. Se alguma delas tivesse sido
    // editada, o corpo vivo e o repositório divergiriam em silêncio.
    for (const arq of APLICADAS) {
      const conteudo = readFileSync(resolve(process.cwd(), arq), "utf8");
      expect(conteudo.length, `${arq} sumiu`).toBeGreaterThan(0);
    }
  });
});
