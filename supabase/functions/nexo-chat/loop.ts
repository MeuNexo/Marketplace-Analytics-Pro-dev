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
export const MAX_TOOL_ITERS = 8;
export const TURN_DEADLINE_MS = 75_000;
/**
 * Teto de saída do turno. ⚠️ No Gemini 2.5 os *thinking tokens contam dentro de
 * maxOutputTokens*. Com teto baixo + thinkingBudget dinâmico (-1), uma pergunta
 * multi-domínio queima o orçamento raciocinando e o candidato volta SEM parts
 * (finishReason MAX_TOKENS) → caía no fallback "Sem resposta.".
 */
export const MAX_OUTPUT_TOKENS = 8192;
/** Fatia reservada ao raciocínio. 2.5-pro aceita 128..32768 — NUNCA 0 (HTTP 400). */
export const THINKING_BUDGET = 2048;

export type GeminiPart = {
  text?: string;
  /**
   * true quando a part é RACIOCÍNIO INTERNO do modelo (thought summary), não resposta.
   * Nunca pode ser concatenada ao reply: vaza o raciocínio (em inglês) para o usuário.
   */
  thought?: boolean;
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
    ctx?: { userJwt?: string; userId?: string; conversationId?: string },
  ) => Promise<unknown>;
  /** relógio injetável (default Date.now) — força timeout no teste. */
  nowImpl?: () => number;
  /** modelo Gemini (default gemini-2.5-pro). */
  model?: string;
  /**
   * JWT real do usuário — extraído em index.ts de `Authorization: Bearer <token>`.
   * Repassado ao dispatcher para tools que invocam EFs que exigem JWT do usuário
   * (ex.: get_reputation → ml-reputation). NUNCA logado, NUNCA exposto ao modelo.
   */
  userJwt?: string;
  /** Phase 106: id do usuário (dono da conversa) — usado por propose_memory. */
  userId?: string;
  /** Phase 106: conversa corrente — vira source_conversation_id da proposta de memória. */
  conversationId?: string;
};

/**
 * stripThinking — rede de segurança contra rascunho de raciocínio vazando no reply.
 *
 * Em 2026-07-29 uma resposta chegou ao usuário começando com a linha literal "thought"
 * seguida de ~9 KB de raciocínio EM INGLÊS ("Here's a thinking process to construct the
 * response...") antes da resposta real em português. A causa primária é tratada com
 * `includeThoughts:false` + filtro de `part.thought`; esta função é a 2ª camada, para o
 * caso de o próprio modelo EMITIR o rascunho como texto normal.
 *
 * Corta do início até o último marcador de fim de rascunho conhecido. Se não achar um
 * corte seguro, devolve o texto original (nunca engole a resposta).
 */
export function stripThinking(text: string): string {
  if (!/^\s*thought\b/i.test(text)) return text;

  // o rascunho é enumerado/estruturado em inglês; a resposta real começa depois do
  // último separador de seção. Procuramos, do fim para o início, o começo plausível.
  const marcadores = [/\n---\n/g, /\n#{2,3} /g, /\n\*\*[A-ZÀ-Ú]/g];
  for (const re of marcadores) {
    const posicoes = [...text.matchAll(re)].map((m) => m.index ?? -1).filter((i) => i >= 0);
    // pega o PRIMEIRO marcador que esteja depois do preâmbulo em inglês
    const corte = posicoes.find((i) => i > 200);
    if (corte !== undefined) {
      const resto = text.slice(corte).trim();
      if (resto.length > 120) return resto;
    }
  }
  return text;
}

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
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            // ⚠️ 2.5-PRO: thinkingBudget NUNCA 0 (HTTP 400). Teto FIXO (não -1):
            // thinking divide o mesmo orçamento de maxOutputTokens, e o dinâmico
            // consumia tudo em pergunta complexa → candidato sem parts.
            // includeThoughts:false — NUNCA devolver o resumo do raciocínio. Em 29/07 o
            // thinking (em inglês) vazou inteiro para a resposta do usuário.
            thinkingConfig: { thinkingBudget: THINKING_BUDGET, includeThoughts: false },
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

    // observabilidade do turno: SÓ metadados (nunca conteúdo, JWT ou api key).
    // finishReason=MAX_TOKENS com parts vazio = thinking comeu o orçamento de saída.
    const finishReason: string = gj?.candidates?.[0]?.finishReason ?? "none";
    const um = gj?.usageMetadata ?? {};
    console.log(
      `nexo-chat: iter=${iter} finish=${finishReason} promptTok=${um.promptTokenCount ?? 0} ` +
        `outTok=${um.candidatesTokenCount ?? 0} thoughtTok=${um.thoughtsTokenCount ?? 0} ` +
        `totalTok=${um.totalTokenCount ?? 0}`,
    );

    const parts: GeminiPart[] = gj?.candidates?.[0]?.content?.parts ?? [];
    if (parts.length === 0) {
      // candidato sem texto E sem functionCall — causa do fallback "Sem resposta."
      console.error(`nexo-chat: candidato SEM parts (finish=${finishReason}) iter=${iter}`);
    }
    const fnCalls = parts
      .filter((p) => p.functionCall)
      .map((p) => p.functionCall!) as Array<{ name: string; args?: Record<string, unknown> }>;

    // sem functionCall → resposta final (texto)
    if (fnCalls.length === 0) {
      // ⚠️ p.thought === true é RACIOCÍNIO INTERNO, não resposta. Concatená-lo vazava
      // o raciocínio (em inglês) para o usuário — bug encontrado em 2026-07-29.
      const thoughtParts = parts.filter((p) => p.thought === true).length;
      if (thoughtParts > 0) {
        console.warn(`nexo-chat: ${thoughtParts} thought-part(s) descartada(s) do reply`);
      }
      const text = stripThinking(
        parts
          .filter((p) => p.text && p.thought !== true)
          .map((p) => p.text)
          .join("")
          .trim(),
      );
      return { reply: text || "Sem resposta.", usedTools, fallback: !text };
    }

    // 1) append do turn 'model' com os functionCall (protocolo Gemini)
    contents.push({ role: "model", parts: fnCalls.map((fc) => ({ functionCall: fc })) });

    // 2) executa cada tool ESCOPADA por org/mlUserIds do servidor (args do modelo só p/ datas)
    // userJwt (de opts) trafega ao dispatcher para tools que invocam EFs com JWT do usuário
    const responseParts: GeminiPart[] = [];
    for (const fc of fnCalls) {
      usedTools.push(fc.name);
      const result = await dispatch(sb, orgId, mlUserIds, fc.name, fc.args ?? {}, {
        userJwt: opts.userJwt,
        userId: opts.userId,
        conversationId: opts.conversationId,
      });
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
