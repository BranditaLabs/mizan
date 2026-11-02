import { describe, expect, it } from "vitest";
import { isLate, moveRefusal, stamps, TICKET_STATUSES, VIEW_STATUSES } from "../src/modules/tickets/tickets.rules.js";

/** E10-1: the status rules without the database. */
describe("ticket rules", () => {
  const now = new Date("2026-10-26T12:00:00Z");
  it("moves freely between working statuses; only closed is final", () => {
    for (const from of TICKET_STATUSES) for (const to of TICKET_STATUSES) {
      expect(moveRefusal(from, to)).toBe(from === "closed" && to !== "closed" ? "ticket_closed" : null);
    }
  });
  it("stamps resolving, clears it on reopening, stamps closing", () => {
    expect(stamps("open", "resolved", now)).toEqual({ resolved_at: now });
    expect(stamps("resolved", "open", now)).toEqual({ resolved_at: null });
    expect(stamps("resolved", "closed", now)).toEqual({ closed_at: now });
    expect(stamps("waiting_customer", "closed", now)).toEqual({ closed_at: now, resolved_at: now });
    expect(stamps("open", "waiting_courier", now)).toEqual({});
    expect(stamps("open", "open", now)).toEqual({});
  });
  it("is late only while still being worked on", () => {
    const past = new Date(now.getTime() - 1);
    expect(isLate("open", past, now)).toBe(true);
    expect(isLate("in_inspection", past, now)).toBe(true);
    expect(isLate("resolved", past, now)).toBe(false);
    expect(isLate("open", new Date(now.getTime() + 1), now)).toBe(false);
    expect(isLate("open", null, now)).toBe(false);
  });
  it("the status groups cover every status once, and active is every one still being worked on", () => {
    const groups = [VIEW_STATUSES.open, VIEW_STATUSES.waiting, VIEW_STATUSES.inspection, VIEW_STATUSES.resolved, VIEW_STATUSES.closed].flat();
    expect([...groups].sort()).toEqual([...TICKET_STATUSES].sort());
    expect([...VIEW_STATUSES.active].sort()).toEqual([...VIEW_STATUSES.open, ...VIEW_STATUSES.waiting, ...VIEW_STATUSES.inspection].sort());
  });
});
