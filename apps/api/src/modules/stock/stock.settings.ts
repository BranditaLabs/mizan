import { z } from "zod";

/** Settings → Inventory (E8-5), in tenants.settings.inventory. */
export const InventorySettingsSchema = z.strictObject({
  pushToStore: z.boolean().describe("Send Mizan's available count of counted items to the store (Shopify), so the store never sells what Mizan has reserved or doesn't have"),
});
export type InventorySettings = z.infer<typeof InventorySettingsSchema>;

export const DEFAULT_INVENTORY: InventorySettings = { pushToStore: false };

export function inventorySettings(settings: unknown): InventorySettings {
  const parsed = InventorySettingsSchema.safeParse((settings as { inventory?: unknown } | null)?.inventory);
  return parsed.success ? parsed.data : DEFAULT_INVENTORY;
}
