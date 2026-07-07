import { useState } from "react";
import { Download, ImageOff, Loader2, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { isImageAttachment, type ClaimAttachmentMeta } from "@/lib/claimAttachments";
import { useClaimAttachment } from "@/hooks/useClaimAttachment";

/**
 * Renderiza um anexo de mensagem de reclamação (Phase 92-02):
 *   - Imagem (ATTACH-01): busca eager via EF proxy, mostra miniatura clicável;
 *     clique abre zoom em Dialog (shadcn) com a imagem em tamanho maior.
 *   - Não-imagem (ATTACH-02): botão "Baixar" que só busca sob demanda; ao clicar,
 *     monta um Blob a partir da data URI e dispara download programático (a.download),
 *     revogando o object URL depois.
 * Cada anexo tem seu próprio estado de loading/erro — não quebra o thread.
 */

interface Props {
  attachment: ClaimAttachmentMeta;
  claimId: string;
  mlUserId: string;
}

export function ClaimAttachment({ attachment, claimId, mlUserId }: Props) {
  const isImage = isImageAttachment(attachment);
  const label = attachment.filename ?? attachment.id;

  return isImage ? (
    <ImageAttachment attachment={attachment} claimId={claimId} mlUserId={mlUserId} label={label} />
  ) : (
    <FileAttachment attachment={attachment} claimId={claimId} mlUserId={mlUserId} label={label} />
  );
}

// ─── Imagem (ATTACH-01): miniatura + zoom em Dialog ──────────────────────────
function ImageAttachment({
  attachment, claimId, mlUserId, label,
}: Props & { label: string }) {
  const [zoomOpen, setZoomOpen] = useState(false);
  // Eager: imagens de claim são pequenas — busca ao montar.
  const { dataUri, isLoading, error, tooLarge } = useClaimAttachment(
    claimId, mlUserId, attachment.id, true,
  );

  if (isLoading && !dataUri) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>Carregando imagem…</span>
      </div>
    );
  }

  if (tooLarge || error || !dataUri) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ImageOff className="w-3.5 h-3.5" />
        <span>{tooLarge ? "Imagem grande demais para exibir" : "Não foi possível carregar a imagem"}</span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setZoomOpen(true)}
        className="block rounded-lg border border-border overflow-hidden hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring"
        title={label}
      >
        <img src={dataUri} alt={label} className="max-h-40 max-w-full object-contain" />
      </button>
      <Dialog open={zoomOpen} onOpenChange={setZoomOpen}>
        <DialogContent className="max-w-3xl p-2">
          <img src={dataUri} alt={label} className="w-full h-auto max-h-[80vh] object-contain rounded" />
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Não-imagem (ATTACH-02): botão Baixar (blob → download programático) ──────
function FileAttachment({
  attachment, claimId, mlUserId, label,
}: Props & { label: string }) {
  const [downloading, setDownloading] = useState(false);
  const [failed, setFailed] = useState(false);
  // Lazy: arquivos só buscam ao clicar (enabled=false).
  const { refetch } = useClaimAttachment(claimId, mlUserId, attachment.id, false);

  async function handleDownload() {
    setDownloading(true);
    setFailed(false);
    try {
      const res = await refetch();
      const data = res.data;
      if (!data?.dataUri) {
        setFailed(true);
        return;
      }
      // data URI → Blob → object URL → download programático → revoke.
      const blob = await (await fetch(data.dataUri)).blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename ?? label;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setFailed(true);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col gap-0.5">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 text-xs justify-start gap-1.5 max-w-full"
        disabled={downloading}
        onClick={handleDownload}
      >
        {downloading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
        ) : (
          <Download className="w-3.5 h-3.5 shrink-0" />
        )}
        <Paperclip className="w-3 h-3 shrink-0 opacity-60" />
        <span className="truncate">{downloading ? "Baixando…" : label}</span>
      </Button>
      {failed && (
        <span className="text-[11px] text-destructive">Não foi possível baixar o anexo.</span>
      )}
    </div>
  );
}
