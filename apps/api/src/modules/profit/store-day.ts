import { sql, type Transaction } from "kysely";
import type { DB } from "@mizan/db";

/** A calendar day (YYYY-MM-DD) in a time zone: profit days follow the store's clock, not UTC. */
export const localDay = (at: Date, timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** DATE columns read as text, so no driver ever shifts them through a local midnight. */
export const dayText = (column: string) => sql<string>`to_char(${sql.ref(column)}, 'YYYY-MM-DD')`;

/** A YYYY-MM-DD string as a DATE operand (comparisons on DATE columns). */
export const asDate = (day: string) => sql<Date>`${day}::date`;

export async function storeClock(trx: Transaction<DB>, tenantId: string): Promise<{ base: string; timezone: string }> {
  const t = await trx.selectFrom("tenants").select(["base_currency", "timezone"]).where("id", "=", tenantId).executeTakeFirstOrThrow();
  return { base: t.base_currency.trim(), timezone: t.timezone };
}
