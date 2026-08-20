/**
 * recalcOrderCostsContrato.test.ts — prova ESTRUTURAL offline da edge function
 * `recalc-order-costs` (Quick 260820-jic, D-jic-01 e D-jic-02).
 *
 * POR QUE ESTE ARQUIVO EXISTE: `supabase/functions/**` **não é typechecked**
 * (`tsc --noEmit` cobre só `src/`). Se `bonus_envio` ou `custo_entrega` saírem
 * da projeção do `.select()`, a função continua compilando, continua devolvendo
 * `success: true`, e grava `receita_liquida` MENOR em todo pedido Flex — bônus
 * perdido, custo de entrega perdido, e nada avisa. É a MESMA forma de três
 * defeitos já pagos nesta casa: `data_pedido` usada no filtro e ausente da
 * projeção (222-05-R), a whitelist de `batch_upsert_orders` (Fase 96-07) e
 * `frete_comprador` (222-13-R2). Coluna que o laço usa TEM de estar na
 * projeção — não há como o compilador cobrar isso, então cobra este teste.
 *
 * O mesmo vale para o desligamento silencioso dos dois helpers: alguém pode
 * "simplificar" o filtro de volta para `.lte("data_pedido", date_to)` ou
 * atribuir `patch.receita_liquida` direto, escapando da guarda, e nenhum outro
 * teste da suíte notaria.
 *
 * Molde de `src/lib/fiscal/batchUpsertColunasAlinhadas.test.ts` (commit
 * 20803eeb): `readFileSync` + `resolve(process.cwd(), ...)`, NUNCA
 * `import.meta.url` — a suíte roda em jsdom, onde `import.meta.url` é uma URL
 * `http://` do servidor do Vite e `fileURLToPath` recusa.
 *
 * 🔴 TODAS as asserções rodam sobre o arquivo SEM COMENTÁRIOS. O `index.ts` é
 * fortemente comentado, a correção ganha um comentário explicando o defeito
 * antigo (que CITA a forma antiga), e sem esta limpeza a prosa contaria como se
 * fosse código — a colisão prosa-versus-grep que `difalRpcAudit.test.ts` já
 * documenta.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ARQ_EDGE = "supabase/functions/recalc-order-costs/index.ts";

function ler(caminho: string): string {
  return readFileSync(resolve(process.cwd(), caminho), "utf8");
}

/**
 * Remove comentários de bloco (`/* ... *\/`, inclusive JSDoc) e de linha (`//`
 * até o fim da linha). Bloco primeiro: um `//` dentro de um bloco não pode
 * encurtar a remoção do bloco.
 *
 * ⚠️ Isto TAMBÉM decapita as URLs de import (`https://deno.land/...`), o que é
 * inofensivo aqui — nenhuma asserção deste arquivo mira uma URL remota.
 */
function semComentarios(ts: string): string {
  const semBloco = ts.replace(/\/\*[\s\S]*?\*\//g, " ");
  return semBloco
    .split("\n")
    .map((linha) => {
      const i = linha.indexOf("//");
      return i === -1 ? linha : linha.slice(0, i);
    })
    .join("\n");
}

/** A projeção do `.select()` que segue `.from("orders")`, como string crua. */
function projecaoDeOrders(corpo: string): string {
  const m = /\.from\(\s*"orders"\s*\)\s*\.select\(\s*"([^"]*)"\s*\)/.exec(corpo);
  if (!m) {
    throw new Error(`projeção de .from("orders").select("...") não encontrada em ${ARQ_EDGE}`);
  }
  return m[1];
}

