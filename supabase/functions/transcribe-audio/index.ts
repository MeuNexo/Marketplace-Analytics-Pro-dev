/**
 * transcribe-audio — transcreve áudio ditado no chat do Nexo (quick 260729-r44).
 *
 * Por que existe: a Web Speech API do navegador falhou nas duas pontas do ambiente do
 * usuário — no desktop com `network` (o serviço de voz do Google está bloqueado na rede)
 * e no celular sem devolver resultado. Esta EF não depende de nenhuma das duas coisas.
 *
 * Fluxo: front grava com MediaRecorder → manda base64 → Gemini transcreve → texto volta
 * para o campo do chat, onde o usuário revisa antes de enviar.
 *
 * Segurança (mesmo esqueleto da nexo-chat):
 *   auth por JWT do usuário → is_org_member (anti-IDOR) → GEMINI_API_KEY do vault.
 *   verify_jwt=true. Logs registram só metadados — nunca o áudio nem a transcrição.
 *
 * Custo: gemini-2.5-flash com thinkingBudget 0 (transcrição não precisa raciocinar).
 * ~R$0,01/min de áudio.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MAX_BASE64_LEN, PROMPT_TRANSCRICAO, normalizarMime, mimeAceito } from "./helpers.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const j = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, key);

  try {
    const body = await req.json().catch(() => ({}));
    const orgId: string | undefined = body.org_id;
    const audioBase64: string | undefined = body.audio_base64;
    const mimeType: string = body.mime_type ?? "audio/webm";

    // ── auth: JWT do usuário + membership na org (anti-IDOR) ────────────────
    const auth = req.headers.get("authorization");
    if (!auth?.startsWith("Bearer ")) return j({ error: "Unauthorized" }, 401);
    const { data: u, error: ue } = await sb.auth.getUser(auth.replace("Bearer ", ""));
    if (ue || !u?.user) return j({ error: "Unauthorized" }, 401);
    if (!orgId) return j({ error: "org_id required" }, 400);
    const { data: member } = await sb.rpc("is_org_member", { _user_id: u.user.id, _org_id: orgId });
    if (!member) return j({ error: "Forbidden" }, 403);

    // ── validação do áudio ──────────────────────────────────────────────────
    if (!audioBase64 || typeof audioBase64 !== "string") {
      return j({ error: "audio_base64 required" }, 400);
    }
    if (audioBase64.length > MAX_BASE64_LEN) {
      return j({ error: "audio_too_large", limite_mb: 6 }, 413);
    }
    if (!mimeAceito(mimeType)) {
      return j({ error: "unsupported_mime", recebido: normalizarMime(mimeType) }, 415);
    }

    // ── vault: GEMINI_API_KEY (nunca env hardcoded) ─────────────────────────
    const gkey = await sb.rpc("get_app_secret", { p_name: "GEMINI_API_KEY" }).then((r) => r.data);
    if (!gkey) return j({ error: "gemini_key_missing" }, 500);

    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "x-goog-api-key": gkey, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { inline_data: { mime_type: normalizarMime(mimeType), data: audioBase64 } },
            { text: PROMPT_TRANSCRICAO },
          ],
        }],
        generationConfig: {
          temperature: 0,          // transcrição é literal, não criativa
          maxOutputTokens: 2048,
          thinkingConfig: { thinkingBudget: 0 }, // flash aceita 0; transcrever não exige raciocínio
        },
      }),
    });

    if (!res.ok) {
      console.error("transcribe-audio: gemini status=" + res.status);
      return j({ error: "transcription_failed", status: res.status }, 502);
    }

    const gj = await res.json();
    const finishReason: string = gj?.candidates?.[0]?.finishReason ?? "none";
    const parts = (gj?.candidates?.[0]?.content?.parts ?? []) as Array<{ text?: string; thought?: boolean }>;
    const texto = parts
      .filter((p) => p.text && p.thought !== true)
      .map((p) => p.text)
      .join("")
      .trim();

    // só metadados no log — nunca o áudio, nunca a transcrição
    console.log(
      `transcribe-audio: finish=${finishReason} base64_len=${audioBase64.length} chars=${texto.length}`,
    );

    return j({ text: texto });
  } catch (e) {
    console.error("transcribe-audio error:", e instanceof Error ? e.message : "unknown");
    return j({ error: "Internal server error" }, 500);
  }
});
