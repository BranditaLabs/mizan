import { COUNTRY_CODES, MEMBER_ROLES } from "@mizan/shared";
import { z } from "zod";
import { LegalVersionsSchema } from "../legal/legal.dto.js";
import { SIGNUP_PLANS } from "../billing/trial.service.js";

export const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export const CreateTenantSchema = z.strictObject({
  name: z.string().trim().min(2).max(80),
  country: z.enum(COUNTRY_CODES as [string, ...string[]]),
  /** Optional; derived from the name when omitted. */
  slug: z.string().regex(SLUG, "3–40 characters: a-z, 0-9 and dashes").optional(),
  /** Dashboard language; default Arabic. */
  language: z.enum(["ar", "en"]).default("ar"),
  /** The terms and DPA versions the owner ticked; recorded with the store (L1-3). */
  acceptLegal: LegalVersionsSchema.optional().describe("The terms of service and DPA versions the owner accepted; 409 legal_version_changed when not current"),
  /** The tier to try (E12-2a2); Growth when absent. Enterprise leads try Scale. Free only when sold publicly. The dashboard sends it once OB-3 carries the landing's choice to signup; nothing sends it yet. */
  plan: z.enum(SIGNUP_PLANS).optional().describe("The tier to try for trial_days (Growth when absent; enterprise = a Scale trial; free only when Free is sold publicly). Not sent by the dashboard yet (OB-3)"),
  interval: z.enum(["month", "year"]).optional().describe("Monthly or yearly billing after the trial; monthly when absent. Not sent by the dashboard yet (OB-3)"),
});
export type CreateTenantBody = z.infer<typeof CreateTenantSchema>;

/** A valid IANA time zone ("Africa/Cairo", "Asia/Riyadh"). */
const isTimeZone = (tz: string) => {
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
};

/**
 * The store's profile (A-8). Country and currency stay as signed up: money in minor units and
 * daily FX depend on them. The time zone decides where a day starts for reports and usage.
 */
export const UpdateTenantSchema = z.strictObject({
  name: z.string().trim().min(2).max(80).optional(),
  timezone: z.string().max(64).refine(isTimeZone, "not a known time zone").optional(),
  locale: z.string().regex(/^(ar|en)-[A-Z]{2}$/, "like ar-EG or en-SA").optional().describe("Language and region for customer messages and documents"),
}).refine((b) => Object.keys(b).length > 0, "change at least one field");
export type UpdateTenantBody = z.infer<typeof UpdateTenantSchema>;

/** The store's platform lifecycle. A trial is the subscription's status (GET /v1/billing/subscription), not the store's (E12-2a3). */
export const TENANT_STATUSES = ["active", "suspended", "deleted"] as const;
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
