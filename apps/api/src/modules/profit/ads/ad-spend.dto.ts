import { MoneySchema } from "@mizan/shared";
import { z } from "zod";
import { AD_PLATFORMS } from "./ad-spend.csv.js";

const Day = z.iso.date().describe("YYYY-MM-DD in the store's time zone");
const Platform = z.enum(AD_PLATFORMS);

export const AdSpendQuerySchema = z.object({
  from: Day.optional().describe("First day (default: 29 days before today)"),
  to: Day.optional().describe("Last day (default: today)"),
});

/** One day's spend on one platform for one store (a day's total, or a campaign from a CSV). */
export const SetAdSpendSchema = z.strictObject({
  day: Day,
  platform: Platform,
  amount: z.string().trim().regex(/^\d{1,12}(\.\d{1,3})?$/, "a decimal amount like 2500 or 2500.50").describe("What the platform charged that day"),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional().describe("Default: the store's base currency"),
  connectionId: z.uuid().optional().describe("The store the ads sold for (default: the only store)"),
});

export const ImportAdSpendSchema = z.strictObject({
  csv: z.string().min(1).max(1_000_000).describe("The file's text: a header row with date and spend, and platform (or `platform` below), optional currency and campaign"),
  platform: Platform.optional().describe("Platform for every row when the file has no platform column"),
  connectionId: z.uuid().optional(),
});

export const AdSpendRowSchema = z.object({
  day: z.string(),
  platform: Platform,
  campaign: z.string().nullable(),
  spend: MoneySchema,
  source: z.enum(["manual", "csv", "api"]),
  connectionId: z.uuid(),
  updatedAt: z.string(),
});

export const AdSpendDaySchema = z.object({
  day: z.string(),
  connectionId: z.uuid(),
  spend: MoneySchema.describe("The day's spend in the base currency"),
  orders: z.number().int().describe("Orders that share it (placed that day, not cancelled before shipping)"),
  perOrder: MoneySchema.nullable().describe("Each order's share (null when no order shares it: unallocated)"),
  fxMissing: z.boolean().describe("Some spend is in a currency without a rate that day; not counted"),
});

export const AdSpendListSchema = z.object({
  from: z.string(),
  to: z.string(),
  baseCurrency: z.string(),
  total: MoneySchema,
  unallocated: MoneySchema.describe("Spend on days with no order to carry it: still a cost, shown, never hidden"),
  byPlatform: z.array(z.object({ platform: Platform, spend: MoneySchema })),
  days: z.array(AdSpendDaySchema),
  data: z.array(AdSpendRowSchema),
});

export const AdSpendImportedSchema = z.object({
  rows: z.number().int(),
  days: z.number().int().describe("Days whose spend was replaced by the file"),
});

export const AdSpendParamsSchema = z.object({ day: Day, platform: Platform });
export const AdSpendDeleteQuerySchema = z.object({ connectionId: z.uuid().optional() });
