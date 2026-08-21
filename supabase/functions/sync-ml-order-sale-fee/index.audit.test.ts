/**
 * index.audit.test.ts — auditoria do FONTE de `sync-ml-order-sale-fee`
 * (Fase 223, plano 223-04, Task 2).
 *
 * POR QUE ESTE TESTE LÊ O ARQUIVO COMO TEXTO, EM VEZ DE IMPORTAR: o `.ts` da
 * edge function importa módulos remotos do Deno
 * (`https://deno.land/std@.../http/server.ts`, `https://esm.sh/...`), que o
 * vitest (node) não resolve. Molde: `src/lib/fiscal/rebateSqlAudit.test.ts`
 * (223-03) — leitura de arquivo do disco, sem banco e sem rede, provando
 * propriedades do FONTE em vez do comportamento em runtime.
 *
 * O QUE ESTE TESTE PROTEGE: as regras duras de `/group/ML/order/details`
 * (o CAMPEÃO de 429 no Mercado Livre, bloqueio por IP — ML-BILLING-API-DOC.txt
 * linhas 194-211, D-223-05). Cada `it` abaixo diz, na própria descrição, qual
 * regra da API está sendo protegida — quem quebrar o teste daqui a seis
 * meses precisa entender por que ele existe, sem abrir o ML-BILLING-API-DOC.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ARQ_FONTE = "supabase/functions/sync-ml-order-sale-fee/index.ts";

function ler(caminho: string): string {
  return readFileSync(resolve(process.cwd(), caminho), "utf8");
}

/**
 * Remove comentários de linha (`//...`) e de bloco (`/* ... *​/`) de um fonte
 * TypeScript. Sem isso, um cabeçalho explicando a regra ("nunca mais que 60")
 * seria contado como se FOSSE a violação que ele está documentando/proibindo
 * — a mesma colisão prosa-versus-grep que `rebateSqlAudit.test.ts` já trata
 * para `.sql` (lá só existe `--`; aqui existem os dois estilos de comentário).
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

const fonte = ler(ARQ_FONTE);
const corpo = semComentarios(fonte);

// ─── O fonte não decide nada: delega ao núcleo puro e ao módulo de lote ────
// (260821-hap: a decisão de captura/truncamento migrou para
// resolverLoteComTruncamento, orderSaleFeeLote.ts — lerPedidos e
// classificarCaptura deixam de ser chamados diretamente por esta edge
// function, que agora só injeta a chamada de rede e persiste o resultado.)

describe("o fonte importa selecionarLote/TAMANHO_MAXIMO_LOTE do núcleo puro, e delega a decisão de captura/truncamento a resolverLoteComTruncamento", () => {
  it("importa selecionarLote e TAMANHO_MAXIMO_LOTE de orderSaleFee.ts (não reimplementa a seleção de lote)", () => {
    const importOrderSaleFee = /import\s*\{([^}]*)\}\s*from\s*["']\.\.\/_shared\/orderSaleFee\.ts["']/;
    const m = importOrderSaleFee.exec(corpo);
    expect(m, "import de orderSaleFee.ts não encontrado").not.toBeNull();
    const nomesImportados = (m as RegExpExecArray)[1];
    expect(nomesImportados).toContain("selecionarLote");
    expect(nomesImportados).toContain("TAMANHO_MAXIMO_LOTE");
  });

  it("NÃO importa lerPedidos nem classificarCaptura de orderSaleFee.ts — essa decisão foi delegada a resolverLoteComTruncamento (260821-hap, D-hap-02/03)", () => {
    const importOrderSaleFee = /import\s*\{([^}]*)\}\s*from\s*["']\.\.\/_shared\/orderSaleFee\.ts["']/;
    const m = importOrderSaleFee.exec(corpo);
    expect(m).not.toBeNull();
    const nomesImportados = (m as RegExpExecArray)[1];
    expect(nomesImportados).not.toContain("lerPedidos");
    expect(nomesImportados).not.toContain("classificarCaptura");
  });

  it("lerPedidos não aparece em ponto nenhum do fonte — a leitura de sale_fee da raiz do pedido é responsabilidade exclusiva do módulo de lote/núcleo puro", () => {
    expect(/\blerPedidos\b/.test(corpo)).toBe(false);
  });

  it("chama selecionarLote como função — não só importa, USA (protege contra o núcleo puro virar import morto)", () => {
    expect(/\bselecionarLote\s*\(/.test(corpo)).toBe(true);
  });

  it("importa resolverLoteComTruncamento de orderSaleFeeLote.ts e chama como função", () => {
    const importLote = /import\s*\{([^}]*)\}\s*from\s*["']\.\.\/_shared\/orderSaleFeeLote\.ts["']/;
    const m = importLote.exec(corpo);
    expect(m, "import de orderSaleFeeLote.ts não encontrado").not.toBeNull();
    expect((m as RegExpExecArray)[1]).toContain("resolverLoteComTruncamento");
    expect(/\bresolverLoteComTruncamento\s*\(/.test(corpo)).toBe(true);
  });

  it("não reimplementa a detecção de truncamento — idsPresentesNaResposta/detectarTruncamento não aparecem no fonte (essa decisão vive só em orderSaleFeeLote.ts, D-hap-03)", () => {
    expect(/idsPresentesNaResposta|detectarTruncamento/.test(corpo)).toBe(false);
  });

  it("não reescreve o predicado de comissão (CVV*/BONUS) — nenhum subtipo aparece literal no fonte, prova de que a soma passa pelo núcleo puro", () => {
    // Protege a regra Q2/Q4 (223-CONTRATO-SALE-FEE.md) e D-hap-05: só o
    // núcleo puro tem o direito de saber que CVVML/CVVPRC/CVVFNU/CVVFN são
    // comissão e BVVML/BVVPRC são estorno. Se esses literais aparecerem
    // aqui, a edge function está decidindo de novo o que já foi decidido em
    // orderSaleFee.ts/mlOrderSaleFeeContrato.ts.
    expect(/CVVML|CVVPRC|CVVFNU|CVVFN|BVVML|BVVPRC/.test(corpo)).toBe(false);
  });
});

