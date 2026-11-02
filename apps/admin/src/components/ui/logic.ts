/**
 * Pure helpers behind the UI kit (unit-tested in test/ui-logic.test.ts): no React, no DOM.
 */

/** Join class names, skipping falsy parts. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Risk meter bands (components.md §4): < 40 low, 40–69 medium, ≥ 70 high. */
export function riskLevel(score: number): "low" | "med" | "high" {
  return score >= 70 ? "high" : score >= 40 ? "med" : "low";
}

/**
 * SVG path for a sparkline in a w×h box (1px padding so the stroke is not clipped). Flat series sit
 * in the middle; fewer than two points draw nothing.
 */
export function sparklinePath(values: readonly number[], w: number, h: number): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const step = (w - 2) / (values.length - 1);
  return values
    .map((v, i) => {
      const x = 1 + i * step;
      const y = span === 0 ? h / 2 : 1 + (h - 2) * (1 - (v - min) / span);
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

/**
 * A customer phone shown masked by default (personal data, docs/07): country code and the last four
 * digits, "+20 ••• 4821". Unknown shapes keep only the last four.
 */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  const last = digits.slice(-4);
  const cc = /^\+(20|966|971|965|974|973|968|962|212)/.exec(e164)?.[1];
  return cc ? `+${cc} ••• ${last}` : `••• ${last}`;
}

/** Up to two initials for an avatar, from the first and last words (works for Arabic names). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const first = [...words[0]!][0] ?? "";
  const last = words.length > 1 ? ([...words.at(-1)!][0] ?? "") : "";
  return (first + last).toLocaleUpperCase();
}

export type SortDir = "asc" | "desc";
export type SortValue = string | number | bigint | Date | null | undefined;

/**
 * Compare two sort values: numbers and dates numerically, strings with the language's collation
 * (Arabic and English sort correctly, digits inside text in numeric order). Empty values go last.
 */
export function compareValues(a: SortValue, b: SortValue, collator: Intl.Collator): number {
  const empty = (v: SortValue) => v === null || v === undefined || v === "";
  if (empty(a) || empty(b)) return empty(a) === empty(b) ? 0 : empty(a) ? 1 : -1;
  const num = (v: SortValue) => (v instanceof Date ? v.getTime() : typeof v === "bigint" ? Number(v) : v);
  const x = num(a);
  const y = num(b);
  if (typeof x === "number" && typeof y === "number") return x - y;
  return collator.compare(String(x), String(y));
}

/** Rows sorted by a column (stable); empty values stay last in both directions. */
export function sortRows<T>(rows: readonly T[], value: (row: T) => SortValue, dir: SortDir, locale: string): T[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  return rows
    .map((row, i) => ({ row, i, v: value(row) }))
    .sort((p, q) => {
      const emptyP = p.v === null || p.v === undefined || p.v === "";
      const emptyQ = q.v === null || q.v === undefined || q.v === "";
      if (emptyP !== emptyQ) return emptyP ? 1 : -1;
      const c = compareValues(p.v, q.v, collator);
      return (dir === "asc" ? c : -c) || p.i - q.i;
    })
    .map((x) => x.row);
}

/**
 * Keyboard movement in a horizontal list (tabs, segmented) or vertical list (menus, listboxes).
 * In right-to-left, ArrowRight moves to the previous item: arrows follow the screen, not the order.
 */
export function moveIndex(key: string, index: number, count: number, opts: { rtl?: boolean; orientation?: "horizontal" | "vertical" } = {}): number | null {
  if (count === 0) return null;
  const horizontal = (opts.orientation ?? "horizontal") === "horizontal";
  const forward = horizontal ? (opts.rtl ? "ArrowLeft" : "ArrowRight") : "ArrowDown";
  const back = horizontal ? (opts.rtl ? "ArrowRight" : "ArrowLeft") : "ArrowUp";
  if (key === forward) return (index + 1) % count;
  if (key === back) return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/** Filter options for a combobox or command palette: every word of the query must appear (case and digits folded). */
export function matches(text: string, query: string): boolean {
  const fold = (s: string) => s.toLocaleLowerCase().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
  const hay = fold(text);
  return fold(query).split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}
