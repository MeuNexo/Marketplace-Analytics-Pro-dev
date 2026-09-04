// ============================================================================
// 225-05 Task 2 (RED) — o desfecho: quem pode escrever, o que pode ser escrito
//
// D-225-13 existe para responder UMA pergunta que hoje não tem resposta:
// "quanto o ML devolveu de fato, e que tipo de caso ele aceita?". Isso só se
// sabe se o desfecho for rastreado — e só é confiável se a escrita não puder
// inventar estado nem atravessar organização.
//
// 🔴 Duas provas, porque nenhuma das duas sozinha basta:
//
//   · COMPORTAMENTO — as funções puras (`validarDesfecho`,
//     `podeEscreverDesfecho`) são exercidas de verdade. Elas são o portão que
//     roda ANTES do banco;
//   · FORMA — o arquivo é lido como texto para provar o que exigiria uma
//     sessão autenticada: `organization_id` explícito no caminho de escrita e
//     as DUAS consultas invalidadas. O executor não alcança o banco.
//
// ⚠️ Comentários são removidos antes de contar: a prosa que documenta um
// padrão proibido não pode reprovar o arquivo que ela explica (lição do
// 231-04, repetida no 225-03).
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({}), auth: { getUser: async () => ({ data: { user: null } }) } },
}));

import {
  ESTADOS_ACEITOS,
  ESTADOS_DO_SISTEMA,
  podeEscreverDesfecho,
  validarDesfecho,
  type EntradaDesfecho,
} from "../useCasoDesfecho";

const CAMINHO = join(__dirname, "..", "useCasoDesfecho.ts");

function semComentarios(fonte: string): string {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");
}

const CODIGO = semComentarios(readFileSync(CAMINHO, "utf-8"));

const BASE: EntradaDesfecho = {
  ml_order_id: "2000017817648050",
  tipo_caso: "repasse_ausente",
  estado: "contestado",
};

describe("🔴 PORTÃO — os estados do SISTEMA nunca são escritos pelo usuário", () => {
  it("1/6 — `resolvido_sozinho` é recusado antes de qualquer chamada ao banco", () => {
    // "Resolvido sozinho" é o sistema detectando o repasse que chegou depois da
    // abertura do caso. Se o usuário pudesse marcá-lo, "o ML pagou porque
    // reclamei" e "ia chegar de qualquer jeito" viravam a mesma linha — e essa
    // distinção é o motivo inteiro de D-225-13 existir.
    const erro = validarDesfecho({ ...BASE, estado: "resolvido_sozinho" });
    expect(erro, "resolvido_sozinho tem que ser recusado").toBeTruthy();
    expect(String(erro)).toContain("sistema");
  });

  it("1b/6 — `expirado` também é recusado", () => {
    expect(validarDesfecho({ ...BASE, estado: "expirado" })).toBeTruthy();
  });

  it("1c/6 — os dois estados derivados estão nomeados e fora dos aceitos", () => {
    expect([...ESTADOS_DO_SISTEMA].sort()).toEqual(["expirado", "resolvido_sozinho"]);
    for (const e of ESTADOS_DO_SISTEMA) {
      expect(ESTADOS_ACEITOS as readonly string[]).not.toContain(e);
    }
  });

  it("1d/6 — os aceitos são exatamente três: contestado, ganho, negado", () => {
    expect([...ESTADOS_ACEITOS].sort()).toEqual(["contestado", "ganho", "negado"]);
  });

  it("1e/6 — estado inventado é recusado", () => {
    expect(validarDesfecho({ ...BASE, estado: "quase_ganho" })).toBeTruthy();
    expect(validarDesfecho({ ...BASE, estado: null })).toBeTruthy();
  });
});

