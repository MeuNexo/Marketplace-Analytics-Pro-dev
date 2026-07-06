// Converte o HTML das mensagens de reclamação do ML em texto seguro para render
// (nunca usar dangerouslySetInnerHTML — T-42-08). Preserva quebras de parágrafo
// e decodifica as entidades comuns (incl. acentos PT-BR).

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  agrave: "à", atilde: "ã", otilde: "õ", ccedil: "ç", ntilde: "ñ",
  acirc: "â", ecirc: "ê", ocirc: "ô", uuml: "ü",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  Atilde: "Ã", Otilde: "Õ", Ccedil: "Ç", Acirc: "Â", Ecirc: "Ê", Ocirc: "Ô",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => (name in NAMED ? NAMED[name] : m));
}

export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return decodeEntities(
    html
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/\s*p\s*>/gi, "\n")
      .replace(/<[^>]+>/g, "")        // remove todas as demais tags
  )
    .replace(/\n{3,}/g, "\n\n")       // colapsa quebras excessivas
    .trim();
}
