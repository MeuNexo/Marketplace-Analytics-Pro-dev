// ============================================================================
// 233-05/233-06 — 🔴 O PORTÃO DE FONTE
//
// POR QUE ESTE ARQUIVO EXISTE, em uma frase: **um teste que só prova aritmética
// não protege nada.**
//
// O 233-03 entregou 59 testes verdes — incluindo 500 trios pseudoaleatórios
// provando uma identidade de ida e volta perfeita — e o código que eles
// protegiam estava errado. A identidade era correta; ela foi feita contra a
// VARIÁVEL ERRADA. Nenhum teste de valor pega isso, porque nenhum teste de valor
// pergunta *de onde o número vem*.
//
// Este portão pergunta. Ele lê os arquivos do disco e reprova pela FORMA do
// código, no molde de `src/hooks/__tests__/rpcBind.test.ts` (a entrega do
// 233-01) e de `src/lib/cashflowProjectionRule.test.ts`.
//
// ============================================================================
// 🔴 O QUE MUDOU NO 233-06, E POR QUÊ — ESTE PORTÃO REPROVOU O PLANO, E ISSO
//    ESTAVA CORRETO. Ele fez o trabalho dele.
//
// O 233-05 proibiu a inversa inteira: por nome exportado e pela FORMA
// `− entradas + saídas`. O **D-10** (Wesley, 27/08, horas depois) derrubou o
// D-07 e a inversa precisou VOLTAR — agora contra a quantidade certa, só o que
// **já liquidou**.
//
// A mudança é DELIBERADA e o motivo está escrito em cima de cada asserção que
// mudou. O portão **não foi contornado nem esvaziado**: ele deixa de proibir
// *a inversa* e passa a proibir *a inversa contra o TOTAL DO DIA*.
//
// A distinção é exprimível porque ela está inteira nos OPERANDOS. O portão varre
// as linhas procurando `− <ident> + <ident>` e exige que os **dois**
// identificadores carreguem o marcador de liquidação no nome (`liquidad` ou
// `pagas`). `− entradas + saidas` reprova. `− entradasLiquidadas + saidasPagas`
// passa. Um alias curto (`− e + s`) reprova, e reprovar é o comportamento certo:
// **o nome é parte da prova, e apagá-lo apaga a prova.**
//
// ⚠️ FORMA SOZINHA NÃO BASTA, e o 233-03 é a prova. Um executor determinado
// renomeia a variável e passa por aqui com a quantidade errada. Por isso este
// portão **não é** o critério do 233-06 — ele acompanha o TRIO DE SENSIBILIDADE
// DIRIGIDA em `src/lib/saldoDeclarado.test.ts`, que mede a QUANTIDADE e é o
// único formato que reprova as duas regressões opostas.
// ============================================================================
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RPC_QUE_MOVE_A_ANCORA = "set_financial_balance";
const TABELA_DE_SALDO = "financial_settings";

const CAMINHO_PAGINA = join(__dirname, "..", "MLFluxoCaixa.tsx");
const CAMINHO_MODULO = join(__dirname, "..", "..", "..", "lib", "saldoDeclarado.ts");
const CAMINHO_HOOK = join(__dirname, "..", "..", "..", "hooks", "useTodayBalance.ts");
const CAMINHO_CARD = join(
  __dirname, "..", "..", "..", "components", "financial", "SaldoAgoraCard.tsx",
);

/**
 * ⚠️ Arquivo que falta é FALHA DE ASSERÇÃO, não erro de carga do teste. Durante
 * o RED do 233-06 o card ainda não existe, e um `readFileSync` cru derrubaria o
 * arquivo inteiro em vez de reprovar uma asserção — o que esconderia as outras
 * sete.
 */
function lerOuVazio(caminho: string): string {
  return existsSync(caminho) ? readFileSync(caminho, "utf-8") : "";
}

const pagina = lerOuVazio(CAMINHO_PAGINA);
const modulo = lerOuVazio(CAMINHO_MODULO);
const hook = lerOuVazio(CAMINHO_HOOK);
const card = lerOuVazio(CAMINHO_CARD);

