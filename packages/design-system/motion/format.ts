/**
 * Figures for the brand components: Latin digits in every locale (Mizan's rule for numbers, also in
 * Arabic), the true minus sign U+2212, and the store's currency from the caller (never a hard-coded
 * EGP). Callers wrap the result in <bdi> with the mz-figure class (Geist Mono).
 */
export const MINUS = "−";
const BIDI = /[‎‏؜]/g;

const cache = new Map<string, Intl.NumberFormat>();
function nf(locale: string, opts: Intl.NumberFormatOptions) {
  const key = `${locale}|${JSON.stringify(opts)}`;
  let f = cache.get(key);
  if (!f) { f = new Intl.NumberFormat(locale, { numberingSystem: "latn", ...opts }); cache.set(key, f); }
  return f;
}

/** Parts joined back with U+2212 for the minus and without bidi marks (the caller isolates with <bdi>). */
const join = (parts: Intl.NumberFormatPart[]) => parts.map((p) => (p.type === "minusSign" ? MINUS : p.value)).join("").replace(BIDI, "").trim();

// Decimal strings are formatted exactly (Intl accepts them); numbers are only for geometry.
type Num = number | string;
const asIntl = (n: Num) => n as unknown as number;

export function formatInt(n: Num, locale: string) {
  return join(nf(locale, { maximumFractionDigits: 0 }).formatToParts(asIntl(n)));
}

/** Money from a decimal string ("1150.00") in the store's currency, placed the way the locale places it. */
export function formatMoney(decimal: Num, currency: string, locale: string, opts: { fractionDigits?: number } = {}) {
  const f = nf(locale, { style: "currency", currency, ...(opts.fractionDigits != null ? { minimumFractionDigits: opts.fractionDigits, maximumFractionDigits: opts.fractionDigits } : {}) });
  return join(f.formatToParts(asIntl(decimal)));
}

/** A percentage of `n` (1.3 → "1.3%"), with `dp` decimals. */
export function formatPct(n: Num, locale: string, dp = 1) {
  return join(nf(locale, { style: "percent", minimumFractionDigits: dp, maximumFractionDigits: dp }).formatToParts(Number(n) / 100));
}

/** Degrees with a sign (the gauge's tilt). */
export function formatDeg(n: number, locale: string, dp = 1) {
  return `${join(nf(locale, { minimumFractionDigits: dp, maximumFractionDigits: dp, signDisplay: "exceptZero" }).formatToParts(n))}°`;
}
