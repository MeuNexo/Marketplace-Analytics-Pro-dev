/**
 * ml-claim-attachment-upload — user-invoked edge function (upload de anexo)
 * verify_jwt = true (user JWT required via Supabase Auth)
 *
 * Recebe um arquivo (foto/PDF) do front via `FormData` (o cliente usa
 * `supabase.functions.invoke` com body FormData), VALIDA no servidor
 * (autoridade) e só então sobe ao ML com o access_token do vendedor,
 * devolvendo o `{ filename }` gerado pelo ML. Esse filename é depois passado
 * ao `reply-ml-claim` no campo `attachments` para anexar à mensagem.
 *
 * Endpoint ML: POST /post-purchase/v1/claims/{claim_id}/attachments
 * (multipart/form-data, campo `file`). Resposta: { user_id, filename }.
 *
 * Gates (mesma ordem exata das EFs irmãs ml-claim-attachment / reply-ml-claim):
 *   1) JWT do usuário (Bearer)            -> 401
 *   2) supabase.auth.getUser(token)       -> 401
 *   3) validação do body (multipart)      -> 400
 *   4) token por ml_user_id em ml_tokens  -> 404
 *   5) organization_id ausente            -> 403
 *   6) is_org_member (anti-IDOR, SEND-ATT-01/T-93-01) fail-closed -> 403
 * Só DEPOIS do gate + validação server-side qualquer chamada ao ML é feita.
 *
 * Segurança:
 *   - T-93-01: gate anti-IDOR fail-closed ANTES de qualquer chamada ML.
 *   - T-93-02: validação server-side (autoridade) do arquivo ANTES do upload:
 *     content-type ∈ {image/jpeg,image/png,application/pdf}, tamanho ≤ 5MB,
 *     nome ≤ 125 chars e regex [a-zA-Z0-9_.-].
 *   - T-93-03: access_token NUNCA é logado nem retornado. Logs de erro só com
 *     claim_id / ml_user_id / status.
 *   - T-93-04: guarda de 5MB rejeita arquivo grande antes do POST ao ML.
 *   - T-93-05: claim_id entra no PATH da URL do ML — validado por regex
 *     `[A-Za-z0-9._-]+` (rejeita `/` e `..`) para impedir path traversal/injeção.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ML_API = "https://api.mercadolibre.com";

// Limites da API ML (LOCKED via MCP oficial). Espelham EXATAMENTE
// `src/lib/attachmentUploadValidation.ts` (Plano 02) — Deno não importa `src/lib`,
// então as constantes ficam inline aqui, mantidas em sincronia manualmente.
const ALLOWED_UPLOAD_TYPES = ["image/jpeg", "image/png", "application/pdf"];
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
const FILENAME_MAX_CHARS = 125;

// Higieniza QUALQUER nome de arquivo para o formato aceito pelo ML
// (`[a-zA-Z0-9_.-]`, ≤125, preserva extensão). Espelha src/lib/attachmentUploadValidation.ts.
// DECISÃO (fix 93-03): nome com espaço/acento não barra o upload — higieniza-se.
function sanitizeFilename(rawName: string): string {
  const name = (rawName ?? "").trim();
  const stripAccents = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const lastDot = name.lastIndexOf(".");
  const hasExt = lastDot > 0 && lastDot < name.length - 1;
  const rawBase = hasExt ? name.slice(0, lastDot) : name;
  const rawExt = hasExt ? name.slice(lastDot + 1) : "";
  let base = stripAccents(rawBase)
    .replace(/[^a-zA-Z0-9_.-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "");
  const ext = stripAccents(rawExt).replace(/[^a-zA-Z0-9]+/g, "").toLowerCase();
  if (!base) base = "arquivo";
  const extPart = ext ? `.${ext}` : "";
  let out = `${base}${extPart}`;
  if (out.length > FILENAME_MAX_CHARS) {
    const keep = Math.max(1, FILENAME_MAX_CHARS - extPart.length);
    out = `${base.slice(0, keep)}${extPart}`;
  }
  return out;
}

// claim_id vai direto no PATH da URL do ML — só caracteres seguros.
// Rejeita `/` e qualquer `..` (T-93-05).
const CLAIM_ID_RE = /^[A-Za-z0-9._-]+$/;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

    // 2. Body multipart (FormData) — extrai file + campos de texto.
    let form: FormData;
    try { form = await req.formData(); } catch { return jsonResponse({ error: "Invalid multipart body" }, 400); }

    const file = form.get("file");
    if (!(file instanceof Blob)) return jsonResponse({ error: "Invalid multipart body" }, 400);

    const claim_id = String(form.get("claim_id") ?? "");
    const ml_user_id = String(form.get("ml_user_id") ?? "");
    if (!claim_id || !ml_user_id) return jsonResponse({ error: "Validation error", details: "claim_id e ml_user_id são obrigatórios" }, 400);
    if (!CLAIM_ID_RE.test(claim_id) || claim_id.includes("..")) return jsonResponse({ error: "Validation error", details: "claim_id inválido" }, 400);

    // 3. Token por ml_user_id
    const { data: tokenRow } = await supabase
      .from("ml_tokens").select("access_token, organization_id")
      .eq("ml_user_id", ml_user_id).not("access_token", "is", null).limit(1).maybeSingle();
    if (!tokenRow?.access_token) return jsonResponse({ error: "No ML token found for ml_user_id" }, 404);

    // 4. Org membership (anti-IDOR, SEND-ATT-01 / T-93-01) — fail CLOSED antes de
    //    qualquer chamada ao ML. Idêntico a ml-claim-attachment / reply-ml-claim.
    if (!tokenRow.organization_id) return jsonResponse({ error: "Forbidden" }, 403);
    const { data: isMember } = await supabase.rpc("is_org_member", { _user_id: userId, _org_id: tokenRow.organization_id });
    if (!isMember) return jsonResponse({ error: "Forbidden" }, 403);

    // 5. Validação server-side do arquivo (autoridade — SEND-ATT-01/T-93-02),
    //    ANTES de subir ao ML. Estes limites espelham EXATAMENTE
    //    `src/lib/attachmentUploadValidation.ts` (Plano 02).
    // Só TIPO e TAMANHO barram. O nome é HIGIENIZADO (fix 93-03) — nunca rejeitado.
    if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
      return jsonResponse({ error: "Tipo de arquivo não permitido. Envie JPG, PNG ou PDF." }, 400);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return jsonResponse({ error: "Arquivo muito grande. O limite é 5 MB." }, 400);
    }
    const filename = sanitizeFilename(file instanceof File ? file.name : "");

    // 6. Só DEPOIS do gate + validação: monta multipart novo e sobe ao ML.
    //    `append` de 3 argumentos passa o filename REAL (não "blob") — o ML
    //    aplica a regra de nome ≤125/safe-chars sobre esse nome. NÃO setar
    //    Content-Type manualmente: o runtime injeta o boundary do multipart.
    const at = tokenRow.access_token;
    const uploadForm = new FormData();
    uploadForm.append("file", file, filename);

    const uploadUrl = `${ML_API}/post-purchase/v1/claims/${claim_id}/attachments`;
    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: { Authorization: "Bearer " + at, "api-version": "2" },
      body: uploadForm,
    });
    if (!res.ok) {
      // Não vazar corpo sensível nem token; log só com status/claim_id/ml_user_id.
      console.error("ml-claim-attachment-upload: ML upload status=" + res.status + " claim_id=" + claim_id + " ml_user_id=" + ml_user_id);
      return jsonResponse({ error: "ML attachment upload failed", ml_status: res.status }, res.status >= 500 ? 502 : res.status);
    }

    const body = await res.json().catch(() => null);
    const uploadedFilename = body?.filename;
    if (!uploadedFilename) {
      console.error("ml-claim-attachment-upload: ML resposta sem filename claim_id=" + claim_id + " ml_user_id=" + ml_user_id);
      return jsonResponse({ error: "ML attachment upload failed" }, 502);
    }

    return jsonResponse({ ok: true, filename: uploadedFilename });
  } catch (err) {
    console.error("ml-claim-attachment-upload error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
