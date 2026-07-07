/**
 * ml-claim-attachment — user-invoked edge function (proxy de download)
 * verify_jwt = true (user JWT required via Supabase Auth)
 *
 * Baixa o binário de um anexo de reclamação do ML usando o access_token do
 * vendedor (o endpoint de download do ML exige Bearer — NÃO é URL pública) e
 * devolve `{ ok, data_base64, content_type, filename }`. O front monta a data
 * URI a partir disso (um `<img src>` direto não pode mandar Authorization).
 *
 * Gates (mesma ordem exata das EFs irmãs ml-claim-detail / reply-ml-claim):
 *   1) JWT do usuário (Bearer)            -> 401
 *   2) supabase.auth.getUser(token)       -> 401
 *   3) validação do body (zod)            -> 400
 *   4) token por ml_user_id em ml_tokens  -> 404
 *   5) organization_id ausente            -> 403
 *   6) is_org_member (anti-IDOR, ATTACH-03/T-92-01) fail-closed -> 403
 * Só DEPOIS do gate qualquer chamada ao ML é feita.
 *
 * Segurança:
 *   - T-92-02 / T-42-04: access_token NUNCA é logado nem retornado. Logs de erro
 *     só com claim_id / ml_user_id / status.
 *   - T-92-03: attachment_id entra no PATH da URL do ML — validado por regex
 *     `[A-Za-z0-9._-]+` (rejeita `/` e `..`) para impedir path traversal/injeção.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
// std@0.168.0 exporta `encode`/`decode` (renomeado para encodeBase64 só em versões
// mais novas); importar com alias mantém o nome legível sem quebrar o boot.
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const ML_API = "https://api.mercadolibre.com";

// Guarda de tamanho: fotos de claim são pequenas; acima disso não inflamos um
// base64 gigante na resposta JSON (evita blowup de memória/response-size na EF).
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // ~5 MB

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// attachment_id vai direto no PATH da URL do ML — só caracteres seguros de nome
// de anexo (uuid + `_` + item_id + extensão). Rejeita `/` e qualquer `..` (T-92-03).
const ATTACHMENT_ID_RE = /^[A-Za-z0-9._-]+$/;

const BodySchema = z.object({
  claim_id:   z.string().min(1),
  ml_user_id: z.string().min(1),
  attachment_id: z
    .string()
    .min(1)
    .regex(ATTACHMENT_ID_RE, "attachment_id inválido")
    .refine((v) => !v.includes(".."), "attachment_id inválido"),
});

async function mlGetJson(url: string, token: string): Promise<any | null> {
  const res = await fetch(url, { headers: { Authorization: "Bearer " + token, "api-version": "2" } });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // 1. JWT do usuário
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) return jsonResponse({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    // 2. Body (zod) — attachment_id validado defensivamente (T-92-03)
    let rawBody: unknown;
    try { rawBody = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON body" }, 400); }
    const parsed = BodySchema.safeParse(rawBody);
    if (!parsed.success) return jsonResponse({ error: "Validation error", details: parsed.error.flatten() }, 400);
    const { claim_id, ml_user_id, attachment_id } = parsed.data;

    // 3. Token por ml_user_id
    const { data: tokenRow } = await supabase
      .from("ml_tokens").select("access_token, organization_id")
      .eq("ml_user_id", ml_user_id).not("access_token", "is", null).limit(1).maybeSingle();
    if (!tokenRow?.access_token) return jsonResponse({ error: "No ML token found for ml_user_id" }, 404);

    // 4. Org membership (anti-IDOR, ATTACH-03 / T-92-01) — fail CLOSED antes de
    //    qualquer chamada ao ML. Idêntico a ml-claim-detail / reply-ml-claim.
    if (!tokenRow.organization_id) return jsonResponse({ error: "Forbidden" }, 403);
    const { data: isMember } = await supabase.rpc("is_org_member", { _user_id: userId, _org_id: tokenRow.organization_id });
    if (!isMember) return jsonResponse({ error: "Forbidden" }, 403);

    const at = tokenRow.access_token;

    // 5. Download do binário com o token do vendedor (Bearer + api-version:2).
    const downloadUrl = `${ML_API}/post-purchase/v1/claims/${claim_id}/attachments/${attachment_id}/download`;
    const res = await fetch(downloadUrl, { headers: { Authorization: "Bearer " + at, "api-version": "2" } });
    if (!res.ok) {
      // Não vazar corpo sensível; log só com claim_id/ml_user_id/status.
      console.error("ml-claim-attachment: ML download status=" + res.status + " claim_id=" + claim_id + " ml_user_id=" + ml_user_id);
      return jsonResponse({ error: "ML attachment download failed", ml_status: res.status }, res.status >= 500 ? 502 : res.status);
    }

    // Guarda de tamanho ANTES de inflar base64 — primeiro pelo Content-Length,
    // depois pelo byteLength real (Content-Length pode faltar/mentir).
    const contentLength = Number(res.headers.get("content-length") ?? "0");
    const filenameFallback = attachment_id;
    if (contentLength > MAX_ATTACHMENT_BYTES) {
      return jsonResponse({ error: "Attachment too large to preview", too_large: true, filename: filenameFallback }, 413);
    }

    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_ATTACHMENT_BYTES) {
      return jsonResponse({ error: "Attachment too large to preview", too_large: true, filename: filenameFallback }, 413);
    }

    const data_base64 = encodeBase64(buf);
    const content_type = res.headers.get("content-type") ?? "application/octet-stream";

    // 6. Metadata best-effort para o filename (se falhar, usa o attachment_id).
    let filename = filenameFallback;
    const meta = await mlGetJson(`${ML_API}/post-purchase/v1/claims/${claim_id}/attachments/${attachment_id}`, at);
    if (meta) filename = meta.original_filename ?? meta.filename ?? filenameFallback;

    return jsonResponse({ ok: true, data_base64, content_type, filename });
  } catch (err) {
    console.error("ml-claim-attachment error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
