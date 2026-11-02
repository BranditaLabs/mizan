import { addDays } from "../profit/store-day.js";

/**
 * ISO weeks for the weekly export (L1-7): "2026-W43" is Monday 19 to Sunday 25 October 2026, in
 * store days (the store's time zone, as every other period). Pure: no clock.
 */
export const ISO_WEEK = /^(\d{4})-W(\d{2})$/;

/** The ISO week a store day falls in ("2026-W43"); the week's year is the year of its Thursday. */
export function isoWeekOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); // that week's Thursday
  const year = d.getUTCFullYear();
  const week = Math.floor((d.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Monday and Sunday of an ISO week; null when there is no such week (W00, W54, W53 of a 52-week year, malformed). */
export function isoWeekRange(week: string): { from: string; to: string } | null {
  const m = ISO_WEEK.exec(week);
  if (!m) return null;
  const year = Number(m[1]);
  const w = Number(m[2]);
  if (year < 2000 || year > 2999 || w < 1 || w > 53) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4)); // always in week 1
  const monday = addDays(jan4.toISOString().slice(0, 10), 1 - (jan4.getUTCDay() || 7) + (w - 1) * 7);
  if (isoWeekOf(monday) !== week) return null;
  return { from: monday, to: addDays(monday, 6) };
}

/** The last full week before the one `today` is in (store day). */
export const lastFullWeek = (today: string): string => isoWeekOf(addDays(today, -7));

/** A week query value: an ISO week, or "last" for the last full week. */
export const isWeekParam = (v: string) => v === "last" || isoWeekRange(v) !== null;
