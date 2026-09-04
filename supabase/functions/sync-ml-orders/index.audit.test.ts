/**
 * index.audit.test.ts — auditoria do FONTE de `sync-ml-orders`
 * (Fase 225, plano 225-10).
 *
 * POR QUE ESTE TESTE LÊ O ARQUIVO COMO TEXTO, EM VEZ DE IMPORTAR: o `.ts` da
 * edge function importa módulos remotos do Deno
 * (`https://deno.land/std@.../http/server.ts`, `https://esm.sh/...`), que o
 * vitest (node) não resolve. Molde:
 * `supabase/functions/sync-mp-releases/index.audit.test.ts` (225-01 / 225-09) —
 * leitura do disco, sem banco e sem rede, provando PROPRIEDADES do fonte em vez
 * do comportamento em runtime.
 *
 * ── O QUE ESTE PORTÃO PROTEGE ────────────────────────────────────────────────
 *
 * A ingestão de pedidos perdeu 26 vendas reais de 2026 — 0,29% do volume,
 * R$ 5.172,15 de receita paga que não existe no banco (`225-CENSO-PEDIDOS.md`,
 * diff por CONJUNTO de ids: 28 no ML e não no banco, zero no banco e não no ML,
 * 2 dos 28 apenas pendentes do próprio dia).
 *
 * A causa é provada e é diferente da que o repositório sugere: `/orders/search`
 * **só indexa pedido FECHADO** (9.097 de 9.097 com `date_closed`; dois pedidos
 * sem `date_closed` existem no ML e não aparecem em janela nenhuma da busca). O
 * sync varre por `date_created` e o corpo VIVO de `dispatch_orders_jobs` só
 * reagenda D−1..D−3 — depois disso a janela de um dia nunca mais é varrida, e
 * `reconcileCancelled`, a única passada posterior, **nunca faz INSERT**.
 *
 * 🔴 A ASSERÇÃO MAIS IMPORTANTE DESTE ARQUIVO É A DE QUE A PASSADA NOVA INSERE.
 * `reconcileCancelled` PASSARIA num portão que só verificasse "a passada roda":
 * ela roda todo dia, há meses, e nunca inseriu uma linha. Um portão que não
 * distinga inserir de atualizar aprovaria exatamente o defeito que a fase existe
 * para fechar.
 *
 * ESCRITO PELA FORMA, NÃO PELA GRAFIA DE HOJE: as asserções checam propriedades
 * (o ramo de conferência não tem porta de escrita; o filtro da recaptura vem
 * ANTES do primeiro enriquecimento; existe uma única régua de janela BRT), não o
 * texto exato de uma linha.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ARQ_FONTE = "supabase/functions/sync-ml-orders/index.ts";

function ler(caminho: string): string {
  return readFileSync(resolve(process.cwd(), caminho), "utf8");
}

/**
 * Remove comentários de linha (`//...`) e de bloco de um fonte TypeScript.
 * Sem isso a prosa que EXPLICA a regra é contada como a violação que ela
 * documenta — a mesma colisão prosa-versus-grep que já mordeu esta base
 * (`rebateSqlAudit.test.ts`, 223-03). Este arquivo em particular depende disso:
 * o cabeçalho do fonte NOMEIA a causa e cita `paging.total`, `date_closed` e os
 * dois interruptores de backfill em texto corrido.
 */
function semComentarios(ts: string): string {
  return ts
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((linha) => {
      const i = linha.indexOf("//");
      return i === -1 ? linha : linha.slice(0, i);
    })
    .join("\n");
}

/** O bloco `{ … }` que começa no primeiro `{` depois de `marca`, sem as chaves externas. */
function blocoApos(corpoFonte: string, marca: string, aPartirDe = 0): string {
  const pos = corpoFonte.indexOf(marca, aPartirDe);
  expect(pos, `marca não encontrada no fonte: ${marca}`).toBeGreaterThan(-1);
  const inicio = corpoFonte.indexOf("{", pos);
  expect(inicio, `bloco não abre depois de: ${marca}`).toBeGreaterThan(-1);
  let profundidade = 0;
  for (let i = inicio; i < corpoFonte.length; i++) {
    if (corpoFonte[i] === "{") profundidade++;
    else if (corpoFonte[i] === "}") {
      profundidade--;
      if (profundidade === 0) return corpoFonte.slice(inicio + 1, i);
    }
  }
  throw new Error(`bloco não fecha depois de ${marca} — fonte malformado?`);
}

