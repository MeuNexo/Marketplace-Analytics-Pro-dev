/**
 * cobrancaCausaRealSqlAudit.test.ts — auditoria estática da migration do plano
 * 239-04 (Fase 239).
 *
 * O QUE ESTE PORTÃO DEFENDE, e por que ele lê o `.sql` do disco: aplicar
 * migration é parada do orquestrador nesta fase — o executor não alcança
 * `ckcdevcxgvueywivefgx`. Sem esta auditoria, um `SECURITY DEFINER` (que é IDOR
 * numa função com `p_org_id`), a ACL apagada na recriação, ou a troca da chave
 * de junção com `conciliacao_casos` só apareceriam com o banco já escrito — e
 * as três saem PLAUSÍVEIS: nada quebra, nenhuma tela pisca.
 *
 * 🔴 E há o defeito específico DESTE plano, que só um portão de texto pega: o
 * motivo `sem_captura_cobranca` era um balde com quatro causas coladas, e três
 * delas não são lacuna nossa. Se alguém colapsar as quatro de volta num ramo
 * só, a função continua compilando, a RPC continua respondendo, e o card volta
 * a dizer "falta dado nosso" para uma venda de ontem que o Mercado Livre ainda
 * nem faturou. A defasagem medida do CFFE tem mediana 1 dia e máximo 18: somar
 * espera normal com lacuna real inflaria o problema em ordem de grandeza.
 *
 * Molde: `src/lib/freteTresLinhasSqlAudit.test.ts` (239-01) e
 * `src/lib/conciliacaoSqlAudit.test.ts` (225-02) — remove comentários `--`
 * ANTES de qualquer contagem, para que uma frase de cabeçalho que NOMEIA a
 * coisa proibida não seja contada como se FOSSE a coisa proibida.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Caminho relativo à RAIZ DO REPO (`process.cwd()`), não a `import.meta.url`:
 *  a suíte roda em jsdom, onde `import.meta.url` é uma URL `http://` do Vite. */
const ARQ = "supabase/migrations/20260905130000_cobranca_causa_real.sql";

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

/** As quatro causas que substituem o balde, na ordem em que a cascata decide. */
const CAUSAS = [
  "cobranca_nao_emitida_pelo_ml",
  "captura_nunca_tentada",
  "captura_com_erro",
  "ml_respondeu_sem_cobranca",
] as const;

// ─── 0. O portão não pode aprovar por vacuidade ─────────────────────────────

describe("o arquivo tem SQL de verdade — portão que audita o vazio aprova qualquer coisa", () => {
  it("sobra SQL substantivo depois de remover todo comentário", () => {
    const util = corpo.replace(/\s+/g, " ").trim();
    expect(util.length).toBeGreaterThan(2000);
  });

  it("recria exatamente uma função, e é a régua do dinheiro", () => {
    const criadas = corpo.match(/create\s+or\s+replace\s+function\s+public\.(\w+)/gi) ?? [];
    expect(criadas.length).toBe(1);
    expect(criadas[0]).toMatch(/conciliacao_base_linhas/i);
  });

  it("o contrato de 24 colunas não muda — a tela lê posição, não nome", () => {
    const assinatura = /returns\s+table\s*\(([\s\S]*?)\)\s*\n\s*language/i.exec(corpo);
    expect(assinatura).not.toBeNull();
    const colunas = (assinatura as RegExpExecArray)[1]
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    expect(colunas.length).toBe(24);
  });
});

// ─── 1. A fonte da causa real ───────────────────────────────────────────────

describe("a causa vem da TABELA DE CAPTURA, não de adivinhação", () => {
  it("a função lê `ml_order_sale_fee_captura`", () => {
    expect(/\bpublic\.ml_order_sale_fee_captura\b/i.test(corpo)).toBe(true);
  });

  it("a junção da captura é por org E por pedido — org solta vazaria linha de outro tenant", () => {
    const trecho =
      /public\.ml_order_sale_fee_captura[\s\S]{0,400}?\borganization_id\b[\s\S]{0,200}?\bml_order_id\b/i;
    expect(trecho.test(corpo)).toBe(true);
  });

  it("🔴 é LEFT JOIN: pedido sem linha de captura é uma das quatro causas, não uma linha que some", () => {
    expect(/left\s+join\s+public\.ml_order_sale_fee_captura\b/i.test(corpo)).toBe(true);
  });
});

// ─── 2. As quatro causas, e o balde que continua existindo ──────────────────

