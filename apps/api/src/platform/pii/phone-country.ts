import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { PhoneCountry } from "@mizan/shared";

/** Country used to read local phone numbers for a store: settings.phoneCountry, else the store's country, else Egypt. */
export async function phoneCountryOf(trx: Transaction<DB>, tenantId: string): Promise<PhoneCountry> {
  const tenant = await trx.selectFrom("tenants").select(["settings", "country"]).where("id", "=", tenantId).executeTakeFirstOrThrow();
  const settings = (typeof tenant.settings === "string" ? JSON.parse(tenant.settings) : tenant.settings ?? {}) as { phoneCountry?: PhoneCountry };
  return settings.phoneCountry ?? (["EG", "SA", "AE"].includes(tenant.country) ? (tenant.country as PhoneCountry) : "EG");
}
