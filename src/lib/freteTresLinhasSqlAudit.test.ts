/**
 * freteTresLinhasSqlAudit.test.ts — auditoria estática da migration do plano
 * 239-01 (Fase 239).
 *
 * POR QUE ESTE PORTÃO LÊ O `.sql` DO DISCO EM VEZ DE PERGUNTAR AO BANCO:
 * aplicar migration é portão do orquestrador nesta fase — o executor não
 * alcança `ckcdevcxgvueywivefgx`. Sem esta auditoria, um `SECURITY DEFINER`
 * (que é IDOR com `p_org_id`), a perda da ACL na recriação da função, ou a
 * troca da chave de junção com `conciliacao_casos` só apareceriam depois de o
 * banco já estar escrito — e as três saem PLAUSÍVEIS: nenhum teste quebra,
 * nenhuma tela pisca.
 *
 * 🔴 E há um defeito específico deste plano que só um portão de TEXTO pega: a
 * migration corrige `recebido` e `residuo_nosso`, que eram `null::numeric`
 * LITERAIS. Um merge malfeito que os devolvesse ao literal deixaria a função
 * compilando, a RPC respondendo e o card mostrando "não apurado" em 1.214 de
 * 1.214 linhas outra vez — exatamente o estado medido em 04/09 (M-08).
 *
 * Molde: `src/lib/conciliacaoSqlAudit.test.ts` (225-02) — remove comentários
 * `--` antes de qualquer contagem, para que uma frase de cabeçalho explicando
 * o que é proibido não seja contada como se FOSSE a coisa proibida.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Caminho relativo à RAIZ DO REPO (`process.cwd()`), não a `import.meta.url`:
 *  a suíte roda em jsdom, onde `import.meta.url` é uma URL `http://` do Vite. */
const ARQ = "supabase/migrations/20260905100000_frete_recebido_e_residuo.sql";

const bruto = readFileSync(resolve(process.cwd(), ARQ), "utf8");

function semComentarios(sql: string): string {
  return sql
    .split("\n")
    .map((linha) => {
      const i = linha.indexOf("--");
      return i === -1 ? linha : linha.slice(0, i);
    })
    .join("\n");
}

const corpo = semComentarios(bruto);

/** O corpo útil não pode ser um arquivo de comentários com um `select` dentro:
 *  um portão que audita 40 caracteres de SQL passa por vacuidade. */
describe("o arquivo tem SQL de verdade — portão que audita o vazio aprova qualquer coisa", () => {
  it("sobra SQL substantivo depois de remover todo comentário", () => {
    const util = corpo.replace(/\s+/g, " ").trim();
    expect(util.length).toBeGreaterThan(2000);
  });

  it("recria exatamente uma função, e é a do frete", () => {
    const criadas = corpo.match(/create\s+or\s+replace\s+function\s+public\.(\w+)/gi) ?? [];
    expect(criadas.length).toBe(1);
    expect(criadas[0]).toMatch(/conciliacao_frete_linhas/i);
  });
});

// ─── 1. Função de tenant é SECURITY INVOKER, sempre ─────────────────────────

describe("SECURITY INVOKER — DEFINER com p_org_id é IDOR nesta base", () => {
  it("a função declara security invoker", () => {
    expect(
      /create\s+or\s+replace\s+function\s+public\.conciliacao_frete_linhas\b[\s\S]*?\bsecurity\s+invoker\b/i.test(
        corpo,
      ),
    ).toBe(true);
  });

  it("a string DEFINER não aparece em lugar nenhum do SQL útil", () => {
    expect(/\bsecurity\s+definer\b/i.test(corpo)).toBe(false);
  });

  it("fixa o search_path — uma vez por função criada", () => {
    const invokers = corpo.match(/\bsecurity\s+invoker\b/gi) ?? [];
    const paths = corpo.match(/\bset\s+search_path\s*=\s*public\b/gi) ?? [];
    expect(invokers.length).toBe(1);
    expect(paths.length).toBeGreaterThanOrEqual(1);
  });

  it("a guarda de execução confere prosecdef no próprio catálogo", () => {
    expect(/\bp\.prosecdef\b/i.test(corpo)).toBe(true);
    expect(/raise\s+exception[^;]*DEFINER/i.test(corpo)).toBe(true);
  });
});

