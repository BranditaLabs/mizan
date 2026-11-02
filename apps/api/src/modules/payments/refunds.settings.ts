import { z } from "zod";
import { plainDecimal } from "../../platform/csv.js";

/** Settings → Refunds (E14-4), in tenants.settings.refunds. */
export const RefundSettingsSchema = z.strictObject({
  approveOver: z.string().transform((v, ctx) => {
    const d = plainDecimal(v);
    if (d === null) {
      ctx.addIssue({ code: "custom", message: "an amount like 1000 or 1000.00" });
      return z.NEVER;
    }
    return d;
  }).describe("Refunds above this amount, in the store's base currency, need owner, admin or finance to approve; 0 means every refund does"),
});
export type RefundSettings = z.output<typeof RefundSettingsSchema>;
/** As the API returns it. */
export const RefundSettingsViewSchema = z.object({ approveOver: z.string().describe("Decimal in the store's base currency, e.g. \"1000.00\"") });

export const DEFAULT_REFUNDS: RefundSettings = { approveOver: "1000.00" };

export function refundSettings(settings: unknown): RefundSettings {
  const parsed = RefundSettingsSchema.safeParse((settings as { refunds?: unknown } | null)?.refunds);
  return parsed.success ? parsed.data : DEFAULT_REFUNDS;
}
