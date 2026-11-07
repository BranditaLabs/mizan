import { percent } from "./home.js";

/**
 * Profit breakdown (M5, E9-5), pure: the orders' profit (order_pnl, base currency) grouped by
 * day, store, courier, country or product. An order belongs to one day, store, courier and
 * country; across its products it is split exactly (no pound lost or made up): product cost by
 * each line's own cost, everything else by each line's share of the order's value.
 */
export const BREAKDOWN_DIMENSIONS = ["day", "product", "store", "courier", "country"] as const;
export type Dimension = (typeof BREAKDOWN_DIMENSIONS)[number];

export const COMPONENTS = ["revenue", "refund", "cogs", "shipping", "cod_fee", "payment_fee", "channel_fee", "ads", "agent", "packaging", "rto", "chargeback", "expected_net"] as const;
export type Component = (typeof COMPONENTS)[number];
export type Components = Record<Component, bigint>;

export interface OrderFact {
  orderId: string;
  /** Delivered, or refused / returned after shipping. */
  delivered: boolean;
  returned: boolean;
  /** FX-2: the order's profit misses an input (a COST_FLAGS flag; never on a cancelled order). */
  costsMissing?: boolean;
  /** FX-2: the order is flagged `cost_missing` (a product has no cost): only the lines without one are marked. */
  productCostMissing?: boolean;
  /** FX-2: the order misses an input other than a product cost (a rate, a fee): every line is marked. */
  otherMissing?: boolean;
  comps: Components;
}
/** `costMissing`: this product has no cost yet (only that product's rows are marked, by product). */
export interface LineFact { key: string; label: string; valueMinor: bigint; costMinor: bigint; costMissing?: boolean }
export interface Slice { key: string; label: string; orderId: string; delivered: boolean; returned: boolean; costsMissing?: boolean; comps: Components }

export interface BreakdownRow {
  key: string;
  label: string;
  orders: number;
  delivered: number;
  returned: number;
  revenue: bigint;
  productCost: bigint;
  shippingAndCod: bigint;
  ads: bigint;
  returns: bigint;
  team: bigint;
  fees: bigint;
  net: bigint;
  expectedNet: bigint;
  /** Net ÷ revenue; null while a cost is missing in the row (FX-2: never a 100% margin on missing costs). */
  margin: string | null;
  /** Orders in the row whose profit misses an input. */
  costsMissing: number;
}

export const zeroComps = (): Components => Object.fromEntries(COMPONENTS.map((c) => [c, 0n])) as Components;

/**
 * Split `total` over `weights` exactly: proportional shares rounded toward zero, the remainder
 * handed out one minor unit at a time by largest fraction (ties: first). All-zero weights split evenly.
 */
export function allocate(total: bigint, weights: readonly bigint[]): bigint[] {
  if (weights.length === 0) return [];
  const w = weights.some((x) => x > 0n) ? weights.map((x) => (x > 0n ? x : 0n)) : weights.map(() => 1n);
  const sum = w.reduce((a, b) => a + b, 0n);
  const neg = total < 0n;
  const t = neg ? -total : total;
  const shares = w.map((x) => (t * x) / sum);
  let left = t - shares.reduce((a, b) => a + b, 0n);
  const order = w.map((x, i) => ({ i, frac: (t * x) % sum })).sort((a, b) => (b.frac > a.frac ? 1 : b.frac < a.frac ? -1 : a.i - b.i));
  for (const { i } of order) {
    if (left === 0n) break;
    if (w[i] === 0n) continue;
    shares[i]! += 1n;
    left -= 1n;
  }
  return neg ? shares.map((s) => -s) : shares;
}

/** One order split over its lines (products); an order without lines stays whole as "no products". */
export function splitByLines(order: OrderFact, lines: readonly LineFact[], none: { key: string; label: string }): Slice[] {
  if (lines.length === 0) return [{ ...none, orderId: order.orderId, delivered: order.delivered, returned: order.returned, costsMissing: order.costsMissing ?? false, comps: order.comps }];
  const byValue = lines.map((l) => l.valueMinor);
  const byCost = lines.map((l) => l.costMinor);
  const parts = lines.map(() => zeroComps());
  for (const c of COMPONENTS) {
    allocate(order.comps[c], c === "cogs" ? byCost : byValue).forEach((v, i) => { parts[i]![c] = v; });
  }
  // Only an order that misses an input marks its lines (a cancelled or fully returned one never does).
  // A missing product cost marks that product's lines; any other input (a rate, a fee) marks every line.
  // A product-cost flag with no line lacking a cost (set since) still marks every line: the profit was
  // worked out without it.
  const missing = order.costsMissing ?? false;
  // Without the split (older callers), a missing input is read as a product cost.
  const split = order.productCostMissing !== undefined || order.otherMissing !== undefined;
  const productMissing = missing && (split ? Boolean(order.productCostMissing) : true);
  const other = missing && ((order.otherMissing ?? false) || (productMissing && !lines.some((l) => l.costMissing)));
  return lines.map((l, i) => ({ key: l.key, label: l.label, orderId: order.orderId, delivered: order.delivered, returned: order.returned, costsMissing: other || (productMissing && Boolean(l.costMissing)), comps: parts[i]! }));
}

export const netOf = (c: Components): bigint =>
  c.revenue - c.refund - c.cogs - c.shipping - c.cod_fee - c.payment_fee - c.channel_fee - c.ads - c.agent - c.packaging - c.rto - c.chargeback;

/** Slices summed per key; biggest profit first (by day: in date order). Orders count once per key. */
export function aggregate(slices: readonly Slice[], dimension: Dimension): { rows: BreakdownRow[]; total: BreakdownRow } {
  const groups = new Map<string, { label: string; comps: Components; orders: Set<string>; delivered: Set<string>; returned: Set<string>; missing: Set<string> }>();
  const all = { label: "", comps: zeroComps(), orders: new Set<string>(), delivered: new Set<string>(), returned: new Set<string>(), missing: new Set<string>() };
  for (const s of slices) {
    let g = groups.get(s.key);
    if (!g) groups.set(s.key, (g = { label: s.label, comps: zeroComps(), orders: new Set(), delivered: new Set(), returned: new Set(), missing: new Set() }));
    for (const target of [g, all]) {
      for (const c of COMPONENTS) target.comps[c] += s.comps[c];
      target.orders.add(s.orderId);
      if (s.delivered) target.delivered.add(s.orderId);
      if (s.returned) target.returned.add(s.orderId);
      if (s.costsMissing) target.missing.add(s.orderId);
    }
  }
  const row = (key: string, g: typeof all): BreakdownRow => {
    const c = g.comps;
    const revenue = c.revenue - c.refund;
    const net = netOf(c);
    return {
      key, label: g.label, orders: g.orders.size, delivered: g.delivered.size, returned: g.returned.size,
      revenue, productCost: c.cogs, shippingAndCod: c.shipping + c.cod_fee, ads: c.ads, returns: c.rto, team: c.agent,
      fees: c.payment_fee + c.channel_fee + c.packaging + c.chargeback, net, expectedNet: c.expected_net,
      margin: g.missing.size ? null : percent(net, revenue), costsMissing: g.missing.size,
    };
  };
  const rows = [...groups.entries()].map(([k, g]) => row(k, g));
  rows.sort(dimension === "day" ? (a, b) => (a.key < b.key ? -1 : 1) : (a, b) => (b.net > a.net ? 1 : b.net < a.net ? -1 : a.label.localeCompare(b.label)));
  return { rows, total: row("total", all) };
}
