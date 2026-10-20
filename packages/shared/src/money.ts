import type { Money } from "./model.js";

/**
 * Money helpers.
 *
 * The canonical model carries money as decimal strings ("1150.00"); the
 * database stores integer minor units (BIGINT) next to a currency code.
 * These helpers are the only bridge between the two. They use string and
 * bigint arithmetic only, never floats, and they refuse to round: an amount
 * with more precision than its currency allows is an error, not a guess.
 */

/**
 * ISO 4217 minor-unit exponents that differ from 2. Every other valid code
 * has 2 decimals (EGP, SAR, AED, QAR, MAD, USD, EUR …).
 */
const NON_DEFAULT_DECIMALS: Readonly<Record<string, number>> = {
  // 3 decimals: Gulf, Levant, Maghreb
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
  // 0 decimals
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0,
  RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  // 4 decimals
  CLF: 4, UYW: 4,
};

const CURRENCY_CODE = /^[A-Z]{3}$/;
const DECIMAL = /^[-+]?(\d+)(?:\.(\d+))?$/;

export function isCurrencyCode(code: string): boolean {
  return CURRENCY_CODE.test(code);
}

/** Number of minor-unit digits for an ISO 4217 code: EGP → 2, KWD → 3, JPY → 0. */
export function currencyDecimals(currency: string): number {
  const code = currency.trim().toUpperCase();
  if (!isCurrencyCode(code)) throw new RangeError(`not an ISO 4217 currency code: "${currency}"`);
  return NON_DEFAULT_DECIMALS[code] ?? 2;
}

/** True for decimal strings such as "1150", "1150.5", "-12.345" (no separators). */
export function isDecimalAmount(amount: string): boolean {
  return DECIMAL.test(amount);
}

/**
 * Decimal string → integer minor units.
 * `toMinor("1150.5", "EGP")` → `115050n`; `toMinor({ amount: "12.345", currency: "KWD" })` → `12345n`.
 * Thousands separators are accepted ("1,150.00"). Extra trailing zeros are fine
 * ("10.500" EGP); extra non-zero precision throws ("10.505" EGP).
 */
export function toMinor(money: Money): bigint;
export function toMinor(amount: string, currency: string): bigint;
export function toMinor(a: Money | string, c?: string): bigint {
  const { amount, currency } = typeof a === "string" ? { amount: a, currency: c ?? "" } : a;
  const decimals = currencyDecimals(currency);
  const clean = amount.trim().replace(/,/g, "");
  const m = DECIMAL.exec(clean);
  if (!m) throw new RangeError(`not a decimal amount: "${amount}"`);
  const [, int, frac = ""] = m;
  const extra = frac.slice(decimals);
  if (/[1-9]/.test(extra)) {
    throw new RangeError(`amount "${amount}" has more than ${decimals} decimals for ${currency.toUpperCase()}`);
  }
  const value = BigInt(int + frac.slice(0, decimals).padEnd(decimals, "0"));
  return clean.startsWith("-") ? -value : value;
}

/** Integer minor units → canonical Money. `fromMinor(115050n, "EGP")` → `{ amount: "1150.50", currency: "EGP" }`. */
export function fromMinor(minor: bigint | number, currency: string): Money {
  if (typeof minor === "number" && !Number.isSafeInteger(minor)) {
    throw new RangeError(`minor units must be a safe integer, got ${minor}`);
  }
  const code = currency.trim().toUpperCase();
  const decimals = currencyDecimals(code);
  const v = BigInt(minor);
  const neg = v < 0n;
  const digits = (neg ? -v : v).toString().padStart(decimals + 1, "0");
  const amount = decimals ? `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}` : digits;
  return { amount: neg ? `-${amount}` : amount, currency: code };
}

function sameCurrency(a: Money, b: Money): string {
  const ca = a.currency.trim().toUpperCase();
  const cb = b.currency.trim().toUpperCase();
  if (ca !== cb) throw new RangeError(`currency mismatch: ${ca} vs ${cb}`);
  return ca;
}

export function addMoney(a: Money, b: Money): Money {
  const cur = sameCurrency(a, b);
  return fromMinor(toMinor(a) + toMinor(b), cur);
}

export function subtractMoney(a: Money, b: Money): Money {
  const cur = sameCurrency(a, b);
  return fromMinor(toMinor(a) - toMinor(b), cur);
}

/** Sum of amounts in one currency; an empty list is zero in `currency`. */
export function sumMoney(items: readonly Money[], currency: string): Money {
  const zero = fromMinor(0n, currency);
  return items.reduce((acc, m) => addMoney(acc, m), zero);
}

/** -1, 0 or 1. */
export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  sameCurrency(a, b);
  const d = toMinor(a) - toMinor(b);
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}

export function isZeroMoney(m: Money): boolean {
  return toMinor(m) === 0n;
}