// ─── 2. ACL: recriar função apaga a ACL, então o par vai no mesmo arquivo ───

describe("ACL — revogar de PUBLIC não desfaz o grant direto que o Supabase dá a anon", () => {
  it("revoga de public E de anon, nomeando os dois", () => {
    expect(
      /revoke\s+all\s+on\s+function\s+public\.conciliacao_frete_linhas\s*\([^)]*\)\s+from\s+public/i.test(
        corpo,
      ),
    ).toBe(true);
    expect(
      /revoke\s+all\s+on\s+function\s+public\.conciliacao_frete_linhas\s*\([^)]*\)\s+from\s+anon/i.test(
        corpo,
      ),
    ).toBe(true);
  });

  it("reemite o grant a authenticated no mesmo arquivo", () => {
    expect(
      /grant\s+execute\s+on\s+function\s+public\.conciliacao_frete_linhas\s*\([^)]*\)\s+to\s+authenticated/i.test(
        corpo,
      ),
    ).toBe(true);
  });

  it("a guarda final falha alto se anon executar ou se authenticated perder o grant", () => {
    expect(/has_function_privilege\s*\(\s*'anon'/i.test(corpo)).toBe(true);
    expect(/has_function_privilege\s*\(\s*'authenticated'/i.test(corpo)).toBe(true);
    expect(/raise\s+exception[^;]*anon ainda EXECUTA/i.test(corpo)).toBe(true);
  });
});

// ─── 3. O netting do estorno sobreviveu à substituição ──────────────────────

