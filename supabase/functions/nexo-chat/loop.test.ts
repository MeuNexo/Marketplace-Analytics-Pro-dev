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
import {
  runChat,
  stripThinking,
  MAX_TOOL_ITERS,
  TURN_DEADLINE_MS,
  MAX_OUTPUT_TOKENS,
  THINKING_BUDGET,
} from "./loop";

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
  it("cap de iterações: sempre functionCall → para em MAX_TOOL_ITERS chamadas com fallback:true", async () => {
    const fetchImpl = vi.fn(async () => fnCallResponse("get_coverage", {}));
    const dispatchImpl = vi.fn(async () => [{ item_id: "X" }]);
    const r = await runChat(sb, "gkey", "ORG", ["111"], SYS, MSGS, { fetchImpl, dispatchImpl });
    expect(r.fallback).toBe(true);
    // nunca ultrapassa o cap de chamadas ao Gemini
    expect(MAX_TOOL_ITERS).toBe(8);
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_TOOL_ITERS);
    expect(dispatchImpl).toHaveBeenCalledTimes(MAX_TOOL_ITERS);
  });

  it("candidato SEM parts (MAX_TOKENS) → fallback 'Sem resposta.' — o bug de 2026-07-29", async () => {
    // regressão: thinking dinâmico consumia maxOutputTokens e o candidato voltava vazio
    const fetchImpl = vi.fn(async () =>
      ({
        ok: true,
        json: async () => ({ candidates: [{ finishReason: "MAX_TOKENS", content: {} }] }),
      }) as unknown as Response,
    );
    const r = await runChat(sb, "gkey", "ORG", ["111"], SYS, MSGS, {
      fetchImpl,
      dispatchImpl: vi.fn(),
    });
    expect(r.reply).toBe("Sem resposta.");
    expect(r.fallback).toBe(true);
  });

  it("deadline do turno cabe no wall-clock da EF (75s)", () => {
    expect(TURN_DEADLINE_MS).toBe(75_000);
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
  it("envia thinkingBudget FIXO (NUNCA 0), maxOutputTokens folgado, tools e toolConfig AUTO", async () => {
    const fetchImpl = vi.fn(async () => textResponse("ok"));
    await runChat(sb, "gkey", "ORG", ["111"], SYS, MSGS, {
      fetchImpl,
      dispatchImpl: vi.fn(),
    });
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.generationConfig.thinkingConfig.thinkingBudget).toBe(THINKING_BUDGET);
    expect(body.generationConfig.thinkingConfig.thinkingBudget).not.toBe(0);
    // thinking cabe DENTRO de maxOutputTokens no 2.5 — precisa sobrar espaço p/ a resposta
    expect(body.generationConfig.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
    expect(MAX_OUTPUT_TOKENS - THINKING_BUDGET).toBeGreaterThan(4000);
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

// ── Vazamento de raciocínio (bug de 2026-07-29) ──────────────────────────────
describe("runChat — raciocínio interno NUNCA vai para o reply", () => {
  it("descarta parts com thought:true, mantendo só a resposta", async () => {
    const fetchImpl = vi.fn(async () =>
      ({
        ok: true,
        json: async () => ({
          candidates: [{
            content: {
              parts: [
                { thought: true, text: "Here's a thinking process to construct the response..." },
                { text: "Sua margem está em 18%." },
              ],
            },
          }],
        }),
      }) as unknown as Response,
    );
    const r = await runChat(sb, "gkey", "ORG", ["111"], SYS, MSGS, { fetchImpl, dispatchImpl: vi.fn() });
    expect(r.reply).toBe("Sua margem está em 18%.");
    expect(r.reply).not.toMatch(/thinking process/i);
  });

  it("envia includeThoughts:false ao Gemini", async () => {
    const fetchImpl = vi.fn(async () => textResponse("ok"));
    await runChat(sb, "gkey", "ORG", ["111"], SYS, MSGS, { fetchImpl, dispatchImpl: vi.fn() });
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.generationConfig.thinkingConfig.includeThoughts).toBe(false);
  });
});

describe("stripThinking — 2ª camada quando o modelo emite o rascunho como texto", () => {
  it("corta o rascunho em inglês e devolve a resposta real", () => {
    const vazado =
      "thought\nHere's a thinking process to construct the response about the Pralana purchase order:\n\n" +
      "1.  **Deconstruct the User's Request:**\n    *   Core Problem: user has a R$ 47k order.\n" +
      "    *   Constraint: lead time is long.\n    *   I need to call get_replenishment first.\n\n" +
      "### Recomendação Estratégica\n\n**Sim, coloque o pedido**, mas negocie o prazo de pagamento " +
      "com o fornecedor para alinhar o desembolso à entrada do dinheiro da venda.";
    const limpo = stripThinking(vazado);
    expect(limpo).toMatch(/^### Recomendação Estratégica/);
    expect(limpo).not.toMatch(/thinking process/i);
    expect(limpo).not.toMatch(/Deconstruct/);
  });

  it("texto normal passa intacto (não engole resposta legítima)", () => {
    const normal = "Sua margem está em 18% e o ROAS caiu para 3,2.";
    expect(stripThinking(normal)).toBe(normal);
  });

  it("sem corte seguro, devolve o original em vez de engolir tudo", () => {
    const curto = "thought\nalgo curto sem marcador";
    expect(stripThinking(curto)).toBe(curto);
  });
});
