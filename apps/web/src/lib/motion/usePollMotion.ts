"use client";

import { useEffect, useRef } from "react";
import { useEventMotion } from "./EventMotionProvider";

/**
 * A poll's transitions as facts: between two reads of the same data, each entity whose status moved
 * becomes one event for the motion provider (which dedupes, merges and rate-limits). The first read
 * is history: what was already there when the screen opened never animates.
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
  statusOf: (item: T) => string | null | undefined,
  event: (from: string | null | undefined, to: string | null | undefined, item: T) => string | null,
  opts: { enabled?: boolean } = {},
) {
  const motion = useEventMotion();
  const seen = useRef<Map<string, string | null | undefined> | null>(null);
  const fns = useRef({ idOf, statusOf, event });
  useEffect(() => { fns.current = { idOf, statusOf, event }; });
  const enabled = opts.enabled !== false;
  useEffect(() => {
    if (!items || !enabled) return;
    const { idOf: id, statusOf: st, event: ev } = fns.current;
    const now = new Map(items.map((it) => [id(it), st(it)] as const));
    const before = seen.current;
    seen.current = now;
    if (!before) return; // the first read is history
    for (const it of items) {
      const key = id(it);
      const from = before.has(key) ? before.get(key) : undefined;
      const to = now.get(key);
      if (before.has(key) && from === to) continue;
      const type = ev(before.has(key) ? from : undefined, to, it);
      // A new row is fresh under its own id (useFresh(row.id)); a status move under the transition.
      if (type) motion.push({ id: before.has(key) ? `${type}:${key}:${to ?? ""}` : key, type, entityId: key, at: Date.now(), source: "poll" });
    }
  }, [items, enabled, motion]);
}
