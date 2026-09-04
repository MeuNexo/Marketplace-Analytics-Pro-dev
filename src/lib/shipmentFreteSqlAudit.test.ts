/**
 * shipmentFreteSqlAudit.test.ts — auditoria estática da captura do esperado
 * histórico do frete por ENVIO (Fase 239, plano 239-02).
 *
 * O QUE ESTE PORTÃO PROTEGE, e por que ele lê do disco em vez de consultar o
 * banco: aplicar migration e publicar edge function são portões do
 * orquestrador nesta fase — o executor não alcança `ckcdevcxgvueywivefgx` nem
 * a API do ML. Sem esta auditoria, uma tabela sem RLS, um `seller_id` (UUID
 * interno) montado em path de API, ou — o pior de todos — uma queda de
 * `list_cost` para `base_cost` só seriam pegos depois de o banco já estar
 * escrito. E os três saem PLAUSÍVEIS: nenhum teste quebra, nenhuma tela pisca.
 *
 * 🔴 A ASSERÇÃO CENTRAL É A DA QUEDA PARA `base_cost`. Medido em M-07
 * (04/09/2026, 6 pedidos contra a API do ML): `cobrado == list_cost` ao centavo
 * em 6 de 6, e `base_cost` foi SEMPRE MAIOR (28,70 × 27,05 · 38,10 × 19,05 ·
 * 90,50 × 45,25). Usar `base_cost` como régua fabricaria "frete cobrado a
 * menor" em 100% dos pedidos — uma tela inteira de acusação falsa contra o ML,
 * que é exatamente o defeito que a fase 239 existe para matar. `sync-ml-orders`
 * já faz essa queda hoje (`s.shipping_option?.list_cost ?? s.base_cost`), e é
 * de lá que a tentação de copiar viria.
 *
 * Molde: `src/lib/conciliacaoSqlAudit.test.ts` (225-02) — remove comentários
 * antes de qualquer contagem, para que uma frase de cabeçalho explicando o que
 * é proibido não seja contada como se FOSSE a coisa proibida.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Caminhos relativos à RAIZ DO REPO (`process.cwd()`), não a
 *  `import.meta.url`: a suíte roda em jsdom, onde `import.meta.url` é uma URL
 *  `http://` do Vite. */
const ARQ_SQL = "supabase/migrations/20260905110000_ml_shipment_frete.sql";
const ARQ_EF = "supabase/functions/sync-ml-shipment-frete/index.ts";

const sqlBruto = readFileSync(resolve(process.cwd(), ARQ_SQL), "utf8");
const efBruto = readFileSync(resolve(process.cwd(), ARQ_EF), "utf8");

function semComentariosSql(sql: string): string {
  return sql
    .split("\n")
    .map((linha) => {
      const i = linha.indexOf("--");
      return i === -1 ? linha : linha.slice(0, i);
    })
    .join("\n");
}

/**
 * Remove comentários de TypeScript SEM quebrar strings. Um removedor ingênuo de
 * `//` decapitaria `"https://api.mercadolibre.com"` e a auditoria passaria a
 * medir um arquivo que não existe. O scanner acompanha o estado (fora de
 * string, string simples/dupla/template) e só corta comentário quando está
 * fora de string.
 */
