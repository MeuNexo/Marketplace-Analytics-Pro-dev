/**
 * capitalizeName.ts — normaliza `buyer.first_name` do ML (Phase 90 Plan 02,
 * T-90-02: nome do comprador em ml-claim-detail).
 *
 * Módulo PURO: nenhum import `https://` nem referência a `Deno.*`, para ser
 * importável tanto pelas edge functions Deno (import relativo) quanto pelo
 * vitest (node). NÃO faz nenhuma chamada de rede/IO.
 *
 * O valor de `buyer.first_name` retornado pela API do ML costuma vir todo em
 * maiúsculas (ex.: "ISADELLE"). Capitalizamos cada palavra (primeira letra
 * maiúscula, resto minúscula) para exibição — ex.: "ISADELLE" -> "Isadelle",
 * "MARIA DA SILVA" -> "Maria Da Silva".
 *
 * Entrada ausente/vazia/não-string -> null (o frontend mapeia null -> "cliente").
 */
export function capitalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  return trimmed
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