/**
 * O bloco `{ … }` que CONTÉM a posição dada, achado por contagem de chaves para
 * os dois lados. Serve para perguntar "o que mais existe dentro do ramo onde
 * esta chamada mora?" sem depender do nome da variável de condição.
 */
function blocoQueContem(corpoFonte: string, posicao: number): string {
  let profundidade = 0;
  let inicio = -1;
  for (let i = posicao; i >= 0; i--) {
    if (corpoFonte[i] === "}") profundidade++;
    else if (corpoFonte[i] === "{") {
      if (profundidade === 0) { inicio = i; break; }
      profundidade--;
    }
  }
  expect(inicio, "não achei o bloco que contém a posição " + posicao).toBeGreaterThan(-1);

  let p2 = 0;
  for (let i = inicio; i < corpoFonte.length; i++) {
    if (corpoFonte[i] === "{") p2++;
    else if (corpoFonte[i] === "}") {
      p2--;
      if (p2 === 0) return corpoFonte.slice(inicio + 1, i);
    }
  }
  throw new Error("bloco não fecha — fonte malformado?");
}

/**
 * O corpo de uma função nomeada (`function nome(` / `async function nome(`).
 *
 * 🔴 NÃO SERVE PEGAR O PRIMEIRO `{` DEPOIS DO NOME. Uma função cuja anotação de
 * retorno seja um objeto literal — `): Promise<{ ausentes: string[] }>` — tem um
 * `{` antes do corpo, e a versão ingênua desta função devolvia a ANOTAÇÃO DE
 * TIPO como se fosse o corpo. Foi assim que este portão reprovou
 * `buscarPedidosPorId` e `filtrarIdentificadoresAusentes` estando os dois
 * corretos: o gate estava errado, não o código.
 *
 * Aqui a lista de parâmetros é fechada por contagem de parênteses e o corpo é o
 * primeiro `{` em profundidade ZERO de sinais de tipo genérico.
 */
function corpoDaFuncao(corpoFonte: string, nome: string): string {
  const re = new RegExp("(?:async\\s+)?function\\s+" + nome + "\\s*\\(");
  const m = re.exec(corpoFonte);
  expect(m, `função não encontrada no fonte: ${nome}`).not.toBeNull();

  const abreParams = corpoFonte.indexOf("(", m!.index);
  let profundidade = 0;
  let fechaParams = -1;
  for (let i = abreParams; i < corpoFonte.length; i++) {
    if (corpoFonte[i] === "(") profundidade++;
    else if (corpoFonte[i] === ")") {
      profundidade--;
      if (profundidade === 0) { fechaParams = i; break; }
    }
  }
  expect(fechaParams, `lista de parâmetros de ${nome} não fecha`).toBeGreaterThan(-1);

  let angulo = 0;
  let inicioCorpo = -1;
  for (let i = fechaParams + 1; i < corpoFonte.length; i++) {
    const c = corpoFonte[i];
    if (c === "<") angulo++;
    else if (c === ">") angulo--;
    else if (c === "{" && angulo === 0) { inicioCorpo = i; break; }
  }
  expect(inicioCorpo, `corpo de ${nome} não encontrado`).toBeGreaterThan(-1);

  let p = 0;
  for (let i = inicioCorpo; i < corpoFonte.length; i++) {
    if (corpoFonte[i] === "{") p++;
    else if (corpoFonte[i] === "}") {
      p--;
      if (p === 0) return corpoFonte.slice(inicioCorpo + 1, i);
    }
  }
  throw new Error(`corpo de ${nome} não fecha — fonte malformado?`);
}

/**
 * O nome da função nomeada mais próxima ANTES da posição dada. Devolve null se
 * a posição não está dentro de nenhuma função nomeada (por exemplo, solta no
 * corpo do handler anônimo do `serve`).
 */
function funcaoQueContem(corpoFonte: string, posicao: number): string | null {
  const re = /(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*[(<]/g;
  let ultimo: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(corpoFonte)) !== null) {
    if (m.index > posicao) break;
    ultimo = m[1];
  }
  return ultimo;
}

/** Todas as posições de uma agulha no palheiro. */
function posicoes(palheiro: string, agulha: string): number[] {
  const saida: number[] = [];
  let cursor = 0;
  for (;;) {
    const i = palheiro.indexOf(agulha, cursor);
    if (i === -1) break;
    saida.push(i);
    cursor = i + agulha.length;
  }
  return saida;
}

/** O corpo do handler do `serve(...)` — onde a ordem de execução realmente mora. */
function corpoDoHandler(corpoFonte: string): string {
  return blocoApos(corpoFonte, "serve(async (req)");
}

