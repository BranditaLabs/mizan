/**
 * Address → Bosta city resolution.
 *
 * Shopify checkouts let customers type cities freely ("Cairo", "القاهرة",
 * "Al Qahirah", "6th of October", "Nasr city"). Bosta needs one of its own
 * cities. Resolution order:
 *   1. learned aliases (ops picked the city once; remembered forever)
 *   2. exact normalized match on Bosta's English or Arabic name
 *   3. built-in aliases for common Egyptian spellings and districts
 *   4. containment match ("New Cairo" contains "Cairo") on city, then province
 * If nothing matches, the job stops with the three closest suggestions, and
 * the ops choice becomes a learned alias for every later order.
 */

export interface BostaCity {
  id: string;
  name: string;
  nameAr?: string;
  code?: string;
}

const STRIP = /\b(governorate|gov\.?|city|district|province|markaz|el|al)\b|محافظة|مدينة|مركز/gi;

export function normalize(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .normalize("NFKD")
    .replace(/[ً-ْٰ]/g, "") // Arabic diacritics
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .toLowerCase()
    .replace(/[̀-ͯ]/g, "")
    .replace(STRIP, " ")
    .replace(/[^a-z0-9؀-ۿ]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Common Egyptian spellings → Bosta's English city name. Extend per market. */
export const EG_ALIASES: Record<string, string> = {
  "qahirah": "Cairo", "kairo": "Cairo", "القاهره": "Cairo", "nasr": "Cairo", "new cairo": "Cairo", "heliopolis": "Cairo", "maadi": "Cairo", "تجمع": "Cairo",
  "giza": "Giza", "gizah": "Giza", "jizah": "Giza", "الجيزه": "Giza", "6th of october": "Giza", "6 october": "Giza", "october": "Giza", "sheikh zayed": "Giza", "dokki": "Giza", "اكتوبر": "Giza",
  "alexandria": "Alexandria", "alex": "Alexandria", "iskandariyah": "Alexandria", "الاسكندريه": "Alexandria", "اسكندريه": "Alexandria",
  "sharqia": "Sharqia", "sharkia": "Sharqia", "sharqiyah": "Sharqia", "zagazig": "Sharqia", "الشرقيه": "Sharqia",
  "dakahlia": "Dakahlia", "daqahliyah": "Dakahlia", "mansoura": "Dakahlia", "الدقهليه": "Dakahlia",
  "gharbia": "Gharbia", "gharbiyah": "Gharbia", "tanta": "Gharbia", "الغربيه": "Gharbia",
  "qalyubia": "Qalyubia", "qalyubiyah": "Qalyubia", "banha": "Qalyubia", "القليوبيه": "Qalyubia",
  "monufia": "Menofia", "menoufia": "Menofia", "minufiyah": "Menofia", "المنوفيه": "Menofia",
  "beheira": "Behira", "buhayrah": "Behira", "damanhour": "Behira", "البحيره": "Behira",
  "asyut": "Assiut", "assiut": "Assiut", "اسيوط": "Assiut",
  "suhag": "Sohag", "sohag": "Sohag", "سوهاج": "Sohag",
  "port said": "Port Said", "بورسعيد": "Port Said", "ismailia": "Ismailia", "الاسماعيليه": "Ismailia", "suez": "Suez", "السويس": "Suez",
  "red sea": "Red Sea", "hurghada": "Red Sea", "الغردقه": "Red Sea", "luxor": "Luxor", "الاقصر": "Luxor", "aswan": "Aswan", "اسوان": "Aswan",
};

export interface CityMatch {
  city: BostaCity;
  via: "learned" | "exact" | "alias" | "contains";
}

export class CityResolver {
  private byNorm = new Map<string, BostaCity>();

  constructor(private readonly cities: BostaCity[], private readonly learned: Map<string, string> = new Map()) {
    for (const c of cities) {
      this.byNorm.set(normalize(c.name), c);
      if (c.nameAr) this.byNorm.set(normalize(c.nameAr), c);
    }
  }

  resolve(cityText: string | undefined, provinceText?: string): CityMatch | null {
    for (const text of [cityText, provinceText]) {
      const n = normalize(text);
      if (!n) continue;
      const learnedId = this.learned.get(n);
      if (learnedId) {
        const c = this.cities.find((x) => x.id === learnedId);
        if (c) return { city: c, via: "learned" };
      }
      const exact = this.byNorm.get(n);
      if (exact) return { city: exact, via: "exact" };
      for (const [alias, target] of Object.entries(EG_ALIASES)) {
        if (n === normalize(alias) || n.includes(normalize(alias))) {
          const c = this.byNorm.get(normalize(target));
          if (c) return { city: c, via: "alias" };
        }
      }
      for (const [k, c] of this.byNorm) {
        if (k.length >= 4 && (n.includes(k) || k.includes(n))) return { city: c, via: "contains" };
      }
    }
    return null;
  }

  suggest(text: string | undefined, n = 3): BostaCity[] {
    const t = normalize(text);
    return [...this.cities]
      .map((c) => ({ c, d: Math.min(lev(t, normalize(c.name)), c.nameAr ? lev(t, normalize(c.nameAr)) : Infinity) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, n)
      .map((x) => x.c);
  }
}

function lev(a: string, b: string): number {
  if (!a) return b.length;
  if (!b) return a.length;
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}
