/**
 * What an order should hold in the warehouse (E8-2), as a pure function so every case is tested
 * without a database. Only counted variants take part (a variant is counted once it has a stock
 * level); the rest stay the store's business.
 *
 * - Confirmed: each counted item is reserved (on hand stays, available drops).
 * - Cancelled, new, waiting for confirmation: nothing held; what was held is released.
 * - Shipped, delivered, returned: the hold is released and the items leave on hand (picked).
 *   A pick is never undone here: returns come back through inspection (M6).
 * - Oversell block: if any item cannot be reserved, nothing new is reserved for the order
 *   ("short") and what it already held stays; it is tried again when stock arrives.
 */
export type OrderStockStatus = "reserved" | "short" | "untracked";
export type OrderState = "new" | "pending_confirmation" | "confirmed" | "cancelled" | "shipped" | "delivered" | "returned";

export interface PlanInput {
  status: OrderState;
  /** Quantity per variant on the order. */
  lines: ReadonlyMap<string, number>;
  /** Available now (on hand − reserved) per counted variant; a variant missing here is not counted. */
  available: ReadonlyMap<string, number>;
  /** What this order already holds per variant (reserve − release). */
  held: ReadonlyMap<string, number>;
  /** What already left on hand for this order per variant. */
  picked: ReadonlyMap<string, number>;
}

export interface Plan {
  release: Map<string, number>;
  reserve: Map<string, number>;
  pick: Map<string, number>;
  /** Variants that could not be reserved (oversell blocked). */
  short: string[];
  status: OrderStockStatus | null;
}

const SHIPPED: ReadonlySet<OrderState> = new Set(["shipped", "delivered", "returned"]);

export function planOrder(input: PlanInput): Plan {
  const counted = [...input.lines.keys()].filter((v) => input.available.has(v));
  const shipped = SHIPPED.has(input.status);
  const release = new Map<string, number>();
  const reserve = new Map<string, number>();
  const pick = new Map<string, number>();
  const short: string[] = [];

  for (const v of new Set([...counted, ...input.held.keys()])) {
    const held = input.held.get(v) ?? 0;
    const want = input.status === "confirmed" && input.available.has(v) ? (input.lines.get(v) ?? 0) : 0;
    if (want < held) release.set(v, held - want);
    else if (want > held) {
      if ((input.available.get(v) ?? 0) >= want - held) reserve.set(v, want - held);
      else short.push(v);
    }
  }
  if (short.length) reserve.clear(); // all or nothing: an order is held whole or waits for stock
  if (shipped) for (const v of counted) {
    const left = (input.lines.get(v) ?? 0) - (input.picked.get(v) ?? 0);
    if (left > 0) pick.set(v, left);
  }

  const status: OrderStockStatus | null = input.status !== "confirmed" ? null
    : short.length ? "short"
    : counted.length ? "reserved"
    : input.lines.size ? "untracked" : null;
  return { release, reserve, pick, short: short.sort(), status };
}
