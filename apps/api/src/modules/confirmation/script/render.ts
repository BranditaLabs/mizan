import { CURRENCY_AR, type Money } from "@mizan/shared";
import type { MessageFacts, OfferFacts } from "../messages.js";
import { KEY_SPEC, VARIABLE, type Pack, type Script, type ScriptKey, type Variable } from "./catalogue.js";
import { GREETING, NAMELESS, PACK_TEXTS } from "./packs.js";

/** "1,250 ج.م." / "1,250 ر.س" / "EGP 1,250": plain text (no direction marks, Western digits). */
export function money(m: Money, lang: "ar" | "en"): string {
  const [int = "0", frac = ""] = m.amount.replace(/^-/, "").split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const n = /^0*$/.test(frac) ? grouped : `${grouped}.${frac}`;
  if (lang === "en") return `${m.currency} ${n}`;
  return `${n} ${CURRENCY_AR[m.currency] ?? m.currency}`;
}

/** "طرحة مطابقة بـ 135 ج.م. بدل 150 ج.م." / "a matching scarf for EGP 135 instead of EGP 150". */
export function offerLine(o: OfferFacts, lang: "ar" | "en"): string {
  const qty = o.qty > 1 ? ` × ${o.qty}` : "";
  if (lang === "ar") return `${o.title}${qty} بـ ${money(o.price, lang)}${o.was ? ` بدل ${money(o.was, lang)}` : ""}`;
  return `${o.title}${qty} for ${money(o.price, lang)}${o.was ? ` instead of ${money(o.was, lang)}` : ""}`;
}

export const packOf = (script: Script | undefined): Pack => script?.pack ?? "egyptian";

/**
 * The wording for one key: the owner's, else the pack's. Null only for a composed key the pack
 * leaves to code (`call` in Egyptian) and for an optional part nobody wrote (header, footer…).
 */
export function scriptText(script: Script | undefined, lang: "ar" | "en", key: ScriptKey): string | null {
  return script?.texts[lang]?.[key] ?? PACK_TEXTS[packOf(script)][lang][key] ?? null;
}

const graphemes = (s: string) => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)].map((g) => g.segment);
/** At most `n` graphemes (a first name can be a company's name). */
const firstGraphemes = (s: string, n: number) => graphemes(s).slice(0, n).join("");

const due = (f: MessageFacts) => (Number(f.cod.amount) > 0 ? f.cod : f.total);
export const firstName = (f: MessageFacts) => (f.firstName ? firstGraphemes(f.firstName, 20) : null);
export const greeting = (f: MessageFacts) => GREETING[packOf(f.script)][f.lang](firstName(f));
/** " عند الاستلام" when the courier collects, else nothing. */
export const payNote = (f: MessageFacts) => (Number(f.cod.amount) > 0 ? ` ${scriptText(f.script, f.lang, "on_delivery")}` : "");

/** The items as one line; `width` shortens each title, 0 leaves only a count ("+3"). */
function itemsText(f: MessageFacts, width?: number): string {
  const items = f.items ?? [];
  if (width === 0) return items.length ? `+${items.length}` : "";
  const cut = (t: string) => (width && t.length > width ? `${firstGraphemes(t, width - 1)}…` : t);
  return items.map((i) => (f.lang === "ar" ? `${cut(i.title)} × ${i.quantity}` : `${i.quantity} × ${cut(i.title)}`)).join(f.lang === "ar" ? "، " : ", ");
}

export interface RenderOptions {
  /** Values only some messages have (the summary's amount and count). */
  extra?: Partial<Record<Variable, string>>;
  itemsWidth?: number;
}

/**
 * Fill the variables from the order, in one pass (a value is never scanned again). A value that
 * ends with "." swallows the text's next "." ("1,250 ج.م." then "." is one full stop).
 */
