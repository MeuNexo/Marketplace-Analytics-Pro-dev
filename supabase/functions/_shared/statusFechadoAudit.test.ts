/**
 * statusFechadoAudit.test.ts — auditoria estática: nenhum `status === "ok"`
 * solto sobrevive na edge function da captura de cobrança.
 *
 * ── POR QUE ESTE PORTÃO EXISTE (240-05) ─────────────────────────────────────
 *
 * O status `so_cobranca` nasceu no 240-03 e havia QUATRO lugares testando
 * `status === "ok"` em texto. Eu corrigi dois (a fila e o carimbo) e deixei
 * dois passarem — e o que mais importava era o filtro da GRAVAÇÃO DAS LINHAS:
 * `so_cobranca` ficava de fora, então a linha de cobrança que a 240-01 acabara
 * de destravar era CONTADA no diagnóstico e NÃO GRAVADA no banco.
 *
 * Medido na tela em 05/09/2026: 11 pedidos com `linhas = 1` na captura e 0
 * linhas em `ml_order_sale_fee`. O defeito que a fase existe para matar,
 * reintroduzido por mim ao criar o status novo — e achado pela CONTAGEM, não
 * pela leitura do código.
 *
 * 🔴 A lição que este arquivo trava: introduzir um estado novo obriga a varrer
 * TODOS os pontos que decidem por estado. Um predicado nomeado
 * (`ehCapturaFechada`) permite a varredura; um literal repetido, não.
 *
 * A prova é ESTÁTICA porque o `index.ts` importa módulos remotos que o vitest
 * não resolve — o mesmo motivo pelo qual a decisão de fila virou módulo puro.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ARQ = "supabase/functions/sync-ml-order-sale-fee/index.ts";
const bruto = readFileSync(resolve(process.cwd(), ARQ), "utf8");

/** Sem comentários: uma frase que EXPLICA o padrão proibido não é o padrão. */
const codigo = bruto
  .split("\n")
  .map((l) => {
    const i = l.indexOf("//");
    return i === -1 ? l : l.slice(0, i);
  })
  .join("\n");

describe("240-05 — decisão por estado usa predicado nomeado, nunca literal", () => {
  it("🔴 nenhum `status === \"ok\"` sobrou no código", () => {
    const ocorrencias = codigo.match(/status\s*===\s*["']ok["']/g) ?? [];
    expect(
      ocorrencias,
      "use `ehCapturaFechada(status)`: `so_cobranca` também é captura fechada",
    ).toEqual([]);
  });

  it("nem a forma negada", () => {
    const ocorrencias = codigo.match(/status\s*!==\s*["']ok["']/g) ?? [];
    expect(ocorrencias).toEqual([]);
  });

  it("o predicado é importado e usado", () => {
    expect(codigo).toMatch(/ehCapturaFechada/);
    const usos = codigo.match(/ehCapturaFechada\(/g) ?? [];
    // 3 decisões: gravar linhas, contar a rodada, contar no modo `status`.
    expect(usos.length).toBeGreaterThanOrEqual(3);
  });

  it("🔴 a gravação das linhas passa pelo predicado — é a que vale dinheiro", () => {
    expect(codigo).toMatch(/idsCapturados[\s\S]{0,160}ehCapturaFechada\(d\.status\)/);
  });

  it("o carimbo de captura também não decide por literal", () => {
    expect(codigo).not.toMatch(/capturado_em:\s*d\.status\s*===/);
    expect(codigo).toMatch(/capturado_em:\s*carimboDeCaptura\(/);
  });
});
