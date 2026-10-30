/** One item's numbers for the reorder rule (M16-4b, docs/modules/M16 "Reorder rule"). */
export interface ReorderInput {
  available: number;
  /** Still to arrive on approved, sent or partly received POs. */
  incoming: number;
  /** Units that left stock in the window (shipped) less those restocked from returns. */
  unitsOut: number;
  windowDays: number;
  leadDays: number;
  safetyDays: number;
  targetDays: number;
  /** Order in multiples of this (a pack or the supplier's minimum step); 1 = any. */
  packSize?: number;
}

export interface ReorderResult {
  /** Units a day. */
  velocity: number;
  /** Days the available plus incoming stock lasts at that pace; null when nothing sells. */
  daysCover: number | null;
  reorderPoint: number;
  /** At or under the reorder point. */
  due: boolean;
  /** Units to order to reach the target cover after lead time; 0 when not due. */
  suggested: number;
}

/**
 * The reorder rule: velocity × (lead time + safety stock) is the point to reorder at; an item at or
 * under it gets enough to cover lead time + the target cover, less what is on hand and on its way,
 * rounded up to the pack size. Nothing sold in the window: never due.
 */
export function reorder(i: ReorderInput): ReorderResult {
  const velocity = i.windowDays > 0 ? Math.max(0, i.unitsOut) / i.windowDays : 0;
  const have = Math.max(0, i.available) + Math.max(0, i.incoming);
  if (velocity === 0) return { velocity: 0, daysCover: null, reorderPoint: 0, due: false, suggested: 0 };
  const reorderPoint = Math.ceil(velocity * (i.leadDays + i.safetyDays));
  const due = have <= reorderPoint;
  const pack = Math.max(1, Math.trunc(i.packSize ?? 1));
  const need = Math.ceil(velocity * (i.leadDays + i.targetDays)) - have;
  const suggested = due && need > 0 ? Math.ceil(need / pack) * pack : 0;
  return { velocity: Math.round(velocity * 100) / 100, daysCover: Math.floor(have / velocity), reorderPoint, due, suggested };
}

/** Lead time: the supplier's own, else learned from its received POs (sent → fully received), else the default. */
export function leadTime(set: number | null, learnedDays: number[], fallback = 14): number {
  if (set !== null && set >= 0) return set;
  const good = learnedDays.filter((d) => Number.isFinite(d) && d >= 0);
  if (!good.length) return fallback;
  return Math.round(good.reduce((a, b) => a + b, 0) / good.length);
}
