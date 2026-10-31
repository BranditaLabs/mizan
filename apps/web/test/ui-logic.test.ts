import { describe, expect, it } from "vitest";
import { compareValues, cx, initials, maskPhone, matches, moveIndex, riskLevel, sortRows, sparklinePath } from "../src/components/ui/logic";
import { isPaletteShortcut } from "../src/components/ui/CommandPalette";

describe("UI kit logic", () => {
  it("cx joins truthy classes", () => {
    expect(cx("a", false, null, undefined, "b")).toBe("a b");
  });

  it("risk bands follow components.md §4", () => {
    expect([0, 39, 40, 69, 70, 100].map(riskLevel)).toEqual(["low", "low", "med", "med", "high", "high"]);
  });

  it("sparkline fits the box and handles flat and tiny series", () => {
    expect(sparklinePath([1], 88, 28)).toBe("");
    expect(sparklinePath([5, 5, 5], 88, 28)).toBe("M1.00 14.00 L44.00 14.00 L87.00 14.00");
    const d = sparklinePath([0, 10], 88, 28);
    expect(d).toBe("M1.00 27.00 L87.00 1.00"); // low at the bottom, high at the top
  });

  it("masks phones to country code and last four digits", () => {
    expect(maskPhone("+201001234821")).toBe("+20 ••• 4821");
    expect(maskPhone("+966501234567")).toBe("+966 ••• 4567");
    expect(maskPhone("01001234821")).toBe("••• 4821");
  });

  it("initials from Arabic and English names", () => {
    expect(initials("Mona Adel")).toBe("MA");
    expect(initials("منى عادل")).toBe("مع");
    expect(initials("Karim")).toBe("K");
    expect(initials("  ")).toBe("");
  });

  it("sorts numbers numerically, text in the page language, empties last, stable", () => {
    const rows = [{ v: "10" }, { v: "9" }, { v: "" }, { v: "100" }];
    expect(sortRows(rows, (r) => r.v, "asc", "en").map((r) => r.v)).toEqual(["9", "10", "100", ""]);
    expect(sortRows(rows, (r) => r.v, "desc", "en").map((r) => r.v)).toEqual(["100", "10", "9", ""]);
    expect(sortRows([{ n: 2 }, { n: 10 }, { n: 1 }], (r) => r.n, "asc", "en").map((r) => r.n)).toEqual([1, 2, 10]);
    expect(sortRows([{ s: "يوسف" }, { s: "أحمد" }, { s: "منى" }], (r) => r.s, "asc", "ar").map((r) => r.s)).toEqual(["أحمد", "منى", "يوسف"]);
    const ties = [{ k: 1, id: "a" }, { k: 1, id: "b" }, { k: 0, id: "c" }];
    expect(sortRows(ties, (r) => r.k, "asc", "en").map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(compareValues(new Date(2026, 0, 2), new Date(2026, 0, 1), new Intl.Collator("en"))).toBeGreaterThan(0);
  });

  it("arrow keys follow the screen: ArrowRight goes back in right-to-left", () => {
    expect(moveIndex("ArrowRight", 0, 3)).toBe(1);
    expect(moveIndex("ArrowRight", 0, 3, { rtl: true })).toBe(2);
    expect(moveIndex("ArrowLeft", 0, 3, { rtl: true })).toBe(1);
    expect(moveIndex("ArrowDown", 2, 3, { orientation: "vertical" })).toBe(0);
    expect(moveIndex("ArrowUp", 0, 3, { orientation: "vertical" })).toBe(2);
    expect(moveIndex("End", 0, 3)).toBe(2);
    expect(moveIndex("ArrowDown", 0, 3)).toBeNull(); // not a horizontal key
    expect(moveIndex("ArrowRight", 0, 0)).toBeNull();
  });

  it("search folds Arabic letter forms and digits", () => {
    expect(matches("الإسكندرية", "اسكندريه")).toBe(true);
    expect(matches("Switch to Nile Threads", "nile thr")).toBe(true);
    expect(matches("أوردر ١٠٤٢", "1042")).toBe(true);
    expect(matches("Cairo", "giza")).toBe(false);
  });

  it("⌘K and Ctrl+K open the palette", () => {
    expect(isPaletteShortcut({ key: "k", metaKey: true, ctrlKey: false })).toBe(true);
    expect(isPaletteShortcut({ key: "K", metaKey: false, ctrlKey: true })).toBe(true);
    expect(isPaletteShortcut({ key: "k", metaKey: false, ctrlKey: false })).toBe(false);
  });
});