const fonte = ler(ARQ_FONTE);
const corpo = semComentarios(fonte);
const handler = corpoDoHandler(corpo);

/**
 * As quatro portas de escrita que existem nesta função. `batch_upsert_orders` é
 * a porta real de `orders` (RPC de upsert em lote); as outras três cobrem
 * qualquer escrita direta via PostgREST, inclusive em `ml_sync_log`.
 */
const PORTAS_DE_ESCRITA = [".upsert(", ".insert(", ".update(", ".delete(", "batch_upsert_orders"];

function portasEncontradas(trecho: string): string[] {
  return PORTAS_DE_ESCRITA.filter((porta) => trecho.includes(porta));
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. O modo de conferência existe e é reconhecível no corpo da requisição
// ═══════════════════════════════════════════════════════════════════════════

describe("modo de conferência — regra: dá para perguntar ao ML o que falta sem escrever nada", () => {
  it("o esquema do corpo da requisição aceita o modo de conferência", () => {
    const esquema = blocoApos(corpo, "const BodySchema = z.object(");
    expect(
      /audit_only\s*:/.test(esquema),
      "o BodySchema não aceita `audit_only` — não há como pedir a conferência sem inventar um segundo endpoint",
    ).toBe(true);
  });

  it("existe uma função de conferência de janela", () => {
    expect(
      /(?:async\s+)?function\s+conferirJanela\s*\(/.test(corpo),
      "`conferirJanela` não existe — sem ela a conferência não tem onde morar",
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. A conferência é LEITURA PURA — nem no corpo da função, nem no ramo
// ═══════════════════════════════════════════════════════════════════════════

describe("a conferência não escreve — regra: medir o buraco não pode mexer no que se mede", () => {
  it("o corpo de `conferirJanela` não tem nenhuma porta de escrita", () => {
    const achadas = portasEncontradas(corpoDaFuncao(corpo, "conferirJanela"));
    expect(
      achadas,
      `a conferência ganhou porta de escrita (${achadas.join(", ")}) — ela é leitura pura por contrato`,
    ).toEqual([]);
  });

  it("o ramo do handler que chama a conferência não escreve e devolve resposta", () => {
    const pos = handler.indexOf("conferirJanela(");
    expect(pos, "o handler não chama `conferirJanela` — a conferência existe mas ninguém a alcança").toBeGreaterThan(-1);
    const ramo = blocoQueContem(handler, pos);
    const achadas = portasEncontradas(ramo);
    expect(
      achadas,
      `o ramo de conferência escreve (${achadas.join(", ")}) — leitura pura quer dizer que nem o log de sync é tocado`,
    ).toEqual([]);
    expect(
      ramo.includes("return new Response"),
      "o ramo de conferência não devolve resposta própria — sem o retorno antecipado ele cai no caminho de escrita logo abaixo",
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Uma única régua de janela BRT — a captura e a conferência usam a MESMA
// ═══════════════════════════════════════════════════════════════════════════

describe("uma régua só de meia-noite BRT — regra: duas noções da mesma janela divergindo em silêncio é a classe de defeito que derrubou o saldo na Fase 233", () => {
  it("existe a função `janelaBRT`", () => {
    expect(
      /(?:async\s+)?function\s+janelaBRT\s*\(/.test(corpo),
      "`janelaBRT` não existe — a construção da janela continua inline e a conferência precisaria escrever a sua",
    ).toBe(true);
  });

  /**
   * 🔴 A INVARIANTE É "UMA RÉGUA", NÃO "UM LITERAL". A primeira versão desta
   * asserção exigia que `T03:00:00` aparecesse UMA vez no arquivo — e reprovou
   * `janelaBRT`, que legitimamente o usa duas vezes, uma para cada ponta do
   * intervalo. Contar o literal em vez de perguntar QUEM o usa é gate ancorado
   * em número, não em propriedade: ele reprova o certo e, pior, passaria se
   * alguém movesse a única ocorrência para outra função.
   */
  it("todo literal de meia-noite BRT mora dentro de `janelaBRT`", () => {
    const achados = posicoes(corpo, "T03:00:00");
    expect(
      achados.length,
      "o literal de meia-noite BRT sumiu do arquivo — não há régua nenhuma",
    ).toBeGreaterThan(0);

    const forasteiros = Array.from(new Set(
      achados
        .map((p) => funcaoQueContem(corpo, p) ?? "(fora de função nomeada)")
        .filter((nome) => nome !== "janelaBRT"),
    ));
    expect(
      forasteiros,
      "o literal de meia-noite BRT aparece fora de `janelaBRT` — é uma segunda régua de data escrita à parte",
    ).toEqual([]);
  });

  it("a captura e a conferência chamam `janelaBRT`", () => {
    expect(
      handler.includes("janelaBRT("),
      "o handler não usa `janelaBRT` — a captura continua com régua própria",
    ).toBe(true);
    expect(
      corpoDaFuncao(corpo, "conferirJanela").includes("janelaBRT("),
      "a conferência não usa `janelaBRT` — é a segunda régua que o portão existe para impedir",
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. 🔴 `paging.total` não é contagem em caminho nenhum
// ═══════════════════════════════════════════════════════════════════════════

describe("`paging` não vira contagem — regra: o censo mediu que ele SUPERESTIMA (9.307 declarados × 9.097 ids únicos, excedendo em 143 dos 247 dias, inclusive em dias de uma página só)", () => {
  /**
   * As duas únicas funções onde `paging` é legítimo, e por um motivo estreito:
   * lá ele é CRITÉRIO DE PARADA de paginação (`offset >= apiTotal`) e gatilho de
   * divisão de janela — nunca a resposta para "quantos pedidos existem".
   */
  const LACOS_DE_PAGINACAO_CONHECIDOS = ["fetchOrdersPage", "reconcileCancelled"];

  it("toda ocorrência de `paging` mora num laço de paginação já conhecido", () => {
    const intrusas = posicoes(corpo, "paging")
      .map((p) => funcaoQueContem(corpo, p) ?? "(fora de função nomeada)")
      .filter((nome) => !LACOS_DE_PAGINACAO_CONHECIDOS.includes(nome));

    expect(
      Array.from(new Set(intrusas)),
      "um caminho novo passou a ler `paging` — ele superestima e não serve como contagem; a prova é diferença de CONJUNTO de ids",
    ).toEqual([]);
  });

  it("a conferência não lê `paging` nem sob outro nome", () => {
    const corpoConf = corpoDaFuncao(corpo, "conferirJanela");
    expect(
      corpoConf.includes("paging") || corpoConf.includes("apiTotal"),
      "a conferência lê `paging`/`apiTotal` — ela conta ids únicos, não o total declarado pela API",
    ).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. O modo de recaptura aceita lista explícita de identificadores
// ═══════════════════════════════════════════════════════════════════════════

describe("modo de recaptura — regra: os 26 já perdidos não são alcançáveis pela busca, só por id", () => {
  it("o esquema do corpo aceita o modo de recaptura e a lista de identificadores", () => {
    const esquema = blocoApos(corpo, "const BodySchema = z.object(");
    expect(
      /only_missing\s*:/.test(esquema),
      "o BodySchema não aceita `only_missing` — não há modo de recaptura",
    ).toBe(true);
    expect(
      /order_ids\s*:\s*z\.array\(/.test(esquema),
      "o BodySchema não aceita `order_ids` como lista — a recaptura precisa de lista EXPLÍCITA, não de uma janela",
    ).toBe(true);
  });

  it("existe a colheita por id, e ela usa o endpoint de pedido único", () => {
    const corpoBusca = corpoDaFuncao(corpo, "buscarPedidosPorId");
    expect(
      /\/orders\/\$\{/.test(corpoBusca),
      "a colheita por id não consulta `/orders/{id}` — o caminho barato e determinístico é esse",
    ).toBe(true);
  });

  it("a colheita por id conta o que o ML recusou, em vez de engolir", () => {
    const corpoBusca = corpoDaFuncao(corpo, "buscarPedidosPorId");
    expect(
      /recusad/i.test(corpoBusca),
      "a colheita por id não registra recusa — 26 menos um sem explicação é pior que 25 com motivo",
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. 🔴 A ORDEM é a garantia: o filtro vem ANTES do enriquecimento e da escrita
// ═══════════════════════════════════════════════════════════════════════════

describe("recaptura não atualiza pedido preexistente — regra: os campos fiscais de `orders` foram validados pela contadora na Fase 222", () => {
  it("existe o filtro de identificadores ausentes", () => {
    expect(
      /(?:async\s+)?function\s+filtrarIdentificadoresAusentes\s*\(/.test(corpo),
      "`filtrarIdentificadoresAusentes` não existe — sem ele a recaptura passa pedido já gravado pelo upsert",
    ).toBe(true);
  });

  it("o filtro roda ANTES do primeiro enriquecimento e ANTES da porta de escrita", () => {
    const posFiltro         = handler.indexOf("filtrarIdentificadoresAusentes(");
    const posEnriquecimento = handler.indexOf("fetchShipmentDetails(");
    const posEscrita        = handler.indexOf("batch_upsert_orders");

    expect(posFiltro, "o handler não chama o filtro — a recaptura não descarta nada").toBeGreaterThan(-1);
    expect(posEnriquecimento, "não achei a chamada de enriquecimento no handler").toBeGreaterThan(-1);
    expect(posEscrita, "não achei a porta de escrita no handler").toBeGreaterThan(-1);

    expect(
      posFiltro < posEnriquecimento,
      "o filtro roda DEPOIS do enriquecimento — a ordem é a garantia, não a intenção: pedido preexistente já teria custado chamada e entrado no lote",
    ).toBe(true);
    expect(
      posFiltro < posEscrita,
      "o filtro roda DEPOIS da porta de escrita — nesse ponto o pedido preexistente já foi reescrito",
    ).toBe(true);
  });

  it("o predicado do filtro é PRÓPRIO — não é o de `jaCompletos`, que os interruptores de backfill alargam", () => {
    const corpoFiltro = corpoDaFuncao(corpo, "filtrarIdentificadoresAusentes");

    expect(
      corpoFiltro.includes('from("orders")') && corpoFiltro.includes("organization_id") && corpoFiltro.includes("ml_order_id"),
      "o filtro não pergunta a `orders` quais ids daquela organização já existem",
    ).toBe(true);

    const contaminacao = ["jaCompletos", "backfillLogisticType", "backfillFreteComprador", "logistic_type", "frete_comprador"]
      .filter((termo) => corpoFiltro.includes(termo));
    expect(
      contaminacao,
      `o filtro reaproveitou o predicado alargado (${contaminacao.join(", ")}) — no dia em que alguém ligar um interruptor a recaptura reprocessaria pedido antigo`,
    ).toEqual([]);
  });

  /**
   * 🔴 ESTA ASSERÇÃO NASCEU INVERTIDA E FOI CORRIGIDA ANTES DE VER O CÓDIGO.
   *
   * A primeira versão exigia `colheita < filtro` — colher no ML e só então
   * descartar o que já existe. Isso satisfaz a proibição de ESCRITA, mas viola o
   * critério mais forte que o plano pede: *"rodar a recaptura sobre uma lista
   * cujos pedidos já existem resulta em zero escrita **e zero chamada de
   * enriquecimento**"*. Com a colheita primeiro, uma lista inteiramente
   * preexistente ainda custaria uma chamada ao ML por identificador.
   *
   * O filtro só precisa dos IDENTIFICADORES, nunca do payload — então ele pode e
   * deve vir primeiro. O gate estava errado, não o código.
   */
  it("o filtro roda antes até da colheita no ML — lista já existente custa zero chamada", () => {
    const posFiltro = handler.indexOf("filtrarIdentificadoresAusentes(");
    const posBusca  = handler.indexOf("buscarPedidosPorId(");
    expect(
      posBusca,
      "a colheita por id não aparece no handler — a recaptura não tem de onde tirar os pedidos",
    ).toBeGreaterThan(-1);
    expect(
      posFiltro < posBusca,
      "a colheita no ML roda antes do filtro — uma lista inteiramente preexistente pagaria uma chamada por identificador à toa",
    ).toBe(true);
    expect(
      posBusca < handler.indexOf("fetchShipmentDetails("),
      "a colheita por id não acontece antes do enriquecimento",
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Os interruptores de backfill continuam desligados por ausência
// ═══════════════════════════════════════════════════════════════════════════

describe("nenhum caminho novo liga os interruptores de backfill — regra: os dois foram desligados de propósito ao fim da Fase 222", () => {
  for (const [flag, variavel] of [
    ["BACKFILL_LOGISTIC_TYPE", "backfillLogisticType"],
    ["BACKFILL_FRETE_COMPRADOR", "backfillFreteComprador"],
  ] as const) {
    it(`\`${variavel}\` continua vindo só do ambiente, e uma vez só`, () => {
      const atribuicoes = posicoes(corpo, `${variavel} =`).concat(posicoes(corpo, `${variavel}=`));
      expect(
        atribuicoes.length,
        `\`${variavel}\` é atribuída ${atribuicoes.length} vezes — mais de uma abre caminho para ligá-la sem a variável de ambiente`,
      ).toBe(1);
      const trecho = corpo.slice(atribuicoes[0], atribuicoes[0] + 240);
      expect(
        trecho.includes(`Deno.env.get("${flag}")`),
        `\`${variavel}\` deixou de ser lida de \`Deno.env.get("${flag}")\` — ausência da variável tem que continuar sendo falso`,
      ).toBe(true);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Dia não medido nunca vira diferença zero
// ═══════════════════════════════════════════════════════════════════════════

describe("dia com falha de rede sai como NÃO MEDIDO — regra: contar zero diferença num dia que não foi perguntado é a mentira mais fácil de contar aqui", () => {
  it("o `catch` do laço de dias da conferência alimenta o contador de não medidos", () => {
    const corpoConf = corpoDaFuncao(corpo, "conferirJanela");
    const posCatch = corpoConf.indexOf("catch");
    expect(posCatch, "a conferência não trata falha de rede por dia — um dia que estourar derruba a janela inteira").toBeGreaterThan(-1);
    const blocoCatch = blocoApos(corpoConf, "catch", posCatch);
    expect(
      /naoMedid/i.test(blocoCatch),
      "o `catch` da conferência não marca o dia como não medido — ele vira silenciosamente um dia sem divergência",
    ).toBe(true);
  });

  it("o resultado da conferência separa os dois sentidos do diff e os dias não medidos", () => {
    const corpoConf = corpoDaFuncao(corpo, "conferirJanela");
    for (const campo of ["ausentes_no_banco", "ausentes_no_ml", "dias_nao_medidos", "dias_examinados"]) {
      expect(
        corpoConf.includes(campo),
        `a conferência não devolve \`${campo}\` — sem ele não dá para distinguir "não achei diferença" de "não perguntei"`,
      ).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. Leitura de `orders` paginada com faixa explícita
// ═══════════════════════════════════════════════════════════════════════════

describe("leitura de `orders` não é truncada em silêncio — regra: o PostgREST corta em 1.000 linhas sem avisar, e um mês tem mais que isso", () => {
  it("a conferência lê `orders` com faixa explícita e contagem no servidor", () => {
    const corpoConf = corpoDaFuncao(corpo, "conferirJanela");
    expect(
      corpoConf.includes(".range(") || corpoConf.includes("lerIdsDoBanco("),
      "a conferência lê `orders` sem faixa explícita — acima de 1.000 linhas o PostgREST trunca e o diff inventa ausências",
    ).toBe(true);
  });

  it("o leitor paginado usa `.range(` e confere o total contra o que recebeu", () => {
    const corpoLeitor = corpoDaFuncao(corpo, "lerIdsDoBanco");
    expect(
      corpoLeitor.includes(".range("),
      "`lerIdsDoBanco` não pagina com faixa explícita",
    ).toBe(true);
    expect(
      corpoLeitor.includes("count"),
      "`lerIdsDoBanco` não pede contagem no servidor — sem denominador não há como saber se truncou",
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. A causa provada está nomeada no arquivo
// ═══════════════════════════════════════════════════════════════════════════

describe("a causa está escrita no código — regra: quem ler o arquivo daqui a um ano precisa entender por que existe uma segunda passada", () => {
  it("o cabeçalho nomeia o mecanismo e traz os números do censo", () => {
    const cabecalho = fonte.slice(0, 9000);
    expect(cabecalho.includes("date_closed"), "o cabeçalho não nomeia `date_closed` — o mecanismo provado é que a busca só indexa pedido FECHADO").toBe(true);
    expect(/9\.?097/.test(cabecalho), "o cabeçalho não traz o universo do censo (9.097 fechados)").toBe(true);
    expect(/\b26\b/.test(cabecalho), "o cabeçalho não traz o número de perdidos (26)").toBe(true);
    expect(/0,29%|0\.29%/.test(cabecalho), "o cabeçalho não traz a taxa de base (0,29%)").toBe(true);
    expect(/reconcileCancelled/.test(cabecalho), "o cabeçalho não registra que a reconciliação nunca faz INSERT").toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. Token nunca vai para o log
// ═══════════════════════════════════════════════════════════════════════════

describe("o token do ML não vaza — regra: nem em mensagem de erro", () => {
  it("nenhum `console.*` carrega token", () => {
    const suspeitos = corpo
      .split("\n")
      .filter((l) => /console\.(log|warn|error)/.test(l) && /access_?[Tt]oken|Bearer /.test(l));
    expect(suspeitos, `console com token: ${suspeitos.join(" | ")}`).toEqual([]);
  });
});
