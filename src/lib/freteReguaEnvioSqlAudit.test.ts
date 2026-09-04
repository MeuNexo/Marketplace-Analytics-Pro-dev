/**
 * freteReguaEnvioSqlAudit.test.ts — auditoria estática da migration do plano
 * 239-03 (Fase 239): a régua do frete sai do ITEM e vai para o ENVIO.
 *
 * POR QUE ESTE PORTÃO LÊ O `.sql` DO DISCO EM VEZ DE PERGUNTAR AO BANCO:
 * aplicar migration é portão do orquestrador nesta fase — o executor não
 * alcança `ckcdevcxgvueywivefgx`. Sem esta auditoria, um `SECURITY DEFINER`
 * (que é IDOR com `p_org_id`), a perda da ACL na recriação da função, ou a
 * volta silenciosa da fonte antiga só apareceriam depois de o banco já estar
 * escrito — e as três saem PLAUSÍVEIS: nada quebra, nenhuma tela pisca.
 *
 * 🔴 E há DUAS regressões específicas deste plano que só um portão de TEXTO
 * pega, porque as duas voltam compilando e respondendo:
 *
 *   1. a HEURÍSTICA de carrinho (mesmo comprador, mesmo dia). Ela foi
 *      substituída por FATO — o envio diz quem divide frete com quem. Se
 *      voltar, N pedidos de um pacote voltam a virar N não-casos por suposição.
 *   2. a TABELA DE FRETE POR ANÚNCIO como fonte do esperado, inclusive "só
 *      como plano B". Ela nunca foi exercitada contra cobrança (n = 0 na fase
 *      225); a do envio bate ao centavo 6/6. Misturar régua provada com régua
 *      não medida, sem o card dizer qual produziu o número, é o defeito que
 *      esta fase existe para matar.
 *
 * Molde: `src/lib/freteTresLinhasSqlAudit.test.ts` (239-01) e
 * `src/lib/conciliacaoSqlAudit.test.ts` (225-02) — remove comentários `--`
 * antes de qualquer contagem, para que uma frase de cabeçalho explicando o que
 * é proibido não seja contada como se FOSSE a coisa proibida.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Caminho relativo à RAIZ DO REPO (`process.cwd()`), não a `import.meta.url`:
 *  a suíte roda em jsdom, onde `import.meta.url` é uma URL `http://` do Vite. */
const ARQ = "supabase/migrations/20260905120000_frete_regua_do_envio.sql";

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

/**
 * O CORPO DA FUNÇÃO, isolado do resto do arquivo.
 *
 * 🔴 A distinção importa: o bloco de guarda do corpo vivo PRECISA nomear os
 * marcadores das versões antiga e nova para saber o que está prestes a
 * substituir. Auditar o arquivo inteiro confundiria uma STRING DE CONFERÊNCIA
 * com uma LEITURA DE VERDADE da tabela — e a saída seria apagar a guarda, que
 * é justamente o que impede a regressão da Fase 224 (R$ 30.372,11).
 */
const corpoFuncao = (() => {
  const m = /create\s+or\s+replace\s+function\s+public\.conciliacao_frete_linhas[\s\S]*?\bas\s+\$\$([\s\S]*?)\$\$\s*;/i.exec(
    corpo,
  );
  if (!m) throw new Error("não achei o corpo da função no arquivo auditado");
  return m[1];
})();

describe("o arquivo tem SQL de verdade — portão que audita o vazio aprova qualquer coisa", () => {
  it("sobra SQL substantivo depois de remover todo comentário", () => {
    expect(corpo.replace(/\s+/g, " ").trim().length).toBeGreaterThan(2000);
  });

  it("o corpo da função foi isolado e é substantivo", () => {
    expect(corpoFuncao.replace(/\s+/g, " ").trim().length).toBeGreaterThan(1500);
  });

  it("recria exatamente uma função, e é a do frete", () => {
    const criadas = corpo.match(/create\s+or\s+replace\s+function\s+public\.(\w+)/gi) ?? [];
    expect(criadas.length).toBe(1);
    expect(criadas[0]).toMatch(/conciliacao_frete_linhas/i);
  });
});

// ─── 1. A fonte do esperado é o ENVIO ───────────────────────────────────────

