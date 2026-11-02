import { toMinor } from "@mizan/shared";
import { headerKey, plainDecimal, readCsv } from "../../../platform/csv.js";

/** Ad platforms a day's spend is recorded under (E9-3); M7 adds their APIs. */
export const AD_PLATFORMS = ["meta", "tiktok", "google", "snapchat", "other"] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];

const ALIASES: Record<string, AdPlatform> = {
  meta: "meta", facebook: "meta", fb: "meta", instagram: "meta", ig: "meta", "meta ads": "meta", "facebook ads": "meta",
  tiktok: "tiktok", "tiktok ads": "tiktok", "tik tok": "tiktok",
  google: "google", "google ads": "google", adwords: "google", youtube: "google",
  snapchat: "snapchat", snap: "snapchat", "snapchat ads": "snapchat",
  other: "other",
};

type Column = "day" | "platform" | "spend" | "currency" | "campaign" | "campaignId" | "adset" | "adsetId" | "ad" | "adId";
const HEADERS: Record<string, Column> = {
  date: "day", day: "day", "reporting starts": "day", "التاريخ": "day", "اليوم": "day",
  platform: "platform", channel: "platform", source: "platform", "المنصة": "platform",
  spend: "spend", amount: "spend", cost: "spend", "amount spent": "spend", "amount spent (egp)": "spend", "amount spent (usd)": "spend", "المبلغ": "spend", "الصرف": "spend",
  currency: "currency", "العملة": "currency",
  campaign: "campaign", "campaign name": "campaign", "الحملة": "campaign", "اسم الحملة": "campaign",
  // M7-3: down to the ad set (TikTok: ad group) and the ad, as Meta, TikTok, Snap and Google export them.
  "campaign id": "campaignId", "معرف الحملة": "campaignId",
  "ad set": "adset", "ad set name": "adset", adset: "adset", "adset name": "adset", "ad group": "adset", "ad group name": "adset", "ad squad name": "adset", "المجموعة الإعلانية": "adset", "مجموعة الإعلانات": "adset",
  "ad set id": "adsetId", "adset id": "adsetId", "ad group id": "adsetId", "ad squad id": "adsetId",
  ad: "ad", "ad name": "ad", "الإعلان": "ad", "اسم الإعلان": "ad",
  "ad id": "adId", "معرف الإعلان": "adId",
};

export const MAX_ROWS = 5000;
/** How far back spend can be entered (a little over a year: last year's same month). */
export const MAX_AGE_DAYS = 400;

/**
 * One line of spend. `campaign`, `adset` and `ad` are the keys (the export's id, else its name; empty
 * when the file has no such column); the names are kept beside them for the campaign results (M7-3).
 */
export interface SpendRow {
  line: number; day: string; platform: AdPlatform; spendMinor: bigint; currency: string;
  campaign: string; campaignName: string; adset: string; adsetName: string; ad: string; adName: string;
}
export interface CsvProblem { line: number; problem: "header" | "columns" | "day" | "future" | "too_old" | "platform" | "spend" | "currency" | "too_many" | "empty"; value?: string }

/** A platform name as people type it ("Facebook Ads", "TikTok") → our code, or null. */
export function platformOf(v: string): AdPlatform | null {
  return ALIASES[v.trim().toLowerCase().replace(/\s+/g, " ")] ?? null;
}

/** "2026-10-22", "22/10/2026" or "22-10-2026" → YYYY-MM-DD, or null. */
function dayOf(v: string): string | null {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  let y: number, mo: number, d: number;
  if (m) { y = +m[1]!; mo = +m[2]!; d = +m[3]!; } else {
    m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v);
    if (!m) return null;
    d = +m[1]!; mo = +m[2]!; y = +m[3]!;
  }
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso ? null : iso;
}

/** "1,234.50", "1234.5", "١٢٣٤٫٥" → minor units, or null. */
function spendOf(v: string, currency: string): bigint | null {
  const amount = plainDecimal(v);
  if (amount === null) return null;
  try { return toMinor({ amount, currency }); } catch { return null; }
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * Parse an ad spend CSV (a platform's export or a sheet): a header row naming at least date and
 * spend (platform per row, or the one given for the whole file), optional currency (else the
 * store's) and campaign. All or nothing: any bad line is reported with its number and nothing is
 * saved. `today` is the store's day; spend cannot be in the future or older than 400 days.
 */
export function parseSpendCsv(text: string, opts: { today: string; currency: string; platform?: AdPlatform }): { rows: SpendRow[]; problems: CsvProblem[] } {
  const csv = readCsv(text);
  const problems: CsvProblem[] = [];
  if (!csv) return { rows: [], problems: [{ line: 1, problem: "empty" }] };
  const cols = csv.header.fields.map((h) => HEADERS[headerKey(h)]);
  const at = (k: Column) => cols.indexOf(k);
  if (at("day") < 0 || at("spend") < 0 || (at("platform") < 0 && !opts.platform)) return { rows: [], problems: [{ line: csv.header.line, problem: "header" }] };

  const rows: SpendRow[] = [];
  for (const { line, fields: f } of csv.rows) {
    if (rows.length + problems.length >= MAX_ROWS) { problems.push({ line, problem: "too_many" }); break; }
    if (f.length < cols.filter(Boolean).length && f.length <= Math.max(at("day"), at("spend"))) { problems.push({ line, problem: "columns" }); continue; }
    const day = dayOf(f[at("day")] ?? "");
    if (!day) { problems.push({ line, problem: "day", value: f[at("day")] ?? "" }); continue; }
    if (day > opts.today) { problems.push({ line, problem: "future", value: day }); continue; }
    if (daysBetween(day, opts.today) > MAX_AGE_DAYS) { problems.push({ line, problem: "too_old", value: day }); continue; }
    const platform = at("platform") >= 0 ? platformOf(f[at("platform")] ?? "") : opts.platform!;
    if (!platform) { problems.push({ line, problem: "platform", value: f[at("platform")] ?? "" }); continue; }
    const currency = at("currency") >= 0 && f[at("currency")] ? f[at("currency")]!.toUpperCase() : opts.currency;
    if (!/^[A-Z]{3}$/.test(currency)) { problems.push({ line, problem: "currency", value: currency }); continue; }
    const spendMinor = spendOf(f[at("spend")] ?? "", currency);
    if (spendMinor === null) { problems.push({ line, problem: "spend", value: f[at("spend")] ?? "" }); continue; }
    const cell = (k: Column) => (at(k) >= 0 ? (f[at(k)] ?? "").trim().slice(0, 200) : "");
    const [campaignName, adsetName, adName] = [cell("campaign"), cell("adset"), cell("ad")];
    rows.push({
      line, day, platform, spendMinor, currency,
      campaign: cell("campaignId") || campaignName, campaignName,
      adset: cell("adsetId") || adsetName, adsetName, ad: cell("adId") || adName, adName,
    });
  }
  if (!rows.length && !problems.length) problems.push({ line: csv.header.line + 1, problem: "empty" });
  return { rows, problems };
}
