import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Portão estático da edge function `sync-ml-frete-tabela` (225-06, Task 2).
//
// Molde herdado do audit test da `sync-mp-saidas` (225-04): LÊ O FONTE e remove
// comentários antes de contar. Sem isso um comentário que EXPLICA um tratamento
// contaria como o tratamento — e este arquivo inteiro é sobre a diferença entre
// tratar e mencionar.
//
// Ele não substitui as provas de produção (F-01 a F-06 em `225-PROVA-FRETE.md`).
// Ele impede a REGRESSÃO silenciosa das quatro coisas que, se caírem, tornam a
// captura cara, insegura ou mentirosa sem derrubar nenhum outro teste.
// ─────────────────────────────────────────────────────────────────────────────

const FONTE = readFileSync(join(__dirname, "index.ts"), "utf8");

/** Remove comentários de bloco e de linha — conta só o que executa. */
function semComentarios(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const CODIGO = semComentarios(FONTE);

describe("guarda de papel de serviço — antes do trabalho, nunca depois", () => {
  it("existe a guarda e ela roda no handler", () => {
    expect(/function\s+requireServiceRole/.test(CODIGO)).toBe(true);
    expect(/const\s+guard\s*=\s*requireServiceRole\(req\)/.test(CODIGO)).toBe(true);
    expect(/if\s*\(guard\)\s*return\s+guard/.test(CODIGO)).toBe(true);
  });

  it("🔴 a guarda vem ANTES do trabalho em background e do modo síncrono", () => {
    const posGuarda = CODIGO.indexOf("requireServiceRole(req)");
    const posWaitUntil = CODIGO.indexOf("EdgeRuntime.waitUntil");
    const posDebug = CODIGO.indexOf('searchParams.get("debug")');
    expect(posGuarda).toBeGreaterThan(-1);
    // Autenticação que roda depois do trabalho não é autenticação.
    expect(posWaitUntil).toBeGreaterThan(posGuarda);
    expect(posDebug).toBeGreaterThan(posGuarda);
  });

  it("compara o header com o service role, não com qualquer bearer", () => {
    expect(/auth\s*!==\s*"Bearer\s*"\s*\+\s*SERVICE_KEY/.test(CODIGO)).toBe(true);
  });
});

describe("try/catch externo na função de background", () => {
  it("🔴 runSync tem try/catch externo — sem ele a exceção morre sem log", () => {
    expect(/async function runSync\([^)]*\)[^{]*\{\s*try\s*\{/.test(CODIGO)).toBe(true);
    const corpo = CODIGO.slice(CODIGO.indexOf("async function runSync"));
    expect(/catch\s*\(err[^)]*\)\s*\{[\s\S]{0,300}console\.error/.test(corpo)).toBe(true);
  });

  it("existe modo síncrono de depuração — prova persistência sem depender de log", () => {
    expect(/mode:\s*"debug-sync"/.test(CODIGO)).toBe(true);
  });

  it("falha de uma organização não derruba as outras", () => {
    expect(/for\s*\(const\s+linha\s+of\s+tokens\)\s*\{\s*try\s*\{/.test(CODIGO)).toBe(true);
  });
});

describe("🔴 UMA chamada por anúncio — não uma varredura de destinos", () => {
  it("só existe UMA ocorrência do endpoint de opções de envio no fonte", () => {
    const ocorrencias = CODIGO.match(/shipping_options/g) ?? [];
    expect(ocorrencias.length).toBe(1);
  });

  it("o CEP é UMA constante do código, não uma lista varrida", () => {
    // Uma lista de CEPs seria a assinatura da varredura que o research
    // provou desnecessária: `list_cost` não varia por destino.
    expect(/const\s+CEP_REF\s*=\s*"\d{8}"/.test(CODIGO)).toBe(true);
    const ceps = CODIGO.match(/"\d{8}"/g) ?? [];
    expect(ceps.length).toBe(1);
    expect(/CEP_REF\s*:\s*(string\[\]|Array)/.test(CODIGO)).toBe(false);
    expect(/for\s*\([^)]*\bof\s+CEPS?\b/.test(CODIGO)).toBe(false);
  });

  it("🔴 a régua gravada é `list_cost`, e `base_cost` só entra como diagnóstico", () => {
    expect(/list_cost/.test(CODIGO)).toBe(true);
    // `base_cost` é função do destino (R$ 23,30 / 47,50 / 29,20 no mesmo item).
    // Ele pode ser guardado, mas NUNCA na coluna que a comparação usa.
    //
    // 🔴 A asserção é POSITIVA e nomeia a origem. A versão anterior era
    // negativa (`não contém base_cost` depois de `list_cost:`) e passou com
    // `list_cost: leitura.baseCostRef` — a regressão exata que ela existia
    // para pegar, escrita em camelCase. Proibir uma grafia não é proibir a
    // troca; exigir a origem certa é.
    expect(/list_cost\s*:\s*leitura\.listCost\b/.test(CODIGO)).toBe(true);
    expect(/list_cost\s*:[^,\n]*base/i.test(CODIGO)).toBe(false);
    expect(/base_cost_ref\s*:\s*leitura\.baseCostRef\b/.test(CODIGO)).toBe(true);
  });

  it("grava linha nova SÓ quando o custo muda — a série cresce por mudança", () => {
    expect(/mudou|inalterad/i.test(CODIGO)).toBe(true);
    expect(/vigente_desde/.test(CODIGO)).toBe(true);
  });
});

describe("🔴 anúncio sem estoque é condição normal, não erro", () => {
  it("o 404 tem caminho próprio, distinto do caminho de erro", () => {
    expect(/status\s*===\s*404\b/.test(CODIGO)).toBe(true);
    expect(/sem_estoque/.test(CODIGO)).toBe(true);
  });

  it("o retorno conta `sem_estoque` em campo SEPARADO de `erros`", () => {
    expect(/sem_estoque\s*:/.test(CODIGO)).toBe(true);
    expect(/erros\s*:/.test(CODIGO)).toBe(true);
  });

  it("429 recua com espera crescente — o bloqueio do ML é por origem", () => {
    expect(/status\s*===\s*429\b/.test(CODIGO)).toBe(true);
    expect(/backoff|espera|recuo/i.test(CODIGO)).toBe(true);
  });

  it("🔴 400 falha ALTO — o CEP é constante nossa, não entrada do usuário", () => {
    expect(/status\s*===\s*400\b/.test(CODIGO)).toBe(true);
    const trecho = CODIGO.slice(CODIGO.search(/status\s*===\s*400\b/));
    expect(/throw new Error/.test(trecho.slice(0, 400))).toBe(true);
  });
});

describe("as proibições do plano, em forma de portão", () => {
  it("nenhum cron novo é criado por esta função", () => {
    expect(/pg_cron|cron\.schedule|pg_net/i.test(CODIGO)).toBe(false);
  });

  it("o escopo sai de DADO, não de UUID escrito no código", () => {
    expect(/conciliacao_config/.test(CODIGO)).toBe(true);
    const uuids = CODIGO.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
    expect(uuids.length).toBe(0);
  });

  it("o universo vem da API do ML, não do cache que já teve fantasma", () => {
    expect(/items\/search/.test(CODIGO)).toBe(true);
    expect(/ml_inventory_cache/.test(CODIGO)).toBe(false);
  });

  it("existe orçamento por invocação — varredura sem teto estoura o tempo", () => {
    expect(/const\s+ORCAMENTO\s*=\s*\d+/.test(CODIGO)).toBe(true);
  });

  it("o cabeçalho registra a escolha de agendamento e o porquê", () => {
    // No FONTE (com comentários) de propósito: a decisão mora no cabeçalho.
    expect(/AGENDAMENTO/i.test(FONTE)).toBe(true);
    expect(/sync-mp-releases/.test(FONTE)).toBe(true);
  });
});
