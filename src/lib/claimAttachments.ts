/**
 * Lib pura de anexos de reclamação (Phase 92-02).
 *
 * - `normalizeClaimAttachments` normaliza o `message.attachments` de uma mensagem
 *   de reclamação em uma forma estável `{ id, filename, type }[]`. Belt-and-suspenders
 *   defensivo: o backend (EF ml-claim-detail) já normaliza, mas toleramos aqui item
 *   string OU objeto (o shape exato do ML foi confirmado em runtime; ser robusto
 *   evita quebrar o thread se o shape variar).
 * - `isImageAttachment` decide imagem-vs-arquivo por MIME type (`image/*`) com
 *   fallback pela extensão do filename — usado pelo componente ClaimAttachment
 *   (imagem → miniatura+zoom ATTACH-01 / não-imagem → botão Baixar ATTACH-02).
 */

export type ClaimAttachmentMeta = {
  id: string;
  filename: string | null;
  type: string | null;
};

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp", "heic"];

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Normaliza `raw` (esperado: array de itens string ou objeto) em uma lista estável.
 * - undefined/null/não-array → []
 * - item string → { id: s, filename: s, type: null }
 * - item objeto → resolve id a partir de id/attachment_id/filename; preserva filename/type
 * - itens sem id resolvível são descartados.
 */
export function normalizeClaimAttachments(raw: unknown): ClaimAttachmentMeta[] {
  if (!Array.isArray(raw)) return [];
  const out: ClaimAttachmentMeta[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const id = asString(item);
      if (id) out.push({ id, filename: id, type: null });
      continue;
    }
    if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      const filename = asString(rec.filename) ?? asString(rec.original_filename);
      const id = asString(rec.id) ?? asString(rec.attachment_id) ?? filename;
      if (id) out.push({ id, filename: filename ?? null, type: asString(rec.type) });
    }
  }
  return out;
}

/**
 * True se o anexo é uma imagem: `type` começa com `image/`, ou (fallback) a
 * extensão do filename é de imagem (jpg/jpeg/png/gif/webp/heic, case-insensitive).
 */
export function isImageAttachment(a: { type?: string | null; filename?: string | null }): boolean {
  const type = a.type;
  if (typeof type === "string" && type.toLowerCase().startsWith("image/")) return true;
  const filename = a.filename;
  if (typeof filename === "string") {
    const dot = filename.lastIndexOf(".");
    if (dot >= 0) {
      const ext = filename.slice(dot + 1).toLowerCase();
      if (IMAGE_EXTENSIONS.includes(ext)) return true;
    }
  }
  return false;
}
