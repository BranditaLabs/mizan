/**
 * The team's notices from what happens after confirmation: stored as "kind|number|code" with the
 * source "after_confirmation", and told in each reader's language by the notification bell. The
 * order number and a reason code only: never a name, phone, address or what the customer typed.
 */
export type NoticeKind = "confirmed" | "changed" | "cancelled" | "no_answer" | "opted_out" | "customer_message" | "auto_cancelled" | "followup_dead" | "blocked";

export const NOTICE_SOURCE = "after_confirmation";

export function notice(kind: Exclude<NoticeKind, "blocked">, number: string): string {
  return `${kind}|${number}|`;
}

export function blockedNotice(code: string, number: string): string {
  return `blocked|${number}|${code}`;
}
