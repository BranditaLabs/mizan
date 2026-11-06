import type { Money } from "./model.js";
import { CURRENCY_AR } from "./confirmation.js";
import { currencyDecimals, isDecimalAmount } from "./money.js";

/**
 * The one money format (docs/16 §1.2, FX-1): every screen of the app, the back office and the
 * landing shows an amount the same way, whatever the browser's Intl data says about symbols.
 *
 * - English: ISO code first, then the amount: "EGP 1,150.00", "USD 785.95" (never "US$" or "$").
 * - Arabic: the amount, then the currency's Arabic short name: "1,150.00 ج.م.", "785.95 دولار";
 *   a currency without one keeps its ISO code ("1,150.00 MAD").
 * - Digits are Western (`latn`) in both languages unless the store chose Eastern Arabic (`arab`).
 * - The amount stays a decimal string end to end (Intl formats the string exactly, never a float);
 *   it is shown with the currency's own decimals (KWD 3, JPY 0).
 * The space between code and amount is a no-break space, so the pair never wraps apart.
 *
 * Arabic carries the bidi marks Intl ar-EG put there (RLM … RLM, and an LRM before a leading minus):
 * the screens show money in `<bdi class="mz-num">`, which the design system forces LTR, and the
 * marks make the run resolve right to left inside it, so the amount sits on the right and an Arabic
 * reader meets it before the currency name.
 */
export type Digits = "latn" | "arab";

const NBSP = "\u00a0";
const RLM = "\u200f";
const LRM = "\u200e";

/**
 * Arabic short names, as Egyptian, Saudi and Gulf merchants write them: the same spelling as the
 * customer messages (CURRENCY_AR in confirmation.ts, "ج.م."), plus the other currencies stores sell in.
 */
export const MONEY_NAMES_AR: Readonly<Record<string, string>> = {
  ...CURRENCY_AR, JOD: "د.أ", USD: "دولار", EUR: "يورو", GBP: "جنيه إسترليني",
};

const numberFormats = new Map<string, Intl.NumberFormat>();
function numberFormat(decimals: number, digits: Digits): Intl.NumberFormat {
  const key = `${decimals}:${digits}`;
  let f = numberFormats.get(key);
  if (!f) {
    // Grouping "," and decimal "." with Western digits; the Arabic separators with Eastern digits.
    f = new Intl.NumberFormat(digits === "arab" ? "ar-EG" : "en-US", { numberingSystem: digits, minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    numberFormats.set(key, f);
  }
  return f;
}

/** The amount alone, grouped, with the currency's decimals ("1,150.00"). */
export function formatAmount(money: Money, digits: Digits = "latn"): string {
  if (!isDecimalAmount(money.amount)) throw new Error(`not a decimal amount: ${money.amount}`);
  const decimals = currencyDecimals(money.currency);
  // Intl.NumberFormat accepts decimal strings exactly (ES2023); the cast keeps older lib typings happy.
  return numberFormat(decimals, digits).format(money.amount as unknown as number);
}

/** "EGP 1,150.00" (en) / RLM "1,150.00 ج.م." RLM (ar, with its bidi marks). */
export function formatMoney(money: Money, locale: string, digits: Digits = "latn"): string {
  const code = money.currency.trim().toUpperCase();
  const amount = formatAmount({ amount: money.amount, currency: code }, digits);
  if (locale !== "ar") return `${code}${NBSP}${amount}`;
  const minus = /^[؜‎‏]*-/.test(amount) ? LRM : "";
  return `${RLM}${minus}${amount}${NBSP}${MONEY_NAMES_AR[code] ?? code}${RLM}`;
}
