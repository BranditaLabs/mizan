import { describe, expect, it } from "vitest";
import { campaignResults, norm, zero, type Measures, type OrderGroup, type SpendEntity } from "../src/modules/attribution/campaigns.js";

const spend = (over: Partial<SpendEntity>): SpendEntity => ({ platform: "meta", campaign: "", campaignName: "", adset: "", adsetName: "", ad: "", adName: "", minor: 0n, ...over });
const m = (orders: number, delivered = 0, real = 0): Measures => ({ ...zero(), orders: BigInt(orders), delivered: BigInt(delivered), real: BigInt(real) });
const order = (over: Partial<OrderGroup>, measures: Measures): OrderGroup => ({ platform: "meta", utmId: null, utmCampaign: null, utmTerm: null, utmContent: null, ...over, m: measures });

describe("campaign results (M7-3)", () => {
  const eid = spend({ campaign: "120200001", campaignName: "Eid  Sale", adset: "9001", adsetName: "Cairo women", ad: "77", adName: "Video A", minor: 300_000n });
  const eidB = spend({ campaign: "120200001", campaignName: "Eid  Sale", adset: "9001", adsetName: "Cairo women", ad: "78", adName: "Carousel B", minor: 100_000n });
  const tiktok = spend({ platform: "tiktok", campaign: "Ramadan", campaignName: "Ramadan", minor: 50_000n });
  const dayTotal = spend({ platform: "google", minor: 20_000n });

  it("matches a campaign by its id or its name, ignoring case and spacing, on the same platform", () => {
    const r = campaignResults("campaign", [eid, eidB, tiktok, dayTotal], [
      order({ utmId: "120200001", utmCampaign: "whatever" }, m(2, 1, 100_000)),
      order({ utmCampaign: "eid sale" }, m(3, 2, 200_000)),
      order({ platform: "tiktok", utmCampaign: "eid sale" }, m(1)), // same name on another platform: not Meta's spend
    ]);
    const meta = r.rows.find((x) => x.platform === "meta" && x.spend !== null)!;
    expect(meta.spend).toBe(400_000n);
    expect(meta.m.orders).toBe(5n);
    expect(meta.m.real).toBe(300_000n);
    expect(meta.campaign).toEqual({ key: "120200001", name: "Eid  Sale" });
    const tiktokEid = r.rows.find((x) => x.platform === "tiktok" && x.spend === null)!;
    expect(tiktokEid.m.orders).toBe(1n);
    expect(r.rows.find((x) => x.campaign.key === "Ramadan")!.m.orders).toBe(0n); // spend with no orders still shows
    expect(r.unassignedSpend).toBe(20_000n); // a day's total has no campaign
  });

  it("goes down to the ad set (utm_term) and the ad (utm_content); untagged orders are totalled apart", () => {
    const orders = [
      order({ utmCampaign: "Eid Sale", utmTerm: "cairo women", utmContent: "Video A" }, m(4, 3)),
      order({ utmCampaign: "Eid Sale", utmTerm: "9001", utmContent: "78" }, m(1, 1)),
      order({ utmCampaign: "Eid Sale" }, m(2)),                     // no ad set tag
      order({ platform: "direct" }, m(5)),                          // organic, no tags at all
    ];
    const adsets = campaignResults("adset", [eid, eidB], orders);
    expect(adsets.rows).toHaveLength(1);
    expect(adsets.rows[0]!.adset).toEqual({ key: "9001", name: "Cairo women" });
    expect(adsets.rows[0]!.m.orders).toBe(5n);
    expect(adsets.untagged.orders).toBe(7n);

    const ads = campaignResults("ad", [eid, eidB], orders);
    expect(ads.rows.map((x) => [x.ad!.name, x.spend, x.m.orders])).toEqual([["Video A", 300_000n, 4n], ["Carousel B", 100_000n, 1n]]);
    expect(ads.untagged.orders).toBe(7n);
  });

  it("keeps spend without the level's key apart instead of guessing", () => {
    const r = campaignResults("adset", [tiktok], [order({ platform: "tiktok", utmCampaign: "Ramadan", utmTerm: "x" }, m(1))]);
    expect(r.unassignedSpend).toBe(50_000n);
    expect(r.rows).toEqual([expect.objectContaining({ spend: null, adset: { key: "x", name: "x" } })]);
  });

  it("puts spend under 'other' against platforms without their own code", () => {
    const other = spend({ platform: "other", campaign: "launch", minor: 10_000n });
    const r = campaignResults("campaign", [other], [order({ platform: "microsoft", utmCampaign: "Launch" }, m(2)), order({ platform: "meta", utmCampaign: "launch" }, m(1))]);
    expect(r.rows[0]!.m.orders).toBe(2n);
    expect(r.rows[1]).toMatchObject({ platform: "meta", spend: null });
  });

  it("normalises tags", () => {
    expect(norm("  Eid  SALE ")).toBe("eid sale");
    expect(norm(null)).toBe("");
  });
});
