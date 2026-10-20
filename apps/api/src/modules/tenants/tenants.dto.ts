import { COUNTRY_CODES } from "@mizan/shared";
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

export interface TenantView {
  id: string;
  name: string;
  slug: string;
  country: string;
  baseCurrency: string;
  timezone: string;
  locale: string;
  plan: string;
  status: string;
  settings: Record<string, unknown>;
  createdAt: string;
  /** The caller's role in this store. */
  role: string;
}
