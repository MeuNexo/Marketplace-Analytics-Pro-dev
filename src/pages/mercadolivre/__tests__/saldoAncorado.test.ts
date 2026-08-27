// ============================================================================
// 233-05 — 🔴 O PORTÃO DE FONTE
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
// As quatro coisas que ele trava:
//
//   (a) a página não pode voltar a escrever em `financial_settings` por caminho
//       direto — esse caminho não toca em `balance_anchor_date`, e foi assim que
//       o Wesley acabou declarando, sem saber, um saldo de 13 de julho;
//   (b) a página TEM de invocar a RPC que move a âncora;
//   (c) o módulo puro não pode voltar a exportar uma inversa contra os
//       movimentos do dia;
//   (d) nenhum método do client Supabase pode ser desacoplado sem `.bind` — o
//       defeito do 233-01, aqui aplicado à página (o portão do 233-01 varre
//       `src/hooks/`, não `src/pages/`).
//
// ⚠️ Cada asserção carrega o motivo no título. Quem ler daqui a seis meses
// precisa saber que não é zelo.
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RPC_QUE_MOVE_A_ANCORA = "set_financial_balance";
const TABELA_DE_SALDO = "financial_settings";

const CAMINHO_PAGINA = join(__dirname, "..", "MLFluxoCaixa.tsx");
const CAMINHO_MODULO = join(__dirname, "..", "..", "..", "lib", "saldoDeclarado.ts");

const pagina = readFileSync(CAMINHO_PAGINA, "utf-8");
const modulo = readFileSync(CAMINHO_MODULO, "utf-8");

/** Linhas de código, sem os comentários — prosa não pode reprovar nem absolver. */
function linhasDeCodigo(fonte: string): string[] {
  return fonte
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*"));
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

  it("(c) o módulo puro NÃO exporta inversa contra os movimentos do dia — a quantidade certa nunca foi o movimento de hoje", () => {
    const exportadas = linhasDeCodigo(modulo)
      .filter((l) => l.startsWith("export function"))
      .map((l) => l.replace(/^export function\s+/, "").split("(")[0]);

    const inversas = exportadas.filter((n) => /initialBalance|paraSaldo|inversa/i.test(n));

    expect(
      inversas,
      "A inversa `desejado − entradas + saídas` foi contra a quantidade errada: o " +
        "número que a tela exibe é o saldo da âncora rolado pelo intervalo inteiro, " +
        "não o campo cru mais os movimentos de hoje. Declarar é ancorar. Código " +
        "obsoleto que compila é a próxima pessoa usando de novo — por isso ele sai " +
        "em vez de ficar depreciado.",
    ).toEqual([]);
  });

  it("(c) o valor declarado atravessa sem aritmética de movimento — nenhuma expressão `− entradas + saídas` sobrou no módulo", () => {
    const ofensores = linhasDeCodigo(modulo).filter((l) =>
      /-\s*e\s*\+\s*s\b|-\s*entradas\w*\s*\+\s*sa[ií]das/i.test(l),
    );

    expect(
      ofensores,
      "A forma da inversa voltou ao módulo. Se ela for mesmo necessária de novo, " +
        "este portão é o lugar de justificar — não de contornar.",
    ).toEqual([]);
  });

  it("(d) nenhum método do client Supabase desacoplado sem `.bind` — em ESM strict o `this` vira undefined e estoura em `rest` (233-01)", () => {
    const ofensores = linhasDeCodigo(pagina).filter(
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
    expect(pagina).toMatch(/previs[ãa]o de fechamento|fechamento previsto/i);
  });
});
