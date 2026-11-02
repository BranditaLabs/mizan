/** A landed cost on a purchase order (M16-4a): an amount in its own currency, spread by value or quantity. */
export interface LandedCost { amountMinor: bigint; currency: string; allocateBy: "value" | "quantity" }
export interface PoLineWeight { id: string; quantity: number; unitCostMinor: bigint }

/** a ÷ b rounded half up, for non-negative integers (b > 0). */
const divRound = (a: bigint, b: bigint) => (a * 2n + b) / (2n * b);

/**
 * The landed cost that `units` received of line `lineId` carry, per cost currency (minor units).
 * A cost is spread over the PO's lines by their value (quantity × unit cost) or their quantity;
 * a line's share is then spread evenly over its ordered units, so receiving every unit of every
 * line adds up to the whole cost (± rounding per receipt). Units past the ordered quantity carry none.
 */
export function landedFor(costs: readonly LandedCost[], lines: readonly PoLineWeight[], lineId: string, units: number): Map<string, bigint> {
  const out = new Map<string, bigint>();
  const line = lines.find((l) => l.id === lineId);
  if (!line || units <= 0 || line.quantity <= 0) return out;
  const n = BigInt(Math.min(units, line.quantity));
  for (const c of costs) {
    const weight = (l: PoLineWeight) => (c.allocateBy === "value" ? BigInt(l.quantity) * l.unitCostMinor : BigInt(l.quantity));
    const total = lines.reduce((s, l) => s + weight(l), 0n);
    if (total === 0n) continue;
    const share = divRound(c.amountMinor * weight(line) * n, total * BigInt(line.quantity));
    if (share > 0n) out.set(c.currency, (out.get(c.currency) ?? 0n) + share);
  }
  return out;
}
