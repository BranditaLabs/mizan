/**
 * Phone normalization for the launch markets (Egypt, Saudi Arabia, UAE).
 *
 * Customers type phones in every shape: "+20 100 123 4821", "00201001234821",
 * "01001234821", Arabic-Indic digits "٠١٠٠١٢٣٤٨٢١", a stray trunk zero after
 * the country code ("+20 0100…"). We accept all of them and return one E.164
 * form for storage and hashing, plus the national form couriers expect.
 *
 * Only mobile numbers are accepted: COD confirmation and delivery need a
 * number that can take a call or a WhatsApp message.
 */

export const PHONE_COUNTRIES = ["EG", "SA", "AE"] as const;
export type PhoneCountry = (typeof PHONE_COUNTRIES)[number];

interface CountryRule {
  /** International dialling code, without "+". */
  dial: string;
  /** National significant number of a mobile line (no trunk prefix). */
  mobile: RegExp;
}

const RULES: Readonly<Record<PhoneCountry, CountryRule>> = {
  // 010, 011, 012, 015 + 8 digits
  EG: { dial: "20", mobile: /^1[0125]\d{8}$/ },
  // 05X + 7 digits
  SA: { dial: "966", mobile: /^5\d{8}$/ },
  // 050, 052, 054, 055, 056, 058 + 7 digits
  AE: { dial: "971", mobile: /^5[024568]\d{7}$/ },
};

export interface NormalizedPhone {
  /** "+201001234821" — the stored and hashed form. */
  e164: string;
  country: PhoneCountry;
  /** "01001234821" — the local form with trunk zero (what couriers expect). */
  national: string;
}

/** Arabic-Indic (٠-٩) and Extended Arabic-Indic / Persian (۰-۹) digits → ASCII. */
export function toAsciiDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

function match(country: PhoneCountry, nsn: string): NormalizedPhone | undefined {
  const rule = RULES[country];
  if (!rule.mobile.test(nsn)) return undefined;
  return { e164: `+${rule.dial}${nsn}`, country, national: `0${nsn}` };
}

/**
 * Normalize a mobile number. Numbers written with a country code are matched
 * against that country; numbers without one are read in `defaultCountry`.
 * Returns undefined when the input is not a valid mobile in a supported market.
 */
export function normalizePhone(input: string | null | undefined, defaultCountry: PhoneCountry): NormalizedPhone | undefined {
  if (!input) return undefined;
  const compact = toAsciiDigits(input).replace(/[\s\-().‎‏‪-‮]/g, "");
  if (!/^\+?\d+$/.test(compact)) return undefined;

  let digits = compact;
  let international = false;
  if (digits.startsWith("+")) { digits = digits.slice(1); international = true; }
  else if (digits.startsWith("00")) { digits = digits.slice(2); international = true; }

  if (international) {
    for (const country of PHONE_COUNTRIES) {
      const { dial } = RULES[country];
      if (digits.startsWith(dial)) {
        // Tolerate a trunk zero typed after the country code: +20 0100…
        return match(country, digits.slice(dial.length).replace(/^0/, ""));
      }
    }
    return undefined;
  }

  // Local form (with or without trunk zero) in the default country
  const local = match(defaultCountry, digits.replace(/^0/, ""));
  if (local) return local;

  // Country code written without "+" or "00": 201001234821, 966501234567
  for (const country of PHONE_COUNTRIES) {
    const { dial } = RULES[country];
    if (digits.startsWith(dial)) {
      const hit = match(country, digits.slice(dial.length).replace(/^0/, ""));
      if (hit) return hit;
    }
  }
  return undefined;
}
