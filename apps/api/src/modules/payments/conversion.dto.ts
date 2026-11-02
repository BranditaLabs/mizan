import { z } from "zod";

/** E14-3: how the customer of a COD order can pay before shipping (gateway links come with E14-2). */
export const CONVERSION_METHODS = ["instapay", "wallet", "bank_transfer", "link"] as const;
export type ConversionMethod = (typeof CONVERSION_METHODS)[number];

const Amount = z.string().trim().regex(/^\d{1,12}(\.\d{1,3})?$/, "an amount like 300 or 300.50");

/** Settings → Payments → Convert COD (tenants.settings.conversion): where customers pay, and the defaults. */
export const ConversionSettingsSchema = z.strictObject({
  depositPct: z.number().int().min(5).max(90).default(30).describe("A deposit offer asks for this share of what is owed"),
  expiresHours: z.number().int().min(1).max(168).default(24),
  methods: z.strictObject({
    instapay: z.string().trim().max(120).optional().describe("The store's InstaPay address, e.g. store@instapay"),
    wallet: z.string().trim().max(120).optional().describe("The store's wallet number"),
    bank_transfer: z.string().trim().max(200).optional().describe("Bank, account name and IBAN"),
    link: z.url().max(300).optional().describe("A payment page the store already has"),
  }).default({}),
});
export type ConversionSettings = z.output<typeof ConversionSettingsSchema>;
export function conversionSettings(settings: unknown): ConversionSettings {
  const parsed = ConversionSettingsSchema.safeParse((settings as { conversion?: unknown } | null)?.conversion ?? {});
  return parsed.success ? parsed.data : ConversionSettingsSchema.parse({});
}

export const NewConversionSchema = z.strictObject({
  purpose: z.enum(["full", "deposit"]),
  amount: Amount.optional().describe("Deposit only: the amount (default the store's deposit share of what is owed)"),
  method: z.enum(CONVERSION_METHODS),
  instructions: z.string().trim().min(1).max(300).optional().describe("Where to pay; defaults to the store's for this method"),
});
export type NewConversion = z.infer<typeof NewConversionSchema>;

const Money = z.object({ amount: z.string(), currency: z.string() });
export const ConversionSchema = z.object({
  id: z.uuid(),
  purpose: z.enum(["full", "deposit"]),
  method: z.enum(CONVERSION_METHODS),
  status: z.enum(["open", "paid", "expired", "cancelled"]),
  amount: Money,
  instructions: z.string().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  paidAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  source: z.enum(["manual", "automation", "gateway"]),
});
export type Conversion = z.infer<typeof ConversionSchema>;

export const OrderConversionSchema = z.object({
  eligible: z.boolean().describe("A COD order not yet shipped with cash still to collect"),
  reason: z.enum(["not_cod", "nothing_owed", "already_shipped", "closed"]).nullable(),
  owed: Money.describe("What the courier would collect today"),
  deposit: Money.describe("The default deposit"),
  methods: z.array(z.enum(CONVERSION_METHODS)).describe("Methods the store has set up"),
  current: ConversionSchema.nullable().describe("The latest offer"),
  message: z.object({ ar: z.string(), en: z.string() }).nullable().describe("For an open offer: the text to send the customer"),
});
export type OrderConversion = z.infer<typeof OrderConversionSchema>;
