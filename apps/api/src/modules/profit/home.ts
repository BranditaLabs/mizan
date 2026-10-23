import { spreadShare } from "./pnl.js";
import { addDays } from "./store-day.js";

/**
 * Pure parts of the profit home (E9-4): monthly fixed costs spread over a period's days, and
 * percentages from minor units. No floats, no clock.
 */

export interface FixedRule { amountMinor: bigint; validFrom: string; validTo: string | null }

const daysInMonth = (day: string): number => {
  const [y, m] = day.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/**
 * What monthly fixed costs (rent, salaries, tools) come to over [from, to]: each rule's monthly
 * amount spread over its month's days (a full month adds up to the amount exactly), for the
 * days the rule was in force.
 */
export function fixedCostsFor(rules: readonly FixedRule[], from: string, to: string): bigint {
  let total = 0n;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const dim = daysInMonth(d);
    const dom = Number(d.slice(8, 10));
    for (const r of rules) {
      if (r.validFrom > d || (r.validTo !== null && r.validTo < d)) continue;
      total += spreadShare(r.amountMinor, dim, dom - 1);
    }
  }
  return total;
}

/** part ÷ whole as a percentage with one decimal ("14.9"), half away from zero; null when whole is 0. */
export function percent(part: bigint, whole: bigint): string | null {
  if (whole === 0n) return null;
  const neg = (part < 0n) !== (whole < 0n);
  const p = part < 0n ? -part : part;
  const w = whole < 0n ? -whole : whole;
  const tenths = (p * 2000n + w) / (2n * w); // round(p * 1000 / w)
  const s = `${tenths / 10n}.${tenths % 10n}`;
  return neg && tenths !== 0n ? `-${s}` : s;
}

/** Every day from `from` to `to`, inclusive. */
export function daysOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
