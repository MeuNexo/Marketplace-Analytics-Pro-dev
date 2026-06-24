/**
 * loop.ts — loop server-side de tool-calling do Nexo (Plan 57-02, NEXO-07).
 *
 * runChat(): Gemini → functionCall → dispatchTool (escopado por org) → functionResponse,
 * até a resposta final em texto, com guardrails:
 *   - MAX_TOOL_ITERS = 5  (cap de iterações/turno — evita runaway loop)
 *   - TURN_DEADLINE_MS = 25000  (timeout do turno inteiro)
 *   - cap de linhas por functionResponse vem do dispatcher (≤50)
 *
 * Append correto de contents (obrigatório p/ o protocolo Gemini):
 *   1) push {role:"model", parts:[{functionCall}...]}
 *   2) push {role:"user",  parts:[{functionResponse}...]}
 *
 * generationConfig.thinkingConfig.thinkingBudget = -1 (dinâmico). NUNCA 0 no
 * 2.5-pro (HTTP 400). fetch e dispatchTool são injetáveis p/ teste.
 *
 * Read-only (T-57-12): dispatchTool só lê. Nenhuma mutação no ML.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { TOOL_DECLARATIONS, dispatchTool as defaultDispatch } from "./tools.ts";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
const DEFAULT_MODEL = "gemini-2.5-pro";
export const MAX_TOOL_ITERS = 5;
export const TURN_DEADLINE_MS = 25_000;

export type GeminiPart = {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: { content: unknown } };
};
export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

export type RunChatResult = { reply: string; usedTools: string[]; fallback: boolean };

export type RunChatOpts = {
  /** fetch injetável (default globalThis.fetch) — mockado no teste. */
  fetchImpl?: typeof fetch;
  /** dispatcher injetável (default dispatchTool de ./tools.ts) — mockado no teste. */
  dispatchImpl?: (
    sb: SupabaseClient, orgId: string, mlUserIds: string[], name: string, args: Record<string, unknown>,
  ) => Promise<unknown>;
  /** relógio injetável (default Date.now) — força timeout no teste. */
  nowImpl?: () => number;
  /** modelo Gemini (default gemini-2.5-pro). */
  model?: string;
};

export async function runChat(
  sb: SupabaseClient,
  gkey: string,
  orgId: string,
  mlUserIds: string[],
  systemPrompt: string,
  clientMessages: GeminiContent[],
  opts: RunChatOpts = {},
): Promise<RunChatResult> {
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  const dispatch = opts.dispatchImpl ?? defaultDispatch;
  const now = opts.nowImpl ?? Date.now;
  const geminiUrl = GEMINI_BASE + (opts.model ?? DEFAULT_MODEL) + ":generateContent";

  const contents: GeminiContent[] = [...clientMessages];
  const usedTools: string[] = [];
  const startedAt = now();

  for (let iter = 0; iter < MAX_TOOL_ITERS; iter++) {
    // guardrail de timeout: checa no topo, antes de chamar o Gemini
    if (now() - startedAt > TURN_DEADLINE_MS) {
      return {
        reply: "Demorei demais para responder. Tente reformular de forma mais específica.",
        usedTools,
        fallback: true,
      };
    }

    let res: Response;
    try {
      res = await doFetch(geminiUrl, {
        method: "POST",
        headers: { "x-goog-api-key": gkey, "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
          tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
          toolConfig: { functionCallingConfig: { mode: "AUTO" } },
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 1200,
            // ⚠️ 2.5-PRO: thinkingBudget NUNCA 0 (HTTP 400). -1 = dinâmico.
            thinkingConfig: { thinkingBudget: -1 },
          },
        }),
      });
    } catch {
      console.error("nexo-chat: gemini fetch failed (network)");
      return { reply: "Não consegui consultar a IA agora.", usedTools, fallback: true };
    }

    if (!res.ok) {
      console.error("nexo-chat: gemini status=" + res.status);
      return { reply: "Não consegui consultar a IA agora.", usedTools, fallback: true };
    }

    const gj = await res.json();
    const parts: GeminiPart[] = gj?.candidates?.[0]?.content?.parts ?? [];
    const fnCalls = parts
      .filter((p) => p.functionCall)
      .map((p) => p.functionCall!) as Array<{ name: string; args?: Record<string, unknown> }>;

    // sem functionCall → resposta final (texto)
    if (fnCalls.length === 0) {
      const text = parts
        .filter((p) => p.text)
        .map((p) => p.text)
        .join("")
        .trim();
      return { reply: text || "Sem resposta.", usedTools, fallback: !text };
    }

    // 1) append do turn 'model' com os functionCall (protocolo Gemini)
    contents.push({ role: "model", parts: fnCalls.map((fc) => ({ functionCall: fc })) });

    // 2) executa cada tool ESCOPADA por org/mlUserIds do servidor (args do modelo só p/ datas)
    const responseParts: GeminiPart[] = [];
    for (const fc of fnCalls) {
      usedTools.push(fc.name);
      const result = await dispatch(sb, orgId, mlUserIds, fc.name, fc.args ?? {});
      responseParts.push({ functionResponse: { name: fc.name, response: { content: result } } });
    }

    // 3) append do turn 'user' com os functionResponse → próxima iteração
    contents.push({ role: "user", parts: responseParts });
  }

  // estourou o cap=5 sem texto final → fallback (não roda além do cap)
  return {
    reply: "Reuni bastante dado, mas não fechei a análise. Pergunte de forma mais específica.",
    usedTools,
    fallback: true,
  };
}
