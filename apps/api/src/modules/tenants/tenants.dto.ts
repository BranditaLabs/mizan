import { COUNTRY_CODES, MEMBER_ROLES } from "@mizan/shared";
import { z } from "zod";

export const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export const CreateTenantSchema = z.strictObject({
  name: z.string().trim().min(2).max(80),
  country: z.enum(COUNTRY_CODES as [string, ...string[]]),
  /** Optional; derived from the name when omitted. */
  slug: z.string().regex(SLUG, "3–40 characters: a-z, 0-9 and dashes").optional(),
  /** Dashboard language; default Arabic. */
  language: z.enum(["ar", "en"]).default("ar"),
});
export type CreateTenantBody = z.infer<typeof CreateTenantSchema>;

export const TENANT_STATUSES = ["trial", "active", "suspended", "deleted"] as const;
export const TENANT_PLANS = ["free", "growth", "scale", "enterprise"] as const;

export const TenantViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  country: z.string().describe("ISO 3166-1 alpha-2"),
  baseCurrency: z.string().describe("ISO 4217"),
  timezone: z.string(),
  locale: z.string(),
  plan: z.enum(TENANT_PLANS),
  status: z.enum(TENANT_STATUSES),
  settings: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
  /** The caller's role in this store. */
  role: z.enum(MEMBER_ROLES).describe("The caller's role in this store"),
});
export type TenantView = z.infer<typeof TenantViewSchema>;
