import { describe, expect, it } from "vitest";
import { isoWeekOf } from "../src/lib/week";

/** L1-7: a week's download is named as the API names it (mizan-pilot-2026-W43.csv). */
describe("isoWeekOf", () => {
  it("names the ISO week of a store day, the year of its Thursday", () => {
    expect(isoWeekOf("2026-10-19")).toBe("2026-W43"); // a Monday
    expect(isoWeekOf("2026-10-25")).toBe("2026-W43"); // its Sunday
    expect(isoWeekOf("2026-01-01")).toBe("2026-W01"); // Thursday 1 January
    expect(isoWeekOf("2027-01-01")).toBe("2026-W53"); // Friday: still 2026's last week
    expect(isoWeekOf("2024-12-30")).toBe("2025-W01"); // Monday: already 2025's first week
  });
});
