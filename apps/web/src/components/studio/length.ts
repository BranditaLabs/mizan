/**
 * The studio's live counter, the same count the API checks a text with (apps/api
 * src/modules/confirmation/script/validate.ts `estimateLength`): each variable at its catalogue
 * width, the store's name at its real length when known (1 when not), anything else as typed
 * (UTF-16 code units, like the API, so the counter never says "fits" when saving would refuse).
 */
const VARIABLE = /\{\{\s*([a-z_.]+)\s*\}\}/g;

export type Widths = ReadonlyMap<string, number> | Readonly<Record<string, number>>;
const widthOf = (widths: Widths, name: string): number | undefined =>
  widths instanceof Map ? widths.get(name) : (widths as Record<string, number>)[name];

export function estimateLength(text: string, widths: Widths, storeName: string | null = null): number {
  return text.replace(VARIABLE, (whole: string, name: string) => {
    if (name === "store.name") return "x".repeat(storeName?.length ?? 1);
    const w = widthOf(widths, name);
    return w === undefined ? whole : "x".repeat(w);
  }).length;
}

/** The variable names a text uses, in order, each once (as the API reads them). */
export const variablesIn = (text: string): string[] => [...new Set([...text.matchAll(VARIABLE)].map((m) => m[1]!))];

/** Required variables the text leaves out. */
export const missingRequired = (text: string, required: readonly string[]): string[] => {
  const used = variablesIn(text);
  return required.filter((v) => !used.includes(v));
};

/** Variables the text uses that this key does not allow (unknown ones included). */
export const notAllowed = (text: string, allowed: readonly string[]): string[] => variablesIn(text).filter((v) => !allowed.includes(v));

export const token = (name: string) => `{{${name}}}`;

/**
 * Insert `text` into `value` over the selection [start, end), returning the new value and the caret
 * after the insert. A space is added before when the caret is right after a letter, so a dropped
 * chip never glues to a word.
 */
export function insertAt(value: string, text: string, start: number, end = start): { value: string; caret: number } {
  const s = Math.max(0, Math.min(start, value.length));
  const e = Math.max(s, Math.min(end, value.length));
  const before = value.slice(0, s);
  const pad = before && /[\p{L}\p{N}\p{M}]$/u.test(before) ? " " : "";
  const next = `${before}${pad}${text}${value.slice(e)}`;
  return { value: next, caret: s + pad.length + text.length };
}