describe("🔴 PORTÃO — 'ganho' sem valor recuperado não é ganho, é chute", () => {
  it("2/6 — marcar ganho sem valor é recusado", () => {
    const erro = validarDesfecho({ ...BASE, estado: "ganho" });
    expect(erro).toBeTruthy();
    expect(String(erro).toLowerCase()).toContain("valor");
  });

  it("2b/6 — valor zero ou negativo também é recusado", () => {
    expect(validarDesfecho({ ...BASE, estado: "ganho", valor_recuperado: 0 })).toBeTruthy();
    expect(validarDesfecho({ ...BASE, estado: "ganho", valor_recuperado: -5 })).toBeTruthy();
    expect(validarDesfecho({ ...BASE, estado: "ganho", valor_recuperado: NaN })).toBeTruthy();
  });

  it("2c/6 — com valor recuperado, passa", () => {
    expect(validarDesfecho({ ...BASE, estado: "ganho", valor_recuperado: 439.25 })).toBeNull();
  });

  it("2d/6 — contestado e negado não exigem valor", () => {
    expect(validarDesfecho({ ...BASE, estado: "contestado" })).toBeNull();
    expect(validarDesfecho({ ...BASE, estado: "negado" })).toBeNull();
  });
});

describe("🔴 PORTÃO — a chave é pedido MAIS tipo, nunca pedido sozinho", () => {
  it("3/6 — sem pedido, recusa", () => {
    expect(validarDesfecho({ ...BASE, ml_order_id: null })).toBeTruthy();
    expect(validarDesfecho({ ...BASE, ml_order_id: "   " })).toBeTruthy();
  });

  it("3b/6 — sem tipo de caso, recusa", () => {
    // Um pedido pode ter DOIS casos de tipos diferentes. Casar só pelo pedido
    // sobrescreveria um desfecho com o outro.
    expect(validarDesfecho({ ...BASE, tipo_caso: null })).toBeTruthy();
  });
});

describe("🔴 PORTÃO — o papel decide se o botão existe", () => {
  it("4/6 — owner e admin escrevem", () => {
    expect(podeEscreverDesfecho("owner")).toBe(true);
    expect(podeEscreverDesfecho("admin")).toBe(true);
  });

  it("4b/6 — member e viewer NÃO escrevem", () => {
    // A policy de `conciliacao_casos` já recusaria. A tela não pode oferecer um
    // botão que o banco vai negar: o usuário veria um erro no lugar de uma tela
    // honesta. Botão que não existe é melhor que botão que falha.
    expect(podeEscreverDesfecho("member")).toBe(false);
    expect(podeEscreverDesfecho("viewer")).toBe(false);
  });

  it("4c/6 — papel ausente, vazio ou desconhecido não escreve", () => {
    expect(podeEscreverDesfecho(null)).toBe(false);
    expect(podeEscreverDesfecho(undefined)).toBe(false);
    expect(podeEscreverDesfecho("")).toBe(false);
    expect(podeEscreverDesfecho("OWNER ")).toBe(false);
  });
});

describe("🔴 PORTÃO (forma) — a escrita carrega a organização explicitamente", () => {
  it("5/6 — escreve na tabela do modelo de caso da 225-02", () => {
    expect(CODIGO).toContain("conciliacao_casos");
  });

  it("5b/6 — `organization_id` aparece no caminho de escrita, ao menos duas vezes", () => {
    // Defesa em profundidade: a RLS já filtra e a policy já exige owner/admin,
    // mas escrever o filtro mesmo assim foi como `saldo_declarado` ficou de pé.
    const ocorrencias = (CODIGO.match(/organization_id/g) ?? []).length;
    expect(ocorrencias, "escrita sem organização explícita").toBeGreaterThanOrEqual(2);
  });

  it("5c/6 — as duas datas de rastro são gravadas", () => {
    expect(CODIGO, "sem contestado_em não se sabe se houve chamado").toContain("contestado_em");
    expect(CODIGO, "sem desfecho_em não se sabe quando fechou").toContain("desfecho_em");
  });

  it("5d/6 — quem marcou fica registrado (não-repúdio)", () => {
    expect(CODIGO).toContain("criado_por");
  });
});

describe("🔴 PORTÃO (forma) — sucesso invalida AS DUAS consultas", () => {
  it("6/6 — a lista e o resumo são invalidados", () => {
    // O banner de urgência lê o resumo e a fila lê a lista. Invalidar só uma
    // deixa a tela dizendo dois números diferentes sobre o mesmo caso.
    expect(CODIGO).toContain("conciliacao-casos");
    expect(CODIGO).toContain("conciliacao-resumo");
    expect(CODIGO).toMatch(/invalidateQueries/);
  });

  it("6b/6 — o erro do banco sobe com a mensagem original", () => {
    expect(CODIGO).toMatch(/throw new Error\(/);
    expect(CODIGO).toMatch(/error\.message|erro\.message/);
  });
});
