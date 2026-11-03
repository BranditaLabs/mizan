import type { Schemas } from "@/lib/api/client";

export type Mode = Schemas["OrderPage"]["data"][number]["paymentMode"];
type View = Schemas["SavedView"];
/** The list's filters as the URL keeps them; dates are days (YYYY-MM-DD) in the person's time zone. */
export interface ListFilters { tag?: string; city?: string; courierId?: string; productId?: string; paymentMode?: Mode; from?: string; to?: string }
export const FILTER_KEYS = ["tag", "city", "courierId", "productId", "paymentMode", "from", "to"] as const;
export const MODES: readonly Mode[] = ["cod", "prepaid", "partial", "bnpl", "bank_transfer", "store_credit", "mixed"];

const dayStart = (day: string) => new Date(`${day}T00:00:00`).toISOString();
const nextDay = (day: string) => { const d = new Date(`${day}T00:00:00`); d.setDate(d.getDate() + 1); return d.toISOString(); };
const dayOf = (iso: string, end = false) => {
  const d = new Date(iso);
  if (end) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** The filters as the API takes them: "to" a day means up to the end of that day. */
export function filterQuery(f: ListFilters) {
  return {
    ...(f.tag ? { tag: f.tag } : {}), ...(f.city ? { city: f.city } : {}), ...(f.courierId ? { courierId: f.courierId } : {}),
    ...(f.productId ? { productId: f.productId } : {}), ...(f.paymentMode ? { paymentMode: f.paymentMode } : {}),
    ...(f.from ? { from: dayStart(f.from) } : {}), ...(f.to ? { to: nextDay(f.to) } : {}),
  };
}

/** A saved view's filters back as the list's (the tab and search are applied by the caller). */
export function viewFilters(v: View["filters"]): ListFilters {
  return {
    ...(v.tag ? { tag: v.tag } : {}), ...(v.city ? { city: v.city } : {}), ...(v.courierId ? { courierId: v.courierId } : {}),
    ...(v.productId ? { productId: v.productId } : {}), ...(v.paymentMode ? { paymentMode: v.paymentMode } : {}),
    ...(v.from ? { from: dayOf(v.from) } : {}), ...(v.to ? { to: dayOf(v.to, true) } : {}),
  };
}