describe("o balde vira quatro causas — e nenhuma delas some", () => {
  for (const causa of CAUSAS) {
    it(`a cascata decide \`${causa}\``, () => {
      const emitida = new RegExp(`then\\s*'${causa}'`, "i");
      expect(emitida.test(corpo), `${causa} não é emitida por nenhum ramo`).toBe(true);
    });
  }

  it("🔴 `sem_captura_cobranca` continua como saída FINAL — estado novo aparece feio, não some", () => {
    expect(/'sem_captura_cobranca'/i.test(corpo)).toBe(true);
    // Ela vem DEPOIS das quatro: se um estado de captura que ninguém previu
    // aparecer, ele cai nela em vez de escapar da cascata sem motivo.
    const iBalde = corpo.search(/then\s*'sem_captura_cobranca'/i);
    expect(iBalde).toBeGreaterThan(-1);
    for (const causa of CAUSAS) {
      const iCausa = corpo.search(new RegExp(`then\\s*'${causa}'`, "i"));
      expect(iCausa, `${causa} deve ser decidida ANTES do balde`).toBeGreaterThan(-1);
      expect(iCausa).toBeLessThan(iBalde);
    }
  });

  it("🔴 a espera do ML é decidida ANTES de qualquer causa de captura", () => {
    // Ordem é conteúdo aqui: venda de ontem sem linha na tabela de captura é
    // `captura_nunca_tentada` E é espera normal. Decidir a espera primeiro é o
    // que impede a tela de acusar lacuna nossa em cima do relógio do ML.
    const iEspera = corpo.search(/then\s*'cobranca_nao_emitida_pelo_ml'/i);
    for (const causa of CAUSAS.slice(1)) {
      const iOutra = corpo.search(new RegExp(`then\\s*'${causa}'`, "i"));
      expect(iEspera, `a espera deve vir antes de ${causa}`).toBeLessThan(iOutra);
    }
  });

  it("a constante de defasagem (18 dias) está NOMEADA, não solta no meio do case", () => {
    // O 18 veio da defasagem medida do CFFE — mediana 1 dia, máximo 18. Número
    // mágico no meio da cascata é número que ninguém sabe de onde veio, e a
    // próxima pessoa o muda sem saber o que está mudando.
    expect(/\b18\b/.test(corpo)).toBe(true);
    expect(/\bdias_defasagem_cffe\b/i.test(corpo)).toBe(true);
    // E a procedência tem de estar escrita — no arquivo BRUTO, que é onde
    // moram os comentários.
    expect(/cffe/i.test(bruto)).toBe(true);
  });
});

// ─── 3. O rótulo para de afirmar (D-239-01) ─────────────────────────────────

describe("rótulo afirmativo exige acionável OU as três linhas fechadas", () => {
  it("`repasse_em_aberto` existe como saída do tipo derivado", () => {
    expect(/'repasse_em_aberto'/i.test(corpo)).toBe(true);
  });

  it("🔴 o tipo emitido é DERIVADO — `tipo_calc` cru não pode voltar a ser a coluna de saída", () => {
    // A regressão que este teste existe para pegar: `l.tipo_calc as tipo_caso`.
    // Ela compila, responde e devolve o card a afirmar "Repasse a menor" com
    // as três linhas nulas — o defeito que abriu a fase.
    expect(/\bl\.tipo_calc\s+as\s+tipo_caso\b/i.test(corpo)).toBe(false);
    const derivado =
      /case[\s\S]{0,600}?'repasse_em_aberto'[\s\S]{0,600}?end\s+as\s+tipo_caso/i;
    expect(derivado.test(corpo)).toBe(true);
  });

  it("a condição do rótulo cita as três linhas do card", () => {
    const janela = /case[\s\S]{0,600}?'repasse_em_aberto'[\s\S]{0,200}?end\s+as\s+tipo_caso/i.exec(
      corpo,
    );
    expect(janela).not.toBeNull();
    const texto = (janela as RegExpExecArray)[0];
    // ⚠️ O slot "Recebido" do card é emitido como `round(l.net, 2) as recebido`
    // — `l.net` É a linha do recebido, e é o nome que existe dentro da função.
    // Asseverar a palavra "recebido" aqui aceitaria o alias da SAÍDA, que não
    // está em escopo na expressão; asseverar `l.net` prende a régua na fonte.
    for (const coluna of ["esperado_nosso", "l\\.net", "residuo_nosso"]) {
      expect(texto, `a régua do rótulo ignora ${coluna}`).toMatch(new RegExp(coluna, "i"));
    }
    expect(texto).toMatch(/acionavel/i);
  });

  it("🔴 a JUNÇÃO com `conciliacao_casos` continua na chave PERSISTIDA, não na derivada", () => {
    // Trocar `l.tipo_calc` pela coluna derivada orfanaria todo caso já gravado:
    // o check `conciliacao_casos_tipo_chk` recusa `repasse_em_aberto`, então o
    // join nunca casaria e o estado registrado pelo usuário sumiria da tela.
    // Mesma mecânica que o 239-01 travou no frete.
    expect(/k\.tipo_caso\s*=\s*l\.tipo_calc\b/i.test(corpo)).toBe(true);
    expect(/k\.tipo_caso\s*=\s*.{0,40}tipo_caso\b/i.test(corpo)).toBe(false);
  });

  it("⚠️ os dois motivos ACIONÁVEIS mantêm o rótulo afirmativo", () => {
    // `sem_repasse_confirmado` e `repasse_a_menor_confirmado` têm `recebido`
    // nulo porque o dinheiro NÃO VEIO — ali o nulo é o achado, não a lacuna.
    // Forçá-los a "em aberto" apagaria caso legítimo, que é o oposto do que a
    // fase quer. Por isso `acionavel` entra como o primeiro braço do OR.
    expect(/'sem_repasse_confirmado'/i.test(corpo)).toBe(true);
    expect(/'repasse_a_menor_confirmado'/i.test(corpo)).toBe(true);
  });
});