function semComentariosTs(ts: string): string {
  let fora = "";
  let i = 0;
  let estado: "codigo" | "aspas1" | "aspas2" | "template" = "codigo";
  while (i < ts.length) {
    const c = ts[i];
    const prox = ts[i + 1];
    if (estado === "codigo") {
      if (c === "/" && prox === "/") {
        while (i < ts.length && ts[i] !== "\n") i++;
        continue;
      }
      if (c === "/" && prox === "*") {
        i += 2;
        while (i < ts.length && !(ts[i] === "*" && ts[i + 1] === "/")) i++;
        i += 2;
        continue;
      }
      if (c === '"') estado = "aspas2";
      else if (c === "'") estado = "aspas1";
      else if (c === "`") estado = "template";
    } else {
      if (c === "\\") {
        fora += ts.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (
        (estado === "aspas2" && c === '"') ||
        (estado === "aspas1" && c === "'") ||
        (estado === "template" && c === "`")
      ) estado = "codigo";
    }
    fora += c;
    i++;
  }
  return fora;
}

const sql = semComentariosSql(sqlBruto);
const ef = semComentariosTs(efBruto);

const TABELAS = [
  "ml_shipment_frete",
  "ml_shipment_pedido",
  "ml_shipment_frete_captura",
] as const;

// ─── 1. As três tabelas nascem protegidas ───────────────────────────────────

describe("as três tabelas nascem com RLS — tabela sem RLS não é alcançada pelo lint", () => {
  it.each(TABELAS)("%s liga row level security no MESMO arquivo que a cria", (t) => {
    expect(
      new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+public\\.${t}\\b`, "i").test(sql),
    ).toBe(true);
    expect(
      new RegExp(`alter\\s+table\\s+public\\.${t}\\s+enable\\s+row\\s+level\\s+security`, "i")
        .test(sql),
    ).toBe(true);
  });

  it.each(TABELAS)("%s tem policy de select para authenticated", (t) => {
    const regex = new RegExp(
      `create\\s+policy\\s+${t}_select\\s+on\\s+public\\.${t}[\\s\\S]{0,200}?for\\s+select\\s+to\\s+authenticated`,
      "i",
    );
    expect(regex.test(sql)).toBe(true);
  });

  it("toda policy do arquivo passa por is_org_member — nenhuma exceção", () => {
    const policies = sql.match(/create\s+policy\s+[\s\S]*?;/gi) ?? [];
    expect(policies.length).toBe(TABELAS.length);
    for (const p of policies) {
      expect(/is_org_member\s*\(\s*auth\.uid\(\)\s*,\s*organization_id\s*\)/i.test(p)).toBe(true);
    }
  });

  it("nenhuma policy de escrita para authenticated — quem escreve é o papel de serviço", () => {
    const policies = sql.match(/create\s+policy\s+[\s\S]*?;/gi) ?? [];
    for (const p of policies) {
      expect(/for\s+(insert|update|delete|all)\b/i.test(p)).toBe(false);
    }
  });

  it.each(TABELAS)("revoga de %s o acesso de anon NOMINALMENTE — revoke de PUBLIC não basta", (t) => {
    expect(new RegExp(`revoke\\s+all\\s+on\\s+public\\.${t}\\s+from\\s+anon`, "i").test(sql))
      .toBe(true);
    expect(new RegExp(`grant\\s+select\\s+on\\s+public\\.${t}\\s+to\\s+authenticated`, "i").test(sql))
      .toBe(true);
  });

  it("a guarda final falha alto se anon continuar lendo ou se a RLS não subir", () => {
    expect(/has_table_privilege\s*\(\s*'anon'/i.test(sql)).toBe(true);
    expect(/raise\s+exception[^;]*seguranca de linha ligada/i.test(sql)).toBe(true);
    expect(/raise\s+exception[^;]*anon ainda LE/i.test(sql)).toBe(true);
  });
});

// ─── 2. As chaves são as do domínio, e o alvo depende delas ─────────────────

describe("as chaves — envio para o custo, pedido para o mapa", () => {
  it("ml_shipment_frete é chaveada pelo ENVIO: carrinho tem N pedidos e UM custo", () => {
    expect(/constraint\s+ml_shipment_frete_pk\s+primary\s+key\s*\(\s*organization_id\s*,\s*shipment_id\s*\)/i.test(sql))
      .toBe(true);
  });

  it("ml_shipment_pedido é chaveada pelo PEDIDO — é o mapa 1:N que troca a heurística de carrinho por fato", () => {
    expect(/constraint\s+ml_shipment_pedido_pk\s+primary\s+key\s*\(\s*organization_id\s*,\s*ml_order_id\s*\)/i.test(sql))
      .toBe(true);
    expect(/create\s+index[\s\S]{0,120}?on\s+public\.ml_shipment_pedido\s*\(\s*organization_id\s*,\s*shipment_id\s*\)/i.test(sql))
      .toBe(true);
  });

  it("a captura é por pedido e tem o índice da fila (ultima_tentativa asc)", () => {
    expect(/constraint\s+ml_shipment_frete_captura_pk\s+primary\s+key\s*\(\s*organization_id\s*,\s*ml_order_id\s*\)/i.test(sql))
      .toBe(true);
    expect(/create\s+index[\s\S]{0,140}?on\s+public\.ml_shipment_frete_captura\s*\(\s*organization_id\s*,\s*ultima_tentativa\s+asc\s*\)/i.test(sql))
      .toBe(true);
  });

  it("list_cost é NULÁVEL — ausência precisa caber na coluna, senão vira zero ou base_cost", () => {
    // A régua ausente é uma resposta legítima (`sem_opcao_de_envio`). `not null`
    // aqui obrigaria a captura a inventar um número para conseguir gravar.
    expect(/\blist_cost\s+numeric\s+null\b/i.test(sql)).toBe(true);
    expect(/\blist_cost\s+numeric\s+not\s+null\b/i.test(sql)).toBe(false);
  });

  it("as duas pontas do custo são colunas SEPARADAS — no 6º pedido de M-07 só a soma fechou", () => {
    expect(/\bcusto_vendedor\s+numeric\b/i.test(sql)).toBe(true);
    expect(/\bcusto_comprador\s+numeric\b/i.test(sql)).toBe(true);
  });
});

// ─── 3. Perímetro da migration: nada semeado, nada removido, nada acusado ───

describe("perímetro — a migration cria e protege, e não faz mais nada", () => {
  it("não contém UUID literal — UUID não se completa por prefixo nesta casa", () => {
    expect(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(sql)).toBe(false);
  });

  it("não contém DML: as tabelas nascem vazias e quem captura é a edge function", () => {
    expect(/^\s*insert\s+into\s+/im.test(sql)).toBe(false);
    expect(/^\s*update\s+public\./im.test(sql)).toBe(false);
    expect(/\bdelete\s+from\b/i.test(sql)).toBe(false);
  });

  it("não remove objeto de banco existente (DROP fora de DROP POLICY)", () => {
    const drops = sql.match(/^\s*drop\s+\w+/gim) ?? [];
    expect(drops.length).toBeGreaterThan(0);
    for (const d of drops) expect(/drop\s+policy/i.test(d)).toBe(true);
  });

  it("🔴 NÃO liga régua de acusação nenhuma e não escreve em conciliacao_config", () => {
    // D-239 / fronteira do CONTEXT: esta fase é sobre PROVAR, não sobre acusar.
    expect(/acusar_frete_a_maior/i.test(sql)).toBe(false);
    expect(/acusar_valor_a_menor/i.test(sql)).toBe(false);
    expect(/conciliacao_config/i.test(sql)).toBe(false);
  });

  it("não redefine nenhuma função — nem a da tela, nem as de caixa da Fase 237", () => {
    expect(/create\s+or\s+replace\s+function/i.test(sql)).toBe(false);
    for (const fn of [
      "conciliacao_frete_linhas", "conciliacao_base_linhas", "get_casos_conciliacao",
      "get_dre_cash", "get_daily_balance", "get_cashflow",
    ]) {
      expect(sqlBruto.includes(fn + "(")).toBe(false);
    }
  });

  it("o comentário de list_cost registra M-07 no próprio banco — a régua e a proibição juntas", () => {
    const c = sqlBruto.match(/comment\s+on\s+column\s+public\.ml_shipment_frete\.list_cost[\s\S]*?;/i);
    expect(c, "comentário de list_cost ausente").not.toBeNull();
    expect(/6 de 6/i.test(c![0])).toBe(true);
    expect(/base_cost/i.test(c![0])).toBe(true);
  });
});

// ─── 4. A edge function nunca põe o UUID interno num path de API ────────────

describe("token e identidade — `seller_id` é UUID INTERNO e não entra em URL", () => {
  it("o token é buscado por ml_user_id", () => {
    expect(/\.from\(\s*["']ml_tokens["']\s*\)[\s\S]{0,400}?\.eq\(\s*["']ml_user_id["']/.test(ef))
      .toBe(true);
  });

  it("a string seller_id não aparece em lugar nenhum do código executável", () => {
    // `400 Invalid user_id in path`, medido em 04/09/2026 no plano irmão. A
    // asserção é dura de propósito: não existe uso legítimo de `seller_id`
    // nesta função, então basta a ausência.
    expect(/\bseller_id\b/.test(ef)).toBe(false);
  });

  it("toda URL da API do ML é montada a partir de caminho literal conhecido", () => {
    const usos = [...ef.matchAll(/ML_API\s*\+\s*([^,;\n)]+)/g)].map((m) => m[1].trim());
    expect(usos.length).toBeGreaterThan(0);
    for (const u of usos) {
      const ok = /^["']\/(orders|shipments|oauth)\//.test(u) || u === "caminho";
      expect(ok, "montagem de URL inesperada: " + u).toBe(true);
    }
    // E os caminhos literais que a função chama são exatamente os três do plano.
    expect(ef.includes('"/orders/" + mlOrderId')).toBe(true);
    expect(ef.includes('"/shipments/" + shipmentId')).toBe(true);
    expect(ef.includes('"/shipments/" + shipmentId + "/costs"')).toBe(true);
  });

  it("a guarda de papel de serviço existe e roda ANTES do trabalho", () => {
    expect(/function\s+requireServiceRole/.test(ef)).toBe(true);
    const iGuarda = ef.indexOf("const guard = requireServiceRole(req)");
    const iTrabalho = ef.indexOf("EdgeRuntime.waitUntil");
    expect(iGuarda).toBeGreaterThan(0);
    expect(iTrabalho).toBeGreaterThan(iGuarda);
  });
});

// ─── 5. 🔴 A ASSERÇÃO QUE PROTEGE A RÉGUA ──────────────────────────────────

describe("list_cost é a régua e base_cost NUNCA a substitui (M-07: base_cost maior em 6 de 6)", () => {
  it("não existe queda de list_cost para base_cost em nenhuma direção", () => {
    // Cobre `?? ` e `||`, nas duas ordens, na mesma expressão.
    expect(/list_cost[^;\n]{0,120}(\?\?|\|\|)[^;\n]{0,120}base_cost/i.test(ef)).toBe(false);
    expect(/base_cost[^;\n]{0,120}(\?\?|\|\|)[^;\n]{0,120}list_cost/i.test(ef)).toBe(false);
  });

  it("a variável que alimenta o campo list_cost não toca base em sua definição", () => {
    // A janela é a EXPRESSÃO INTEIRA (até o `;`), não um número fixo de linhas:
    // o ternário quebra em duas e a declaração seguinte é justamente a de
    // `base_cost` — medir por linhas contaria a vizinha e acusaria em falso.
    const i = ef.indexOf("const listCost =");
    expect(i, "definição de listCost não encontrada").toBeGreaterThan(0);
    const fim = ef.indexOf(";", i);
    expect(fim).toBeGreaterThan(i);
    const expressao = ef.slice(i, fim);
    expect(/base/i.test(expressao)).toBe(false);
    expect(/shipping_option|opcao|list_cost|bruto/i.test(expressao)).toBe(true);
  });

  it("o campo list_cost do upsert recebe a variável dedicada, nunca uma expressão", () => {
    expect(/\blist_cost:\s*listCost\s*,/.test(ef)).toBe(true);
  });

  it("base_cost só existe para alimentar base_cost_ref, que é diagnóstico", () => {
    const ocorrencias = ef.match(/base_cost/gi) ?? [];
    // `det.corpo.base_cost` (leitura) e `base_cost_ref:` (gravação). Nada mais.
    expect(ocorrencias.length).toBeGreaterThan(0);
    expect(/base_cost_ref:\s*baseRef\s*,/.test(ef)).toBe(true);
    expect(/const\s+brutoBase\s*=\s*det\.corpo\.base_cost/.test(ef)).toBe(true);
  });

  it("o cabeçalho x-format-new não aparece — com ele shipping_option volta vazio", () => {
    // Item 5 do Veredito, 222-ML-API.md. Com o cabeçalho, `logistic_type`,
    // `mode` e `shipping_option` voltam null: a captura ficaria plausível e
    // vazia ao mesmo tempo, que é a pior das falhas possíveis aqui.
    expect(/x-format-new/i.test(ef)).toBe(false);
    expect(/format[_-]?new/i.test(ef)).toBe(false);
  });

  it("ausência de list_cost tem status próprio, e não vira zero", () => {
    expect(/sem_opcao_de_envio/.test(ef)).toBe(true);
    expect(/listCost\s*===\s*null/.test(ef)).toBe(true);
    // Nenhum `?? 0` / `|| 0` em cima das grandezas de dinheiro.
    expect(/(listCost|custoVendedor|custoComprador)\s*(\?\?|\|\|)\s*0\b/.test(ef)).toBe(false);
  });

  it("as duas pontas do custo são lidas separadas, e `save`/`promoted_amount` ficam de fora", () => {
    expect(/senders/.test(ef)).toBe(true);
    expect(/receiver/.test(ef)).toBe(true);
    expect(/promoted_amount/.test(ef)).toBe(false);
    expect(/\bsave\b/.test(ef)).toBe(false);
  });
});

// ─── 6. Orçamento, pausa e o 429 que para a rodada inteira ─────────────────

describe("a varredura tem teto e o bloqueio do ML não é insistido", () => {
  it("há orçamento por invocação e ele fatia a fila", () => {
    expect(/const\s+ORCAMENTO_PADRAO\s*=\s*\d+/.test(ef)).toBe(true);
    expect(/pendentes\.slice\(\s*0\s*,\s*orcamento\s*\)/.test(ef)).toBe(true);
  });

  it("o parâmetro de orçamento só ENCOLHE o teto, nunca o estica", () => {
    expect(/Math\.min\(\s*Math\.floor\(orcBruto\)\s*,\s*ORCAMENTO_PADRAO\s*\)/.test(ef)).toBe(true);
  });

  it("há pausa entre requisições, dentro do laço", () => {
    expect(/const\s+PAUSA_MS\s*=\s*\d+/.test(ef)).toBe(true);
    expect(/await\s+dormir\(PAUSA_MS\)/.test(ef)).toBe(true);
  });

  it("429 é classe própria, para a rodada e NÃO dispara continuação", () => {
    expect(/class\s+BloqueioDoML/.test(ef)).toBe(true);
    expect(/res\.status\s*===\s*429/.test(ef)).toBe(true);
    expect(/motivoParada\s*=\s*["']bloqueio["']/.test(ef)).toBe(true);
    // O `break` sai do laço DEPOIS de registrar o estado do pedido — sem isso
    // a próxima onda não saberia onde parou.
    expect(/if\s*\(motivoParada\s*===\s*["']bloqueio["']\)\s*break;/.test(ef)).toBe(true);
    // Nenhuma reinvocação da própria função.
    expect(/sync-ml-shipment-frete["']?\s*\)/.test(ef.replace(/console\.\w+\([^)]*\)/g, ""))).toBe(false);
  });

  it("há trava diária por pedido — pedido que erra não monopoliza a fila", () => {
    expect(/const\s+hoje\s*=\s*diaEmSaoPaulo\(new\s+Date\(\)\)/.test(ef)).toBe(true);
    expect(/tentadoEm\.get\(id\)[\s\S]{0,60}?!==\s*hoje/.test(ef)).toBe(true);
  });

  it("envio já capturado não é rebuscado — carrinho compartilha o mesmo envio", () => {
    expect(/enviosConhecidos\.has\(shipmentId\)/.test(ef)).toBe(true);
  });

  it("o segundo pedido do carrinho herda o DESFECHO do envio, não um `ok` de cortesia", () => {
    // Marcar `ok` só porque o envio já estava na tabela contaminaria justamente
    // o contador de `sem_opcao_de_envio` — o número que aprova ou refuta a
    // premissa A2. A decisão sairia de um denominador adulterado.
    expect(/enviosConhecidos\s*=\s*new\s+Map<string,\s*boolean>/.test(ef)).toBe(true);
    expect(/if\s*\(enviosConhecidos\.get\(shipmentId\)\)/.test(ef)).toBe(true);
    expect(/enviosConhecidos\.set\(shipmentId,\s*listCost\s*!==\s*null\)/.test(ef)).toBe(true);
  });

  it("pedido sem envio próprio SAI da fila — senão `restam` nunca chega a zero", () => {
    // `sem_envio` não ganha linha em `ml_shipment_pedido` (não há envio para
    // mapear), então sem esta lista ele voltaria em toda rodada e o critério de
    // parada do backfill (`restam = 0`) jamais seria alcançado.
    expect(/const\s+resolvidos\s*=\s*new\s+Set<string>/.test(ef)).toBe(true);
    expect(/===\s*["']sem_envio["']\)\s*resolvidos\.add\(id\)/.test(ef)).toBe(true);
    expect(/!jaMapeados\.has\(id\)\s*&&\s*!resolvidos\.has\(id\)/.test(ef)).toBe(true);
  });

  it("a paginação tem ORDER BY — `.range()` sem ordem pula e repete linhas", () => {
    // Sem ordem estável o planner do Postgres pode devolver a página 2 com
    // linhas da 1 e omitir outras: a fila nasceria com buracos, pedidos nunca
    // varridos, e a cobertura ficaria abaixo do possível sem erro nenhum.
    expect(/\.order\(ordem,\s*\{\s*ascending:\s*true\s*\}\)/.test(ef)).toBe(true);
    const chamadas = [...ef.matchAll(/lerTudo\(\s*sb,\s*["'](\w+)["'],\s*["'][^"']+["'],\s*["'](\w+)["']/g)];
    expect(chamadas.length).toBe(4);
    for (const c of chamadas) expect(c[2].length).toBeGreaterThan(0);
    // 🔴 `orders` ordena por `id`, a chave ÚNICA. `ml_order_id` se repete (uma
    // linha por item) e linhas empatadas na FRONTEIRA da página podem trocar de
    // lugar entre requisições — some pedido da varredura sem erro nenhum.
    const orders = chamadas.find((c) => c[1] === "orders");
    expect(orders, "leitura de orders não encontrada").toBeTruthy();
    expect(orders![2]).toBe("id");
  });

  it("toda leitura de lista é paginada — o PostgREST trunca em 1000 sem avisar", () => {
    expect(/const\s+PAGINA\s*=\s*1000/.test(ef)).toBe(true);
    expect(/\.range\(\s*inicio\s*,\s*inicio\s*\+\s*PAGINA\s*-\s*1\s*\)/.test(ef)).toBe(true);
    // As três listas grandes passam por `lerTudo`, nunca por `.select()` cru.
    for (const t of ["orders", "ml_shipment_pedido", "ml_shipment_frete", "ml_shipment_frete_captura"]) {
      expect(new RegExp(`lerTudo\\(sb,\\s*["']${t}["']`).test(ef.replace(/\s+/g, " ")))
        .toBe(true);
    }
  });

  it("pedidos são contados DISTINTOS — orders tem uma linha por item", () => {
    expect(/new\s+Set\(linhasDePedido\.map/.test(ef)).toBe(true);
  });
});

// ─── 7. Perímetro da edge function ─────────────────────────────────────────

describe("a função captura e não decide — nenhuma acusação, nenhuma destruição", () => {
  it("não escreve em conciliacao_config: ela é LIDA para o escopo e mais nada", () => {
    expect(/\.from\(\s*["']conciliacao_config["']\s*\)\s*\.select/.test(ef)).toBe(true);
    expect(/\.from\(\s*["']conciliacao_config["']\s*\)\s*\.(insert|update|upsert|delete)/.test(ef))
      .toBe(false);
  });

  it("não apaga nada em lugar nenhum", () => {
    expect(/\.delete\(\s*\)/.test(ef)).toBe(false);
  });

  it("não toca orders nem as tabelas da régua do dinheiro", () => {
    expect(/\.from\(\s*["']orders["']\s*\)\s*\.(insert|update|upsert|delete)/.test(ef)).toBe(false);
    for (const t of ["cash_inflows", "ml_order_sale_fee", "conciliacao_casos", "mp_saidas"]) {
      expect(new RegExp(`["']${t}["']`).test(ef)).toBe(false);
    }
  });

  it("escreve apenas nas três tabelas desta migration (e no token, para renová-lo)", () => {
    const escritas = [...ef.matchAll(/\.from\(\s*["'](\w+)["']\s*\)\s*\.(upsert|insert|update|delete)/g)]
      .map((m) => m[1]);
    const permitidas = new Set([...TABELAS, "ml_tokens"]);
    for (const t of escritas) expect(permitidas.has(t as never), "escrita em " + t).toBe(true);
    expect(escritas.length).toBeGreaterThanOrEqual(3);
  });

  it("nenhum UUID literal — o escopo vem de dado, não de constante no código", () => {
    expect(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(ef)).toBe(false);
  });

  it("o horizonte segue a janela da tela por padrão — denominador menor infla a fração", () => {
    expect(/janela_dias/.test(ef)).toBe(true);
    expect(/dias\s*\?\?\s*janelaPorOrg\.get/.test(ef)).toBe(true);
  });

  it("data_pedido é comparada como TEXTO — converter para date cega o índice nesta base", () => {
    expect(/\.gte\(\s*["']data_pedido["']\s*,\s*corte\s*\)/.test(ef)).toBe(true);
    expect(/const\s+corte\s*=\s*diaEmSaoPaulo\(/.test(ef)).toBe(true);
  });

  it("🔴 toda data de recorte sai em America/Sao_Paulo, nunca em UTC", () => {
    // A RPC da tela recorta com `now() at time zone 'America/Sao_Paulo'`.
    // `toISOString().slice(0,10)` daria uma data até um dia MAIS RECENTE nas
    // três primeiras horas do dia UTC: a janela encurtaria e a cobertura seria
    // medida contra um universo diferente do que o Wesley vê.
    expect(/timeZone:\s*["']America\/Sao_Paulo["']/.test(ef)).toBe(true);
    // Nenhum recorte de DIA por UTC. (`toISOString()` inteiro segue válido para
    // carimbo de `timestamptz` — o que se proíbe é o fatiamento em data.)
    expect(/toISOString\(\)\.slice\(0,\s*10\)/.test(ef)).toBe(false);
  });
});
