import { describe, expect, it } from "vitest";
import { parseSpendCsv, platformOf } from "../src/modules/profit/ads/ad-spend.csv.js";

/** E9-3: ad spend CSVs as merchants have them (a platform export, a sheet, Arabic headers). */
const opts = { today: "2026-10-23", currency: "EGP" };

describe("ad spend CSV", () => {
  it("reads a sheet with date, platform, spend, currency and campaign", () => {
    const { rows, problems } = parseSpendCsv("date,platform,spend,currency,campaign\n2026-10-22,Facebook Ads,\"2,500.50\",EGP,Abayas\n2026-10-22,TikTok,900,,\n22/10/2026,google,40.5,USD,Search\n", opts);
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      { line: 2, day: "2026-10-22", platform: "meta", campaign: "Abayas", spendMinor: 250050n, currency: "EGP" },
      { line: 3, day: "2026-10-22", platform: "tiktok", campaign: "", spendMinor: 90000n, currency: "EGP" },
      { line: 4, day: "2026-10-22", platform: "google", campaign: "Search", spendMinor: 4050n, currency: "USD" },
    ]);
  });

  it("reads semicolons, Arabic headers and Arabic digits; one platform for the whole file", () => {
    const { rows, problems } = parseSpendCsv("﻿التاريخ;المبلغ\n2026-10-21;١٬٢٠٠٫٥٠\r\n\r\n2026-10-20;300\r\n", { ...opts, platform: "snapchat" });
    expect(problems).toEqual([]);
    expect(rows.map((r) => [r.day, r.platform, r.spendMinor])).toEqual([["2026-10-21", "snapchat", 120050n], ["2026-10-20", "snapchat", 30000n]]);
  });

  it("names every bad line and saves nothing it cannot read", () => {
    const { problems } = parseSpendCsv([
      "date,platform,spend",
      "2026-02-30,meta,100", // no such day
      "2026-10-24,meta,100", // tomorrow
      "2025-01-01,meta,100", // too old
      "2026-10-22,myspace,100",
      "2026-10-22,meta,-5",
      "2026-10-22,meta,12.345",
      "2026-10-22,meta,100",
    ].join("\n"), opts);
    expect(problems.map((p) => [p.line, p.problem])).toEqual([[2, "day"], [3, "future"], [4, "too_old"], [5, "platform"], [6, "spend"], [7, "spend"]]);
  });

  it("refuses a file without the columns it needs, or with nothing in it", () => {
    expect(parseSpendCsv("day,amount\n2026-10-22,5", opts).problems).toEqual([{ line: 1, problem: "header" }]);
    expect(parseSpendCsv("", opts).problems).toEqual([{ line: 1, problem: "empty" }]);
    expect(parseSpendCsv("date,platform,spend\n\n", opts).problems).toEqual([{ line: 2, problem: "empty" }]);
  });

  it("knows platforms as people write them", () => {
    expect(["Meta", " instagram ", "Google Ads", "Snap", "TikTok Ads", "other"].map(platformOf)).toEqual(["meta", "meta", "google", "snapchat", "tiktok", "other"]);
    expect(platformOf("twitter")).toBeNull();
  });
});
