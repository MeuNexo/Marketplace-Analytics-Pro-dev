import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Hook lazy de download de anexo de reclamação (Phase 92-02).
 *
 * Invoca a EF proxy `ml-claim-attachment` (JWT automático via supabase.functions.invoke,
 * mesmo padrão de `useMLClaimDetail`), que baixa o binário do ML com o token do
 * vendedor e devolve `{ data_base64, content_type, filename }`. Aqui montamos a
 * data URI (`data:{type};base64,{data}`) — um `<img src>` direto não pode mandar
 * o header Authorization que o endpoint do ML exige.
 *
 * - Cache por `attachment_id` (binário imutável) com staleTime alto.
 * - `enabled` controla a busca lazy: imagens buscam eager (enabled=true ao montar);
 *   arquivos só buscam sob demanda (enabled=false → chamar `refetch()` no clique).
 * - Trata o caso `too_large`/413 (anexo grande demais p/ preview) → `tooLarge: true`.
 */

export interface ClaimAttachmentData {
  dataUri: string | null;
  contentType: string | null;
  filename: string | null;
  tooLarge: boolean;
}

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

export function useClaimAttachment(
  claimId: string | null,
  mlUserId: string | null,
  attachmentId: string | null,
  enabled: boolean,
) {
  const query = useQuery<ClaimAttachmentData>({
    queryKey: ["ml-claim-attachment", attachmentId],
    enabled: enabled && !!claimId && !!mlUserId && !!attachmentId,
    staleTime: 5 * 60_000, // binário imutável — cachear por 5min
    gcTime: 5 * 60_000,
    retry: false, // não repetir 403/413 — falha é semântica, não transitória
    queryFn: async (): Promise<ClaimAttachmentData> => {
      const { data, error } = await supabase.functions.invoke("ml-claim-attachment", {
        body: { claim_id: claimId, ml_user_id: mlUserId, attachment_id: attachmentId },
      });
      if (error) {
        // 413 → anexo grande demais p/ preview: estado dedicado, não erro cru.
        const body = await parseFunctionErrorBody(error);
        if (body?.too_large) {
          return {
            dataUri: null,
            contentType: null,
            filename: typeof body.filename === "string" ? body.filename : null,
            tooLarge: true,
          };
        }
        throw error;
      }
      if (data?.error) throw new Error(data.error);
      const contentType: string = data?.content_type ?? "application/octet-stream";
      const base64: string = data?.data_base64 ?? "";
      return {
        dataUri: `data:${contentType};base64,${base64}`,
        contentType,
        filename: data?.filename ?? null,
        tooLarge: false,
      };
    },
  });

  return {
    dataUri: query.data?.dataUri ?? null,
    contentType: query.data?.contentType ?? null,
    filename: query.data?.filename ?? null,
    tooLarge: query.data?.tooLarge ?? false,
    isLoading: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}
