import { z } from "zod";

/** A store, courier or other provider connection as the dashboard shows it. */
export const ConnectionViewSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["store", "courier", "whatsapp", "ads", "payment", "tax"]),
  provider: z.string(),
  account: z.string().nullable(),
  status: z.enum(["pending", "active", "needs_attention", "disconnected"]),
  /** Why it needs attention or was disconnected (key_refused, key_lacks_permission, app_uninstalled …). */
  reason: z.string().nullable().describe("key_refused, key_lacks_permission, app_uninstalled …"),
  /** When the credentials last passed a check (couriers). */
  verifiedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});
export type ConnectionView = z.infer<typeof ConnectionViewSchema>;
export const ConnectionListSchema = z.object({ data: z.array(ConnectionViewSchema) });

export const BostaKeySchema = z.strictObject({
  /** From Bosta's dashboard (Settings → API integration). Stored encrypted; never shown again. */
  apiKey: z.string().trim().min(8).max(512).describe("From Bosta's dashboard (Settings → API integration); stored encrypted, never shown again"),
});

type Row = { id: string; kind: string; provider: string; external_account: string | null; status: string; status_reason: string | null; config: unknown; updated_at: Date };

/** kind and status are TEXT with CHECK constraints (migration 0001): the casts name what the database guarantees. */
export function toConnectionView(c: Row): ConnectionView {
  const verifiedAt = (c.config as { verifiedAt?: unknown } | null)?.verifiedAt;
  return {
    id: c.id, kind: c.kind as ConnectionView["kind"], provider: c.provider, account: c.external_account,
    status: c.status as ConnectionView["status"], reason: c.status_reason,
    verifiedAt: typeof verifiedAt === "string" ? verifiedAt : null, updatedAt: c.updated_at.toISOString(),
  };
}
