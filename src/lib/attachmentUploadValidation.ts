/**
 * Lib pura de validação de upload de anexo de reclamação (Phase 93-02).
 *
 * Estas constantes ESPELHAM a EF `ml-claim-attachment-upload`, que é a
 * AUTORIDADE de validação (valida de novo no servidor antes de subir ao ML).
 * Aqui o objetivo é apenas feedback rápido no cliente — o front nunca é a
 * barreira de segurança (ver threat model T-93-07). Limites do ML (LOCKED):
 * JPG/PNG/PDF, ≤ 5 MB, nome ≤ 125 chars e só caracteres seguros [a-zA-Z0-9_.-].
 */

export const ALLOWED_UPLOAD_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
export const FILENAME_MAX_CHARS = 125;

const FILENAME_SAFE_RE = /^[a-zA-Z0-9_.-]+$/;

type AllowedType = (typeof ALLOWED_UPLOAD_TYPES)[number];

/**
 * Valida um arquivo escolhido pelo usuário antes de subir à EF.
 *
 * Verifica, nesta ordem: nome não-vazio, nome ≤ 125 chars casando a regra de
 * chars seguros, tipo ∈ ALLOWED_UPLOAD_TYPES, e size ≤ MAX_UPLOAD_BYTES.
 * Retorna `{ ok: true }` ou `{ ok: false, error }` com mensagem PT-BR curta.
 */
export function validateUploadFile(file: {
  name: string;
  type: string;
  size: number;
}): { ok: true } | { ok: false; error: string } {
  const name = file.name ?? "";
  if (name.length === 0) {
    return { ok: false, error: "Nome de arquivo inválido" };
  }
  if (name.length > FILENAME_MAX_CHARS) {
    return { ok: false, error: `Nome de arquivo muito longo — máximo ${FILENAME_MAX_CHARS} caracteres` };
  }
  if (!FILENAME_SAFE_RE.test(name)) {
    return { ok: false, error: "Nome de arquivo inválido — use apenas letras, números, ponto, hífen ou underscore" };
  }
  if (!(ALLOWED_UPLOAD_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, error: "Formato não suportado — use JPG, PNG ou PDF" };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "Arquivo acima de 5 MB" };
  }
  return { ok: true };
}

export type { AllowedType };
