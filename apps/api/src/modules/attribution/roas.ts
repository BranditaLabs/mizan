import { percent } from "../profit/home.js";

/**
 * True ROAS (M7-1): what ads really bought, from the orders' money, not from what the ad platform
 * counted. One place for the formulas; the metric layer and the attribution screen both use them.
 *
 * Cohort: orders placed in the period (store days), all of them, the cancelled ones too — a fake
 * order cost ad money. Money in the store's base currency (minor units).
 */
export interface RoasFacts {
  /** Ad spend in the period, base currency. */
  spend: bigint;
  /** Orders placed, every status, and their total value (what an ad platform credits as purchases). */
  orders: bigint;
  placedValue: bigint;
  /** Cancelled before leaving, refused or returned, delivered, and still moving (new … shipped). */
  cancelled: bigint;
  returned: bigint;
  delivered: bigint;
  moving: bigint;
  /** Money that is real: paid before delivery, or cash delivered, less refunds. */
  real: bigint;
  /** What the moving orders would still bring if they all arrive (expected less what is already real). */
  pending: bigint;
  /** Net profit of the cohort, ad costs included. */
  net: bigint;
}

/** a ÷ b to two decimals, half up, as text ("3.25"); null when b is 0. */
export function multiple(a: bigint, b: bigint): string | null {
  if (b === 0n) return null;
  const neg = a < 0n;
  const x = neg ? -a : a;
  const hundredths = (x * 200n + b) / (2n * b);
  const s = `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, "0")}`;
  return neg && hundredths > 0n ? `-${s}` : s;
}

/** a ÷ b in minor units, half up; null when b is 0. */
export function perUnit(a: bigint, b: bigint): bigint | null {
  return b === 0n ? null : (a * 2n + b) / (2n * b);
}

export function roasSummary(f: RoasFacts) {
  const ended = f.delivered + f.returned;
  // Still-moving orders arrive at the rate the finished ones did; until some finished, no projection.
  const projected = ended === 0n ? null : f.real + (f.pending * f.delivered) / ended;
  return {
    trueRoas: multiple(f.real, f.spend),
    reportedRoas: multiple(f.placedValue, f.spend),
    projectedRoas: projected === null ? null : multiple(projected, f.spend),
    costPerOrder: perUnit(f.spend, f.orders),
    costPerDelivered: perUnit(f.spend, f.delivered),
    deliveredRate: percent(f.delivered, ended),
    /** Orders that never paid: cancelled, refused or returned, of all orders placed. */
    lostShare: percent(f.cancelled + f.returned, f.orders),
  };
}
