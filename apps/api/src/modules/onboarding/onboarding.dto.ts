import { MoneySchema } from "@mizan/shared";
import { z } from "zod";

const At = z.iso.datetime().nullable();

/** GET /v1/onboarding: the four steps, the milestones and time-to-first-value. */
export const OnboardingSchema = z.object({
  steps: z.object({
    store: z.object({
      status: z.enum(["todo", "done"]),
      connectionId: z.uuid().nullable(),
      shop: z.string().nullable(),
      /** The history import after connecting (60 days of orders, then products). */
      import: z.object({ status: z.enum(["running", "done"]), phase: z.enum(["orders", "products", "done"]), orders: z.number().int(), products: z.number().int() }).nullable(),
    }),
    courier: z.object({
      status: z.enum(["todo", "checking", "done", "needs_attention", "skipped"]),
      provider: z.string().nullable(),
      reason: z.string().nullable().describe("key_refused, key_lacks_permission"),
    }),
    costs: z.object({ status: z.enum(["todo", "done", "skipped"]), variants: z.number().int(), missingCost: z.number().int() }),
    firstOrder: z.object({ status: z.enum(["waiting", "done"]), orderId: z.uuid().nullable(), number: z.string().nullable(), total: MoneySchema.nullable(), at: At }),
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
  /** Skip a step (a store that uses another courier, costs entered later) or bring it back. */
  skip: z.strictObject({ courier: z.boolean().optional(), costs: z.boolean().optional() }).optional(),
  dismissed: z.boolean().optional(),
}).refine((b) => b.skip !== undefined || b.dismissed !== undefined, { message: "send skip and/or dismissed" });
export type UpdateOnboardingBody = z.infer<typeof UpdateOnboardingSchema>;

/** tenants.settings.onboarding */
export interface OnboardingSettings { skipped?: { courier?: boolean; costs?: boolean }; dismissedAt?: string | null }
