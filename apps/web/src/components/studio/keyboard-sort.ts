"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

/**
 * Keyboard reordering for the studio's sortable lists (the steps, the cancel reasons): Space or
 * Enter lifts the item, the arrow keys move it, Space or Enter drops it, Escape puts it back. Each
 * move is applied at once (the list itself is the preview) and announced in the live region; the
 * handle keeps the focus as the item moves. Pointer and touch drags stay with dnd-kit.
 *
 * Our own rather than dnd-kit's keyboard sensor: its coordinates land on the wrong item when the
 * items differ much in height (the WhatsApp step carries the branch grid) or the page scrolls.
 */
export function useKeyboardSort<T>(opts: {
  items: readonly T[];
  idOf(item: T): string;
  /** The new order after moving `from` one place up (-1) or down (+1); the same array when it can't move. */
  move(items: readonly T[], from: number, by: -1 | 1): T[];
  onChange(next: T[]): void;
  say: { picked(item: T, i: number): string; moved(item: T, i: number): string; dropped(item: T, i: number): string; cancelled(item: T): string };
}) {
  const [lifted, setLifted] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const before = useRef<T[] | null>(null);
  const refocus = useRef<string | null>(null);
  const handles = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    const id = refocus.current;
    if (!id) return;
    refocus.current = null;
    const el = handles.current.get(id);
    if (el && document.activeElement !== el) el.focus();
  });

  const onKeyDown = (id: string) => (e: KeyboardEvent) => {
    const i = opts.items.findIndex((x) => opts.idOf(x) === id);
    if (i < 0) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (lifted === id) { setLifted(null); before.current = null; setAnnouncement(opts.say.dropped(opts.items[i]!, i)); }
      else { setLifted(id); before.current = [...opts.items]; setAnnouncement(opts.say.picked(opts.items[i]!, i)); }
      return;
    }
    if (lifted !== id) return;
    if (e.key === "Escape") {
      e.preventDefault();
      if (before.current) opts.onChange(before.current);
      before.current = null;
      setLifted(null);
      refocus.current = id;
      setAnnouncement(opts.say.cancelled(opts.items[i]!));
      return;
    }
    const by = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
    if (!by) return;
    e.preventDefault();
    const next = opts.move(opts.items, i, by);
    const at = next.findIndex((x) => opts.idOf(x) === id);
    if (at === i) return;
    refocus.current = id;
    opts.onChange(next);
    setAnnouncement(opts.say.moved(opts.items[i]!, at));
  };

  return {
    lifted,
    announcement,
    handleProps: (id: string) => ({
      ref: (el: HTMLElement | null) => { if (el) handles.current.set(id, el); else handles.current.delete(id); },
      onKeyDown: onKeyDown(id),
      onBlur: () => { if (lifted === id && refocus.current !== id) { setLifted(null); before.current = null; } },
      "aria-pressed": lifted === id,
    }),
  };
}
