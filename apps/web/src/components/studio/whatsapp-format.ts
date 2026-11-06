/**
 * WhatsApp's message formatting, read the way the app reads it, into a small tree the phone turns
 * into React nodes (never HTML): *bold*, _italic_, ~strike~, ```monospace```, line breaks and links.
 *
 * The rules WhatsApp follows: a marker opens only at the start, after a space or punctuation, and
 * right before a non-space; it closes on the same line, right after a non-space, before the end, a
 * space or punctuation. Monospace is literal inside. Markers that never close stay as typed.
 */
export type WaNode =
  | { type: "text"; text: string }
  | { type: "bold" | "italic" | "strike"; children: WaNode[] }
  | { type: "mono"; text: string }
  | { type: "link"; href: string; text: string }
  | { type: "br" };

const MARKS: Record<string, "bold" | "italic" | "strike"> = { "*": "bold", _: "italic", "~": "strike" };
const WORD = /[\p{L}\p{N}]/u;
const SPACE = /\s/u;
const URL = /\b(?:https?:\/\/|www\.)[^\s<>]+/giu;
const TRAILING = /[.,!?;:'")\]*_~،؟]+$/u;

const isOpenBoundary = (prev: string | undefined) => prev === undefined || SPACE.test(prev) || !WORD.test(prev);
const isCloseBoundary = (next: string | undefined) => next === undefined || SPACE.test(next) || !WORD.test(next);

/** Links inside plain text. */
function linkify(text: string): WaNode[] {
  const out: WaNode[] = [];
  let at = 0;
  for (const m of text.matchAll(URL)) {
    let url = m[0];
    const trail = TRAILING.exec(url)?.[0] ?? "";
    url = url.slice(0, url.length - trail.length);
    if (!url) continue;
    const start = m.index!;
    if (start > at) out.push({ type: "text", text: text.slice(at, start) });
    out.push({ type: "link", href: /^https?:\/\//i.test(url) ? url : `https://${url}`, text: url });
    at = start + url.length;
  }
  if (at < text.length) out.push({ type: "text", text: text.slice(at) });
  return out;
}

/** Bold, italic and strike in one line (recursive: they nest), then links in the plain parts. */
function inline(line: string): WaNode[] {
  const out: WaNode[] = [];
  let plain = "";
  const flush = () => { if (plain) { out.push(...linkify(plain)); plain = ""; } };
  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;
    const kind = MARKS[ch];
    if (kind && isOpenBoundary(line[i - 1]) && line[i + 1] !== undefined && !SPACE.test(line[i + 1]!) && line[i + 1] !== ch) {
      let j = i + 2;
      let close = -1;
      while (j < line.length) {
        if (line[j] === ch && !SPACE.test(line[j - 1]!) && isCloseBoundary(line[j + 1])) { close = j; break; }
        j++;
      }
      if (close > i + 1) {
        flush();
        out.push({ type: kind, children: inline(line.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
    }
    plain += ch;
    i++;
  }
  flush();
  return out;
}

/** Merge neighbouring text nodes (the renderer's keys stay stable and the tree small). */
function merge(nodes: WaNode[]): WaNode[] {
  const out: WaNode[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (n.type === "text" && last?.type === "text") last.text += n.text;
    else if (n.type === "text" && !n.text) continue;
    else out.push(n);
  }
  return out;
}

/** The whole message: monospace blocks first (literal, may span lines), then each line. */
export function parseWhatsApp(text: string): WaNode[] {
  const out: WaNode[] = [];
  const parts = text.split(/(```[\s\S]+?```)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("```") && part.endsWith("```") && part.length > 6) {
      out.push({ type: "mono", text: part.slice(3, -3) });
      continue;
    }
    part.split("\n").forEach((line, i) => {
      if (i > 0) out.push({ type: "br" });
      out.push(...inline(line));
    });
  }
  return merge(out);
}

/** The plain text a tree shows (for labels and tests). */
export function plainText(nodes: readonly WaNode[]): string {
  return nodes.map((n) => (n.type === "text" || n.type === "mono" || n.type === "link" ? n.text : n.type === "br" ? "\n" : plainText(n.children))).join("");
}