// ─── O teto de 60 vem da constante nomeada, nunca solto no fonte ───────────

describe("o teto do lote vem da constante nomeada do núcleo puro — regra: mais de 60 order_ids por chamada é causa nº1 de 429", () => {
  it("importa TAMANHO_MAXIMO_LOTE de orderSaleFee.ts", () => {
    const importOrderSaleFee = /import\s*\{([^}]*)\}\s*from\s*["']\.\.\/_shared\/orderSaleFee\.ts["']/;
    const m = importOrderSaleFee.exec(corpo);
    expect(m).not.toBeNull();
    expect((m as RegExpExecArray)[1]).toContain("TAMANHO_MAXIMO_LOTE");
  });

  it("usa TAMANHO_MAXIMO_LOTE ao selecionar o lote (não um número solto)", () => {
    expect(/selecionarLote\s*\([^)]*TAMANHO_MAXIMO_LOTE/.test(corpo)).toBe(true);
  });

  it("o número 60 não aparece fora de comentário em nenhum ponto do fonte", () => {
    // Comentários (explicando "no máximo 60 order_ids") já foram removidos de
    // `corpo` — se "60" ainda aparecer aqui, é porque virou código, não prosa.
    expect(/\b60\b/.test(corpo)).toBe(false);
  });

  it("o número 25 (novo teto medido, D-hap-01, 260821-hap) também não aparece solto — MAX_SOLO_POR_INVOCACAO deriva de TAMANHO_MAXIMO_LOTE, nunca redigitado", () => {
    expect(/\b25\b/.test(corpo)).toBe(false);
  });
});

// ─── O tempo limite lança exceção — precisa de try/catch dedicado ──────────

