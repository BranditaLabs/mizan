"use client";

import { useLocale } from "next-intl";
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Bdi } from "../Bdi";
import { cx, moveIndex } from "./logic";

export interface TabItem<V extends string> { value: V; label: ReactNode; count?: number | string }

/**
 * Tabs with counts (`.mz-tabs`): one tab stop, arrow keys move between tabs (following the screen in
 * right-to-left), Home/End jump. The current tab's content goes in `children`. Scrolls sideways on phones.
 */
export function Tabs<V extends string>({ label, items, value, onChange, children, className }:
  { label: string; items: ReadonlyArray<TabItem<NoInfer<V>>>; value: V; onChange(v: NoInfer<V>): void; children?: ReactNode; className?: string }) {
  const rtl = useLocale() === "ar";
  const id = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = Math.max(0, items.findIndex((t) => t.value === value));
  const onKey = (e: KeyboardEvent) => {
    const next = moveIndex(e.key, current, items.length, { rtl });
    if (next === null) return;
    e.preventDefault();
    onChange(items[next]!.value);
    refs.current[next]?.focus();
  };
  return (
    <div className={className}>
      <div role="tablist" aria-label={label} className="mz-tabs" onKeyDown={onKey}>
        {items.map((t, i) => (
          <button key={t.value} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" id={`${id}-tab-${t.value}`}
            aria-selected={i === current} aria-controls={`${id}-panel`} tabIndex={i === current ? 0 : -1}
            className="mz-tab" onClick={() => onChange(t.value)}>
            {t.label}
            {t.count !== undefined ? <span className="count"><Bdi>{t.count}</Bdi></span> : null}
          </button>
        ))}
      </div>
      {children !== undefined ? (
        <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${items[current]?.value}`} tabIndex={0} className={cx("pt-4")}>{children}</div>
      ) : null}
    </div>
  );
}
