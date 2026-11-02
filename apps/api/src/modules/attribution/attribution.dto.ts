import { MoneySchema, SOURCE_PLATFORMS, SOURCE_RULES } from "@mizan/shared";
import { z } from "zod";
import { AD_PLATFORMS } from "../profit/ads/ad-spend.csv.js";
import { LEVELS } from "./campaigns.js";

export const RoasQuerySchema = z.object({
  days: z.coerce.number().int().refine((d) => [7, 14, 30, 90].includes(d), "7, 14, 30 or 90").optional().describe("The last 7, 14, 30 or 90 store days, today included (default 30)"),
  from: z.iso.date().optional().describe("Or a range of store days (with `to`, at most 366)"),
  to: z.iso.date().optional(),
}).refine((q) => Boolean(q.from) === Boolean(q.to), { message: "give from and to together", path: ["to"] });
export type RoasQuery = z.output<typeof RoasQuerySchema>;

const Multiple = z.string().nullable().describe("A multiple with two decimals (\"3.75\" = 3.75×); null when it cannot be known");

export const RoasSchema = z.object({
  from: z.iso.date(), to: z.iso.date(), currency: z.string(),
  spend: MoneySchema, fxMissing: z.boolean().describe("Some spend is in a currency without a rate that day: left out"),
  trueRoas: Multiple.describe("Money that is real (paid, or cash delivered, less refunds) ÷ spend"),
  reportedRoas: Multiple.describe("Every order placed, at its full value ÷ spend: roughly what an ad platform reports"),
  projectedRoas: Multiple.describe("True ROAS if the orders still moving arrive at the rate the finished ones did"),
  costPerOrder: MoneySchema.nullable(), costPerDelivered: MoneySchema.nullable(),
  deliveredRate: z.string().nullable().describe("Delivered ÷ (delivered + refused or returned), percent"),
  lostShare: z.string().nullable().describe("Cancelled, refused or returned ÷ orders placed, percent"),
  orders: z.object({ placed: z.number().int(), delivered: z.number().int(), moving: z.number().int(), cancelled: z.number().int(), returned: z.number().int() }),
  money: z.object({ placed: MoneySchema, real: MoneySchema, pending: MoneySchema, net: MoneySchema.describe("Net profit of these orders, ad costs included") }),
  byPlatform: z.array(z.object({ platform: z.enum(AD_PLATFORMS), spend: MoneySchema, share: z.string().nullable() }))
    .describe("Spend by platform. ROAS per platform and campaign needs each order's ad source (M7-2)"),
  days: z.array(z.object({ day: z.iso.date(), spend: MoneySchema, orders: z.number().int(), delivered: z.number().int(), real: MoneySchema, trueRoas: Multiple })),
});
export type Roas = z.infer<typeof RoasSchema>;

const SourceRow = z.object({
  orders: z.number().int(), delivered: z.number().int(), lost: z.number().int().describe("Cancelled after shipping, refused or returned"),
  placed: MoneySchema, real: MoneySchema.describe("Paid, or cash delivered, less refunds"), net: MoneySchema.describe("Net profit of these orders"),
  deliveredRate: z.string().nullable().describe("Delivered ÷ (delivered + lost), percent"),
});
export const OrderSourcesSchema = z.object({
  from: z.iso.date(), to: z.iso.date(), currency: z.string(),
  orders: z.number().int(), attributedShare: z.string().nullable().describe("Orders with a known source (not unknown or direct), percent"),
  byPlatform: z.array(SourceRow.extend({
    platform: z.enum(SOURCE_PLATFORMS), paid: z.number().int().describe("Of these, from a paid ad"),
    share: z.string().nullable(), spend: MoneySchema.nullable().describe("Ad spend recorded for this platform in the period"),
    trueRoas: z.string().nullable().describe("Real money ÷ spend, when spend is recorded"),
  })).describe("Most orders first; orders with no source are always shown as unknown"),
  campaigns: z.array(SourceRow.extend({ platform: z.enum(SOURCE_PLATFORMS), campaign: z.string() })).describe("UTM campaigns, most orders first (top 20)"),
});
export type OrderSources = z.infer<typeof OrderSourcesSchema>;