/**
 * Linhas de código, sem os comentários — prosa não pode reprovar nem absolver.
 *
 * 🔴 CORRIGIDO NO 233-06, e o defeito era deste helper. A versão do 233-05
 * filtrava linha a linha por `//`, `*` e `/*`, o que deixa passar as linhas do
 * MEIO de um comentário JSX de várias linhas (`{/* ... *\/}`): elas não começam
 * com marcador nenhum. Resultado real: a asserção do diálogo reprovou por causa
 * de um comentário que EXPLICAVA a mudança, não de código.
 *
 * Um portão que reprova por prosa é um portão que vai ser desligado. Os blocos
 * `/* ... *\/` saem inteiros ANTES do split.
 */
function linhasDeCodigo(fonte: string): string[] {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("//") && !l.startsWith("*"));
}

describe("🔴 PORTÃO DE FONTE — declarar saldo tem de MOVER A ÂNCORA", () => {
  it("(b) a página invoca a RPC que move a âncora — sem ela, `balance_anchor_date` fica parada e o declarado vira o saldo de outro dia", () => {
    const chamadas = linhasDeCodigo(pagina).filter((l) => l.includes(RPC_QUE_MOVE_A_ANCORA));

    expect(
      chamadas.length,
      `A página precisa chamar supabase.rpc("${RPC_QUE_MOVE_A_ANCORA}", ...). ` +
        "Essa é a única escrita que grava `initial_balance` E `balance_anchor_date` " +
        "na mesma operação. Sem mover a âncora, `get_rolled_opening_balance` continua " +
        "rolando 45 dias de movimento por cima do valor digitado — que é exatamente " +
        "o defeito que o 233-05 conserta.",
    ).toBeGreaterThan(0);
  });

  it("(b) a chamada passa `p_org_id` e `p_amount` explícitos — org implícita já pôs o número de uma loja na tela da outra (T-224-07-01)", () => {
    expect(pagina).toContain("p_org_id");
    expect(pagina).toContain("p_amount");
  });

  it("(a) a página NÃO escreve em `financial_settings` por caminho direto — esse caminho não toca em `balance_anchor_date`", () => {
    const ofensores = linhasDeCodigo(pagina).filter(
      (l) => new RegExp(`\\.from\\(\\s*["'\`]${TABELA_DE_SALDO}["'\`]`).test(l),
    );

    expect(
      ofensores,
      `Escrever em \`${TABELA_DE_SALDO}\` pelo client grava o saldo e deixa a âncora ` +
        "onde estava. Foi assim que o Wesley declarou, sem saber, um saldo de " +
        "2026-07-13. A escrita tem de passar pela RPC. (Invalidar a query de " +
        `\`${TABELA_DE_SALDO}\` continua permitido — o que não pode é \`.from(...)\`.)`,
    ).toEqual([]);
  });

  // ⚠️ MUDOU NO 233-06 — MOTIVO NO TÍTULO. A asserção do 233-05 proibia export
  // cujo nome casasse `/initialBalance|paraSaldo|inversa/i`. Ela FICA como está:
  // `aberturaAncorada` não casa com nenhum desses, e os nomes proibidos são
  // justamente os da inversa contra o total (`initialBalanceParaSaldo`). O que
  // era proibido continua proibido; o que voltou tem nome próprio.
  it("(c) o módulo puro NÃO exporta a inversa do 233-03 — `initialBalanceParaSaldo` era contra o total do dia, e essa quantidade nunca foi a certa", () => {
    const exportadas = linhasDeCodigo(modulo)
      .filter((l) => l.startsWith("export function"))
      .map((l) => l.replace(/^export function\s+/, "").split("(")[0]);

    const inversas = exportadas.filter((n) => /initialBalance|paraSaldo|inversa/i.test(n));

    expect(
      inversas,
      "A inversa do 233-03 era `desejado − entradas_hoje + saidas_hoje`, contra o " +
        "TOTAL do dia. O 233-06 trouxe de volta a inversa contra o LIQUIDADO, com " +
        "nome próprio (`aberturaAncorada`). Código obsoleto que compila é a próxima " +
        "pessoa usando de novo — por isso o nome antigo continua banido.",
    ).toEqual([]);
  });

  // 🔴 ESTA É A ASSERÇÃO QUE MUDOU DE PROPÓSITO NO 233-06, e o motivo está aqui.
  //
  // A versão do 233-05 proibia a FORMA `− entradas + saídas` por regex, e ela
  // casa com `− entradasLiquidadas + saidasPagas` — a conta CERTA do D-10. Sem
  // esta mudança, o portão reprovaria a correção.
  //
  // A distinção entre a conta certa e a errada está inteira nos OPERANDOS, então
  // é neles que o portão passa a olhar.
  it("(c) a inversa que voltou é contra o LIQUIDADO — os dois operandos de `− x + y` carregam o marcador de liquidação, e é o nome que prova a quantidade", () => {
    const PADRAO = /-\s*([A-Za-z_$][\w$]*)\s*\+\s*([A-Za-z_$][\w$]*)/g;
    const MARCADOR = /liquidad|pagas/i;

    const ofensores: string[] = [];
    for (const linha of linhasDeCodigo(modulo)) {
      PADRAO.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = PADRAO.exec(linha)) !== null) {
        if (!MARCADOR.test(m[1]) || !MARCADOR.test(m[2])) ofensores.push(linha);
      }
    }

    expect(
      ofensores,
      "A inversa voltou contra a quantidade ERRADA. `− entradas + saidas` usa o " +
        "TOTAL do dia e é o defeito do 233-03; a conta certa é " +
        "`− entradasLiquidadas + saidasPagas`, porque o que está em mediação ainda " +
        "não entrou no extrato que o Wesley leu. Um alias curto (`− e + s`) também " +
        "reprova de propósito: o nome é parte da prova, e apagá-lo apaga a prova. " +
        "Se a conta precisar mudar de novo, este é o lugar de justificar — não de " +
        "contornar.",
    ).toEqual([]);
  });

  // 🆕 233-06. Complementa a de cima: mesmo com o nome certo nos operandos, o
  // módulo puro não pode nem MENCIONAR os campos de total ao decompor.
  it("(c) o corpo de `aberturaAncorada` não toca em total nem em pendente — se o total voltar à decomposição, é o 233-03 de novo", () => {
    const linhas = modulo.split("\n");
    const inicio = linhas.findIndex((l) => l.startsWith("export function aberturaAncorada"));
    expect(inicio, "`aberturaAncorada` precisa existir e ser exportada pelo módulo puro.")
      .toBeGreaterThanOrEqual(0);

    const fim = linhas.findIndex((l, i) => i > inicio && l === "}");
    const corpo = linhas
      .slice(inicio, fim + 1)
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n")
      // os dois campos legítimos saem antes da varredura
      .replace(/entradasLiquidadas/g, "")
      .replace(/saidasPagas/g, "");

    const restos = corpo.match(/entradas|saidas|sa[ií]das|pendente|hoje/gi) ?? [];

    expect(
      restos,
      "O corpo da decomposição referencia um campo de total ou de pendente. A " +
        "abertura sai de `declarado − entradasLiquidadas + saidasPagas` e de mais " +
        "nada: `entradas_hoje`/`saidas_hoje` incluem o que ainda pode entrar, e " +
        "somá-los foi exatamente o erro que o Wesley leu na tela.",
    ).toEqual([]);
  });

  it("(d) nenhum método do client Supabase desacoplado sem `.bind` — em ESM strict o `this` vira undefined e estoura em `rest` (233-01)", () => {
    const ofensores = [...linhasDeCodigo(pagina), ...linhasDeCodigo(card)].filter(
      (l) => /=\s*supabase\.(rpc|from|storage|functions)\b/.test(l) && !l.includes(".bind"),
    );

    expect(
      ofensores,
      "`supabase.rpc` é `return this.rest.rpc(...)`. Atribuí-lo a uma variável sem " +
        "`.bind(supabase)` produz `Cannot read properties of undefined (reading 'rest')` " +
        "em produção — o erro que o Wesley viu na tela em 27/08/2026.",
    ).toEqual([]);
  });

  it("a declaração continua alimentando `saldo_declarado` com `organization_id` explícito — sem a série, a curva de confiança tem um ponto só", () => {
    expect(pagina).toContain("saldo_declarado");
    expect(pagina).toContain("organization_id");
  });

  it("🔵 os dois números da página têm rótulos DIFERENTES — abertura e fechamento previsto divergiam R$ 13.433,20 sob o mesmo rótulo", () => {
    // O card dizia "Saldo de hoje" apontando para `saldo_final_previsto` enquanto
    // o gráfico abria em `saldo_inicial`. Rotular os dois separadamente é o que
    // faz a decomposição parar de acusar erro onde não há.
    expect(pagina + card).toMatch(/previs[ãa]o de fechamento|fechamento previsto/i);
  });
});

