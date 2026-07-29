/**
 * helpers.ts — partes PURAS da transcrição (sem I/O, sem import remoto).
 *
 * Separado do index.ts pelo mesmo motivo do nexo-chat (prompt.ts/tools.ts): o index
 * importa o `serve` do Deno via URL e não carrega no vitest (Node). O que erra em
 * silêncio — validação de mime e conteúdo do prompt — mora aqui e é testado.
 */

/** ~8 MB de base64 ≈ 6 MB de áudio. Protege a EF e o custo por chamada. */
export const MAX_BASE64_LEN = 8_000_000;

export const MIMES_ACEITOS = [
  "audio/webm", "audio/webm;codecs=opus", "audio/ogg", "audio/ogg;codecs=opus",
  "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-m4a", "audio/aac",
];

/**
 * Glossário no prompt: sem isso a transcrição erra justamente os termos que mais
 * importam aqui (marca, sigla de margem, código de anúncio) — e nome ou número errado
 * numa pergunta de compra vira decisão errada.
 */
export const PROMPT_TRANSCRICAO = [
  "Transcreva o áudio em português do Brasil.",
  "Devolva APENAS a transcrição literal, sem comentários, sem aspas, sem rótulos e sem tradução.",
  "Se o áudio estiver vazio ou inaudível, devolva string vazia.",
  "Contexto do vocabulário (grafias corretas de termos que aparecem com frequência):",
  "Pralana, Mercado Livre, Mercado Pago, Tiny, SKU, MCO, ROAS, TACoS, ACoS, CMV, DRE, MLB,",
  "Full, fulfillment, lead time, ruptura, giro, cobertura, mico, anúncio, ordem de compra,",
  "Pé Vermeio, break-even, markup, ticket médio.",
  "Números de dinheiro devem sair como o falante disse (ex.: '47k', 'R$ 47 mil').",
].join(" ");

/** Extrai o mime base (sem parâmetros) para validar contra a lista. */
export function normalizarMime(mime: string): string {
  return (mime ?? "").split(";")[0].trim().toLowerCase();
}

export function mimeAceito(mime: string): boolean {
  const base = normalizarMime(mime);
  if (!base) return false;
  return MIMES_ACEITOS.some((m) => normalizarMime(m) === base);
}
