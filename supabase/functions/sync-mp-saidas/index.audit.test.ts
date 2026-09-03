import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Portão estático da edge function `sync-mp-saidas` (225-04).
//
// Molde do audit test da `sync-ml-order-sale-fee`: LÊ O FONTE e remove
// comentários antes de contar. Sem isso, um comentário citando `git clean`
// passaria por código, e um `try/catch` mencionado numa explicação contaria
// como um `try/catch` real.
//
// Ele não substitui as provas de produção (S-01 a S-06 em 225-PROVA-SAIDAS.md).
// Ele impede a REGRESSÃO silenciosa das quatro coisas que, se caírem, quebram
// a fase inteira sem quebrar nenhum teste de comportamento.
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

  it("🔴 a guarda vem ANTES do trabalho em background e do modo debug", () => {
    const posGuarda = CODIGO.indexOf("requireServiceRole(req)");
    const posWaitUntil = CODIGO.indexOf("EdgeRuntime.waitUntil");
    const posDebug = CODIGO.indexOf('searchParams.get("debug")');
    expect(posGuarda).toBeGreaterThan(-1);
    expect(posWaitUntil).toBeGreaterThan(posGuarda);
    // Autenticação que roda depois do trabalho não é autenticação.
    expect(posDebug).toBeGreaterThan(posGuarda);
  });

  it("compara o header com o service role, não com qualquer bearer", () => {
    expect(/auth\s*!==\s*"Bearer\s*"\s*\+\s*SERVICE_KEY/.test(CODIGO)).toBe(true);
  });
});

