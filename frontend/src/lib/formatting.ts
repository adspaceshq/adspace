// A small, safe subset of Markdown for user text (descriptions, support messages). It parses into
// plain data that components render as React elements: no HTML is ever produced from user input, and
// links only go to http(s) addresses. Text without any markup reads exactly as typed.
//
// Supported: **bold**, *italic* or _italic_, `code`, [label](https://...), bare https:// links,
// "- " or "* " bullet lists, "1. " numbered lists, blank lines between paragraphs.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; children: Inline[] }
  | { kind: "italic"; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: Inline[] };

export type Block =
  | { kind: "paragraph"; lines: Inline[][] }
  | { kind: "bullets"; items: Inline[][] }
  | { kind: "numbers"; items: Inline[][] };

const SAFE_URL = /^https?:\/\/[^\s<>"']+$/i;
export const safeUrl = (value: string) => (SAFE_URL.test(value) ? value : null);

const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBER = /^\s*\d{1,3}[.)]\s+(.*)$/;

export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { kind: "bullets" | "numbers"; items: string[] } | null = null;
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", lines: paragraph.map(parseInline) });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: list.kind, items: list.items.map(parseInline) });
    list = null;
  };
  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    const bullet = BULLET.exec(line);
    const number = bullet ? null : NUMBER.exec(line);
    if (bullet || number) {
      flushParagraph();
      const kind = bullet ? "bullets" : "numbers";
      if (list && list.kind !== kind) flushList();
      if (!list) list = { kind, items: [] };
      list.items.push((bullet ?? number)![1]);
    } else if (line.trim() === "") {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

// Inline markup, left to right. Unclosed markers stay as literal text.
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push({ kind: "text", text: buffer });
    buffer = "";
  };
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    // [label](https://...)
    const link = /^\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/i.exec(rest);
    if (link && safeUrl(link[2])) {
      flush();
      out.push({ kind: "link", href: link[2], children: parseInline(link[1]) });
      i += link[0].length;
      continue;
    }
    // bare https://... (trailing punctuation stays outside the link)
    const bare = /^https?:\/\/[^\s<>"']+/i.exec(rest);
    if (bare && (i === 0 || /[\s(]/.test(text[i - 1]))) {
      const url = bare[0].replace(/[.,;:!?)]+$/, "");
      flush();
      out.push({ kind: "link", href: url, children: [{ kind: "text", text: url }] });
      i += url.length;
      continue;
    }
    const code = /^`([^`\n]{1,200})`/.exec(rest);
    if (code) {
      flush();
      out.push({ kind: "code", text: code[1] });
      i += code[0].length;
      continue;
    }
    const bold = /^\*\*(?=\S)([^\n]*?\S)\*\*/.exec(rest);
    if (bold) {
      flush();
      out.push({ kind: "bold", children: parseInline(bold[1]) });
      i += bold[0].length;
      continue;
    }
    // *italic* or _italic_ (an underscore inside a word, as in snake_case, is not markup)
    const italic = /^([*_])(?=\S)([^\n*_]*?\S)\1/.exec(rest);
    if (italic && !(italic[1] === "_" && i > 0 && /\w/.test(text[i - 1]))) {
      flush();
      out.push({ kind: "italic", children: parseInline(italic[2]) });
      i += italic[0].length;
      continue;
    }
    buffer += text[i];
    i += 1;
  }
  flush();
  return out;
}

// What a toolbar button does to the selected text in a textarea.
export type FormatAction = "bold" | "italic" | "bullets" | "numbers" | "link";

export interface Edit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

// Applies a formatting action to text and its selection, returning the new text and selection.
export function applyFormat(value: string, start: number, end: number, action: FormatAction): Edit {
  const selected = value.slice(start, end);
  const wrap = (marker: string, placeholder: string) => {
    const inner = selected || placeholder;
    const next = value.slice(0, start) + marker + inner + marker + value.slice(end);
    return { value: next, selectionStart: start + marker.length, selectionEnd: start + marker.length + inner.length };
  };
  if (action === "bold") return wrap("**", "bold text");
  if (action === "italic") return wrap("*", "italic text");
  if (action === "link") {
    const label = selected || "link text";
    const inserted = `[${label}](https://)`;
    const next = value.slice(0, start) + inserted + value.slice(end);
    // Select the address so it can be typed over straight away.
    const urlStart = start + label.length + 3;
    return { value: next, selectionStart: urlStart, selectionEnd: urlStart + "https://".length };
  }
  // Lists: prefix every selected line (or the current line).
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = value.indexOf("\n", end) === -1 ? value.length : value.indexOf("\n", end);
  const lines = value.slice(lineStart, lineEnd).split("\n");
  const prefixed = lines.map((line, index) => {
    const bare = line.replace(BULLET, "$1").replace(NUMBER, "$1");
    return `${action === "bullets" ? "- " : `${index + 1}. `}${bare}`;
  });
  const block = prefixed.join("\n");
  const next = value.slice(0, lineStart) + block + value.slice(lineEnd);
  return { value: next, selectionStart: lineStart + block.length, selectionEnd: lineStart + block.length };
}
