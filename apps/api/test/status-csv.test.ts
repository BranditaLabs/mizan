import { describe, expect, it } from "vitest";
import { parseStatusCsv, statusOf } from "../src/modules/shipping/status-csv.js";

/** E7-6: the courier's status report as CSV, in Arabic or English, read all or nothing. */
const now = new Date("2026-10-27T12:00:00Z");

describe("courier status CSV", () => {
  it("reads what couriers write, in Arabic and English, final statuses first", () => {
    expect(statusOf("Delivered")).toBe("delivered");
    expect(statusOf("تم التسليم")).toBe("delivered");
    expect(statusOf("delivery failed")).toBe("failed_attempt");
    expect(statusOf("لم يتم التسليم")).toBe("failed_attempt");
    expect(statusOf("مرتجع")).toBe("returned");
    expect(statusOf("out for delivery")).toBe("out_for_delivery");
    expect(statusOf("  OUT_FOR_DELIVERY ")).toBe("out_for_delivery");
    expect(statusOf("on a camel")).toBeNull();
    expect(statusOf("delivered?")).toBeNull(); // never a guess
  });

  it("reads a sheet with Arabic headers, dates and notes", () => {
    const r = parseStatusCsv("﻿رقم الشحنة;الحالة;التاريخ;ملاحظات\r\n7000001;تم التسليم;2026-10-26;استلمها الأخ\r\n٧٠٠٠٠٠٢;مرتجع;;\r\n", now);
    expect(r.problems).toEqual([]);
    expect(r.rows).toEqual([
      { line: 2, tracking: "7000001", status: "delivered", at: new Date("2026-10-26T12:00:00Z"), note: "استلمها الأخ" },
      { line: 3, tracking: "7000002", status: "returned" },
    ]);
  });

  it("names every line it can't read", () => {
    const r = parseStatusCsv("Tracking Number,Status,Date\n7000001,Delivered,2026-10-26 09:30\n7000001,Returned,\n7000003,teleported,\n7000004,Delivered,2027-01-01\n,Delivered,\n7000006\n", now);
    expect(r.rows.map((x) => x.tracking)).toEqual(["7000001"]);
    expect(r.rows[0]!.at).toEqual(new Date("2026-10-26T09:30:00Z"));
    expect(r.problems).toEqual([
      { line: 3, problem: "duplicate", value: "7000001" },
      { line: 4, problem: "status", value: "teleported" },
      { line: 5, problem: "date", value: "2027-01-01" },
      { line: 6, problem: "tracking", value: "" },
      { line: 7, problem: "columns" },
    ]);
    expect(parseStatusCsv("sku,cost\n1,2\n", now).problems).toEqual([{ line: 1, problem: "header" }]);
    expect(parseStatusCsv("", now).problems).toEqual([{ line: 1, problem: "empty" }]);
  });
});