export function render(text: string, f: MessageFacts, o: RenderOptions = {}): string {
  const ar = f.lang === "ar";
  const offer = f.offer;
  const values: Record<Variable, string> = {
    "customer.first_name": firstName(f) ?? NAMELESS[packOf(f.script)][f.lang],
    "customer.greeting": greeting(f),
    "order.number": f.number, "order.total": money(f.total, f.lang), "order.due": money(due(f), f.lang),
    "order.cod": `${money(due(f), f.lang)}${payNote(f)}`,
    "order.items": itemsText(f, o.itemsWidth), "order.city": f.city ?? "", "store.name": f.store,
    "offer.title": offer?.title ?? "", "offer.line": offer ? offerLine(offer, f.lang) : "", "offer.new_total": offer ? money(offer.newTotal, f.lang) : "",
    "summary.due": "", "summary.more": "", link: f.link, start_keyword: ar ? "«ابدأ»" : "START",
    ...o.extra,
  };
  return text.replace(VARIABLE, (whole: string, name: string, at: number, all: string) => {
    if (!(name in values)) return whole;
    const v = values[name as Variable];
    return v.endsWith(".") && all[at + whole.length] === "." ? v.slice(0, -1) : v;
  }).replace(/[ \t]+\n/g, "\n").trim();
}

const URL_RE = /(?:https?:\/\/|www\.)\S+/gi;

/** Cut to `limit` (UTF-16, never less than Meta's code-point count) on a grapheme, never inside a link, with "…". */
function cut(text: string, limit: number): string {
  const urls = [...text.matchAll(URL_RE)].map((m) => [m.index, m.index + m[0].length] as const);
  let out = "";
  for (const g of graphemes(text)) {
    if (out.length + g.length > limit - 1) break;
    out += g;
  }
  const inside = urls.find(([a, b]) => out.length > a && out.length < b);
  if (inside) out = out.slice(0, inside[0]);
  return `${out.trimEnd()}…`;
}

/**
 * The safety net at render time: a text that fits is kept; otherwise the pack's (known to fit);
 * otherwise cut. Never empty or only spaces.
 */
export function fit(text: string, limit: number, fallback?: string | null): string {
  if (text.trim() && text.length <= limit) return text;
  if (fallback?.trim() && fallback.length <= limit) return fallback;
  const base = text.trim() ? text : fallback?.trim() ? fallback : "…";
  return base.length <= limit ? base : cut(base, limit);
}

/**
 * One key, filled and fitted to its limit: the items are shortened first, then the pack's text
 * is used, then the text is cut. Null for an optional part nobody wrote, and with `ownOrNull`
 * for an owner text that does not fit (the caller has its own fallback).
 */
export function say(f: MessageFacts, key: ScriptKey, o: { extra?: RenderOptions["extra"]; ownerOnly?: boolean; ownOrNull?: boolean; limit?: number } = {}): string | null {
  const limit = o.limit ?? KEY_SPEC[key].limit;
  const own = o.ownerOnly ? f.script?.texts[f.lang]?.[key] ?? null : scriptText(f.script, f.lang, key);
  if (own == null) return null;
  const pack = PACK_TEXTS[packOf(f.script)][f.lang][key] ?? null;
  const attempt = (t: string) => {
    let r = "";
    for (const itemsWidth of [undefined, 80, 40, 24, 0]) {
      r = render(t, f, { extra: o.extra, itemsWidth });
      if (r.trim() && r.length <= limit) return { r, fits: true };
      if (!t.includes("order.items")) break;
    }
    return { r, fits: false };
  };
  const first = attempt(own);
  if (first.fits) return first.r;
  if (o.ownOrNull) return null;
  const second = pack !== null && pack !== own ? attempt(pack) : null;
  if (second?.fits) return second.r;
  return fit(first.r, limit, second?.r);
}

/** Meta refuses a template parameter with a new line, a tab or more than three spaces in a row. */
export const templateParam = (v: string) => v.replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim();
