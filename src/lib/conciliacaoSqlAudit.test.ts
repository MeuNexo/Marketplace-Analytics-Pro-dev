/**
 * conciliacaoSqlAudit.test.ts — auditoria estática da migration do monitor de
 * conciliação (Fase 225, plano 225-02, Task 2).
 *
 * O QUE ESTE PORTÃO PROTEGE, e por que ele lê o `.sql` do disco em vez de
 * consultar o banco: aplicar migration é portão do orquestrador nesta fase —
 * o executor não alcança `ckcdevcxgvueywivefgx`. Sem esta auditoria, uma RPC
 * com `SECURITY DEFINER`, uma tabela sem RLS, ou a régua do dinheiro passando
 * pelo campo POR UNIDADE só seriam pegas depois de o banco já estar escrito.
 * E as três saem PLAUSÍVEIS: nenhum teste quebra, nenhuma tela pisca.
 *
 * Molde: `src/lib/fiscal/rebateSqlAudit.test.ts` (223-03) — remove comentários
 * `--` antes de qualquer contagem, para que uma frase de cabeçalho explicando
 * o que é proibido não seja contada como se FOSSE a coisa proibida.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Caminho relativo à RAIZ DO REPO (`process.cwd()`), não a `import.meta.url`:
 *  a suíte roda em jsdom, onde `import.meta.url` é uma URL `http://` do Vite. */
const ARQ = "supabase/migrations/20260903130000_conciliacao_modelo_e_rpcs.sql";
/** A correção de ACL e de truncamento (Task 3). A migration acima JÁ ESTÁ
 *  APLICADA em produção e não se edita — o que está no ar só muda por
 *  migration nova. */
const ARQ_ACL = "supabase/migrations/20260903140000_conciliacao_acl_e_totais.sql";

const sqlBruto = readFileSync(resolve(process.cwd(), ARQ), "utf8");
const sqlAcl = readFileSync(resolve(process.cwd(), ARQ_ACL), "utf8");

function semComentarios(sql: string): string {
  return sql
    .split("\n")
    .map((linha) => {
      const i = linha.indexOf("--");
      return i === -1 ? linha : linha.slice(0, i);
    })
    .join("\n");
}

const corpo = semComentarios(sqlBruto);
const corpoAcl = semComentarios(sqlAcl);

/** As duas migrations da fase, para as regras que valem em todo arquivo. */
const ARQUIVOS = [
  { nome: ARQ, corpo, bruto: sqlBruto },
  { nome: ARQ_ACL, corpo: corpoAcl, bruto: sqlAcl },
] as const;

/** As três funções criadas pela migration. */
const FUNCOES = [
  "conciliacao_base_linhas",
  "get_casos_conciliacao",
  "get_conciliacao_resumo",
] as const;

/** As três tabelas criadas pela migration. */
const TABELAS = ["conciliacao_config", "conciliacao_casos", "mp_saidas"] as const;

// ─── 1. Toda função de tenant é SECURITY INVOKER ────────────────────────────

describe("as funções são SECURITY INVOKER — DEFINER com p_org_id é IDOR nesta base", () => {
  it.each(FUNCOES)("%s declara security invoker", (fn) => {
    const regex = new RegExp(
      `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}\\b[\\s\\S]*?\\bSECURITY\\s+INVOKER\\b`,
      "i",
    );
    expect(regex.test(corpo)).toBe(true);
  });

  it("o arquivo, sem comentários, não contém SECURITY DEFINER em lugar nenhum", () => {
    expect(/\bSECURITY\s+DEFINER\b/i.test(corpo)).toBe(false);
  });

  it("toda função fixa o search_path", () => {
    const invokers = corpo.match(/\bSECURITY\s+INVOKER\b/gi) ?? [];
    const paths = corpo.match(/\bSET\s+search_path\s*=\s*public\b/gi) ?? [];
    expect(invokers.length).toBe(FUNCOES.length);
    expect(paths.length).toBeGreaterThanOrEqual(FUNCOES.length);
  });
});