// ============================================================================
// 🆕 233-06 — O SALDO DE AGORA VEM DO BANCO, E A TELA DIZ QUAL NÚMERO É QUAL
// ============================================================================

describe("🔴 233-06 — o saldo de agora vem do BANCO, e a distinção card × gráfico é entrega", () => {
  it("o hook expõe as parcelas de liquidação lidas da RPC — sem elas a página não tem como decompor, e `podeDeclarar` bloqueia", () => {
    for (const campo of [
      "saldo_agora",
      "entradas_liquidadas",
      "saidas_pagas",
      "entradas_pendentes",
    ]) {
      expect(hook, `\`useTodayBalance\` precisa devolver \`${campo}\` vindo de \`get_daily_balance\`.`)
        .toContain(campo);
    }
  });

  it("🔴 nem a página nem o card COMPÕEM o saldo de agora — somar no front foi a origem do erro do 233-03, e a classificação por estado existe UMA vez só", () => {
    const ofensores = [...linhasDeCodigo(pagina), ...linhasDeCodigo(card)].filter(
      (l) =>
        /saldo_inicial|saldoInicial/.test(l) &&
        /entradas_liquidadas|entradasLiquidadas/.test(l) &&
        /[+\-]/.test(l),
    );

    expect(
      ofensores,
      "O saldo de agora tem de vir da coluna `saldo_agora` de `get_daily_balance`. " +
        "Compor `saldo_inicial + entradas_liquidadas − saidas_pagas` no front cria uma " +
        "SEGUNDA implementação da classificação por estado, e duas implementações da " +
        "mesma regra divergem — a divergência aparece como número errado na tela, não " +
        "como erro.",
    ).toEqual([]);
  });

  it("🔴 o card do D-11 existe e mostra o número que vem do banco", () => {
    expect(card, "`src/components/financial/SaldoAgoraCard.tsx` precisa existir (D-11).")
      .not.toBe("");
    expect(card).toContain("saldo_agora");
  });

  it("🔴 o card NOMEIA a distinção contra o gráfico — dois números discordantes na mesma página sem explicação foi a confusão que o 233-05 acabou de resolver", () => {
    // Com o card mostrando o saldo de AGORA e o gráfico abrindo na ABERTURA, a
    // página volta a exibir dois números diferentes ao mesmo tempo (37.430,00 ×
    // 33.758,27). A diferença é legítima; se a tela não disser qual é qual, o
    // fato de a conta estar certa não ajuda o Wesley em nada.
    expect(card, "O card precisa citar o GRÁFICO para explicar por que ele abre menor.")
      .toMatch(/gr[áa]fico/i);
    expect(card, "O card precisa nomear a ABERTURA como o ponto em que o gráfico começa.")
      .toMatch(/abertura/i);
  });

  it("o card mostra o que AINDA PODE ENTRAR — é a diferença entre o saldo de agora e a previsão de fechamento, e sem ela os dois números parecem contraditórios", () => {
    expect(card).toContain("entradas_pendentes");
    expect(card).toMatch(/ainda pode entrar/i);
  });

  it("🔴 estado desconhecido do Mercado Pago NÃO some dentro de um agregado — o card diz quando ele aparece", () => {
    expect(card).toContain("entradas_estado_desconhecido");
    expect(card).toContain("saidas_estado_desconhecido");
  });

  it("a linha de decomposição APERTADA saiu da página — o card diz inteiro o que ela dizia comprimido", () => {
    const ofensores = linhasDeCodigo(pagina).filter((l) => /Saldo de hoje\s*\{"\s"\}/.test(l));
    expect(
      ofensores,
      "A linha antiga ao lado do botão 'Corrigir saldo de hoje' precisa sair: ela é o " +
        "resumo apertado do que o `SaldoAgoraCard` passa a dizer inteiro, e manter as " +
        "duas põe o mesmo número em dois lugares com rótulos diferentes.",
    ).toEqual([]);
  });

  it("🔴 o diálogo não diz mais que o valor é lido como ABERTURA — o D-10 derrubou isso, e instrução que contradiz o comportamento é pior que nenhuma", () => {
    const ofensores = linhasDeCodigo(pagina).filter((l) =>
      /lido como o saldo de|saldo de <strong>abertura|Declarar de manh/i.test(l),
    );
    expect(
      ofensores,
      "O 233-05 escreveu na tela que o valor digitado é lido como a abertura do dia e " +
        "que declarar de manhã é o caminho sem ambiguidade. O Wesley declara olhando o " +
        "extrato, a qualquer hora, e o sistema decompõe sozinho (D-10).",
    ).toEqual([]);
  });
});
