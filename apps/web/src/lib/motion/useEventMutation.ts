"use client";

import type { EventData } from "@mizan/shared/motion";
import { useMutation, type DefaultError, type UseMutationOptions, type UseMutationResult } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * What a mutation tells the motion provider (`meta.motion`, read by the global success handler in
 * lib/api/query.tsx). Functions get the mutation's response and variables.
 */
export interface MotionMeta {
  /** The catalogue event this action is (`order.confirmed`), or one picked from the answer. */
  type: string | ((data: unknown, variables: unknown) => string);
  /** The entity it touched: the same event arriving from a poll or the live stream within 8 s plays nothing (echo). */
  entityId?: (data: unknown, variables: unknown) => string;
  /** The non-PII facts the event's variant reads (`{ data: { to: "paid" } }`, `{ actor: { type: "user" } }`). */
  data?: (data: unknown, variables: unknown) => EventData;
  /** The screen's own sentence for the toast; null or undefined: the catalogue's `motion.event.<type>`. */
  message?: (data: unknown, variables: unknown) => ReactNode | null | undefined;
  /** false: no toast (the screen shows the result in place). */
  toast?: boolean;
}

export interface EventMotionOptions<TData, TVars> {
  /** One mutation, two events (confirm or cancel): pick the one that happened from the answer. */
  pick?: (data: TData, variables: TVars) => string;
  entityId?: (data: TData, variables: TVars) => string;
  data?: (data: TData, variables: TVars) => EventData;
  message?: (data: TData, variables: TVars) => ReactNode | null | undefined;
  toast?: boolean;
}

/** A mutation result that also names its event, so `<Button busy={m}>` shows the event's loader. */
export type EventMutation<TData, TVars> = UseMutationResult<TData, DefaultError, TVars> & { motion: string };

/**
 * useMutation that names its catalogue event. While it runs, `<Button busy={m}>` shows the event's
 * pending loader (drop for saving or sending, transfer for syncing, fill for known progress); on
 * success the provider plays the outcome on every mounted surface and confirms it in a toast (the
 * catalogue copy, or `message`). Screens never pick an animation.
 *
 *   const confirm = useEventMutation("order.confirmed", { mutationFn, onSuccess }, { entityId: () => id });
 *   <Button busy={confirm} onClick={() => confirm.mutate()}>…</Button>
 */
export function useEventMutation<TData = unknown, TVars = void>(
  type: string,
  options: UseMutationOptions<TData, DefaultError, TVars>,
  motion: EventMotionOptions<TData, TVars> = {},
): EventMutation<TData, TVars> {
  const meta: MotionMeta = {
    type: motion.pick ? (motion.pick as (d: unknown, v: unknown) => string) : type,
    ...(motion.entityId ? { entityId: motion.entityId as MotionMeta["entityId"] } : {}),
    ...(motion.data ? { data: motion.data as MotionMeta["data"] } : {}),
    ...(motion.message ? { message: motion.message as MotionMeta["message"] } : {}),
    ...(motion.toast === false ? { toast: false } : {}),
  };
  const m = useMutation<TData, DefaultError, TVars>({ ...options, meta: { ...options.meta, motion: meta } });
  return { ...m, motion: type };
}
