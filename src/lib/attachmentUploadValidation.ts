/**
 * Lib pura de validação + higienização de nome de anexo de reclamação (Phase 93-02,
 * fix 93-03: nome de arquivo com espaço/acento não deve mais barrar o upload).
 *
 * Regras do ML (LOCKED, via MCP oficial): JPG/PNG/PDF, ≤ 5 MB, nome ≤ 125 chars
 * e só caracteres seguros `[a-zA-Z0-9_.-]`.
 *
 * DECISÃO (fix): o nome do arquivo NÃO é motivo de rejeição — nós controlamos o
 * nome enviado ao ML, então o **higienizamos** (`sanitizeFilename`) em vez de
 * recusar a foto. Fotos de celular/WhatsApp/print quase sempre têm espaço ou
 * acento no nome; recusá-las travava o envio. A validação (`validateUploadFile`)
 * agora só checa TIPO e TAMANHO — as duas coisas que o usuário realmente precisa
 * corrigir. A EF `ml-claim-attachment-upload` continua sendo a autoridade e
 * espelha exatamente estas regras (higieniza + valida tipo/tamanho no servidor).
 */

export const ALLOWED_UPLOAD_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
export const FILENAME_MAX_CHARS = 125;

type AllowedType = (typeof ALLOWED_UPLOAD_TYPES)[number];

/**
 * Converte QUALQUER nome de arquivo num nome aceito pelo ML (`[a-zA-Z0-9_.-]`,
 * ≤ 125 chars), preservando a extensão. Remove acentos (NFD), troca qualquer
 * caractere inseguro (espaço, parêntese, etc.) por `_`, colapsa `_` repetidos e
 * apara separadores das pontas. Nome vazio → "arquivo". Trunca a 125 mantendo a
 * extensão. É idempotente (higienizar duas vezes dá o mesmo resultado).
 */
export function sanitizeFilename(rawName: string): string {
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

/**
 * Valida um arquivo escolhido pelo usuário antes de subir à EF. Checa apenas
 * TIPO (∈ ALLOWED_UPLOAD_TYPES) e TAMANHO (≤ MAX_UPLOAD_BYTES) — o nome é
 * higienizado por `sanitizeFilename`, nunca rejeitado. Retorna `{ ok: true }`
 * ou `{ ok: false, error }` com mensagem PT-BR curta.
 */
export function validateUploadFile(file: {
  name: string;
  type: string;
  size: number;
}): { ok: true } | { ok: false; error: string } {
  if (!(ALLOWED_UPLOAD_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, error: "Formato não suportado — use JPG, PNG ou PDF (fotos de iPhone em HEIC não são aceitas pelo Mercado Livre)" };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "Arquivo acima de 5 MB" };
  }
  return { ok: true };
}

export type { AllowedType };