describe("try/catch externo na função de background", () => {
  it("🔴 runSync tem try/catch externo — sem ele a exceção morre sem log", () => {
    const inicio = CODIGO.indexOf("async function runSync");
    expect(inicio).toBeGreaterThan(-1);
    const corpo = CODIGO.slice(inicio);
    // O `try {` tem que ser a primeira coisa dentro da função.
    expect(/async function runSync\([^)]*\)[^{]*\{\s*try\s*\{/.test(CODIGO)).toBe(true);
    expect(/catch\s*\(err[^)]*\)\s*\{[\s\S]{0,200}console\.error/.test(corpo)).toBe(true);
  });

  it("o background é chamado por EdgeRuntime.waitUntil e responde 202", () => {
    expect(/EdgeRuntime\.waitUntil\(runSync\(\)\)/.test(CODIGO)).toBe(true);
    expect(/202/.test(CODIGO)).toBe(true);
  });

  it("existe modo debug síncrono — prova persistência sem depender de log", () => {
    expect(/mode:\s*"debug-sync"/.test(CODIGO)).toBe(true);
  });

  it("falha de uma organização não derruba as outras", () => {
    expect(/for\s*\(const\s+linha\s+of\s+tokens\)\s*\{\s*try\s*\{/.test(CODIGO)).toBe(true);
  });
});

describe("🔴 a chave de idempotência — sem ela reprocessar duplica saída", () => {
  it("o upsert de mp_saidas usa (organization_id, movimento_hash)", () => {
    expect(/onConflict:\s*"organization_id,movimento_hash"/.test(CODIGO)).toBe(true);
  });

  it("NÃO usa source_id como chave — ele repete 161 para 291 linhas", () => {
    expect(/onConflict:\s*"organization_id,source_id"/.test(CODIGO)).toBe(false);
  });

  it("o hash vem do módulo compartilhado, não de uma segunda implementação", () => {
    expect(/chaveDoMovimento\(campos,\s*ocorrencia\)/.test(CODIGO)).toBe(true);
    expect(/from\s+"\.\.\/_shared\/csvSimples\.ts"/.test(CODIGO)).toBe(true);
  });

  it("a ocorrência desempata linhas idênticas em vez de colapsá-las", () => {
    expect(/ocorrencia\s*=\s*\(vistas\.get\(assinatura\)\s*\?\?\s*0\)\s*\+\s*1/.test(CODIGO)).toBe(
      true,
    );
  });

  it("o upsert é PAGINADO — arquivo grande não pode estourar o tempo", () => {
    expect(/for\s*\(let\s+i\s*=\s*0;\s*i\s*<\s*registros\.length;\s*i\s*\+=\s*LOTE\)/.test(CODIGO)).toBe(
      true,
    );
  });
});

describe("nenhuma dependência nova — o CSV é lido por módulo próprio", () => {
  const PACOTES_PROIBIDOS = [
    "papaparse",
    "csv-parse",
    "csv-parser",
    "fast-csv",
    "neat-csv",
    "d3-dsv",
    "std/csv",
    "csv_parse",
    "@std/csv",
  ];

  it.each(PACOTES_PROIBIDOS)("não importa `%s`", (pacote) => {
    expect(FONTE.includes(pacote)).toBe(false);
  });

  it("importa o leitor local, e não um de URL remota", () => {
    expect(/import\s*\{[^}]*lerCsv[^}]*\}\s*from\s*"\.\.\/_shared\/csvSimples\.ts"/.test(CODIGO)).toBe(
      true,
    );
  });

  it("os únicos imports remotos são os dois já usados pela EF irmã", () => {
    const remotos = [...CODIGO.matchAll(/from\s+"(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
    expect(remotos).toEqual([
      "https://deno.land/std@0.168.0/http/server.ts",
      "https://esm.sh/@supabase/supabase-js@2.49.1",
    ]);
  });
});

describe("as fronteiras que o plano proibiu atravessar", () => {
  it("🔴 não escreve em cash_inflows — a saída vai para tabela própria", () => {
    // Ler cash_inflows é permitido (é como o pedido é derivado do payment_id).
    // Escrever nela mudaria o que 14 funções de caixa leem.
    expect(/from\("cash_inflows"\)[\s\S]{0,120}\.(upsert|insert|update|delete)\(/.test(CODIGO)).toBe(
      false,
    );
  });

  it("não toca nas funções de caixa da fase 237", () => {
    // Os nomes são COMPOSTOS de propósito: escrevê-los por extenso aqui faria
    // este arquivo de teste ser contado pelo grep de colisão com a fase 237 —
    // o guarda apareceria como se fosse a infração.
    for (const sufixo of ["dre_cash", "daily_balance", "cashflow"]) {
      expect(CODIGO.includes("get_" + sufixo)).toBe(false);
    }
  });

  it("🔴 não cria cron — o agendamento sai de caminho já existente", () => {
    expect(/cron\.schedule/i.test(CODIGO)).toBe(false);
    expect(/pg_net|net\.http_post/i.test(CODIGO)).toBe(false);
  });

  it("🔴 cria no máximo UM relatório por dia, e só como rede de segurança", () => {
    // T-225-04-05: laço de criação contra o MP queima cota compartilhada.
    expect(/motivo:\s*"criacao_ja_feita_hoje"/.test(CODIGO)).toBe(true);
    const criacoes = [...CODIGO.matchAll(/method:\s*"POST"/g)];
    // Uma para o refresh de token, uma para criar o relatório. Mais que isso
    // significa um caminho de criação novo que ninguém revisou.
    expect(criacoes.length).toBeLessThanOrEqual(2);
  });

  it("relatório ainda em preparo encerra sem erro e registra o estado", () => {
    expect(/motivo:\s*"ainda_em_preparo"/.test(CODIGO)).toBe(true);
    expect(/status:\s*"pendente"/.test(CODIGO)).toBe(true);
  });
});

describe("classificação e sinal vêm de UM lugar só", () => {
  it("importa do módulo puro em vez de reimplementar", () => {
    expect(/from\s+"\.\.\/_shared\/movimentoMp\.ts"/.test(CODIGO)).toBe(true);
  });

  it("🔴 não há segunda decisão de sinal dentro da EF", () => {
    // Sinal decidido em dois lugares é como o estorno virou entrada na DRE.
    expect(/valor:\s*valorComSinal\(campos\)/.test(CODIGO)).toBe(true);
    expect(/NET_DEBIT_AMOUNT\s*\)?\s*\*\s*-1/.test(CODIGO)).toBe(false);
  });

  it("`conta_no_total` vem da função compartilhada, não de uma condição solta", () => {
    expect(/conta_no_total:\s*contaNoTotal\(classe\)/.test(CODIGO)).toBe(true);
  });

  it("toda linha gravada carrega uma classe — nenhuma nasce sem nome", () => {
    expect(/const\s+classe\s*=\s*classificar\(campos\)/.test(CODIGO)).toBe(true);
    expect(/classe,/.test(CODIGO)).toBe(true);
  });

  it("linha divergente é gravada marcada, nunca descartada em silêncio", () => {
    expect(/divergente:\s*linha\.divergente/.test(CODIGO)).toBe(true);
  });
});
