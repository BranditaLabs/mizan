"use client";

import type { Outcome } from "@mizan/shared/motion";
import type { ReactNode } from "react";
import { useToast } from "@/components/ui/Toast";

/**
 * The back office's own writes (not domain events): the outcome each one's confirmed toast plays.
 * Screens name the action and the words; this list picks the motion, as the shared catalogue does
 * for the merchant's events. DONE for what changes a store's or a person's standing (suspend,
 * reactivate, plan, taking sign-in away), SETTLE for a routine change. Never DROP: red is the
 * merchant's (test/busy-meaning.test.ts checks it).
 */
export const STAFF_MOTION = {
  "store.suspended": "done",
  "store.reactivated": "done",
  "store.plan_changed": "done",
  "store.note_added": "settle",
  "store.access_opened": "settle",
  "store.sso_saved": "settle",
  "store.sso_paused": "settle",
  "store.sso_resumed": "settle",
  "store.sso_removed": "settle",
  "user.disabled": "done",
  "user.enabled": "settle",
  "staff.added": "settle",
  "staff.role_changed": "settle",
  "staff.disabled": "done",
  "staff.enabled": "settle",
  "flag.created": "settle",
  "flag.saved": "settle",
  "flag.deleted": "settle",
  "flag.store_saved": "settle",
  "flag.store_cleared": "settle",
  "announcement.posted": "settle",
  "announcement.ended": "settle",
  "access.ended": "settle",
  "deadletter.replayed": "settle",
  "feedback.status_changed": "settle",
} as const satisfies Record<string, Exclude<Outcome, "drop">>;

export type StaffAction = keyof typeof STAFF_MOTION;

/** A confirmed staff write's toast: `done("store.suspended", t("done.suspended"))`. */
export function useStaffDone(): (action: StaffAction, message: ReactNode) => void {
  const toast = useToast();
  return (action, message) => toast({ message, outcome: STAFF_MOTION[action] });
}
