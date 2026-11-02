import { MoneySchema } from "@mizan/shared";
import { z } from "zod";

const At = z.iso.datetime().nullable();

/** Where the store sells (A1): the channel chosen first in setup. "manual": no online store yet, orders typed in. */
export const SALES_CHANNELS = ["shopify", "woocommerce", "easyorders", "other", "manual"] as const;
export type SalesChannel = (typeof SALES_CHANNELS)[number];

/** GET /v1/onboarding: the steps (channel and store first), the milestones and time-to-first-value. */
export const OnboardingSchema = z.object({
  steps: z.object({
    store: z.object({
      status: z.enum(["todo", "done"]).describe("done: a store is connected, or the store sells by hand (channel manual)"),
      channel: z.enum(SALES_CHANNELS).nullable().describe("The sales channel chosen in setup; null before the choice (a connected store counts as its platform)"),
      provider: z.string().nullable().describe("The connected store's platform: shopify, woocommerce"),
      connectionId: z.uuid().nullable(),
      shop: z.string().nullable(),
      /** The history import after connecting (60 days of orders, then products). */
      import: z.object({
        status: z.enum(["running", "done", "failed"]), phase: z.enum(["orders", "products", "done"]), orders: z.number().int(), products: z.number().int(),
        error: z.string().nullable().describe("Why it failed: auth (the store refused Mizan), permission, permanent, transient…; retry with POST /connections/{id}/import"),
      }).nullable(),
      /** Permissions added since the store was connected; the owner approves them in Shopify (connect again). */
      missingScopes: z.array(z.string()),
    }),
    courier: z.object({
      status: z.enum(["todo", "checking", "done", "needs_attention", "skipped"]),
      provider: z.string().nullable(),
      reason: z.string().nullable().describe("key_refused, key_lacks_permission"),
    }),
    costs: z.object({ status: z.enum(["todo", "done", "skipped"]), variants: z.number().int(), missingCost: z.number().int() }),
    firstOrder: z.object({ status: z.enum(["waiting", "done"]), orderId: z.uuid().nullable(), number: z.string().nullable(), total: MoneySchema.nullable(), at: At }),
    // A4: the steps that grow the store once it runs; not needed for `complete`.
    team: z.object({ status: z.enum(["todo", "done", "skipped"]), members: z.number().int().describe("Active members"), invited: z.number().int().describe("Invitations waiting") }),
    whatsapp: z.object({ status: z.enum(["todo", "checking", "done", "needs_attention", "skipped"]), reason: z.string().nullable() }),
    payments: z.object({ status: z.enum(["todo", "done", "skipped"]).describe("done: payment links and deposits (Settings → Payments) saved") }),
    returns: z.object({ status: z.enum(["todo", "done", "skipped"]).describe("done: the refund approval rule (Settings → Refunds) saved") }),
  }),
  milestones: z.object({ signup: At, storeConnected: At, courierConnected: At, costsEntered: At, firstOrderSynced: At }),
  /** Signup → first order synced, in seconds; null until the first order arrives. */
  timeToFirstValueS: z.number().int().nullable(),
  complete: z.boolean(),
  /** The owner hid the setup card. */
  dismissed: z.boolean(),
});
export type Onboarding = z.infer<typeof OnboardingSchema>;

export const UpdateOnboardingSchema = z.strictObject({
  /** The sales channel (A1): a platform to connect, or "manual" to start with orders typed in. */
  channel: z.enum(SALES_CHANNELS).optional(),
  /** Skip a step (a store that uses another courier, costs entered later, no team yet…) or bring it back. */
  skip: z.strictObject({
    courier: z.boolean().optional(), costs: z.boolean().optional(),
    team: z.boolean().optional(), whatsapp: z.boolean().optional(), payments: z.boolean().optional(), returns: z.boolean().optional(),
  }).optional(),
  dismissed: z.boolean().optional(),
}).refine((b) => b.skip !== undefined || b.dismissed !== undefined || b.channel !== undefined, { message: "send channel, skip and/or dismissed" });
export type UpdateOnboardingBody = z.infer<typeof UpdateOnboardingSchema>;

/** tenants.settings.onboarding */
export type SkippableStep = "courier" | "costs" | "team" | "whatsapp" | "payments" | "returns";
export interface OnboardingSettings { channel?: SalesChannel; skipped?: Partial<Record<SkippableStep, boolean>>; dismissedAt?: string | null }
