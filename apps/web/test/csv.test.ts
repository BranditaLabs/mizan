import { describe, expect, it } from "vitest";
import { toCsv } from "../src/lib/csv";

/** E9-5: the CSV opens right in a spreadsheet, in Arabic too, and never runs a formula. */
describe("toCsv", () => {
  it("BOM, CRLF, quoting, decimals as typed; formulas defused, negative amounts kept", () => {
    const csv = toCsv([["المنتج", "الصافي"], ["عباية, سادة", "-320.00"], ['He said "hi"', 12], ["=HYPERLINK(1)", null], ["-cmd", "+1"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1).split("\r\n")).toEqual(["المنتج,الصافي", '"عباية, سادة",-320.00', '"He said ""hi""",12', "'=HYPERLINK(1),", "'-cmd,'+1", ""]);
  });
});
