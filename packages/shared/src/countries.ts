import type { PhoneCountry } from "./phone.js";

/**
 * Countries a store can be created in, with the defaults a new tenant gets
 * (docs/01: Egypt at launch, then KSA and the GCC; Levant and Maghreb later).
 */
export interface CountryDefaults {
  currency: string;
  timezone: string;
  locale: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekStartsOn: 0 | 1 | 6;
  /** Default country for reading local phone numbers, where supported. */
  phoneCountry?: PhoneCountry;
  name: { en: string; ar: string };
}

export const COUNTRY_DEFAULTS = {
  EG: { currency: "EGP", timezone: "Africa/Cairo", locale: "ar-EG", weekStartsOn: 6, phoneCountry: "EG", name: { en: "Egypt", ar: "مصر" } },
  SA: { currency: "SAR", timezone: "Asia/Riyadh", locale: "ar-SA", weekStartsOn: 0, phoneCountry: "SA", name: { en: "Saudi Arabia", ar: "السعودية" } },
  AE: { currency: "AED", timezone: "Asia/Dubai", locale: "ar-AE", weekStartsOn: 1, phoneCountry: "AE", name: { en: "United Arab Emirates", ar: "الإمارات" } },
  KW: { currency: "KWD", timezone: "Asia/Kuwait", locale: "ar-KW", weekStartsOn: 0, name: { en: "Kuwait", ar: "الكويت" } },
  QA: { currency: "QAR", timezone: "Asia/Qatar", locale: "ar-QA", weekStartsOn: 0, name: { en: "Qatar", ar: "قطر" } },
  BH: { currency: "BHD", timezone: "Asia/Bahrain", locale: "ar-BH", weekStartsOn: 0, name: { en: "Bahrain", ar: "البحرين" } },
  OM: { currency: "OMR", timezone: "Asia/Muscat", locale: "ar-OM", weekStartsOn: 0, name: { en: "Oman", ar: "عُمان" } },
  JO: { currency: "JOD", timezone: "Asia/Amman", locale: "ar-JO", weekStartsOn: 0, name: { en: "Jordan", ar: "الأردن" } },
  MA: { currency: "MAD", timezone: "Africa/Casablanca", locale: "ar-MA", weekStartsOn: 1, name: { en: "Morocco", ar: "المغرب" } },
} as const satisfies Record<string, CountryDefaults>;

export type CountryCode = keyof typeof COUNTRY_DEFAULTS;
export const COUNTRY_CODES = Object.keys(COUNTRY_DEFAULTS) as CountryCode[];

export function isCountryCode(value: string): value is CountryCode {
  return Object.hasOwn(COUNTRY_DEFAULTS, value);
}
