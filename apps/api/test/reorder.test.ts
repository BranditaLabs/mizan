import { describe, expect, it } from "vitest";
import { leadTime, reorder } from "../src/modules/purchasing/reorder.js";

const base = { windowDays: 28, leadDays: 7, safetyDays: 7, targetDays: 30 };

describe("reorder rule (M16-4b)", () => {
  it("2 a day with 7 days lead and 7 safety: reorder at 28; order up to lead + 30 days of cover", () => {
    const r = reorder({ ...base, available: 20, incoming: 0, unitsOut: 56 });
    expect(r).toEqual({ velocity: 2, daysCover: 10, reorderPoint: 28, due: true, suggested: 2 * 37 - 20 });
  });

  it("stock on its way counts: not due when available + incoming is over the point", () => {
    expect(reorder({ ...base, available: 20, incoming: 10, unitsOut: 56 })).toMatchObject({ due: false, suggested: 0, daysCover: 15 });
  });

  it("nothing sold, or more returned than sold: never due", () => {
    expect(reorder({ ...base, available: 0, incoming: 0, unitsOut: 0 })).toEqual({ velocity: 0, daysCover: null, reorderPoint: 0, due: false, suggested: 0 });
    expect(reorder({ ...base, available: 0, incoming: 0, unitsOut: -3 }).due).toBe(false);
  });

  it("rounds the order up to the pack size and never orders a negative quantity", () => {
    expect(reorder({ ...base, available: 0, incoming: 0, unitsOut: 28, packSize: 12 }).suggested).toBe(48); // need 37 → 4 packs
    expect(reorder({ ...base, available: -5, incoming: 0, unitsOut: 28 }).suggested).toBe(37); // oversold stock counts as zero
  });

  it("is always consistent: due ⇔ cover within lead + safety; suggested brings cover past the target", () => {
    for (let unitsOut = 1; unitsOut <= 200; unitsOut += 7) {
      for (const available of [0, 3, 17, 60, 140]) {
        const r = reorder({ ...base, available, incoming: 0, unitsOut });
        expect(r.due).toBe(available <= r.reorderPoint);
        if (r.due) expect(available + r.suggested).toBeGreaterThanOrEqual(Math.ceil(r.velocity * (base.leadDays + base.targetDays)) - 1);
        else expect(r.suggested).toBe(0);
      }
    }
  });

  it("lead time: the supplier's, else learned from its POs, else 14 days", () => {
    expect(leadTime(5, [20, 30])).toBe(5);
    expect(leadTime(null, [10, 13])).toBe(12);
    expect(leadTime(null, [])).toBe(14);
    expect(leadTime(null, [], 21)).toBe(21);
  });
});
