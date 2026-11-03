import { rolesWith } from "@mizan/shared";
import type { BadgeTone } from "@/components/ui/Badge";
import type { Schemas } from "@/lib/api/client";

export type PoStatus = Schemas["PurchaseOrder"]["status"];
export const PO_STATUSES: readonly PoStatus[] = ["draft", "approved", "sent", "partially_received", "received", "cancelled"];
export const STATUS_TONE: Record<PoStatus, BadgeTone> = {
  draft: "neutral", approved: "info", sent: "info", partially_received: "warning", received: "success", cancelled: "neutral",
};
/** Who may see the purchase orders; who drafts, approves, sends and cancels; who receives; who approves anything. */
export const VIEWERS = rolesWith("purchasing.read");
export const MANAGERS = rolesWith("purchasing.manage");
export const RECEIVERS = rolesWith("purchasing.receive");
export const OWNERS = rolesWith("purchasing.approve_large");
export const SUPPLIER_READERS = rolesWith("suppliers.read");
export const RECEIVABLE = new Set<PoStatus>(["approved", "sent", "partially_received"]);
/** A non-negative amount with at most 3 decimals (the API checks the currency's own). */
export const AMOUNT = /^\d{1,12}(\.\d{1,3})?$/;