// ─── 4. Disciplina de segurança ─────────────────────────────────────────────

describe("SECURITY INVOKER — DEFINER com p_org_id é IDOR nesta base", () => {
  it("a função declara security invoker", () => {
    expect(
      /create\s+or\s+replace\s+function\s+public\.conciliacao_base_linhas\b[\s\S]*?\bsecurity\s+invoker\b/i.test(
        corpo,
      ),
    ).toBe(true);
  });

  it("a string DEFINER não aparece em lugar nenhum do SQL útil", () => {
    expect(/\bsecurity\s+definer\b/i.test(corpo)).toBe(false);
  });

  it("fixa o `search_path`", () => {
    expect(/\bset\s+search_path\s+to\s+'public'/i.test(corpo)).toBe(true);
  });

  it("tem guarda de `prosecdef` que ABORTA — comentário não impede DEFINER", () => {
    expect(/\bprosecdef\b/i.test(corpo)).toBe(true);
    expect(/\braise\s+exception\b/i.test(corpo)).toBe(true);
  });
});

describe("ACL — `create or replace` apaga o grant, e a função fica sem dono", () => {
  it("revoga de `public`", () => {
    expect(/revoke\s+all\s+on\s+function\s+public\.conciliacao_base_linhas[\s\S]{0,200}?from\s+public\b/i.test(corpo)).toBe(true);
  });

  it("revoga de `anon` — leitor não autenticado não vê conciliação de ninguém", () => {
    expect(/revoke\s+all\s+on\s+function\s+public\.conciliacao_base_linhas[\s\S]{0,200}?from\s+anon\b/i.test(corpo)).toBe(true);
  });

  it("concede a `authenticated`", () => {
    expect(/grant\s+execute\s+on\s+function\s+public\.conciliacao_base_linhas[\s\S]{0,200}?to\s+authenticated\b/i.test(corpo)).toBe(true);
  });

  it("tem guarda que confere a ACL depois de recriada — grant escrito não é grant vigente", () => {
    expect(/\bhas_function_privilege\b/i.test(corpo)).toBe(true);
  });
});

// ─── 5. Perímetro: este plano PROVA, não ACUSA e não APAGA ──────────────────

describe("🔴 perímetro — a fase 239 não liga régua de acusação e não escreve dado", () => {
  it("não toca `conciliacao_config`", () => {
    expect(/\b(update|insert\s+into|alter\s+table)\s+[\s\S]{0,40}conciliacao_config\b/i.test(corpo)).toBe(
      false,
    );
  });

  it("não liga `acusar_valor_a_menor` nem `acusar_frete_a_maior`", () => {
    // A função LÊ `acusar_valor_a_menor` no `cfg` — isso é leitura da régua
    // vigente, e é assim desde a 225. O proibido é ATRIBUIR.
    expect(/\bacusar_valor_a_menor\s*=\s*true\b/i.test(corpo)).toBe(false);
    expect(/\bacusar_frete_a_maior\s*=\s*true\b/i.test(corpo)).toBe(false);
    expect(/\bset\s+acusar_/i.test(corpo)).toBe(false);
  });

  it("nenhum UUID literal — org fixa em migration é dado de um tenant no schema de todos", () => {
    expect(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(corpo)).toBe(false);
  });

  it("nenhum DML — a migration recria função, não mexe em linha", () => {
    expect(/\binsert\s+into\b/i.test(corpo)).toBe(false);
    expect(/\bdelete\s+from\b/i.test(corpo)).toBe(false);
    expect(/\bupdate\s+public\.\w+\s+set\b/i.test(corpo)).toBe(false);
    expect(/\btruncate\b/i.test(corpo)).toBe(false);
  });

  it("nenhum `drop` além de `drop policy`", () => {
    const drops = corpo.match(/\bdrop\s+\w+/gi) ?? [];
    for (const d of drops) {
      expect(d.toLowerCase(), `drop inesperado: ${d}`).toMatch(/^drop\s+policy$/);
    }
  });
});
