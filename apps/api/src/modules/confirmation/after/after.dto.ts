import { AfterConfirmationSchema } from "@mizan/shared";
import { z } from "zod";

export const AfterConfirmationViewSchema = z.object({
  settings: AfterConfirmationSchema,
  couriers: z.array(z.object({ id: z.uuid(), provider: z.string(), name: z.string(), status: z.string() })).describe("Bosta connections a store can book with"),
  members: z.array(z.object({ id: z.uuid(), name: z.string(), role: z.string() })).describe("Active team members (for who takes a change request)"),
  recommended: AfterConfirmationSchema.describe("A starting point the screen can fill in; never applied by itself"),
});

export const AfterReleaseSchema = z.object({ released: z.boolean(), autoBook: z.boolean() });
export const AfterSkipSchema = z.object({ autoBook: z.literal(false) });