export const OrderSourceSchema = z.object({
  platform: z.enum(SOURCE_PLATFORMS), paid: z.boolean().nullable(), rule: z.enum(SOURCE_RULES).describe("Which evidence decided: click_id, utm, referrer, store, channel, none"),
  utm: z.object({ source: z.string().nullable(), medium: z.string().nullable(), campaign: z.string().nullable(), content: z.string().nullable(), term: z.string().nullable() }),
  clickIdKind: z.string().nullable().describe("fbclid, gclid, ttclid… (the id itself is not shown)"),
  referrerDomain: z.string().nullable(), landingPath: z.string().nullable(),
  firstPlatform: z.enum(SOURCE_PLATFORMS).nullable(), firstSeenAt: z.iso.datetime().nullable(), discountCodes: z.array(z.string()),
});

export const CampaignQuerySchema = z.object({
  level: z.enum(LEVELS).default("campaign").describe("Group by campaign, ad set (TikTok: ad group) or ad"),
  days: z.coerce.number().int().refine((d) => [7, 14, 30, 90].includes(d), "7, 14, 30 or 90").optional().describe("The last 7, 14, 30 or 90 store days, today included (default 30)"),
  from: z.iso.date().optional().describe("Or a range of store days (with `to`, at most 366)"),
  to: z.iso.date().optional(),
}).refine((q) => Boolean(q.from) === Boolean(q.to), { message: "give from and to together", path: ["to"] });
export type CampaignQuery = z.output<typeof CampaignQuerySchema>;

const Named = z.object({ key: z.string().describe("The id from the spend export, else the name or the UTM tag"), name: z.string() });
const Outcome = z.object({
  orders: z.number().int(), delivered: z.number().int(), lost: z.number().int().describe("Refused at the door or returned"),
  cancelled: z.number().int().describe("Cancelled before shipping (unreachable, declined at confirmation, fake)"),
  real: MoneySchema.describe("Paid, or cash delivered, less refunds"), net: MoneySchema.describe("Net profit of these orders, ad costs included"),
  deliveredRate: z.string().nullable().describe("Delivered ÷ (delivered + lost), percent"),
  fakeShare: z.string().nullable().describe("Cancelled before shipping, refused or returned ÷ orders, percent: orders the ad paid for that never paid"),
});
export const CampaignResultsSchema = z.object({
  from: z.iso.date(), to: z.iso.date(), currency: z.string(), level: z.enum(LEVELS),
  spend: MoneySchema.describe("All ad spend in the period"), fxMissing: z.boolean().describe("Some spend is in a currency without a rate that day: left out"),
  rows: z.array(Outcome.extend({
    platform: z.enum(SOURCE_PLATFORMS).or(z.enum(AD_PLATFORMS)), campaign: Named, adset: Named.nullable(), ad: Named.nullable(),
    spend: MoneySchema.nullable().describe("Recorded spend; null for orders tagged with a campaign that has no spend recorded"),
    trueRoas: z.string().nullable().describe("Real money ÷ spend"), costPerDelivered: MoneySchema.nullable(),
  })).describe("Spend first (most first), then tagged orders without spend (most orders first); at most 200"),
  truncated: z.boolean().describe("More than 200 rows: the smallest are left out"),
  untagged: Outcome.describe("Orders without this level's UTM tag (organic, direct, unknown, or an ad link without it): always shown"),
  unassignedSpend: MoneySchema.describe("Spend recorded without this level (a day's total, or an export without ad sets or ads)"),
});
export type CampaignResults = z.infer<typeof CampaignResultsSchema>;

export const BackfillSourcesSchema = z.object({ connections: z.number().int().describe("Store connections whose recent orders are read again"), days: z.number().int() });