/** As colunas da projeção, aparadas. */
function colunasProjetadas(corpo: string): string[] {
  return projecaoDeOrders(corpo)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Extrai o texto entre parênteses BALANCEADOS da chamada de `nome(...)`. Sem
 * balanceamento, a captura pararia no primeiro `)` interno — e a chamada que
 * este teste audita tem chamadas aninhadas dentro.
 */
function argumentosDaChamada(corpo: string, nome: string): string {
  const alvo = `${nome}(`;
  const inicio = corpo.indexOf(alvo);
  if (inicio === -1) {
    throw new Error(`chamada de ${nome}( não encontrada em ${ARQ_EDGE}`);
  }
  let profundidade = 0;
  for (let i = inicio + alvo.length - 1; i < corpo.length; i++) {
    if (corpo[i] === "(") profundidade++;
    else if (corpo[i] === ")") {
      profundidade--;
      if (profundidade === 0) return corpo.slice(inicio + alvo.length, i);
    }
  }
  throw new Error(`parênteses da chamada de ${nome}( não fecham em ${ARQ_EDGE}`);
}

const BRUTO = ler(ARQ_EDGE);
const CORPO = semComentarios(BRUTO);

describe("recalc-order-costs — a projeção do .select() de orders", () => {
  it("a extração encontrou uma projeção real (não vazia, com as colunas já conhecidas)", () => {
    // Sem esta exigência, uma extração truncada devolveria lista vazia e as
    // asserções negativas passariam por vacuidade.
    const cols = colunasProjetadas(CORPO);
    expect(cols.length).toBeGreaterThan(15);
    expect(cols).toContain("id");
    expect(cols).toContain("data_pedido");
    expect(cols).toContain("frete_comprador");
    expect(cols).toContain("receita_bruta");
  });

  it("🔴 bonus_envio está na projeção — sem ele todo pedido Flex é regravado com receita líquida MENOR", () => {
    expect(colunasProjetadas(CORPO)).toContain("bonus_envio");
  });

  it("🔴 custo_entrega está na projeção — mesmo ponto de falha silenciosa", () => {
    expect(colunasProjetadas(CORPO)).toContain("custo_entrega");
  });
});

describe("recalc-order-costs — a janela de data vem do helper, não de comparação escrita à mão", () => {
  it("o corpo usa fimExclusivoDataPedido", () => {
    expect(CORPO).toContain("fimExclusivoDataPedido");
  });

  it("o corpo usa inicioInclusivoDataPedido — os DOIS extremos são normalizados", () => {
    expect(CORPO).toContain("inicioInclusivoDataPedido");
  });

  it("o corpo tem um limite superior EXCLUSIVO: .lt( aplicado a data_pedido", () => {
    expect(CORPO).toContain(".lt(");
    expect(CORPO).toMatch(/\.lt\(\s*['"]data_pedido['"]/);
  });

  it("🔴 o corpo NÃO tem mais o limite superior inclusivo sobre data_pedido", () => {
    // A forma antiga varria ZERO pedidos com date_from = date_to, dizendo
    // success: true. Tolerante a aspas simples/duplas e a espaço.
    expect(CORPO).not.toMatch(/\.lte\(\s*['"]data_pedido['"]/);
  });

  it("o import do helper de janela aponta para ../_shared/", () => {
    expect(CORPO).toMatch(/from\s+["']\.\.\/_shared\/janelaDataPedido(\.ts)?["']/);
  });
});

describe("recalc-order-costs — receita_liquida só entra pelo molde, atrás da guarda", () => {
  it("o corpo usa campoReceitaLiquidaParaPatch", () => {
    expect(CORPO).toContain("campoReceitaLiquidaParaPatch");
  });

  it("🔴 o corpo NÃO atribui patch.receita_liquida direto — não pode haver segundo caminho", () => {
    expect(CORPO).not.toContain("patch.receita_liquida");
  });

  it("🔴 a chamada do molde recebe reguaApurouNestaRodada( no campo reguaApurou — é o que amarra D-jic-02 ao código", () => {
    const args = argumentosDaChamada(CORPO, "campoReceitaLiquidaParaPatch");
    expect(args).toContain("reguaApurou");
    expect(args).toContain("reguaApurouNestaRodada(");
  });

  it("a chamada do molde recebe bonusEnvio e custoEntrega — as duas colunas novas da projeção chegam à fórmula", () => {
    const args = argumentosDaChamada(CORPO, "campoReceitaLiquidaParaPatch");
    expect(args).toContain("bonusEnvio");
    expect(args).toContain("custoEntrega");
  });

  it("o import do molde aponta para ../_shared/flexOrder", () => {
    expect(CORPO).toMatch(/from\s+["']\.\.\/_shared\/flexOrder(\.ts)?["']/);
  });

  it("🔴 a fórmula NÃO é reescrita aqui: computeReceitaLiquida não é chamada direto na edge function", () => {
    // Uma fórmula só, a do sync — três cópias divergentes desta conta foi o
    // que criou a Fase 220.
    expect(CORPO).not.toContain("computeReceitaLiquida(");
  });
});

// ── PINOS de não-regressão (restrição dura do quick 260820-jic) ─────────────
//
// ⚠️ Estes dois nascem VERDES, de propósito — são PINOS, no mesmo espírito do
// "pino histórico" de `batchUpsertColunasAlinhadas.test.ts`. Não provam um
// defeito: travam duas coisas que este quick NÃO pode mover, e que nenhuma
// outra assertiva desta suíte prenderia se alguém as removesse junto com uma
// refatoração da janela ou do molde da receita líquida.
describe("recalc-order-costs — o que este quick NÃO pode mover", () => {
  it("🔴 o bloco de tax_amount/tax_versao segue intacto e atrás do MESMO predicado", () => {
    // Nenhum tax_amount pode mudar por causa deste quick: ele acrescenta a
    // gravação de uma coluna DERIVADA e conserta o filtro de janela.
    const bloco =
      /if\s*\(\s*reguaApurouNestaRodada\(breakdown\)\s*\)\s*\{\s*patch\.tax_amount\s*=\s*taxAmount;\s*patch\.tax_versao\s*=\s*TAX_VERSAO_REGUA_NOVA;\s*\}/;
    expect(CORPO).toMatch(bloco);
  });

  it("🔴 o clamp em zero do quick 260820-ikj segue vivo nos DOIS cenários da régua", () => {
    // Clampar só um cenário inverteria a ordem nas faixas de MCO de todas as
    // telas. O clamp é do arquivo aprovado pela contadora — desfazê-lo aqui
    // seria desfazer o que já está em produção desde 20/08.
    const regua = semComentarios(ler("supabase/functions/_shared/orderTaxRate.ts"));
    expect(regua).toContain("Math.max(0, taxAmountBruto)");
    expect(regua).toContain("Math.max(0, taxAmountComDifalBruto)");
  });
});