describe("a régua lê o ENVIO — a unidade em que o ML cota e cobra frete", () => {
  it("a função lê o mapa pedido→envio", () => {
    expect(/\bpublic\.ml_shipment_pedido\b/.test(corpoFuncao)).toBe(true);
  });

  it("a função lê o custo de tabela do envio", () => {
    expect(/\bpublic\.ml_shipment_frete\b/.test(corpoFuncao)).toBe(true);
  });

  it("o esperado vem de `list_cost`, e a segunda fonte é `custo_vendedor`", () => {
    expect(/\blist_cost\b/.test(corpoFuncao)).toBe(true);
    expect(/\bcusto_vendedor\b/.test(corpoFuncao)).toBe(true);
  });

  it("🔴 `retido_de_fato` deixou de ser o literal nulo — a segunda leitura chegou", () => {
    expect(/null::numeric\s+as\s+retido_de_fato/i.test(corpoFuncao)).toBe(false);
    expect(/custo_vendedor[^\n]*\bas\s+retido_de_fato/i.test(corpoFuncao)).toBe(true);
  });

  it("🔴 ausência do envio NÃO vira zero — nada de coalesce sobre o esperado", () => {
    // `coalesce(list_cost, 0)` exibiria régua de zero para envio cuja consulta
    // de custo falhou, e o card afirmaria o que ninguém mediu (fase 219).
    expect(/coalesce\s*\(\s*\w*\.?list_cost\s*,/i.test(corpoFuncao)).toBe(false);
    expect(/coalesce\s*\(\s*\w*\.?custo_vendedor\s*,/i.test(corpoFuncao)).toBe(false);
  });
});

// ─── 2. A apuração é por PACOTE ─────────────────────────────────────────────

describe("apuração por pacote — a cobrança é agregada no envio, não no pedido solto", () => {
  it("a agregação da cobrança agrupa por shipment_id", () => {
    expect(/group\s+by\s+sp\.shipment_id/i.test(corpoFuncao)).toBe(true);
  });

  it("a cobrança do pedido é ligada ao envio pelo mapa, com a organização no join", () => {
    expect(
      /join\s+public\.ml_shipment_pedido\s+sp[\s\S]{0,200}?sp\.organization_id\s*=\s*f\.organization_id/i.test(
        corpoFuncao,
      ),
    ).toBe(true);
  });

  it("existe um pedido líder por envio, escolhido de forma determinística", () => {
    expect(/ml_order_lider/.test(corpoFuncao)).toBe(true);
    expect(/array_agg\s*\([\s\S]{0,120}?order\s+by\s+length\s*\(/i.test(corpoFuncao)).toBe(true);
  });

  it("🔴 a diferença só é calculada no líder — repeti-la contaria o pacote N vezes", () => {
    expect(
      /ml_order_lider\s+is\s+not\s+distinct\s+from[\s\S]{0,80}?then\s+round\s*\(/i.test(corpoFuncao),
    ).toBe(true);
  });

  it("🔴 a cobrança do pacote também sai uma vez só, no líder", () => {
    const slots = corpoFuncao.match(/case\s+when\s+m\.e_lider\s+then\s+round\s*\(\s*m\.cobrado/gi) ?? [];
    // `cobranca_declarada` e `recebido` — os dois slots que a tela soma.
    expect(slots.length).toBe(2);
  });
});

// ─── 3. O netting do estorno continua intacto ───────────────────────────────

describe("netting — o BONUS repete o CHARGE, então somar direto declara cobrança em dobro", () => {
  it("o case de inversão de sinal continua presente", () => {
    expect(
      /case\s+when\s+f\.detail_type\s*=\s*'BONUS'\s+or\s+f\.charge_bonified_id\s+is\s+not\s+null\s+then\s*-\s*f\.detail_amount/i.test(
        corpoFuncao,
      ),
    ).toBe(true);
  });

  it("🔴 não existe soma crua de detail_amount fora do case", () => {
    const somas = corpoFuncao.match(/sum\s*\(\s*f?\.?detail_amount/gi) ?? [];
    expect(somas.length).toBe(0);
  });

  it("`n_frete` conta só linhas de cobrança, sem BFFE", () => {
    expect(
      /count\s*\(\s*\*\s*\)\s*filter\s*\(\s*where\s+f\.detail_sub_type\s+in\s*\(\s*'CFFE'\s*,\s*'CXDE'\s*,\s*'CXDED'\s*\)/i.test(
        corpoFuncao,
      ),
    ).toBe(true);
  });
});

// ─── 4. A cascata de motivos, com os oito ramos ─────────────────────────────

describe("cascata de motivos — quem não fecha diz a causa REAL (D-239-01)", () => {
  const OITO = [
    "frete_sem_envio_capturado",
    "frete_sem_opcao_no_envio",
    "frete_apurado_no_pacote",
    "frete_cobranca_nao_emitida",
    "frete_sem_cobranca_registrada",
    "frete_abaixo_do_piso",
    "frete_a_menor_medido",
    "frete_a_maior_confirmado",
  ];

  it("os oito motivos são emitidos pela função", () => {
    for (const m of OITO) {
      expect(corpoFuncao.includes(`'${m}'`), `motivo ausente da cascata: ${m}`).toBe(true);
    }
  });

  it("🔴 `frete_a_menor_medido` existe — sem o lado negativo, 'é sempre a mais' seria irrefutável", () => {
    expect(/when\s+c\.dif\s*<\s*0\s+then\s+'frete_a_menor_medido'/i.test(corpoFuncao)).toBe(true);
  });

  it("a ordem é por durabilidade: envio ausente antes de opção ausente, e as duas antes do pacote", () => {
    const i1 = corpoFuncao.indexOf("'frete_sem_envio_capturado'");
    const i2 = corpoFuncao.indexOf("'frete_sem_opcao_no_envio'");
    const i3 = corpoFuncao.indexOf("'frete_apurado_no_pacote'");
    const i4 = corpoFuncao.indexOf("'frete_cobranca_nao_emitida'");
    const i5 = corpoFuncao.indexOf("'frete_sem_cobranca_registrada'");
    expect(i1).toBeGreaterThan(-1);
    expect(i1).toBeLessThan(i2);
    expect(i2).toBeLessThan(i3);
    expect(i3).toBeLessThan(i4);
    expect(i4).toBeLessThan(i5);
  });

  it("🔴 os 18 dias são constante NOMEADA, não número solto na cascata", () => {
    expect(/\b18\s+as\s+defasagem_max_cffe\b/i.test(corpoFuncao)).toBe(true);
    expect(/hoje\s*-\s*defasagem_max_cffe/i.test(corpoFuncao)).toBe(true);
  });

  it("`tipo_caso` continua DERIVADO da diferença, e a junção continua no literal", () => {
    expect(/when\s+m\.dif\s+is\s+null\s+then\s+'frete_em_aberto'/i.test(corpoFuncao)).toBe(true);
    expect(/k\.tipo_caso\s*=\s*'frete_a_maior'/i.test(corpoFuncao)).toBe(true);
  });

  it("só o motivo confirmado é acionável", () => {
    expect(
      /\(\s*m\.motivo\s*=\s*'frete_a_maior_confirmado'\s*\)\s+as\s+acionavel/i.test(corpoFuncao),
    ).toBe(true);
  });

  it("a fila 'nosso' recebe só lacuna NOSSA — espera do ML não infla fila de trabalho", () => {
    const m = /then\s+'ml'([\s\S]{0,300}?)then\s+'nosso'/i.exec(corpoFuncao);
    expect(m).not.toBeNull();
    const ramoNosso = m![1];
    expect(ramoNosso).toContain("frete_sem_envio_capturado");
    expect(ramoNosso).not.toContain("frete_cobranca_nao_emitida");
    expect(ramoNosso).not.toContain("frete_sem_opcao_no_envio");
  });
});

// ─── 5. 🔴 Não-regressão: as duas suposições não voltam ─────────────────────

describe("não-regressão — a heurística e a tabela do item não voltam pela porta dos fundos", () => {
  it("🔴 a heurística de carrinho (comprador + dia) sumiu do corpo da função", () => {
    expect(/n_no_grupo/i.test(corpoFuncao)).toBe(false);
    expect(/partition\s+by\s+\w*\.?comprador/i.test(corpoFuncao)).toBe(false);
    expect(/'possivel_carrinho'/i.test(corpoFuncao)).toBe(false);
  });

  it("🔴 a tabela de frete por ANÚNCIO não é lida por esta função, nem como plano B", () => {
    expect(/ml_item_frete_tabela/i.test(corpoFuncao)).toBe(false);
    expect(/'frete_sem_vigencia_na_venda'/i.test(corpoFuncao)).toBe(false);
    expect(/'frete_multi_item'/i.test(corpoFuncao)).toBe(false);
  });

  it("🔴 e não há leitura dela em lugar nenhum do arquivo", () => {
    // O bloco de guarda pode NOMEAR o marcador para saber o que substitui; o
    // que não pode existir é um `from`/`join` de verdade contra ela.
    expect(/\b(from|join)\s+public\.ml_item_frete_tabela\b/i.test(corpo)).toBe(false);
  });

  it("a guarda do corpo VIVO existe e aceita os dois corpos conhecidos", () => {
    expect(/pg_get_functiondef/i.test(corpo)).toBe(true);
    expect(/o corpo VIVO de conciliacao_frete_linhas/i.test(bruto)).toBe(true);
    expect(/to_regclass\s*\(\s*'public\.ml_shipment_pedido'\s*\)/i.test(corpo)).toBe(true);
  });
});

// ─── 6. Perímetro: este plano não liga régua nenhuma ────────────────────────

describe("perímetro — provar não é acusar", () => {
  it("🔴 o arquivo não escreve em conciliacao_config", () => {
    expect(/update\s+public\.conciliacao_config/i.test(corpo)).toBe(false);
    expect(/update\s+conciliacao_config/i.test(corpo)).toBe(false);
    expect(/insert\s+into\s+\w*\.?conciliacao_config/i.test(corpo)).toBe(false);
  });

  it("as guardas abortam se alguma das duas réguas estiver ligada", () => {
    expect(/acusar_frete_a_maior esta LIGADA/i.test(bruto)).toBe(true);
    expect(/acusar_valor_a_menor esta LIGADA/i.test(bruto)).toBe(true);
  });

  it("nenhum DML e nenhum drop além de drop policy", () => {
    expect(/\binsert\s+into\b/i.test(corpo)).toBe(false);
    expect(/\bdelete\s+from\b/i.test(corpo)).toBe(false);
    expect(/\btruncate\b/i.test(corpo)).toBe(false);
    const drops = corpo.match(/\bdrop\s+(\w+)/gi) ?? [];
    for (const d of drops) expect(d.toLowerCase()).toMatch(/^drop\s+policy$/);
  });

  it("🔴 nenhum UUID literal — a função recorta pelo parâmetro, não por org fixa", () => {
    expect(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(corpo)).toBe(false);
  });
});

// ─── 7. Segurança: INVOKER e ACL no mesmo arquivo ───────────────────────────

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
    expect((corpo.match(/\bsecurity\s+invoker\b/gi) ?? []).length).toBe(1);
    expect((corpo.match(/\bset\s+search_path\s*=\s*public\b/gi) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("a guarda de execução confere prosecdef no próprio catálogo", () => {
    expect(/\bp\.prosecdef\b/i.test(corpo)).toBe(true);
    expect(/raise\s+exception[^;]*DEFINER/i.test(corpo)).toBe(true);
  });
});

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

  it("devolve execute a authenticated no mesmo arquivo", () => {
    expect(
      /grant\s+execute\s+on\s+function\s+public\.conciliacao_frete_linhas\s*\([^)]*\)\s+to\s+authenticated/i.test(
        corpo,
      ),
    ).toBe(true);
  });

  it("as duas guardas de privilégio existem, e conferem os dois papéis", () => {
    expect(/has_function_privilege\s*\(\s*'anon'/i.test(corpo)).toBe(true);
    expect(/has_function_privilege\s*\(\s*'authenticated'/i.test(corpo)).toBe(true);
  });
});

// ─── 8. Contrato: as 24 colunas não mudam ───────────────────────────────────

describe("contrato — a tela e as outras réguas dependem das 24 colunas", () => {
  it("a assinatura devolve exatamente as 24 colunas esperadas, na ordem", () => {
    const m = /returns\s+table\s*\(([\s\S]*?)\)\s*language\s+sql/i.exec(corpo);
    expect(m).not.toBeNull();
    const nomes = m![1]
      .split(",")
      .map((l) => l.trim().split(/\s+/)[0])
      .filter(Boolean);
    expect(nomes.length).toBe(24);
    expect(nomes[0]).toBe("caso_id");
    expect(nomes[23]).toBe("valor_estimado");
    for (const obrigatoria of [
      "esperado_nosso",
      "recebido",
      "residuo_nosso",
      "diferenca",
      "retido_de_fato",
      "cobranca_declarada",
    ]) {
      expect(nomes, `coluna do card sumiu: ${obrigatoria}`).toContain(obrigatoria);
    }
  });
});
