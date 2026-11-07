"use client";

import { useEffect, useRef } from "react";
import type { MotionInput } from "@mizan/design-system/motion";
import { useEventMotion } from "./EventMotionProvider";

export type PollStatus = string | null | undefined;
export type PollEvent<T> = (from: PollStatus, to: PollStatus, item: T) => string | null;

/**
 * One poll read against the previous one (pure, tested): the events to push and the new snapshot.
 * `before` null is the first read (history: nothing plays). A status move is pushed under an id that
 * carries `serial` (one per read), so the same entity making the same move again later plays again;
 * the scheduler's seen-id memory only drops true replays.
 */
export function diffPoll<T>(
  before: Map<string, PollStatus> | null,
  items: readonly T[],
  idOf: (item: T) => string,
  statusOf: (item: T) => PollStatus,
  event: PollEvent<T>,
  serial: number,
  at: number,
): { now: Map<string, PollStatus>; pushes: MotionInput[] } {
  const now = new Map(items.map((it) => [idOf(it), statusOf(it)] as const));
  const pushes: MotionInput[] = [];
  if (!before) return { now, pushes };
  for (const it of items) {
    const key = idOf(it);
    const known = before.has(key);
    const from = known ? before.get(key) : undefined;
    const to = now.get(key);
    if (known && from === to) continue;
    const type = event(known ? from : undefined, to, it);
    // A new row is fresh under its own id (useFresh(row.id)); a status move under the transition and the read.
    if (type) pushes.push({ id: known ? `${type}:${key}:${to ?? ""}:${serial}` : key, type, entityId: key, at, source: "poll" });
  }
  return { now, pushes };
}

/**
 * A poll's transitions as facts: between two reads of the same data, each entity whose status moved
 * becomes one event for the motion provider (which dedupes, merges and rate-limits). The first read
 * is history: what was already there when the screen opened never animates. When the data goes away
 * (the query key changed: another store, another order) or `opts.key` changes, the next read is a
 * first read again, so a switched store's rows are history, not news.
 *
 *   usePollMotion(q.data?.shipments, (s) => s.id, (s) => s.booking,
 *     (from, to) => (from === "pending" && to === "booked" ? "shipment.created" : null));
 *
 * `event` returns the catalogue type for a transition (or null: nothing to play). Entities seen for
 * the first time after the first read pass `from` = undefined (a new bell row, a new timeline row).
 */
export function usePollMotion<T>(
  items: readonly T[] | undefined,
  idOf: (item: T) => string,
  statusOf: (item: T) => PollStatus,
  event: PollEvent<T>,
  opts: { enabled?: boolean; key?: string } = {},
) {
  const motion = useEventMotion();
  const seen = useRef<Map<string, PollStatus> | null>(null);
  const serial = useRef(0);
  const lastKey = useRef(opts.key);
  const fns = useRef({ idOf, statusOf, event });
  useEffect(() => { fns.current = { idOf, statusOf, event }; });
  const enabled = opts.enabled !== false;
  useEffect(() => {
    if (lastKey.current !== opts.key) { lastKey.current = opts.key; seen.current = null; }
    if (!items || !enabled) { seen.current = null; return; }
    const { idOf: id, statusOf: st, event: ev } = fns.current;
    const { now, pushes } = diffPoll(seen.current, items, id, st, ev, ++serial.current, Date.now());
    seen.current = now;
    for (const p of pushes) motion.push(p);
  }, [items, enabled, motion, opts.key]);
}