describe("existe captura de exceção em volta da chamada de rede — regra: AbortSignal.timeout lança, não devolve status", () => {
  it("a chamada fetch ao endpoint de order/details está dentro de um try, com catch antes do próximo uso de res.status", () => {
    // Localiza o bloco que faz a chamada de rede: precisa existir um `try {`
    // antes do `await fetch(`, e um `catch` logo depois — a mesma forma
    // documentada em sync-ml-billing/index.ts linhas 170-211 (223-PATTERNS.md).
    const idxFetch = corpo.indexOf("await fetch(url");
    expect(idxFetch, "chamada `await fetch(url` não encontrada").toBeGreaterThan(-1);
    const antes = corpo.slice(Math.max(0, idxFetch - 200), idxFetch);
    const depois = corpo.slice(idxFetch, idxFetch + 600);
    expect(/\btry\s*\{/.test(antes)).toBe(true);
    expect(/\}\s*catch\s*\(/.test(depois)).toBe(true);
  });
});

// ─── Os três códigos documentados: 206, 429 e 404 ──────────────────────────

describe("o fonte trata explicitamente 206, 429 e 404 — os três códigos que a documentação do ML lista para este endpoint", () => {
  it("trata 206 (Partial Content) — dado incompleto nunca vira rebate zero (D-223-05)", () => {
    expect(/(?:res|resposta)\.(?:httpStatus|status)\s*===\s*206/.test(corpo)).toBe(true);
  });

  it("trata 429 (bloqueio preventivo por IP) — a causa nº1 do endpoint campeão de erro", () => {
    expect(/res\.status\s*===\s*429/.test(corpo)).toBe(true);
  });

  it("trata 404 — pedido sem linha de faturamento, não confundido com erro transitório (5xx)", () => {
    expect(/(?:res|resposta)\.(?:httpStatus|status)\s*===\s*404/.test(corpo)).toBe(true);
  });
});

// ─── A chave da linha de cobrança inclui detail_id, nunca uma chave sintética ─

describe("as linhas de cobrança são gravadas pela chave que inclui detail_id — regra: é a chave natural medida (Q2), não há chave sintética a inventar", () => {
  it("o upsert de ml_order_sale_fee usa onConflict com detail_id", () => {
    const idx = corpo.indexOf('from("ml_order_sale_fee")');
    expect(idx).toBeGreaterThan(-1);
    const trecho = corpo.slice(idx, idx + 300);
    expect(/onConflict:\s*["']organization_id,ml_order_id,detail_id["']/.test(trecho)).toBe(true);
  });
});

// ─── Estorno é coluna própria, nunca somado como comissão ──────────────────

describe("o estorno (BONUS) é marcado em coluna própria e nunca somado dentro da comissão — regra Q4: somar BONUS zeraria a comissão do período", () => {
  it("grava tem_estorno como campo próprio na captura, a partir do campo temEstorno do núcleo puro", () => {
    expect(/tem_estorno:\s*d\.temEstorno/.test(corpo)).toBe(true);
  });

  it("a comissão gravada (comissao_linhas) vem do núcleo puro (d.comissaoLinhas), não de uma soma reescrita aqui", () => {
    expect(/comissao_linhas:\s*d\.comissaoLinhas/.test(corpo)).toBe(true);
  });
});

// ─── sale_fee é lido do nível do pedido, nunca de dentro de details[] ──────

describe("sale_fee é lido do nível do pedido (raiz do results[]) — a leitura crua vive só no módulo de lote/núcleo puro, nunca em index.ts (260821-hap)", () => {
  it("a leitura crua dos resultados (lerPedidos) não é chamada por index.ts — já coberto acima (lerPedidos ausente do fonte); resolverLoteComTruncamento é quem recebe resposta.results", () => {
    expect(/\blerPedidos\b/.test(corpo)).toBe(false);
  });

  it("nenhum acesso direto a `.sale_fee` (campo cru da API) fora dos nomes de coluna sale_fee_* — a leitura passa só pelo núcleo puro", () => {
    // `sale_fee_gross`/`sale_fee_net`/... são nomes de COLUNA do banco (Q1,
    // ml_order_sale_fee_captura); `.sale_fee` sozinho seria acesso cru ao
    // payload da API, que só o núcleo puro (orderSaleFee.ts) tem o direito
    // de fazer.
    expect(/\.sale_fee\b(?!_)/.test(corpo)).toBe(false);
  });
});

// ─── Nenhuma agregação de promessas em paralelo ────────────────────────────

describe("não há chamada de agregação de promessas em paralelo em nenhum ponto do fonte — regra: o 429 é bloqueio por IP, batch massivo é a causa documentada", () => {
  it("não usa Promise.all/allSettled/race em nenhum ponto", () => {
    expect(/Promise\.(all|allSettled|race)\s*\(/.test(corpo)).toBe(false);
  });
});

// ─── A continuação só dispara sem bloqueio de limite de taxa ───────────────

describe("a continuação só é disparada quando não há bloqueio por limite de taxa — regra: insistir depois de 429 é o que vira bloqueio longo", () => {
  it("a chamada a continuarEmOutraInvocacao está condicionada à ausência de interrompidoPor429", () => {
    const idx = corpo.indexOf("continuarEmOutraInvocacao({");
    expect(idx, "chamada a continuarEmOutraInvocacao não encontrada").toBeGreaterThan(-1);
    const antes = corpo.slice(Math.max(0, idx - 300), idx);
    expect(/!interrompidoPor429/.test(antes)).toBe(true);
  });
});

// ─── O recorte de data usa as funções de janela da 222 ─────────────────────

describe("o recorte de data usa as funções de janela da 222 (janelaDataPedido.ts), não uma comparação de menor-ou-igual sem hora", () => {
  it("importa inicioInclusivoDataPedido e fimExclusivoDataPedido de janelaDataPedido.ts", () => {
    const importJanela =
      /import\s*\{([^}]*)\}\s*from\s*["']\.\.\/_shared\/janelaDataPedido\.ts["']/;
    const m = importJanela.exec(corpo);
    expect(m, "import de janelaDataPedido.ts não encontrado").not.toBeNull();
    const nomes = (m as RegExpExecArray)[1];
    expect(nomes).toContain("inicioInclusivoDataPedido");
    expect(nomes).toContain("fimExclusivoDataPedido");
  });

  it("a janela sobre orders usa .gte()/.lt(), nunca .lte() contra data_pedido — <= sem hora é falso para carimbo com hora (medido em 20/08)", () => {
    expect(corpo).toContain('.gte("data_pedido"');
    expect(corpo).toContain('.lt("data_pedido"');
    expect(/\.lte\(\s*["']data_pedido["']/.test(corpo)).toBe(false);
  });
});

// ─── A leitura de pedidos usa paginação explícita ──────────────────────────

describe("a leitura de pedidos usa paginação explícita — regra: PostgREST trunca em 1000 linhas em silêncio", () => {
  it("usa .range() para paginar a consulta de orders e a de ml_order_sale_fee_captura", () => {
    const ocorrencias = corpo.match(/\.range\(/g) ?? [];
    expect(ocorrencias.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── motivo_parada nunca termina calada (260821-hap, D-hap-07) ─────────────

describe("toda invocação declara motivo_parada — nunca termina calada (D-hap-07)", () => {
  it("motivo_parada aparece em mais de um caminho de retorno da resposta de conta única (early-return de conta desabilitada, e o retorno final da rodada)", () => {
    const ocorrencias = corpo.match(/motivo_parada:/g) ?? [];
    expect(ocorrencias.length).toBeGreaterThanOrEqual(2);
  });

  it("o resultado da rodada (contendo motivo_parada) é logado antes do return em executarParaConta — não só no fan-out, que é justamente um dos caminhos que ninguém lê a resposta", () => {
    expect(/console\.(log|error)\([^)]*resultadoFinal/.test(corpo)).toBe(true);
  });

  it("ao bater o teto de saltos (MAX_HOPS) a cadeia loga um erro citando quantos pedidos restaram, em vez de sumir calada", () => {
    const idx = corpo.indexOf("hopAtual < MAX_HOPS");
    expect(idx, "checagem de hopAtual < MAX_HOPS não encontrada no fonte").toBeGreaterThan(-1);
    const trecho = corpo.slice(idx, idx + 500);
    expect(/console\.error\(/.test(trecho)).toBe(true);
    expect(/restantes/.test(trecho)).toBe(true);
  });
});

// ─── max_lotes informado nunca encadeia continuação sozinho (D-hap-06) ─────

describe("a decisão de continuar usa o campo BRUTO do corpo (max_lotes informado ou não), nunca o valor já com padrão aplicado (D-hap-06)", () => {
  it("maxLotesInformado é calculado a partir de max_lotes !== undefined — o campo cru do corpo, antes do `??` padrão", () => {
    expect(/maxLotesInformado\s*=\s*max_lotes\s*!==\s*undefined/.test(corpo)).toBe(true);
  });

  it("a decisão de continuar (podeContinuar) depende de maxLotesInformado/continuarInformado, não do valor maxLotes já com padrão aplicado", () => {
    const idx = corpo.indexOf("const podeContinuar");
    expect(idx, "podeContinuar não encontrado no fonte").toBeGreaterThan(-1);
    const trecho = corpo.slice(idx, idx + 300);
    expect(/opts\.continuarInformado/.test(trecho)).toBe(true);
    expect(/opts\.maxLotesInformado/.test(trecho)).toBe(true);
  });
});

// ─── mode: "status" nunca gasta chamada ao ML (D-hap-07) ───────────────────

describe("mode: status responde quanto sobrou sem nenhuma chamada ao ML", () => {
  it("o ramo de status não chama fetchOrderSaleFeeLote nem resolverLoteComTruncamento", () => {
    const idx = corpo.indexOf('mode === "status"');
    expect(idx, 'checagem de mode === "status" não encontrada').toBeGreaterThan(-1);
    const idxExecutarStatus = corpo.indexOf("async function executarStatusConta");
    expect(idxExecutarStatus).toBeGreaterThan(-1);
    const fimFuncao = corpo.indexOf("\n}\n", idxExecutarStatus);
    const corpoFuncao = corpo.slice(idxExecutarStatus, fimFuncao === -1 ? undefined : fimFuncao);
    expect(/fetchOrderSaleFeeLote|resolverLoteComTruncamento/.test(corpoFuncao)).toBe(false);
  });

  it("exige ml_user_id para mode: status (mesma checagem de backfill)", () => {
    expect(/mode === "backfill" \|\| mode === "status"/.test(corpo)).toBe(true);
  });
});
