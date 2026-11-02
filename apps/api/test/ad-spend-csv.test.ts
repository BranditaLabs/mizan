import { describe, expect, it } from "vitest";
import { parseSpendCsv, platformOf } from "../src/modules/profit/ads/ad-spend.csv.js";

/** E9-3: ad spend CSVs as merchants have them (a platform export, a sheet, Arabic headers). */
const opts = { today: "2026-10-23", currency: "EGP" };
/** A file with a campaign column only: the name is the key, no ad set or ad. */
const named = (campaign: string) => ({ campaign, campaignName: campaign, adset: "", adsetName: "", ad: "", adName: "" });

describe("ad spend CSV", () => {
  it("reads a sheet with date, platform, spend, currency and campaign", () => {
    const { rows, problems } = parseSpendCsv("date,platform,spend,currency,campaign\n2026-10-22,Facebook Ads,\"2,500.50\",EGP,Abayas\n2026-10-22,TikTok,900,,\n22/10/2026,google,40.5,USD,Search\n", opts);
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      { line: 2, day: "2026-10-22", platform: "meta", spendMinor: 250050n, currency: "EGP", ...named("Abayas") },
      { line: 3, day: "2026-10-22", platform: "tiktok", spendMinor: 90000n, currency: "EGP", ...named("") },
      { line: 4, day: "2026-10-22", platform: "google", spendMinor: 4050n, currency: "USD", ...named("Search") },
    ]);
  });

  it("reads a Meta export down to the ad set and the ad, ids kept as keys and names beside them (M7-3)", () => {
    const csv = "Day,Campaign name,Campaign ID,Ad set name,Ad set ID,Ad name,Ad ID,Amount spent (EGP)\n2026-10-22,Eid Sale,1202001,Cairo women,9001,Video A,77,1500\n2026-10-22,Eid Sale,1202001,Cairo women,9001,Carousel B,,250.5\n";
    const { rows, problems } = parseSpendCsv(csv, { ...opts, platform: "meta" });
    expect(problems).toEqual([]);
    expect(rows.map(({ campaign, campaignName, adset, adsetName, ad, adName, spendMinor }) => ({ campaign, campaignName, adset, adsetName, ad, adName, spendMinor }))).toEqual([
      { campaign: "1202001", campaignName: "Eid Sale", adset: "9001", adsetName: "Cairo women", ad: "77", adName: "Video A", spendMinor: 150000n },
      { campaign: "1202001", campaignName: "Eid Sale", adset: "9001", adsetName: "Cairo women", ad: "Carousel B", adName: "Carousel B", spendMinor: 25050n },
    ]);
  });

  it("reads TikTok's ad group and Arabic ad set headers", () => {
    const tiktok = parseSpendCsv("Date,Campaign name,Ad group name,Ad name,Cost\n2026-10-22,Ramadan,Giza,Clip 1,90\n", { ...opts, platform: "tiktok" });
    expect(tiktok.rows[0]).toMatchObject({ campaign: "Ramadan", adset: "Giza", ad: "Clip 1" });
    const ar = parseSpendCsv("التاريخ,اسم الحملة,المجموعة الإعلانية,اسم الإعلان,المبلغ\n2026-10-22,العيد,القاهرة,فيديو,100\n", { ...opts, platform: "meta" });
    expect(ar.rows[0]).toMatchObject({ campaign: "العيد", adsetName: "القاهرة", adName: "فيديو" });
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
