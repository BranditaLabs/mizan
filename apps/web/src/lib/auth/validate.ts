import { normalizePhone, PHONE_COUNTRIES, toAsciiDigits, type PhoneCountry } from "@mizan/shared";

/**
 * Client checks of the screens before a store, "reward early, punish late": a required field is
 * only flagged on submit, a format on blur (when something was typed) or submit, and an error
 * clears as soon as the value is right. Sign-in never hints at the password rule (enumeration).
 */
export type FieldError =
  | "requiredEmail" | "invalidEmail" | "requiredPassword" | "passwordShort" | "requiredPhone" | "invalidPhone" | "codeIncomplete";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PASSWORD_MIN = 8;

export function checkEmail(v: string, when: "blur" | "submit"): FieldError | null {
  const s = v.trim();
  if (!s) return when === "submit" ? "requiredEmail" : null;
  return EMAIL.test(s) ? null : "invalidEmail";
}

/** Sign-in: non-empty only. A new password: 8 characters or more. */
export function checkPassword(v: string, when: "blur" | "submit", isNew: boolean): FieldError | null {
  if (!v) return when === "submit" ? "requiredPassword" : null;
  return isNew && v.length < PASSWORD_MIN ? "passwordShort" : null;
}

export function checkPhone(v: string, country: PhoneCountry, when: "blur" | "submit"): FieldError | null {
  if (!v.trim()) return when === "submit" ? "requiredPhone" : null;
  return normalizePhone(v, country) ? null : "invalidPhone";
}

export function checkCode(v: string, length = 6): FieldError | null {
  return v.length === length ? null : "codeIncomplete";
}

/* ───────────── Email typo suggestion ───────────── */

const DOMAINS = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com"];

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length]![b.length]!;
}

/** "ahmed@gmial.com" → "ahmed@gmail.com"; null when the domain is fine or nothing is close. */
export function emailSuggestion(v: string): string | null {
  const s = v.trim().toLowerCase();
  const at = s.lastIndexOf("@");
  if (at < 1) return null;
  const domain = s.slice(at + 1);
  if (!domain || DOMAINS.includes(domain)) return null;
  let best: { d: string; n: number } | null = null;
  for (const d of DOMAINS) {
    const n = distance(domain, d);
    if (n <= 2 && (!best || n < best.n)) best = { d, n };
  }
  return best ? `${v.trim().slice(0, at)}@${best.d}` : null;
}

/* ───────────── Phone ───────────── */

export const PHONE_DIAL: Record<PhoneCountry, string> = { EG: "20", SA: "966", AE: "971" };
/** What a mobile number looks like in each country, for the placeholder and the error. */
export const PHONE_PLACEHOLDER: Record<PhoneCountry, string> = { EG: "10 0123 4821", SA: "50 123 4567", AE: "50 123 4567" };
export const PHONE_EXAMPLE: Record<PhoneCountry, string> = { EG: "01001234821", SA: "0501234567", AE: "0501234567" };

/**
 * A paste or autofill that starts with "+" or "00" and a supported dial code switches the country
 * and keeps the rest: "+966 50 123 4567" → SA, "50 123 4567". Anything else is left as it is.
 */
export function phoneFromPaste(raw: string): { country: PhoneCountry; rest: string } | null {
  const s = toAsciiDigits(raw).trim().replace(/[\s\-().]/g, "");
  const m = /^(?:\+|00)(\d+)$/.exec(s);
  if (!m) return null;
  const digits = m[1]!;
  for (const c of PHONE_COUNTRIES) {
    const dial = PHONE_DIAL[c];
    if (digits.startsWith(dial)) return { country: c, rest: digits.slice(dial.length).replace(/^0/, "") };
  }
  return null;
}

/** "1001234821" (EG) → "10 0123 4821": the display regroup on blur (never while typing). */
export function groupPhone(v: string, country: PhoneCountry): string {
  const p = normalizePhone(v, country);
  if (!p || p.country !== country) return v;
  const nsn = p.e164.slice(1 + PHONE_DIAL[country].length);
  return country === "EG" ? `${nsn.slice(0, 2)} ${nsn.slice(2, 6)} ${nsn.slice(6)}` : `${nsn.slice(0, 2)} ${nsn.slice(2, 5)} ${nsn.slice(5)}`;
}

/** The default country from the browser's region (ar-SA → SA, en-AE → AE), else Egypt. */
export function countryFromLanguages(langs: readonly string[] | undefined): PhoneCountry {
  for (const l of langs ?? []) {
    const region = l.split("-")[1]?.toUpperCase();
    if (region === "SA" || region === "AE" || region === "EG") return region;
  }
  return "EG";
}

/** The last 4 digits, for "the number ending in 4821" (never the whole number on screen twice). */
export const lastFour = (phone: string) => phone.replace(/\D/g, "").slice(-4);
