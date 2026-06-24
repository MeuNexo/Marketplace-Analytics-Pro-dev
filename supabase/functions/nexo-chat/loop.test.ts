/**
 * loop.test.ts — unit do loop server-side de tool-calling do Nexo (Plan 57-02).
 *
 * fetch do Gemini é INJETADO (fetchImpl) para controlar a sequência de respostas.
 * dispatchTool é INJETADO (dispatchImpl) para observar chamadas sem tocar no Supabase.
 *
 * Prova (NEXO-07): termina por texto, por cap=5 e por timeout; append correto de
 * contents (model.functionCall → user.functionResponse); generationConfig usa
 * thinkingBudget:-1 (nunca 0).
 */
import { describe, it, expect, vi } from "vitest";
import { runChat } from "./loop";

// Resposta Gemini só-texto
function textResponse(text: string) {
  return {
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  } as unknown as Response;
}
// Resposta Gemini com functionCall
function fnCallResponse(name: string, args: Record<string, unknown> = {}) {
  return {
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ functionCall: { name, args } }] } }],
    }),
  } as unknown as Response;
}

const sb = {} as any; // não usado: dispatchTool é injetado
const SYS = "system prompt";
const MSGS = [{ role: "user" as const, parts: [{ text: "como está a margem?" }] }];

describe("runChat — término por texto", () => {
  it("resposta só-texto: 1 chamada, sem dispatch, fallback:false", async () => {
    const fetchImpl = vi.fn(async () => textResponse("Sua margem está em 18%."));
    const dispatchImpl = vi.fn();
    const r = await runChat(sb, "gkey", "ORG", ["111"], SYS, MSGS, { fetchImpl, dispatchImpl });
    expect(r.reply).toBe("Sua margem está em 18%.");
    expect(r.usedTools).toEqual([]);
    expect(r.fallback).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(dispatchImpl).not.toHaveBeenCalled();
  });
});

describe("runChat — functionCall → text", () => {
  it("chama dispatch 1x, faz append correto e retorna texto final com usedTools", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fnCallResponse("get_margin_summary", { from: "2026-06-01" }))
      .mockResolvedValueOnce(textResponse("Lucro de R$ 12.000 no período."));
    const dispatchImpl = vi.fn(async () => [{ lucro: 12000 }]);

    const r = await runChat(sb, "gkey", "ORG", ["111"], SYS, MSGS, { fetchImpl, dispatchImpl });

    expect(r.reply).toBe("Lucro de R$ 12.000 no período.");
    expect(r.usedTools).toEqual(["get_margin_summary"]);
    expect(r.fallback).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(dispatchImpl).toHaveBeenCalledTimes(1);
    // dispatch recebe orgId/mlUserIds do servidor (não dos args do modelo)
    const dispatchArgs = dispatchImpl.mock.calls[0];
    expect(dispatchArgs[1]).toBe("ORG"); // orgId
    expect(dispatchArgs[2]).toEqual(["111"]); // mlUserIds
    expect(dispatchArgs[3]).toBe("get_margin_summary"); // name

    // append correto: a 2ª chamada recebeu contents com model.functionCall + user.functionResponse
    const secondBody = JSON.parse((fetchImpl.mock.calls[1][1] as RequestInit).body as string);
    const contents = secondBody.contents;
    // [0]=user inicial, [1]=model functionCall, [2]=user functionResponse
    expect(contents.length).toBe(3);
    expect(contents[1].role).toBe("model");
    expect(contents[1].parts[0].functionCall.name).toBe("get_margin_summary");
    expect(contents[2].role).toBe("user");
    expect(contents[2].parts[0].functionResponse.name).toBe("get_margin_summary");
    expect(contents[2].parts[0].functionResponse.response.content).toEqual([{ lucro: 12000 }]);
  });
});

describe("runChat — guardrails (NEXO-07)", () => {
  it("cap de iterações: sempre functionCall → para em 5 chamadas com fallback:true", async () => {
    const fetchImpl = vi.fn(async () => fnCallResponse("get_coverage", {}));
    const dispatchImpl = vi.fn(async () => [{ item_id: "X" }]);
    const r = await runChat(sb, "gkey", "ORG", ["111"], SYS, MSGS, { fetchImpl, dispatchImpl });
    expect(r.fallback).toBe(true);
    // nunca ultrapassa o cap=5 de chamadas ao Gemini
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(dispatchImpl).toHaveBeenCalledTimes(5);
  });

  it("timeout: deadline estourado → fallback:true sem nova chamada ao Gemini", async () => {
    const fetchImpl = vi.fn(async () => textResponse("não deveria ser chamado"));
    const dispatchImpl = vi.fn();
    // nowImpl injetado: já passou o deadline na 1ª verificação
    let calls = 0;
    const nowImpl = () => {
      calls++;
      return calls === 1 ? 0 : 1_000_000; // start=0, primeira checagem do loop=enorme
    };
    const r = await runChat(sb, "gkey", "ORG", ["111"], SYS, MSGS, {
      fetchImpl,
      dispatchImpl,
      nowImpl,
    });
    expect(r.fallback).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("runChat — config Gemini", () => {
  it("envia thinkingBudget:-1 (NUNCA 0), tools e toolConfig AUTO", async () => {
    const fetchImpl = vi.fn(async () => textResponse("ok"));
    await runChat(sb, "gkey", "ORG", ["111"], SYS, MSGS, {
      fetchImpl,
      dispatchImpl: vi.fn(),
    });
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.generationConfig.thinkingConfig.thinkingBudget).toBe(-1);
    expect(body.generationConfig.thinkingConfig.thinkingBudget).not.toBe(0);
    expect(body.toolConfig.functionCallingConfig.mode).toBe("AUTO");
    expect(Array.isArray(body.tools[0].functionDeclarations)).toBe(true);
    expect(body.tools[0].functionDeclarations.length).toBeGreaterThan(0);
    // system_instruction presente; header com a api key
    expect(body.system_instruction.parts[0].text).toBe(SYS);
    const headers = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("gkey");
  });

  it("gemini !ok → fallback:true", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response);
    const r = await runChat(sb, "gkey", "ORG", ["111"], SYS, MSGS, {
      fetchImpl,
      dispatchImpl: vi.fn(),
    });
    expect(r.fallback).toBe(true);
  });
});
