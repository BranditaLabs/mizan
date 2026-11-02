import type { IconProps } from "@mizan/design-system/icons/react";
import type { BadgeTone } from "@/components/ui/Badge";
import type { Schemas } from "@/lib/api/client";

export type OrderStatus = Schemas["OrderDetail"]["status"];
export type PaymentModeValue = Schemas["OrderDetail"]["paymentMode"];

/** Status badge tones (components.md §4): one meaning per colour across the list and the detail. */
export const STATUS_TONE: Record<OrderStatus, BadgeTone> = {
  new: "neutral", pending_confirmation: "warning", confirmed: "success", shipped: "info", delivered: "success", cancelled: "neutral", returned: "danger",
};
export const MODE_ICON: Record<PaymentModeValue, IconProps["name"]> = {
  cod: "cod", prepaid: "card", partial: "deposit", bnpl: "bnpl", bank_transfer: "bank-transfer", store_credit: "wallet", mixed: "payments", unknown: "help",
};
export const isStatus = (v: string | null | undefined): v is OrderStatus => v !== null && v !== undefined && v in STATUS_TONE;

/** Only the last four digits ever reach the browser; the dots say the rest is hidden. */
export const maskedLast4 = (last4: string) => `••• ${last4}`;
