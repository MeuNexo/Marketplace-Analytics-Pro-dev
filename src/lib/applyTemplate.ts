/**
 * Pure variable substitution for "mensagens rápidas" templates.
 *
 * Replaces every {{key}} token in `body` with the matching value from `vars`.
 * A token whose key is not present in `vars` (missing or undefined) is left
 * literal — it is never dropped and never rendered as "undefined". This
 * lets the caller decide fallbacks (e.g. pass nome: "cliente" instead of
 * relying on this function to invent a default).
 */
export function applyTemplate(body: string, vars?: Record<string, string>): string {
  if (!body) return "";
  if (!vars) return body;

  return body.replace(/\{\{(\w+)\}\}/g, (token, key: string) => {
    const value = vars[key];
    return value !== undefined ? value : token;
  });
}
