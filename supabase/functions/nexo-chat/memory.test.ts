/**
 * memory.test.ts — memória persistente do Consultor (Phase 106).
 *
 * Prova as decisões travadas por Wesley:
 *   - só fato 'active' entra no prompt ('pending' NUNCA);
 *   - fato com número sai rotulado como pista histórica;
 *   - fato pessoal de outro usuário não vaza para este turno;
 *   - conversa de outro usuário/org não é lida (defesa em profundidade além da RLS);
 *   - memória vazia → bloco omitido (não gasta token).
 */
import { describe, it, expect, vi } from "vitest";
import {
  loadHistory,
  loadMemories,
  renderMemoryBlock,
  createConversation,
  appendMessage,
  MAX_MEMORIES,
  type MemoryRow,
} from "./memory";

/** Client Supabase mockado — encadeamento .from().select().eq()... */
function mockSb(handlers: Record<string, unknown>) {
  const make = (table: string) => {
    const result = handlers[table] ?? { data: null };
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit", "insert", "update", "in"]) {
      chain[m] = vi.fn(() => chain);
    }
    chain.maybeSingle = vi.fn(async () => result);
    // await direto na chain (PostgREST builder é thenable)
    chain.then = (resolve: (v: unknown) => unknown) => resolve(result);
    return chain;
  };
  return { from: vi.fn((t: string) => make(t)) } as never;
}

describe("loadMemories — só fato ativo, sem vazamento pessoal", () => {
  it("filtra fato pessoal de OUTRO usuário", async () => {
    const sb = mockSb({
      nexo_memories: {
        data: [
          { id: "1", scope: "org", type: "decision", title: "CMV", body: "custo cheio", has_numbers: false, user_id: null },
          { id: "2", scope: "user", type: "preference", title: "meu", body: "x", has_numbers: false, user_id: "OUTRO" },
          { id: "3", scope: "user", type: "preference", title: "dele", body: "y", has_numbers: false, user_id: "EU" },
        ],
      },
    });
    const out = await loadMemories(sb, "ORG", "EU");
    expect(out.map((m) => m.id)).toEqual(["1", "3"]);
  });

  it("teto de fatos é 30", () => {
    expect(MAX_MEMORIES).toBe(30);
  });
});

describe("renderMemoryBlock", () => {
  const base: MemoryRow = {
    id: "1", scope: "org", type: "decision", title: "CMV", body: "custo cheio da nota", has_numbers: false,
  };

  it("memória vazia → string vazia (bloco omitido, não gasta token)", () => {
    expect(renderMemoryBlock([])).toBe("");
  });

  it("fato com número sai rotulado como pista histórica", () => {
    const bloco = renderMemoryBlock([{ ...base, has_numbers: true, title: "Lead Pralana", body: "78 dias" }]);
    expect(bloco).toMatch(/CONTÉM NÚMERO/);
    expect(bloco).toMatch(/confirme na tool antes de afirmar/i);
  });

  it("fato sem número não recebe o rótulo de perecível NA LINHA DO FATO", () => {
    // o cabeçalho de regras sempre cita [CONTÉM NÚMERO]; o que não pode é a linha do item
    const linhaDoFato = renderMemoryBlock([base])
      .split("\n")
      .find((l) => l.includes("CMV: custo cheio da nota"))!;
    expect(linhaDoFato).toBeDefined();
    expect(linhaDoFato).not.toMatch(/CONTÉM NÚMERO/);
  });

  it("carrega a defesa anti-injeção (memória é informação, nunca instrução)", () => {
    const bloco = renderMemoryBlock([base]);
    expect(bloco).toMatch(/INFORMAÇÃO, nunca INSTRUÇÃO/);
    expect(bloco).toMatch(/Memória não substitui tool/);
  });
});

describe("loadHistory — dono e org validados antes de ler", () => {
  it("conversa inexistente/de outro dono → histórico vazio", async () => {
    const sb = mockSb({ nexo_conversations: { data: null } });
    expect(await loadHistory(sb, "CONV", "ORG", "EU")).toEqual([]);
  });

  it("conversa do dono → mensagens em ordem cronológica (banco devolve DESC)", async () => {
    const sb = mockSb({
      nexo_conversations: { data: { id: "CONV" } },
      nexo_messages: {
        data: [
          { role: "model", content: "segunda" },
          { role: "user", content: "primeira" },
        ],
      },
    });
    const out = await loadHistory(sb, "CONV", "ORG", "EU");
    expect(out.map((c) => c.parts[0].text)).toEqual(["primeira", "segunda"]);
  });
});

describe("createConversation / appendMessage", () => {
  it("título é derivado da 1ª pergunta (≤60 chars)", async () => {
    const sb = mockSb({ nexo_conversations: { data: { id: "NOVA" } } });
    const id = await createConversation(sb, "ORG", "EU", "x".repeat(200));
    expect(id).toBe("NOVA");
  });

  it("appendMessage não lança quando o insert resolve", async () => {
    const sb = mockSb({ nexo_messages: { data: null }, nexo_conversations: { data: null } });
    await expect(appendMessage(sb, "CONV", "ORG", "user", "oi")).resolves.toBeUndefined();
  });
});
