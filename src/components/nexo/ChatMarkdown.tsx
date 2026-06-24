import { Fragment, type ReactNode } from "react";

/**
 * ChatMarkdown — renderizador de um SUBCONJUNTO seguro de markdown para o chat do Nexo.
 *
 * Anti-XSS (T-57-13): NÃO usa dangerouslySetInnerHTML nem renderer de HTML cru. Tudo
 * vira nós React (texto escapado pelo próprio React). Cobre só o que o Nexo emite:
 * **negrito**, ***negrito-itálico***, *itálico* / _itálico_, `código`, listas (- / •
 * / 1.) e parágrafos. Qualquer outra sintaxe cai como texto normal.
 */

// inline: ***bi***, **b**, `code`, *i*, _i_ — ordem importa (mais longo primeiro)
const INLINE = /(\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*|_([^_]+)_)/g;

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) out.push(<Fragment key={k++}>{text.slice(last, m.index)}</Fragment>);
    if (m[2] !== undefined) {
      out.push(<strong key={k++} className="font-semibold"><em>{m[2]}</em></strong>);
    } else if (m[3] !== undefined) {
      out.push(<strong key={k++} className="font-semibold">{m[3]}</strong>);
    } else if (m[4] !== undefined) {
      out.push(
        <code key={k++} className="rounded bg-foreground/10 px-1 py-0.5 text-[0.85em] font-mono">
          {m[4]}
        </code>,
      );
    } else if (m[5] !== undefined) {
      out.push(<em key={k++}>{m[5]}</em>);
    } else if (m[6] !== undefined) {
      out.push(<em key={k++}>{m[6]}</em>);
    }
    last = INLINE.lastIndex;
  }
  if (last < text.length) out.push(<Fragment key={k++}>{text.slice(last)}</Fragment>);
  return out;
}

type Block =
  | { type: "p"; text: string }
  | { type: "h"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] };

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (list) {
      blocks.push(list.ordered ? { type: "ol", items: list.items } : { type: "ul", items: list.items });
      list = null;
    }
  };

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) { flush(); continue; }

    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^#{1,6}\s+(.*)$/.exec(line);

    if (bullet) {
      if (!list || list.ordered) { flush(); list = { ordered: false, items: [] }; }
      list.items.push(bullet[1]);
    } else if (numbered) {
      if (!list || !list.ordered) { flush(); list = { ordered: true, items: [] }; }
      list.items.push(numbered[1]);
    } else if (heading) {
      flush();
      blocks.push({ type: "h", text: heading[1] });
    } else {
      flush();
      blocks.push({ type: "p", text: line });
    }
  }
  flush();
  return blocks;
}

export function ChatMarkdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="flex flex-col gap-1.5">
      {blocks.map((b, i) => {
        if (b.type === "h") {
          return <p key={i} className="font-semibold">{renderInline(b.text)}</p>;
        }
        if (b.type === "ul") {
          return (
            <ul key={i} className="list-disc space-y-0.5 pl-4">
              {b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
            </ul>
          );
        }
        if (b.type === "ol") {
          return (
            <ol key={i} className="list-decimal space-y-0.5 pl-4">
              {b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
            </ol>
          );
        }
        return <p key={i}>{renderInline(b.text)}</p>;
      })}
    </div>
  );
}