describe("netting — soma simples de detail_amount declara cobrança em dobro", () => {
  it("contém o CASE de inversão de sinal", () => {
    const netting =
      /sum\s*\(\s*case\s+when[\s\S]{0,200}?charge_bonified_id\s+is\s+not\s+null[\s\S]{0,120}?then\s*-\s*\w*\.?detail_amount/i;
    expect(netting.test(corpo)).toBe(true);
  });

  it("o predicado cobre BONUS além do charge_bonified_id (promoção não tem bonificado)", () => {
    expect(
      /detail_type\s*=\s*'BONUS'\s+or\s+\w*\.?charge_bonified_id\s+is\s+not\s+null/i.test(corpo),
    ).toBe(true);
  });

  it("não existe nenhum sum(detail_amount) cru fora do CASE", () => {
    expect(corpo.match(/sum\s*\(\s*\w*\.?detail_amount\s*\)/gi) ?? []).toEqual([]);
  });

  it("n_frete continua contando SÓ as linhas de cobrança, sem BFFE", () => {
    // Um pedido com frete integralmente estornado não pode ser lido como
    // "nunca teve frete": o filtro do contador exclui BFFE de propósito.
    expect(
      /count\s*\(\s*\*\s*\)\s*filter\s*\(\s*where\s+\w*\.?detail_sub_type\s+in\s*\(\s*'CFFE'\s*,\s*'CXDE'\s*,\s*'CXDED'\s*\)/i.test(
        corpo,
      ),
    ).toBe(true);
  });
});

// ─── 4. 🔴 O DEFEITO DESTE PLANO: os slots deixaram de ser literais ─────────

describe("239-01 — o número aterrissa no slot que o card lê", () => {
  it("🔴 sobrou exatamente UMA coluna emitida como null::numeric, e é o retido_de_fato", () => {
    // Eram TRÊS antes deste plano: retido_de_fato, recebido e residuo_nosso.
    // O contador é a prova; procurar "não tem" passaria com o arquivo errado.
    //
    // ⚠️ Conta COLUNA EMITIDA (`null::numeric as <nome>`), não a string solta:
    // o `comment on function` cita o literal ao nomear o defeito corrigido, e
    // documentação que nomeia o bug é o oposto do bug.
    const emitidas = corpo.match(/null::numeric\s+as\s+\w+/gi) ?? [];
    expect(emitidas.length).toBe(1);
    expect(emitidas[0]).toMatch(/retido_de_fato/i);
    for (const coluna of ["recebido", "residuo_nosso"]) {
      expect(
        new RegExp(`null::numeric\\s+as\\s+${coluna}\\b`, "i").test(corpo),
        `${coluna} voltou a ser literal nulo — o card mostra "não apurado" de novo`,
      ).toBe(false);
    }
  });

  it("recebido usa a MESMA expressão de cobranca_declarada — uma régua, um número", () => {
    expect(/round\s*\(\s*m\.cobrado\s*,\s*2\s*\)\s+as\s+cobranca_declarada/i.test(corpo)).toBe(true);
    expect(/round\s*\(\s*m\.cobrado\s*,\s*2\s*\)\s+as\s+recebido/i.test(corpo)).toBe(true);
  });

  it("residuo_nosso carrega a diferença COM SINAL, não um valor absoluto", () => {
    expect(/\bm\.dif\s+as\s+residuo_nosso/i.test(corpo)).toBe(true);
    expect(/abs\s*\(\s*\w*\.?dif\s*\)\s+as\s+/i.test(corpo)).toBe(false);
  });

  it("retido_de_fato NÃO virou zero presumido — ausência viaja nomeada", () => {
    expect(/\b0(\.00)?\s+as\s+retido_de_fato/i.test(corpo)).toBe(false);
    expect(/coalesce\s*\([^)]*\)\s+as\s+retido_de_fato/i.test(corpo)).toBe(false);
    // E o motivo real da ausência está escrito no arquivo, não subentendido.
    expect(/senders\[\]\.cost/i.test(bruto)).toBe(true);
  });

  it("o contrato de 24 colunas continua com 24 colunas, nos mesmos nomes", () => {
    const assinatura = /returns\s+table\s*\(([\s\S]*?)\)\s*language\s+sql/i.exec(corpo);
    expect(assinatura, "assinatura de retorno não encontrada").not.toBeNull();
    const colunas = (assinatura as RegExpExecArray)[1]
      .split(",")
      .map((c) => c.trim().split(/\s+/)[0])
      .filter((c) => c.length > 0);
    expect(colunas.length).toBe(24);
    for (const obrigatoria of ["retido_de_fato", "cobranca_declarada", "recebido", "residuo_nosso"]) {
      expect(colunas, `coluna sumiu do contrato: ${obrigatoria}`).toContain(obrigatoria);
    }
  });
});

// ─── 5. 🔴 D-239-01: o rótulo derivado, e a identidade persistida intacta ───

describe("239-01 — tipo derivado na saída, literal na junção", () => {
  it("tipo_caso é DERIVADO da existência da diferença, não constante", () => {
    expect(
      /case\s+when\s+m\.dif\s+is\s+null\s+then\s+'frete_em_aberto'[\s\S]{0,120}?'frete_a_maior'[\s\S]{0,40}?end\s+as\s+tipo_caso/i.test(
        corpo,
      ),
    ).toBe(true);
  });

  it("a constante antiga não sobreviveu como tipo_caso", () => {
    expect(/'frete_a_maior'::text\s+as\s+tipo_caso/i.test(corpo)).toBe(false);
  });

  it("🔴 a junção com conciliacao_casos casa com o LITERAL, nunca com a coluna derivada", () => {
    // Trocar a chave pela expressão orfanaria todo caso já gravado no instante
    // do deploy — e o defeito seria invisível: a RPC responde igual.
    expect(/k\.tipo_caso\s*=\s*'frete_a_maior'/i.test(corpo)).toBe(true);
    expect(/k\.tipo_caso\s*=\s*(case|m\.tipo_caso|tipo_caso)\b/i.test(corpo)).toBe(false);
  });

  it("a junção é left join e continua recortada pela organização", () => {
    const juncao =
      /left\s+join\s+public\.conciliacao_casos\s+k[\s\S]{0,300}?k\.organization_id\s*=\s*p_org_id/i;
    expect(juncao.test(corpo)).toBe(true);
  });
});

// ─── 6. A guarda do corpo VIVO (clonar do repositório já regrediu produção) ──

describe("guarda do corpo vivo — Fase 224 custou R$ 30.372,11 clonando RPC do repo", () => {
  it("lê o corpo vivo com pg_get_functiondef antes de substituir", () => {
    expect(/pg_get_functiondef\s*\(\s*p\.oid\s*\)/i.test(corpo)).toBe(true);
  });

  it("aborta se os marcadores do corpo que espera substituir tiverem sumido", () => {
    expect(/position\s*\(\s*'n_no_grupo'\s+in\s+v_corpo\s*\)\s*=\s*0/i.test(corpo)).toBe(true);
    expect(/position\s*\(\s*'charge_bonified_id'\s+in\s+v_corpo\s*\)\s*=\s*0/i.test(corpo)).toBe(
      true,
    );
  });
});

// ─── 7. Perímetro: não acusa, não semeia, não remove ────────────────────────

describe("perímetro — esta fase é sobre PROVAR, nunca sobre acusar", () => {
  it("🔴 não liga nenhuma das duas réguas de acusação — e aborta se estiverem ligadas", () => {
    expect(/acusar_frete_a_maior\s*=\s*true/i.test(corpo)).toBe(false);
    expect(/acusar_valor_a_menor\s*=\s*true/i.test(corpo)).toBe(false);
    expect(/raise\s+exception[^;]*acusar_frete_a_maior esta LIGADA/i.test(corpo)).toBe(true);
    expect(/raise\s+exception[^;]*acusar_valor_a_menor esta LIGADA/i.test(corpo)).toBe(true);
  });

  it("não contém DML: nem INSERT, nem UPDATE, nem DELETE", () => {
    expect(/^\s*insert\s+into\s+/im.test(corpo)).toBe(false);
    expect(/^\s*update\s+\w/im.test(corpo)).toBe(false);
    expect(/^\s*delete\s+from\s+/im.test(corpo)).toBe(false);
  });

  it("não contém UUID literal — UUID não se completa por prefixo nesta casa", () => {
    expect(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(corpo)).toBe(false);
  });

  it("não remove objeto de banco: nenhum DROP fora de DROP POLICY", () => {
    const drops = corpo.match(/^\s*drop\s+\w+/gim) ?? [];
    for (const d of drops) {
      expect(/drop\s+policy/i.test(d)).toBe(true);
    }
    // Este arquivo não remove nada — a asserção acima é a rede, esta é o fato.
    expect(/^\s*drop\s+function/im.test(corpo)).toBe(false);
    expect(/^\s*alter\s+table/im.test(corpo)).toBe(false);
  });

  it("não toca as funções de caixa da Fase 237 nem a régua do dinheiro", () => {
    // ⚠️ A auditoria é sobre o SQL ÚTIL, não sobre o texto do arquivo: o
    // cabeçalho CITA `get_cashflow` ao lembrar o incidente da Fase 224
    // (R$ 30.372,11 por clonar corpo de RPC do repositório). Exigir a ausência
    // no bruto obrigaria a apagar exatamente a lição que evita repeti-lo.
    for (const fn of ["get_dre_cash", "get_daily_balance", "get_cashflow"]) {
      expect(corpo.includes(fn), `a migration mexe em ${fn}`).toBe(false);
    }
    expect(/create\s+or\s+replace\s+function\s+public\.conciliacao_base_linhas/i.test(corpo)).toBe(
      false,
    );
    expect(/create\s+or\s+replace\s+function\s+public\.get_casos_conciliacao/i.test(corpo)).toBe(
      false,
    );
  });

  it("não usa orders.comissao nem receita_liquida — o campo POR UNIDADE contamina a margem", () => {
    expect(/\bcomissao\b/i.test(corpo)).toBe(false);
    expect(/\breceita_liquida\b/i.test(corpo)).toBe(false);
  });
});