// ─── 2. A régua do dinheiro não passa pelo campo POR UNIDADE ────────────────

describe("a régua do dinheiro é ML-contra-ML e nunca passa pelo cadastro por unidade", () => {
  it("não usa orders.comissao — ela é POR UNIDADE enquanto receita_bruta é TOTAL (bug ativo da Fase 234)", () => {
    expect(/\bcomissao\b/i.test(corpo)).toBe(false);
  });

  it("não usa receita_liquida — ela herda o mesmo defeito por ser derivada", () => {
    expect(/\breceita_liquida\b/i.test(corpo)).toBe(false);
  });

  it("lê as duas pontas do ML: gross/net de cash_inflows e detail_amount de ml_order_sale_fee", () => {
    expect(corpo).toContain("cash_inflows");
    expect(corpo).toContain("ml_order_sale_fee");
    expect(/\bgross_amount\b/.test(corpo)).toBe(true);
    expect(/\bnet_amount\b/.test(corpo)).toBe(true);
    expect(/\bdetail_amount\b/.test(corpo)).toBe(true);
  });
});

// ─── 3. O netting do estorno tem tratamento condicional de sinal ────────────

describe("a agregação de ml_order_sale_fee neta o estorno — soma simples inventa cobrança dupla", () => {
  it("contém o CASE de inversão de sinal, não um sum(detail_amount) cru", () => {
    // A expressão literal do veredito de C-02 (225-CALIBRACAO.md): estorno está
    // gravado POSITIVO, provado par a par no pedido 2000017811575194.
    const netting =
      /sum\s*\(\s*case\s+when[\s\S]{0,200}?charge_bonified_id\s+is\s+not\s+null[\s\S]{0,120}?then\s*-\s*\w*\.?detail_amount/i;
    expect(netting.test(corpo)).toBe(true);
  });

  it("o predicado do netting cobre BONUS além do charge_bonified_id (promoção não tem bonificado)", () => {
    expect(/detail_type\s*=\s*'BONUS'\s+or\s+\w*\.?charge_bonified_id\s+is\s+not\s+null/i.test(corpo)).toBe(true);
  });

  it("não existe nenhum sum(detail_amount) simples fora do CASE", () => {
    const simples = corpo.match(/sum\s*\(\s*\w*\.?detail_amount\s*\)/gi) ?? [];
    expect(simples).toEqual([]);
  });
});

// ─── 4. Split payment: GROUP BY, nunca join 1:1 ─────────────────────────────

describe("split payment — a agregação é por soma, nunca por junção 1:1", () => {
  it("cash_inflows é lida com GROUP BY ml_order_id", () => {
    expect(/from\s+public\.cash_inflows[\s\S]{0,900}?group\s+by\s+\w*\.?ml_order_id/i.test(corpo)).toBe(true);
  });

  it("soma net e gross com filter no status aprovado, e conta os pagamentos", () => {
    expect(/sum\s*\(\s*\w+\.net_amount\s*\)\s*filter\s*\(\s*where[\s\S]{0,60}?'approved'/i.test(corpo)).toBe(true);
    expect(/array_agg\s*\(\s*\w+\.payment_id/i.test(corpo)).toBe(true);
  });
});

// ─── 5. As três tabelas nascem com RLS e policy no mesmo arquivo ────────────

describe("as três tabelas nascem protegidas — tabela sem RLS não é alcançada pelo lint", () => {
  it.each(TABELAS)("%s liga row level security", (t) => {
    const regex = new RegExp(`ALTER\\s+TABLE\\s+public\\.${t}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, "i");
    expect(regex.test(corpo)).toBe(true);
  });

  it("há ao menos uma policy por tabela, e toda policy passa por is_org_member", () => {
    const policies = corpo.match(/CREATE\s+POLICY\s+[\s\S]*?;/gi) ?? [];
    expect(policies.length).toBeGreaterThanOrEqual(TABELAS.length);
    for (const p of policies) {
      expect(/is_org_member/i.test(p)).toBe(true);
    }
  });

  it("mp_saidas não tem policy de escrita para authenticated — mesma disciplina de cash_inflows", () => {
    expect(/CREATE\s+POLICY\s+mp_saidas_write/i.test(corpo)).toBe(false);
  });
});

// ─── 6. Um grant execute por função criada (remover função apaga a ACL) ─────

describe("grants explícitos — DROP FUNCTION apaga a ACL, então o par é reemitido aqui", () => {
  it.each(FUNCOES)("%s tem revoke e grant execute no mesmo arquivo", (fn) => {
    const revoke = new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${fn}\\s*\\(`, "i");
    const grant = new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${fn}\\s*\\([^)]*\\)\\s+TO\\s+authenticated`, "i");
    expect(revoke.test(corpo)).toBe(true);
    expect(grant.test(corpo)).toBe(true);
  });

  it("há pelo menos um grant execute por função criada", () => {
    const criadas = corpo.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.\w+/gi) ?? [];
    const grants = corpo.match(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.\w+/gi) ?? [];
    expect(grants.length).toBeGreaterThanOrEqual(criadas.length);
  });
});

// ─── 7. A coluna morta nunca vira predicado ─────────────────────────────────

describe("orders.data_pagamento é COLUNA MORTA (100% NULL) e nunca pode virar filtro", () => {
  it("não aparece em nenhum WHERE — um predicado sobre ela devolve zero vacuoso, não zero medido", () => {
    // Medido em 225-CALIBRACAO C-06: 14.278 de 14.278 pedidos com data_pagamento
    // nula. Dois blocos da própria calibração devolveram zero por causa disso.
    expect(/where[\s\S]{0,400}?\bdata_pagamento\b\s*(is\s+not\s+null|>=|<=|<|>|=)/i.test(corpo)).toBe(false);
  });

  it("aparece apenas dentro de um coalesce, para o relógio cair na data do pedido", () => {
    const usos = corpo.match(/\bdata_pagamento\b/gi) ?? [];
    expect(usos.length).toBeGreaterThan(0);
    expect(/coalesce\s*\([\s\S]{0,120}?data_pagamento/i.test(corpo)).toBe(true);
  });
});

// ─── 8. Nenhuma colisão com a Fase 237, nenhum dado semeado ─────────────────

describe("perímetro — não toca as funções de caixa e não semeia UUID", () => {
  it("não menciona nenhuma das funções de caixa que leem cash_inflows (Fase 237)", () => {
    for (const fn of ["get_dre_cash", "get_daily_balance", "get_cashflow"]) {
      expect(sqlBruto.includes(fn)).toBe(false);
    }
  });

  it("não contém INSERT: a configuração nasce vazia e quem semeia é o portão de produção", () => {
    expect(/^\s*INSERT\s+INTO\s+/im.test(corpo)).toBe(false);
  });

  it("não contém nenhum UUID literal — UUID não se completa por prefixo nesta casa", () => {
    expect(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(corpo)).toBe(false);
  });

  it("não remove objeto de banco existente (DROP fora de DROP POLICY IF EXISTS)", () => {
    const drops = corpo.match(/^\s*DROP\s+\w+/gim) ?? [];
    for (const d of drops) {
      expect(/DROP\s+POLICY/i.test(d)).toBe(true);
    }
  });
});

// ─── 9. A régua mora em dado, não em código ─────────────────────────────────

describe("piso, cortes e a liberação da acusação moram em linha de tabela", () => {
  it("conciliacao_config tem piso, cortes de dias, início de ingestão e o portão de acusação", () => {
    for (const col of [
      "piso_materialidade",
      "dias_aguardando",
      "dias_ausente",
      "janela_dias",
      "ingestao_inicio",
      "acusar_valor_a_menor",
    ]) {
      expect(corpo).toContain(col);
    }
  });

  it("acusar_valor_a_menor nasce FALSE — C-03 reprovou F-A para acusação individual", () => {
    expect(/acusar_valor_a_menor\s+boolean\s+not\s+null\s+default\s+false/i.test(corpo)).toBe(true);
  });

  it("as RPCs leem a configuração com COALESCE — ausência de linha não quebra nada", () => {
    expect(/coalesce\s*\(\s*c\.piso_materialidade\s*,\s*5/i.test(corpo)).toBe(true);
    expect(/coalesce\s*\(\s*c\.acusar_valor_a_menor\s*,\s*false/i.test(corpo)).toBe(true);
  });

  it("o resumo ECOA a régua — piso, cortes e o estado da acusação viajam com os números", () => {
    expect(/piso_materialidade\s+numeric/i.test(corpo)).toBe(true);
    expect(/acusar_valor_a_menor\s+boolean/i.test(corpo)).toBe(true);
    expect(/ingestao_inicio\s+date/i.test(corpo)).toBe(true);
  });

  it("saidas_auditadas é derivada de existir linha em mp_saidas, nunca de constante", () => {
    expect(/exists\s*\(\s*select\s+1\s+from\s+public\.mp_saidas/i.test(corpo)).toBe(true);
  });
});

// ─── 10. O teto de paginação existe (PostgREST trunca em 1000 em silêncio) ──

describe("paginação — o PostgREST trunca em 1000 sem avisar", () => {
  it("get_casos_conciliacao tem teto duro de 1000 no limite", () => {
    expect(/limit\s+least\s*\(\s*coalesce\s*\(\s*p_limite[\s\S]{0,40}?1000\s*\)/i.test(corpo)).toBe(true);
  });

  it("ordena por dias restantes, não por valor (D-225-03)", () => {
    expect(/order\s+by\s+\w*\.?dias_restantes\s+asc\s+nulls\s+last/i.test(corpo)).toBe(true);
  });
});

// ─── 11. A correção de ACL e de truncamento (Task 3) ───────────────────────

describe("migration de correção — `anon` nomeado e o truncamento visível", () => {
  it.each(FUNCOES)("revoga execução de anon em %s — revogar de PUBLIC não basta nesta base", (fn) => {
    const regex = new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${fn}\\s*\\([^)]*\\)\\s+FROM\\s+anon`, "i");
    expect(regex.test(corpoAcl)).toBe(true);
  });

  it.each(FUNCOES)("reemite o grant de %s — DROP FUNCTION apaga a ACL", (fn) => {
    const regex = new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${fn}\\s*\\([^)]*\\)\\s+TO\\s+authenticated`, "i");
    expect(regex.test(corpoAcl)).toBe(true);
  });

  it("toda função que este arquivo remove é recriada e reganha o grant no mesmo arquivo", () => {
    const removidas = [...corpoAcl.matchAll(/DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?public\.(\w+)/gi)].map((m) => m[1]);
    for (const fn of removidas) {
      expect(new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}\\b`, "i").test(corpoAcl)).toBe(true);
      expect(new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${fn}\\b`, "i").test(corpoAcl)).toBe(true);
    }
    expect(removidas.length).toBeGreaterThan(0);
  });

  it("o resumo devolve o total sem teto, o valor do teto e a contagem sem valor", () => {
    // Medido em produção: 1.351 linhas em 30d contra teto de 1.000. Sem estes
    // campos a tela mostra 1.000 e o usuário acha que são todos.
    for (const campo of ["linhas_total", "teto_da_lista", "valor_desconhecido_n"]) {
      expect(corpoAcl).toContain(campo);
    }
  });

  it.each(["nosso_erro_soma", "fora_escopo_soma"])(
    "%s NÃO é coalescido para zero — nulo é 'não sei', zero é uma afirmação",
    (campo) => {
      // `coalesce(...)` tem parênteses aninhados, então regex de um nível não
      // serve: a checagem olha a EXPRESSÃO inteira que antecede o apelido.
      const i = corpoAcl.indexOf(`as ${campo}`);
      expect(i, `campo ${campo} não encontrado`).toBeGreaterThan(0);
      const inicioDaLinha = corpoAcl.lastIndexOf("\n", i);
      const expressao = corpoAcl.slice(inicioDaLinha, i);
      expect(/coalesce/i.test(expressao)).toBe(false);
      expect(/sum\s*\(\s*b\.diferenca\s*\)/i.test(expressao)).toBe(true);
    },
  );

  it("os campos que SÃO somas legítimas continuam coalescidos — o contraste prova que a regra é seletiva", () => {
    for (const campo of ["vazamento_total", "sub_piso_soma", "entradas_sem_origem_soma"]) {
      const i = corpoAcl.indexOf(`as ${campo}`);
      expect(i, `campo ${campo} não encontrado`).toBeGreaterThan(0);
      const expressao = corpoAcl.slice(corpoAcl.lastIndexOf("\n", i), i);
      expect(/coalesce/i.test(expressao)).toBe(true);
    }
  });

  it("a fila 'nosso' exibe residuo_nosso, não residuo_ml — o motivo só dispara com residuo_ml dentro do piso", () => {
    expect(/when\s+l\.motivo\s*=\s*'divergencia_da_nossa_base'\s*then\s+l\.residuo_nosso/i.test(corpoAcl)).toBe(true);
  });

  it("a guarda final falha alto se anon continuar executando ou se authenticated perder o grant", () => {
    expect(/has_function_privilege\s*\(\s*'anon'/i.test(corpoAcl)).toBe(true);
    expect(/has_function_privilege\s*\(\s*'authenticated'/i.test(corpoAcl)).toBe(true);
    expect(/raise\s+exception[^;]*anon ainda executa/i.test(corpoAcl)).toBe(true);
  });
});

// ─── 12. As regras transversais valem nos DOIS arquivos ────────────────────

describe("regras transversais — valem em toda migration da fase, não só na primeira", () => {
  it.each(ARQUIVOS.map((a) => [a.nome, a] as const))("%s não contém SECURITY DEFINER", (_n, a) => {
    expect(/\bSECURITY\s+DEFINER\b/i.test(a.corpo)).toBe(false);
  });

  it.each(ARQUIVOS.map((a) => [a.nome, a] as const))("%s não usa o campo POR UNIDADE nem o que herda o defeito dele", (_n, a) => {
    expect(/\bcomissao\b/i.test(a.corpo)).toBe(false);
    expect(/\breceita_liquida\b/i.test(a.corpo)).toBe(false);
  });

  it.each(ARQUIVOS.map((a) => [a.nome, a] as const))("%s nunca filtra por data_pagamento (coluna morta)", (_n, a) => {
    expect(/where[\s\S]{0,400}?\bdata_pagamento\b\s*(is\s+not\s+null|>=|<=|<|>|=)/i.test(a.corpo)).toBe(false);
  });

  it.each(ARQUIVOS.map((a) => [a.nome, a] as const))("%s não contém UUID literal", (_n, a) => {
    expect(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(a.corpo)).toBe(false);
  });

  it.each(ARQUIVOS.map((a) => [a.nome, a] as const))("%s não menciona nenhuma função de caixa da Fase 237", (_n, a) => {
    for (const fn of ["get_dre_cash", "get_daily_balance", "get_cashflow"]) {
      expect(a.bruto.includes(fn)).toBe(false);
    }
  });

  it("toda cópia do netting inverte o sinal — nenhuma soma simples escapou em nenhum arquivo", () => {
    for (const a of ARQUIVOS) {
      expect((a.corpo.match(/sum\s*\(\s*\w*\.?detail_amount\s*\)/gi) ?? [])).toEqual([]);
    }
    // O netting existe duas vezes: uma por migration, porque a segunda recria a
    // função base inteira. As duas cópias precisam ser a MESMA expressão.
    const netting = /detail_type\s*=\s*'BONUS'\s+or\s+\w*\.?charge_bonified_id\s+is\s+not\s+null/gi;
    for (const a of ARQUIVOS) {
      expect((a.corpo.match(netting) ?? []).length).toBeGreaterThanOrEqual(1);
    }
  });
});
