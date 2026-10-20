import { currencyDecimals, isDecimalAmount, type Money } from "@mizan/shared";

/**
 * Number, money and date formatting for both languages (docs/08 §3).
 * Western digits by default (merchants and couriers use them); Eastern Arabic digits are a store
 * setting. Money stays a decimal string end to end: Intl formats the string exactly, never a float.
 */
export type Digits = "latn" | "arab";

const tag = (locale: string) => (locale === "ar" ? "ar-EG" : "en-EG");

export function formatMoney(money: Money, locale: string, digits: Digits = "latn"): string {
  if (!isDecimalAmount(money.amount)) throw new Error(`not a decimal amount: ${money.amount}`);
  const decimals = currencyDecimals(money.currency);
  const f = new Intl.NumberFormat(tag(locale), {
    style: "currency", currency: money.currency, numberingSystem: digits,
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  });
  // Intl.NumberFormat accepts decimal strings exactly (ES2023); the cast keeps older lib typings happy.
  return f.format(money.amount as unknown as number);
}

export function formatNumber(value: number | bigint, locale: string, digits: Digits = "latn"): string {
  return new Intl.NumberFormat(tag(locale), { numberingSystem: digits }).format(value);
}

export function formatDate(date: Date | string, locale: string, digits: Digits = "latn", style: "short" | "medium" = "medium"): string {
  return new Intl.DateTimeFormat(tag(locale), { dateStyle: style, numberingSystem: digits, timeZone: "Africa/Cairo" }).format(new Date(date));
}

/** "منذ ٦ دقائق" / "6 minutes ago" — for queues and timelines. */
export function formatRelative(date: Date | string, locale: string, now = Date.now(), digits: Digits = "latn"): string {
  const s = Math.round((new Date(date).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(tag(locale), { numeric: "auto", numberingSystem: digits } as Intl.RelativeTimeFormatOptions);
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(s, "second");
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86_400), "day");
}

/** "14 minutes" / "3.5 hours" / "2 days" (time-to-first-value, durations people read). */
export function formatDuration(seconds: number, locale: string, digits: Digits = "latn"): string {
  const [value, unit] = seconds < 3600 ? [Math.max(1, Math.round(seconds / 60)), "minute"] as const
    : seconds < 86_400 ? [Math.round((seconds / 3600) * 10) / 10, "hour"] as const
    : [Math.round((seconds / 86_400) * 10) / 10, "day"] as const;
  return new Intl.NumberFormat(tag(locale), { style: "unit", unit, unitDisplay: "long", numberingSystem: digits, maximumFractionDigits: 1 }).format(value);
}
