import { toMinor } from "@mizan/shared";

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

const HEADERS: Record<string, "day" | "platform" | "spend" | "currency" | "campaign"> = {
  date: "day", day: "day", "reporting starts": "day", "التاريخ": "day", "اليوم": "day",
  platform: "platform", channel: "platform", source: "platform", "المنصة": "platform",
  spend: "spend", amount: "spend", cost: "spend", "amount spent": "spend", "amount spent (egp)": "spend", "amount spent (usd)": "spend", "المبلغ": "spend", "الصرف": "spend",
  currency: "currency", "العملة": "currency",
  campaign: "campaign", "campaign name": "campaign", "الحملة": "campaign",
};

export const MAX_ROWS = 5000;
/** How far back spend can be entered (a little over a year: last year's same month). */
export const MAX_AGE_DAYS = 400;

export interface SpendRow { line: number; day: string; platform: AdPlatform; campaign: string; spendMinor: bigint; currency: string }
export interface CsvProblem { line: number; problem: "header" | "columns" | "day" | "future" | "too_old" | "platform" | "spend" | "currency" | "too_many" | "empty"; value?: string }

/** A platform name as people type it ("Facebook Ads", "TikTok") → our code, or null. */
export function platformOf(v: string): AdPlatform | null {
  return ALIASES[v.trim().toLowerCase().replace(/\s+/g, " ")] ?? null;
}

/** One CSV line into fields: commas or semicolons, double quotes around fields with either. */
function fields(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  return out.map((f) => f.trim());
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

/** "1,234.50", "1234.5", "١٢٣٤٫٥" → minor units in a 2-decimal currency, or null. */
function spendOf(v: string, currency: string): bigint | null {
  const western = v.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/٫/g, ".").replace(/[٬,\s]/g, "");
  if (!/^\d{1,12}(\.\d{1,3})?$/.test(western)) return null;
  try { return toMinor({ amount: western, currency }); } catch { return null; }
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
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const problems: CsvProblem[] = [];
  const headerAt = lines.findIndex((l) => l.trim() !== "");
  if (headerAt < 0) return { rows: [], problems: [{ line: 1, problem: "empty" }] };
  const head = lines[headerAt]!;
  const sep = (head.match(/;/g)?.length ?? 0) > (head.match(/,/g)?.length ?? 0) ? ";" : ",";
  const cols = fields(head, sep).map((h) => HEADERS[h.toLowerCase().replace(/\s+/g, " ")]);
  const at = (k: string) => cols.indexOf(k as never);
  if (at("day") < 0 || at("spend") < 0 || (at("platform") < 0 && !opts.platform)) return { rows: [], problems: [{ line: headerAt + 1, problem: "header" }] };

  const rows: SpendRow[] = [];
  for (let i = headerAt + 1; i < lines.length; i++) {
    if (lines[i]!.trim() === "") continue;
    const line = i + 1;
    if (rows.length + problems.length >= MAX_ROWS) { problems.push({ line, problem: "too_many" }); break; }
    const f = fields(lines[i]!, sep);
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
    rows.push({ line, day, platform, campaign: at("campaign") >= 0 ? (f[at("campaign")] ?? "").slice(0, 200) : "", spendMinor, currency });
  }
  if (!rows.length && !problems.length) problems.push({ line: headerAt + 2, problem: "empty" });
  return { rows, problems };
}
