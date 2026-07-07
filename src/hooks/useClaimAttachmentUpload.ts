import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { validateUploadFile, sanitizeFilename } from "@/lib/attachmentUploadValidation";

/**
 * Hook de upload de anexo de reclamação (Phase 93-02).
 *
 * `uploadFile` valida o arquivo no cliente (feedback rápido via
 * `validateUploadFile` — a autoridade é a EF) e sobe via `FormData` à EF
 * `ml-claim-attachment-upload` (`verify_jwt=true`, gate anti-IDOR no Plano 01),
 * que faz o POST multipart ao ML e devolve `{ filename }`. Esse filename é
 * depois passado ao `reply-ml-claim` como `attachments`.
 *
 * - `formData.append("file", file, file.name)` (3 argumentos) preserva o nome
 *   REAL do arquivo (em vez de "blob") — o ML aplica a regra de nome ≤125/safe
 *   sobre esse nome. NÃO setamos Content-Type manualmente (o browser define o
 *   boundary do multipart).
 * - Erro da EF: extraímos a mensagem PT-BR do corpo da Response (padrão de
 *   `useClaimAttachment`: FunctionsHttpError expõe a Response em `.context`).
 */

async function parseFunctionErrorBody(error: unknown): Promise<Record<string, unknown> | null> {
  // supabase-js FunctionsHttpError expõe a Response original em `.context`.
  const ctx = (error as { context?: unknown })?.context;
  if (ctx && typeof (ctx as Response).json === "function") {
    try {
      return (await (ctx as Response).json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

export function useClaimAttachmentUpload() {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploadFile = useCallback(
    async (file: File, claimId: string, mlUserId: string): Promise<{ filename: string }> => {
      // Validação no cliente (feedback rápido) — não chama a EF se inválido.
      const check = validateUploadFile({ name: file.name, type: file.type, size: file.size });
      if (!check.ok) {
        throw new Error(check.error);
      }

      setIsUploading(true);
      setError(null);
      try {
        const formData = new FormData();
        // 3-arg append define o nome que o ML recebe. Higienizamos (espaço/acento
        // → seguro) para não barrar fotos de celular/WhatsApp; a EF re-higieniza
        // por garantia. Preserva a extensão.
        const safeName = sanitizeFilename(file.name);
        formData.append("file", file, safeName);
        formData.append("claim_id", claimId);
        formData.append("ml_user_id", mlUserId);

        // NÃO setar Content-Type manualmente — o browser define o boundary.
        const { data, error: fnError } = await supabase.functions.invoke("ml-claim-attachment-upload", {
          body: formData,
        });

        if (fnError) {
          const body = await parseFunctionErrorBody(fnError);
          const msg = typeof body?.error === "string" ? body.error : fnError.message;
          throw new Error(msg || "Falha ao enviar o anexo");
        }
        if (data?.error) throw new Error(String(data.error));

        const filename = data?.filename;
        if (typeof filename !== "string" || filename.length === 0) {
          throw new Error("O Mercado Livre não retornou o nome do anexo enviado");
        }
        return { filename };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Falha ao enviar o anexo";
        setError(msg);
        throw e instanceof Error ? e : new Error(msg);
      } finally {
        setIsUploading(false);
      }
    },
    [],
  );

  return { uploadFile, isUploading, error };
}
