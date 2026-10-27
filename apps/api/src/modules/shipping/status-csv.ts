import { toAsciiDigits, type ShipmentStatus } from "@mizan/shared";
import { headerKey, readCsv } from "../../platform/csv.js";

/**
 * The courier statuses file (E7-6): for couriers without an API (or when one is down), the
 * courier's daily report as CSV — a tracking number and a status per row, optionally the date and
 * a note. A status is a canonical key or what couriers write in Arabic or English. All or nothing:
 * any line that can't be read is named and nothing is applied.
 */
const HEADERS: Record<string, "tracking" | "status" | "date" | "note"> = {
  tracking: "tracking", "tracking number": "tracking", "tracking no": "tracking", awb: "tracking", "awb number": "tracking", "shipment number": "tracking",
  "رقم الشحنة": "tracking", "رقم البوليصة": "tracking", "رقم التتبع": "tracking", "البوليصة": "tracking",
  status: "status", state: "status", "shipment status": "status", "delivery status": "status", "الحالة": "status", "حالة الشحنة": "status",
  date: "date", "status date": "date", "updated at": "date", "التاريخ": "date", "تاريخ الحالة": "date",
  note: "note", notes: "note", comment: "note", remarks: "note", "ملاحظة": "note", "ملاحظات": "note",
};

/** Words couriers use, first match wins (final statuses first, so "delivery failed" never reads as delivered). */
const WORDS: Array<[RegExp, ShipmentStatus]> = [
  [/^(failed[ _]attempt|delivery failed|not delivered|customer (not available|unreachable)|محاولة( توصيل)? فاشلة|لم يتم التسليم|العميل مش موجود)$/i, "failed_attempt"],
  [/^(delivered|delivery confirmed|تم التسليم|تم التوصيل|اتسلم|اتسلمت|مسلم|مسلمة)$/i, "delivered"],
  [/^(returning|return in progress|جاري الإرجاع|راجعة|في الطريق للراسل)$/i, "returning"],
  [/^(returned|returned to (business|shipper|origin)|refused|مرتجع|مرتجعة|تم الإرجاع|رجعت|رفض الاستلام)$/i, "returned"],
  [/^(cancelled|canceled|terminated|ملغي|ملغية|تم الإلغاء)$/i, "cancelled"],
  [/^(lost|مفقود|مفقودة)$/i, "lost"],
  [/^(out[ _]for[ _]delivery|خرج للتوصيل|خرجت للتوصيل|مع المندوب)$/i, "out_for_delivery"],
  [/^(in[ _]transit|في الطريق|بين الفروع)$/i, "in_transit"],
  [/^(picked[ _]up|received at warehouse|تم الاستلام|اتستلمت من التاجر)$/i, "picked_up"],
  [/^(pickup[ _]requested|waiting for pickup|مستني الاستلام)$/i, "pickup_requested"],
  [/^(created|new|جديدة)$/i, "created"],
];

export const MAX_STATUS_ROWS = 5000;
export interface StatusRow { line: number; tracking: string; status: ShipmentStatus; at?: Date; note?: string }
export interface StatusCsvProblem { line: number; problem: "header" | "columns" | "tracking" | "status" | "date" | "duplicate" | "too_many" | "empty" | "unknown_tracking" | "not_booked"; value?: string }

export function statusOf(text: string): ShipmentStatus | null {
  const v = text.trim().replace(/\s+/g, " ");
  for (const [re, status] of WORDS) if (re.test(v)) return status;
  return null;
}

/** "2026-10-27", "2026-10-27 14:30", an ISO time with its offset; never in the future. */
function dateOf(text: string, now: Date): Date | null {
  const v = toAsciiDigits(text.trim());
  let d: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) d = new Date(`${v}T12:00:00Z`);
  else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(v)) d = new Date(`${v.replace(" ", "T")}Z`);
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v)) d = new Date(v);
  else return null;
  return Number.isNaN(d.getTime()) || d.getTime() > now.getTime() + 5 * 60_000 ? null : d;
}

export function parseStatusCsv(text: string, now = new Date()): { rows: StatusRow[]; problems: StatusCsvProblem[] } {
  const csv = readCsv(text);
  if (!csv) return { rows: [], problems: [{ line: 1, problem: "empty" }] };
  const cols = csv.header.fields.map((h) => HEADERS[headerKey(h)]);
  const at = (k: "tracking" | "status" | "date" | "note") => cols.indexOf(k);
  if (at("tracking") < 0 || at("status") < 0) return { rows: [], problems: [{ line: csv.header.line, problem: "header" }] };
  const rows: StatusRow[] = [];
  const problems: StatusCsvProblem[] = [];
  const seen = new Set<string>();
  for (const { line, fields: f } of csv.rows) {
    if (rows.length + problems.length >= MAX_STATUS_ROWS) { problems.push({ line, problem: "too_many" }); break; }
    if (f.length <= Math.max(at("tracking"), at("status"))) { problems.push({ line, problem: "columns" }); continue; }
    const tracking = toAsciiDigits((f[at("tracking")] ?? "").trim()).replace(/^'/, "");
    if (!/^[\w-]{3,64}$/.test(tracking)) { problems.push({ line, problem: "tracking", value: tracking }); continue; }
    if (seen.has(tracking)) { problems.push({ line, problem: "duplicate", value: tracking }); continue; }
    const statusText = f[at("status")] ?? "";
    const status = statusOf(statusText);
    if (!status) { problems.push({ line, problem: "status", value: statusText.trim() }); continue; }
    const dateText = at("date") >= 0 ? (f[at("date")] ?? "").trim() : "";
    const when = dateText ? dateOf(dateText, now) : undefined;
    if (when === null) { problems.push({ line, problem: "date", value: dateText }); continue; }
    const note = at("note") >= 0 ? (f[at("note")] ?? "").trim().slice(0, 300) : "";
    seen.add(tracking);
    rows.push({ line, tracking, status, ...(when ? { at: when } : {}), ...(note ? { note } : {}) });
  }
  if (!rows.length && !problems.length) problems.push({ line: csv.header.line + 1, problem: "empty" });
  return { rows, problems };
}
